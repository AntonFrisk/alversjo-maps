import { NextResponse } from 'next/server';

const SOURCE_URL = 'https://robnowa.runasp.net/api/v1/mapentities/';

export const runtime = 'nodejs';

// All non-sound-camp polygons (art, normal-camp, public-offering, other), as a
// GeoJSON FeatureCollection. Used for the "show all camps" browse layer.
export async function GET() {
  try {
    const res = await fetch(SOURCE_URL, { next: { revalidate: 300 } });
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    const entities = await res.json();

    const features = (Array.isArray(entities) ? entities : [])
      .filter((e) => !e.isDeleted)
      .map((e) => { try { return { id: e.id, gj: JSON.parse(e.geoJson) }; } catch { return null; } })
      .filter((e) => e && e.gj?.geometry?.type === 'Polygon' && e.gj.properties?.areaType !== 'sound-camp')
      .map(({ id, gj }) => ({
        type: 'Feature',
        id,
        properties: { id, name: gj.properties.name || '', areaType: gj.properties.areaType || 'other' },
        geometry: gj.geometry,
      }));

    return NextResponse.json({ type: 'FeatureCollection', features });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
