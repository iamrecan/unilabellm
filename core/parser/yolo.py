from __future__ import annotations

import json
import logging
from pathlib import Path

import yaml

from core.models import DatasetSource

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def parse_dataset(path: str | Path, name: str | None = None) -> DatasetSource:
    """Parse a YOLO or COCO dataset directory and return a DatasetSource."""
    root = Path(path).resolve()
    if not root.exists():
        raise FileNotFoundError(f"Dataset path does not exist: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"Dataset path is not a directory: {root}")

    dataset_name = name or root.name
    image_count, label_count = _count_files(root)

    # Try COCO format first (annotations.coco.json anywhere in tree)
    classes, fmt = _try_coco(root)

    if not classes:
        # Try YOLO yaml
        yaml_path = _find_yaml(root)
        if yaml_path:
            classes = _parse_yaml_classes(yaml_path)
        fmt = "yolo"

    if not classes:
        # Fallback: classes.txt or scan label IDs
        classes = _infer_classes_from_labels(root)

    logger.info(
        "Parsed dataset '%s' (%s): %d classes, %d images, %d labels",
        dataset_name, fmt, len(classes), image_count, label_count,
    )

    return DatasetSource(
        path=str(root),
        name=dataset_name,
        format=fmt,
        classes=classes,
        image_count=image_count,
        label_count=label_count,
    )


# ------------------------------------------------------------------
# COCO format
# ------------------------------------------------------------------

def _try_coco(root: Path) -> tuple[list[str], str]:
    """Find and parse any COCO JSON annotation file. Returns (classes, format)."""
    coco_files = sorted(root.rglob("*.coco.json")) + sorted(root.rglob("_annotations.coco.json"))
    # also check common names
    for candidate in ["annotations.json", "instances.json"]:
        p = root / candidate
        if p.exists():
            coco_files.insert(0, p)

    seen: set[Path] = set()
    all_classes: dict[int, str] = {}

    for cf in coco_files:
        if cf in seen:
            continue
        seen.add(cf)
        try:
            with open(cf) as f:
                data = json.load(f)
            if "categories" not in data:
                continue
            for cat in data["categories"]:
                cid = cat.get("id", -1)
                cname = str(cat.get("name", "")).strip()
                if cname and cname not in ("", "none"):
                    all_classes[cid] = cname
        except Exception as e:
            logger.warning("Could not parse COCO JSON %s: %s", cf, e)

    if not all_classes:
        return [], "yolo"

    classes = [all_classes[k] for k in sorted(all_classes.keys())]
    return classes, "coco"


# ------------------------------------------------------------------
# YOLO format
# ------------------------------------------------------------------

def _find_yaml(root: Path) -> Path | None:
    candidates = ["data.yaml", "dataset.yaml", "data.yml", "dataset.yml"]
    for name in candidates:
        p = root / name
        if p.exists():
            return p
    yamls = list(root.glob("*.yaml")) + list(root.glob("*.yml"))
    return yamls[0] if yamls else None


def _parse_yaml_classes(yaml_path: Path) -> list[str]:
    try:
        with open(yaml_path) as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict):
            return []
        names = data.get("names", [])
        if isinstance(names, list):
            return [str(n) for n in names]
        if isinstance(names, dict):
            return [str(names[k]) for k in sorted(names.keys())]
        return []
    except Exception as e:
        logger.warning("Could not parse YAML %s: %s", yaml_path, e)
        return []


def _count_files(root: Path) -> tuple[int, int]:
    image_count = 0
    label_count = 0
    for p in root.rglob("*"):
        if p.suffix.lower() in IMAGE_EXTENSIONS:
            image_count += 1
        elif p.suffix == ".txt" and p.name != "classes.txt":
            label_count += 1
    return image_count, label_count


def _infer_classes_from_labels(root: Path) -> list[str]:
    classes_txt = root / "classes.txt"
    if classes_txt.exists():
        lines = classes_txt.read_text().strip().splitlines()
        return [ln.strip() for ln in lines if ln.strip()]

    class_ids: set[int] = set()
    for label_file in root.rglob("*.txt"):
        if label_file.name == "classes.txt":
            continue
        try:
            for line in label_file.read_text().strip().splitlines():
                parts = line.split()
                if parts:
                    try:
                        class_ids.add(int(parts[0]))
                    except ValueError:
                        pass
        except OSError:
            pass

    if class_ids:
        max_id = max(class_ids)
        return [f"class_{i}" for i in range(max_id + 1)]
    return []
