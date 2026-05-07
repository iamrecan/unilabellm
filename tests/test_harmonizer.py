import pytest

from core.harmonizer.mapper import (
    ConflictError,
    add_alias,
    add_canonical_class,
    build_canonical_classes,
    check_conflicts,
    find_unmapped,
    remove_alias,
    remove_canonical_class,
    rename_canonical_class,
)
from core.harmonizer.session import (
    create_session,
    delete_session,
    list_sessions,
    load_session,
    save_session,
)
from core.harmonizer.validator import validate
from core.llm.analyzer import LLMAnalysisResult
from core.models import DatasetSource


@pytest.fixture
def sample_sources():
    return [
        DatasetSource(name="ds1", path="/ds1", classes=["car", "truck", "person"]),
        DatasetSource(name="ds2", path="/ds2", classes=["automobile", "pedestrian"]),
    ]


@pytest.fixture
def mock_analysis():
    return LLMAnalysisResult({
        "canonical_classes": [
            {"name": "car", "aliases": ["car", "automobile"], "confidence": 0.97, "reasoning": "synonyms"},
            {"name": "truck", "aliases": ["truck"], "confidence": 1.0, "reasoning": "unique"},
            {"name": "person", "aliases": ["person", "pedestrian"], "confidence": 0.95, "reasoning": "same"},
        ],
        "unmapped": [],
    })


@pytest.fixture
def canonical_classes(mock_analysis, sample_sources):
    return build_canonical_classes(mock_analysis, sample_sources)


# --- Mapper tests ---

def test_build_canonical_classes_count(canonical_classes):
    assert len(canonical_classes) == 3


def test_build_source_map(canonical_classes):
    car_cls = next(c for c in canonical_classes if c.name == "car")
    assert "ds1" in car_cls.source_map
    assert "ds2" in car_cls.source_map


def test_add_alias(canonical_classes):
    updated = add_alias(canonical_classes, 0, "vehicle")
    assert "vehicle" in updated[0].aliases


def test_add_alias_conflict(canonical_classes):
    with pytest.raises(ConflictError):
        add_alias(canonical_classes, 1, "car")  # "car" is already in class id=0


def test_add_alias_duplicate_ok(canonical_classes):
    # Adding an alias that already exists in the same class should be a no-op
    add_alias(canonical_classes, 0, "car")
    assert canonical_classes[0].aliases.count("car") == 1


def test_remove_alias(canonical_classes):
    remove_alias(canonical_classes, 0, "automobile")
    assert "automobile" not in canonical_classes[0].aliases


def test_remove_alias_not_found(canonical_classes):
    with pytest.raises(ValueError):
        remove_alias(canonical_classes, 0, "nonexistent")


def test_add_canonical_class(canonical_classes):
    updated = add_canonical_class(canonical_classes, "motorcycle", ["moto", "bike"])
    names = [c.name for c in updated]
    assert "motorcycle" in names


def test_remove_canonical_class(canonical_classes):
    updated, freed = remove_canonical_class(canonical_classes, 1)
    assert all(c.id != 1 for c in updated)
    assert "truck" in freed


def test_rename_canonical_class(canonical_classes):
    rename_canonical_class(canonical_classes, 0, "vehicle-car")
    assert canonical_classes[0].name == "vehicle-car"


def test_find_unmapped_all_mapped(canonical_classes, sample_sources):
    unmapped = find_unmapped(canonical_classes, sample_sources)
    assert unmapped == []


def test_find_unmapped_missing(canonical_classes, sample_sources):
    sample_sources[0].classes.append("bicycle")
    unmapped = find_unmapped(canonical_classes, sample_sources)
    assert "bicycle" in unmapped


def test_check_conflicts_none(canonical_classes):
    assert check_conflicts(canonical_classes) == {}


def test_check_conflicts_detected(canonical_classes):
    canonical_classes[1].aliases.append("car")  # conflict with class 0
    conflicts = check_conflicts(canonical_classes)
    assert "car" in conflicts


# --- Session tests ---

def test_create_session(sample_sources):
    s = create_session(sample_sources)
    assert s.status == "pending"
    assert len(s.sources) == 2


def test_save_and_load_session(sample_sources, tmp_path):
    s = create_session(sample_sources)
    save_session(s, sessions_dir=tmp_path)
    loaded = load_session(s.id, sessions_dir=tmp_path)
    assert loaded.id == s.id
    assert loaded.status == "pending"


def test_load_session_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_session("nonexistent", sessions_dir=tmp_path)


def test_list_sessions(sample_sources, tmp_path):
    s1 = create_session(sample_sources)
    s2 = create_session(sample_sources)
    save_session(s1, sessions_dir=tmp_path)
    save_session(s2, sessions_dir=tmp_path)
    sessions = list_sessions(sessions_dir=tmp_path)
    assert len(sessions) == 2


def test_list_sessions_empty(tmp_path):
    assert list_sessions(sessions_dir=tmp_path) == []


def test_delete_session(sample_sources, tmp_path):
    s = create_session(sample_sources)
    save_session(s, sessions_dir=tmp_path)
    delete_session(s.id, sessions_dir=tmp_path)
    assert not (tmp_path / f"{s.id}.json").exists()


def test_session_transition():
    from core.models import HarmonizationSession
    s = HarmonizationSession(sources=[])
    s.transition("reviewing")
    assert s.status == "reviewing"
    with pytest.raises(ValueError):
        s.transition("exported")  # invalid from reviewing


# --- Validator tests ---

def test_validate_all_good(canonical_classes, sample_sources):
    result = validate(canonical_classes, sample_sources)
    assert result.valid
    assert result.unmapped == []
    assert result.conflicts == {}


def test_validate_unmapped(canonical_classes, sample_sources):
    sample_sources[0].classes.append("drone")
    result = validate(canonical_classes, sample_sources)
    assert not result.valid
    assert "drone" in result.unmapped
    assert len(result.warnings) > 0


def test_validate_conflict(canonical_classes, sample_sources):
    canonical_classes[1].aliases.append("car")
    result = validate(canonical_classes, sample_sources)
    assert not result.valid
    assert "car" in result.conflicts
