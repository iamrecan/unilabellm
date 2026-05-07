from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

try:
    import imagehash
    from PIL import Image
    _PHASH_AVAILABLE = True
except ImportError:
    _PHASH_AVAILABLE = False
    logger.warning("imagehash/Pillow not available — deduplication disabled")

HASH_THRESHOLD = 8  # Hamming distance threshold for near-duplicates


def compute_phash(image_path: Path) -> str | None:
    if not _PHASH_AVAILABLE:
        return None
    try:
        img = Image.open(image_path).convert("RGB")
        return str(imagehash.phash(img))
    except Exception as e:
        logger.debug("Could not hash %s: %s", image_path, e)
        return None


def find_duplicates(
    image_paths: list[Path],
    threshold: int = HASH_THRESHOLD,
) -> dict[int, int]:
    """Return {duplicate_index: original_index} for near-duplicate images."""
    if not _PHASH_AVAILABLE:
        return {}

    hashes: list[tuple[int, object]] = []
    duplicates: dict[int, int] = {}

    for idx, path in enumerate(image_paths):
        h_str = compute_phash(path)
        if h_str is None:
            continue
        h = imagehash.hex_to_hash(h_str)

        found = False
        for orig_idx, orig_h in hashes:
            if (h - orig_h) <= threshold:
                duplicates[idx] = orig_idx
                found = True
                break
        if not found:
            hashes.append((idx, h))

    if duplicates:
        logger.info("Found %d near-duplicate images", len(duplicates))
    return duplicates
