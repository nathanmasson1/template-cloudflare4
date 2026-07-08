import type { APIRoute } from 'astro';
import { downloadBackupPart } from '../../../../../plugins/backup/server';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    const part = Number(url.searchParams.get('part') || '1');

    if (kind !== 'config' && kind !== 'posts' && kind !== 'uploads') {
      return new Response(JSON.stringify({ error: 'Tipo de backup inválido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return await downloadBackupPart(kind, part);
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Erro ao baixar backup.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
