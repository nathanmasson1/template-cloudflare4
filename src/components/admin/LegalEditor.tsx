import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, FileText, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { triggerToast } from './CmsToaster';
import { cmsApi } from '../../lib/adminApi';

type LegalDocKey =
    | 'editorial'
    | 'privacy'
    | 'cookies'
    | 'terms'
    | 'corrections'
    | 'monetization'
    | 'aiPolicy'
    | 'aiNotice';

interface LegalSection {
    title: string;
    text?: string;
    paragraphs?: string[];
    items?: string[];
    note?: string;
}

interface LegalData {
    title: string;
    lastUpdated: string;
    intro?: string;
    content: LegalSection[];
}

type DocState = {
    config: LegalDocConfig;
    data: LegalData | null;
    sha: string;
    error?: string;
};

type LegalDocConfig = {
    key: LegalDocKey;
    label: string;
    shortLabel: string;
    path: string;
};

const DOCS: LegalDocConfig[] = [
    { key: 'editorial', label: 'Política Editorial', shortLabel: 'Editorial', path: 'src/data/editorialPolicy.json' },
    { key: 'privacy', label: 'Política de Privacidade', shortLabel: 'Privacidade', path: 'src/data/privacy.json' },
    { key: 'cookies', label: 'Política de Cookies', shortLabel: 'Cookies', path: 'src/data/cookies.json' },
    { key: 'terms', label: 'Termos de Uso', shortLabel: 'Termos', path: 'src/data/terms.json' },
    { key: 'corrections', label: 'Correções e Retratações', shortLabel: 'Correções', path: 'src/data/corrections.json' },
    { key: 'monetization', label: 'Monetização e Transparência', shortLabel: 'Monetização', path: 'src/data/monetization.json' },
    { key: 'aiPolicy', label: 'Uso de Inteligência Artificial', shortLabel: 'Política IA', path: 'src/data/aiPolicy.json' },
    { key: 'aiNotice', label: 'Aviso Editorial das Notícias IA', shortLabel: 'Aviso IA', path: 'src/data/aiEditorialNotice.json' },
];

const emptyDoc = (label: string): LegalData => ({
    title: label,
    lastUpdated: '',
    intro: '',
    content: [{ title: 'Nova Seção', paragraphs: ['Conteúdo aqui...'], items: [], note: '' }],
});

function normalizeSection(section: LegalSection): LegalSection {
    const paragraphs = Array.isArray(section.paragraphs)
        ? section.paragraphs
        : section.text
            ? [section.text]
            : [''];

    return {
        title: section.title || 'Seção',
        paragraphs,
        items: Array.isArray(section.items) ? section.items : [],
        note: section.note || '',
    };
}

function normalizeDoc(data: any, label: string): LegalData {
    const content = Array.isArray(data?.content) ? data.content : [];
    return {
        title: data?.title || label,
        lastUpdated: data?.lastUpdated || '',
        intro: data?.intro || '',
        content: content.length ? content.map(normalizeSection) : emptyDoc(label).content,
    };
}

