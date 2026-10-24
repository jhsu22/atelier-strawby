import { readFileSync, mkdirSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const mode = process.argv[2];
if (!["check", "prepare", "production", "preview"].includes(mode ?? "")) throw new Error("Choose check, prepare, production or preview.");
const configPath = resolve("wrangler.hosted.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!/^[a-z0-9-]+$/.test(config.name)) throw new Error("Set the Pages project name.");
if (config.pages_build_output_dir !== "./dist") throw new Error("Deploy only ./dist.");
const environments = [config, config.env?.preview];
for (const [i, env] of environments.entries()) {
  if (!env || JSON.stringify(env).includes("REPLACE_")) throw new Error("Complete both hosted environments in wrangler.hosted.json.");
  if (!env.d1_databases?.some((db: {binding: string; database_id: string; migrations_dir: string}) => db.binding === "DB" && /^[0-9a-f-]{36}$/i.test(db.database_id) && !db.database_id.startsWith("00000000-") && db.migrations_dir === "drizzle")) throw new Error("Configure a real DB binding and drizzle migrations.");
  if (!env.r2_buckets?.some((bucket: {binding: string; bucket_name: string}) => bucket.binding === "COVERS" && !bucket.bucket_name.endsWith("-local"))) throw new Error("Configure the private COVERS bucket.");
  const vars = env.vars;
  if (vars?.APP_ENV !== (i === 0 ? "production" : "preview") || vars.LOCAL_DEV_AUTH) throw new Error("Hosted environments must never enable local auth.");
  const origin = new URL(vars.APP_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== vars.APP_ORIGIN || /localhost|127\.0\.0\.1/.test(origin.hostname)) throw new Error("APP_ORIGIN must be an exact hosted HTTPS origin.");
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_TEAM_DOMAIN) || !vars.ACCESS_AUDIENCE) throw new Error("Configure Cloudflare Access issuer and audience.");
}
if (config.d1_databases[0].database_id === config.env.preview.d1_databases[0].database_id || config.r2_buckets[0].bucket_name === config.env.preview.r2_buckets[0].bucket_name) throw new Error("Preview and production must use separate D1 and R2 resources.");
console.log("Hosted configuration passes static checks. Credentials, Access policy, owner-email secret, resources and migrations still require hosted verification.");
if (mode !== "check") {
  const build = spawnSync("npm", ["run", "build"], {stdio: "inherit"});
  if (build.status !== 0) process.exit(build.status ?? 1);
  // Wrangler 4.151 Pages rejects custom --config paths. Stage a standard config
  // beside only the build and migrations; keep localhost config and secrets out.
  const directory = resolve("releases/cloudflare");
  mkdirSync(directory, {recursive: true});
  rmSync(resolve(directory, "dist"), {recursive: true, force: true});
  cpSync("dist", resolve(directory, "dist"), {recursive: true, force: true});
  cpSync("drizzle", resolve(directory, "drizzle"), {recursive: true, force: true});
  // Wrangler locates its Pages temp files from the nearest package.json.
  // An isolated package boundary prevents rereading the parent local config.
  writeFileSync(resolve(directory, "package.json"), JSON.stringify({name: config.name, private: true, type: "module"}) + "\n");
  writeFileSync(resolve(directory, "wrangler.json"), JSON.stringify(config, null, 2) + "\n");
  console.log(`Prepared Pages upload in ${directory}.`);
  if (mode !== "prepare") {
    const deploy = spawnSync(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "pages", "deploy", "dist", "--project-name", config.name, "--branch", mode === "production" ? "main" : "preview"], {stdio: "inherit", cwd: directory});
    process.exitCode = deploy.status ?? 1;
  }
}
