import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { unstable_cache, revalidateTag } from 'next/cache';

// JSON documents stored as fixed-key objects in an S3-compatible bucket (currently
// Impossible Cloud). S3 has strong read-after-write consistency, so a plain overwrite
// is always fresh. Reads are wrapped in unstable_cache (tag per key) and writes call
// revalidateTag, so repeated reads don't hit the bucket.

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;

export function s3Configured() {
  return Boolean(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);
}

const client = s3Configured()
  ? new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION || 'eu-central-2',
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    })
  : null;

const tagFor = (key) => `s3-json:${key}`;

// Uncached read — use inside read-modify-write flows.
export async function readJsonFresh(key, fallback) {
  if (!client) return fallback;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return JSON.parse(await res.Body.transformToString());
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return fallback;
    throw err;
  }
}

const cachedReaders = new Map();
export async function readJson(key, fallback) {
  if (!cachedReaders.has(key)) {
    cachedReaders.set(key, unstable_cache(readJsonFresh, ['s3-json-read', key], {
      tags: [tagFor(key)], revalidate: 3600,
    }));
  }
  return cachedReaders.get(key)(key, fallback);
}

export async function writeJson(key, data) {
  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET, Key: key, Body: JSON.stringify(data), ContentType: 'application/json',
  }));
  revalidateTag(tagFor(key));
  return data;
}
