import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { triggerToast } from '../../components/admin/CmsToaster';
import { cmsApi } from '../../lib/adminApi';

const CONFIG_PATH = 'src/data/pluginsConfig.json';

type LinkItem = {
  title: string;
  url: string;
  description: string;
};

type LlmsConfig = {
  enabled: boolean;
  summary: string;
  details: string;
  includeCorePages: boolean;
  includeCategories: boolean;
  includePosts: boolean;
  includeFeeds: boolean;
  maxPosts: number;
  extraLinks: LinkItem[];
  optionalLinks: LinkItem[];
};

const defaultConfig: LlmsConfig = {
  enabled: true,
  summary: '',
  details: 'Use este arquivo para encontrar rapidamente as principais paginas, categorias e artigos recentes do site.',
  includeCorePages: true,
  includeCategories: true,
  includePosts: true,
  includeFeeds: true,
  maxPosts: 50,
  extraLinks: [],
  optionalLinks: [],
};

function normalizeLinks(links: unknown): LinkItem[] {
  return Array.isArray(links)
    ? links.map((link: any) => ({
        title: String(link?.title || ''),
        url: String(link?.url || ''),
        description: String(link?.description || ''),
      }))
    : [];
}

function mergeConfig(value: any): LlmsConfig {
  return {
    ...defaultConfig,
    ...(value || {}),
    maxPosts: Math.max(1, Math.min(Number(value?.maxPosts || defaultConfig.maxPosts), 200)),
    extraLinks: normalizeLinks(value?.extraLinks),
    optionalLinks: normalizeLinks(value?.optionalLinks),
  };
}

function addBlankLink(links: LinkItem[]) {
  return [...links, { title: '', url: '', description: '' }];
}

function updateLink(links: LinkItem[], index: number, field: keyof LinkItem, value: string) {
  return links.map((link, i) => i === index ? { ...link, [field]: value } : link);
}

function removeLink(links: LinkItem[], index: number) {
  return links.filter((_, i) => i !== index);
}