function todayPtBr() {
    return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function LegalEditor() {
    const [activeTab, setActiveTab] = useState<LegalDocKey>('editorial');
    const [docs, setDocs] = useState<Record<LegalDocKey, DocState>>({} as Record<LegalDocKey, DocState>);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchDocs = async () => {
            try {
                const entries = await Promise.all(DOCS.map(async config => {
                    try {
                        const res = await cmsApi('read', config.path);
                        return [config.key, {
                            config,
                            data: normalizeDoc(JSON.parse(res.content || '{}'), config.label),
                            sha: res.sha || '',
                        }] as const;
                    } catch (err: any) {
                        return [config.key, {
                            config,
                            data: emptyDoc(config.label),
                            sha: '',
                            error: err.message,
                        }] as const;
                    }
                }));
                setDocs(Object.fromEntries(entries) as Record<LegalDocKey, DocState>);
            } catch {
                setError('Erro ao carregar as políticas. Verifique os dados do CMS.');
            } finally {
                setLoading(false);
            }
        };
        fetchDocs();
    }, []);

    const activeState = docs[activeTab];
    const activeData = activeState?.data || null;

    const updateActiveData = (updater: (data: LegalData) => LegalData) => {
        setDocs(prev => {
            const state = prev[activeTab];
            if (!state?.data) return prev;
            return { ...prev, [activeTab]: { ...state, data: updater(state.data) } };
        });
    };

    const updateSection = (index: number, updater: (section: LegalSection) => LegalSection) => {
        updateActiveData(data => {
            const content = [...data.content];
            content[index] = updater(content[index]);
            return { ...data, content };
        });
    };

    const addSection = () => {
        updateActiveData(data => ({
            ...data,
            content: [...data.content, { title: 'Nova Seção', paragraphs: ['Conteúdo aqui...'], items: [], note: '' }],
        }));
    };

    const removeSection = (index: number) => {
        if (!confirm('Excluir esta seção?')) return;
        updateActiveData(data => ({
            ...data,
            content: data.content.filter((_, itemIndex) => itemIndex !== index),
        }));
    };

    const moveSection = (index: number, direction: 'up' | 'down') => {
        updateActiveData(data => {
            const content = [...data.content];
            const newIndex = direction === 'up' ? index - 1 : index + 1;
            if (newIndex < 0 || newIndex >= content.length) return data;
            [content[index], content[newIndex]] = [content[newIndex], content[index]];
            return { ...data, content };
        });
    };

    const updateParagraph = (sectionIndex: number, paragraphIndex: number, value: string) => {
        updateSection(sectionIndex, section => {
            const paragraphs = [...(section.paragraphs || [''])];
            paragraphs[paragraphIndex] = value;
            return { ...section, paragraphs };
        });
    };

    const addParagraph = (sectionIndex: number) => {
        updateSection(sectionIndex, section => ({
            ...section,
            paragraphs: [...(section.paragraphs || []), 'Novo parágrafo...'],
        }));
    };

    const removeParagraph = (sectionIndex: number, paragraphIndex: number) => {
        updateSection(sectionIndex, section => ({
            ...section,
            paragraphs: (section.paragraphs || []).filter((_, index) => index !== paragraphIndex),
        }));
    };

    const updateItemsText = (sectionIndex: number, value: string) => {
        updateSection(sectionIndex, section => ({
            ...section,
            items: value.split('\n').map(item => item.trim()).filter(Boolean),
        }));
    };

    const handleSave = async () => {
        if (!activeState?.data) return;
        setSaving(true);
        triggerToast(`Salvando ${activeState.config.label}...`, 'progress', 30);

        try {
            const updatedData = { ...activeState.data, lastUpdated: todayPtBr() };
            const res = await cmsApi('write', activeState.config.path, {
                content: JSON.stringify(updatedData, null, 2),
                sha: activeState.sha || undefined,
                message: `CMS: Update ${activeState.config.path}`,
            });

            setDocs(prev => ({
                ...prev,
                [activeTab]: {
                    ...prev[activeTab],
                    data: updatedData,
                    sha: res.sha || prev[activeTab].sha,
                    error: '',
                },
            }));
            triggerToast('Alterações salvas com sucesso!', 'success', 100);
        } catch (err: any) {
            triggerToast(err.message || 'Erro ao salvar.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const tabs = useMemo(() => DOCS, []);

    if (loading) return (
        <div className="flex flex-col items-center justify-center p-32 text-slate-400 bg-white rounded-md border border-slate-200">
            <FileText className="w-10 h-10 animate-pulse mb-6 text-slate-300" />
            <p className="font-semibold text-sm animate-pulse text-slate-500">Buscando politicas do CMS...</p>
        </div>
    );

    return (
        <div className="space-y-6 pb-32">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-wrap p-1 bg-slate-100 rounded-xl w-fit border border-slate-200 gap-1">
                        {tabs.map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === tab.key ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {tab.shortLabel}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving || !activeData}
                        className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {saving ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </div>

            {error && <div className="p-5 bg-red-100/50 text-red-700 rounded-2xl font-bold border border-red-200"><AlertCircle className="w-5 h-5 inline mr-2 -mt-1" /> {error}</div>}

            {activeData ? (
                <div className="space-y-5">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Título</label>
                                <input
                                    type="text"
                                    value={activeData.title}
                                    onChange={(e) => updateActiveData(data => ({ ...data, title: e.target.value }))}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-bold focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Última atualização</label>
                                <input
                                    type="text"
                                    value={activeData.lastUpdated || ''}
                                    onChange={(e) => updateActiveData(data => ({ ...data, lastUpdated: e.target.value }))}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                                />
                            </div>
                        </div>
                        <div className="mt-4">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Introdução</label>
                            <textarea
                                value={activeData.intro || ''}
                                onChange={(e) => updateActiveData(data => ({ ...data, intro: e.target.value }))}
                                rows={4}
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 leading-relaxed focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 resize-y"
                                placeholder="Texto de abertura da página..."
                            />
                        </div>
                        {activeState?.error && (
                            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                Arquivo criado no editor porque não foi encontrado: {activeState.config.path}
                            </p>
                        )}
                    </div>

                    {activeData.content.map((section, idx) => (
                        <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm group">
                            <div className="flex items-center justify-between mb-4 border-b border-slate-50 pb-4 gap-4">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs shrink-0">#{idx + 1}</span>
                                    <input
                                        type="text"
                                        value={section.title}
                                        onChange={(e) => updateSection(idx, item => ({ ...item, title: e.target.value }))}
                                        className="text-sm font-bold text-slate-800 bg-transparent border-none focus:ring-0 w-full focus:outline-none"
                                        placeholder="Título da seção"
                                    />
                                </div>
                                <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => moveSection(idx, 'up')} disabled={idx === 0} className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors disabled:opacity-30" title="Mover para cima"><ChevronUp className="w-4 h-4" /></button>
                                    <button onClick={() => moveSection(idx, 'down')} disabled={idx === activeData.content.length - 1} className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors disabled:opacity-30" title="Mover para baixo"><ChevronDown className="w-4 h-4" /></button>
                                    <button onClick={() => removeSection(idx)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded ml-2 transition-colors" title="Excluir seção"><Trash2 className="w-4 h-4" /></button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Parágrafos</label>
                                    <div className="space-y-3">
                                        {(section.paragraphs || ['']).map((paragraph, paragraphIndex) => (
                                            <div key={paragraphIndex} className="flex gap-2">
                                                <textarea
                                                    value={paragraph}
                                                    onChange={(e) => updateParagraph(idx, paragraphIndex, e.target.value)}
                                                    rows={3}
                                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm leading-relaxed focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 resize-y shadow-sm"
                                                    placeholder="Parágrafo..."
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeParagraph(idx, paragraphIndex)}
                                                    disabled={(section.paragraphs || []).length <= 1}
                                                    className="h-10 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30"
                                                    title="Remover parágrafo"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => addParagraph(idx)} className="mt-3 px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-2">
                                        <Plus className="w-4 h-4" /> Adicionar parágrafo
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Lista de itens</label>
                                    <textarea
                                        value={(section.items || []).join('\n')}
                                        onChange={(e) => updateItemsText(idx, e.target.value)}
                                        rows={5}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm leading-relaxed focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 resize-y shadow-sm"
                                        placeholder="Um item por linha. Deixe em branco se a seção não tiver lista."
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nota destacada</label>
                                    <textarea
                                        value={section.note || ''}
                                        onChange={(e) => updateSection(idx, item => ({ ...item, note: e.target.value }))}
                                        rows={3}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm leading-relaxed focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 resize-y shadow-sm"
                                        placeholder="Opcional..."
                                    />
                                </div>
                            </div>
                        </div>
                    ))}

                    <button onClick={addSection} className="w-full py-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:text-violet-600 hover:border-violet-600 hover:bg-violet-50 transition-all font-bold flex flex-col items-center justify-center gap-2 text-xs uppercase">
                        <Plus className="w-6 h-6" /> Adicionar nova seção
                    </button>
                </div>
            ) : (
                <div className="p-10 bg-red-50 border border-red-100 rounded-2xl text-red-700 flex items-center gap-4">
                    <AlertCircle className="w-8 h-8" />
                    <div>
                        <p className="font-bold text-lg">Política não carregada</p>
                        <p className="text-sm opacity-80">Não foi possível carregar o arquivo JSON selecionado.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
