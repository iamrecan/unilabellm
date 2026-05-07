from __future__ import annotations

from pydantic import BaseModel


class NewSessionRequest(BaseModel):
    source_paths: list[str]
    source_names: list[str] | None = None
    domain_hint: str | None = None


class UpdateClassesRequest(BaseModel):
    canonical_classes: list[dict]


class ExportRequest(BaseModel):
    output_path: str
    split_ratio: tuple[float, float, float] = (0.7, 0.2, 0.1)
    seed: int = 42


class AddSourceRequest(BaseModel):
    source_paths: list[str]
    source_names: list[str] | None = None


class ErrorResponse(BaseModel):
    detail: str