export default function SettingsLlmsTxt() {
  const [config, setConfig] = useState<LlmsConfig>(defaultConfig);
  const [fullConfig, setFullConfig] = useState<any>(null);
  const [fileSha, setFileSha] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    cmsApi('read', CONFIG_PATH)
      .then(data => {
        const parsed = JSON.parse(data.content || '{}');
        setFullConfig(parsed);
        setFileSha(data.sha || '');
        setConfig(mergeConfig(parsed.llmsTxt));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const preview = useMemo(() => {
    const lines = [
      '# Nome do site',
      '',
      `> ${config.summary || 'Resumo curto do site, gerado a partir da descricao do site quando vazio.'}`,
      '',
      config.details || 'Detalhes opcionais sobre como interpretar o conteudo do site.',
      '',
    ];

    if (config.includeCorePages) {
      lines.push('## Paginas principais', '', '- [Pagina inicial](https://seusite.com.br/): Visao geral do site', '- [Blog](https://seusite.com.br/blog): Lista de artigos publicados', '');
    }
    if (config.includeCategories) {
      lines.push('## Categorias', '', '- [Nome da categoria](https://seusite.com.br/blog/categoria): Descricao da categoria', '');
    }
    if (config.includePosts) {
      lines.push('## Artigos recentes', '', `- [Titulo do artigo](https://seusite.com.br/post): Descricao curta do artigo`, '');
    }
    if (config.includeFeeds) {
      lines.push('## Feeds e mapas', '', '- [Sitemap](https://seusite.com.br/sitemap-index.xml): Mapa XML do site', '- [RSS](https://seusite.com.br/rss.xml): Feed RSS dos artigos', '');
    }
    if (config.optionalLinks.length) {
      lines.push('## Optional', '', '- [Link opcional](https://exemplo.com): Recurso secundario que pode ser ignorado em contextos curtos', '');
    }
    return lines.join('\n').trim();
  }, [config]);

  const set = <K extends keyof LlmsConfig>(key: K, value: LlmsConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    triggerToast('Salvando configuracao do LLMs.txt...', 'progress', 30);
    try {
      const cleanConfig = {
        ...config,
        maxPosts: Math.max(1, Math.min(Number(config.maxPosts || 50), 200)),
        extraLinks: config.extraLinks.filter(link => link.title.trim() && link.url.trim()),
        optionalLinks: config.optionalLinks.filter(link => link.title.trim() && link.url.trim()),
      };
      const updated = {
        ...(fullConfig || {}),
        llmsTxt: cleanConfig,
      };
      const res = await cmsApi('write', CONFIG_PATH, {
        content: JSON.stringify(updated, null, 4),
        sha: fileSha,
        message: 'CMS: Update LLMs.txt settings',
      });
      setConfig(cleanConfig);
      setFullConfig(updated);
      setFileSha(res.sha || fileSha);
      triggerToast('LLMs.txt configurado!', 'success', 100);
    } catch (err: any) {
      setError(err.message);
      triggerToast(`Erro: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all shadow-sm';
  const labelClass = 'block text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 ml-1';

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white rounded-3xl border border-slate-200">
      <Loader2 className="w-8 h-8 animate-spin mb-4 text-violet-500" />
      <p className="font-medium animate-pulse">Carregando configuracao...</p>
    </div>
  );

  if (error && !fullConfig) return (
    <div className="bg-red-50 text-red-700 p-8 rounded-3xl border border-red-200 flex gap-4 items-start">
      <AlertCircle className="w-8 h-8 shrink-0" />
      <div><h3 className="text-xl font-bold mb-2">Erro de Leitura</h3><p>{error}</p></div>
    </div>
  );

  const renderLinks = (kind: 'extraLinks' | 'optionalLinks', title: string, help: string) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div>
        <h3 className="font-bold text-slate-800">{title}</h3>
        <p className="text-sm text-slate-500 mt-0.5">{help}</p>
      </div>
      <div className="space-y-3">
        {config[kind].map((link, index) => (
          <div key={`${kind}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className={inputClass} value={link.title} onChange={e => set(kind, updateLink(config[kind], index, 'title', e.target.value) as any)} placeholder="Titulo do link" />
              <input className={inputClass} value={link.url} onChange={e => set(kind, updateLink(config[kind], index, 'url', e.target.value) as any)} placeholder="https://..." />
            </div>
            <div className="flex gap-3">
              <input className={inputClass} value={link.description} onChange={e => set(kind, updateLink(config[kind], index, 'description', e.target.value) as any)} placeholder="Descricao curta do recurso" />
              <button type="button" onClick={() => set(kind, removeLink(config[kind], index) as any)} className="p-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => set(kind, addBlankLink(config[kind]) as any)} className="inline-flex items-center gap-2 text-sm text-violet-600 hover:text-violet-700 font-bold">
        <Plus className="w-4 h-4" /> Adicionar link
      </button>
    </div>
  );

  return (
    <div className="max-w-5xl grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <h3 className="font-bold text-slate-800">Ativar /llms.txt</h3>
              <p className="text-sm text-slate-500 mt-0.5">Quando ativo, o site publica um arquivo em texto puro no endereco /llms.txt.</p>
            </div>
            <div
              onClick={() => set('enabled', !config.enabled)}
              className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${config.enabled ? 'bg-violet-600' : 'bg-slate-200'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${config.enabled ? 'left-7' : 'left-1'}`} />
            </div>
          </label>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="font-bold text-slate-800">Conteudo principal</h3>
          <div>
            <label className={labelClass}>Resumo curto</label>
            <textarea rows={3} value={config.summary} onChange={e => set('summary', e.target.value)} className={`${inputClass} resize-y`} placeholder="Se vazio, usa a Descricao Padrao SEO ou a Descricao do Site." />
          </div>
          <div>
            <label className={labelClass}>Instrucoes / contexto adicional</label>
            <textarea rows={4} value={config.details} onChange={e => set('details', e.target.value)} className={`${inputClass} resize-y`} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="font-bold text-slate-800">Seções automáticas</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ['includeCorePages', 'Paginas principais'],
              ['includeCategories', 'Categorias'],
              ['includePosts', 'Artigos recentes'],
              ['includeFeeds', 'Feeds e sitemap'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-50 cursor-pointer hover:bg-violet-50 transition-colors">
                <span className="text-sm font-semibold text-slate-800">{label}</span>
                <input type="checkbox" checked={Boolean(config[key as keyof LlmsConfig])} onChange={e => set(key as keyof LlmsConfig, e.target.checked as any)} className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-4 h-4" />
              </label>
            ))}
          </div>
          <div className="max-w-xs">
            <label className={labelClass}>Limite de artigos recentes</label>
            <input type="number" min={1} max={200} value={config.maxPosts} onChange={e => set('maxPosts', Math.max(1, Math.min(Number(e.target.value || 1), 200)))} className={inputClass} />
          </div>
        </div>

        {renderLinks('extraLinks', 'Links extras', 'Entram em uma secao propria antes da secao Optional.')}
        {renderLinks('optionalLinks', 'Links opcionais', 'Entram na secao especial Optional da especificacao; IAs podem ignorar se precisarem de contexto menor.')}

        {error && (
          <div className="p-4 bg-red-50 text-red-700 border-l-4 border-red-500 text-sm font-medium rounded-r-xl flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm shadow-violet-600/20"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Salvando...' : 'Salvar configuracao'}
          </button>
          <a href="/llms.txt" target="_blank" rel="noopener noreferrer" className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all">
            <ExternalLink className="w-4 h-4" /> Abrir /llms.txt
          </a>
        </div>
      </div>

      <aside className="bg-slate-950 text-slate-100 rounded-2xl border border-slate-800 shadow-sm p-5 h-fit xl:sticky xl:top-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">Preview do formato</h3>
          <span className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold">Markdown</span>
        </div>
        <pre className="text-xs leading-relaxed whitespace-pre-wrap overflow-auto max-h-[640px] text-slate-200">{preview}</pre>
      </aside>
    </div>
  );
}
