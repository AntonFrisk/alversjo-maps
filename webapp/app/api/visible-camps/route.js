import { NextResponse } from 'next/server';
import { readJson, readJsonForWrite, writeJsonWithBlobs, blobConfigured } from '@/lib/blob-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREFIX = 'visible-camps/data';

// Persistent, shared set of non-sound camp ids that everyone should see with names.
async function readIds() {
  const data = await readJson(PREFIX, []);
  return Array.isArray(data) ? data.map(Number) : [];
}

async function readIdsForWrite() {
  const { data, blobs } = await readJsonForWrite(PREFIX, []);
  return { ids: Array.isArray(data) ? data.map(Number) : [], blobs };
}

function storeGuard() {
  if (!blobConfigured()) {
    return NextResponse.json({ error: 'Storage is not configured (BLOB_READ_WRITE_TOKEN).' }, { status: 503 });
  }
  return null;
}

export async function GET() {
  try {
    return NextResponse.json({ ids: await readIds() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = storeGuard();
  if (guard) return guard;
  try {
    const { id } = await request.json();
    const n = Number(id);
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'valid id required' }, { status: 400 });
    const { ids, blobs } = await readIdsForWrite();
    if (!ids.includes(n)) ids.push(n);
    await writeJsonWithBlobs(PREFIX, ids, blobs);
    return NextResponse.json({ ids });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const guard = storeGuard();
  if (guard) return guard;
  try {
    const n = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'valid id required' }, { status: 400 });
    const { ids: existing, blobs } = await readIdsForWrite();
    const ids = existing.filter((x) => x !== n);
    await writeJsonWithBlobs(PREFIX, ids, blobs);
    return NextResponse.json({ ids });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
