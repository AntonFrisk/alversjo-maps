import { NextResponse } from 'next/server';
import { getFileAtRef } from '@/lib/github';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const map = params.get('map');
  const ref = params.get('ref');
  if (!map || !ref) return NextResponse.json({ error: 'map and ref are required' }, { status: 400 });
  try {
    const { geojson } = await getFileAtRef(map, ref);
    return NextResponse.json(geojson);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
