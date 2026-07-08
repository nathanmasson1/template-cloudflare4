import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Image as ImageIcon, Loader2, Save, UploadCloud } from 'lucide-react';
import { triggerToast } from '../../components/admin/CmsToaster';
import { cmsApi } from '../../lib/adminApi';

const CONFIG_PATH = 'src/data/pluginsConfig.json';

type ManualAd = {
  enabled: boolean;
  image: string;
  url: string;
  alt: string;
};

type InlineAd = ManualAd & {
  id: string;
  afterParagraph: number;
};

type ManualAdsConfig = {
  enabled: boolean;
  sidebar: ManualAd;
  inlineBlocks: InlineAd[];
  exitPopup: ManualAd;
};

const defaultConfig: ManualAdsConfig = {
  enabled: true,
  sidebar: {
    enabled: true,
    image: '/images/ad-placeholder-sidebar.svg',
    url: 'https://www.exemplo.com.br/contato',
    alt: 'Anuncio lateral',
  },
  inlineBlocks: [
    {
      id: 'inline-1',
      enabled: true,
      afterParagraph: 2,
      image: '/images/ad-placeholder-inline-1.svg',
      url: 'https://www.exemplo.com.br/contato',
      alt: 'Anuncio no artigo 1',
    },
    {
      id: 'inline-2',
      enabled: true,
      afterParagraph: 5,
      image: '/images/ad-placeholder-inline-2.svg',
      url: 'https://www.exemplo.com.br/contato',
      alt: 'Anuncio no artigo 2',
    },
    {
      id: 'inline-3',
      enabled: true,
      afterParagraph: 8,
      image: '/images/ad-placeholder-inline-3.svg',
      url: 'https://www.exemplo.com.br/contato',
      alt: 'Anuncio no artigo 3',
    },
  ],
  exitPopup: {
    enabled: true,
    image: '/images/ad-placeholder-exit-popup.svg',
    url: 'https://www.exemplo.com.br/contato',
    alt: 'Anuncio em popup',
  },
};

type UploadKey = 'sidebar' | 'exitPopup' | `inline-${number}`;

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    resolve(result.includes(',') ? result.split(',')[1] : result);
  };
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

function safeFilePart(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'anuncio';
}

function mergeAd(value: any, fallback: ManualAd): ManualAd {
  return {
    ...fallback,
    ...(value || {}),
    enabled: value?.enabled !== false,
  };
}

function mergeConfig(value: any): ManualAdsConfig {
  const rawInline = Array.isArray(value?.inlineBlocks) ? value.inlineBlocks : [];
  return {
    ...defaultConfig,
    ...(value || {}),
    enabled: value?.enabled !== false,
    sidebar: mergeAd(value?.sidebar, defaultConfig.sidebar),
    inlineBlocks: defaultConfig.inlineBlocks.map((fallback, index) => ({
      ...fallback,
      ...(rawInline[index] || {}),
      id: fallback.id,
      enabled: rawInline[index]?.enabled !== false,
      afterParagraph: Math.max(1, Number(rawInline[index]?.afterParagraph || fallback.afterParagraph)),
    })),
    exitPopup: mergeAd(value?.exitPopup, defaultConfig.exitPopup),
  };
}

