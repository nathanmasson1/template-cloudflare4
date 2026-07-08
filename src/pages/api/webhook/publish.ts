import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { arrayBufferToBase64 } from '../../../lib/encoding';
import { readStaticData } from '../../../lib/staticData';
import { deleteContentFile, writeBinaryContentFile, writeContentFile } from '../../../plugins/_server';

export const prerender = false;

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function envVar(name: string) {
  const processEnv = (globalThis as any).process?.env || {};
  return workerEnv?.[name] || processEnv[name] || import.meta.env[name] || '';
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

function yamlString(value: string) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function firstAuthorName() {
  const authors = readStaticData<Array<{ name?: string }>>('authors.json', []);
  return authors.find((author) => author.name)?.name || 'Redacao';
}

function buildMarkdown(data: any): string {
  const { title, description, content, category, tags, image, author, scheduledAt } = data;
  const isScheduled = Boolean(scheduledAt);
  const pubDate = isScheduled ? new Date(scheduledAt).toISOString() : new Date().toISOString();
  const scheduledLine = isScheduled ? `scheduledAt: ${yamlString(new Date(scheduledAt).toISOString())}\n` : '';

  const tagsStr = Array.isArray(tags) && tags.length > 0
    ? `\n${tags.map((tag) => `  - ${yamlString(String(tag))}`).join('\n')}`
    : ' []';

  return `---\ntitle: ${yamlString(title)}\ndescription: ${yamlString(description || '')}\npubDate: ${yamlString(pubDate)}\nimage: ${yamlString(image || '')}\ncategory: ${yamlString(category || 'divulgacao')}\nauthor: ${yamlString(author || 'Redacao')}\ntags:${tagsStr}\ndraft: ${isScheduled}\n${scheduledLine}status: ${yamlString(isScheduled ? 'scheduled' : 'published')}\n---\n\n${content}\n`;
}

async function maybePersistExternalImage(data: any, slug: string) {
  if (!data.image || typeof data.image !== 'string' || !data.image.startsWith('http')) return;

  const imageRes = await fetch(data.image);
  if (!imageRes.ok) return;

  const contentType = imageRes.headers.get('content-type') || '';
  let ext = '.jpg';
  if (contentType.includes('png')) ext = '.png';
  else if (contentType.includes('webp')) ext = '.webp';
  else if (contentType.includes('gif')) ext = '.gif';
  else if (data.image.toLowerCase().endsWith('.png')) ext = '.png';
  else if (data.image.toLowerCase().endsWith('.webp')) ext = '.webp';

  const filename = `${Date.now()}-${slug}-cover${ext}`;
  const uploadPath = `public/uploads/${filename}`;
  const publicPath = `/uploads/${filename}`;
  const base64 = arrayBufferToBase64(await imageRes.arrayBuffer());
  await writeBinaryContentFile(uploadPath, base64, {
    message: `Upload image for post: ${data.title} via webhook`,
  });
  data.image = publicPath;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const webhookSecret = envVar('WEBHOOK_SECRET');
    const authHeader = request.headers.get('Authorization');

    if (!webhookSecret) return json({ error: 'Server configuration error: WEBHOOK_SECRET missing.' }, 500);
    if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
      return json({ error: 'Unauthorized. Invalid or missing token.' }, 401);
    }

    const data = await request.json();
    if (!data.title || !data.content) return json({ error: 'Missing title or content' }, 400);

    const requestedStatus = typeof data.status === 'string' ? data.status.toLowerCase().trim() : '';
    const wantsScheduled = requestedStatus === 'scheduled' || Boolean(data.scheduledAt);
    if (requestedStatus && !['published', 'scheduled'].includes(requestedStatus)) {
      return json({ error: 'Invalid status. Use "published" or "scheduled".' }, 400);
    }

    if (wantsScheduled) {
      if (!data.scheduledAt) return json({ error: 'Missing scheduledAt for scheduled post.' }, 400);
      const scheduledDate = new Date(data.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        return json({ error: 'Invalid scheduledAt. Use an ISO date, e.g. 2026-05-10T21:00:00-03:00.' }, 400);
      }
      data.scheduledAt = scheduledDate.toISOString();
    } else {
      delete data.scheduledAt;
    }

    data.author = data.author || firstAuthorName();
    const slug = slugify(data.slug || data.title);
    const filePath = `src/content/blog/${slug}.md`;

    await maybePersistExternalImage(data, slug);
    const markdownContent = buildMarkdown(data);
    const ok = await writeContentFile(filePath, markdownContent, {
      message: `${data.scheduledAt ? 'Schedule' : 'Publish'} post: ${data.title} via webhook`,
    });

    if (!ok) throw new Error('Failed to persist post.');

    return json({
      success: true,
      message: data.scheduledAt ? 'Post scheduled' : 'Post published',
      path: filePath,
      status: data.scheduledAt ? 'scheduled' : 'published',
      scheduledAt: data.scheduledAt || null,
    });
  } catch (err: any) {
    console.error('Webhook Error:', err);
    return json({ error: err.message || 'Internal Server Error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const webhookSecret = envVar('WEBHOOK_SECRET');
    const authHeader = request.headers.get('Authorization');

    if (!webhookSecret) return json({ error: 'Server configuration error' }, 500);
    if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) return json({ error: 'Unauthorized' }, 401);

    const data = await request.json();
    if (!data.slug) return json({ error: 'Missing slug' }, 400);

    const slug = slugify(data.slug);
    const ok = await deleteContentFile(`src/content/blog/${slug}.md`, {
      message: `Delete post: ${slug} via webhook`,
    });

    if (!ok) return json({ error: 'Post not found or delete failed' }, 404);
    return json({ success: true, message: 'Post deleted' });
  } catch (err: any) {
    console.error('Webhook Error:', err);
    return json({ error: err.message || 'Internal Server Error' }, 500);
  }
};
