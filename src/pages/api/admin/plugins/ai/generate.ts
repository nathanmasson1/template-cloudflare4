/**
 * api/admin/plugins/ai/generate.ts — Walker
 *
 * API route SSE para geração de posts com IA.
 * Wrapper fino que chama a lógica de geração do plugin.
 */

import type { APIRoute } from 'astro';
import { validateSession } from '../../../../../lib/auth';
import { loadAISettings, resolveApiKey, callAI } from '../../../../../plugins/ai-generator/ai-provider';
import { generatePostContent, resolveOutlines, insertImagesByWordCount, generateSeoOutlines, generateSeoDescription } from '../../../../../plugins/ai-generator/generate';
import { serializePost, postPath } from '../../../../../plugins/_adapter';
import { writeContentFile, contentFileExists } from '../../../../../plugins/_server';

export const prerender = false;

const MAX_TOKENS_SECTION = 2048;

export const POST: APIRoute = async ({ request }) => {
    try {
        // Auth
        const cookieHeader = request.headers.get('cookie') || '';
        const cookies = Object.fromEntries(
            cookieHeader.split(';').map(c => { const [k, ...v] = c.trim().split('='); return [k, decodeURIComponent(v.join('='))]; })
        );
        if (!await validateSession(cookies['admin_session'])) {
            return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });
        }

        const body = await request.json();
        const { postType = 'informational', commercialSubType, title, slug, author, category, autoOutline = false } = body;

        if (!title || !slug) {
            return new Response(JSON.stringify({ success: false, error: 'Título e slug são obrigatórios' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!author || !category) {
            return new Response(JSON.stringify({ success: false, error: 'Autor e categoria são obrigatórios' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        if (postType === 'commercial' && !['guia-melhores', 'spr'].includes(commercialSubType)) {
            return new Response(JSON.stringify({ success: false, error: 'Posts comerciais exigem sub-tipo: guia-melhores ou spr' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        const requestedOutlines = resolveOutlines(body);
        if ((!requestedOutlines || !requestedOutlines.length) && !autoOutline) {
            return new Response(JSON.stringify({
                success: false,
                error: postType === 'commercial'
                    ? 'Adicione pelo menos um produto ou uma outline'
                    : 'Adicione pelo menos uma outline',
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Verifica se slug já existe
        const exists = await contentFileExists(postPath(slug));
        if (exists) {
            return new Response(JSON.stringify({ success: false, error: 'Um post com este slug já existe' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        const aiSettings = loadAISettings();
        const apiKey = resolveApiKey(aiSettings);

        const encoder = new TextEncoder();
        const send = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    controller.enqueue(encoder.encode(send({ step: 'progress', message: 'Conectando à inteligência artificial...' })));

                    const onProgress = (msg: string) => {
                        controller.enqueue(encoder.encode(send({ step: 'progress', message: msg })));
                    };

                    let content: string;
                    let description = title.length > 160 ? title.substring(0, 157) + '...' : title;
                    let effectiveOutlines = requestedOutlines || [];

                    if (apiKey) {
                        const callAIFn = (prompt: string) =>
                            callAI(prompt, aiSettings, apiKey, { maxTokens: MAX_TOKENS_SECTION });
                        if (!effectiveOutlines.length && autoOutline) {
                            effectiveOutlines = await generateSeoOutlines(title, callAIFn, onProgress);
                        }
                        description = await generateSeoDescription(title, callAIFn);
                        content = await generatePostContent(
                            title, effectiveOutlines, postType,
                            postType === 'commercial' ? commercialSubType : undefined,
                            callAIFn, onProgress
                        );
                    } else {
                        controller.enqueue(encoder.encode(send({ step: 'progress', message: 'Nenhuma API Key configurada. Gerando placeholders...' })));
                        if (!effectiveOutlines.length && autoOutline) {
                            effectiveOutlines = [
                                { level: 'h2', text: `O que saber sobre ${title}`, minWords: 220 },
                                { level: 'h2', text: 'Principais cuidados e orientacoes', minWords: 260 },
                                { level: 'h2', text: 'Passo a passo para aplicar no dia a dia', minWords: 260 },
                                { level: 'h2', text: 'Perguntas frequentes', minWords: 240 },
                            ];
                        }
                        content = await generatePostContent(
                            title, effectiveOutlines, postType,
                            postType === 'commercial' ? commercialSubType : undefined,
                            async () => { throw new Error('No API Key'); },
                            onProgress
                        );
                    }

                    let image: string | undefined;
                    if (aiSettings.pexelsApiKey?.trim()) {
                        onProgress('🖼️ Inserindo imagens do Pexels...');
                        try {
                            let searchQuery = title;
                            if (apiKey) {
                                try {
                                    const translated = await callAI(
                                        `Traduza para inglês APENAS o texto abaixo. Responda somente com a tradução, sem aspas nem explicações.\n\n${title}`,
                                        aiSettings, apiKey, { maxTokens: 64 }
                                    );
                                    if (translated?.trim().length > 2) searchQuery = translated.trim();
                                } catch { /* use original */ }
                            }
                            const result = await insertImagesByWordCount(content, title, aiSettings.pexelsApiKey.trim(), searchQuery);
                            content = result.content;
                            image = result.thumbnailUrl;
                        } catch { /* continua sem imagens */ }
                    }

                    controller.enqueue(encoder.encode(send({ step: 'progress', message: 'Salvando o post...' })));

                    const postContent = serializePost({
                        title,
                        slug,
                        description,
                        content,
                        image: image || '',
                        category,
                        author,
                        pubDate: new Date().toISOString().split('T')[0],
                        draft: false,
                    });

                    const success = await writeContentFile(postPath(slug), postContent, {
                        message: `CMS: Criação do artigo ${slug} (IA)`,
                    });

                    if (!success) {
                        controller.enqueue(encoder.encode(send({ step: 'error', error: 'Erro ao salvar post' })));
                    } else {
                        controller.enqueue(encoder.encode(send({ step: 'done', success: true, slug, title })));
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
                    controller.enqueue(encoder.encode(send({ step: 'error', error: msg })));
                    console.error('✗ Erro ao gerar post com IA:', err);
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
