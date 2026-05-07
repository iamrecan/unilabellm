from __future__ import annotations

from dataclasses import dataclass, field

from core.harmonizer.mapper import check_conflicts, find_unmapped
from core.models import CanonicalClass, DatasetSource


@dataclass
class ValidationResult:
    valid: bool
    unmapped: list[str] = field(default_factory=list)
    conflicts: dict[str, list[int]] = field(default_factory=dict)
    empty_classes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> str:
        parts = []
        if self.unmapped:
            parts.append(f"{len(self.unmapped)} unmapped label(s): {', '.join(self.unmapped[:5])}")
        if self.conflicts:
            parts.append(f"{len(self.conflicts)} conflict(s)")
        if self.empty_classes:
            parts.append(f"{len(self.empty_classes)} empty canonical class(es)")
        if not parts:
            return "Validation passed."
        return "; ".join(parts)


def validate(
    canonical_classes: list[CanonicalClass],
    sources: list[DatasetSource],
) -> ValidationResult:
    unmapped = find_unmapped(canonical_classes, sources)
    conflicts = check_conflicts(canonical_classes)
    empty_classes = [cc.name for cc in canonical_classes if not cc.aliases]
    warnings = []

    if unmapped:
        warnings.append(
            f"Labels not assigned to any canonical class: {', '.join(unmapped)}. "
            "Choose: ignore / merge into existing / create new class."
        )
    if conflicts:
        for alias, ids in conflicts.items():
            warnings.append(f"Alias '{alias}' is assigned to multiple classes (ids: {ids})")
    if empty_classes:
        warnings.append(f"Canonical classes with no aliases: {', '.join(empty_classes)}")

    # Unmapped labels are just warnings — user may have intentionally deleted garbage classes.
    # Only conflicts (same alias in two classes) are hard errors.
    valid = not conflicts
    return ValidationResult(
        valid=valid,
        unmapped=unmapped,
        conflicts=conflicts,
        empty_classes=empty_classes,
        warnings=warnings,
    )
