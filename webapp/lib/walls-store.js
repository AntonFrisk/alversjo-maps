import { put, list, del } from '@vercel/blob';
import { unstable_cache, revalidateTag } from 'next/cache';

// All walls live in a single public Blob holding a GeoJSON FeatureCollection of
// LineString features. Vercel Blob is optimized for immutable content — overwriting
// a fixed pathname serves stale data from the CDN — so each write creates a NEW
// uniquely-named blob (immutable URL, always fresh), reads pick the newest, and old
// versions are pruned. This keeps read-after-write correct.
const WALLS_PREFIX = 'walls/data';
const WALLS_TAG = 'walls-store';

const EMPTY = { type: 'FeatureCollection', features: [] };

function slugify(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'wall';
}

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

// Auth options for the Blob SDK: use the read-write token when present (local dev),
// otherwise let the SDK fall back to OIDC (auto-injected on Vercel). Passing the token
// explicitly avoids the SDK preferring an OIDC token that isn't valid for local dev.
function blobOpts(extra = {}) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { ...extra, token } : extra;
}

// All walls blobs, newest first.
async function listWallBlobs() {
  const { blobs } = await list(blobOpts({ prefix: WALLS_PREFIX }));
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

// Uncached read — used inside read-modify-write to avoid seeing our own stale cache.
async function readWallsFresh() {
  if (!blobConfigured()) return { ...EMPTY, features: [] };
  const blobs = await listWallBlobs();
  if (!blobs.length) return { ...EMPTY, features: [] };
  const res = await fetch(blobs[0].url, { cache: 'no-store' }); // unique URL => always fresh
  if (!res.ok) return { ...EMPTY, features: [] };
  const data = await res.json();
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) return { ...EMPTY, features: [] };
  return data;
}

// Public read is cached and only invalidated via revalidateTag on writes. This is the
// main lever for reducing Vercel Blob "advanced actions" (list) — cache hits do zero
// blob calls. Fallback revalidate keeps cache from growing unbounded on rare writes.
const cachedReadWalls = unstable_cache(readWallsFresh, ['walls-store-read'], {
  tags: [WALLS_TAG],
  revalidate: 3600,
});

export async function readWalls() {
  return cachedReadWalls();
}

async function writeWalls(collection, staleBlobs) {
  // Reuse the list() from the RMW read when available; only list again if caller didn't
  // provide it (e.g. writeWalls called outside a create/update/delete flow).
  const stale = staleBlobs ?? (await listWallBlobs());
  await put(`${WALLS_PREFIX}.json`, JSON.stringify(collection), blobOpts({
    access: 'public',
    addRandomSuffix: true, // unique, immutable URL — no CDN staleness
    contentType: 'application/json',
  }));
  // Prune previous versions (best-effort; newest-wins keeps reads correct regardless).
  if (stale.length) {
    await Promise.all(stale.map((b) => del(b.url, blobOpts()).catch(() => {})));
  }
  revalidateTag(WALLS_TAG);
  return collection;
}

// RMW helper: single list() + fetch() shared between the read and the write's prune step.
async function readWallsForWrite() {
  if (!blobConfigured()) return { collection: { ...EMPTY, features: [] }, blobs: [] };
  const blobs = await listWallBlobs();
  if (!blobs.length) return { collection: { ...EMPTY, features: [] }, blobs };
  const res = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!res.ok) return { collection: { ...EMPTY, features: [] }, blobs };
  const data = await res.json();
  const collection = (data && data.type === 'FeatureCollection' && Array.isArray(data.features))
    ? data : { ...EMPTY, features: [] };
  return { collection, blobs };
}

// Read-modify-write helpers. Low volume + open editing => last-write-wins is acceptable.

export async function createWall({ builder, camp, notes, name, coordinates }, now) {
  const { collection, blobs } = await readWallsForWrite();
  const campSlug = slugify(camp);
  const count = collection.features.filter(
    (f) => slugify(f.properties?.camp) === campSlug
  ).length;
  const feature = {
    type: 'Feature',
    id: crypto.randomUUID(),
    properties: {
      name: (name && String(name).trim()) || `${campSlug}-${count + 1}`,
      builder: String(builder || '').trim(),
      camp: String(camp || '').trim(),
      notes: String(notes || ''),
      createdAt: now,
      updatedAt: now,
    },
    geometry: { type: 'LineString', coordinates },
  };
  collection.features.push(feature);
  await writeWalls(collection, blobs);
  return feature;
}

export async function updateWall(id, patch, now) {
  const { collection, blobs } = await readWallsForWrite();
  const feature = collection.features.find((f) => f.id === id);
  if (!feature) return null;
  if (patch.name !== undefined) feature.properties.name = String(patch.name);
  if (patch.notes !== undefined) feature.properties.notes = String(patch.notes);
  if (Array.isArray(patch.coordinates)) feature.geometry.coordinates = patch.coordinates;
  feature.properties.updatedAt = now;
  await writeWalls(collection, blobs);
  return feature;
}

export async function deleteWall(id) {
  const { collection, blobs } = await readWallsForWrite();
  const before = collection.features.length;
  collection.features = collection.features.filter((f) => f.id !== id);
  if (collection.features.length === before) return false;
  await writeWalls(collection, blobs);
  return true;
}
