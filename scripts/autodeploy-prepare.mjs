import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "wrangler.jsonc");
const targetPath = path.join(root, "wrangler.autodeploy.jsonc");
const deployConfigPath = path.join(root, ".wrangler", "deploy", "config.json");

function stripJsonc(text) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] || "";

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for auto deploy.`);
  }
  return value;
}

const config = JSON.parse(stripJsonc(fs.readFileSync(sourcePath, "utf8")));
const workerName = requiredEnv("AUTODEPLOY_WORKER_NAME");
const accountId = requiredEnv("AUTODEPLOY_ACCOUNT_ID");
const d1Name = requiredEnv("AUTODEPLOY_D1_NAME");
const d1Id = requiredEnv("AUTODEPLOY_D1_ID");
const r2Bucket = requiredEnv("AUTODEPLOY_R2_BUCKET");
const kvId = requiredEnv("AUTODEPLOY_KV_ID");
const customDomain = process.env.AUTODEPLOY_CUSTOM_DOMAIN?.trim() || "";

config.name = workerName;
config.account_id = accountId;
config.main = "./dist/_worker.js/index.js";
config.workers_dev = true;
config.d1_databases = [
  {
    binding: "POSTS_DB",
    database_name: d1Name,
    database_id: d1Id,
    migrations_dir: "./migrations",
  },
];
config.r2_buckets = [
  {
    binding: "MEDIA_BUCKET",
    bucket_name: r2Bucket,
  },
];
config.kv_namespaces = [
  {
    binding: "SESSION",
    id: kvId,
  },
];

if (customDomain) {
  config.routes = [
    {
      pattern: customDomain,
      custom_domain: true,
    },
  ];
} else {
  delete config.routes;
}

fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
fs.mkdirSync(path.dirname(deployConfigPath), { recursive: true });
fs.writeFileSync(
  deployConfigPath,
  `${JSON.stringify({ configPath: "../../wrangler.autodeploy.jsonc" }, null, 2)}\n`,
  "utf8",
);
console.log(`Generated ${path.relative(root, targetPath)} for ${workerName}`);
console.log(`Generated ${path.relative(root, deployConfigPath)} for Wrangler config redirect`);
