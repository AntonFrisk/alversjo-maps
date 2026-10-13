import { NextResponse } from 'next/server';
import { readJson, readJsonFresh, writeJson, s3Configured } from '@/lib/s3-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY = 'visible-camps.json';

// Persistent, shared set of non-sound camp ids that everyone should see with names.
const toIds = (data) => (Array.isArray(data) ? data.map(Number) : []);
const readIds = async () => toIds(await readJson(KEY, []));
const readIdsForWrite = async () => toIds(await readJsonFresh(KEY, []));

function storeGuard() {
  if (!s3Configured()) {
    return NextResponse.json({ error: 'Storage is not configured (S3_* env vars).' }, { status: 503 });
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
    const ids = await readIdsForWrite();
    if (!ids.includes(n)) ids.push(n);
    await writeJson(KEY, ids);
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
    const ids = (await readIdsForWrite()).filter((x) => x !== n);
    await writeJson(KEY, ids);
    return NextResponse.json({ ids });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
