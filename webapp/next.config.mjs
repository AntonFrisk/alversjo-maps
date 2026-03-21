import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load env vars from the repo root .env for local development.
// Next.js only reads env files from its own directory (webapp/), so this bridges the gap.
// On Vercel, env vars are injected directly and take precedence (existing vars are never overwritten).
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
