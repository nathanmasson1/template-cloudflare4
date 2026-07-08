import type { DeployRequest, JobRecord, SiteRecord } from "../../shared/types";
import {
  DEFAULT_BUILD_COMMAND,
  DEFAULT_DEPLOY_COMMAND,
  guessZoneName,
  isValidDomain,
  namesForSite,
  normalizeDomain,
  nowIso,
  randomId,
  randomSecret,
} from "../../shared/utils";
import type { Env } from "../env";
import { decryptText } from "../lib/crypto";
import {
  addJobEvent,
  getJob,
  getSettings,
  getSite,
  getTemplate,
  persistJobLogArtifact,
  saveJob,
  saveSite,
} from "../lib/db";
import { CloudflareClient } from "./cloudflare";
import { validateGithubTemplate } from "./github";

function workersDevUrl(workerName: string, subdomain: string): string {
  const clean = subdomain.replace(/\.workers\.dev$/i, "").replace(/^\.+|\.+$/g, "");
  return clean ? `https://${workerName}.${clean}.workers.dev` : "";
}

async function getCloudflareClient(env: Env): Promise<{ cf: CloudflareClient; settings: Awaited<ReturnType<typeof getSettings>>; token: string }> {
  const settings = await getSettings(env);
  if (!settings.tokenCipher || !settings.accountId) {
    throw new Error("Cadastre Cloudflare API Token e Account ID antes de criar sites.");
  }
  const token = await decryptText(settings.tokenCipher, env.TOKEN_ENCRYPTION_KEY);
  return { cf: new CloudflareClient(token, settings.accountId), settings, token };
}

async function updateJob(env: Env, job: Omit<JobRecord, "logs">, step: string, status: JobRecord["status"] = "running"): Promise<void> {
  job.status = status;
  job.currentStep = step;
  job.updatedAt = nowIso();
  await saveJob(env, job);
  await addJobEvent(env, job.id, `== ${step} ==`);
}

