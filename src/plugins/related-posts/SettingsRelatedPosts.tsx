import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save } from 'lucide-react';
import { cmsApi } from '../../lib/adminApi';
import { triggerToast } from '../../components/admin/CmsToaster';

const CONFIG_PATH = 'src/data/pluginsConfig.json';

export default function SettingsRelatedPosts() {
  const [enabled, setEnabled] = useState(true);
  const [count, setCount] = useState(3);
  const [fileSha, setFileSha] = useState('');
  const [fullConfig, setFullConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    cmsApi('read', CONFIG_PATH)
      .then(data => {
        const config = JSON.parse(data.content || '{}');
        const related = config.relatedPosts || {};
        setFullConfig(config);
        setFileSha(data.sha || '');
        setEnabled(related.enabled !== false);
        setCount(Math.min(Math.max(Number(related.count) || 3, 1), 12));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    triggerToast('Salvando posts relacionados...', 'progress', 30);

    try {
      const updated = {
        ...(fullConfig || {}),
        relatedPosts: {
          enabled,
          count: Math.min(Math.max(Number(count) || 3, 1), 12),
        },
      };

      const res = await cmsApi('write', CONFIG_PATH, {
        content: JSON.stringify(updated, null, 2),
        sha: fileSha,
        message: 'CMS: Update Related Posts settings',
      });

      setFileSha(res.sha || fileSha);
      setFullConfig(updated);
      triggerToast('Posts relacionados configurados!', 'success', 100);
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
      <p className="font-medium animate-pulse">Carregando configuração...</p>
    </div>
  );

  if (error && !fullConfig) return (
    <div className="bg-red-50 text-red-700 p-8 rounded-3xl border border-red-200 flex gap-4 items-start">
      <AlertCircle className="w-8 h-8 shrink-0" />
      <div><h3 className="text-xl font-bold mb-2">Erro de Leitura</h3><p>{error}</p></div>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <h3 className="font-bold text-slate-800">Ativar Posts Relacionados</h3>
            <p className="text-sm text-slate-500 mt-0.5">Exibe artigos da mesma categoria ao final dos posts.</p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(value => !value)}
            className={`relative w-12 h-6 rounded-full transition-colors ${enabled ? 'bg-violet-600' : 'bg-slate-200'}`}
            aria-pressed={enabled}
            aria-label="Ativar posts relacionados"
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${enabled ? 'left-7' : 'left-1'}`} />
          </button>
        </label>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-bold text-slate-800 mb-1">Quantidade de artigos</h3>
        <p className="text-sm text-slate-500 mb-4">Número máximo de posts relacionados exibidos em cada artigo.</p>
        <label className={labelClass}>Posts por artigo</label>
        <input
          type="number"
          min={1}
          max={12}
          value={count}
          onChange={event => setCount(Math.min(Math.max(Number(event.target.value) || 1, 1), 12))}
          className={inputClass}
        />
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border-l-4 border-red-500 text-sm font-medium rounded-r-xl flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm shadow-violet-600/20"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? 'Salvando...' : 'Salvar Configuração'}
      </button>
    </div>
  );
}
