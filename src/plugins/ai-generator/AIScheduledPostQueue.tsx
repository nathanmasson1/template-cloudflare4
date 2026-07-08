import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, CheckCircle, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { triggerToast } from '../../components/admin/CmsToaster';

interface Author {
    slug: string;
    name: string;
}

interface Category {
    slug: string;
    name: string;
}

interface Props {
    authors: Author[];
    categories: Category[];
}

type QueueStatus = 'pending' | 'generating' | 'published' | 'error';
const MAX_POSTS_PER_DAY = 20;

interface QueueItem {
    id: string;
    title: string;
    slug: string;
    scheduledDate: string;
    author: string;
    category: string;
    status: QueueStatus;
    attempts: number;
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
    postSlug?: string;
    error?: string;
}

interface ParsedItem {
    title: string;
    scheduledDate: string;
    slug?: string;
}

function todayDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${now.getFullYear()}`;
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' e ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

function isIsoDate(value: string) {
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
    if (!isIsoDate(value)) return value;
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
}

function normalizeDateInput(value: string) {
    const clean = value.trim();
    if (isBrDate(clean)) return brDateToIso(clean);
    if (isIsoDate(clean)) return clean;
    return '';
}

function formatDateBR(value: string) {
    return isIsoDate(value) ? isoDateToBr(value) : value;
}

function parseScheduleInput(value: string, defaultDateInput: string): ParsedItem[] {
    const defaultDate = normalizeDateInput(defaultDateInput);
    return value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const separator = ['|', ';', '\t'].find(char => line.includes(char));
            const parts = separator ? line.split(separator).map(part => part.trim()) : [line];
            const title = parts[0] || '';
            const second = parts[1] || '';
            const third = parts[2] || '';
            const inlineDate = normalizeDateInput(second);
            const scheduledDate = inlineDate || defaultDate;
            const slug = inlineDate ? third : second;
            return {
                title,
                scheduledDate,
                slug: slug ? slugify(slug) : undefined,
            };
        })
        .filter(item => item.title && isIsoDate(item.scheduledDate));
}

function statusLabel(status: QueueStatus) {
    if (status === 'pending') return 'Pendente';
    if (status === 'generating') return 'Gerando';
    if (status === 'published') return 'Publicado';
    return 'Erro';
}

function statusClass(status: QueueStatus) {
    if (status === 'pending') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (status === 'generating') return 'bg-violet-50 text-violet-700 border-violet-200';
    if (status === 'published') return 'bg-green-50 text-green-700 border-green-200';
    return 'bg-red-50 text-red-700 border-red-200';
}

export default function AIScheduledPostQueue({ authors, categories }: Props) {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [input, setInput] = useState('');
    const [defaultDate, setDefaultDate] = useState(todayDate());
    const [author, setAuthor] = useState(authors[0]?.slug || '');
    const [category, setCategory] = useState(categories[0]?.slug || '');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const preview = useMemo(() => parseScheduleInput(input, defaultDate), [input, defaultDate]);
    const countsByDate = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of items) {
            if (item.status === 'pending' || item.status === 'generating') {
                counts.set(item.scheduledDate, (counts.get(item.scheduledDate) || 0) + 1);
            }
        }
        for (const item of preview) {
            counts.set(item.scheduledDate, (counts.get(item.scheduledDate) || 0) + 1);
        }
        return counts;
    }, [items, preview]);

    const sortedItems = useMemo(() => [...items].sort((a, b) => {
        const byDate = a.scheduledDate.localeCompare(b.scheduledDate);
        if (byDate !== 0) return byDate;
        return b.createdAt.localeCompare(a.createdAt);
    }), [items]);

    const inputClass = 'w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all shadow-sm';
    const labelClass = 'block text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 ml-1';

    const loadQueue = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await fetch('/api/admin/plugins/ai/schedule');
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao carregar fila.');
            setItems(Array.isArray(data.items) ? data.items : []);
        } catch (err: any) {
            setError(err.message || 'Erro ao carregar agendamentos.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadQueue();
    }, []);

    const handleAdd = async () => {
        if (!preview.length) {
            setError('Cole pelo menos um titulo com data.');
            return;
        }
        if (!author || !category) {
            setError('Selecione autor e categoria.');
            return;
        }
        const overloaded = Array.from(countsByDate.entries()).find(([, count]) => count > MAX_POSTS_PER_DAY);
        if (overloaded) {
            setError(`A data ${formatDateBR(overloaded[0])} ultrapassa o limite de ${MAX_POSTS_PER_DAY} artigos pendentes.`);
            return;
        }

        setSaving(true);
        setError('');
        try {
            const response = await fetch('/api/admin/plugins/ai/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ author, category, items: preview }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao salvar agendamentos.');
            setItems(Array.isArray(data.items) ? data.items : []);
            setInput('');
            triggerToast(`${data.created || preview.length} artigo(s) agendado(s).`, 'success', 80);
        } catch (err: any) {
            setError(err.message || 'Erro ao salvar agendamentos.');
            triggerToast(`Erro: ${err.message || 'falha no agendamento'}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleAction = async (id: string, action: 'delete' | 'retry') => {
        setSaving(true);
        setError('');
        try {
            const response = await fetch('/api/admin/plugins/ai/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, action }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao atualizar item.');
            setItems(Array.isArray(data.items) ? data.items : []);
            triggerToast(action === 'delete' ? 'Agendamento removido.' : 'Item reenviado para a fila.', 'success', 80);
        } catch (err: any) {
            setError(err.message || 'Erro ao atualizar item.');
            triggerToast(`Erro: ${err.message || 'falha ao atualizar'}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl pb-16 space-y-6">
            <div className="flex items-center justify-between bg-white p-4 px-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                        <CalendarClock className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Agendar posts com IA</h2>
                        <p className="text-xs text-slate-400">O cron roda a cada 1 hora e publica um artigo por execucao quando houver itens para a data.</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={loadQueue}
                    disabled={loading || saving}
                    className="w-10 h-10 rounded-xl border border-slate-200 text-slate-500 hover:text-violet-600 hover:border-violet-200 flex items-center justify-center disabled:opacity-50"
                    title="Atualizar fila"
                >
                    <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                <p className={labelClass}>Novos agendamentos</p>
                <textarea
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    rows={8}
                    className={`${inputClass} font-mono leading-relaxed`}
                    placeholder={'Como divulgar um evento local | 05/07/2026\nIdeias de negocios para cidades pequenas | 05/07/2026\nGuia de marketing para prestadores de servico | 06/07/2026 | guia-marketing-prestadores'}
                    disabled={saving}
                />
                <p className="text-xs text-slate-400 ml-1">
                    Use uma linha por artigo: titulo | DD/MM/AAAA | slug opcional. Limite de 20 artigos pendentes por dia.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Data padrao</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={defaultDate}
                            onChange={event => setDefaultDate(event.target.value)}
                            className={inputClass}
                            placeholder="05/07/2026"
                            disabled={saving}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Autor *</label>
                        <select value={author} onChange={event => setAuthor(event.target.value)} className={inputClass} disabled={saving}>
                            <option value="">Selecione um autor</option>
                            {authors.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Categoria *</label>
                        <select value={category} onChange={event => setCategory(event.target.value)} className={inputClass} disabled={saving}>
                            <option value="">Selecione uma categoria</option>
                            {categories.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border-l-4 border-red-500 text-sm font-medium rounded-r-xl flex gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
                </div>
            )}

            {preview.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <p className={labelClass}>Previa</p>
                        <span className="text-xs font-semibold text-slate-400">{preview.length} artigo(s) · limite {MAX_POSTS_PER_DAY}/dia</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {preview.slice(0, MAX_POSTS_PER_DAY).map((item, index) => (
                            <div key={`${item.title}-${index}`} className="border border-slate-100 rounded-xl px-4 py-3">
                                <p className="text-sm font-bold text-slate-800 truncate">{item.title}</p>
                                <p className="text-xs text-slate-400">{formatDateBR(item.scheduledDate)} - {item.slug || slugify(item.title)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={saving || !preview.length}
                    className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm shadow-violet-600/20"
                >
                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : <><CalendarClock className="w-4 h-4" /> Agendar artigos</>}
                </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <p className={labelClass}>Fila agendada</p>
                    <span className="text-xs font-semibold text-slate-400">{items.length} item(ns)</span>
                </div>

                {loading ? (
                    <div className="p-8 flex items-center justify-center text-slate-400 text-sm gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Carregando fila...
                    </div>
                ) : sortedItems.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-400">Nenhum artigo agendado ainda.</div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {sortedItems.map(item => (
                            <div key={item.id} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <span className={`text-xs font-bold border rounded-full px-2 py-0.5 ${statusClass(item.status)}`}>
                                            {statusLabel(item.status)}
                                        </span>
                                        <span className="text-xs text-slate-400">{formatDateBR(item.scheduledDate)}</span>
                                    </div>
                                    <p className="text-sm font-bold text-slate-800 truncate">{item.title}</p>
                                    <p className="text-xs text-slate-400 font-mono">{item.postSlug || item.slug}</p>
                                    {item.error && <p className="text-xs text-red-600 mt-1">{item.error}</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    {item.status === 'published' && <CheckCircle className="w-4 h-4 text-green-600" />}
                                    {item.status === 'generating' && <Loader2 className="w-4 h-4 text-violet-600 animate-spin" />}
                                    {item.status === 'error' && (
                                        <button
                                            type="button"
                                            onClick={() => handleAction(item.id, 'retry')}
                                            disabled={saving}
                                            className="w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:text-violet-600 hover:border-violet-200 flex items-center justify-center disabled:opacity-50"
                                            title="Tentar novamente"
                                        >
                                            <RefreshCcw className="w-4 h-4" />
                                        </button>
                                    )}
                                    {item.status !== 'generating' && (
                                        <button
                                            type="button"
                                            onClick={() => handleAction(item.id, 'delete')}
                                            disabled={saving}
                                            className="w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 flex items-center justify-center disabled:opacity-50"
                                            title="Excluir agendamento"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
