from __future__ import annotations

import json
import random
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.schemas import AddSourceRequest, NewSessionRequest, UpdateClassesRequest
from core.config import settings
from core.harmonizer import session as session_mgr
from core.harmonizer.mapper import build_canonical_classes
from core.harmonizer.validator import validate
from core.llm.analyzer import SemanticAnalyzer
from core.models import CanonicalClass, HarmonizationSession
from core.parser.yolo import parse_dataset

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


class AnnotationBox(BaseModel):
    class_name: str
    class_id: int
    cx: float
    cy: float
    w: float
    h: float


class ImageSample(BaseModel):
    image_path: str
    source_name: str
    annotations: list[AnnotationBox]

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=HarmonizationSession, status_code=201)
def create_session(body: NewSessionRequest):
    """Create a new harmonization session. Runs LLM analysis synchronously."""
    settings.ensure_workspace()

    source_names = body.source_names or []
    dataset_sources = []
    for i, path in enumerate(body.source_paths):
        name = source_names[i] if i < len(source_names) else None
        try:
            ds = parse_dataset(path, name=name)
            dataset_sources.append(ds)
        except (FileNotFoundError, NotADirectoryError) as e:
            raise HTTPException(status_code=400, detail=f"Cannot parse source '{path}': {e}")

    try:
        analyzer = SemanticAnalyzer()
        dataset_classes = {ds.name: ds.classes for ds in dataset_sources}
        result = analyzer.analyze(dataset_classes, domain_hint=body.domain_hint)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    canonical_classes = build_canonical_classes(result, dataset_sources)
    session = session_mgr.create_session(dataset_sources)
    session.canonical_classes = canonical_classes
    session.status = "reviewing"
    session_mgr.save_session(session)
    return session


@router.get("", response_model=list[HarmonizationSession])
def list_sessions():
    return session_mgr.list_sessions()


@router.get("/{session_id}", response_model=HarmonizationSession)
def get_session(session_id: str):
    try:
        return session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")


@router.patch("/{session_id}/classes", response_model=HarmonizationSession)
def update_classes(session_id: str, body: UpdateClassesRequest):
    """Update canonical classes (e.g. after drag-drop in UI)."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    if session.status not in ("reviewing", "pending"):
        raise HTTPException(
            status_code=409,
            detail=f"Session is '{session.status}', cannot update classes",
        )

    try:
        canonical_classes = [CanonicalClass.model_validate(c) for c in body.canonical_classes]
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid canonical class data: {e}")

    session = session_mgr.update_canonical_classes(session, canonical_classes)
    session_mgr.save_session(session)
    return session


@router.post("/{session_id}/confirm", response_model=HarmonizationSession)
def confirm_session(session_id: str):
    """Confirm a session after reviewing canonical classes."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    validation = validate(session.canonical_classes, session.sources)
    if not validation.valid:
        raise HTTPException(
            status_code=409,
            detail=f"Validation failed: {validation.summary()}",
        )

    try:
        session.transition("confirmed")
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    session_mgr.save_session(session)
    return session


class SaveAnnotationsBody(BaseModel):
    image_path: str
    annotations: list[dict]  # [{class_id, class_name, cx, cy, w, h}]


@router.post("/{session_id}/annotations", response_model=HarmonizationSession)
def save_annotations(session_id: str, body: SaveAnnotationsBody):
    """Save user-edited annotation overrides for a specific image."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    session.annotation_overrides[body.image_path] = body.annotations
    session_mgr.save_session(session)
    return session


@router.delete("/{session_id}/annotations", response_model=HarmonizationSession)
def clear_image_annotations(session_id: str, image_path: str = Query(...)):
    """Remove annotation overrides for a specific image (revert to source)."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    session.annotation_overrides.pop(image_path, None)
    session_mgr.save_session(session)
    return session