export async function startDeploy(env: Env, payload: DeployRequest): Promise<JobRecord> {
  const siteName = String(payload.siteName || "").trim();
  const adminPassword = String(payload.adminPassword || "").trim();
  const templateId = String(payload.templateId || "").trim();
  const customDomain = normalizeDomain(payload.customDomain || "");
  if (!siteName || !adminPassword || !templateId) {
    throw new Error("Preencha nome do site, senha admin e template.");
  }
  if (customDomain && !isValidDomain(customDomain)) {
    throw new Error("Dominio invalido. Use exemplo.com ou www.exemplo.com.");
  }

  const template = await getTemplate(env, templateId);
  if (!template) throw new Error("Template selecionado nao encontrado.");

  const now = nowIso();
  const ids = namesForSite(siteName);
  const siteId = randomId("site_");
  const jobId = randomId("job_");
  const webhookSecret = randomSecret();
  const cronSecret = randomSecret();
  const masks = [adminPassword, webhookSecret, cronSecret];

  const job: Omit<JobRecord, "logs"> = {
    id: jobId,
    siteId,
    operation: "deploy",
    status: "queued",
    currentStep: "Na fila",
    result: {},
    error: "",
    createdAt: now,
    updatedAt: now,
  };

  const site: SiteRecord = {
    id: siteId,
    status: "draft",
    siteName,
    slug: ids.slug,
    templateId,
    workerName: ids.workerName,
    customDomain,
    workersDevUrl: "",
    adminUrl: "",
    d1Database: ids.d1Name,
    d1DatabaseId: "",
    r2Bucket: ids.r2BucketName,
    kvNamespace: ids.kvName,
    kvNamespaceId: "",
    buildTriggerId: "",
    buildId: "",
    repoConnectionUuid: "",
    externalScriptId: "",
    webhookSecret,
    cronSecret,
    zone: {},
    error: "",
    raw: {},
    createdAt: now,
    updatedAt: now,
  };

  await saveJob(env, job);
  await saveSite(env, site);

  try {
    await updateJob(env, job, "Validando template GitHub");
    const git = await validateGithubTemplate(template.githubUrl);
    await addJobEvent(env, job.id, `Template OK: ${git.owner}/${git.repo}@${git.branch}`);

    const { cf, token } = await getCloudflareClient(env);

    await updateJob(env, job, "Verificando permissao Workers Builds");
    await cf.assertBuildsAccess();

    await updateJob(env, job, "Criando ou reutilizando D1, R2 e KV");
    const [d1, r2, kv] = await Promise.all([cf.ensureD1(ids.d1Name), cf.ensureR2(ids.r2BucketName), cf.ensureKv(ids.kvName)]);
    site.d1DatabaseId = d1.uuid || "";
    site.r2Bucket = r2.name || ids.r2BucketName;
    site.kvNamespaceId = kv.id || "";
    site.status = "provisioning";
    site.updatedAt = nowIso();
    await saveSite(env, site);
    await addJobEvent(env, job.id, `D1: ${site.d1Database} (${site.d1DatabaseId})`);
    await addJobEvent(env, job.id, `R2: ${site.r2Bucket}`);
    await addJobEvent(env, job.id, `KV: ${site.kvNamespace} (${site.kvNamespaceId})`);

    if (customDomain) {
      await updateJob(env, job, "Preparando zona do dominio");
      try {
        const zone = await cf.ensureZone(guessZoneName(customDomain));
        site.zone = zone;
        await addJobEvent(env, job.id, `Zona Cloudflare: ${String(zone.name || customDomain)} (${String(zone.status || "sem status")})`);
      } catch (error) {
        site.status = "domain_pending";
        site.error = error instanceof Error ? error.message : String(error);
        await addJobEvent(env, job.id, `Dominio pendente: ${site.error}`);
      }
    }

    await updateJob(env, job, "Criando Worker placeholder e secrets");
    await cf.uploadWorkerPlaceholder(ids.workerName);
    await Promise.all([
      cf.putWorkerSecret(ids.workerName, "ADMIN_SECRET", adminPassword),
      cf.putWorkerSecret(ids.workerName, "WEBHOOK_SECRET", webhookSecret),
      cf.putWorkerSecret(ids.workerName, "CRON_SECRET", cronSecret),
    ]);
    const externalScriptId = await cf.getWorkerTag(ids.workerName);
    site.externalScriptId = externalScriptId;

    await updateJob(env, job, "Configurando Workers Builds");
    await addJobEvent(env, job.id, "Conectando repositorio GitHub ao Worker");
    const repoConnectionUuid = await cf.connectRepository({
      providerAccountId: git.ownerId,
      providerAccountName: git.owner,
      repoId: git.repoId,
      repoName: git.repo,
    });
    await addJobEvent(env, job.id, `Repo connection: ${repoConnectionUuid}`);
    const buildTokenUuid = await cf.ensureBuildToken();
    await addJobEvent(env, job.id, `Build token: ${buildTokenUuid}`);
    site.repoConnectionUuid = repoConnectionUuid;
    site.raw = { ...site.raw, github: git, buildTokenUuid };
    site.updatedAt = nowIso();
    await saveSite(env, site);
    const rootDirectory = git.subdir ? `/${git.subdir}` : "/";
    await addJobEvent(env, job.id, "Criando trigger de producao");
    const triggerId = await cf.createBuildTrigger({
      workerName: ids.workerName,
      externalScriptId,
      repoConnectionUuid,
      buildTokenUuid,
      branch: git.branch,
      rootDirectory,
      buildCommand: DEFAULT_BUILD_COMMAND,
      deployCommand: DEFAULT_DEPLOY_COMMAND,
    });
    await addJobEvent(env, job.id, `Trigger: ${triggerId}`);
    await addJobEvent(env, job.id, "Configurando variaveis de build");
    await cf.setBuildEnvironmentVariables(triggerId, {
      AUTODEPLOY_ACCOUNT_ID: (await getSettings(env)).accountId,
      AUTODEPLOY_WORKER_NAME: ids.workerName,
      AUTODEPLOY_D1_NAME: ids.d1Name,
      AUTODEPLOY_D1_ID: site.d1DatabaseId,
      AUTODEPLOY_R2_BUCKET: ids.r2BucketName,
      AUTODEPLOY_KV_ID: site.kvNamespaceId,
      AUTODEPLOY_CUSTOM_DOMAIN: customDomain,
    });
    await addJobEvent(env, job.id, "Disparando primeiro build");
    const buildId = await cf.runBuild(triggerId, git.branch);

    const subdomain = await cf.getWorkersDevSubdomain().catch(() => "");
    site.repoConnectionUuid = repoConnectionUuid;
    site.buildTriggerId = triggerId;
    site.buildId = buildId;
    site.workersDevUrl = workersDevUrl(ids.workerName, subdomain);
    site.adminUrl = site.workersDevUrl ? `${site.workersDevUrl}/admin` : "";
    site.status = "building";
    site.updatedAt = nowIso();
    await saveSite(env, site);

    job.status = "done";
    job.currentStep = "Build iniciado";
    job.result = {
      site,
      buildId,
      triggerId,
      message: "Recursos criados e build disparado. Acompanhe os logs do job.",
    };
    job.updatedAt = nowIso();
    await saveJob(env, job);
    await addJobEvent(env, job.id, `Build iniciado: ${buildId}`, "info", [token, ...masks]);
    await persistJobLogArtifact(env, job.id);
    return (await getJob(env, job.id))!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.status = "failed";
    job.error = message;
    job.currentStep = "Falhou";
    job.updatedAt = nowIso();
    site.status = "failed";
    site.error = message;
    site.updatedAt = nowIso();
    await saveJob(env, job);
    await saveSite(env, site);
    await addJobEvent(env, job.id, `ERRO: ${message}`, "error", masks);
    await persistJobLogArtifact(env, job.id);
    return (await getJob(env, job.id))!;
  }
}

