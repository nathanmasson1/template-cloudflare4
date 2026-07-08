import type { APIRoute } from 'astro';
import { readStaticDataText } from '../../../lib/staticData';
import {
  deletePostFromD1,
  deleteSiteDataFromD1,
  deleteUploadFromR2,
  getMediaBucket,
  getPostsDb,
  isBlogDirectory,
  isBlogPostPath,
  isSiteDataPath,
  isUploadPath,
  listPostEntriesFromD1,
  normalizeRepoPath,
  putUploadInR2,
  readPostMarkdownFromD1,
  readSiteDataTextFromD1,
  upsertPostMarkdownToD1,
  upsertSiteDataTextToD1,
} from '../../../lib/cloudflareContent';

export const prerender = false;

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isLocalDev() {
  return Boolean(import.meta.env.DEV);
}

function unsupportedStorageResponse(path: string) {
  return json({
    error: `Armazenamento Cloudflare nao configurado para ${path}. Configure POSTS_DB e MEDIA_BUCKET no Worker.`,
  }, 503);
}

async function projectRoot() {
  const nodePath = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  return nodePath.resolve(fileURLToPath(import.meta.url), '../../../../../');
}

async function handleDev(action: string, path: string, content?: string, isBase64?: boolean): Promise<Response> {
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const root = await projectRoot();
  const absPath = nodePath.join(root, path);

  switch (action) {
    case 'list': {
      try {
        const files = await fs.readdir(absPath);
        const entries = files.map((name) => ({
          name,
          path: `${path}/${name}`,
          sha: `dev-${name}`,
          type: 'file',
        }));
        return json({ data: entries });
      } catch {
        return json({ error: 'Pasta nao encontrada', code: 404 }, 404);
      }
    }

    case 'read': {
      try {
        const raw = await fs.readFile(absPath, 'utf-8');
        const stat = await fs.stat(absPath);
        return json({ content: raw, sha: `dev-${stat.mtimeMs}` });
      } catch {
        return json({ error: 'Arquivo nao encontrado', code: 404 }, 404);
      }
    }

    case 'write': {
      if (content === undefined) throw new Error("Acao 'write' exige o campo 'content'.");
      await fs.mkdir(nodePath.dirname(absPath), { recursive: true });
      const data = isBase64 ? Buffer.from(content, 'base64') : content;
      await fs.writeFile(absPath, data);
      const stat = await fs.stat(absPath);
      return json({ success: true, sha: `dev-${stat.mtimeMs}` });
    }

    case 'delete': {
      try {
        await fs.unlink(absPath);
      } catch {
        // idempotent delete for local CMS.
      }
      return json({ success: true });
    }

    default:
      throw new Error('Acao invalida.');
  }
}

async function handleD1(action: string, path: string, content?: string, message?: string) {
  const db = getPostsDb();
  if (!db) return null;

  if (action === 'list' && isBlogDirectory(path)) {
    return json({ data: await listPostEntriesFromD1(db) });
  }

  if (isBlogPostPath(path)) {
    if (action === 'read') {
      const result = await readPostMarkdownFromD1(db, path);
      return result ? json(result) : json({ error: 'Post nao encontrado no D1', code: 404 }, 404);
    }

    if (action === 'write') {
      if (content === undefined) throw new Error("Acao 'write' exige o campo 'content'.");
      return json(await upsertPostMarkdownToD1(db, path, content, message || `CMS: ${path}`));
    }

    if (action === 'delete') {
      return json(await deletePostFromD1(db, path, message || `CMS: delete ${path}`));
    }
  }

  return null;
}

async function handleR2(action: string, path: string, content?: string, isBase64?: boolean) {
  const bucket = getMediaBucket();
  if (!bucket || !isUploadPath(path)) return null;

  if (action === 'write') {
    if (content === undefined) throw new Error("Acao 'write' exige o campo 'content'.");
    return json(await putUploadInR2(bucket, path, content, Boolean(isBase64)));
  }

  if (action === 'delete') {
    return json(await deleteUploadFromR2(bucket, path));
  }

  return null;
}

async function handleSiteData(action: string, path: string, content?: string) {
  const normalized = normalizeRepoPath(path);
  if (!isSiteDataPath(normalized)) return null;

  const db = getPostsDb();
  if (!db) {
    if (action === 'read') return handleStaticDataRead(action, normalized);
    return null;
  }

  if (action === 'read') {
    const result = await readSiteDataTextFromD1(db, normalized);
    if (result) return json(result);
    const staticContent = readStaticDataText(normalized);
    if (staticContent !== null) return json({ content: staticContent, sha: `static-${normalized}` });
    return json({ error: 'Arquivo de dados nao encontrado', code: 404 }, 404);
  }

  if (action === 'write') {
    if (content === undefined) throw new Error("Acao 'write' exige o campo 'content'.");
    try {
      return json(await upsertSiteDataTextToD1(db, normalized, content));
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return json({ error: `JSON invalido em ${normalized}`, code: 400 }, 400);
      }
      throw error;
    }
  }

  if (action === 'delete') {
    return json(await deleteSiteDataFromD1(db, normalized));
  }

  return null;
}

function handleStaticDataRead(action: string, path: string) {
  if (action !== 'read') return null;
  const normalized = normalizeRepoPath(path);
  if (!normalized.startsWith('src/data/')) return null;
  const content = readStaticDataText(normalized);
  if (content === null) return null;
  return json({ content, sha: `static-${normalized}` });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, content, message, isBase64 } = body;
    const path = normalizeRepoPath(body.path || '');

    if (!action || !path) {
      return json({ error: 'Faltam parametros obrigatorios (action, path)' }, 400);
    }

    const d1Response = await handleD1(action, path, content, message);
    if (d1Response) return d1Response;

    const siteDataResponse = await handleSiteData(action, path, content);
    if (siteDataResponse) return siteDataResponse;

    const r2Response = await handleR2(action, path, content, isBase64);
    if (r2Response) return r2Response;

    const staticResponse = handleStaticDataRead(action, path);
    if (staticResponse) return staticResponse;

    if (isLocalDev()) {
      return handleDev(action, path, content, isBase64);
    }

    return unsupportedStorageResponse(path);
  } catch (err: any) {
    return json({ error: err.message || 'Erro interno' }, 500);
  }
};
