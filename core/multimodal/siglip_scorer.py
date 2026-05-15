"""
SigLIP validation backend — drop-in replacement for CLIP.

SigLIP (Sigmoid Loss for Language-Image Pre-Training) uses a per-class sigmoid
loss instead of softmax, giving independent per-class probabilities.  This makes
it more suitable for multi-label scenarios and generally better calibrated than
plain CLIP for open-vocabulary validation.

Model: google/siglip-base-patch16-224  (~400 MB, same speed as CLIP on CPU)
Speed: ~60-100ms per crop on CPU
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path

import torch
from PIL import Image
from transformers import SiglipModel, SiglipProcessor

from .base import BoxValidation, ImageValidationResult, LabelScore, ValidationRun
from .clip_scorer import _build_result, _crop_box, _get_annotations

logger = logging.getLogger(__name__)

_MODEL_ID = "google/siglip-base-patch16-224"
_MIN_CROP_PX = 10

_model: SiglipModel | None = None
_processor: SiglipProcessor | None = None


def _load():
    global _model, _processor
    if _model is None:
        logger.info("Loading SigLIP model %s …", _MODEL_ID)
        _model = SiglipModel.from_pretrained(_MODEL_ID)
        _processor = SiglipProcessor.from_pretrained(_MODEL_ID)
        _model.eval()
        logger.info("SigLIP loaded.")
    return _model, _processor  # type: ignore[return-value]


class SigLIPScorer:
    """
    SigLIP-based crop scorer.

    Strategy: same as CLIPScorer — crop each YOLO annotation box, score the crop
    against all canonical class names.  Key difference: SigLIP uses sigmoid loss
    so each class gets an independent confidence (not a competition via softmax).
    This is better for multi-label scenarios and avoids the "one class eats the
    rest" effect seen with CLIP softmax.
    """

    BACKEND_NAME = "siglip"

    def __init__(self, threshold: float = 0.15, device: str | None = None) -> None:
        # SigLIP sigmoid scores are higher than OWL-ViT but more calibrated than CLIP
        self.threshold = threshold
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    # ── Public API ────────────────────────────────────────────────────────────

    def score_session(
        self,
        sources: list,
        canonical_classes: list,
        on_progress: Callable[[dict], None] | None = None,
        max_images_per_source: int = 200,
    ) -> ValidationRun:
        model, processor = _load()
        model = model.to(self.device)

        class_names = [cc.name for cc in canonical_classes]
        if not class_names:
            raise ValueError("No canonical classes — run LLM analysis first.")

        text_embeddings = self._encode_texts(model, processor, class_names)

        image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
        results: list[ImageValidationResult] = []
        total_processed = 0

        total_count = sum(
            min(len([p for p in Path(s.path).rglob("*") if p.suffix.lower() in image_extensions]),
                max_images_per_source)
            for s in sources
        )

        for source in sources:
            root = Path(source.path)
            images = sorted(
                p for p in root.rglob("*") if p.suffix.lower() in image_extensions
            )[:max_images_per_source]

            alias_to_canonical: dict[str, str] = {}
            for cc in canonical_classes:
                for alias in cc.aliases:
                    alias_to_canonical[alias] = cc.name

            for img_path in images:
                try:
                    annotations = _get_annotations(img_path, root, source, alias_to_canonical)
                    result = self._score_image(
                        model, processor, img_path, source.name,
                        class_names, text_embeddings, annotations,
                    )
                    results.append(result)
                except Exception as e:
                    logger.warning("Skipping %s: %s", img_path, e)
                finally:
                    total_processed += 1
                    if on_progress:
                        on_progress({"done": total_processed, "total": total_count,
                                     "phase": f"SigLIP · {source.name}"})

        suspicious = [r for r in results if r.is_suspicious]
        return ValidationRun(
            session_id="", total_images=len(results),
            suspicious_count=len(suspicious), threshold=self.threshold,
            backend=self.BACKEND_NAME, results=results,
        )

    def score_single(
        self,
        image_path: str,
        source_name: str,
        annotations: list,
        class_names: list[str],
    ) -> ImageValidationResult:
        """Score one image synchronously — for the lightbox 'Validate' button."""
        model, processor = _load()
        model = model.to(self.device)
        text_embeddings = self._encode_texts(model, processor, class_names)
        return self._score_image(
            model, processor, Path(image_path), source_name,
            class_names, text_embeddings, annotations,
        )

    # ── Private helpers ───────────────────────────────────────────────────────

    def _encode_texts(self, model: SiglipModel, processor: SiglipProcessor,
                      texts: list[str]) -> torch.Tensor:
        prompted = [f"a photo of a {t}" for t in texts]
        # SigLIP processor requires padding="max_length"
        inputs = processor(text=prompted, return_tensors="pt",
                           padding="max_length", truncation=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            emb = model.get_text_features(**inputs)
        return emb / emb.norm(dim=-1, keepdim=True)

    def _encode_pil(self, model: SiglipModel, processor: SiglipProcessor,
                    image: Image.Image) -> torch.Tensor:
        inputs = processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            emb = model.get_image_features(**inputs)
        return emb / emb.norm(dim=-1, keepdim=True)

    def _score_crop(
        self,
        model: SiglipModel,
        processor: SiglipProcessor,
        crop: Image.Image,
        class_names: list[str],
        text_emb: torch.Tensor,
    ) -> tuple[list[LabelScore], str, float]:
        img_emb = self._encode_pil(model, processor, crop)

        # Cosine similarity scaled by the model's learned temperature
        # SigLIP's logit_scale is trained with sigmoid loss → don't softmax, use sigmoid
        logit_scale = model.logit_scale.exp()
        logit_bias  = getattr(model, 'logit_bias', None)

        sims = (img_emb @ text_emb.T).squeeze(0) * logit_scale
        if logit_bias is not None:
            sims = sims + logit_bias

        # Sigmoid: independent per-class probability
        probs = torch.sigmoid(sims)

        scores = [
            LabelScore(class_names[i], float(probs[i]), float(sims[i]))
            for i in range(len(class_names))
        ]
        top_idx = int(probs.argmax())
        return scores, class_names[top_idx], float(probs[top_idx])

    def _score_image(
        self,
        model: SiglipModel,
        processor: SiglipProcessor,
        img_path: Path,
        source_name: str,
        class_names: list[str],
        text_emb: torch.Tensor,
        annotations: list,
    ) -> ImageValidationResult:
        img = Image.open(img_path).convert("RGB")
        img_w, img_h = img.size

        box_validations: list[BoxValidation] = []
        score_acc: dict[str, list[float]] = {cn: [] for cn in class_names}

        target_annotations = annotations or [(-1, "", 0.5, 0.5, 1.0, 1.0)]
        for box_index, class_name, cx, cy, bw, bh in target_annotations:
            crop = _crop_box(img, img_w, img_h, cx, cy, bw, bh) or img
            scores, top_class, top_conf = self._score_crop(
                model, processor, crop, class_names, text_emb,
            )
            conf_map = {s.class_name: s.confidence for s in scores}
            assigned_conf = conf_map.get(class_name, 0.0) if class_name else 0.0

            for s in scores:
                score_acc[s.class_name].append(s.confidence)

            if box_index >= 0:
                box_validations.append(BoxValidation(
                    box_index=box_index, class_name=class_name,
                    cx=cx, cy=cy, w=bw, h=bh,
                    assigned_confidence=assigned_conf,
                    top_class=top_class, top_confidence=top_conf,
                    scores=scores, is_suspicious=assigned_conf < self.threshold,
                ))

        return _build_result(
            img_path, source_name, box_validations, score_acc,
            class_names, self.threshold, self.BACKEND_NAME,
        )
