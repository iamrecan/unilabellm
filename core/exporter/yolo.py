from __future__ import annotations

import hashlib
import logging
import random
import re
import shutil
from collections import defaultdict
from pathlib import Path

import yaml

from core.merger.dedup import find_duplicates
from core.merger.merger import MergedRecord, collect_records
from core.models import CanonicalClass, ExportConfig, ExportSummary, HarmonizationSession

logger = logging.getLogger(__name__)


def export_dataset(
    session: HarmonizationSession,
    config: ExportConfig,
    annotation_overrides: dict | None = None,
    on_progress=None,
) -> ExportSummary:
    """Export a confirmed session to a YOLO dataset."""

    def _prog(phase: str, done: int, total: int):
        if on_progress:
            on_progress({"phase": phase, "done": done, "total": total})

    out = Path(config.output_path)
    out.mkdir(parents=True, exist_ok=True)

    _prog("collecting", 0, 0)
    records = collect_records(session.sources, session.canonical_classes, annotation_overrides)
    if not records:
        raise ValueError("No images found in the provided sources")

    # Deduplicate
    _prog("dedup", 0, len(records))
    image_paths = [r.image_path for r in records]
    duplicate_map = find_duplicates(image_paths)
    unique_records = [r for i, r in enumerate(records) if i not in duplicate_map]
    duplicate_count = len(duplicate_map)
    logger.info("Dedup: %d total → %d unique", len(records), len(unique_records))

    # Stratified split respecting video groups
    _prog("splitting", 0, len(unique_records))
    train_records, val_records, test_records = _stratified_split(
        unique_records, config.split_ratio, config.seed
    )

    # Write files – shared counter so progress is cumulative across splits
    written_box = [0]
    total = len(unique_records)

    def _on_file(sn: str) -> None:
        written_box[0] += 1
        _prog(f"writing {sn}", written_box[0], total)

    for split_name, split_records in [
        ("train", train_records),
        ("val", val_records),
        ("test", test_records),
    ]:
        _prog(f"writing {split_name}", written_box[0], total)
        _write_split(out, split_name, split_records, session.canonical_classes,
                     on_file=lambda sn=split_name: _on_file(sn))

    # Write data.yaml
    class_names = [cc.name for cc in sorted(session.canonical_classes, key=lambda c: c.id)]
    _write_data_yaml(out, class_names)

    # Compute summary
    all_labels: list[tuple] = []
    for r in unique_records:
        all_labels.extend(r.new_labels)

    class_counts: dict[str, int] = defaultdict(int)
    for (cls_id, *_) in all_labels:
        if 0 <= cls_id < len(class_names):
            class_counts[class_names[cls_id]] += 1

    return ExportSummary(
        session_id=session.id,
        output_path=str(out),
        total_images=len(unique_records),
        split_counts={
            "train": len(train_records),
            "val": len(val_records),
            "test": len(test_records),
        },
        class_counts=dict(class_counts),
        duplicate_count=duplicate_count,
    )


def _stratified_split(
    records: list[MergedRecord],
    ratio: tuple[float, float, float],
    seed: int,
) -> tuple[list, list, list]:
    rng = random.Random(seed)

    # Group by video_id to prevent leakage
    video_groups: dict[str, list[MergedRecord]] = defaultdict(list)
    for r in records:
        key = r.video_id or r.original_name
        video_groups[key].append(r)

    group_keys = list(video_groups.keys())
    rng.shuffle(group_keys)

    n = len(group_keys)
    n_train = int(n * ratio[0])
    n_val = int(n * ratio[1])

    train_keys = set(group_keys[:n_train])
    val_keys = set(group_keys[n_train:n_train + n_val])
    test_keys = set(group_keys[n_train + n_val:])

    def flatten(keys):
        result = []
        for k in group_keys:
            if k in keys:
                result.extend(video_groups[k])
        return result

    return flatten(train_keys), flatten(val_keys), flatten(test_keys)


def _slugify(name: str, max_len: int = 16) -> str:
    """Convert dataset name to a safe, short filename slug."""
    slug = re.sub(r'[^a-zA-Z0-9]+', '_', name).strip('_').lower()
    return slug[:max_len].strip('_') or "src"


def _make_filename(record: MergedRecord) -> str:
    """
    Deterministic filename:  {src_slug}_{original_stem}_{hash6}{ext}

    - src_slug   : first 16 chars of slugified source name
    - original_stem: original image stem (spaces → _, truncated to 40 chars)
    - hash6      : first 6 chars of MD5 of the full original path — guarantees
                   uniqueness even when two sources share the same file name
    """
    src_slug = _slugify(record.source_name, max_len=16)
    stem = re.sub(r'[^a-zA-Z0-9]+', '_', record.image_path.stem).strip('_')[:40]
    h = hashlib.md5(str(record.image_path).encode()).hexdigest()[:6]
    ext = record.image_path.suffix.lower()
    return f"{src_slug}__{stem}__{h}{ext}"


def _write_split(
    out: Path,
    split_name: str,
    records: list[MergedRecord],
    canonical_classes: list[CanonicalClass],
    on_file=None,
) -> None:
    img_dir = out / "images" / split_name
    lbl_dir = out / "labels" / split_name
    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)

    for record in records:
        base_name = _make_filename(record)
        shutil.copy2(record.image_path, img_dir / base_name)

        label_lines = [
            f"{cls_id} {x:.6f} {y:.6f} {w:.6f} {h:.6f}"
            for (cls_id, x, y, w, h) in record.new_labels
        ]
        lbl_stem = Path(base_name).stem
        (lbl_dir / f"{lbl_stem}.txt").write_text("\n".join(label_lines))

        if on_file:
            on_file()


def _write_data_yaml(out: Path, class_names: list[str]) -> None:
    data = {
        "path": str(out),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "nc": len(class_names),
        "names": class_names,
    }
    (out / "data.yaml").write_text(yaml.dump(data, default_flow_style=False))
    logger.info("Wrote data.yaml with %d classes", len(class_names))
