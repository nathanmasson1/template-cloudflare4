/**
 * api/admin/plugins/ai/test-key.ts — Walker
 *
 * POST — Testa se uma API Key de IA está válida e funcional.
 */

import type { APIRoute } from 'astro';
import { validateSession } from '../../../../../lib/auth';
import { GEMINI_TEXT_MODELS } from '../../../../../plugins/ai-generator/ai-provider';

export const prerender = false;

async function testOpenAI(apiKey: string): Promise<{ ok: boolean; message: string }> {
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        };
        const orgId = (process.env.OPENAI_ORGANIZATION_ID || '').trim();
        const projId = (process.env.OPENAI_PROJECT_ID || '').trim();
        if (orgId) headers['OpenAI-Organization'] = orgId;
        if (projId) headers['OpenAI-Project'] = projId;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 5,
                messages: [{ role: 'user', content: 'Hi' }],
            }),
        });
        if (res.status === 200) return { ok: true,  message: 'Chave OpenAI válida! Conexão estabelecida com sucesso.' };
        const errBody = await res.text();
        let openaiMessage = errBody;
        let openaiCode = '';
        try {
            const parsed = JSON.parse(errBody);
            openaiMessage = parsed?.error?.message || errBody;
            openaiCode = parsed?.error?.code || '';
        } catch {
            openaiMessage = errBody;
        }
        if (res.status === 401) return { ok: false, message: 'Chave inválida ou expirada. Verifique na plataforma OpenAI.' };
        if (res.status === 429 && openaiCode === 'insufficient_quota') {
            return { ok: false, message: 'Chave OpenAI válida, mas sem cota/saldo disponível. Verifique billing e limites do projeto na plataforma OpenAI.' };
        }
        if (res.status === 429) return { ok: true,  message: 'Chave válida, mas limite de requisições atingido. Aguarde alguns minutos.' };
        return { ok: false, message: `OpenAI ${res.status}: ${openaiMessage.slice(0, 180)}` };
    } catch (err: any) {
        return { ok: false, message: `Erro de conexão com OpenAI: ${err.message}` };
    }
}

async function testGemini(apiKey: string): Promise<{ ok: boolean; message: string }> {
    try {
        const model = GEMINI_TEXT_MODELS[0];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Responda apenas: ok' }] }],
                generationConfig: { maxOutputTokens: 32, thinkingConfig: { thinkingBudget: 0 } },
            }),
        });
        if (res.status === 200) return { ok: true,  message: 'Chave Gemini válida! Conexão estabelecida com sucesso.' };
        if (res.status === 400) return { ok: false, message: 'Chave inválida. Verifique sua API Key no Google AI Studio.' };
        if (res.status === 403) return { ok: false, message: 'Acesso negado. A API Gemini pode não estar habilitada para esta chave.' };
        if (res.status === 429) return { ok: true,  message: 'Chave válida, mas limite de requisições atingido. Aguarde alguns minutos.' };
        return { ok: false, message: `Gemini retornou status ${res.status}. Verifique sua chave.` };
    } catch (err: any) {
        return { ok: false, message: `Erro de conexão com Gemini: ${err.message}` };
    }
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const cookieHeader = request.headers.get('cookie') || '';
        const cookies = Object.fromEntries(
            cookieHeader.split(';').map(c => { const [k, ...v] = c.trim().split('='); return [k, decodeURIComponent(v.join('='))]; })
        );
        if (!await validateSession(cookies['admin_session'])) {
            return new Response(JSON.stringify({ success: false, message: 'Não autorizado' }), {
                status: 401, headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = await request.json();
        const provider = body.provider as 'openai' | 'gemini';
        const apiKey = (body.apiKey || '').trim();

        if (!apiKey) {
            return new Response(JSON.stringify({ success: false, message: 'API Key não fornecida.' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!['openai', 'gemini'].includes(provider)) {
            return new Response(JSON.stringify({ success: false, message: 'Provedor inválido.' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        const result = provider === 'openai' ? await testOpenAI(apiKey) : await testGemini(apiKey);

        return new Response(JSON.stringify({ success: result.ok, message: result.message }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, message: error.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
        });
    }
};
