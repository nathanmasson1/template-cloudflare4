import { postPath, serializePost } from '../_adapter';
import { contentFileExists, readContentFile, readPluginsConfigAsync, writeContentFile } from '../_server';
import {
    postExistsInD1,
    readSiteDataTextFromD1,
    upsertPostMarkdownToD1,
    upsertSiteDataTextToD1,
} from '../../lib/cloudflareContent';
import { callAI, resolveApiKey, type AIProvider, type AISettings } from './ai-provider';
import {
    generatePostContent,
    generateSeoDescription,
    generateSeoOutlines,
    insertImagesByWordCount,
    type Outline,
} from './generate';

const QUEUE_PATH = 'src/data/aiScheduledPosts.json';
const MAX_TOKENS_SECTION = 2048;
const MAX_PENDING_PER_DATE = 20;

export type ScheduledAIStatus = 'pending' | 'generating' | 'published' | 'error';

export interface ScheduledAIPost {
    id: string;
    title: string;
    slug: string;
    scheduledDate: string;
    author: string;
    category: string;
    status: ScheduledAIStatus;
    attempts: number;
    createdAt: string;
    updatedAt: string;
    lockedAt?: string;
    publishedAt?: string;
    postSlug?: string;
    error?: string;
}

export interface ScheduleInput {
    title: string;
    scheduledDate: string;
    slug?: string;
}

type StorageOptions = {
    db?: any;
};

