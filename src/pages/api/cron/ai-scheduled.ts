import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { getPostsDb } from '../../../lib/cloudflareContent';
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

  try {
    const result = await processNextScheduledAIPost({ source: 'http:/api/cron/ai-scheduled', db: getPostsDb() });
    return json(result, result.success ? 200 : 500);
  } catch (err: any) {
    return json({ success: false, message: err.message || 'Erro ao processar IA agendada.' }, 500);
  }
};
