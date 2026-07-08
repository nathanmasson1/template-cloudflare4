import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CloudflareAccount, JobRecord, PublicSettings, SiteRecord, TemplateRecord } from "../shared/types";
import "./styles.css";

type Page = "dashboard" | "settings" | "templates" | "deploy" | "sites" | "domains";

const CLOUDFLARE_TOKEN_PERMISSION_GROUPS = [
  { key: "workers_builds_configuration", type: "edit" },
  { key: "d1", type: "edit" },
  { key: "workers_r2", type: "edit" },
  { key: "workers_kv_storage", type: "edit" },
  { key: "workers_scripts", type: "edit" },
  { key: "zone", type: "read" },
  { key: "dns", type: "edit" },
  { key: "workers_routes", type: "edit" },
];
const CLOUDFLARE_PREFILLED_TOKEN_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
  JSON.stringify(CLOUDFLARE_TOKEN_PERMISSION_GROUPS),
)}&accountId=*&zoneId=all&name=meusitecomiacloudflare-setup`;
const CLOUDFLARE_WORKERS_PAGES_URL = "https://dash.cloudflare.com/?to=/:account/workers-and-pages";
const GITHUB_CLOUDFLARE_APP_URL = "https://github.com/apps/cloudflare-workers-and-pages";
const GITHUB_INSTALLATIONS_URL = "https://github.com/settings/installations";
const TOKEN_PERMISSION_CHECKLIST = [
  "Cloudflare API Token para Auto Deploy Cloudflare",
  "",
  "Criar em: My Profile > API Tokens > Create Token > Custom token",
  "",
  "Account Resources: Include > sua conta Cloudflare",
  "Zone Resources: Include > All zones ou apenas os dominios que voce vai usar",
  "",
  "Permissoes:",
  "Account > Workers Builds Configuration > Edit",
  "Account > Workers Scripts > Edit",
  "Account > D1 > Edit",
  "Account > R2 Storage > Edit",
  "Account > Workers KV Storage > Edit",
  "Zone > Zone > Read",
  "Zone > DNS > Edit",
  "Zone > Workers Routes > Edit",
  "",
  "Depois de criar, copie o token gerado e cole no painel Auto Deploy Cloudflare.",
].join("\n");

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Erro HTTP ${response.status}`);
  }
  return payload as T;
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ authenticated: boolean }>("/api/me")
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) return <FullScreenMessage title="Carregando" body="Preparando painel..." />;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <DashboardShell onLogout={() => setAuthenticated(false)} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Cloudflare Workers + D1 + R2</p>
        <h1>Auto Deploy Cloudflare</h1>
        <p>Entre com a senha configurada em `APP_ADMIN_SECRET`.</p>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha do painel" required />
        {error && <div className="alert">{error}</div>}
        <button disabled={loading}>{loading ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}

