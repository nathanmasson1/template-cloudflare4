/**
 * ai-provider.ts — Plugin AI Generator (Walker)
 *
 * Carrega configurações de IA do pluginsConfig.json e chama OpenAI ou Gemini.
 * Adaptado do CNX: remove dependências de settings.yaml e API antiga de conteudo,
 * lê diretamente de src/data/pluginsConfig.json.
 */

import { env as workerEnv } from 'cloudflare:workers';
import { readStaticData } from '../../lib/staticData';

export type AIProvider = 'openai' | 'gemini';

export interface AISettings {
    provider: AIProvider;
    apiKey: string;
    pexelsApiKey?: string;
}

type AIOptions = {
    systemPrompt?: string;
    maxTokens?: number;
    responseFormat?: 'json_object';
};

function envVar(name: string) {
    const processEnv = (globalThis as any).process?.env || {};
    return workerEnv?.[name] || processEnv[name] || '';
}

export const GEMINI_TEXT_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'] as const;

/**
 * Carrega configurações de IA do pluginsConfig.json.
 */
export function loadAISettings(): AISettings {
    try {
        const config = readStaticData<any>('pluginsConfig.json', {});
        const ai = config?.ai || {};
        const provider = (ai.provider as AIProvider) || 'gemini';
        const legacyApiKey = ai.apiKey || '';
        const providerApiKey = provider === 'openai'
            ? (ai.openaiApiKey || ai.openaiKey || legacyApiKey)
            : (ai.geminiApiKey || legacyApiKey);
        return {
            provider,
            apiKey: providerApiKey,
            pexelsApiKey: ai.pexelsApiKey || '',
        };
    } catch {
        return { provider: 'gemini', apiKey: '' };
    }
}

/**
 * Resolve a API Key efetiva: pluginsConfig primeiro, depois env vars.
 */
export function resolveApiKey(settings: AISettings): string {
    if (settings.apiKey?.trim()) return settings.apiKey.trim();
    if (settings.provider === 'openai') return envVar('OPENAI_API_KEY').trim();
    return envVar('GEMINI_API_KEY').trim();
}

/**
 * Chama a API OpenAI (gpt-4o-mini).
 */
export async function callOpenAI(
    prompt: string,
    apiKey: string,
    options?: AIOptions
): Promise<string> {
    const systemPrompt = options?.systemPrompt ?? 'Você é um redator profissional especializado em criar conteúdo de alta qualidade para blogs.';
    const maxTokens = options?.maxTokens ?? 4096;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };
    const orgId = envVar('OPENAI_ORGANIZATION_ID').trim();
    const projId = envVar('OPENAI_PROJECT_ID').trim();
    if (orgId) headers['OpenAI-Organization'] = orgId;
    if (projId) headers['OpenAI-Project'] = projId;

    const body: any = {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: maxTokens,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ],
    };
    if (options?.responseFormat) {
        body.response_format = { type: options.responseFormat };
    }

    let res: Response;
    try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
    } catch (err: any) {
        const cause = err?.cause?.code || err?.cause?.message || err?.message || 'erro desconhecido';
        throw new Error(`OpenAI fetch failed: ${cause}`);
    }

    if (!res.ok) {
        const err = await res.text();
        let message = err;
        try {
            const parsed = JSON.parse(err);
            message = parsed?.error?.message || err;
        } catch {
            message = err;
        }
        throw new Error(`OpenAI ${res.status}: ${String(message).slice(0, 300)}`);
    }

    const data = await res.json();
    return data.choices[0]?.message?.content?.trim() || '';
}

/**
 * Chama a API Google Gemini usando os modelos de texto atuais.
 */
export async function callGemini(
    prompt: string,
    apiKey: string,
    options?: AIOptions
): Promise<string> {
    const systemPrompt = options?.systemPrompt ?? 'Você é um redator profissional especializado em criar conteúdo de alta qualidade para blogs.';
    const maxTokens = options?.maxTokens ?? 4096;

    let lastError = '';

    for (const model of GEMINI_TEXT_MODELS) {
        let res: Response;
        try {
            res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: `${systemPrompt}\n\n${prompt}` }],
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: maxTokens,
                        thinkingConfig: model.startsWith('gemini-2.5') ? { thinkingBudget: 0 } : undefined,
                    },
                }),
            });
        } catch (err: any) {
            const cause = err?.cause?.code || err?.cause?.message || err?.message || 'erro desconhecido';
            throw new Error(`Gemini fetch failed (${model}): ${cause}`);
        }

        if (!res.ok) {
            const err = await res.text();
            try {
                const parsed = JSON.parse(err);
                lastError = `Gemini ${res.status}: ${String(parsed?.error?.message || err).slice(0, 220)}`;
            } catch {
                lastError = `Gemini ${res.status}: ${err.slice(0, 220)}`;
            }
            if (res.status === 404) continue;
            throw new Error(lastError);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts
            ?.map((part: any) => part?.text || '')
            .join('')
            .trim();
        if (text) return text;

        const reason = data.candidates?.[0]?.finishReason;
        throw new Error(`Gemini nao retornou texto${reason ? ` (finishReason: ${reason})` : ''}.`);
    }

    throw new Error(lastError || 'Nenhum modelo Gemini disponivel para gerar conteudo.');
}

/**
 * Chama o provedor de IA configurado (OpenAI ou Gemini).
 */
export async function callAI(
    prompt: string,
    settings: AISettings,
    apiKey: string,
    options?: AIOptions
): Promise<string> {
    if (settings.provider === 'gemini') {
        return callGemini(prompt, apiKey, options);
    }
    return callOpenAI(prompt, apiKey, options);
}