export async function refreshJob(env: Env, jobId: string): Promise<JobRecord | null> {
  const job = await getJob(env, jobId);
  if (!job) return null;
  const site = await getSite(env, job.siteId);
  if (!site || !site.buildTriggerId) return job;
  if (!["deploy", "build"].includes(job.operation) && site.status !== "building") return job;

  try {
    const { cf } = await getCloudflareClient(env);
    const build = await cf.getBuild(site.buildTriggerId, site.buildId);
    const status = String(build?.status || "").toLowerCase();
    const outcome = String(build?.outcome || build?.build_outcome || "").toLowerCase();
    const logs = await cf.getBuildLogs(site.buildTriggerId, site.buildId).catch(() => "");
    if (logs) {
      await env.APP_BUCKET.put(`jobs/${job.id}/cloudflare-build.log`, logs, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
      });
    }

    if (["success", "succeeded", "complete", "completed"].includes(status) || ["success", "succeeded"].includes(outcome)) {
      site.status = site.customDomain && Object.keys(site.zone || {}).length === 0 ? "domain_pending" : "online";
      site.updatedAt = nowIso();
      await saveSite(env, site);
      const { logs: _logs, ...jobWithoutLogs } = job;
      await saveJob(env, { ...jobWithoutLogs, status: "done", currentStep: "Build concluido", updatedAt: nowIso(), result: { site, build } });
    } else if (["failed", "failure", "errored", "canceled", "cancelled", "stopped"].includes(status) || ["fail", "failed", "failure"].includes(outcome)) {
      site.status = "failed";
      site.error = buildFailureMessage(status, outcome, logs);
      site.updatedAt = nowIso();
      await saveSite(env, site);
      const { logs: _logs, ...jobWithoutLogs } = job;
      await saveJob(env, { ...jobWithoutLogs, status: "failed", currentStep: "Build falhou", error: site.error, updatedAt: nowIso(), result: { site, build } });
    }
  } catch (error) {
    await addJobEvent(env, job.id, `Nao consegui atualizar build ainda: ${error instanceof Error ? error.message : String(error)}`, "warn");
  }

  return getJob(env, jobId);
}

function buildFailureMessage(status: string, outcome: string, logs: string): string {
  if (/build token selected.*deleted or rolled/i.test(logs)) {
    return "Build token invalido na Cloudflare. Em Workers > Settings > Builds > API token, crie ou selecione um build token novo e rode o deploy novamente.";
  }
  return `Build ${outcome || status || "falhou"}`;
}

export async function deleteSite(env: Env, siteId: string): Promise<JobRecord> {
  const site = await getSite(env, siteId);
  if (!site) throw new Error("Site nao encontrado.");
  const now = nowIso();
  const job: Omit<JobRecord, "logs"> = {
    id: randomId("job_"),
    siteId,
    operation: "delete",
    status: "running",
    currentStep: "Excluindo recursos",
    result: {},
    error: "",
    createdAt: now,
    updatedAt: now,
  };
  await saveJob(env, job);
  await addJobEvent(env, job.id, "== Excluindo recursos ==");
  site.status = "delete_pending";
  await saveSite(env, site);

  try {
    const { cf } = await getCloudflareClient(env);
    const attempts = [
      ["Worker", () => cf.deleteWorker(site.workerName)],
      ["D1", () => cf.deleteD1(site.d1DatabaseId || site.d1Database)],
      ["R2", () => cf.deleteR2(site.r2Bucket)],
      ["KV", () => cf.deleteKv(site.kvNamespaceId)],
    ] as const;

    for (const [label, action] of attempts) {
      try {
        await action();
        await addJobEvent(env, job.id, `${label} removido.`);
      } catch (error) {
        await addJobEvent(env, job.id, `${label}: ${error instanceof Error ? error.message : String(error)}`, "warn");
      }
    }

    site.status = "deleted";
    site.updatedAt = nowIso();
    await saveSite(env, site);
    await saveJob(env, { ...job, status: "done", currentStep: "Excluido", result: { siteId }, updatedAt: nowIso() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    site.status = "failed";
    site.error = message;
    await saveSite(env, site);
    await saveJob(env, { ...job, status: "failed", currentStep: "Falhou", error: message, updatedAt: nowIso() });
  }

  return (await getJob(env, job.id))!;
}
