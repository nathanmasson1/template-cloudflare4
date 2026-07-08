import type { APIRoute } from 'astro';
import { restoreBackupPart } from '../../../../../plugins/backup/server';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/zip') && !contentType.includes('application/octet-stream')) {
      return new Response(JSON.stringify({ error: 'Envie o arquivo .zip como application/zip.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fileName = request.headers.get('x-backup-filename') || 'backup.zip';
    const result = await restoreBackupPart(await request.arrayBuffer());
    return new Response(JSON.stringify({ ...result, fileName }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Erro ao restaurar backup.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
