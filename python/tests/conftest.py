import json
from pathlib import Path
import pytest

DATA_DIR = Path(__file__).parents[2] / "webapp" / "public" / "data"

MAP_FILES = {
    "map2": DATA_DIR / "map2.json",
    # "map1": DATA_DIR / "map1.json",
    # "map4": DATA_DIR / "map4.json",
    # "map5": DATA_DIR / "map5.json",
    # "map6": DATA_DIR / "map6.json",
}


@pytest.fixture(params=list(MAP_FILES.keys()))
def map_features(request):
    map_name = request.param
    with open(MAP_FILES[map_name], encoding="utf-8") as f:
        data = json.load(f)
    return map_name, data["features"]
