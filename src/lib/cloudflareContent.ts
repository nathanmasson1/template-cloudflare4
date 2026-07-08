import { env as workerEnv } from 'cloudflare:workers';
import { base64ToBytes } from './encoding';

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export type D1PostRow = {
  id?: number;
  slug: string;
  title: string;
  description: string;
  content: string;
  category: string;
  author: string;
  image: string;
  image_alt: string;
  pub_date: string;
  updated_date?: string | null;
  scheduled_at?: string | null;
  published_at?: string | null;
  status: PostStatus;
  draft: number;
  meta_json: string;
  created_at?: string;
  updated_at: string;
};

export type D1SiteDataRow = {
  key: string;
  content: string;
  updated_at: string;
};

export type PublicPost = {
  id: string;
  data: {
    title: string;
    description: string;
    pubDate: Date;
    updatedDate?: Date;
    image?: string;
    imageAlt?: string;
    category: string;
    tags: string[];
    draft: boolean;
    scheduledAt?: Date;
    rating?: number;
    badge?: 'top-pick' | 'best-value' | 'editor-choice';
    priceRange?: string;
    conclusion?: string;
    faqs: Array<{ q: string; a: string }>;
    author: string;
    showToc: boolean;
    showDisclosure: boolean;
  };
  content: string;
  source: 'd1';
};

type ParsedPost = {
  slug: string;
  title: string;
  description: string;
  content: string;
  category: string;
  author: string;
  image: string;
  imageAlt: string;
  pubDate: string;
  updatedDate: string | null;
  scheduledAt: string | null;
  status: PostStatus;
  draft: boolean;
  meta: Record<string, any>;
};

const BLOG_PATH_RE = /^src\/content\/blog\/([^/]+)\.md$/;
const UPLOAD_PATH_RE = /^public\/uploads\/(.+)$/;
const DATA_PATH_RE = /^src\/data\/([^/]+\.json)$/;
const DATA_KEY_RE = /^[^/]+\.json$/;
let siteDataTableReady: Promise<void> | null = null;

export function getCloudflareEnv(overrides?: any) {
  return overrides || workerEnv || {};
}

export function getPostsDb(overrides?: any) {
  return getCloudflareEnv(overrides).POSTS_DB;
}

export function getMediaBucket(overrides?: any) {
  return getCloudflareEnv(overrides).MEDIA_BUCKET;
}

export function normalizeRepoPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function isBlogDirectory(path: string) {
  return normalizeRepoPath(path).replace(/\/+$/, '') === 'src/content/blog';
}

export function isBlogPostPath(path: string) {
  return BLOG_PATH_RE.test(normalizeRepoPath(path));
}

export function slugFromPostPath(path: string) {
  return normalizeRepoPath(path).match(BLOG_PATH_RE)?.[1] || '';
}

export function postPath(slug: string) {
  return `src/content/blog/${slug}.md`;
}

export function isUploadPath(path: string) {
  return UPLOAD_PATH_RE.test(normalizeRepoPath(path));
}

export function isSiteDataPath(path: string) {
  return DATA_PATH_RE.test(normalizeRepoPath(path));
}

export function siteDataKeyFromPath(pathOrFilename: string) {
  const normalized = normalizeRepoPath(pathOrFilename);
  const match = normalized.match(DATA_PATH_RE);
  const key = match?.[1] || normalized.replace(/^src\/data\//, '');
  return DATA_KEY_RE.test(key) ? key : '';
}

export function r2KeyFromUploadPath(path: string) {
  const normalized = normalizeRepoPath(path);
  const uploadMatch = normalized.match(UPLOAD_PATH_RE);
  if (uploadMatch) return `uploads/${uploadMatch[1]}`;
  return normalized.replace(/^\/+/, '');
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractFrontmatterValue(frontmatter: string, key: string) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\n\\r]+))`, 'm'));
  return match ? (match[1] || match[2] || match[3] || '').trim() : '';
}

function extractYamlList(frontmatter: string, key: string) {
  const inline = extractFrontmatterValue(frontmatter, key);
  if (inline && inline !== '[]') {
    if (inline.startsWith('[')) {
      return inline
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    return [inline.replace(/^["']|["']$/g, '')].filter(Boolean);
  }

  const block = frontmatter.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s*.*\\n?)+)`, 'm'))?.[1] || '';
  return block
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s+-\s*/, '').trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function toIsoOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStatus(status: string, draft: boolean, scheduledAt: string | null): PostStatus {
  const raw = status.toLowerCase().trim();
  if (raw === 'archived') return 'archived';
  if (raw === 'published') return 'published';
  if (raw === 'scheduled') return 'scheduled';
  if (scheduledAt) return 'scheduled';
  return draft ? 'draft' : 'published';
}

