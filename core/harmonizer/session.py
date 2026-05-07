from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from core.config import settings
from core.models import CanonicalClass, DatasetSource, HarmonizationSession

logger = logging.getLogger(__name__)


def create_session(sources: list[DatasetSource]) -> HarmonizationSession:
    session = HarmonizationSession(sources=sources)
    logger.info("Created session %s with %d sources", session.id, len(sources))
    return session


def save_session(session: HarmonizationSession, sessions_dir: Path | None = None) -> Path:
    dir_ = sessions_dir or settings.sessions_path
    dir_.mkdir(parents=True, exist_ok=True)
    path = dir_ / f"{session.id}.json"
    session.updated_at = datetime.now(UTC)
    path.write_text(session.model_dump_json(indent=2))
    logger.info("Saved session %s → %s", session.id, path)
    return path


def load_session(session_id: str, sessions_dir: Path | None = None) -> HarmonizationSession:
    dir_ = sessions_dir or settings.sessions_path
    path = dir_ / f"{session_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Session not found: {session_id}")
    data = json.loads(path.read_text())
    return HarmonizationSession.model_validate(data)


def list_sessions(sessions_dir: Path | None = None) -> list[HarmonizationSession]:
    dir_ = sessions_dir or settings.sessions_path
    if not dir_.exists():
        return []
    sessions = []
    for p in sorted(dir_.glob("*.json")):
        try:
            sessions.append(HarmonizationSession.model_validate(json.loads(p.read_text())))
        except Exception as e:
            logger.warning("Could not load session file %s: %s", p, e)
    return sessions


def delete_session(session_id: str, sessions_dir: Path | None = None) -> None:
    dir_ = sessions_dir or settings.sessions_path
    path = dir_ / f"{session_id}.json"
    if path.exists():
        path.unlink()
        logger.info("Deleted session %s", session_id)


def update_canonical_classes(
    session: HarmonizationSession,
    canonical_classes: list[CanonicalClass],
) -> HarmonizationSession:
    session.canonical_classes = canonical_classes
    session.updated_at = datetime.now(UTC)
    return session
