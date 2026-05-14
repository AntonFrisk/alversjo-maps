# Alversjö Maps GeoJSON API

Public, read-only HTTP API for fetching map GeoJSON. Deployed as a Vercel Python serverless function alongside the Next.js app.

- Base path: `/geoapi`
- No authentication
- Response format: standard GeoJSON `FeatureCollection` (`Content-Type: application/geo+json`)
- CORS: `*`

## Endpoints

### `GET /geoapi/maps`

Returns the map catalog (contents of `maps-config.json`): available map IDs and their metadata (`name`, `shortName`, `description`, `ext`, `soundMode`).

### `GET /geoapi/maps/{map_id}`

Returns a GeoJSON `FeatureCollection` for the requested map, optionally filtered by geometry kind and feature properties.

#### Path parameter
| Name | Description |
|------|-------------|
| `map_id` | One of the IDs returned by `GET /geoapi/maps` (e.g. `map1`, `map2`, `map3`, `map4`, `map5`, `map6`). |

#### Query parameters
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `features` | `points` \| `polygons` \| `both` | `both` | Which geometry kinds to include. `points` keeps `Point`/`MultiPoint`; `polygons` keeps `Polygon`/`MultiPolygon`. |
| `properties` | comma-separated string | *(omit = all)* | Whitelist of feature property keys to retain. Omit the param to keep all properties. Pass an empty value (`?properties=`) to drop all properties. Unknown keys are silently ignored. |

#### Status codes
| Code | When |
|------|------|
| `200` | Success. |
| `404` | `map_id` is not in the catalog. |
| `422` | `features` is not one of `points`, `polygons`, `both`. |

## Usage examples

### 1. Polygons only, fill property only
```bash
curl "https://<your-domain>/geoapi/maps/map2?features=polygons&properties=fill"
```
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "properties": { "fill": "#ff8800" }
    }
  ]
}
```

### 2. Full GeoJSON (default, no filtering)
```bash
curl "https://<your-domain>/geoapi/maps/map2"
```

### 3. Points only, all properties
```bash
curl "https://<your-domain>/geoapi/maps/map3?features=points"
```

### 4. Both feature types, only `title` and `sound-class`
```bash
curl "https://<your-domain>/geoapi/maps/map1?properties=title,sound-class"
```

### 5. Discover available maps
```bash
curl "https://<your-domain>/geoapi/maps"
```
```json
{
  "map1": { "name": "Alversjö Evergreen Sound Makers Map", "ext": "json", "soundMode": "num", ... },
  "map2": { "name": "Borderland 2026 - Sound Makers Map", "ext": "json", "soundMode": "letter", ... },
  ...
}
```

### 6. Geometry only, no properties
```bash
curl "https://<your-domain>/geoapi/maps/map2?properties="
```
Every feature is returned with `"properties": {}`.

## Local development

From the repo root:
```bash
npx vercel dev
```
Then:
```bash
curl "http://localhost:3000/geoapi/maps"
curl "http://localhost:3000/geoapi/maps/map2?features=polygons&properties=fill"
```