function yamlString(value: string) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function contentTypeFromKey(key: string) {
  const ext = key.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    avif: 'image/avif',
    gif: 'image/gif',
    ico: 'image/x-icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  };
  return types[ext || ''] || 'application/octet-stream';
}

async function ensureSiteDataTable(db: any) {
  if (!siteDataTableReady) {
    siteDataTableReady = db.prepare(`
      CREATE TABLE IF NOT EXISTS site_data (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `).run().then(() => undefined).catch((error: any) => {
      siteDataTableReady = null;
      throw error;
    });
  }
  return siteDataTableReady;
}

export function parseMarkdownPost(markdown: string, fallbackSlug: string): ParsedPost {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const frontmatter = match ? match[1] : '';
  const content = match ? match[2] : markdown;
  const slug = slugify(fallbackSlug);
  const draft = extractFrontmatterValue(frontmatter, 'draft').toLowerCase() === 'true';
  const scheduledAt = toIsoOrNull(extractFrontmatterValue(frontmatter, 'scheduledAt'));
  const status = normalizeStatus(extractFrontmatterValue(frontmatter, 'status'), draft, scheduledAt);
  const pubDate = toIsoOrNull(extractFrontmatterValue(frontmatter, 'pubDate')) || new Date().toISOString();
  const updatedDate = toIsoOrNull(extractFrontmatterValue(frontmatter, 'updatedDate'));

  const meta: Record<string, any> = {
    tags: extractYamlList(frontmatter, 'tags'),
    rating: Number(extractFrontmatterValue(frontmatter, 'rating')) || undefined,
    badge: extractFrontmatterValue(frontmatter, 'badge') || undefined,
    priceRange: extractFrontmatterValue(frontmatter, 'priceRange') || undefined,
    conclusion: extractFrontmatterValue(frontmatter, 'conclusion') || undefined,
    faqs: [],
    showToc: extractFrontmatterValue(frontmatter, 'showToc').toLowerCase() !== 'false',
    showDisclosure: extractFrontmatterValue(frontmatter, 'showDisclosure').toLowerCase() !== 'false',
  };

  return {
    slug,
    title: extractFrontmatterValue(frontmatter, 'title') || fallbackSlug,
    description: extractFrontmatterValue(frontmatter, 'description') || '',
    content,
    category: extractFrontmatterValue(frontmatter, 'category') || 'divulgacao',
    author: extractFrontmatterValue(frontmatter, 'author') || 'Redacao',
    image: extractFrontmatterValue(frontmatter, 'image') || '',
    imageAlt: extractFrontmatterValue(frontmatter, 'imageAlt') || '',
    pubDate,
    updatedDate,
    scheduledAt,
    status,
    draft: status === 'scheduled' ? true : draft,
    meta: Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)),
  };
}

