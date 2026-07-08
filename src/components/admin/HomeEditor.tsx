import React, { useState, useEffect } from 'react';
import { Save, Loader2, AlertCircle, Plus, Trash2, BarChart3, Users, ChevronDown, ChevronUp, Image as ImageIcon, UploadCloud } from 'lucide-react';
import { triggerToast } from './CmsToaster';
import { cmsApi } from '../../lib/adminApi';

type CTA = { text: string; href: string };
type Feature = { number: string; title: string; description: string };

type HomeConfig = {
    socialImage?: string;
    postsGrid: {
        title: string;
        subtitle: string;
        limit: number;
        ctaText: string;
        ctaHref: string;
    };
    about: {
        label: string;
        title: string;
        titleAccent: string;
        text1: string;
        text2: string;
        imagePrimary?: string;
        imageSecondary?: string;
        ctaPrimary: CTA;
        ctaSecondary: CTA;
        features: Feature[];
    };
};

const inputClass = "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none text-sm";
const labelClass = "block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5";

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result?.toString() || '').split(',')[1] || '');
    reader.onerror = error => reject(error);
});

function setNestedValue(target: any, path: string, value: any) {
    const keys = path.split('.');
    let obj = target;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = value;
}

function safeFilePart(value: string) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'home-image';
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