function safeJson<T>(value: string | null, fallback: T): T {
    if (!value) return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

export function slugifyAI(value: string): string {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' e ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

function newId() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isDateOnly(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isBrDate(value: string) {
    return /^\d{2}\/\d{2}\/\d{4}$/.test(value);
}

function brDateToIso(value: string) {
    const [day, month, year] = value.split('/');
    return `${year}-${month}-${day}`;
}

function isoDateToBr(value: string) {
    if (!isDateOnly(value)) return value;
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
}

function normalizeScheduleDate(value: string) {
    const clean = value.trim();
    if (isDateOnly(clean)) return clean;
    if (isBrDate(clean)) return brDateToIso(clean);
    return '';
}

function todaySaoPaulo(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function fallbackOutlines(title: string): Outline[] {
    return [
        { level: 'h2', text: `O que saber sobre ${title}`, minWords: 220 },
        { level: 'h2', text: 'Principais cuidados e orientacoes', minWords: 260 },
        { level: 'h2', text: 'Passo a passo para aplicar no dia a dia', minWords: 260 },
        { level: 'h2', text: 'Perguntas frequentes', minWords: 240 },
    ];
}

async function resolveAvailableSlug(baseSlug: string, reserved = new Set<string>(), options: StorageOptions = {}): Promise<string> {
    const cleanBase = slugifyAI(baseSlug) || 'post';
    for (let attempt = 1; attempt <= 50; attempt++) {
        const candidate = attempt === 1 ? cleanBase : `${cleanBase}-${attempt}`;
        if (reserved.has(candidate)) continue;
        const exists = options.db
            ? await postExistsInD1(options.db, postPath(candidate))
            : await contentFileExists(postPath(candidate));
        if (!exists) {
            reserved.add(candidate);
            return candidate;
        }
    }
    throw new Error(`Nao foi possivel encontrar slug disponivel para ${cleanBase}`);
}

async function loadAISettingsAsync(options: StorageOptions = {}): Promise<AISettings> {
    const rawConfig = options.db
        ? await readSiteDataTextFromD1(options.db, 'src/data/pluginsConfig.json')
        : null;
    const config = rawConfig ? safeJson<any>(rawConfig.content, {}) : await readPluginsConfigAsync();
    const ai = config?.ai || {};
    const provider = (ai.provider as AIProvider) || 'gemini';
    const legacyApiKey = ai.apiKey || '';
    const providerApiKey = provider === 'openai'
        ? (ai.openaiApiKey || ai.openaiKey || legacyApiKey)
        : (ai.geminiApiKey || legacyApiKey);

    return {
        provider,
        apiKey: providerApiKey || '',
        pexelsApiKey: ai.pexelsApiKey || '',
    };
}

export async function readScheduledAIPosts(options: StorageOptions = {}): Promise<ScheduledAIPost[]> {
    const d1Result = options.db ? await readSiteDataTextFromD1(options.db, QUEUE_PATH) : null;
    const raw = d1Result?.content || await readContentFile(QUEUE_PATH);
    const parsed = safeJson<ScheduledAIPost[]>(raw, []);
    return Array.isArray(parsed) ? parsed : [];
}

async function writeScheduledAIPosts(items: ScheduledAIPost[], options: StorageOptions = {}) {
    if (options.db) {
        await upsertSiteDataTextToD1(options.db, QUEUE_PATH, JSON.stringify(items, null, 2));
        return;
    }

    await writeContentFile(QUEUE_PATH, JSON.stringify(items, null, 2), {
        message: 'CMS: Atualiza fila de posts IA agendados',
    });
}

export async function addScheduledAIPosts(input: {
    author: string;
    category: string;
    items: ScheduleInput[];
}, options: StorageOptions = {}) {
    const author = input.author?.trim();
    const category = input.category?.trim();
    if (!author || !category) throw new Error('Autor e categoria sao obrigatorios.');

    const current = await readScheduledAIPosts(options);
    const now = new Date().toISOString();
    const normalized = input.items
        .map(item => ({
            title: item.title?.trim() || '',
            slug: slugifyAI(item.slug || item.title || ''),
            scheduledDate: normalizeScheduleDate(item.scheduledDate || ''),
        }))
        .filter(item => item.title);

    if (!normalized.length) throw new Error('Informe pelo menos um titulo com data.');

    const counts = new Map<string, number>();
    for (const item of current) {
        if (item.status === 'pending' || item.status === 'generating') {
            counts.set(item.scheduledDate, (counts.get(item.scheduledDate) || 0) + 1);
        }
    }

    for (const item of normalized) {
        if (!isDateOnly(item.scheduledDate)) {
            throw new Error(`Data invalida para "${item.title}". Use DD/MM/AAAA.`);
        }
        const count = counts.get(item.scheduledDate) || 0;
        if (count >= MAX_PENDING_PER_DATE) {
            throw new Error(`A data ${isoDateToBr(item.scheduledDate)} ja tem ${MAX_PENDING_PER_DATE} posts pendentes.`);
        }
        counts.set(item.scheduledDate, count + 1);
    }

    const used = new Map<string, number>();
    const created = normalized.map(item => {
        const baseSlug = item.slug || slugifyAI(item.title) || 'post';
        const slugCount = used.get(baseSlug) || 0;
        used.set(baseSlug, slugCount + 1);

        return {
            id: newId(),
            title: item.title,
            slug: slugCount > 0 ? `${baseSlug}-${slugCount + 1}` : baseSlug,
            scheduledDate: item.scheduledDate,
            author,
            category,
            status: 'pending' as const,
            attempts: 0,
            createdAt: now,
            updatedAt: now,
        };
    });

    await writeScheduledAIPosts([...created, ...current], options);
    return { success: true, created: created.length, items: [...created, ...current] };
}

export async function updateScheduledAIPost(id: string, action: 'delete' | 'retry', options: StorageOptions = {}) {
    const current = await readScheduledAIPosts(options);
    const item = current.find(entry => entry.id === id);
    if (!item) throw new Error('Item nao encontrado.');

    let next = current;
    if (action === 'delete') {
        if (item.status === 'generating') throw new Error('Nao e possivel excluir um item em geracao.');
        next = current.filter(entry => entry.id !== id);
    } else {
        item.status = 'pending';
        item.error = undefined;
        item.lockedAt = undefined;
        item.updatedAt = new Date().toISOString();
        next = current.map(entry => entry.id === id ? item : entry);
    }

    await writeScheduledAIPosts(next, options);
    return { success: true, items: next };
}

export async function generateAndPublishScheduledPost(item: ScheduledAIPost, options: StorageOptions = {}) {
    const title = item.title.trim();
    if (!title) throw new Error('Titulo vazio.');

    const aiSettings = await loadAISettingsAsync(options);
    const apiKey = resolveApiKey(aiSettings);
    const slug = await resolveAvailableSlug(item.slug || title, new Set<string>(), options);
    let description = title.length > 160 ? `${title.substring(0, 157)}...` : title;
    let content: string;

    if (apiKey) {
        const callAIFn = (prompt: string) =>
            callAI(prompt, aiSettings, apiKey, { maxTokens: MAX_TOKENS_SECTION });
        const outlines = await generateSeoOutlines(title, callAIFn, () => undefined);
        description = await generateSeoDescription(title, callAIFn);
        content = await generatePostContent(title, outlines, 'informational', undefined, callAIFn, () => undefined);
    } else {
        content = await generatePostContent(
            title,
            fallbackOutlines(title),
            'informational',
            undefined,
            async () => { throw new Error('No API Key'); },
            () => undefined
        );
    }

    let image = '';
    if (aiSettings.pexelsApiKey?.trim()) {
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
                } catch {
                    // Mantem o titulo original como busca.
                }
            }
            const result = await insertImagesByWordCount(content, title, aiSettings.pexelsApiKey.trim(), searchQuery);
            content = result.content;
            image = result.thumbnailUrl || '';
        } catch {
            // Publica mesmo sem imagens externas.
        }
    }

    const markdown = serializePost({
        title,
        slug,
        description,
        content,
        image,
        category: item.category,
        author: item.author,
        pubDate: todaySaoPaulo(),
        draft: false,
    });

    const ok = options.db
        ? await upsertPostMarkdownToD1(options.db, postPath(slug), markdown, `CMS: Criacao agendada IA ${slug}`).then(() => true)
        : await writeContentFile(postPath(slug), markdown, {
            message: `CMS: Criacao agendada IA ${slug}`,
        });
    if (!ok) throw new Error('Erro ao salvar post gerado.');

    return { slug, title };
}

export async function processNextScheduledAIPost(options: { now?: Date; source?: string; db?: any } = {}) {
    const today = todaySaoPaulo(options.now || new Date());
    const storage = { db: options.db };
    const current = await readScheduledAIPosts(storage);
    const index = current.findIndex(item => item.status === 'pending' && item.scheduledDate <= today);

    if (index < 0) {
        return { success: true, processed: 0, message: 'Nenhum post IA agendado para processar.', today };
    }

    const now = new Date().toISOString();
    const item = { ...current[index], status: 'generating' as const, lockedAt: now, updatedAt: now };
    const locked = current.map((entry, entryIndex) => entryIndex === index ? item : entry);
    await writeScheduledAIPosts(locked, storage);

    try {
        const result = await generateAndPublishScheduledPost(item, storage);
        const publishedAt = new Date().toISOString();
        const next = locked.map(entry => entry.id === item.id
            ? {
                ...entry,
                status: 'published' as const,
                postSlug: result.slug,
                publishedAt,
                updatedAt: publishedAt,
                error: undefined,
            }
            : entry
        );
        await writeScheduledAIPosts(next, storage);
        return {
            success: true,
            processed: 1,
            today,
            source: options.source || 'cron',
            item: { id: item.id, title: item.title, slug: result.slug },
        };
    } catch (error: any) {
        const failedAt = new Date().toISOString();
        const next = locked.map(entry => entry.id === item.id
            ? {
                ...entry,
                status: 'error' as const,
                attempts: (entry.attempts || 0) + 1,
                error: error?.message || 'Erro ao gerar post.',
                updatedAt: failedAt,
            }
            : entry
        );
        await writeScheduledAIPosts(next, storage);
        return {
            success: false,
            processed: 1,
            today,
            source: options.source || 'cron',
            error: error?.message || 'Erro ao gerar post IA agendado.',
            item: { id: item.id, title: item.title },
        };
    }
}
