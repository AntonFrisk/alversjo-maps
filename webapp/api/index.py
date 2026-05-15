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


@app.get("/geoapi/maps/{map_id}")
def get_map(
    map_id: str,
    features: Literal["points", "polygons", "both"] = "both",
    properties: str | None = Query(None),
):
    meta = CONFIG.get(map_id)
    if not meta:
        raise HTTPException(404, f"Unknown map '{map_id}'")

    path = DATA_DIR / f"{map_id}.{meta['ext']}"
    data = json.loads(path.read_text(encoding="utf-8"))

    keep_types = KEEP[features]
    prop_filter = None if properties is None else {p for p in properties.split(",") if p}

    out = []
    for f in data.get("features", []):
        if f.get("geometry", {}).get("type") not in keep_types:
            continue
        if prop_filter is not None:
            f = {
                **f,
                "properties": {
                    k: v for k, v in (f.get("properties") or {}).items() if k in prop_filter
                },
            }
        out.append(f)

    return JSONResponse(
        {"type": "FeatureCollection", "features": out},
        media_type="application/geo+json",
    )