@router.get("/{session_id}/samples", response_model=list[ImageSample])
def get_samples(session_id: str, per_source: int = Query(default=8, le=30)):
    """Return random sample images with canonical bbox annotations for visual verification."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    alias_to_cc = {alias: cc for cc in session.canonical_classes for alias in cc.aliases}
    results: list[ImageSample] = []

    for source in session.sources:
        root = Path(source.path)
        images = [p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS]
        if not images:
            continue
        sampled = random.sample(images, min(per_source, len(images)))

        if source.format == "coco":
            ann_index = _build_coco_index(root, alias_to_cc)
            for img_path in sampled:
                key = str(img_path)
                if key in session.annotation_overrides:
                    anns = [AnnotationBox(**a) for a in session.annotation_overrides[key]]
                else:
                    anns = ann_index.get(img_path.name, [])
                results.append(ImageSample(image_path=key, source_name=source.name, annotations=anns))
        else:
            id_to_cc = {i: alias_to_cc[name] for i, name in enumerate(source.classes) if name in alias_to_cc}
            for img_path in sampled:
                key = str(img_path)
                if key in session.annotation_overrides:
                    anns = [AnnotationBox(**a) for a in session.annotation_overrides[key]]
                else:
                    anns = _read_yolo_labels(img_path, root, id_to_cc)
                results.append(ImageSample(image_path=key, source_name=source.name, annotations=anns))

    return results


def _build_coco_index(root: Path, alias_to_cc: dict) -> dict[str, list[AnnotationBox]]:
    index: dict[str, list[AnnotationBox]] = {}
    for cf in sorted(root.rglob("_annotations.coco.json")) + sorted(root.rglob("*.coco.json")):
        try:
            with open(cf) as f:
                data = json.load(f)
            cat_map = {c["id"]: c["name"] for c in data.get("categories", [])}
            img_map = {img["id"]: img for img in data.get("images", [])}
            for ann in data.get("annotations", []):
                img_info = img_map.get(ann.get("image_id"))
                if not img_info:
                    continue
                fname = Path(img_info["file_name"]).name
                cat_name = cat_map.get(ann.get("category_id"))
                cc = alias_to_cc.get(cat_name)
                if not cc:
                    continue
                bbox = ann.get("bbox")
                if not bbox or len(bbox) < 4:
                    continue
                img_w = img_info.get("width", 1) or 1
                img_h = img_info.get("height", 1) or 1
                x, y, w, h = bbox
                index.setdefault(fname, []).append(AnnotationBox(
                    class_name=cc.name,
                    class_id=cc.id,
                    cx=(x + w / 2) / img_w,
                    cy=(y + h / 2) / img_h,
                    w=w / img_w,
                    h=h / img_h,
                ))
        except Exception:
            pass
    return index


def _read_yolo_labels(img_path: Path, root: Path, id_to_cc: dict) -> list[AnnotationBox]:
    # Try labels/ sibling dir first, then same dir
    rel = img_path.relative_to(root)
    parts = list(rel.parts)
    if "images" in parts:
        parts[parts.index("images")] = "labels"
    label_path = root / Path(*parts).with_suffix(".txt")
    if not label_path.exists():
        label_path = img_path.with_suffix(".txt")
    if not label_path.exists():
        return []
    boxes = []
    try:
        for line in label_path.read_text().strip().splitlines():
            p = line.split()
            if len(p) < 5:
                continue
            cc = id_to_cc.get(int(p[0]))
            if not cc:
                continue
            boxes.append(AnnotationBox(
                class_name=cc.name, class_id=cc.id,
                cx=float(p[1]), cy=float(p[2]), w=float(p[3]), h=float(p[4]),
            ))
    except Exception:
        pass
    return boxes


@router.post("/{session_id}/sources", response_model=HarmonizationSession)
def add_source(session_id: str, body: AddSourceRequest):
    """Add one or more dataset sources to an existing session and re-run LLM analysis."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    source_names = body.source_names or []
    new_sources = []
    existing_paths = {s.path for s in session.sources}

    for i, path in enumerate(body.source_paths):
        name = source_names[i] if i < len(source_names) else None
        try:
            ds = parse_dataset(path, name=name)
        except (FileNotFoundError, NotADirectoryError) as e:
            raise HTTPException(status_code=400, detail=f"Cannot parse source '{path}': {e}")
        if ds.path in existing_paths:
            raise HTTPException(status_code=409, detail=f"Source already in session: {path}")
        existing_paths.add(ds.path)
        new_sources.append(ds)

    all_sources = session.sources + new_sources

    try:
        analyzer = SemanticAnalyzer()
        dataset_classes = {ds.name: ds.classes for ds in all_sources}
        result = analyzer.analyze(dataset_classes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    canonical_classes = build_canonical_classes(result, all_sources)
    session.sources = all_sources
    session.canonical_classes = canonical_classes

    if session.status in ("confirmed", "exported"):
        session.transition("reviewing")
    elif session.status == "pending":
        session.status = "reviewing"

    session_mgr.save_session(session)
    return session


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: str):
    try:
        session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    session_mgr.delete_session(session_id)


# ── Dataset statistics ────────────────────────────────────────────────────────

class SourceStat(BaseModel):
    name: str
    image_count: int
    label_count: int
    class_counts: dict[str, int]

class DatasetStatsOut(BaseModel):
    total_images: int
    total_labels: int
    source_stats: list[SourceStat]
    class_counts: dict[str, int]

@router.get("/{session_id}/stats", response_model=DatasetStatsOut)
def get_dataset_stats(session_id: str):
    """Return per-canonical-class annotation counts across all sources."""
    try:
        session = session_mgr.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    from pathlib import Path

    alias_to_canonical: dict[str, str] = {}
    for cc in session.canonical_classes:
        for alias in cc.aliases:
            alias_to_canonical[alias] = cc.name

    class_counts: dict[str, int] = {cc.name: 0 for cc in session.canonical_classes}
    source_stats_list = []

    for source in session.sources:
        root = Path(source.path)
        src_counts: dict[str, int] = {cc.name: 0 for cc in session.canonical_classes}

        for txt_file in root.rglob("*.txt"):
            try:
                for line in txt_file.read_text(encoding="utf-8", errors="ignore").strip().splitlines():
                    parts = line.split()
                    if len(parts) < 5:
                        continue
                    try:
                        class_id = int(parts[0])
                        # Quick sanity check: 4 floats follow
                        _ = [float(p) for p in parts[1:5]]
                    except ValueError:
                        continue
                    if class_id < len(source.classes):
                        raw = source.classes[class_id]
                        canonical = alias_to_canonical.get(raw, raw)
                        if canonical in class_counts:
                            class_counts[canonical] += 1
                            src_counts[canonical] += 1
            except Exception:
                pass

        source_stats_list.append(SourceStat(
            name=source.name,
            image_count=source.image_count,
            label_count=source.label_count,
            class_counts=src_counts,
        ))

    return DatasetStatsOut(
        total_images=sum(s.image_count for s in session.sources),
        total_labels=sum(s.label_count for s in session.sources),
        source_stats=source_stats_list,
        class_counts=class_counts,
    )
