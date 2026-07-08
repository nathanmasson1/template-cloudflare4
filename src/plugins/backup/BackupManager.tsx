import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileText,
  Image,
  Loader2,
  RefreshCw,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react';

interface BackupPart {
  id: string;
  kind: 'config' | 'posts' | 'uploads';
  part: number;
  label: string;
  fileName: string;
  href: string;
  count: number;
  bytes: number;
}

interface BackupManifest {
  version: number;
  generatedAt: string;
  environment: 'local' | 'cloudflare';
  limits: {
    postsPerPart: number;
    postPartBytes: number;
    uploadPartBytes: number;
    maxRestoreBytes: number;
  };
  totals: {
    configFiles: number;
    posts: number;
    uploads: number;
    uploadBytes: number;
  };
  parts: BackupPart[];
}

const kindLabel = {
  config: 'Configurações',
  posts: 'Posts',
  uploads: 'Imagens',
};

const kindIcon = {
  config: Settings,
  posts: FileText,
  uploads: Image,
};

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function BackupManager() {
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');

  const grouped = useMemo(() => {
    const groups: Record<BackupPart['kind'], BackupPart[]> = {
      config: [],
      posts: [],
      uploads: [],
    };
    for (const part of manifest?.parts || []) groups[part.kind].push(part);
    return groups;
  }, [manifest]);

  async function loadManifest() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/plugins/backup/manifest');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o backup.');
      setManifest(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar backup.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadManifest();
  }, []);

  function downloadPart(part: BackupPart) {
    window.location.href = part.href;
  }

  async function restoreSelectedFile() {
    if (!selectedFile) {
      setError('Selecione uma parte .zip para restaurar.');
      return;
    }

    const confirmed = window.confirm(
      'Restaurar esta parte do backup vai sobrescrever arquivos com o mesmo nome. Nenhum arquivo fora desta parte será apagado. Continuar?',
    );
    if (!confirmed) return;

    setRestoring(true);
    setError('');
    setRestoreMessage('');
    try {
      const response = await fetch('/api/admin/plugins/backup/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'X-Backup-Filename': selectedFile.name,
        },
        body: selectedFile,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível restaurar.');
      const restored = data.restored || {};
      setRestoreMessage(
        `Restaurado: ${restored.config || 0} configurações, ${restored.posts || 0} posts, ${restored.uploads || 0} imagens.`,
      );
      setSelectedFile(null);
      await loadManifest();
    } catch (err: any) {
      setError(err.message || 'Erro ao restaurar backup.');
    } finally {
      setRestoring(false);
    }
  }

  if (loading && !manifest) {
    return (
      <div className="flex items-center gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-medium">Carregando partes do backup...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {restoreMessage && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{restoreMessage}</p>
        </div>
      )}

      {manifest && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Metric icon={Database} label="Ambiente" value={manifest.environment === 'local' ? 'Local' : 'Cloudflare'} />
            <Metric icon={Settings} label="Configs" value={String(manifest.totals.configFiles)} />
            <Metric icon={FileText} label="Posts" value={String(manifest.totals.posts)} />
            <Metric icon={Image} label="Imagens" value={`${manifest.totals.uploads} / ${formatBytes(manifest.totals.uploadBytes)}`} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              Manifesto gerado em <strong className="text-slate-700">{formatDate(manifest.generatedAt)}</strong>
            </div>
            <button
              type="button"
              onClick={loadManifest}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-900">Backup dividido para segurança</p>
                <p className="text-sm text-amber-800 mt-1">
                  Configurações ficam em uma parte separada, posts são divididos em até {manifest.limits.postsPerPart} por parte ou {formatBytes(manifest.limits.postPartBytes)}, e imagens em partes de até {formatBytes(manifest.limits.uploadPartBytes)}.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <PartsColumn title={kindLabel.config} kind="config" parts={grouped.config} onDownload={downloadPart} />
            <PartsColumn title={kindLabel.posts} kind="posts" parts={grouped.posts} onDownload={downloadPart} />
            <PartsColumn title={kindLabel.uploads} kind="uploads" parts={grouped.uploads} onDownload={downloadPart} />
          </div>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Restaurar uma parte</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Envie um ZIP gerado por este plugin. A restauração sobrescreve apenas os itens dentro da parte enviada.
                </p>
              </div>
              <Upload className="w-5 h-5 text-slate-400 shrink-0" />
            </div>

            <div className="mt-5 flex flex-col md:flex-row gap-3">
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700"
              />
              <button
                type="button"
                onClick={restoreSelectedFile}
                disabled={restoring || !selectedFile}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Restaurar
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
          <Icon className="w-4 h-4 text-slate-600" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
          <p className="truncate text-sm font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function PartsColumn({
  title,
  kind,
  parts,
  onDownload,
}: {
  title: string;
  kind: BackupPart['kind'];
  parts: BackupPart[];
  onDownload: (part: BackupPart) => void;
}) {
  const Icon = kindIcon[kind];
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b border-slate-100 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
          <Icon className="w-4 h-4 text-violet-600" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{parts.length} parte{parts.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {parts.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Nada para exportar.</p>
        ) : (
          parts.map((part) => (
            <div key={part.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{part.label}</p>
                <p className="text-xs text-slate-500">
                  {part.count} item{part.count === 1 ? '' : 's'} - {formatBytes(part.bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDownload(part)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-violet-700"
                title={`Baixar ${part.label}`}
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
