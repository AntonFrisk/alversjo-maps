"""MapTiler Cloud API client for loading GeoJSON data."""

import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

MAPTILER_BASE_URL = "https://api.maptiler.com"


def _get_api_key() -> str:
    """Retrieve the MapTiler API key from environment variables."""
    key = os.environ.get("MAPTILER_API_KEY")
    if not key:
        raise ValueError(
            "MAPTILER_API_KEY environment variable is not set. "
            "Copy .env.example to .env and add your key."
        )
    return key


def _get_dataset_id() -> str:
    """Retrieve the MapTiler dataset ID from environment variables."""
    dataset_id = os.environ.get("MAPTILER_DATASET_ID")
    if not dataset_id:
        raise ValueError(
            "MAPTILER_DATASET_ID environment variable is not set. "
            "Copy .env.example to .env and add your dataset ID."
        )
    return dataset_id


def load_geojson(data_id: str | None = None) -> dict:
    """Load GeoJSON features from a MapTiler Cloud dataset.

    Fetches a GeoJSON FeatureCollection from the MapTiler Data API.
    See: https://docs.maptiler.com/cloud/api/data/

    Args:
        data_id: The dataset identifier from your MapTiler Cloud account.
                 Falls back to the MAPTILER_DATASET_ID env var if not provided.
                 Find your dataset IDs at https://cloud.maptiler.com/data/

    Returns:
        A dict representing the GeoJSON FeatureCollection.

    Raises:
        ValueError: If MAPTILER_API_KEY or MAPTILER_DATASET_ID is not set.
        httpx.HTTPStatusError: If the API returns a non-2xx response.
    """
    api_key = _get_api_key()
    data_id = data_id or _get_dataset_id()
    url = f"{MAPTILER_BASE_URL}/data/{data_id}/features.json"

    response = httpx.get(url, params={"key": api_key})
    response.raise_for_status()

    return response.json()


def save_geojson(geojson: dict, data_id: str | None = None, output_dir: Path | None = None) -> Path:
    """Save a GeoJSON dict to a file in data/01_raw/.

    Args:
        geojson: The GeoJSON dict to save.
        data_id: Used as the filename stem. Falls back to MAPTILER_DATASET_ID env var.
        output_dir: Directory to save into. Defaults to data/01_raw/ relative
                    to the project root (parent of src/).

    Returns:
        The Path where the file was saved.
    """
    data_id = data_id or _get_dataset_id()
    if output_dir is None:
        output_dir = Path(__file__).parent.parent / "data" / "01_raw"
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{data_id}.json"
    out_path.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    print(f"Saved GeoJSON to {out_path}")
    return out_path



if __name__ == "__main__":
    import json
    import sys

    dataset_id = sys.argv[1] if len(sys.argv) > 1 else None
    geojson = load_geojson(dataset_id)
    print(json.dumps(geojson, indent=2))
    save_geojson(geojson, dataset_id)
