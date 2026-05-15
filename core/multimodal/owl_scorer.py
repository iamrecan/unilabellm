"""
OWL-ViT validation backend — open-vocabulary detection per box crop.

OWL-ViT is built on a CLIP-ViT backbone but fine-tuned for object detection,
so it has better spatial understanding and is more accurately calibrated for
"is there a <class> in this image?" — especially for non-generic categories.

Model: google/owlvit-base-patch32 (~92M params, smaller than CLIP)
Speed: ~150-300ms per image on CPU
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

import torch
from PIL import Image
from transformers import OwlViTForObjectDetection, OwlViTProcessor

from .base import BoxValidation, ImageValidationResult, LabelScore, ValidationRun
from .clip_scorer import _build_result, _crop_box, _get_annotations

logger = logging.getLogger(__name__)

_MODEL_ID = "google/owlvit-base-patch32"
_MIN_CROP_PX = 16

_model: OwlViTForObjectDetection | None = None
_processor: OwlViTProcessor | None = None


def _load():
    global _model, _processor
    if _model is None:
        logger.info("Loading OWL-ViT model %s …", _MODEL_ID)
        _model = OwlViTForObjectDetection.from_pretrained(_MODEL_ID)
        _processor = OwlViTProcessor.from_pretrained(_MODEL_ID)
        _model.eval()
        logger.info("OWL-ViT loaded.")
    return _model, _processor  # type: ignore[return-value]


class OWLScorer:
    """
    OWL-ViT based scorer.

    Strategy: crop each YOLO annotation box, run OWL-ViT on the crop with
    all canonical class names as text queries. OWL-ViT returns a detection
    score per class — we take the max over spatial positions as the class
    confidence for that crop.

    Because OWL-ViT was fine-tuned for detection (not just image-text
    matching), it gives better per-object confidence than plain CLIP,
    especially for small objects or unusual viewpoints.
    """

    BACKEND_NAME = "owl-vit"

    def __init__(self, threshold: float = 0.10, device: str | None = None) -> None:
        # OWL-ViT scores are lower than CLIP — 0.10 is a reasonable default
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

        # OWL-ViT text queries — CLIP-style prompts work well
        text_queries = [f"a photo of a {cn}" for cn in class_names]

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
                        class_names, text_queries, annotations,
                    )
                    results.append(result)
                except Exception as e:
                    logger.warning("Skipping %s: %s", img_path, e)
                finally:
                    total_processed += 1
                    if on_progress:
                        on_progress({"done": total_processed, "total": total_count,
                                     "phase": f"OWL-ViT · {source.name}"})

        suspicious = [r for r in results if r.is_suspicious]
        return ValidationRun(
            session_id="", total_images=len(results),
            suspicious_count=len(suspicious), threshold=self.threshold,
            backend=self.BACKEND_NAME, results=results,
        )

    # ── Single-image helpers (used by per-image API endpoints) ───────────────

    def score_single(
        self,
        image_path: str,
        source_name: str,
        annotations: list,      # [(box_index, class_name, cx, cy, w, h), ...]
        class_names: list[str],
    ) -> ImageValidationResult:
        """Score one image synchronously — for the lightbox 'Validate' button."""
        model, processor = _load()
        model = model.to(self.device)
        text_queries = [f"a photo of a {cn}" for cn in class_names]
        return self._score_image(
            model, processor, Path(image_path), source_name,
            class_names, text_queries, annotations,
        )

    def detect_boxes(
        self,
        image_path: str,
        class_names: list[str],
        threshold: float = 0.05,
    ) -> list[dict]:
        """
        Run open-vocabulary detection on the full image.
        Returns a list of detected boxes in YOLO normalised format:
        [{ class_name, cx, cy, w, h, confidence }, ...]
        """
        model, processor = _load()
        model = model.to(self.device)

        img = Image.open(image_path).convert("RGB")
        W, H = img.size
        text_queries = [f"a photo of a {cn}" for cn in class_names]

        inputs = processor(text=[text_queries], images=img, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = model(**inputs)

        target_sizes = torch.Tensor([[H, W]]).to(self.device)
        det = processor.post_process_object_detection(
            outputs=outputs, threshold=threshold, target_sizes=target_sizes,
        )[0]

        results = []
        for score, label, box in zip(det["scores"], det["labels"], det["boxes"]):
            x1, y1, x2, y2 = box.tolist()
            cx = ((x1 + x2) / 2) / W
            cy = ((y1 + y2) / 2) / H
            bw = (x2 - x1) / W
            bh = (y2 - y1) / H
            results.append({
                "class_name": class_names[int(label)],
                "class_id": int(label),
                "cx": round(cx, 6), "cy": round(cy, 6),
                "w": round(bw, 6),  "h": round(bh, 6),
                "confidence": round(float(score), 4),
            })

        # Sort by confidence desc, deduplicate heavily overlapping boxes (NMS-lite)
        results.sort(key=lambda r: -r["confidence"])
        return _nms_lite(results, iou_thresh=0.5)

    # ── Private helpers ───────────────────────────────────────────────────────

    def _score_crop(
        self,
        model: OwlViTForObjectDetection,
        processor: OwlViTProcessor,
        crop: Image.Image,
        class_names: list[str],
        text_queries: list[str],
    ) -> tuple[list[LabelScore], str, float]:
        """
        Score a single crop against all class queries.

        OWL-ViT produces a similarity map of shape [num_patches, num_classes].
        We take the max over patches — this answers "anywhere in this crop,
        how confident is OWL-ViT that this class is present?"
        """
        inputs = processor(text=[text_queries], images=crop, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = model(**inputs)

        # logits: [1, num_patches, num_classes] — raw similarity scores
        # Take max over the patch dimension → [num_classes]
        patch_logits = outputs.logits[0]               # [num_patches, num_classes]
        class_max_logits = patch_logits.max(dim=0).values  # [num_classes]

        # Sigmoid gives per-class probability (OWL-ViT is a multi-label detector)
        # We additionally softmax for relative ranking (who's on top)
        class_probs_abs = class_max_logits.sigmoid()   # absolute, for display
        class_probs_rel = torch.softmax(class_max_logits, dim=0)  # relative ranking

        # Blend: favour relative ranking for top-class detection, absolute for threshold
        # Use absolute (sigmoid) as the "assigned_confidence" — more interpretable
        scores = [
            LabelScore(
                class_name=class_names[i],
                confidence=float(class_probs_abs[i]),
                raw_similarity=float(class_max_logits[i]),
            )
            for i in range(len(class_names))
        ]

        top_idx = int(class_probs_rel.argmax())
        top_class = class_names[top_idx]
        top_conf = float(class_probs_abs[top_idx])

        return scores, top_class, top_conf

    def _score_image(
        self,
        model: OwlViTForObjectDetection,
        processor: OwlViTProcessor,
        img_path: Path,
        source_name: str,
        class_names: list[str],
        text_queries: list[str],
        annotations: list,
    ) -> ImageValidationResult:
        img = Image.open(img_path).convert("RGB")
        W, H = img.size

        box_validations: list[BoxValidation] = []
        score_acc: dict[str, list[float]] = {cn: [] for cn in class_names}

        if not annotations:
            # No labels — score full image for context
            scores, top_class, top_conf = self._score_crop(
                model, processor, img, class_names, text_queries,
            )
            for s in scores:
                score_acc[s.class_name].append(s.confidence)
        else:
            for box_index, class_name, cx, cy, bw, bh in annotations:
                crop = _crop_box(img, W, H, cx, cy, bw, bh) or img
                scores, top_class, top_conf = self._score_crop(
                    model, processor, crop, class_names, text_queries,
                )
                conf_map = {s.class_name: s.confidence for s in scores}
                assigned_conf = conf_map.get(class_name, 0.0)

                for s in scores:
                    score_acc[s.class_name].append(s.confidence)

                box_validations.append(BoxValidation(
                    box_index=box_index,
                    class_name=class_name,
                    cx=cx, cy=cy, w=bw, h=bh,
                    assigned_confidence=assigned_conf,
                    top_class=top_class,
                    top_confidence=top_conf,
                    scores=scores,
                    is_suspicious=assigned_conf < self.threshold,
                ))

        return _build_result(
            img_path, source_name, box_validations, score_acc,
            class_names, self.threshold, self.BACKEND_NAME,
        )


# ── Lightweight NMS to deduplicate overlapping detections ────────────────────

def _iou(a: dict, b: dict) -> float:
    ax1, ay1 = a["cx"] - a["w"] / 2, a["cy"] - a["h"] / 2
    ax2, ay2 = a["cx"] + a["w"] / 2, a["cy"] + a["h"] / 2
    bx1, by1 = b["cx"] - b["w"] / 2, b["cy"] - b["h"] / 2
    bx2, by2 = b["cx"] + b["w"] / 2, b["cy"] + b["h"] / 2
    ix = max(0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


def _nms_lite(boxes: list[dict], iou_thresh: float = 0.5) -> list[dict]:
    kept = []
    for box in boxes:  # already sorted by confidence desc
        if all(_iou(box, k) < iou_thresh for k in kept):
            kept.append(box)
    return kept
