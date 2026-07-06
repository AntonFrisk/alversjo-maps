import { NextResponse } from 'next/server';

const SOURCE_URL = 'https://robnowa.runasp.net/api/v1/mapentities/';

export const runtime = 'nodejs';

// Proxy + filter the external map-entities API down to non-deleted sound-camp
// polygons, returned as a GeoJSON FeatureCollection. Proxying avoids client-side
// CORS issues; revalidate keeps it lightly cached.
export async function GET() {
  try {
    const res = await fetch(SOURCE_URL, { next: { revalidate: 300 } });
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    const entities = await res.json();

    // Each entity's `geoJson` is a JSON *string* holding a GeoJSON Feature.
    const features = (Array.isArray(entities) ? entities : [])
      .filter((e) => !e.isDeleted)
      .map((e) => { try { return { id: e.id, gj: JSON.parse(e.geoJson) }; } catch { return null; } })
      .filter((e) => e?.gj?.properties?.areaType === 'sound-camp' && e.gj.geometry)
      .map(({ id, gj }) => ({
        type: 'Feature',
        id,
        properties: { name: gj.properties.name || '', areaType: gj.properties.areaType },
        geometry: gj.geometry,
      }));

    return NextResponse.json({ type: 'FeatureCollection', features });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
