"""Add sound-direction-azimuth-from/to (±30° from single azimuth) where missing."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIRS = [ROOT / "webapp" / "public" / "data", ROOT / "data" / "03_ready"]


def mod360(x: float) -> int:
    return int(((x % 360) + 360) % 360)


def migrate_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    data = json.loads(text)
    changed = False
    for feat in data.get("features", []):
        props = feat.get("properties") or {}
        if "sound-direction-azimuth" not in props:
            continue
        if "sound-direction-azimuth-from" in props and "sound-direction-azimuth-to" in props:
            continue
        try:
            az = float(props["sound-direction-azimuth"])
        except (TypeError, ValueError):
            continue
        props["sound-direction-azimuth-from"] = mod360(az - 30)
        props["sound-direction-azimuth-to"] = mod360(az + 30)
        feat["properties"] = props
        changed = True
    if not changed:
        return False
    indent = 4 if "\n    " in text else 2
    path.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")
    return True


def main() -> None:
    paths = []
    for d in DATA_DIRS:
        if d.is_dir():
            paths.extend(sorted(d.glob("map*.json")))
            paths.extend(sorted(d.glob("map*.geojson")))
    n = sum(migrate_file(p) for p in paths)
    print(f"Updated {n} file(s) in {len(paths)} candidate map file(s)")


if __name__ == "__main__":
    main()
