from __future__ import annotations

import json
import logging
from pathlib import Path

from core.models import CanonicalClass, DatasetSource

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


class MergedRecord:
    """A single image+label record ready for export."""

    def __init__(
        self,
        image_path: Path,
        label_path: Path | None,
        new_labels: list[tuple[int, float, float, float, float]],
        source_name: str,
        original_name: str,
        video_id: str | None = None,
    ) -> None:
        self.image_path = image_path
        self.label_path = label_path
        self.new_labels = new_labels
        self.source_name = source_name
        self.original_name = original_name
        self.video_id = video_id


def build_class_id_map(
    source: DatasetSource,
    canonical_classes: list[CanonicalClass],
) -> dict[int, int]:
    """Map original class index → canonical class ID (YOLO format)."""
    alias_to_canonical: dict[str, int] = {}
    for cc in canonical_classes:
        for alias in cc.aliases:
            alias_to_canonical[alias] = cc.id

    id_map: dict[int, int] = {}
    for orig_id, orig_name in enumerate(source.classes):
        canonical_id = alias_to_canonical.get(orig_name)
        if canonical_id is not None:
            id_map[orig_id] = canonical_id
        else:
            logger.warning(
                "Source '%s' class '%s' (id=%d) unmapped — skipping",
                source.name, orig_name, orig_id,
            )
    return id_map


def collect_records(
    sources: list[DatasetSource],
    canonical_classes: list[CanonicalClass],
    annotation_overrides: dict[str, list[dict]] | None = None,
) -> list[MergedRecord]:
    """Collect all image+label pairs from all sources, remapping class IDs."""
    records: list[MergedRecord] = []
    for source in sources:
        src_root = Path(source.path)
        if source.format == "coco":
            records.extend(_collect_coco(src_root, source, canonical_classes))
        else:
            id_map = build_class_id_map(source, canonical_classes)
            records.extend(_collect_yolo(src_root, source, id_map))

    # Apply per-image annotation overrides (user edits from label editor)
    if annotation_overrides:
        for record in records:
            key = str(record.image_path)
            if key in annotation_overrides:
                record.new_labels = [
                    (a["class_id"], a["cx"], a["cy"], a["w"], a["h"])
                    for a in annotation_overrides[key]
                ]

    logger.info("Collected %d records from %d sources", len(records), len(sources))
    return records


# ------------------------------------------------------------------
# COCO format collector
# ------------------------------------------------------------------

def _collect_coco(
    root: Path,
    source: DatasetSource,
    canonical_classes: list[CanonicalClass],
) -> list[MergedRecord]:
    alias_to_canonical: dict[str, int] = {
        alias: cc.id for cc in canonical_classes for alias in cc.aliases
    }

    # Load all COCO JSON files in the tree
    # filename (basename) → list of (canonical_id, cx, cy, w, h)
    annotation_index: dict[str, list[tuple[int, float, float, float, float]]] = {}

    for cf in sorted(root.rglob("_annotations.coco.json")) + sorted(root.rglob("*.coco.json")):
        _load_coco_json(cf, alias_to_canonical, annotation_index)

    records: list[MergedRecord] = []
    for img_path in _iter_images(root):
        fname = img_path.name
        labels = annotation_index.get(fname, [])
        video_id = _extract_video_id(img_path.stem)
        records.append(MergedRecord(
            image_path=img_path,
            label_path=None,
            new_labels=labels,
            source_name=source.name,
            original_name=fname,
            video_id=video_id,
        ))

    return records


def _load_coco_json(
    cf: Path,
    alias_to_canonical: dict[str, int],
    index: dict[str, list[tuple[int, float, float, float, float]]],
) -> None:
    try:
        with open(cf) as f:
            data = json.load(f)

        cat_map: dict[int, str] = {c["id"]: c["name"] for c in data.get("categories", [])}
        img_map: dict[int, dict] = {img["id"]: img for img in data.get("images", [])}

        for ann in data.get("annotations", []):
            img_info = img_map.get(ann.get("image_id"))
            if not img_info:
                continue

            fname = Path(img_info["file_name"]).name
            cat_name = cat_map.get(ann.get("category_id"))
            if not cat_name:
                continue

            canonical_id = alias_to_canonical.get(cat_name)
            if canonical_id is None:
                continue  # label not mapped to any canonical class — skip

            bbox = ann.get("bbox")
            if not bbox or len(bbox) < 4:
                continue

            img_w = img_info.get("width", 0)
            img_h = img_info.get("height", 0)
            if not img_w or not img_h:
                continue

            x, y, w, h = bbox
            cx = (x + w / 2) / img_w
            cy = (y + h / 2) / img_h
            nw = w / img_w
            nh = h / img_h

            # Clamp to [0, 1]
            cx = max(0.0, min(1.0, cx))
            cy = max(0.0, min(1.0, cy))
            nw = max(0.0, min(1.0, nw))
            nh = max(0.0, min(1.0, nh))

            index.setdefault(fname, []).append((canonical_id, cx, cy, nw, nh))

    except Exception as e:
        logger.warning("Error loading COCO JSON %s: %s", cf, e)


# ------------------------------------------------------------------
# YOLO format collector
# ------------------------------------------------------------------

def _collect_yolo(
    root: Path,
    source: DatasetSource,
    id_map: dict[int, int],
) -> list[MergedRecord]:
    records: list[MergedRecord] = []
    for img_path in _iter_images(root):
        label_path = _find_label(img_path, root)
        new_labels = _remap_labels(label_path, id_map)
        video_id = _extract_video_id(img_path.stem)
        records.append(MergedRecord(
            image_path=img_path,
            label_path=label_path,
            new_labels=new_labels,
            source_name=source.name,
            original_name=img_path.name,
            video_id=video_id,
        ))
    return records


def _iter_images(root: Path):
    for p in root.rglob("*"):
        if p.suffix.lower() in IMAGE_EXTENSIONS:
            yield p


def _find_label(img_path: Path, root: Path) -> Path | None:
    rel = img_path.relative_to(root)
    parts = list(rel.parts)
    if "images" in parts:
        idx = parts.index("images")
        parts[idx] = "labels"
    label_rel = Path(*parts).with_suffix(".txt")
    label_path = root / label_rel
    if label_path.exists():
        return label_path
    sibling = img_path.with_suffix(".txt")
    return sibling if sibling.exists() else None


def _remap_labels(
    label_path: Path | None,
    id_map: dict[int, int],
) -> list[tuple[int, float, float, float, float]]:
    if not label_path:
        return []
    result = []
    try:
        for line in label_path.read_text().strip().splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            orig_id = int(parts[0])
            if orig_id not in id_map:
                continue
            new_id = id_map[orig_id]
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            result.append((new_id, x, y, w, h))
    except (OSError, ValueError) as e:
        logger.warning("Error reading label %s: %s", label_path, e)
    return result


def _extract_video_id(stem: str) -> str | None:
    if "_frame_" in stem:
        return stem.rsplit("_frame_", 1)[0]
    return None
