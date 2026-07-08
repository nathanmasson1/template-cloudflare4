import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = path.join(ROOT, 'dist');
const ASSETS_IGNORE = path.join(DIST_DIR, '.assetsignore');
const REQUIRED_PATTERNS = ['_worker.js'];

async function main() {
  await fs.mkdir(DIST_DIR, { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(ASSETS_IGNORE, 'utf-8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const lines = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const pattern of REQUIRED_PATTERNS) {
    if (!lines.includes(pattern)) lines.push(pattern);
  }

  await fs.writeFile(ASSETS_IGNORE, `${lines.join('\n')}\n`, 'utf-8');
  console.log(`Prepared ${path.relative(ROOT, ASSETS_IGNORE)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