export default function SettingsManualAds() {
  const [config, setConfig] = useState<ManualAdsConfig>(defaultConfig);
  const [fullConfig, setFullConfig] = useState<any>(null);
  const [fileSha, setFileSha] = useState('');
  const [pendingImages, setPendingImages] = useState<Partial<Record<UploadKey, File>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    cmsApi('read', CONFIG_PATH)
      .then(data => {
        const parsed = JSON.parse(data.content || '{}');
        setFullConfig(parsed);
        setFileSha(data.sha || '');
        setConfig(mergeConfig(parsed.manualAds));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const activeCount = useMemo(() => {
    if (!config.enabled) return 0;
    return [
      config.sidebar.enabled,
      ...config.inlineBlocks.map(ad => ad.enabled),
      config.exitPopup.enabled,
    ].filter(Boolean).length;
  }, [config]);

  const updateSidebar = (patch: Partial<ManualAd>) => {
    setConfig(prev => ({ ...prev, sidebar: { ...prev.sidebar, ...patch } }));
  };

  const updateExitPopup = (patch: Partial<ManualAd>) => {
    setConfig(prev => ({ ...prev, exitPopup: { ...prev.exitPopup, ...patch } }));
  };

  const updateInline = (index: number, patch: Partial<InlineAd>) => {
    setConfig(prev => ({
      ...prev,
      inlineBlocks: prev.inlineBlocks.map((ad, i) => i === index ? { ...ad, ...patch } : ad),
    }));
  };

  const setPendingImage = (key: UploadKey, file?: File) => {
    if (!file) return;
    setPendingImages(prev => ({ ...prev, [key]: file }));
  };

  const uploadPendingImage = async (key: UploadKey, currentImage: string) => {
    const file = pendingImages[key];
    if (!file) return currentImage;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const baseName = safeFilePart(file.name.replace(/\.[^.]+$/, ''));
    const uploadPath = `public/uploads/${Date.now()}-${key}-${baseName}.${ext}`;
    const base64Content = await fileToBase64(file);
    await cmsApi('write', uploadPath, {
      content: base64Content,
      isBase64: true,
      message: `CMS: Upload manual ad ${key}`,
    });
    return uploadPath.replace('public', '');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    triggerToast('Salvando anuncios manuais...', 'progress', 25);
    try {
      const cleanConfig: ManualAdsConfig = JSON.parse(JSON.stringify(config));

      cleanConfig.sidebar.image = await uploadPendingImage('sidebar', cleanConfig.sidebar.image);
      cleanConfig.exitPopup.image = await uploadPendingImage('exitPopup', cleanConfig.exitPopup.image);
      cleanConfig.inlineBlocks = await Promise.all(cleanConfig.inlineBlocks.map(async (ad, index) => ({
        ...ad,
        afterParagraph: Math.max(1, Number(ad.afterParagraph || 1)),
        image: await uploadPendingImage(`inline-${index + 1}`, ad.image),
      })));

      const updated = {
        ...(fullConfig || {}),
        manualAds: cleanConfig,
      };
      const res = await cmsApi('write', CONFIG_PATH, {
        content: JSON.stringify(updated, null, 4),
        sha: fileSha,
        message: 'CMS: Update manual ads settings',
      });
      setConfig(cleanConfig);
      setFullConfig(updated);
      setFileSha(res.sha || fileSha);
      setPendingImages({});
      triggerToast('Anuncios manuais configurados!', 'success', 100);
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
      <p className="font-medium animate-pulse">Carregando anuncios...</p>
    </div>
  );

  const ImageField = ({ uploadKey, value, onChange }: { uploadKey: UploadKey; value: string; onChange: (value: string) => void }) => (
    <div className="space-y-3">
      <label className={labelClass}>Foto do anuncio</label>
      <div className="grid grid-cols-1 lg:grid-cols-[160px_minmax(0,1fr)] gap-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 min-h-28 flex items-center justify-center overflow-hidden">
          {value ? (
            <img src={value} alt="" className="max-h-36 w-full object-contain rounded-xl" />
          ) : (
            <ImageIcon className="w-8 h-8 text-slate-300" />
          )}
        </div>
        <div className="space-y-3">
          <input className={inputClass} value={value} onChange={e => onChange(e.target.value)} placeholder="/images/ad-placeholder.svg" />
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100">
            <UploadCloud className="w-4 h-4" />
            Carregar do PC
            <input type="file" accept="image/*" className="hidden" onChange={e => setPendingImage(uploadKey, e.target.files?.[0])} />
          </label>
          {pendingImages[uploadKey] && (
            <p className="text-xs font-semibold text-emerald-600">
              Imagem selecionada: {pendingImages[uploadKey]?.name}. Clique em Salvar para enviar.
            </p>
          )}
        </div>
      </div>
    </div>
  );

  const AdFields = ({
    title,
    help,
    ad,
    uploadKey,
    onChange,
    paragraph,
  }: {
    title: string;
    help: string;
    ad: ManualAd | InlineAd;
    uploadKey: UploadKey;
    onChange: (patch: any) => void;
    paragraph?: boolean;
  }) => (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
      <label className="flex items-center justify-between gap-5 cursor-pointer">
        <div>
          <h3 className="font-bold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{help}</p>
        </div>
        <input type="checkbox" checked={ad.enabled} onChange={e => onChange({ enabled: e.target.checked })} className="w-5 h-5 rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
      </label>

      {paragraph && (
        <div className="max-w-xs">
          <label className={labelClass}>Inserir apos o paragrafo X</label>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={(ad as InlineAd).afterParagraph || 1}
            onChange={e => onChange({ afterParagraph: Math.max(1, Number(e.target.value || 1)) })}
          />
        </div>
      )}

      <ImageField uploadKey={uploadKey} value={ad.image} onChange={image => onChange({ image })} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>URL de clique</label>
          <input className={inputClass} value={ad.url} onChange={e => onChange({ url: e.target.value })} placeholder="https://..." />
          <p className="text-xs text-slate-400 mt-1 ml-1">No site sera aberto com target blank e rel sponsored.</p>
        </div>
        <div>
          <label className={labelClass}>Texto alternativo</label>
          <input className={inputClass} value={ad.alt} onChange={e => onChange({ alt: e.target.value })} placeholder="Descricao do anuncio" />
        </div>
      </div>
    </section>
  );

  return (
    <div className="max-w-5xl grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="space-y-6">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <label className="flex items-center justify-between gap-5 cursor-pointer">
            <div>
              <h3 className="font-bold text-slate-800">Ativar anuncios manuais</h3>
              <p className="text-sm text-slate-500 mt-0.5">Controla todos os banners manuais do site de uma vez.</p>
            </div>
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))} className="w-5 h-5 rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
          </label>
        </section>

        <AdFields
          title="Banner lateral"
          help="Aparece na lateral dos posts, junto ao sumario quando existir."
          ad={config.sidebar}
          uploadKey="sidebar"
          onChange={updateSidebar}
        />

        {config.inlineBlocks.map((ad, index) => (
          <AdFields
            key={ad.id}
            title={`Bloco dentro dos posts ${index + 1}`}
            help="Inserido automaticamente dentro do conteudo do artigo."
            ad={ad}
            uploadKey={`inline-${index + 1}`}
            onChange={(patch) => updateInline(index, patch)}
            paragraph
          />
        ))}

        <AdFields
          title="Exit popup"
          help="Aparece uma vez por sessao quando o usuario demonstra intencao de sair no desktop ou apos navegacao no mobile."
          ad={config.exitPopup}
          uploadKey="exitPopup"
          onChange={updateExitPopup}
        />

        {error && (
          <div className="p-4 bg-red-50 text-red-700 border-l-4 border-red-500 text-sm font-medium rounded-r-xl flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
          </div>
        )}

        <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white px-5 py-3 rounded-xl font-bold shadow-sm shadow-rose-600/20 transition-all">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Salvando...' : 'Salvar anuncios'}
        </button>
      </div>

      <aside className="space-y-4">
        <div className="bg-slate-950 text-slate-100 rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-slate-400">Status</p>
          <p className="text-3xl font-black mt-1">{activeCount}/5</p>
          <p className="text-sm text-slate-400 mt-2">posicoes ativas</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-600 space-y-2">
          <p className="font-bold text-slate-800">Como aparece no site</p>
          <p>Todos os links dos anuncios sao renderizados com <code className="bg-slate-100 px-1 rounded">target="_blank"</code> e <code className="bg-slate-100 px-1 rounded">rel="sponsored"</code>.</p>
          <p>Os placeholders ja estao ativos para facilitar a visualizacao em posts publicados.</p>
        </div>
      </aside>
    </div>
  );
}
