import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { getPostsDb, publishDueScheduledPosts } from '../../../lib/cloudflareContent';
import { processNextScheduledAIPost } from '../../../plugins/ai-generator/scheduled-posts';

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

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = envVar('CRON_SECRET');
  const authHeader = request.headers.get('authorization') || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ success: false, message: 'Nao autorizado.' }, 401);
  }

  const db = getPostsDb();
  if (!db) return json({ success: false, message: 'POSTS_DB nao configurado.' }, 503);

  try {
    const scheduledPosts = await publishDueScheduledPosts(db, { source: 'http:/api/cron/publish-scheduled' });
    const aiScheduledPosts = await processNextScheduledAIPost({ source: 'http:/api/cron/publish-scheduled', db });
    return json({ success: scheduledPosts.success && aiScheduledPosts.success, scheduledPosts, aiScheduledPosts });
  } catch (err: any) {
    return json({ success: false, message: err.message || 'Erro ao publicar agendados.' }, 500);
  }
};