export default function HomeEditor() {
    const [config, setConfig] = useState<HomeConfig | null>(null);
    const [fileSha, setFileSha] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [pendingImages, setPendingImages] = useState<Record<string, File>>({});

    useEffect(() => {
        cmsApi('read', 'src/data/home.json')
            .then(data => { setConfig(JSON.parse(data?.content || '{}')); setFileSha(data.sha); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const save = async () => {
        if (!config) return;
        setSaving(true); setError('');
        triggerToast('Salvando configurações da home...', 'progress', 20);
        try {
            const data = await cmsApi('write', 'src/data/home.json', {
                content: JSON.stringify(config, null, 2), sha: fileSha || undefined, message: 'CMS: Update home.json'
            });
            setFileSha(data.sha);
            triggerToast('Home atualizada com sucesso!', 'success', 100);
        } catch (err: any) { setError(err.message); triggerToast(`Erro: ${err.message}`, 'error'); }
        finally { setSaving(false); }
    };

    const set = (path: string, value: any) => {
        setConfig(prev => {
            if (!prev) return prev;
            const clone = JSON.parse(JSON.stringify(prev));
            const keys = path.split('.');
            let obj: any = clone;
            for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
            obj[keys[keys.length - 1]] = value;
            return clone;
        });
    };

    const saveWithUploads = async () => {
        if (!config) return;
        setSaving(true); setError('');
        triggerToast('Salvando configuraÃ§Ãµes da home...', 'progress', 20);
        try {
            const configCopy = JSON.parse(JSON.stringify(config));
            const pendingEntries = Object.entries(pendingImages);
            for (let i = 0; i < pendingEntries.length; i++) {
                const [path, file] = pendingEntries[i];
                triggerToast(`Enviando imagem ${i + 1}/${pendingEntries.length}...`, 'progress', 25 + i * 15);
                const base64Content = await fileToBase64(file);
                const rawExt = file.name.split('.').pop()?.toLowerCase() || 'png';
                const fileExt = rawExt.replace(/[^a-z0-9]/g, '') || 'png';
                const label = safeFilePart(path.replace(/\./g, '-'));
                const uploadPath = `public/uploads/${Date.now()}-${label}.${fileExt}`;
                await cmsApi('write', uploadPath, {
                    content: base64Content,
                    isBase64: true,
                    message: `CMS: Upload imagem da home ${label}`,
                });
                setNestedValue(configCopy, path, uploadPath.replace('public', ''));
            }

            const data = await cmsApi('write', 'src/data/home.json', {
                content: JSON.stringify(configCopy, null, 2),
                sha: fileSha || undefined,
                message: 'CMS: Update home.json',
            });
            setFileSha(data.sha);
            setConfig(configCopy);
            setPendingImages({});
            triggerToast('Home atualizada com sucesso!', 'success', 100);
        } catch (err: any) {
            setError(err.message);
            triggerToast(`Erro: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const selectImage = (path: string, file?: File) => {
        if (!file) return;
        set(path, URL.createObjectURL(file));
        setPendingImages(prev => ({ ...prev, [path]: file }));
        triggerToast('Imagem selecionada. Clique em Salvar para enviar.', 'success', 100);
    };

    const ImageField = ({ label, path, value, placeholder }: { label: string; path: string; value: string; placeholder: string }) => (
        <div>
            <label className={labelClass}>{label}</label>
            <div className="grid grid-cols-[160px_1fr] gap-4 items-stretch">
                <label className="group relative min-h-36 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:border-indigo-500 hover:bg-indigo-50/40 cursor-pointer overflow-hidden flex items-center justify-center transition-all">
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => selectImage(path, e.target.files?.[0])}
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
                            set(path, e.target.value);
                            setPendingImages(prev => {
                                const next = { ...prev };
                                delete next[path];
                                return next;
                            });
                        }}
                        placeholder={placeholder}
                    />
                    <p className="text-xs text-slate-500">
                        Cole um caminho manualmente ou envie uma imagem do computador. Ao salvar, ela vira um caminho em <code className="bg-slate-100 px-1 rounded">/uploads</code>.
                    </p>
                    {pendingImages[path] && (
                        <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">
                            Upload pendente: {pendingImages[path].name}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );

    if (loading) return <div className="flex items-center justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;
    if (!config) return <div className="p-8 text-red-600">Erro ao carregar home.json</div>;

    return (
        <div className="space-y-6 pb-32">
            {/* Header */}
            <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl p-5 px-8 rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 sticky top-0 z-40">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Editor da Home</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Edite todas as seções da página inicial</p>
                </div>
                <button onClick={saveWithUploads} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/25">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                </button>
            </div>

            {error && <div className="p-4 bg-red-100 text-red-700 rounded-xl font-bold"><AlertCircle className="w-4 h-4 inline mr-2" />{error}</div>}

            <SectionCard title="SEO / Redes sociais" icon={<ImageIcon className="w-5 h-5 text-purple-500" />} defaultOpen={true}>
                <div className="space-y-4">
                    <ImageField
                        label="Imagem de compartilhamento"
                        path="socialImage"
                        value={config.socialImage || ''}
                        placeholder="/images/og-default.svg"
                    />
                    <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 text-sm text-indigo-900">
                        Essa imagem aparece quando a Home for compartilhada no WhatsApp, Facebook, LinkedIn e outras redes sociais.
                        Use preferencialmente uma imagem horizontal em 1200x630px.
                    </div>
                </div>
            </SectionCard>

            {/* POSTS GRID */}
            <SectionCard title="Grid de Posts" icon={<BarChart3 className="w-5 h-5 text-blue-500" />} defaultOpen={true}>
                <div className="space-y-4">
                    <div>
                        <div>
                            <label className={labelClass}>Título</label>
                            <input className={inputClass} value={config.postsGrid.title} onChange={e => set('postsGrid.title', e.target.value)} />
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>Subtítulo</label>
                        <textarea className={inputClass} rows={2} value={config.postsGrid.subtitle} onChange={e => set('postsGrid.subtitle', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={labelClass}>Limite de Posts</label>
                            <input type="number" className={inputClass} value={config.postsGrid.limit} onChange={e => set('postsGrid.limit', parseInt(e.target.value) || 6)} min={1} max={12} />
                        </div>
                        <div>
                            <label className={labelClass}>Texto do Botão</label>
                            <input className={inputClass} value={config.postsGrid.ctaText} onChange={e => set('postsGrid.ctaText', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClass}>Link do Botão</label>
                            <input className={inputClass} value={config.postsGrid.ctaHref} onChange={e => set('postsGrid.ctaHref', e.target.value)} />
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* ABOUT */}
            <SectionCard title="Seção Sobre" icon={<Users className="w-5 h-5 text-green-500" />}>
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={labelClass}>Label</label>
                            <input className={inputClass} value={config.about.label} onChange={e => set('about.label', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClass}>Título</label>
                            <input className={inputClass} value={config.about.title} onChange={e => set('about.title', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelClass}>Título Destaque (itálico)</label>
                            <input className={inputClass} value={config.about.titleAccent} onChange={e => set('about.titleAccent', e.target.value)} />
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>Parágrafo 1</label>
                        <textarea className={inputClass} rows={3} value={config.about.text1} onChange={e => set('about.text1', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelClass}>Parágrafo 2</label>
                        <textarea className={inputClass} rows={3} value={config.about.text2} onChange={e => set('about.text2', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <ImageField label="Imagem Principal do Sobre" path="about.imagePrimary" value={config.about.imagePrimary || ''} placeholder="/images/credencial-negocios.jpg" />
                        <ImageField label="Imagem SecundÃ¡ria do Sobre" path="about.imageSecondary" value={config.about.imageSecondary || ''} placeholder="/images/credencial-eventos.jpg" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Botão Primário</label>
                            <div className="grid grid-cols-2 gap-2">
                                <input className={inputClass} value={config.about.ctaPrimary.text} onChange={e => set('about.ctaPrimary.text', e.target.value)} placeholder="Texto" />
                                <input className={inputClass} value={config.about.ctaPrimary.href} onChange={e => set('about.ctaPrimary.href', e.target.value)} placeholder="Link" />
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Botão Secundário</label>
                            <div className="grid grid-cols-2 gap-2">
                                <input className={inputClass} value={config.about.ctaSecondary.text} onChange={e => set('about.ctaSecondary.text', e.target.value)} placeholder="Texto" />
                                <input className={inputClass} value={config.about.ctaSecondary.href} onChange={e => set('about.ctaSecondary.href', e.target.value)} placeholder="Link" />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>Features / Diferenciais</label>
                        {config.about.features.map((feat, i) => (
                            <div key={i} className="grid grid-cols-[0.3fr_1fr_2fr_auto] gap-2 mb-2">
                                <input className={inputClass} value={feat.number} onChange={e => { const f = [...config.about.features]; f[i] = { ...f[i], number: e.target.value }; set('about.features', f); }} placeholder="01" />
                                <input className={inputClass} value={feat.title} onChange={e => { const f = [...config.about.features]; f[i] = { ...f[i], title: e.target.value }; set('about.features', f); }} placeholder="Título" />
                                <input className={inputClass} value={feat.description} onChange={e => { const f = [...config.about.features]; f[i] = { ...f[i], description: e.target.value }; set('about.features', f); }} placeholder="Descrição" />
                                <button onClick={() => set('about.features', config.about.features.filter((_, j) => j !== i))} className="p-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                            </div>
                        ))}
                        <button onClick={() => set('about.features', [...config.about.features, { number: `0${config.about.features.length + 1}`, title: '', description: '' }])} className="text-xs text-indigo-600 font-bold flex items-center gap-1 mt-1"><Plus className="w-3 h-3" /> Adicionar Feature</button>
                    </div>
                </div>
            </SectionCard>
        </div>
    );
}
