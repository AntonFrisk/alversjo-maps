import { NextResponse } from 'next/server';
import { listCommits } from '@/lib/github';

export async function GET(request) {
  const map = new URL(request.url).searchParams.get('map');
  if (!map) return NextResponse.json({ error: 'map is required' }, { status: 400 });
  try {
    return NextResponse.json(await listCommits(map));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
