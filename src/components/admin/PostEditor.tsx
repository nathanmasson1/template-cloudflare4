import React, { useState, useEffect } from 'react';
import { Save, AlertCircle, Loader2, ArrowLeft, Image as ImageIcon } from 'lucide-react';
import { marked } from 'marked';
import { triggerToast } from './CmsToaster';
import { cmsApi } from '../../lib/adminApi';
import SEOScoreWidget from '../../plugins/seo/SEOScoreWidget';

declare global {
    interface Window {
        tinymce?: any;
        __tinymcePromise?: Promise<void>;
    }
}

interface PostEditorProps {
    filePath: string | null; // null = novo post
}

const TINYMCE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.3/tinymce.min.js';
const TINYMCE_EDITOR_ID = 'contentEditor';

function slugify(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' e ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

function slugFromPath(path: string): string {
    return slugify(path.split('/').pop()?.replace(/\.md$/i, '') || '');
}

function loadTinyMceScript(): Promise<void> {
    if (window.tinymce) return Promise.resolve();
    if (window.__tinymcePromise) return window.__tinymcePromise;

    window.__tinymcePromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${TINYMCE_SRC}"]`) as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Nao foi possivel carregar o TinyMCE.')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = TINYMCE_SRC;
        script.referrerPolicy = 'origin';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Nao foi possivel carregar o TinyMCE.'));
        document.head.appendChild(script);
    });

    return window.__tinymcePromise;
}

