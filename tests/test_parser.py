
import pytest
import yaml

from core.parser.yolo import _find_yaml, parse_dataset


def test_parse_basic_dataset(sample_yolo_dataset):
    source = parse_dataset(sample_yolo_dataset)
    assert source.format == "yolo"
    assert source.classes == ["car", "truck", "pedestrian"]
    assert source.image_count == 6  # 3 train + 3 val
    assert source.label_count == 6


def test_parse_custom_name(sample_yolo_dataset):
    source = parse_dataset(sample_yolo_dataset, name="my_dataset")
    assert source.name == "my_dataset"


def test_parse_default_name_from_dir(sample_yolo_dataset):
    source = parse_dataset(sample_yolo_dataset)
    assert source.name == sample_yolo_dataset.name


def test_parse_empty_dataset(empty_dataset):
    source = parse_dataset(empty_dataset)
    assert source.classes == ["object"]
    assert source.image_count == 0


def test_parse_missing_path():
    with pytest.raises(FileNotFoundError):
        parse_dataset("/nonexistent/path/dataset")


def test_parse_file_instead_of_dir(tmp_path):
    f = tmp_path / "file.txt"
    f.write_text("hello")
    with pytest.raises(NotADirectoryError):
        parse_dataset(f)


def test_yaml_dict_names(tmp_path):
    data = {"nc": 2, "names": {0: "cat", 1: "dog"}}
    (tmp_path / "data.yaml").write_text(yaml.dump(data))
    source = parse_dataset(tmp_path)
    assert source.classes == ["cat", "dog"]


def test_infer_classes_from_labels(tmp_path):
    """When no YAML exists, classes are inferred from label file class IDs."""
    lbl_dir = tmp_path / "labels"
    lbl_dir.mkdir()
    (lbl_dir / "a.txt").write_text("0 0.5 0.5 0.4 0.4\n2 0.1 0.1 0.2 0.2\n")
    source = parse_dataset(tmp_path)
    assert "class_0" in source.classes
    assert "class_2" in source.classes


def test_classes_txt_fallback(tmp_path):
    (tmp_path / "classes.txt").write_text("apple\nbanana\ncherry\n")
    source = parse_dataset(tmp_path)
    assert source.classes == ["apple", "banana", "cherry"]


def test_find_yaml_variants(tmp_path):
    (tmp_path / "dataset.yml").write_text("nc: 1\nnames: [x]")
    assert _find_yaml(tmp_path) is not None


def test_path_as_string(sample_yolo_dataset):
    source = parse_dataset(str(sample_yolo_dataset))
    assert len(source.classes) == 3
