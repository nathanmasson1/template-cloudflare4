import React, { useState, useEffect } from 'react';
import { Save, Loader2, AlertCircle, Plus, Trash2, Sparkles, BookOpen, Star, Megaphone, Search, ChevronDown, ChevronUp, Image as ImageIcon, UploadCloud } from 'lucide-react';
import { triggerToast } from './CmsToaster';
import { cmsApi } from '../../lib/adminApi';

type CTA = { text: string; href: string };
type StoryStat = { number: string; label: string };
type ValueItem = { number: string; title: string; text: string };
type TextValueItem = { title: string; text: string };

type SobreConfig = {
    seo: { title: string; description: string; image: string };
    hero: { label: string; title: string; titleAccent: string; paragraphs: string[]; stats: StoryStat[] };
    mission: { label: string; title: string; subtitle: string; items: ValueItem[] };
    values: TextValueItem[];
    cta: { title: string; text: string; ctaPrimary: CTA; ctaSecondary: CTA };
};

const inputClass = "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none text-sm";
const labelClass = "block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5";

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result?.toString() || '').split(',')[1] || '');
    reader.onerror = error => reject(error);
});

function safeFilePart(value: string) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'sobre-image';
}

function SectionCard({ title, icon, children, defaultOpen = false }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                    {icon}
                    <h3 className="text-base font-bold text-slate-800">{title}</h3>
                </div>
                {open ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
            </button>
            {open && <div className="px-6 pb-6 border-t border-slate-100 pt-4">{children}</div>}
        </div>
    );
}