export default function PostEditor({ filePath }: PostEditorProps) {
    const isEditing = !!filePath;
    const [loading, setLoading] = useState(isEditing);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [authors, setAuthors] = useState<any[]>([]);
    const [dynamicCategories, setDynamicCategories] = useState<any[]>([]);
    const [fileSha, setFileSha] = useState('');
    const [savedFilePath, setSavedFilePath] = useState(filePath || '');
    const [pendingUploads, setPendingUploads] = useState<Record<string, File>>({});
    const [tinyStatus, setTinyStatus] = useState<'loading' | 'ready' | 'error'>('loading');

    const formatLocalDateInput = (d = new Date()) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const formatLocalDateTimeInput = (d = new Date()) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${formatLocalDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const todayDateInput = () => formatLocalDateInput();

    const isFuturePublishAt = (value: string) => {
        const d = new Date(value);
        return !isNaN(d.getTime()) && d.getTime() > Date.now();
    };

    const formatDateForInput = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return todayDateInput();
            return d.toISOString().split('T')[0];
        } catch { return todayDateInput(); }
    };

    const formatDateTimeForInput = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '';
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch { return ''; }
    };

    const [post, setPost] = useState({
        title: '', slug: '', description: '', pubDate: todayDateInput(), publishAt: formatLocalDateTimeInput(),
        image: '', category: '', author: '', draft: false, scheduledAt: '', content: ''
    });

    useEffect(() => {
        if (loading) return;

        let cancelled = false;
        setTinyStatus('loading');

        loadTinyMceScript()
            .then(() => {
                if (cancelled) return;
                const target = document.getElementById(TINYMCE_EDITOR_ID);
                if (!target || !window.tinymce) return;

                const existing = window.tinymce.get(TINYMCE_EDITOR_ID);
                if (existing) existing.remove();

                window.tinymce.init({
                    selector: `#${TINYMCE_EDITOR_ID}`,
                    convert_urls: false,
                    height: 600,
                    plugins: 'advlist autolink lists link image media table code fullscreen',
                    toolbar: 'undo redo | blocks | bold italic | alignleft aligncenter alignright alignjustify | bullist numlist | link image media | code fullscreen',
                    link_title: false,
                    link_target_list: [
                        { title: 'Nova Aba (_blank)', value: '_blank' },
                        { title: 'Mesma Aba', value: '' },
                    ],
                    link_rel_list: [
                        { title: 'Nenhum', value: '' },
                        { title: 'Nofollow', value: 'nofollow' },
                        { title: 'Noopener Noreferrer', value: 'noopener noreferrer' },
                    ],
                    setup: (editor: any) => {
                        editor.on('init', () => {
                            if (!cancelled) setTinyStatus('ready');
                        });
                        editor.on('change keyup input undo redo SetContent', () => {
                            const content = editor.getContent();
                            setPost(p => p.content === content ? p : { ...p, content });
                        });
                    },
                });
            })
            .catch(() => {
                if (!cancelled) setTinyStatus('error');
            });

        return () => {
            cancelled = true;
            const editor = window.tinymce?.get(TINYMCE_EDITOR_ID);
            if (editor) {
                const content = editor.getContent();
                setPost(p => p.content === content ? p : { ...p, content });
                editor.remove();
            }
        };
    }, [loading, filePath]);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [authRes, catRes] = await Promise.allSettled([
                    cmsApi('read', 'src/data/authors.json'),
                    cmsApi('read', 'src/data/categories.json'),
                ]);
                if (authRes.status === 'fulfilled') { const p = JSON.parse(authRes.value?.content || "{}"); if (Array.isArray(p)) setAuthors(p); }
                if (catRes.status === 'fulfilled') { const p = JSON.parse(catRes.value?.content || "{}"); if (Array.isArray(p)) setDynamicCategories(p); }

                if (isEditing && filePath) {
                    setSavedFilePath(filePath);
                    const fileData = await cmsApi('read', filePath);
                    setFileSha(fileData.sha);
                    const text = fileData.content;
                    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
                    if (match) {
                        const fm = match[1];
                        const body = match[2].trim();
                        const extract = (key: string) => { const m = fm.match(new RegExp(`${key}:\\s*(?:"([^"]*)"|'([^']*)'|(.*))`)); return m ? (m[1] || m[2] || m[3] || '').trim() : ''; };
                        const parsedHtml = await marked.parse(body);
                        const loadedPubDate = extract('pubDate') ? formatDateForInput(extract('pubDate')) : todayDateInput();
                        const loadedScheduledAt = formatDateTimeForInput(extract('scheduledAt'));
                        setPost({
                            title: extract('title'), slug: slugFromPath(filePath),
                            description: extract('description'), pubDate: loadedPubDate, publishAt: loadedScheduledAt || `${loadedPubDate}T00:00`,
                            image: extract('image'), category: extract('category') || 'reviews', author: extract('author'),
                            draft: extract('draft') === 'true', scheduledAt: loadedScheduledAt, content: parsedHtml
                        });
                    } else {
                        setPost(p => ({ ...p, content: String(marked.parse(text)), slug: slugFromPath(filePath) }));
                    }
                }
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filePath, isEditing]);

    const handleTitleChange = (val: string) => {
        setPost(p => ({ ...p, title: val, slug: isEditing ? p.slug : slugify(val) }));
    };

    const syncTinyContent = () => {
        const editor = window.tinymce?.get(TINYMCE_EDITOR_ID);
        if (!editor) return post.content;
        const content = editor.getContent();
        setPost(p => p.content === content ? p : { ...p, content });
        return content;
    };

    const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, uiKey: string) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPendingUploads(prev => ({ ...prev, [uiKey]: file }));
        if (uiKey === 'image') setPost(p => ({ ...p, image: URL.createObjectURL(file) }));
        e.target.value = '';
    };

    const extractAndUploadInlineImages = async (html: string) => {
        const imgRegex = /<img[^>]+src="data:image\/([^;]+);base64,([^"]+)"[^>]*>/g;
        let modifiedHtml = html;
        const matches = [...html.matchAll(imgRegex)];
        for (const m of matches) {
            const ext = m[1]; const base64Content = m[2];
            const uploadPath = `public/uploads/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
            await cmsApi('write', uploadPath, { content: base64Content, isBase64: true, message: `Upload imagem inline ${uploadPath}` });
            modifiedHtml = modifiedHtml.replace(`data:image/${ext};base64,${base64Content}`, uploadPath.replace('public', ''));
        }
        return modifiedHtml;
    };

    const handleSave = async (e?: React.FormEvent, saveAsDraft = false) => {
        if (e) e.preventDefault();
        const normalizedSlug = slugify(post.slug || post.title);
        if (!post.title || !normalizedSlug) { setError('Título e Slug (URL) são obrigatórios.'); return; }
        setSaving(true); setError('');
        triggerToast(saveAsDraft ? 'Salvando rascunho...' : 'Processando e salvando artigo...', 'progress', 20);
        try {
            const latestContent = syncTinyContent();
            let finalHeroImage = post.image;
            if (pendingUploads['image']) {
                const fileObj = pendingUploads['image'];
                const base64Content = await fileToBase64(fileObj);
                const fileExt = fileObj.name.split('.').pop() || 'jpg';
                const uploadPath = `public/uploads/${Date.now()}-blog-cover.${fileExt}`;
                await cmsApi('write', uploadPath, { content: base64Content, isBase64: true, message: `Upload capa blog ${uploadPath}` });
                finalHeroImage = uploadPath.replace('public', '');
            }
            const cleanedContent = latestContent.replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ');
            const finalHtmlContent = await extractAndUploadInlineImages(cleanedContent);
            const selectedPublishAt = post.publishAt || formatLocalDateTimeInput();
            const publishDate = selectedPublishAt.split('T')[0] || post.pubDate || todayDateInput();
            const shouldSchedule = !saveAsDraft && isFuturePublishAt(selectedPublishAt);
            const scheduledAt = shouldSchedule ? new Date(selectedPublishAt).toISOString() : '';
            const pubDateForMarkdown = publishDate;
            const effectiveDraft = saveAsDraft || shouldSchedule;
            const scheduledLine = scheduledAt ? `\nscheduledAt: "${scheduledAt}"` : '';
            const markdown = `---\ntitle: "${post.title.replace(/"/g, '\\"')}"\ndescription: "${post.description.replace(/"/g, '\\"')}"\npubDate: "${pubDateForMarkdown}"\nimage: "${finalHeroImage}"\ncategory: "${post.category}"\nauthor: "${post.author}"\ndraft: ${effectiveDraft}${scheduledLine}\n---\n${finalHtmlContent}`;
            const targetPath = `src/content/blog/${normalizedSlug}.md`;
            const previousPath = savedFilePath || filePath || '';
            const isRename = isEditing && previousPath && previousPath !== targetPath;
            const res = await cmsApi('write', targetPath, {
                content: markdown,
                sha: isRename ? undefined : fileSha || undefined,
                message: `CMS: ${isEditing ? 'Edição' : 'Criação'} do artigo ${normalizedSlug}`,
            });
            if (isRename) {
                await cmsApi('delete', previousPath, { sha: fileSha, message: `CMS: Removendo slug antigo ${previousPath}` });
            }
            if (res.sha) setFileSha(res.sha);
            setPost(p => ({ ...p, slug: normalizedSlug }));
            setSavedFilePath(targetPath);
            setPendingUploads({});
            triggerToast(saveAsDraft ? 'Rascunho salvo com sucesso!' : 'Artigo salvo com sucesso!', 'success', 100);
            if (!isEditing) setTimeout(() => { window.location.href = '/admin/posts'; }, 1500);
        } catch (err: any) {
            setError(err.message); triggerToast(`Erro: ${err.message}`, 'error');
        } finally { setSaving(false); }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white rounded-3xl border border-slate-200">
            <Loader2 className="w-8 h-8 animate-spin mb-4 text-violet-500" />
            <p className="font-medium animate-pulse">Carregando editor...</p>
        </div>
    );

    const inputClass = "w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all shadow-sm";
    const labelClass = "block text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 ml-1";
    const publishAtIsFuture = isFuturePublishAt(post.publishAt);
    const handlePublishAtChange = (value: string) => {
        const nextValue = value || formatLocalDateTimeInput();
        const nextDate = nextValue.split('T')[0] || todayDateInput();
        const nextIsFuture = isFuturePublishAt(nextValue);
        setPost(p => ({
            ...p,
            publishAt: nextValue,
            pubDate: nextDate,
            scheduledAt: nextIsFuture ? nextValue : '',
            draft: nextIsFuture,
        }));
    };

    return (
        <div className="max-w-5xl pb-32">
            {/* Fixed header bar */}
            <div className="flex items-center justify-between bg-white p-4 px-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
                <div className="flex items-center gap-3">
                    <a href="/admin/posts" className="text-slate-400 hover:text-violet-600 transition-colors p-1.5 rounded-lg hover:bg-violet-50"><ArrowLeft className="w-5 h-5" /></a>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{isEditing ? 'Editar Artigo' : 'Novo Artigo'}</h2>
                        {post.slug && <p className="text-xs font-mono text-slate-400">/{post.slug}</p>}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button type="button" onClick={() => handleSave(undefined, true)} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg text-sm font-bold transition-colors">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {saving ? 'Salvando...' : 'Salvar como rascunho'}
                    </button>
                    <button onClick={handleSave} disabled={saving} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-sm shadow-violet-600/20">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        {saving ? 'Salvando...' : <><Save className="w-4 h-4" /> {publishAtIsFuture ? 'Agendar' : isEditing ? 'Salvar e publicar' : 'Publicar'}</>}
                    </button>
                </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-700 border-l-4 border-red-500 text-sm font-medium mb-6 rounded-r-xl flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}

            <div className="flex gap-6 items-start">
                {/* Main Editor Area */}
                <div className="flex-1 min-w-0 space-y-6">
                    {/* Title */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <label className={labelClass}>Título do Artigo *</label>
                        <input type="text" value={post.title} onChange={e => handleTitleChange(e.target.value)} className={inputClass} placeholder="Título do artigo..." />
                        <div className="mt-3">
                            <label className={labelClass}>Slug (URL) *</label>
                            <input
                                type="text"
                                value={post.slug}
                                onChange={e => setPost(p => ({ ...p, slug: slugify(e.target.value) }))}
                                onBlur={e => setPost(p => ({ ...p, slug: slugify(e.target.value || p.title) }))}
                                className={`${inputClass} font-mono text-xs`}
                                placeholder="url-do-artigo"
                            />
                        </div>
                        <div className="mt-3">
                            <label className={labelClass}>Descrição / Meta Description</label>
                            <textarea rows={2} value={post.description} onChange={e => setPost(p => ({ ...p, description: e.target.value }))} className={`${inputClass} resize-none`} placeholder="Breve descrição do artigo..." />
                        </div>
                    </div>

                    {/* Content Editor */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <label className={labelClass}>Conteúdo do Artigo</label>
                        <div>
                                <textarea
                                    id={TINYMCE_EDITOR_ID}
                                    defaultValue={post.content}
                                    className="min-h-[600px] w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800"
                                />
                                {tinyStatus === 'loading' && (
                                    <div className="flex items-center justify-center p-4 text-slate-400">
                                        <Loader2 className="w-5 h-5 animate-spin mr-2" />Carregando TinyMCE...
                                    </div>
                                )}
                                {tinyStatus === 'error' && (
                                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                        Nao foi possivel carregar o TinyMCE pelo CDN. Verifique a conexao e recarregue a pagina.
                                    </div>
                                )}
                        </div>
                    </div>
                </div>

                {/* Sidebar */}
                <div className="w-72 shrink-0 space-y-4 sticky top-4">
                    {/* Publish Settings */}
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="font-bold text-slate-700 text-sm border-b border-slate-100 pb-3 mb-4">Publicação</h3>
                        <div className="space-y-4">
                            <div>
                                <label className={labelClass}>Data e hora da publicação</label>
                                <input type="datetime-local" value={post.publishAt} onChange={e => handlePublishAtChange(e.target.value)} className={inputClass} />
                                <p className={`mt-2 text-xs leading-relaxed ${publishAtIsFuture ? 'text-violet-600' : 'text-green-600'}`}>
                                    {publishAtIsFuture ? 'Status: agendado para a data e hora escolhidas.' : 'Status: publicado ao salvar.'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Category & Author */}
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="font-bold text-slate-700 text-sm border-b border-slate-100 pb-3 mb-4">Metadados</h3>
                        <div className="space-y-4">
                            <div>
                                <label className={labelClass}>Categoria</label>
                                {dynamicCategories.length > 0 ? (
                                    <select value={post.category} onChange={e => setPost(p => ({ ...p, category: e.target.value }))} className={inputClass}>
                                        <option value="">Selecionar categoria...</option>
                                        {dynamicCategories.map(cat => {
                                            const slug = typeof cat === 'string' ? cat : cat.slug || cat.name;
                                            const label = typeof cat === 'string' ? cat : cat.name || cat.slug;
                                            return <option key={slug} value={slug}>{label}</option>;
                                        })}
                                    </select>
                                ) : (
                                    <input type="text" value={post.category} onChange={e => setPost(p => ({ ...p, category: e.target.value }))} className={inputClass} placeholder="Ex: Tecnologia" />
                                )}
                            </div>
                            <div>
                                <label className={labelClass}>Autor</label>
                                {authors.length > 0 ? (
                                    <select value={post.author} onChange={e => setPost(p => ({ ...p, author: e.target.value }))} className={inputClass}>
                                        <option value="">Selecionar autor...</option>
                                        {authors.map(a => <option key={a.id || a.slug || a.name} value={a.name}>{a.name}</option>)}
                                    </select>
                                ) : (
                                    <input type="text" value={post.author} onChange={e => setPost(p => ({ ...p, author: e.target.value }))} className={inputClass} placeholder="Nome do autor" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Hero Image */}
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="font-bold text-slate-700 text-sm border-b border-slate-100 pb-3 mb-4">Imagem de Capa</h3>
                        <label className="group relative border-2 border-dashed border-slate-200 hover:border-violet-400 bg-slate-50 hover:bg-violet-50 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all text-center overflow-hidden" style={{ minHeight: '120px' }}>
                            <input type="file" accept="image/*" className="hidden" onChange={e => handleFileSelect(e, 'image')} />
                            {post.image ? (
                                <>
                                    <img src={post.image} alt="Capa" className="absolute inset-0 w-full h-full object-cover group-hover:opacity-60 transition-opacity" />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-white/20">
                                        <ImageIcon className="w-8 h-8 text-slate-800" />
                                        <span className="text-xs font-bold text-slate-900 mt-1">Trocar imagem</span>
                                    </div>
                                </>
                            ) : (
                                <div className="py-6 flex flex-col items-center text-slate-400 group-hover:text-violet-500 transition-colors">
                                    <ImageIcon className="w-8 h-8 mb-2" />
                                    <span className="text-xs font-bold">Enviar imagem de capa</span>
                                </div>
                            )}
                        </label>
                        {pendingUploads['image'] && <span className="text-[10px] text-amber-600 font-bold block mt-2">Upload pendente — será enviado ao salvar</span>}
                    </div>

                    {/* SEO Score Widget */}
                    <SEOScoreWidget
                        title={post.title}
                        description={post.description}
                        image={post.image}
                        content={post.content}
                    />
                </div>
            </div>
        </div>
    );
}
