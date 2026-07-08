import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, FileText, Loader2, Play, Sparkles } from 'lucide-react';
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

type RowStatus = 'idle' | 'generating' | 'success' | 'error';

interface BulkRow {
    id: string;
    title: string;
    slug: string;
    status: RowStatus;
    message: string;
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function parseLine(line: string, index: number): BulkRow | null {
    const value = line.trim();
    if (!value) return null;

    const separator = ['|', ';', '\t'].find(char => value.includes(char));
    const [rawTitle, rawSlug] = separator
        ? value.split(separator).map(part => part.trim())
        : [value, ''];
    const title = rawTitle.trim();
    if (!title) return null;

    return {
        id: `${Date.now()}-${index}-${title}`,
        title,
        slug: slugify(rawSlug || title),
        status: 'idle',
        message: 'Aguardando',
    };
}

function parseRows(value: string): BulkRow[] {
    const used = new Map<string, number>();

    return value
        .split(/\r?\n/)
        .map(parseLine)
        .filter((row): row is BulkRow => row !== null)
        .map(row => {
            const baseSlug = row.slug || slugify(row.title);
            const count = used.get(baseSlug) || 0;
            used.set(baseSlug, count + 1);
            return {
                ...row,
                slug: count > 0 ? `${baseSlug}-${count + 1}` : baseSlug,
            };
        });
}

export default function AIBulkPostGenerator({ authors, categories }: Props) {
    const [input, setInput] = useState('');
    const [author, setAuthor] = useState(authors[0]?.slug || '');
    const [category, setCategory] = useState(categories[0]?.slug || '');
    const [rows, setRows] = useState<BulkRow[]>([]);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState('');

    const previewRows = useMemo(
        () => parseRows(input),
        [input]
    );

    const inputClass = 'w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all shadow-sm';
    const labelClass = 'block text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 ml-1';

    const updateRow = (id: string, updates: Partial<BulkRow>) => {
        setRows(prev => prev.map(row => row.id === id ? { ...row, ...updates } : row));
    };

    const handleGenerate = async () => {
        const parsed = parseRows(input);

        if (!parsed.length) {
            setError('Cole pelo menos um titulo.');
            return;
        }
        if (!author || !category) {
            setError('Selecione autor e categoria.');
            return;
        }

        setError('');
        setRows(parsed);
        setRunning(true);
        triggerToast(`Gerando ${parsed.length} post(s)...`, 'progress', 20);

        let success = 0;
        let failed = 0;

        try {
            const response = await fetch('/api/admin/plugins/ai/bulk-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    author,
                    category,
                    posts: parsed.map(row => ({
                        id: row.id,
                        title: row.title,
                        slug: row.slug,
                    })),
                }),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `Erro ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            if (!reader) throw new Error('Resposta sem stream.');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = JSON.parse(line.slice(6));

                    if (data.step === 'row-start') {
                        updateRow(data.id, { status: 'generating', slug: data.slug, message: data.message || 'Gerando...' });
                    }
                    if (data.step === 'row-progress' || data.step === 'row-ready') {
                        updateRow(data.id, { message: data.message || 'Processando...' });
                    }
                    if (data.step === 'row-done') {
                        success++;
                        updateRow(data.id, { slug: data.slug, status: 'success', message: 'Publicado com sucesso' });
                    }
                    if (data.step === 'row-error') {
                        failed++;
                        updateRow(data.id, { status: 'error', message: data.error || 'Erro ao gerar post' });
                    }
                    if (data.step === 'error') {
                        throw new Error(data.error || 'Erro ao gerar posts');
                    }
                    if (data.step === 'done') {
                        success = data.generated ?? success;
                        failed = data.failed ?? failed;
                    }
                }
            }
        } catch (err: any) {
            setError(err.message || 'Erro ao gerar posts em massa.');
            triggerToast(`Erro: ${err.message || 'falha na geracao em massa'}`, 'error');
            setRunning(false);
            return;
        }

        setRunning(false);
        const message = failed
            ? `${success} post(s) gerados, ${failed} com erro.`
            : `${success} post(s) publicados com sucesso!`;
        triggerToast(message, failed ? 'error' : 'success', 100);
    };

    return (
        <div className="max-w-4xl pb-16 space-y-6">
            <div className="flex items-center justify-between bg-white p-4 px-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Geracao em massa</h2>
                        <p className="text-xs text-slate-400">Cole titulos, defina autor/categoria e publique artigos SEO em fila.</p>
                    </div>
                </div>
                <FileText className="w-6 h-6 text-violet-500" />
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                <p className={labelClass}>Titulos</p>
                <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    rows={10}
                    className={`${inputClass} font-mono leading-relaxed`}
                    placeholder={'Como montar a mala da maternidade | mala-da-maternidade\nCuidados com o recem-nascido nos primeiros dias\nRotina de sono do bebe; rotina-de-sono-do-bebe'}
                    disabled={running}
                />
                <p className="text-xs text-slate-400 ml-1">
                    Use uma linha por post. Slug opcional depois de |, ; ou tab. Sem slug, o sistema gera automaticamente.
                </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <p className={labelClass}>Dados dos posts</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Autor *</label>
                        <select value={author} onChange={e => setAuthor(e.target.value)} className={inputClass} disabled={running}>
                            <option value="">Selecione um autor</option>
                            {authors.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Categoria *</label>
                        <select value={category} onChange={e => setCategory(e.target.value)} className={inputClass} disabled={running}>
                            <option value="">Selecione uma categoria</option>
                            {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border-l-4 border-red-500 text-sm font-medium rounded-r-xl flex gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
                </div>
            )}

            {(rows.length > 0 || previewRows.length > 0) && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <p className={labelClass}>Fila</p>
                        <span className="text-xs font-semibold text-slate-400">{(rows.length || previewRows.length)} post(s)</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {(rows.length ? rows : previewRows).map(row => (
                            <div key={row.id} className="px-6 py-4 flex items-start gap-3">
                                <div className="mt-0.5">
                                    {row.status === 'generating' && <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />}
                                    {row.status === 'success' && <CheckCircle className="w-4 h-4 text-green-600" />}
                                    {row.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
                                    {row.status === 'idle' && <FileText className="w-4 h-4 text-slate-300" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-slate-800 truncate">{row.title}</p>
                                    <p className="text-xs text-slate-400 font-mono">{row.slug}</p>
                                    <p className={`text-xs mt-1 ${row.status === 'error' ? 'text-red-600' : row.status === 'success' ? 'text-green-600' : 'text-slate-500'}`}>
                                        {row.message}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={running || !previewRows.length}
                    className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm shadow-violet-600/20"
                >
                    {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando fila...</> : <><Play className="w-4 h-4" /> Gerar posts em massa</>}
                </button>
            </div>
        </div>
    );
}
