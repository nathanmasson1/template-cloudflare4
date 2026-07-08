import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WRANGLER = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const CONFIG_PATH = path.join(ROOT, 'wrangler.jsonc');
const PREPARE_ASSETS_SCRIPT = path.join(ROOT, 'scripts', 'prepare-cloudflare-assets.mjs');
const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`
Cloudflare project setup

Usage:
  npm run setup:cloudflare
  node scripts/setup-cloudflare.mjs

What it does:
  - asks for a Cloudflare API token and account id
  - creates or reuses D1, R2 and KV resources
  - updates wrangler.jsonc
  - optionally applies D1 migrations and seeds existing posts
  - optionally uploads Worker secrets and deploys

Token permissions usually needed:
  D1:Edit, Workers R2 Storage:Edit, Workers KV Storage:Edit,
  Workers Scripts:Edit and Account:Read.
`);
  process.exit(0);
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function stripJsonc(text) {
  let out = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }

    out += char;
  }

  return out.replace(/,\s*([}\]])/g, '$1');
}

async function readConfig() {
  const text = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(stripJsonc(text));
}

async function writeConfig(config) {
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

async function ask(question, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function askYesNo(question, defaultValue = true) {
  const suffix = defaultValue ? ' [S/n]' : ' [s/N]';
  const answer = (await rl.question(`${question}${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return ['s', 'sim', 'y', 'yes'].includes(answer);
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function printStep(title) {
  console.log(`\n== ${title} ==`);
}

function run(command, commandArgs, options = {}) {
  const label = options.label || [path.basename(command), ...commandArgs].join(' ');
  console.log(`\n> ${label}`);

  const needsShell = options.shell ?? (
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  );

  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    env: options.env,
    input: options.input,
    encoding: 'utf-8',
    shell: needsShell,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const output = `${stdout}${stderr}`;

  if (stdout.trim()) console.log(stdout.trimEnd());
  if (stderr.trim()) console.error(stderr.trimEnd());

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Command failed: ${label}`);
  }

  return {
    ok: result.status === 0,
    status: result.status,
    output,
  };
}

function runWrangler(commandArgs, env, options = {}) {
  return run(WRANGLER, commandArgs, {
    ...options,
    env,
    label: `wrangler ${commandArgs.join(' ')}`,
  });
}

function parseJsonArrayFromOutput(output) {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseD1Id(output) {
  const toml = output.match(/database_id\s*=\s*"([^"]+)"/i);
  if (toml) return toml[1];

  const json = output.match(/"database_id"\s*:\s*"([^"]+)"/i) || output.match(/"uuid"\s*:\s*"([^"]+)"/i);
  if (json) return json[1];

  const uuid = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid?.[0] || '';
}

function parseKvId(output) {
  const toml = output.match(/id\s*=\s*"([^"]+)"/i);
  if (toml) return toml[1];

  const json = output.match(/"id"\s*:\s*"([^"]+)"/i);
  if (json) return json[1];

  const hash = output.match(/[0-9a-f]{32}/i);
  return hash?.[0] || '';
}

function findD1(list, name) {
  if (!Array.isArray(list)) return null;
  return list.find((db) => db?.name === name || db?.database_name === name) || null;
}

function findKv(list, title) {
  if (!Array.isArray(list)) return null;
  return list.find((ns) => ns?.title === title || ns?.name === title) || null;
}

async function createOrFindD1({ env, name, location, existingId }) {
  if (existingId && existingId !== PLACEHOLDER_ID) {
    console.log(`Using D1 already configured: ${name} (${existingId})`);
    return existingId;
  }

  const listResult = runWrangler(['d1', 'list', '--json'], env, { allowFailure: true });
  const found = findD1(parseJsonArrayFromOutput(listResult.output), name);
  const foundId = found?.uuid || found?.id || found?.database_id;
  if (foundId) {
    console.log(`Found existing D1 database: ${name} (${foundId})`);
    return foundId;
  }

  const createArgs = ['d1', 'create', name];
  if (location) createArgs.push('--location', location);
  const createResult = runWrangler(createArgs, env);
  const createdId = parseD1Id(createResult.output);
  if (!createdId) {
    throw new Error('Could not read D1 database_id from Wrangler output.');
  }
  return createdId;
}

