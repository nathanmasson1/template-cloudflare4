import type { APIRoute } from 'astro';
import { validateSession } from '../../../../../lib/auth';
import { loadAISettings, resolveApiKey, callAI } from '../../../../../plugins/ai-generator/ai-provider';
import { generatePostContent, insertImagesByWordCount, generateSeoOutlines, generateSeoDescription, type Outline } from '../../../../../plugins/ai-generator/generate';
import { serializePost, postPath } from '../../../../../plugins/_adapter';
import { writeContentFile, contentFileExists } from '../../../../../plugins/_server';

export const prerender = false;

const MAX_TOKENS_SECTION = 2048;

interface BulkPostInput {
    id: string;
    title: string;
    slug: string;
}

interface PendingPost {
    id: string;
    title: string;
    slug: string;
    content: string;
}

function fallbackOutlines(title: string): Outline[] {
    return [
        { level: 'h2', text: `O que saber sobre ${title}`, minWords: 220 },
        { level: 'h2', text: 'Principais cuidados e orientacoes', minWords: 260 },
        { level: 'h2', text: 'Passo a passo para aplicar no dia a dia', minWords: 260 },
        { level: 'h2', text: 'Perguntas frequentes', minWords: 240 },
    ];
}

async function resolveAvailableSlug(baseSlug: string, reserved: Set<string>): Promise<string> {
    const cleanBase = baseSlug.trim() || 'post';
    for (let attempt = 1; attempt <= 50; attempt++) {
        const candidate = attempt === 1 ? cleanBase : `${cleanBase}-${attempt}`;
        if (reserved.has(candidate)) continue;
        const exists = await contentFileExists(postPath(candidate));
        if (!exists) {
            reserved.add(candidate);
            return candidate;
        }
    }
    throw new Error(`Nao foi possivel encontrar slug disponivel para ${cleanBase}`);
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const cookieHeader = request.headers.get('cookie') || '';
        const cookies = Object.fromEntries(
            cookieHeader.split(';').map(c => { const [k, ...v] = c.trim().split('='); return [k, decodeURIComponent(v.join('='))]; })
        );
        if (!await validateSession(cookies['admin_session'])) {
            return new Response(JSON.stringify({ error: 'Nao autorizado' }), { status: 401 });
        }

        const body = await request.json();
        const posts = Array.isArray(body.posts) ? body.posts as BulkPostInput[] : [];
        const { author, category } = body;

        if (!posts.length) {
            return new Response(JSON.stringify({ success: false, error: 'Informe pelo menos um post.' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }
        if (!author || !category) {
            return new Response(JSON.stringify({ success: false, error: 'Autor e categoria sao obrigatorios.' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        const aiSettings = loadAISettings();
        const apiKey = resolveApiKey(aiSettings);
        const encoder = new TextEncoder();
        const send = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

        const stream = new ReadableStream({
            async start(controller) {
                const pending: PendingPost[] = [];
                const reservedSlugs = new Set<string>();
                let success = 0;
                let failed = 0;

                const emit = (data: object) => {
                    try {
                        controller.enqueue(encoder.encode(send(data)));
                    } catch { /* client may have reloaded after final writes */ }
                };

                try {
                    emit({ step: 'progress', message: `Preparando ${posts.length} post(s)...` });

                    for (let index = 0; index < posts.length; index++) {
                        const item = posts[index];
                        const title = item.title?.trim();
                        const id = item.id || `${index}`;

                        if (!title) {
                            failed++;
                            emit({ step: 'row-error', id, error: 'Titulo vazio.' });
                            continue;
                        }

                        try {
                            const slug = await resolveAvailableSlug(item.slug || title, reservedSlugs);
                            emit({ step: 'row-start', id, slug, message: `Gerando ${index + 1}/${posts.length}: ${title}` });

                            let description = title.length > 160 ? title.substring(0, 157) + '...' : title;
                            let outlines: Outline[] = [];
                            let content: string;

                            if (apiKey) {
                                const callAIFn = (prompt: string) =>
                                    callAI(prompt, aiSettings, apiKey, { maxTokens: MAX_TOKENS_SECTION });
                                outlines = await generateSeoOutlines(title, callAIFn, msg => emit({ step: 'row-progress', id, message: msg }));
                                description = await generateSeoDescription(title, callAIFn);
                                content = await generatePostContent(
                                    title,
                                    outlines,
                                    'informational',
                                    undefined,
                                    callAIFn,
                                    msg => emit({ step: 'row-progress', id, message: msg })
                                );
                            } else {
                                outlines = fallbackOutlines(title);
                                content = await generatePostContent(
                                    title,
                                    outlines,
                                    'informational',
                                    undefined,
                                    async () => { throw new Error('No API Key'); },
                                    msg => emit({ step: 'row-progress', id, message: msg })
                                );
                            }

                            let image = '';
                            if (aiSettings.pexelsApiKey?.trim()) {
                                emit({ step: 'row-progress', id, message: 'Inserindo imagens do Pexels...' });
                                try {
                                    let searchQuery = title;
                                    if (apiKey) {
                                        try {
                                            const translated = await callAI(
                                                `Traduza para ingles APENAS o texto abaixo. Responda somente com a traducao, sem aspas nem explicacoes.\n\n${title}`,
                                                aiSettings,
                                                apiKey,
                                                { maxTokens: 64 }
                                            );
                                            if (translated?.trim().length > 2) searchQuery = translated.trim();
                                        } catch { /* use title */ }
                                    }
                                    const result = await insertImagesByWordCount(content, title, aiSettings.pexelsApiKey.trim(), searchQuery);
                                    content = result.content;
                                    image = result.thumbnailUrl || '';
                                } catch { /* continue without images */ }
                            }

                            pending.push({
                                id,
                                title,
                                slug,
                                content: serializePost({
                                    title,
                                    slug,
                                    description,
                                    content,
                                    image,
                                    category,
                                    author,
                                    pubDate: new Date().toISOString().split('T')[0],
                                    draft: false,
                                }),
                            });

                            emit({ step: 'row-ready', id, slug, message: 'Conteudo pronto para salvar.' });
                        } catch (err: any) {
                            failed++;
                            emit({ step: 'row-error', id, error: err.message || 'Erro ao gerar post.' });
                        }
                    }

                    emit({ step: 'progress', message: 'Salvando arquivos gerados...' });

                    for (const item of pending) {
                        try {
                            const ok = await writeContentFile(postPath(item.slug), item.content, {
                                message: `CMS: Criacao do artigo ${item.slug} (IA em massa)`,
                            });
                            if (!ok) throw new Error('Erro ao salvar arquivo.');
                            success++;
                            emit({ step: 'row-done', id: item.id, slug: item.slug, title: item.title });
                        } catch (err: any) {
                            failed++;
                            emit({ step: 'row-error', id: item.id, error: err.message || 'Erro ao salvar post.' });
                        }
                    }

                    emit({ step: 'done', success: true, generated: success, failed });
                } catch (err: any) {
                    emit({ step: 'error', error: err.message || 'Erro desconhecido.' });
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message || 'Erro desconhecido' }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
        });
    }
};
