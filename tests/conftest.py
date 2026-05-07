from pathlib import Path

import pytest
import yaml


@pytest.fixture
def sample_yolo_dataset(tmp_path: Path) -> Path:
    """Create a minimal YOLO dataset for testing."""
    # data.yaml
    data = {
        "nc": 3,
        "names": ["car", "truck", "pedestrian"],
        "train": "images/train",
        "val": "images/val",
    }
    (tmp_path / "data.yaml").write_text(yaml.dump(data))

    # Images and labels
    for split in ["train", "val"]:
        img_dir = tmp_path / "images" / split
        lbl_dir = tmp_path / "labels" / split
        img_dir.mkdir(parents=True)
        lbl_dir.mkdir(parents=True)
        for i in range(3):
            # Fake PNG (1x1 white pixel)
            (img_dir / f"img{i}.jpg").write_bytes(b"\xff\xd8\xff\xd9")
            (lbl_dir / f"img{i}.txt").write_text(
                f"{i % 3} 0.5 0.5 0.4 0.4\n"
            )

    return tmp_path


@pytest.fixture
def empty_dataset(tmp_path: Path) -> Path:
    """Empty directory with just a data.yaml."""
    data = {"nc": 1, "names": ["object"]}
    (tmp_path / "data.yaml").write_text(yaml.dump(data))
    return tmp_path
