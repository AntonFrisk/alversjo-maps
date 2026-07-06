import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load env vars from the repo root .env files for local development.
// Next.js only reads env files from its own directory (webapp/), so this bridges the gap.
// .env.local (e.g. from `vercel env pull`) takes precedence over .env; both are loaded
// first-wins, and vars already in the environment (injected on Vercel) are never overwritten.
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.local', '.env']) {
  const path = resolve(rootDir, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
