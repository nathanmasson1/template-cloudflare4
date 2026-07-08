import { spawn } from "node:child_process";
import process from "node:process";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for auto deploy.`);
  }
  return value;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}.`));
    });
  });
}

const d1Name = requiredEnv("AUTODEPLOY_D1_NAME");

await run("node", ["scripts/autodeploy-prepare.mjs"]);
await run("npx", ["wrangler", "d1", "migrations", "apply", d1Name, "--remote", "--config", "wrangler.autodeploy.jsonc"]);
await run("node", ["scripts/export-posts-d1-sql.mjs"]);
await run("npx", [
  "wrangler",
  "d1",
  "execute",
  d1Name,
  "--remote",
  "--file",
  ".tmp/d1-posts-seed.sql",
  "--config",
  "wrangler.autodeploy.jsonc",
]);
await run("node", ["scripts/export-site-data-d1-sql.mjs"]);
await run("npx", [
  "wrangler",
  "d1",
  "execute",
  d1Name,
  "--remote",
  "--file",
  ".tmp/d1-site-data-seed.sql",
  "--config",
  "wrangler.autodeploy.jsonc",
]);
await run("node", ["scripts/prepare-cloudflare-assets.mjs"]);
await run("npx", ["wrangler", "deploy"]);
