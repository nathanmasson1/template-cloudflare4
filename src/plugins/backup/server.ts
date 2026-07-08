import { readStaticDataText, listStaticDataFilenames } from '../../lib/staticData';
import {
  getMediaBucket,
  getPostsDb,
  markdownFromPostRow,
  putUploadInR2,
  r2KeyFromUploadPath,
  type D1PostRow,
} from '../../lib/cloudflareContent';
import { readContentFile, writeContentFile } from '../_server';
import { createStoredZipResponse, parseStoredZip, type ZipSourceEntry } from './zip-store';

const POSTS_PER_PART = 1000;
const POST_PART_BYTES = 50 * 1024 * 1024;
const UPLOAD_PART_BYTES = 50 * 1024 * 1024;
const MAX_RESTORE_BYTES = 75 * 1024 * 1024;
const BACKUP_VERSION = 1;

type BackupKind = 'config' | 'posts' | 'uploads';

interface FileInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt?: Date;
}

interface BackupPart {
  id: string;
  kind: BackupKind;
  part: number;
  label: string;
  fileName: string;
  href: string;
  count: number;
  bytes: number;
}

function isLocalDev() {
  return Boolean(import.meta.env.DEV);
}

function jsonText(value: any) {
  return JSON.stringify(value, null, 2);
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function projectRoot() {
  const nodePath = await import('node:path');
  return nodePath.resolve((globalThis as any).process?.cwd?.() || '.');
}

async function pathExists(path: string) {
  try {
    const fs = await import('node:fs/promises');
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function walkLocalFiles(relativeDir: string): Promise<FileInfo[]> {
  if (!isLocalDev()) return [];
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const root = await projectRoot();
  const base = nodePath.join(root, relativeDir);
  if (!(await pathExists(base))) return [];

  async function walk(absDir: string): Promise<FileInfo[]> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    const files: FileInfo[] = [];
    for (const entry of entries) {
      const absPath = nodePath.join(absDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(absPath));
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(absPath);
      const relPath = nodePath.relative(root, absPath).replace(/\\/g, '/');
      files.push({
        name: entry.name,
        path: relPath,
        size: stat.size,
        modifiedAt: stat.mtime,
      });
    }
    return files;
  }

  return (await walk(base)).sort((a, b) => a.path.localeCompare(b.path));
}

async function readLocalBinary(path: string) {
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const root = await projectRoot();
  return fs.readFile(nodePath.join(root, path));
}

async function writeLocalBinary(path: string, bytes: Uint8Array) {
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const root = await projectRoot();
  const absPath = nodePath.join(root, path);
  await fs.mkdir(nodePath.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, bytes);
}

function bytesLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function safeName(name: string) {
  const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error(`Nome inválido no backup: ${name}`);
  }
  return normalized;
}

function fileDownloadName(kind: BackupKind, part: number) {
  return `backup-${kind}-${String(part).padStart(4, '0')}-${backupStamp()}.zip`;
}

async function listConfigFiles(): Promise<FileInfo[]> {
  if (isLocalDev()) {
    return (await walkLocalFiles('src/data')).filter((file) => file.path.endsWith('.json'));
  }

  const names = new Set(listStaticDataFilenames());
  const db = getPostsDb();
  if (db) {
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS site_data (
          key TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `).run();
      const result = await db.prepare('SELECT key, length(content) AS size, updated_at FROM site_data ORDER BY key').all();
      for (const row of result.results || []) {
        if (typeof row.key === 'string' && row.key.endsWith('.json')) names.add(row.key);
      }
    } catch {
      // Site data table may not exist yet. Static config is still enough for a first backup.
    }
  }

  const files: FileInfo[] = [];
  for (const name of [...names].sort()) {
    const path = `src/data/${name}`;
    const content = await readContentFile(path) || readStaticDataText(name) || '';
    files.push({ name, path, size: bytesLength(content) });
  }
  return files;
}

async function listPostFiles(): Promise<FileInfo[]> {
  if (isLocalDev()) {
    return (await walkLocalFiles('src/content/blog')).filter((file) => file.path.endsWith('.md'));
  }

  const db = getPostsDb();
  if (!db) return [];
  const result = await db.prepare(`
    SELECT slug, length(content) AS size, updated_at
    FROM posts
    ORDER BY datetime(pub_date) DESC, datetime(updated_at) DESC, slug ASC
  `).all();

  return (result.results || []).map((row: any) => ({
    name: `${row.slug}.md`,
    path: `src/content/blog/${row.slug}.md`,
    size: Number(row.size || 0) + 1024,
    modifiedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  }));
}

async function listUploadFiles(): Promise<FileInfo[]> {
  if (isLocalDev()) {
    return await walkLocalFiles('public/uploads');
  }

  const bucket = getMediaBucket();
  if (!bucket) return [];
  const files: FileInfo[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: 'uploads/', cursor, limit: 1000 });
    for (const object of listed.objects || []) {
      if (!object.key || object.key.endsWith('/')) continue;
      files.push({
        name: object.key.replace(/^uploads\//, ''),
        path: `public/${object.key}`,
        size: Number(object.size || 0),
        modifiedAt: object.uploaded ? new Date(object.uploaded) : undefined,
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function chunkPosts(files: FileInfo[]) {
  const chunks: FileInfo[][] = [];
  let current: FileInfo[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const wouldExceedCount = current.length >= POSTS_PER_PART;
    const wouldExceedBytes = current.length > 0 && currentBytes + file.size > POST_PART_BYTES;
    if (wouldExceedCount || wouldExceedBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function chunkUploads(files: FileInfo[], maxBytes: number) {
  const chunks: FileInfo[][] = [];
  let current: FileInfo[] = [];
  let currentBytes = 0;

  for (const file of files) {
    if (current.length && currentBytes + file.size > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
    if (file.size >= maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function partBytes(files: FileInfo[]) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function partHref(kind: BackupKind, part: number) {
  return `/api/admin/plugins/backup/download?kind=${kind}&part=${part}`;
}

export async function buildBackupManifest() {
  const [configFiles, postFiles, uploadFiles] = await Promise.all([
    listConfigFiles(),
    listPostFiles(),
    listUploadFiles(),
  ]);

  const parts: BackupPart[] = [];
  parts.push({
    id: 'config-1',
    kind: 'config',
    part: 1,
    label: 'Configurações do site',
    fileName: fileDownloadName('config', 1),
    href: partHref('config', 1),
    count: configFiles.length,
    bytes: partBytes(configFiles),
  });

  chunkPosts(postFiles).forEach((files, index) => {
    const part = index + 1;
    parts.push({
      id: `posts-${part}`,
      kind: 'posts',
      part,
      label: `Posts ${part}`,
      fileName: fileDownloadName('posts', part),
      href: partHref('posts', part),
      count: files.length,
      bytes: partBytes(files),
    });
  });

  chunkUploads(uploadFiles, UPLOAD_PART_BYTES).forEach((files, index) => {
    const part = index + 1;
    parts.push({
      id: `uploads-${part}`,
      kind: 'uploads',
      part,
      label: `Imagens ${part}`,
      fileName: fileDownloadName('uploads', part),
      href: partHref('uploads', part),
      count: files.length,
      bytes: partBytes(files),
    });
  });

  return {
    version: BACKUP_VERSION,
    generatedAt: new Date().toISOString(),
    environment: isLocalDev() ? 'local' : 'cloudflare',
    limits: {
      postsPerPart: POSTS_PER_PART,
      postPartBytes: POST_PART_BYTES,
      uploadPartBytes: UPLOAD_PART_BYTES,
      maxRestoreBytes: MAX_RESTORE_BYTES,
    },
    totals: {
      configFiles: configFiles.length,
      posts: postFiles.length,
      uploads: uploadFiles.length,
      uploadBytes: partBytes(uploadFiles),
    },
    parts,
  };
}

async function manifestEntry(kind: BackupKind, part: number): Promise<ZipSourceEntry> {
  const manifest = await buildBackupManifest();
  return {
    path: 'manifest.json',
    open: () => jsonText({
      ...manifest,
      currentPart: { kind, part },
    }),
  };
}

async function configZipEntries() {
  const files = await listConfigFiles();
  const entries: ZipSourceEntry[] = [await manifestEntry('config', 1)];
  for (const file of files) {
    entries.push({
      path: `data/${file.name}`,
      modifiedAt: file.modifiedAt,
      open: async () => await readContentFile(file.path) || readStaticDataText(file.name) || '{}',
    });
  }
  return entries;
}

async function localPostEntries(part: number) {
  const files = chunkPosts(await listPostFiles())[part - 1] || [];
  const entries: ZipSourceEntry[] = [await manifestEntry('posts', part)];
  for (const file of files) {
    entries.push({
      path: `posts/${file.name}`,
      modifiedAt: file.modifiedAt,
      open: async () => await readContentFile(file.path) || '',
    });
  }
  return entries;
}

async function d1PostEntries(part: number) {
  const db = getPostsDb();
  if (!db) return [];
  const files = chunkPosts(await listPostFiles())[part - 1] || [];
  const slugs = files.map((file) => file.name.replace(/\.md$/, ''));
  if (!slugs.length) return [await manifestEntry('posts', part)];
  const placeholders = slugs.map(() => '?').join(', ');
  const result = await db.prepare(`
    SELECT *
    FROM posts
    WHERE slug IN (${placeholders})
  `).bind(...slugs).all();
  const rowsBySlug = new Map(((result.results || []) as D1PostRow[]).map((row) => [row.slug, row]));

  const entries: ZipSourceEntry[] = [await manifestEntry('posts', part)];
  for (const file of files) {
    const row = rowsBySlug.get(file.name.replace(/\.md$/, ''));
    if (!row) continue;
    entries.push({
      path: `posts/${row.slug}.md`,
      modifiedAt: row.updated_at ? new Date(row.updated_at) : undefined,
      open: () => markdownFromPostRow(row),
    });
  }
  return entries;
}

async function postZipEntries(part: number) {
  return isLocalDev() ? localPostEntries(part) : d1PostEntries(part);
}

async function uploadZipEntries(part: number) {
  const chunks = chunkUploads(await listUploadFiles(), UPLOAD_PART_BYTES);
  const files = chunks[part - 1] || [];
  const entries: ZipSourceEntry[] = [await manifestEntry('uploads', part)];
  const bucket = getMediaBucket();

  for (const file of files) {
    const zipPath = file.path.replace(/^public\/uploads\//, 'uploads/');
    entries.push({
      path: zipPath,
      modifiedAt: file.modifiedAt,
      open: async () => {
        if (isLocalDev()) return await readLocalBinary(file.path);
        if (!bucket) return null;
        const object = await bucket.get(r2KeyFromUploadPath(file.path));
        return object?.body || null;
      },
    });
  }

  return entries;
}

export async function downloadBackupPart(kind: BackupKind, part: number) {
  if (!Number.isInteger(part) || part < 1) throw new Error('Parte inválida.');

  let entries: ZipSourceEntry[];
  if (kind === 'config') entries = await configZipEntries();
  else if (kind === 'posts') entries = await postZipEntries(part);
  else if (kind === 'uploads') entries = await uploadZipEntries(part);
  else throw new Error('Tipo de backup inválido.');

  return createStoredZipResponse(entries, fileDownloadName(kind, part));
}

function ensureSimpleName(value: string, label: string) {
  const name = safeName(value);
  if (name.includes('/')) throw new Error(`${label} deve estar na raiz da pasta do backup.`);
  return name;
}

function entryTarget(path: string) {
  const safePath = safeName(path);
  if (safePath === 'manifest.json') return null;
  if (safePath.startsWith('data/') && safePath.endsWith('.json')) {
    return { kind: 'config' as const, path: `src/data/${ensureSimpleName(safePath.slice(5), 'Config')}` };
  }
  if (safePath.startsWith('posts/') && safePath.endsWith('.md')) {
    return { kind: 'post' as const, path: `src/content/blog/${ensureSimpleName(safePath.slice(6), 'Post')}` };
  }
  if (safePath.startsWith('uploads/')) {
    const uploadName = safeName(safePath.slice(8));
    return { kind: 'upload' as const, path: `public/uploads/${uploadName}` };
  }
  throw new Error(`Entrada não reconhecida no backup: ${safePath}`);
}

async function restoreUpload(path: string, bytes: Uint8Array) {
  const bucket = getMediaBucket();
  if (bucket) {
    await putUploadInR2(bucket, path, bytes);
    return true;
  }
  if (isLocalDev()) {
    await writeLocalBinary(path, bytes);
    return true;
  }
  return false;
}

export async function restoreBackupPart(buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_RESTORE_BYTES) {
    throw new Error(`Parte muito grande. Envie partes de até ${Math.round(MAX_RESTORE_BYTES / 1024 / 1024)} MB.`);
  }

  const entries = parseStoredZip(buffer);
  const decoder = new TextDecoder();
  const counts = { config: 0, posts: 0, uploads: 0, skipped: 0 };

  for (const entry of entries) {
    const target = entryTarget(entry.path);
    if (!target) {
      counts.skipped++;
      continue;
    }

    if (target.kind === 'config') {
      const text = decoder.decode(entry.bytes);
      JSON.parse(text);
      const ok = await writeContentFile(target.path, text, { message: `Restore backup: ${target.path}` });
      if (!ok) throw new Error(`Não foi possível restaurar ${target.path}.`);
      counts.config++;
      continue;
    }

    if (target.kind === 'post') {
      const ok = await writeContentFile(target.path, decoder.decode(entry.bytes), {
        message: `Restore backup: ${target.path}`,
      });
      if (!ok) throw new Error(`Não foi possível restaurar ${target.path}.`);
      counts.posts++;
      continue;
    }

    const ok = await restoreUpload(target.path, entry.bytes);
    if (!ok) throw new Error(`Não foi possível restaurar ${target.path}.`);
    counts.uploads++;
  }

  return {
    success: true,
    restored: counts,
  };
}

export const backupLimits = {
  POSTS_PER_PART,
  POST_PART_BYTES,
  UPLOAD_PART_BYTES,
  MAX_RESTORE_BYTES,
};
