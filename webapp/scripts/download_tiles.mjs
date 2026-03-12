/**
 * Download MapTiler satellite tiles for a fixed bounding box and save them
 * as static assets under  public/tiles/satellite/{z}/{x}/{y}.jpg
 *
 * Run once (or whenever you want to refresh imagery):
 *     node scripts/download_tiles.mjs
 */

import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Configuration ─────────────────────────────────────────────────────────────
const API_KEY = 'ggrNEhS6ufFFsGzNwRzy';

// Alversjö centre
const CENTER_LON = 14.923;
const CENTER_LAT = 57.620;

// Padding in degrees (~0.012° ≈ 1 km at this latitude)
const PAD_LON = 0.012;
const PAD_LAT = 0.008;

const ZOOM_MIN = 13;
const ZOOM_MAX = 17;

const TILE_URL = (z, x, y) =>
  `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${API_KEY}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'tiles', 'satellite');

// ── Helpers ───────────────────────────────────────────────────────────────────

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * (1 << zoom));
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const n = 1 << zoom;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const bboxWest = CENTER_LON - PAD_LON;
  const bboxEast = CENTER_LON + PAD_LON;
  const bboxSouth = CENTER_LAT - PAD_LAT;
  const bboxNorth = CENTER_LAT + PAD_LAT;

  let total = 0;
  let downloaded = 0;

  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
    const xMin = lonToTileX(bboxWest, z);
    const xMax = lonToTileX(bboxEast, z);
    const yMin = latToTileY(bboxNorth, z); // y is inverted
    const yMax = latToTileY(bboxSouth, z);

    const count = (xMax - xMin + 1) * (yMax - yMin + 1);
    console.log(`Zoom ${z}: tiles x=[${xMin}..${xMax}]  y=[${yMin}..${yMax}]  (${count} tiles)`);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        total++;
        const dest = path.join(OUT_DIR, String(z), String(x), `${y}.jpg`);
        if (fs.existsSync(dest)) {
          downloaded++;
          continue; // already cached
        }
        try {
          await downloadFile(TILE_URL(z, x, y), dest);
          downloaded++;
          process.stdout.write('.');
          await sleep(50); // gentle rate-limit
        } catch (err) {
          console.error(`\n  ✗ ${z}/${x}/${y}  –  ${err.message}`);
        }
      }
    }
    console.log();
  }

  console.log(`\nDone — ${downloaded}/${total} tiles saved to ${OUT_DIR}`);
}

main();
