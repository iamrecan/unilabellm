from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/inference", tags=["inference"])

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


class InferenceRequest(BaseModel):
    model_path: str
    image_path: str
    conf: float = 0.25
    iou:  float = 0.45


class PredictionBox(BaseModel):
    class_id:   int
    class_name: str
    cx: float
    cy: float
    w:  float
    h:  float
    confidence: float


class InferenceResult(BaseModel):
    image_path:    str
    predictions:   list[PredictionBox]
    model_classes: list[str]
    inference_ms:  float


class BatchInferenceRequest(BaseModel):
    model_path: str
    image_dir:  str
    conf: float = 0.25
    iou:  float = 0.45
    max_images: int = 20


class BatchResult(BaseModel):
    results:       list[InferenceResult]
    model_classes: list[str]
    total_ms:      float


@router.post("", response_model=InferenceResult)
def run_inference(body: InferenceRequest):
    """Run YOLO inference on a single image."""
    model, model_classes = _load_model(body.model_path)
    img_path = _resolve_image(body.image_path)

    t0 = time.time()
    results = model.predict(source=str(img_path), conf=body.conf, iou=body.iou, verbose=False)
    elapsed = round((time.time() - t0) * 1000, 1)

    return InferenceResult(
        image_path=str(img_path),
        predictions=_extract_boxes(results, model.names),
        model_classes=model_classes,
        inference_ms=elapsed,
    )


@router.post("/batch", response_model=BatchResult)
def run_batch(body: BatchInferenceRequest):
    """Run YOLO inference on all images in a directory (up to max_images)."""
    model, model_classes = _load_model(body.model_path)

    img_dir = Path(body.image_dir).expanduser().resolve()
    if not img_dir.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {body.image_dir}")

    images = [p for p in img_dir.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS]
    images = sorted(images)[: body.max_images]
    if not images:
        raise HTTPException(status_code=400, detail="No images found in directory")

    t0 = time.time()
    out: list[InferenceResult] = []
    for img in images:
        results = model.predict(source=str(img), conf=body.conf, iou=body.iou, verbose=False)
        out.append(InferenceResult(
            image_path=str(img),
            predictions=_extract_boxes(results, model.names),
            model_classes=model_classes,
            inference_ms=0,
        ))
    total_ms = round((time.time() - t0) * 1000, 1)

    return BatchResult(results=out, model_classes=model_classes, total_ms=total_ms)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_model(model_path: str):
    try:
        from ultralytics import YOLO  # noqa: PLC0415
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="ultralytics not installed. Run: pip install ultralytics",
        )
    path = Path(model_path).expanduser().resolve()
    if not path.exists():
        raise HTTPException(status_code=400, detail=f"Model not found: {model_path}")
    if path.suffix not in {".pt", ".onnx", ".engine"}:
        raise HTTPException(status_code=400, detail="Model must be .pt / .onnx / .engine")

    model = YOLO(str(path))
    names: dict[int, str] = model.names
    class_list = [names[i] for i in sorted(names)]
    return model, class_list


def _resolve_image(image_path: str) -> Path:
    p = Path(image_path).expanduser().resolve()
    if not p.exists():
        raise HTTPException(status_code=400, detail=f"Image not found: {image_path}")
    if p.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not an image file")
    return p


def _extract_boxes(results, names: dict[int, str]) -> list[PredictionBox]:
    boxes: list[PredictionBox] = []
    if not results:
        return boxes
    r = results[0]
    img_h, img_w = r.orig_shape
    for box in r.boxes:
        cls_id   = int(box.cls[0])
        cls_name = names.get(cls_id, f"class_{cls_id}")
        conf     = float(box.conf[0])
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        bw, bh = x2 - x1, y2 - y1
        boxes.append(PredictionBox(
            class_id=cls_id, class_name=cls_name, confidence=conf,
            cx=(x1 + bw / 2) / img_w, cy=(y1 + bh / 2) / img_h,
            w=bw / img_w, h=bh / img_h,
        ))
    return boxes
