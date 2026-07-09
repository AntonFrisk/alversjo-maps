import { put, list, del } from '@vercel/blob';
import { unstable_cache, revalidateTag } from 'next/cache';

// Generic Blob-backed JSON document using the same immutable-write pattern as the
// walls store (write a uniquely-named blob, read the newest, prune old ones) so
// read-after-write is always fresh despite Vercel Blob's CDN caching.
//
// Reads are wrapped in unstable_cache with a per-prefix tag so repeated reads do NOT
// hit Vercel Blob (avoids advanced-action `list()` calls). Writes call
// `revalidateTag` so the next read refreshes.

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

function blobOpts(extra = {}) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { ...extra, token } : extra;
}

function tagFor(prefix) {
  return `blob-json:${prefix}`;
}

async function readJsonFresh(prefix, fallback) {
  if (!blobConfigured()) return fallback;
  const { blobs } = await list(blobOpts({ prefix }));
  if (!blobs.length) return fallback;
  const newest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const res = await fetch(newest.url, { cache: 'no-store' });
  if (!res.ok) return fallback;
  try { return await res.json(); } catch { return fallback; }
}

// Cache keyed by prefix. Memoize the wrapper so tag registration is stable per prefix.
const cachedReaders = new Map();
function getCachedReader(prefix) {
  let reader = cachedReaders.get(prefix);
  if (!reader) {
    reader = unstable_cache(
      async (p, fb) => readJsonFresh(p, fb),
      ['blob-json-read', prefix],
      { tags: [tagFor(prefix)], revalidate: 3600 },
    );
    cachedReaders.set(prefix, reader);
  }
  return reader;
}

export async function readJson(prefix, fallback) {
  const reader = getCachedReader(prefix);
  return reader(prefix, fallback);
}

export async function writeJson(prefix, data) {
  // Single list() shared between read (via cache invalidation) and this prune step.
  const { blobs } = await list(blobOpts({ prefix }));
  await put(`${prefix}.json`, JSON.stringify(data), blobOpts({
    access: 'public', addRandomSuffix: true, contentType: 'application/json',
  }));
  await Promise.all(blobs.map((b) => del(b.url, blobOpts()).catch(() => {})));
  revalidateTag(tagFor(prefix));
  return data;
}

// For read-modify-write flows: returns both the parsed data AND the existing blobs so
// callers can pass the same blob list into a subsequent write, avoiding a second list().
export async function readJsonForWrite(prefix, fallback) {
  if (!blobConfigured()) return { data: fallback, blobs: [] };
  const { blobs } = await list(blobOpts({ prefix }));
  if (!blobs.length) return { data: fallback, blobs };
  const newest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const res = await fetch(newest.url, { cache: 'no-store' });
  if (!res.ok) return { data: fallback, blobs };
  try { return { data: await res.json(), blobs }; } catch { return { data: fallback, blobs }; }
}

export async function writeJsonWithBlobs(prefix, data, existingBlobs) {
  await put(`${prefix}.json`, JSON.stringify(data), blobOpts({
    access: 'public', addRandomSuffix: true, contentType: 'application/json',
  }));
  await Promise.all(existingBlobs.map((b) => del(b.url, blobOpts()).catch(() => {})));
  revalidateTag(tagFor(prefix));
  return data;
}
