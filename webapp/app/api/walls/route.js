import { NextResponse } from 'next/server';
import { readWalls, createWall, updateWall, deleteWall, blobConfigured } from '@/lib/walls-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function storeGuard() {
  if (!blobConfigured()) {
    return NextResponse.json(
      { error: 'Wall storage is not configured. Enable a Vercel Blob store (BLOB_READ_WRITE_TOKEN).' },
      { status: 503 },
    );
  }
  return null;
}

function validCoords(coords) {
  return (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    coords.every(
      (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
    )
  );
}

export async function GET() {
  try {
    const collection = await readWalls();
    return NextResponse.json(collection);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = storeGuard();
  if (guard) return guard;
  try {
    const body = await request.json();
    const { builder, camp, notes, name, coordinates } = body || {};
    if (!builder?.trim() || !camp?.trim()) {
      return NextResponse.json({ error: 'builder and camp are required' }, { status: 400 });
    }
    if (!validCoords(coordinates)) {
      return NextResponse.json({ error: 'coordinates must be >= 2 [lng, lat] pairs' }, { status: 400 });
    }
    const feature = await createWall({ builder, camp, notes, name, coordinates }, new Date().toISOString());
    return NextResponse.json(feature, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request) {
  const guard = storeGuard();
  if (guard) return guard;
  try {
    const body = await request.json();
    const { id, name, notes, coordinates } = body || {};
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (coordinates !== undefined && !validCoords(coordinates)) {
      return NextResponse.json({ error: 'coordinates must be >= 2 [lng, lat] pairs' }, { status: 400 });
    }
    const feature = await updateWall(id, { name, notes, coordinates }, new Date().toISOString());
    if (!feature) return NextResponse.json({ error: 'wall not found' }, { status: 404 });
    return NextResponse.json(feature);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const guard = storeGuard();
  if (guard) return guard;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const ok = await deleteWall(id);
    if (!ok) return NextResponse.json({ error: 'wall not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
