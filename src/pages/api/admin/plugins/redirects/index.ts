/**
 * API Route: /api/admin/plugins/redirects
 *
 * GET - le src/data/redirects.json
 * PUT - escreve src/data/redirects.json
 */
import type { APIRoute } from 'astro';
import { readDataFileAsync, writeContentFile } from '../../../../../plugins/_server';

export const prerender = false;

const REDIRECTS_PATH = 'src/data/redirects.json';

export const GET: APIRoute = async () => {
    try {
        const redirects = await readDataFileAsync<any[]>(REDIRECTS_PATH.split('/').pop()!, []);
        return new Response(JSON.stringify(redirects), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const ok = await writeContentFile(REDIRECTS_PATH, JSON.stringify(body, null, 2), {
            message: 'CMS: Update redirects',
        });
        if (!ok) return new Response(JSON.stringify({ error: 'Falha ao salvar' }), { status: 500 });

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400 });
    }
};
