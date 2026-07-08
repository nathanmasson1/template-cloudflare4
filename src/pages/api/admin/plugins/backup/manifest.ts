import type { APIRoute } from 'astro';
import { buildBackupManifest } from '../../../../../plugins/backup/server';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    return new Response(JSON.stringify(await buildBackupManifest()), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Erro ao gerar manifesto.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
