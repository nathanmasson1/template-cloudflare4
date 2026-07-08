import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Save } from 'lucide-react';
import { triggerToast } from '../../components/admin/CmsToaster';
import { cmsApi } from '../../lib/adminApi';

const CONFIG_PATH = 'src/data/pluginsConfig.json';

type FeedsRobotsConfig = {
  rss: {
    enabled: boolean;
    title: string;
    description: string;
    language: string;
    maxItems: number;
  };
  robots: {
    enabled: boolean;
    allowIndexing: boolean;
    includeSitemap: boolean;
    extraRules: string;
  };
};

const defaultConfig: FeedsRobotsConfig = {
  rss: {
    enabled: true,
    title: '',
    description: '',
    language: 'pt-br',
    maxItems: 200,
  },
  robots: {
    enabled: true,
    allowIndexing: true,
    includeSitemap: true,
    extraRules: '',
  },
};

function mergeConfig(value: any): FeedsRobotsConfig {
  return {
    rss: {
      ...defaultConfig.rss,
      ...(value?.rss || {}),
      maxItems: Math.max(1, Math.min(Number(value?.rss?.maxItems || defaultConfig.rss.maxItems), 500)),
    },
    robots: {
      ...defaultConfig.robots,
      ...(value?.robots || {}),
    },
  };
}

export default function SettingsFeedsRobots() {
  const [config, setConfig] = useState<FeedsRobotsConfig>(defaultConfig);
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
        setConfig(mergeConfig(parsed.feedsRobots));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const robotsPreview = useMemo(() => {
    const lines = [
      'User-agent: *',
      config.robots.allowIndexing ? 'Allow: /' : 'Disallow: /',
    ];
    if (config.robots.extraRules.trim()) {
      lines.push('', config.robots.extraRules.trim());
    }
    if (config.robots.includeSitemap) {
      lines.push('', 'Sitemap: https://seusite.com.br/sitemap-index.xml');
    }
    return lines.join('\n');
  }, [config.robots]);

  const updateRss = (field: keyof FeedsRobotsConfig['rss'], value: any) => {
    setConfig(prev => ({ ...prev, rss: { ...prev.rss, [field]: value } }));
  };

  const updateRobots = (field: keyof FeedsRobotsConfig['robots'], value: any) => {
    setConfig(prev => ({ ...prev, robots: { ...prev.robots, [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    triggerToast('Salvando RSS e Robots...', 'progress', 30);
    try {
      const cleanConfig = {
        rss: {
          ...config.rss,
          maxItems: Math.max(1, Math.min(Number(config.rss.maxItems || 200), 500)),
        },
        robots: config.robots,
      };
      const updated = {
        ...(fullConfig || {}),
        feedsRobots: cleanConfig,
      };
      const res = await cmsApi('write', CONFIG_PATH, {
        content: JSON.stringify(updated, null, 4),
        sha: fileSha,
        message: 'CMS: Update RSS and Robots settings',
      });
      setConfig(cleanConfig);
      setFullConfig(updated);
      setFileSha(res.sha || fileSha);
      triggerToast('RSS e Robots configurados!', 'success', 100);
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

  return (
    <div className="max-w-5xl grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <h3 className="font-bold text-slate-800">Ativar /rss.xml</h3>
              <p className="text-sm text-slate-500 mt-0.5">Publica o feed RSS com os artigos recentes do site.</p>
            </div>
            <input type="checkbox" checked={config.rss.enabled} onChange={e => updateRss('enabled', e.target.checked)} className="w-5 h-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
          </label>

          <div>
            <label className={labelClass}>Titulo do feed</label>
            <input className={inputClass} value={config.rss.title} onChange={e => updateRss('title', e.target.value)} placeholder="Se vazio, usa o Nome do Site / Empresa" />
          </div>
          <div>
            <label className={labelClass}>Descricao do feed</label>
            <textarea rows={3} className={`${inputClass} resize-y`} value={config.rss.description} onChange={e => updateRss('description', e.target.value)} placeholder="Se vazio, usa a Descricao do Site" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Idioma</label>
              <input className={inputClass} value={config.rss.language} onChange={e => updateRss('language', e.target.value)} placeholder="pt-br" />
            </div>
            <div>
              <label className={labelClass}>Limite de posts</label>
              <input type="number" min={1} max={500} className={inputClass} value={config.rss.maxItems} onChange={e => updateRss('maxItems', Math.max(1, Math.min(Number(e.target.value || 1), 500)))} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <h3 className="font-bold text-slate-800">Ativar /robots.txt</h3>
              <p className="text-sm text-slate-500 mt-0.5">Controla permissao de rastreamento e informa o sitemap aos buscadores.</p>
            </div>
            <input type="checkbox" checked={config.robots.enabled} onChange={e => updateRobots('enabled', e.target.checked)} className="w-5 h-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-50 cursor-pointer hover:bg-violet-50 transition-colors">
              <span className="text-sm font-semibold text-slate-800">Permitir indexacao</span>
              <input type="checkbox" checked={config.robots.allowIndexing} onChange={e => updateRobots('allowIndexing', e.target.checked)} className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-4 h-4" />
            </label>
            <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-50 cursor-pointer hover:bg-violet-50 transition-colors">
              <span className="text-sm font-semibold text-slate-800">Incluir sitemap</span>
              <input type="checkbox" checked={config.robots.includeSitemap} onChange={e => updateRobots('includeSitemap', e.target.checked)} className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-4 h-4" />
            </label>
          </div>

          <div>
            <label className={labelClass}>Regras extras</label>
            <textarea rows={5} className={`${inputClass} resize-y font-mono`} value={config.robots.extraRules} onChange={e => updateRobots('extraRules', e.target.value)} placeholder={'Disallow: /admin\nDisallow: /api'} />
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 border-l-4 border-red-500 text-sm font-medium rounded-r-xl flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
          </div>
        )}

        <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white px-5 py-3 rounded-xl font-bold shadow-sm shadow-violet-600/20 transition-all">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Salvando...' : 'Salvar configuracao'}
        </button>
      </div>

      <aside className="space-y-4">
        <div className="bg-slate-900 text-slate-100 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold mb-3">Preview robots.txt</h3>
          <pre className="text-xs whitespace-pre-wrap leading-relaxed text-slate-300">{robotsPreview}</pre>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-600 space-y-3">
          <a className="inline-flex items-center gap-2 font-bold text-violet-700 hover:text-violet-800" href="/rss.xml" target="_blank" rel="noreferrer">
            Abrir /rss.xml <ExternalLink className="w-4 h-4" />
          </a>
          <a className="inline-flex items-center gap-2 font-bold text-violet-700 hover:text-violet-800" href="/robots.txt" target="_blank" rel="noreferrer">
            Abrir /robots.txt <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </aside>
    </div>
  );
}