function DashboardShell({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [notice, setNotice] = useState("");

  async function loadAll() {
    const [settingsData, templatesData, sitesData] = await Promise.all([
      api<PublicSettings>("/api/settings/cloudflare"),
      api<{ templates: TemplateRecord[] }>("/api/templates"),
      api<{ sites: SiteRecord[] }>("/api/sites"),
    ]);
    setSettings(settingsData);
    setTemplates(templatesData.templates);
    setSites(sitesData.sites);
  }

  useEffect(() => {
    loadAll().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    onLogout();
  }

  const content = useMemo(() => {
    if (page === "settings") return <SettingsPage settings={settings} onSaved={loadAll} />;
    if (page === "templates") return <TemplatesPage templates={templates} onChanged={loadAll} />;
    if (page === "deploy") return <DeployPage templates={templates} settings={settings} onJob={setActiveJobId} onRefresh={loadAll} />;
    if (page === "sites") return <SitesPage sites={sites} onJob={setActiveJobId} onChanged={loadAll} />;
    if (page === "domains") return <DomainsPage />;
    return <HomePage settings={settings} templates={templates} sites={sites} onNavigate={setPage} />;
  }, [page, settings, templates, sites]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Auto Deploy</p>
          <h1>Cloudflare</h1>
        </div>
        <nav>
          {[
            ["dashboard", "Painel"],
            ["settings", "Credenciais"],
            ["templates", "Templates"],
            ["deploy", "Criar"],
            ["sites", "Sites"],
            ["domains", "Domínios"],
          ].map(([id, label]) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id as Page)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={logout}>Sair</button>
      </aside>
      <section className="content">
        {notice && <div className="alert">{notice}</div>}
        {content}
        {activeJobId && <JobPanel jobId={activeJobId} onClose={() => setActiveJobId("")} onDone={loadAll} />}
      </section>
    </main>
  );
}

function HomePage({
  settings,
  templates,
  sites,
  onNavigate,
}: {
  settings: PublicSettings | null;
  templates: TemplateRecord[];
  sites: SiteRecord[];
  onNavigate: (page: Page) => void;
}) {
  return (
    <div className="stack">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Workers Builds</p>
          <h2>Deploy de templates GitHub para Cloudflare</h2>
          <p>Crie Workers com D1, R2, KV, secrets, build remoto e domínio customizado sem sair deste painel.</p>
        </div>
        <button onClick={() => onNavigate("deploy")}>Criar site</button>
      </section>
      <div className="metric-grid">
        <Metric label="Token" value={settings?.hasToken ? settings.tokenMask : "Não cadastrado"} />
        <Metric label="Templates" value={String(templates.length)} />
        <Metric label="Sites" value={String(sites.length)} />
      </div>
      {!settings?.githubAppAcknowledged && (
        <div className="warn">
          Autorize a integração <strong>Cloudflare Workers and Pages</strong> no GitHub antes do primeiro deploy por Builds.
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsPage({ settings, onSaved }: { settings: PublicSettings | null; onSaved: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState(settings?.accountId || "");
  const [accountName, setAccountName] = useState(settings?.accountName || "");
  const [ack, setAck] = useState(Boolean(settings?.githubAppAcknowledged));
  const [paid, setPaid] = useState(Boolean(settings?.cloudflarePaidPlan));
  const [accounts, setAccounts] = useState<CloudflareAccount[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setAccountId(settings?.accountId || "");
    setAccountName(settings?.accountName || "");
    setAck(Boolean(settings?.githubAppAcknowledged));
    setPaid(Boolean(settings?.cloudflarePaidPlan));
  }, [settings]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const data = await api<PublicSettings>("/api/settings/cloudflare", {
      method: "POST",
      body: JSON.stringify({
        cloudflareToken: token,
        accountId,
        accountName,
        githubAppAcknowledged: ack,
        cloudflarePaidPlan: paid,
      }),
    });
    setToken("");
    setMessage(`Credenciais salvas para ${data.accountName || data.accountId}.`);
    await onSaved();
  }

  async function loadAccounts() {
    setMessage("");
    const data = await api<{ accounts: CloudflareAccount[] }>("/api/cloudflare/accounts");
    setAccounts(data.accounts);
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Credenciais" title="Cloudflare API" subtitle="Configure o token, autorize o GitHub App e selecione a conta onde os recursos serao criados." />
      <div className="setup-guide">
        <article className="guide-card">
          <span className="step-number">1</span>
          <div>
            <h3>Crie um API Token na Cloudflare</h3>
            <p>
              Clique no atalho para abrir a Cloudflare com nome, escopo e permissoes ja preenchidos. Revise a conta,
              confirme a criacao e copie o token gerado para colar aqui no painel.
            </p>
            <div className="button-row">
              <TokenShortcutButton />
              <CopyPermissionsButton />
              <ExternalButton href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/">Como criar token</ExternalButton>
            </div>
            <p className="hint compact">
              O botao tambem copia a lista das permissoes para voce conferir caso a Cloudflare mude algum campo no dashboard.
            </p>
          </div>
        </article>

        <article className="guide-card">
          <span className="step-number">2</span>
          <div>
            <h3>Autorize o GitHub App da Cloudflare</h3>
            <p>
              Instale o app Cloudflare Workers and Pages no GitHub e libere acesso ao repositorio do template. Para seu teste,
              selecione nathanmasson1/template-cloudflare4 ou libere todos os repositorios da sua conta.
            </p>
            <div className="button-row">
              <ExternalButton href={GITHUB_CLOUDFLARE_APP_URL}>Instalar GitHub App</ExternalButton>
              <ExternalButton href={GITHUB_INSTALLATIONS_URL}>Ver instalacoes</ExternalButton>
            </div>
          </div>
        </article>

        <article className="guide-card">
          <span className="step-number">3</span>
          <div>
            <h3>Confira o Build token do Worker</h3>
            <p>
              Workers Builds usa um Build token proprio para fazer deploy. Se o log mostrar "build token deleted or rolled",
              abra o Worker no dashboard, va em Settings &gt; Builds &gt; API token e crie ou selecione um build token valido.
            </p>
            <div className="button-row">
              <ExternalButton href={CLOUDFLARE_WORKERS_PAGES_URL}>Abrir Workers & Pages</ExternalButton>
            </div>
          </div>
        </article>

        <article className="guide-card">
          <span className="step-number">4</span>
          <div>
            <h3>Salve e escolha a conta</h3>
            <p>
              Cole o token aqui, salve, clique em Listar contas e escolha a conta Cloudflare onde os Workers, D1, R2 e KV
              serao criados.
            </p>
            <div className="button-row">
              <ExternalButton href={CLOUDFLARE_WORKERS_PAGES_URL}>Abrir Workers & Pages</ExternalButton>
            </div>
          </div>
        </article>
      </div>

      <div className="permissions-box">
        <div>
          <p className="eyebrow">Permissoes do token</p>
          <h3>Use um token de usuario com acesso de conta</h3>
          <p>Escopo recomendado: Account Resources = Include, sua conta Cloudflare. Zone Resources = Include, all zones ou apenas os dominios que voce vai usar.</p>
        </div>
        <div className="permission-grid">
          <PermissionItem group="Account" name="Workers Builds Configuration" level="Edit" />
          <PermissionItem group="Account" name="Workers Scripts" level="Edit" />
          <PermissionItem group="Account" name="D1" level="Edit" />
          <PermissionItem group="Account" name="R2 Storage" level="Edit" />
          <PermissionItem group="Account" name="Workers KV Storage" level="Edit" />
          <PermissionItem group="Zone" name="Zone" level="Read" />
          <PermissionItem group="Zone" name="DNS" level="Edit" />
          <PermissionItem group="Zone" name="Workers Routes" level="Edit" />
        </div>
        <p className="hint">
          Se a Cloudflare mostrar nomes levemente diferentes, escolha a permissao equivalente para criar/editar Workers,
          Builds, D1, R2, KV, secrets e rotas/dominios.
        </p>
      </div>

      <form className="grid" onSubmit={save}>
        <label className="wide">
          <span>Cloudflare API Token</span>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={settings?.tokenMask || "Cole aqui o token copiado da Cloudflare"}
          />
          <small>O token fica salvo criptografado no D1. Depois de salvo, o campo fica vazio por seguranca.</small>
        </label>
        <label>
          <span>Account ID</span>
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} required placeholder="Ex: 1a2b3c4d..." />
          <small>Use Listar contas para preencher automaticamente.</small>
        </label>
        <label>
          <span>Account name</span>
          <input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Nome visivel da conta" />
          <small>Opcional, serve para voce reconhecer a conta no painel.</small>
        </label>
        <label className="check wide">
          <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
          <span>Ja autorizei o GitHub App "Cloudflare Workers and Pages" para acessar o repositorio do template.</span>
        </label>
        <label className="check wide">
          <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
          <span>Minha conta usa plano pago quando o template exigir.</span>
        </label>
        <div className="actions wide">
          <button type="submit">Salvar</button>
          <button type="button" className="secondary" onClick={loadAccounts}>Listar contas</button>
        </div>
      </form>
      {accounts.length > 0 && (
        <div className="list">
          {accounts.map((account) => (
            <button key={account.id} onClick={() => { setAccountId(account.id); setAccountName(account.name); }}>
              {account.name} <code>{account.id}</code>
            </button>
          ))}
        </div>
      )}
      {message && <div className="success">{message}</div>}
    </section>
  );
}

function ExternalButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="button-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function TokenShortcutButton() {
  const [copied, setCopied] = useState(false);

  async function copyAndOpen() {
    window.open(CLOUDFLARE_PREFILLED_TOKEN_URL, "_blank", "noopener,noreferrer");
    try {
      await copyText(TOKEN_PERMISSION_CHECKLIST);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <button type="button" className="shortcut-button" onClick={copyAndOpen}>
      {copied ? "Permissoes copiadas" : "Criar token pre-preenchido"}
    </button>
  );
}

function CopyPermissionsButton() {
  const [copied, setCopied] = useState(false);

  async function copyOnly() {
    try {
      await copyText(TOKEN_PERMISSION_CHECKLIST);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <button type="button" className="secondary" onClick={copyOnly}>
      {copied ? "Copiado" : "Copiar lista"}
    </button>
  );
}

async function copyText(text: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Seu navegador nao liberou copiar automaticamente. Copie a lista de permissoes exibida na tela.");
  }
  await navigator.clipboard.writeText(text);
}

function PermissionItem({ group, name, level }: { group: string; name: string; level: string }) {
  return (
    <div className="permission-item">
      <span>{group}</span>
      <strong>{name}</strong>
      <code>{level}</code>
    </div>
  );
}

function TemplatesPage({ templates, onChanged }: { templates: TemplateRecord[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("Validando template...");
    try {
      await api("/api/templates", { method: "POST", body: JSON.stringify({ name, githubUrl }) });
      setName("");
      setGithubUrl("");
      setMessage("Template salvo.");
      await onChanged();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessage("");
      setError(
        detail.includes("scripts/")
          ? `${detail} Envie os scripts de autodeploy para o GitHub antes de cadastrar este template.`
          : detail,
      );
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/templates/${id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Templates" title="GitHub públicos" subtitle="Cada template precisa incluir os scripts de autodeploy." />
      <div className="warn">
        Para usar <strong>nathanmasson1/template-cloudflare4</strong>, confirme que o commit com <code>scripts/autodeploy-prepare.mjs</code>, <code>scripts/autodeploy-deploy.mjs</code> e <code>scripts/prepare-cloudflare-assets.mjs</code> ja foi enviado ao GitHub.
      </div>
      <form className="grid" onSubmit={submit}>
        <label>
          <span>Nome</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Template notícias" />
        </label>
        <label className="wide">
          <span>URL GitHub</span>
          <input value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} required placeholder="https://github.com/usuario/template/tree/main/subpasta" />
        </label>
        <button className="wide" disabled={loading}>{loading ? "Validando..." : "Cadastrar template"}</button>
      </form>
      {message && <div className="success">{message}</div>}
      {error && <div className="alert">{error}</div>}
      <div className="card-grid">
        {templates.map((template) => (
          <article className="item-card" key={template.id}>
            <strong>{template.name}</strong>
            <span>{template.owner}/{template.repo}@{template.branch}</span>
            <small>{template.subdir || "/"}</small>
            <button className="danger" onClick={() => remove(template.id)}>Remover</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function DeployPage({
  templates,
  settings,
  onJob,
  onRefresh,
}: {
  templates: TemplateRecord[];
  settings: PublicSettings | null;
  onJob: (jobId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [siteName, setSiteName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templates, templateId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("Provisionando recursos...");
    const data = await api<{ job: JobRecord }>("/api/sites/deploy", {
      method: "POST",
      body: JSON.stringify({ siteName, adminPassword, templateId, customDomain }),
    });
    setAdminPassword("");
    setMessage("Job criado.");
    onJob(data.job.id);
    await onRefresh();
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Novo deploy" title="Criar site" subtitle="Worker, D1, R2, KV, secrets, build remoto e domínio opcional." />
      {!settings?.hasToken && <div className="warn">Cadastre o token Cloudflare antes de criar sites.</div>}
      <form className="grid" onSubmit={submit}>
        <label>
          <span>Nome do site</span>
          <input value={siteName} onChange={(event) => setSiteName(event.target.value)} required placeholder="Clínica Aurora" />
        </label>
        <label>
          <span>Senha do admin</span>
          <input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required />
        </label>
        <label className="wide">
          <span>Domínio próprio opcional</span>
          <input value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder="exemplo.com" />
        </label>
        <label className="wide">
          <span>Template</span>
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>
            <option value="">Selecione</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name} - {template.owner}/{template.repo}</option>
            ))}
          </select>
        </label>
        <button className="wide" disabled={!settings?.hasToken || !templates.length}>Criar e publicar</button>
      </form>
      {message && <div className="success">{message}</div>}
    </section>
  );
}

function SitesPage({ sites, onJob, onChanged }: { sites: SiteRecord[]; onJob: (jobId: string) => void; onChanged: () => Promise<void> }) {
  async function remove(site: SiteRecord) {
    const data = await api<{ job: JobRecord }>(`/api/sites/${site.id}`, { method: "DELETE" });
    onJob(data.job.id);
    await onChanged();
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Sites" title="Projetos publicados" subtitle="Acompanhe Workers, recursos e status dos builds." />
      <div className="table">
        {sites.map((site) => (
          <div className="site-row" key={site.id}>
            <div>
              <strong>{site.siteName}</strong>
              <span>{site.workerName}</span>
            </div>
            <StatusBadge status={site.status} />
            <div className="links">
              {site.workersDevUrl && <a href={site.workersDevUrl} target="_blank">Site</a>}
              {site.adminUrl && <a href={site.adminUrl} target="_blank">Admin</a>}
            </div>
            <button className="danger" onClick={() => remove(site)}>Excluir</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function DomainsPage() {
  const [customDomain, setCustomDomain] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const data = await api<{ message: string }>("/api/domains/cleanup", {
      method: "POST",
      body: JSON.stringify({ customDomain, workerName }),
    });
    setMessage(data.message);
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Domínios" title="Limpeza e diagnóstico" subtitle="V1 mantém a limpeza principal no fluxo de exclusão do site." />
      <form className="grid" onSubmit={submit}>
        <label>
          <span>Domínio</span>
          <input value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder="exemplo.com" />
        </label>
        <label>
          <span>Worker</span>
          <input value={workerName} onChange={(event) => setWorkerName(event.target.value)} placeholder="worker-name" />
        </label>
        <button className="wide">Verificar limpeza</button>
      </form>
      {message && <div className="warn">{message}</div>}
    </section>
  );
}

function JobPanel({ jobId, onClose, onDone }: { jobId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [job, setJob] = useState<JobRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const data = await api<{ job: JobRecord }>(`/api/jobs/${jobId}`);
      if (cancelled) return;
      setJob(data.job);
      if (!["done", "failed"].includes(data.job.status)) {
        window.setTimeout(poll, 1800);
      } else {
        await onDone();
      }
    }
    poll().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <div className="job-drawer">
      <div className="job-head">
        <div>
          <p className="eyebrow">Job</p>
          <h3>{job?.currentStep || "Carregando"}</h3>
        </div>
        <button className="ghost" onClick={onClose}>Fechar</button>
      </div>
      <StatusBadge status={job?.status || "queued"} />
      <pre>{(job?.logs || []).join("\n")}</pre>
      {job?.id && <a href={`/api/jobs/${job.id}/logs`} target="_blank">Abrir logs completos</a>}
      {job?.error && <div className="alert">{job.error}</div>}
    </div>
  );
}

function Header({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <p>{subtitle}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

function FullScreenMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="login-screen">
      <div className="login-card">
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