function createOrReuseR2({ env, name, location }) {
  const args = ['r2', 'bucket', 'create', name];
  if (location) args.push('--location', location);

  const result = runWrangler(args, env, { allowFailure: true });
  if (result.ok) return;

  if (/already exists|already owned|bucket.*exists/i.test(result.output)) {
    console.log(`R2 bucket already exists, reusing: ${name}`);
    return;
  }

  throw new Error(`Could not create R2 bucket: ${name}`);
}

function parseKvList(output) {
  const parsed = parseJsonArrayFromOutput(output);
  if (parsed) return parsed;

  const rows = [];
  const regex = /([0-9a-f]{32})\s+([^\r\n]+)/gi;
  let match;
  while ((match = regex.exec(output))) {
    rows.push({ id: match[1], title: match[2].trim() });
  }
  return rows;
}

function createOrFindKv({ env, title, existingId }) {
  const listResult = runWrangler(['kv', 'namespace', 'list'], env, { allowFailure: true });
  const kvList = parseKvList(listResult.output);
  const found = findKv(kvList, title);
  if (found?.id) {
    console.log(`Found existing KV namespace: ${title} (${found.id})`);
    return found.id;
  }

  if (!listResult.ok && existingId && existingId !== PLACEHOLDER_ID) {
    console.log(`Could not list KV namespaces. Reusing configured KV id: ${existingId}`);
    return existingId;
  }

  const createResult = runWrangler(['kv', 'namespace', 'create', title], env);
  const id = parseKvId(createResult.output);
  if (!id) {
    throw new Error('Could not read KV namespace id from Wrangler output.');
  }
  return id;
}

function setOrReplaceBinding(list, binding, value) {
  const next = Array.isArray(list) ? [...list] : [];
  const index = next.findIndex((item) => item?.binding === binding);
  if (index === -1) next.push(value);
  else next[index] = { ...next[index], ...value };
  return next;
}

function putSecret(env, key, value) {
  if (!value) return { ok: true };
  return runWrangler(['secret', 'put', key], env, {
    input: `${value}\n`,
    allowFailure: true,
  });
}

function prepareCloudflareAssets(env) {
  run(process.execPath, [PREPARE_ASSETS_SCRIPT], {
    env,
    label: 'node scripts/prepare-cloudflare-assets.mjs',
  });
}

