from __future__ import annotations

import logging

from core.llm.analyzer import LLMAnalysisResult
from core.models import CanonicalClass, DatasetSource

logger = logging.getLogger(__name__)


class ConflictError(Exception):
    pass


def build_canonical_classes(
    result: LLMAnalysisResult,
    sources: list[DatasetSource],
) -> list[CanonicalClass]:
    """Convert LLM analysis result into CanonicalClass list with source_map populated."""
    # Build reverse index: alias → source dataset names
    alias_to_sources: dict[str, list[str]] = {}
    for source in sources:
        for cls in source.classes:
            alias_to_sources.setdefault(cls, []).append(source.name)

    canonical_classes: list[CanonicalClass] = []
    for idx, entry in enumerate(result.canonical_classes):
        name = entry["name"]
        aliases = entry["aliases"]
        confidence = entry.get("confidence", 1.0)

        # Build source_map: {dataset_name: [original_labels_that_mapped_here]}
        source_map: dict[str, list[str]] = {}
        for alias in aliases:
            for ds_name in alias_to_sources.get(alias, []):
                source_map.setdefault(ds_name, []).append(alias)

        canonical_classes.append(
            CanonicalClass(
                id=idx,
                name=name,
                aliases=aliases,
                source_map=source_map,
                confidence=confidence,
            )
        )
    return canonical_classes


def add_alias(
    canonical_classes: list[CanonicalClass],
    canonical_id: int,
    alias: str,
) -> list[CanonicalClass]:
    """Add an alias to a canonical class. Raises ConflictError if alias already used."""
    for cc in canonical_classes:
        if alias in cc.aliases:
            if cc.id == canonical_id:
                return canonical_classes  # already there
            raise ConflictError(
                f"Alias '{alias}' already belongs to class '{cc.name}' (id={cc.id})"
            )
    for cc in canonical_classes:
        if cc.id == canonical_id:
            cc.aliases.append(alias)
            return canonical_classes
    raise ValueError(f"Canonical class id={canonical_id} not found")


def remove_alias(
    canonical_classes: list[CanonicalClass],
    canonical_id: int,
    alias: str,
) -> list[CanonicalClass]:
    """Remove an alias from a canonical class."""
    for cc in canonical_classes:
        if cc.id == canonical_id:
            if alias not in cc.aliases:
                raise ValueError(f"Alias '{alias}' not found in class '{cc.name}'")
            cc.aliases.remove(alias)
            return canonical_classes
    raise ValueError(f"Canonical class id={canonical_id} not found")


def add_canonical_class(
    canonical_classes: list[CanonicalClass],
    name: str,
    aliases: list[str] | None = None,
) -> list[CanonicalClass]:
    """Add a new canonical class."""
    next_id = max((c.id for c in canonical_classes), default=-1) + 1
    canonical_classes.append(
        CanonicalClass(id=next_id, name=name, aliases=aliases or [])
    )
    return canonical_classes


def remove_canonical_class(
    canonical_classes: list[CanonicalClass],
    canonical_id: int,
) -> tuple[list[CanonicalClass], list[str]]:
    """Remove a canonical class. Returns updated list and freed aliases."""
    for cc in canonical_classes:
        if cc.id == canonical_id:
            freed = list(cc.aliases)
            canonical_classes.remove(cc)
            return canonical_classes, freed
    raise ValueError(f"Canonical class id={canonical_id} not found")


def rename_canonical_class(
    canonical_classes: list[CanonicalClass],
    canonical_id: int,
    new_name: str,
) -> list[CanonicalClass]:
    for cc in canonical_classes:
        if cc.id == canonical_id:
            cc.name = new_name
            return canonical_classes
    raise ValueError(f"Canonical class id={canonical_id} not found")


def find_unmapped(
    canonical_classes: list[CanonicalClass],
    sources: list[DatasetSource],
) -> list[str]:
    """Return all source labels not covered by any canonical class alias."""
    all_aliases = {alias for cc in canonical_classes for alias in cc.aliases}
    unmapped = []
    for source in sources:
        for cls in source.classes:
            if cls not in all_aliases:
                unmapped.append(cls)
    return unmapped


def check_conflicts(canonical_classes: list[CanonicalClass]) -> dict[str, list[int]]:
    """Return {alias: [canonical_ids]} for aliases that appear in more than one class."""
    alias_counts: dict[str, list[int]] = {}
    for cc in canonical_classes:
        for alias in cc.aliases:
            alias_counts.setdefault(alias, []).append(cc.id)
    return {a: ids for a, ids in alias_counts.items() if len(ids) > 1}
