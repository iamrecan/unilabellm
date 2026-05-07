from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field


class DatasetSource(BaseModel):
    path: str
    name: str
    format: str = "yolo"
    classes: list[str] = Field(default_factory=list)
    image_count: int = 0
    label_count: int = 0


class CanonicalClass(BaseModel):
    id: int
    name: str
    aliases: list[str] = Field(default_factory=list)
    source_map: dict[str, list[str]] = Field(default_factory=dict)
    confidence: float = 1.0


class HarmonizationSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sources: list[DatasetSource] = Field(default_factory=list)
    canonical_classes: list[CanonicalClass] = Field(default_factory=list)
    status: str = "pending"  # pending | reviewing | confirmed | exported
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    # image_path → [{class_id, class_name, cx, cy, w, h}]
    annotation_overrides: dict[str, list[dict]] = Field(default_factory=dict)

    def transition(self, new_status: str) -> None:
        valid = {
            "pending": ["reviewing"],
            "reviewing": ["confirmed", "pending"],
            "confirmed": ["exported", "reviewing"],
            "exported": ["reviewing"],
        }
        if new_status not in valid.get(self.status, []):
            raise ValueError(f"Cannot transition from '{self.status}' to '{new_status}'")
        self.status = new_status
        self.updated_at = datetime.now(UTC)


class ExportConfig(BaseModel):
    output_path: str
    split_ratio: tuple[float, float, float] = (0.7, 0.2, 0.1)
    seed: int = 42


class ExportSummary(BaseModel):
    session_id: str
    output_path: str
    total_images: int
    split_counts: dict[str, int]
    class_counts: dict[str, int]
    duplicate_count: int = 0