export default function SobreEditor() {
    const [config, setConfig] = useState<SobreConfig | null>(null);
    const [fileSha, setFileSha] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [pendingSeoImage, setPendingSeoImage] = useState<File | null>(null);

    useEffect(() => {
        cmsApi('read', 'src/data/sobre.json')
            .then(data => {
                const parsed = JSON.parse(data?.content || '{}');
                setConfig({
                    seo: { title: '', description: '', image: '', ...(parsed.seo || {}) },
                    hero: { label: '', title: '', titleAccent: '', paragraphs: [], stats: [], ...(parsed.hero || {}) },
                    mission: { label: '', title: '', subtitle: '', items: [], ...(parsed.mission || {}) },
                    values: Array.isArray(parsed.values) ? parsed.values : [],
                    cta: {
                        title: '',
                        text: '',
                        ctaPrimary: { text: '', href: '' },
                        ctaSecondary: { text: '', href: '' },
                        ...(parsed.cta || {}),
                    },
                });
                setFileSha(data.sha);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const save = async () => {
        if (!config) return;
        setSaving(true); setError('');
        triggerToast('Salvando página Sobre...', 'progress', 20);
        try {
            const configCopy = JSON.parse(JSON.stringify(config));
            if (pendingSeoImage) {
                triggerToast('Enviando imagem Open Graph...', 'progress', 45);
                const base64Content = await fileToBase64(pendingSeoImage);
                const rawExt = pendingSeoImage.name.split('.').pop()?.toLowerCase() || 'png';
                const fileExt = rawExt.replace(/[^a-z0-9]/g, '') || 'png';
                const label = safeFilePart('sobre-open-graph');
                const uploadPath = `public/uploads/${Date.now()}-${label}.${fileExt}`;
                await cmsApi('write', uploadPath, {
                    content: base64Content,
                    isBase64: true,
                    message: 'CMS: Upload Open Graph Sobre',
                });
                configCopy.seo.image = uploadPath.replace('public', '');
            }
            const data = await cmsApi('write', 'src/data/sobre.json', {
                content: JSON.stringify(configCopy, null, 2), sha: fileSha || undefined, message: 'CMS: Update sobre.json'
            });
            setFileSha(data.sha);
            setConfig(configCopy);
            setPendingSeoImage(null);
            triggerToast('Página Sobre atualizada!', 'success', 100);
        } catch (err: any) { setError(err.message); triggerToast(`Erro: ${err.message}`, 'error'); }
        finally { setSaving(false); }
    };

    const set = (path: string, value: any) => {
        setConfig(prev => {
            if (!prev) return prev;
            const clone = JSON.parse(JSON.stringify(prev));
            const keys = path.split('.');
            let obj: any = clone;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
                obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = value;
            return clone;
        });
    };

    const addItem = (path: string, item: any) => {
        setConfig(prev => {
            if (!prev) return prev;
            const clone = JSON.parse(JSON.stringify(prev));
            const keys = path.split('.');
            let obj: any = clone;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
                obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = [...(obj[keys[keys.length - 1]] || []), item];
            return clone;
        });
    };

    const removeItem = (path: string, index: number) => {
        setConfig(prev => {
            if (!prev) return prev;
            const clone = JSON.parse(JSON.stringify(prev));
            const keys = path.split('.');
            let obj: any = clone;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
                obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = (obj[keys[keys.length - 1]] || []).filter((_: any, i: number) => i !== index);
            return clone;
        });
    };

    const selectSeoImage = (file?: File) => {
        if (!file) return;
        set('seo.image', URL.createObjectURL(file));
        setPendingSeoImage(file);
        triggerToast('Imagem selecionada. Clique em Salvar para enviar.', 'success', 100);
    };

    const ImageUploadField = ({ label, value, placeholder }: { label: string; value: string; placeholder: string }) => (
        <div>
            <label className={labelClass}>{label}</label>
            <div className="grid grid-cols-[180px_1fr] gap-4 items-stretch">
                <label className="group relative min-h-36 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:border-indigo-500 hover:bg-indigo-50/40 cursor-pointer overflow-hidden flex items-center justify-center transition-all">
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => selectSeoImage(e.target.files?.[0])}
                    />
                    {value ? (
                        <img src={value} alt={label} className="absolute inset-0 w-full h-full object-cover group-hover:opacity-60 transition-opacity" />
                    ) : (
                        <ImageIcon className="w-8 h-8 text-slate-300 group-hover:text-indigo-500" />
                    )}
                    <span className="relative z-10 inline-flex items-center gap-1 rounded-lg bg-white/90 px-3 py-2 text-xs font-bold text-slate-800 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        <UploadCloud className="w-3.5 h-3.5" />
                        {value ? 'Trocar' : 'Enviar'}
                    </span>
                </label>
                <div className="space-y-2">
                    <input
                        className={inputClass}
                        value={value || ''}
                        onChange={e => {
                            set('seo.image', e.target.value);
                            setPendingSeoImage(null);
                        }}
                        placeholder={placeholder}
                    />
                    <p className="text-xs text-slate-500">
                        Cole uma URL/caminho ou envie uma imagem do computador. Ideal: 1200x630px.
                    </p>
                    {pendingSeoImage && (
                        <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">
                            Upload pendente: {pendingSeoImage.name}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );

    if (loading) return <div className="flex items-center justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;
    if (!config) return <div className="p-8 text-red-600">Erro ao carregar sobre.json</div>;

    return (
        <div className="space-y-6 pb-32">
            {/* Header */}
            <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl p-5 px-8 rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 sticky top-0 z-40">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Editor da Página Sobre</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Edite todas as seções da página /sobre</p>
                </div>
                <button onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/25">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                </button>
            </div>

            {error && <div className="p-4 bg-red-100 text-red-700 rounded-xl font-bold"><AlertCircle className="w-4 h-4 inline mr-2" />{error}</div>}

            {/* HERO */}
            <SectionCard title="Hero (Topo da Página)" icon={<Sparkles className="w-5 h-5 text-amber-500" />} defaultOpen={true}>
                <div className="space-y-4">
                    <div>
                        <label className={labelClass}>Etiqueta (label)</label>
                        <input className={inputClass} value={config.hero.label || ''} onChange={e => set('hero.label', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Título</label>
                            <input className={inputClass} value={config.hero.title || ''} onChange={e => set('hero.title', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClass}>Título Acento (itálico)</label>
                            <input className={inputClass} value={config.hero.titleAccent || ''} onChange={e => set('hero.titleAccent', e.target.value)} />
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* STORY */}
            <SectionCard title="Textos e estatísticas do topo" icon={<BookOpen className="w-5 h-5 text-blue-500" />}>
                <div className="space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className={labelClass}>Parágrafos</label>
                            <button onClick={() => addItem('hero.paragraphs', '')} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-bold">
                                <Plus className="w-3 h-3" /> Adicionar
                            </button>
                        </div>
                        <div className="space-y-2">
                            {(config.hero.paragraphs || []).map((p, i) => (
                                <div key={i} className="flex gap-2">
                                    <textarea className={inputClass} rows={3} value={p} onChange={e => {
                                        const arr = [...config.hero.paragraphs]; arr[i] = e.target.value; set('hero.paragraphs', arr);
                                    }} />
                                    <button onClick={() => removeItem('hero.paragraphs', i)} className="text-red-500 hover:bg-red-50 rounded-lg px-2"><Trash2 className="w-4 h-4" /></button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className={labelClass}>Stats (4 cards à direita)</label>
                            <button onClick={() => addItem('hero.stats', { number: '', label: '' })} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-bold">
                                <Plus className="w-3 h-3" /> Adicionar
                            </button>
                        </div>
                        <div className="space-y-2">
                            {(config.hero.stats || []).map((s, i) => (
                                <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
                                    <input className={inputClass} placeholder="Número" value={s.number} onChange={e => {
                                        const arr = [...config.hero.stats]; arr[i] = { ...arr[i], number: e.target.value }; set('hero.stats', arr);
                                    }} />
                                    <input className={inputClass} placeholder="Label" value={s.label} onChange={e => {
                                        const arr = [...config.hero.stats]; arr[i] = { ...arr[i], label: e.target.value }; set('hero.stats', arr);
                                    }} />
                                    <button onClick={() => removeItem('hero.stats', i)} className="text-red-500 hover:bg-red-50 rounded-lg px-2 py-3"><Trash2 className="w-4 h-4" /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* MISSION */}
            <SectionCard title="Nossa missão" icon={<Star className="w-5 h-5 text-purple-500" />}>
                <div className="space-y-4">
                    <div>
                        <label className={labelClass}>Etiqueta</label>
                        <input className={inputClass} value={config.mission.label || ''} onChange={e => set('mission.label', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelClass}>Título</label>
                        <input className={inputClass} value={config.mission.title || ''} onChange={e => set('mission.title', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelClass}>Subtítulo</label>
                        <textarea className={inputClass} rows={2} value={config.mission.subtitle || ''} onChange={e => set('mission.subtitle', e.target.value)} />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className={labelClass}>Cards da missão</label>
                            <button onClick={() => addItem('mission.items', { number: '', title: '', text: '' })} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-bold">
                                <Plus className="w-3 h-3" /> Adicionar
                            </button>
                        </div>
                        <div className="space-y-3">
                            {(config.mission.items || []).map((v, i) => (
                                <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-bold text-slate-500">Card #{i + 1}</span>
                                        <button onClick={() => removeItem('mission.items', i)} className="text-red-500 hover:bg-red-50 rounded p-1"><Trash2 className="w-3 h-3" /></button>
                                    </div>
                                    <div className="grid grid-cols-[80px_1fr] gap-2">
                                        <input className={inputClass} placeholder="01" value={v.number} onChange={e => {
                                            const arr = [...config.mission.items]; arr[i] = { ...arr[i], number: e.target.value }; set('mission.items', arr);
                                        }} />
                                        <input className={inputClass} placeholder="Título" value={v.title} onChange={e => {
                                            const arr = [...config.mission.items]; arr[i] = { ...arr[i], title: e.target.value }; set('mission.items', arr);
                                        }} />
                                    </div>
                                    <textarea className={inputClass} rows={2} placeholder="Descrição" value={v.text} onChange={e => {
                                        const arr = [...config.mission.items]; arr[i] = { ...arr[i], text: e.target.value }; set('mission.items', arr);
                                    }} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* VALUES */}
            <SectionCard title="Nossos valores" icon={<BookOpen className="w-5 h-5 text-emerald-500" />}>
                <div className="space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className={labelClass}>Cards de valores</label>
                            <button onClick={() => addItem('values', { title: '', text: '' })} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-bold">
                                <Plus className="w-3 h-3" /> Adicionar
                            </button>
                        </div>
                        <div className="space-y-3">
                            {(config.values || []).map((t, i) => (
                                <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-bold text-slate-500">Valor #{i + 1}</span>
                                        <button onClick={() => removeItem('values', i)} className="text-red-500 hover:bg-red-50 rounded p-1"><Trash2 className="w-3 h-3" /></button>
                                    </div>
                                    <input className={inputClass} placeholder="Título" value={t.title} onChange={e => {
                                        const arr = [...config.values]; arr[i] = { ...arr[i], title: e.target.value }; set('values', arr);
                                    }} />
                                    <textarea className={inputClass} rows={2} placeholder="Texto" value={t.text} onChange={e => {
                                        const arr = [...config.values]; arr[i] = { ...arr[i], text: e.target.value }; set('values', arr);
                                    }} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* CTA */}
            <SectionCard title="CTA Final" icon={<Megaphone className="w-5 h-5 text-rose-500" />}>
                <div className="space-y-4">
                    <div>
                        <label className={labelClass}>Título</label>
                        <input className={inputClass} value={config.cta.title || ''} onChange={e => set('cta.title', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelClass}>Texto</label>
                        <textarea className={inputClass} rows={2} value={config.cta.text || ''} onChange={e => set('cta.text', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Botão Primário - Texto</label>
                            <input className={inputClass} value={config.cta.ctaPrimary?.text || ''} onChange={e => set('cta.ctaPrimary.text', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClass}>Botão Primário - Link</label>
                            <input className={inputClass} value={config.cta.ctaPrimary?.href || ''} onChange={e => set('cta.ctaPrimary.href', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClass}>Botão Secundário - Texto</label>
                            <input className={inputClass} value={config.cta.ctaSecondary?.text || ''} onChange={e => set('cta.ctaSecondary.text', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClass}>Botão Secundário - Link</label>
                            <input className={inputClass} value={config.cta.ctaSecondary?.href || ''} onChange={e => set('cta.ctaSecondary.href', e.target.value)} />
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* SEO */}
            <SectionCard title="SEO" icon={<Search className="w-5 h-5 text-slate-500" />}>
                <div className="space-y-4">
                    <div>
                        <label className={labelClass}>Título SEO</label>
                        <input className={inputClass} value={config.seo?.title || ''} onChange={e => set('seo.title', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelClass}>Meta Descrição</label>
                        <textarea className={inputClass} rows={3} value={config.seo?.description || ''} onChange={e => set('seo.description', e.target.value)} />
                    </div>
                    <div>
                        <ImageUploadField
                            label="Imagem Open Graph (URL)"
                            value={config.seo?.image || ''}
                            placeholder="/images/og-sobre.jpg"
                        />
                    </div>
                </div>
            </SectionCard>
        </div>
    );
}