async function main() {
  printStep('Cloudflare setup');
  console.log('O token sera usado so nesta execucao e nao sera salvo em arquivo.');

  const config = await readConfig();
  const workerName = config.name || 'credencial-online';
  const currentD1 = config.d1_databases?.[0] || {};
  const currentR2 = config.r2_buckets?.[0] || {};
  const currentKv = (config.kv_namespaces || []).find((item) => item.binding === 'SESSION') || {};

  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || await ask('Cole o Cloudflare API Token');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || await ask('Cole o Account ID da Cloudflare');
  if (!token) throw new Error('Cloudflare API Token is required.');
  if (!accountId) throw new Error('Cloudflare Account ID is required.');

  const d1Name = await ask('Nome do banco D1', currentD1.database_name || `${workerName}-db`);
  const r2Name = await ask('Nome do bucket R2', currentR2.bucket_name || `${workerName}-media`);
  const kvDefaultName = currentKv.title || currentD1.database_name || currentR2.bucket_name || `${workerName}-session`;
  const kvTitle = await ask('Nome do KV para sessoes Astro', kvDefaultName);
  const location = await ask('Regiao Cloudflare para D1/R2 (enam, wnam, weur, eeur, apac, oc)', 'enam');
  const cronMinutes = await ask('Intervalo do Cron em minutos', '5');
  const cronInterval = Number.parseInt(cronMinutes, 10);
  if (!Number.isInteger(cronInterval) || cronInterval <= 0 || String(cronInterval) !== cronMinutes.trim()) {
    throw new Error('Cron interval must be a positive integer, for example 5 or 10.');
  }

  const adminSecret = await ask('Senha do admin ADMIN_SECRET (vazio gera uma forte)', '');
  const webhookSecret = await ask('WEBHOOK_SECRET (vazio gera um forte)', '');
  const cronSecret = await ask('CRON_SECRET (vazio gera um forte)', '');

  const generated = {
    ADMIN_SECRET: adminSecret || randomSecret(),
    WEBHOOK_SECRET: webhookSecret || randomSecret(),
    CRON_SECRET: cronSecret || randomSecret(),
  };

  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    WRANGLER_SEND_METRICS: 'false',
  };

  printStep('Creating Cloudflare resources');
  const databaseId = await createOrFindD1({
    env,
    name: d1Name,
    location,
    existingId: currentD1.database_name === d1Name ? currentD1.database_id : '',
  });
  createOrReuseR2({ env, name: r2Name, location });
  const sessionKvId = createOrFindKv({
    env,
    title: kvTitle,
    existingId: currentKv.id,
  });

  printStep('Updating wrangler.jsonc');
  config.account_id = accountId;
  config.d1_databases = setOrReplaceBinding(config.d1_databases, currentD1.binding || 'POSTS_DB', {
    binding: currentD1.binding || 'POSTS_DB',
    database_name: d1Name,
    database_id: databaseId,
    migrations_dir: './migrations',
  });
  config.r2_buckets = setOrReplaceBinding(config.r2_buckets, currentR2.binding || 'MEDIA_BUCKET', {
    binding: currentR2.binding || 'MEDIA_BUCKET',
    bucket_name: r2Name,
  });
  config.kv_namespaces = setOrReplaceBinding(config.kv_namespaces, 'SESSION', {
    binding: 'SESSION',
    title: kvTitle,
    id: sessionKvId,
  });
  config.triggers = {
    ...(config.triggers || {}),
    crons: [`*/${cronInterval} * * * *`],
  };
  config.vars = {
    ...(config.vars || {}),
    PUBLIC_R2_BASE_URL: config.vars?.PUBLIC_R2_BASE_URL || '',
  };
  await writeConfig(config);
  console.log('wrangler.jsonc updated.');

  const runMigrations = await askYesNo('Aplicar migrations e seed no D1 remoto agora?', true);
  if (runMigrations) {
    printStep('Applying D1 migrations');
    runWrangler(['d1', 'migrations', 'apply', d1Name, '--remote'], env);

    printStep('Generating and applying post seed');
    run(process.execPath, [path.join(ROOT, 'scripts', 'export-posts-d1-sql.mjs')], {
      env,
      label: 'node scripts/export-posts-d1-sql.mjs',
    });
    runWrangler(['d1', 'execute', d1Name, '--remote', '--file', '.tmp/d1-posts-seed.sql'], env);

    printStep('Generating and applying site data seed');
    run(process.execPath, [path.join(ROOT, 'scripts', 'export-site-data-d1-sql.mjs')], {
      env,
      label: 'node scripts/export-site-data-d1-sql.mjs',
    });
    runWrangler(['d1', 'execute', d1Name, '--remote', '--file', '.tmp/d1-site-data-seed.sql'], env);
  }

  const verify = await askYesNo('Rodar build e wrangler deploy --dry-run?', true);
  if (verify) {
    printStep('Build and deploy dry-run');
    run(NPM, ['run', 'build'], { env, label: 'npm run build' });
    prepareCloudflareAssets(env);
    runWrangler(['deploy', '--dry-run'], env);
  }

  const deploy = await askYesNo('Fazer deploy real agora?', false);
  let didDeploy = false;
  if (deploy) {
    printStep('Deploy');
    prepareCloudflareAssets(env);
    runWrangler(['deploy'], env);
    didDeploy = true;
  }

  const uploadSecrets = await askYesNo(
    didDeploy
      ? 'Enviar ADMIN_SECRET, WEBHOOK_SECRET e CRON_SECRET para o Worker?'
      : 'Enviar secrets agora? Requer que o Worker ja exista na Cloudflare',
    didDeploy
  );
  if (uploadSecrets) {
    printStep('Uploading Worker secrets');
    const secretResults = Object.entries(generated).map(([key, value]) => [key, putSecret(env, key, value)]);
    const failed = secretResults.filter(([, result]) => !result.ok).map(([key]) => key);
    if (failed.length) {
      console.log(`Nao consegui enviar estes secrets agora: ${failed.join(', ')}.`);
      console.log('Se o Worker ainda nao existir, rode o deploy e execute este script novamente.');
    }
  }

  printStep('Done');
  console.log(`D1: ${d1Name} (${databaseId})`);
  console.log(`R2: ${r2Name}`);
  console.log(`KV SESSION: ${sessionKvId}`);
  console.log(`Cron: */${cronInterval} * * * *`);
  console.log('\nGuarde estes valores caso tenham sido gerados agora:');
  console.log(`ADMIN_SECRET=${generated.ADMIN_SECRET}`);
  console.log(`WEBHOOK_SECRET=${generated.WEBHOOK_SECRET}`);
  console.log(`CRON_SECRET=${generated.CRON_SECRET}`);
}

main()
  .catch((error) => {
    console.error(`\nSetup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
