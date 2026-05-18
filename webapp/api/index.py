from pathlib import Path
import json
from typing import Literal
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"
CONFIG = json.loads((DATA_DIR / "maps-config.json").read_text(encoding="utf-8"))

POINT_TYPES = {"Point", "MultiPoint"}
POLYGON_TYPES = {"Polygon", "MultiPolygon"}
KEEP = {
    "points": POINT_TYPES,
    "polygons": POLYGON_TYPES,
    "both": POINT_TYPES | POLYGON_TYPES,
}

app = FastAPI(
    title="Alversjö Maps GeoJSON API",
    docs_url="/geoapi/docs",
    redoc_url="/geoapi/redoc",
    openapi_url="/geoapi/openapi.json",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])


@app.get("/geoapi/maps")
def list_maps():
    return CONFIG


@app.get(
    "/geoapi/maps/{map_id}",
    summary="Get a map's GeoJSON features",
    description="""
Return a filtered GeoJSON FeatureCollection for the given map.

**`exclude_sound_class`** — comma-separated list of `sound-class` values to drop.
Use the sentinel `-` to exclude features where `sound-class` is missing entirely.

| Value | Excludes |
|-------|----------|
| `-` | features with no `sound-class` property |
| `none` | features where `sound-class = "none"` |
| `-,none` | both (default) |
| *(empty)* | nothing — return all features |

Note: exclusion is based on `sound-class` only; a defined `sound-class-num` does not prevent exclusion.

**Example requests:**
```
# All features, excluding those with missing or "none" sound-class (default behaviour)
GET /geoapi/maps/map1

# Points only, excluding missing and "none" sound-class
GET /geoapi/maps/map1?features=points&exclude_sound_class=-,none

# Polygons only, keeping features with missing sound-class but dropping "none"
GET /geoapi/maps/map1?features=polygons&exclude_sound_class=none

# All features with no filtering — every feature returned regardless of sound-class
GET /geoapi/maps/map1?exclude_sound_class=

# All features with missing sound-class excluded; only return name and sound-class properties
GET /geoapi/maps/map1?properties=name,sound-class&exclude_sound_class=-
```
""",
)
def get_map(
    map_id: str,
    features: Literal["points", "polygons", "both"] = "both",
    properties: str | None = Query(None, description="Comma-separated list of property keys to include. Omit to return all properties."),
    exclude_sound_class: str | None = Query("-,none", description="Comma-separated sound-class values to exclude. Use `-` as sentinel for missing. Default: `-,none`."),
):
    meta = CONFIG.get(map_id)
    if not meta:
        raise HTTPException(404, f"Unknown map '{map_id}'")

    path = DATA_DIR / f"{map_id}.{meta['ext']}"
    data = json.loads(path.read_text(encoding="utf-8"))

    keep_types = KEEP[features]
    prop_filter = None if properties is None else {p for p in properties.split(",") if p}
    excl = {v for v in exclude_sound_class.split(",") if v} if exclude_sound_class else set()

    out = []
    for f in data.get("features", []):
        if f.get("geometry", {}).get("type") not in keep_types:
            continue
        props = f.get("properties") or {}
        sc = props.get("sound-class")
        if excl and (("-" in excl and sc is None) or sc in excl):
            continue
        if prop_filter is not None:
            f = {**f, "properties": {k: v for k, v in props.items() if k in prop_filter}}
        out.append(f)

    return JSONResponse(
        {"type": "FeatureCollection", "features": out},
        media_type="application/geo+json",
    )
