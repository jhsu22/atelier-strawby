import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("deployment guard rejects placeholder resources, local auth and shared preview data without invoking deployment", () => {
  const directory = mkdtempSync(join(tmpdir(), "strawby-config-"));
  const template = readFileSync("wrangler.hosted.json.example", "utf8");
  const run = (value: unknown) => {
    writeFileSync(join(directory, "wrangler.hosted.json"), JSON.stringify(value));
    return spawnSync(process.execPath, [resolve("scripts/deploy.ts"), "check"], {cwd: directory, encoding: "utf8"});
  };
  try {
    assert.notEqual(run(JSON.parse(template)).status, 0);
    const config = JSON.parse(template.replace(/REPLACE_PRODUCTION_D1_UUID/g, "11111111-1111-4111-8111-111111111111").replace(/REPLACE_PREVIEW_D1_UUID/g, "22222222-2222-4222-8222-222222222222").replace(/REPLACE_PRODUCTION_COVERS_BUCKET/g, "test-production-covers").replace(/REPLACE_PREVIEW_COVERS_BUCKET/g, "test-preview-covers").replace(/REPLACE_PRODUCTION_HOST/g, "library.example.com").replace(/REPLACE_TEAM/g, "test-team").replace(/REPLACE_PRODUCTION_ACCESS_AUD/g, "production-audience").replace(/REPLACE_PREVIEW_ACCESS_AUD/g, "preview-audience").replace(/REPLACE_PUBLIC_CONTACT_URL/g, "https://example.com/contact").replace(/REPLACE_PROJECT/g, "test-project"));
    assert.equal(run(config).status, 0);
    const badAuth = structuredClone(config); badAuth.vars.LOCAL_DEV_AUTH = "true";
    assert.notEqual(run(badAuth).status, 0);
    const shared = structuredClone(config); shared.env.preview.d1_databases[0].database_id = shared.d1_databases[0].database_id;
    assert.notEqual(run(shared).status, 0);
    const origin = structuredClone(config); origin.vars.APP_ORIGIN += "/path";
    assert.notEqual(run(origin).status, 0);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
