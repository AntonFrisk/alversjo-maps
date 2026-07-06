import { put, list, del } from '@vercel/blob';

// Generic Blob-backed JSON document using the same immutable-write pattern as the
// walls store (write a uniquely-named blob, read the newest, prune old ones) so
// read-after-write is always fresh despite Vercel Blob's CDN caching.

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

function blobOpts(extra = {}) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { ...extra, token } : extra;
}

export async function readJson(prefix, fallback) {
  if (!blobConfigured()) return fallback;
  const { blobs } = await list(blobOpts({ prefix }));
  if (!blobs.length) return fallback;
  const newest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const res = await fetch(newest.url, { cache: 'no-store' });
  if (!res.ok) return fallback;
  try { return await res.json(); } catch { return fallback; }
}

export async function writeJson(prefix, data) {
  const { blobs } = await list(blobOpts({ prefix }));
  await put(`${prefix}.json`, JSON.stringify(data), blobOpts({
    access: 'public', addRandomSuffix: true, contentType: 'application/json',
  }));
  await Promise.all(blobs.map((b) => del(b.url, blobOpts()).catch(() => {})));
  return data;
}