export function markdownFromPostRow(row: D1PostRow) {
  const meta = safeJson(row.meta_json, {});
  const tags = Array.isArray(meta.tags) && meta.tags.length
    ? `\n${meta.tags.map((tag: string) => `  - ${yamlString(tag)}`).join('\n')}`
    : ' []';
  const scheduledLine = row.scheduled_at ? `scheduledAt: ${yamlString(row.scheduled_at)}\n` : '';
  const updatedLine = row.updated_date ? `updatedDate: ${yamlString(row.updated_date)}\n` : '';
  const imageAltLine = row.image_alt ? `imageAlt: ${yamlString(row.image_alt)}\n` : '';

  return `---\ntitle: ${yamlString(row.title)}\ndescription: ${yamlString(row.description)}\npubDate: ${yamlString(row.pub_date)}\n${updatedLine}image: ${yamlString(row.image || '')}\n${imageAltLine}category: ${yamlString(row.category)}\nauthor: ${yamlString(row.author)}\ntags:${tags}\ndraft: ${Boolean(row.draft)}\n${scheduledLine}status: ${yamlString(row.status)}\n---\n${row.content || ''}`;
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function rowToPublicPost(row: D1PostRow): PublicPost {
  const meta = safeJson<Record<string, any>>(row.meta_json, {});
  const pubDate = new Date(row.pub_date || row.created_at || Date.now());
  const updatedDate = row.updated_date ? new Date(row.updated_date) : undefined;
  const scheduledAt = row.scheduled_at ? new Date(row.scheduled_at) : undefined;

  return {
    id: row.slug,
    source: 'd1',
    content: row.content || '',
    data: {
      title: row.title,
      description: row.description || '',
      pubDate,
      updatedDate,
      image: row.image || undefined,
      imageAlt: row.image_alt || undefined,
      category: row.category || 'divulgacao',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      draft: Boolean(row.draft),
      scheduledAt,
      rating: typeof meta.rating === 'number' ? meta.rating : undefined,
      badge: meta.badge,
      priceRange: meta.priceRange,
      conclusion: meta.conclusion,
      faqs: Array.isArray(meta.faqs) ? meta.faqs : [],
      author: row.author || 'Redacao',
      showToc: meta.showToc !== false,
      showDisclosure: meta.showDisclosure !== false,
    },
  };
}

export async function listPostEntriesFromD1(db: any) {
  const result = await db
    .prepare('SELECT slug, updated_at FROM posts ORDER BY datetime(pub_date) DESC, datetime(updated_at) DESC')
    .all();
  return (result.results || []).map((row: any) => ({
    name: `${row.slug}.md`,
    path: postPath(row.slug),
    sha: `d1-${row.updated_at || row.slug}`,
    type: 'file',
  }));
}

export async function readPostMarkdownFromD1(db: any, path: string) {
  const slug = slugFromPostPath(path);
  if (!slug) return null;
  const row = await db.prepare('SELECT * FROM posts WHERE slug = ?').bind(slug).first() as D1PostRow | null;
  if (!row) return null;
  return {
    content: markdownFromPostRow(row),
    sha: `d1-${row.updated_at || row.slug}`,
  };
}

export async function readSiteDataTextFromD1(db: any, pathOrFilename: string) {
  const key = siteDataKeyFromPath(pathOrFilename);
  if (!key) return null;
  await ensureSiteDataTable(db);
  const row = await db
    .prepare('SELECT key, content, updated_at FROM site_data WHERE key = ?')
    .bind(key)
    .first() as D1SiteDataRow | null;
  if (!row) return null;
  return {
    content: row.content,
    sha: `d1data-${row.updated_at || row.key}`,
  };
}

export async function readSiteDataJsonFromD1<T = any>(db: any, pathOrFilename: string): Promise<T | null> {
  const result = await readSiteDataTextFromD1(db, pathOrFilename);
  if (!result) return null;
  return safeJson<T>(result.content, null as T);
}

export async function upsertSiteDataTextToD1(db: any, pathOrFilename: string, content: string) {
  const key = siteDataKeyFromPath(pathOrFilename);
  if (!key) throw new Error('Caminho de dados invalido.');
  JSON.parse(content);
  await ensureSiteDataTable(db);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO site_data (key, content, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at
  `).bind(key, content, now).run();
  return { success: true, sha: `d1data-${now}` };
}

export async function deleteSiteDataFromD1(db: any, pathOrFilename: string) {
  const key = siteDataKeyFromPath(pathOrFilename);
  if (!key) throw new Error('Caminho de dados invalido.');
  await ensureSiteDataTable(db);
  await db.prepare('DELETE FROM site_data WHERE key = ?').bind(key).run();
  return { success: true };
}

export async function upsertPostMarkdownToD1(db: any, path: string, markdown: string, message = 'CMS update') {
  const slug = slugFromPostPath(path);
  if (!slug) throw new Error('Caminho de post invalido.');

  const parsed = parseMarkdownPost(markdown, slug);
  const now = new Date().toISOString();
  const old = await db.prepare('SELECT status FROM posts WHERE slug = ?').bind(parsed.slug).first() as { status: string } | null;
  const publishedAt = parsed.status === 'published' ? now : null;

  await db.prepare(`
    INSERT INTO posts (
      slug, title, description, content, category, author, image, image_alt, pub_date,
      updated_date, scheduled_at, published_at, status, draft, meta_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      content = excluded.content,
      category = excluded.category,
      author = excluded.author,
      image = excluded.image,
      image_alt = excluded.image_alt,
      pub_date = excluded.pub_date,
      updated_date = excluded.updated_date,
      scheduled_at = excluded.scheduled_at,
      published_at = CASE
        WHEN excluded.status = 'published' THEN COALESCE(posts.published_at, excluded.published_at)
        ELSE posts.published_at
      END,
      status = excluded.status,
      draft = excluded.draft,
      meta_json = excluded.meta_json,
      updated_at = excluded.updated_at
  `).bind(
    parsed.slug,
    parsed.title,
    parsed.description,
    parsed.content,
    parsed.category,
    parsed.author,
    parsed.image,
    parsed.imageAlt,
    parsed.pubDate,
    parsed.updatedDate,
    parsed.scheduledAt,
    publishedAt,
    parsed.status,
    parsed.draft ? 1 : 0,
    JSON.stringify(parsed.meta),
    now,
    now,
  ).run();

  if (!old || old.status !== parsed.status) {
    await db.prepare(`
      INSERT INTO post_status_events (post_slug, from_status, to_status, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(parsed.slug, old?.status || null, parsed.status, message, now).run();
  }

  if (parsed.status === 'scheduled' && parsed.scheduledAt) {
    await db.prepare(`
      INSERT INTO scheduled_jobs (post_slug, job_type, run_at, status, attempts, created_at, updated_at)
      VALUES (?, 'publish_post', ?, 'pending', 0, ?, ?)
      ON CONFLICT(post_slug, job_type) DO UPDATE SET
        run_at = excluded.run_at,
        status = 'pending',
        last_error = NULL,
        updated_at = excluded.updated_at
    `).bind(parsed.slug, parsed.scheduledAt, now, now).run();
  } else {
    await db.prepare(`
      UPDATE scheduled_jobs
      SET status = 'cancelled', updated_at = ?
      WHERE post_slug = ? AND job_type = 'publish_post' AND status = 'pending'
    `).bind(now, parsed.slug).run();
  }

  return { success: true, sha: `d1-${now}`, slug: parsed.slug, status: parsed.status };
}

export async function deletePostFromD1(db: any, pathOrSlug: string, message = 'CMS delete') {
  const slug = isBlogPostPath(pathOrSlug) ? slugFromPostPath(pathOrSlug) : slugify(pathOrSlug);
  if (!slug) throw new Error('Slug invalido.');
  const now = new Date().toISOString();
  const old = await db.prepare('SELECT status FROM posts WHERE slug = ?').bind(slug).first() as { status: string } | null;
  await db.prepare('DELETE FROM scheduled_jobs WHERE post_slug = ?').bind(slug).run();
  await db.prepare('DELETE FROM posts WHERE slug = ?').bind(slug).run();
  await db.prepare(`
    INSERT INTO post_status_events (post_slug, from_status, to_status, message, created_at)
    VALUES (?, ?, 'archived', ?, ?)
  `).bind(slug, old?.status || null, message, now).run();
  return { success: true };
}

export async function postExistsInD1(db: any, path: string) {
  const slug = slugFromPostPath(path);
  if (!slug) return false;
  const row = await db.prepare('SELECT slug FROM posts WHERE slug = ?').bind(slug).first();
  return Boolean(row);
}

export async function getPublishedPostsFromD1(db: any, options: { category?: string; limit?: number; offset?: number } = {}) {
  const now = new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit || 100, 5000));
  const offset = Math.max(0, options.offset || 0);
  const params: any[] = [now, limit, offset];
  let where = `
    status = 'published'
    AND draft = 0
    AND (scheduled_at IS NULL OR scheduled_at = '' OR scheduled_at <= ?)
  `;
  if (options.category) {
    where += ' AND category = ?';
    params.splice(1, 0, options.category);
  }
  const result = await db.prepare(`
    SELECT * FROM posts
    WHERE ${where}
    ORDER BY datetime(pub_date) DESC, datetime(updated_at) DESC
    LIMIT ?
    OFFSET ?
  `).bind(...params).all();
  return ((result.results || []) as D1PostRow[]).map(rowToPublicPost);
}

export async function getPublishedPostFromD1(db: any, slug: string) {
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT * FROM posts
    WHERE slug = ?
      AND status = 'published'
      AND draft = 0
      AND (scheduled_at IS NULL OR scheduled_at = '' OR scheduled_at <= ?)
    LIMIT 1
  `).bind(slug, now).first() as D1PostRow | null;
  return row ? rowToPublicPost(row) : null;
}

export async function publishDueScheduledPosts(
  db: any,
  options: { now?: string; limit?: number; source?: string } = {},
) {
  const now = options.now || new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit || 50, 200));
  const result = await db.prepare(`
    SELECT slug
    FROM posts
    WHERE status = 'scheduled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ?
    ORDER BY datetime(scheduled_at) ASC
    LIMIT ?
  `).bind(now, limit).all();

  const due = (result.results || []) as Array<{ slug: string }>;
  const published: string[] = [];

  for (const row of due) {
    await db.prepare(`
      UPDATE scheduled_jobs
      SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE post_slug = ? AND job_type = 'publish_post'
    `).bind(now, row.slug).run();

    await db.prepare(`
      UPDATE posts
      SET status = 'published',
          draft = 0,
          pub_date = COALESCE(NULLIF(pub_date, ''), ?),
          published_at = COALESCE(published_at, ?),
          updated_at = ?
      WHERE slug = ? AND status = 'scheduled'
    `).bind(now, now, now, row.slug).run();

    await db.prepare(`
      UPDATE scheduled_jobs
      SET status = 'done', updated_at = ?
      WHERE post_slug = ? AND job_type = 'publish_post'
    `).bind(now, row.slug).run();

    await db.prepare(`
      INSERT INTO post_status_events (post_slug, from_status, to_status, message, created_at)
      VALUES (?, 'scheduled', 'published', ?, ?)
    `).bind(row.slug, options.source || 'cron', now).run();

    published.push(row.slug);
  }

  return {
    success: true,
    checked: due.length,
    published: published.length,
    publishedSlugs: published,
    now,
  };
}

export async function putUploadInR2(bucket: any, path: string, content: string | Uint8Array | ArrayBuffer, isBase64 = false) {
  const key = r2KeyFromUploadPath(path);
  const value = isBase64 && typeof content === 'string' ? base64ToBytes(content) : content;
  await bucket.put(key, value, {
    httpMetadata: {
      contentType: contentTypeFromKey(key),
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  return {
    success: true,
    key,
    url: `/${key}`,
    sha: `r2-${key}`,
  };
}

export async function deleteUploadFromR2(bucket: any, path: string) {
  const key = r2KeyFromUploadPath(path);
  await bucket.delete(key);
  return { success: true };
}
