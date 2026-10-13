import { readJson, readJsonFresh, writeJson, s3Configured } from './s3-json';

// All walls live in a single S3 object holding a GeoJSON FeatureCollection of
// LineString features.
const WALLS_KEY = 'walls.json';

const valid = (d) => (d?.type === 'FeatureCollection' && Array.isArray(d.features)
  ? d : { type: 'FeatureCollection', features: [] });

function slugify(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'wall';
}

export { s3Configured };

export async function readWalls() {
  return valid(await readJson(WALLS_KEY, null));
}

// Uncached read — used inside read-modify-write to avoid seeing our own stale cache.
const readWallsForWrite = async () => valid(await readJsonFresh(WALLS_KEY, null));
const writeWalls = (collection) => writeJson(WALLS_KEY, collection);

// Read-modify-write helpers. Low volume + open editing => last-write-wins is acceptable.

export async function createWall({ builder, camp, notes, name, coordinates }, now) {
  const collection = await readWallsForWrite();
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
  await writeWalls(collection);
  return feature;
}

export async function updateWall(id, patch, now) {
  const collection = await readWallsForWrite();
  const feature = collection.features.find((f) => f.id === id);
  if (!feature) return null;
  if (patch.name !== undefined) feature.properties.name = String(patch.name);
  if (patch.notes !== undefined) feature.properties.notes = String(patch.notes);
  if (Array.isArray(patch.coordinates)) feature.geometry.coordinates = patch.coordinates;
  feature.properties.updatedAt = now;
  await writeWalls(collection);
  return feature;
}

export async function deleteWall(id) {
  const collection = await readWallsForWrite();
  const before = collection.features.length;
  collection.features = collection.features.filter((f) => f.id !== id);
  if (collection.features.length === before) return false;
  await writeWalls(collection);
  return true;
}
