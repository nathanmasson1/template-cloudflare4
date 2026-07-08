/**
 * Utilitarios server-side para APIs dos plugins.
 *
 * Em Cloudflare, posts em src/content/blog/*.md e dados em src/data/*.json
 * sao persistidos no D1. Uploads em public/uploads/* vao para R2. Em dev
 * local, o filesystem continua sendo usado para facilitar edicao e testes.
 */

import { readStaticData, readStaticDataText } from '../lib/staticData';
import {
  deletePostFromD1,
  deleteSiteDataFromD1,
  deleteUploadFromR2,
  getMediaBucket,
  getPostsDb,
  isBlogPostPath,
  isSiteDataPath,
  isUploadPath,
  postExistsInD1,
  putUploadInR2,
  readPostMarkdownFromD1,
  readSiteDataTextFromD1,
  upsertPostMarkdownToD1,
  upsertSiteDataTextToD1,
} from '../lib/cloudflareContent';

function isLocalDev() {
  return Boolean(import.meta.env.DEV);
}

async function localProjectRoot() {
  const nodePath = await import('node:path');
  return nodePath.resolve((globalThis as any).process?.cwd?.() || '.');
}

async function writeLocalFile(filePath: string, content: string | Uint8Array) {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const absPath = nodePath.resolve(await localProjectRoot(), filePath);
  fs.mkdirSync(nodePath.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
}

async function readLocalFile(filePath: string) {
  try {
    const fs = await import('node:fs');
    const nodePath = await import('node:path');
    return fs.readFileSync(nodePath.resolve(await localProjectRoot(), filePath), 'utf-8');
  } catch {
    return null;
  }
}

async function deleteLocalFile(filePath: string) {
  try {
    const fs = await import('node:fs');
    const nodePath = await import('node:path');
    fs.unlinkSync(nodePath.resolve(await localProjectRoot(), filePath));
  } catch {
    // idempotent delete
  }
}

export function readPluginsConfig(): any {
  return readStaticData('pluginsConfig.json', {});
}

export async function readPluginsConfigAsync(): Promise<any> {
  const raw = await readContentFile('src/data/pluginsConfig.json');
  if (!raw) return readPluginsConfig();
  try {
    return JSON.parse(raw);
  } catch {
    return readPluginsConfig();
  }
}

export function readDataFile<T = any>(filename: string, fallback: T = {} as T): T {
  return readStaticData(filename, fallback);
}

export async function readDataFileAsync<T = any>(filename: string, fallback: T = {} as T): Promise<T> {
  const raw = await readContentFile(`src/data/${filename.replace(/^src\/data\//, '')}`);
  if (!raw) return readStaticData(filename, fallback);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return readStaticData(filename, fallback);
  }
}

export async function writeContentFile(
  filePath: string,
  content: string,
  options: { message?: string } = {},
): Promise<boolean> {
  const db = getPostsDb();
  if (db && isBlogPostPath(filePath)) {
    await upsertPostMarkdownToD1(db, filePath, content, options.message || `CMS: ${filePath}`);
    return true;
  }

  if (db && isSiteDataPath(filePath)) {
    await upsertSiteDataTextToD1(db, filePath, content);
    return true;
  }

  const bucket = getMediaBucket();
  if (bucket && isUploadPath(filePath)) {
    await putUploadInR2(bucket, filePath, content, false);
    return true;
  }

  if (isLocalDev()) {
    await writeLocalFile(filePath, content);
    return true;
  }

  return false;
}

export async function writeBinaryContentFile(
  filePath: string,
  base64Content: string,
  options: { message?: string } = {},
): Promise<boolean> {
  void options;

  const bucket = getMediaBucket();
  if (bucket && isUploadPath(filePath)) {
    await putUploadInR2(bucket, filePath, base64Content, true);
    return true;
  }

  if (isLocalDev()) {
    await writeLocalFile(filePath, Buffer.from(base64Content, 'base64'));
    return true;
  }

  return false;
}

export async function readContentFile(filePath: string): Promise<string | null> {
  const db = getPostsDb();
  if (db && isBlogPostPath(filePath)) {
    const result = await readPostMarkdownFromD1(db, filePath);
    return result?.content || null;
  }

  if (db && isSiteDataPath(filePath)) {
    const result = await readSiteDataTextFromD1(db, filePath);
    if (result) return result.content;
    const content = readStaticDataText(filePath);
    if (content !== null) return content;
  }

  if (isLocalDev()) {
    const local = await readLocalFile(filePath);
    if (local !== null) return local;
  }

  if (filePath.startsWith('src/data/')) {
    const content = readStaticDataText(filePath);
    if (content !== null) return content;
  }

  return null;
}

export async function deleteContentFile(
  filePath: string,
  options: { message?: string } = {},
): Promise<boolean> {
  const db = getPostsDb();
  if (db && isBlogPostPath(filePath)) {
    await deletePostFromD1(db, filePath, options.message || `CMS: delete ${filePath}`);
    return true;
  }

  if (db && isSiteDataPath(filePath)) {
    await deleteSiteDataFromD1(db, filePath);
    return true;
  }

  const bucket = getMediaBucket();
  if (bucket && isUploadPath(filePath)) {
    await deleteUploadFromR2(bucket, filePath);
    return true;
  }

  if (isLocalDev()) {
    await deleteLocalFile(filePath);
    return true;
  }

  return false;
}

export async function contentFileExists(filePath: string): Promise<boolean> {
  const db = getPostsDb();
  if (db && isBlogPostPath(filePath)) return postExistsInD1(db, filePath);
  const content = await readContentFile(filePath);
  return content !== null;
}
