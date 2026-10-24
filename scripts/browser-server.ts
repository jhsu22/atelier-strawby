import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { openLocalD1 } from "./lib/d1.ts";
import { migrationStatements } from "./lib/migrations.ts";
import { normalizeCsv } from "./lib/normalize.ts";
import { persistPlan } from "./lib/import.ts";
import { seedSampleCds } from "./lib/sample-cds.ts";

// Browser mutation tests always get a fresh compiled worker and disposable D1/R2.
const built = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
const directory = await mkdtemp(join(tmpdir(), "strawby-browser-"));
try {
  const db = await openLocalD1(join(directory, "v3"));
  try {
    const statements = await migrationStatements();
    for (let i = 0; i < statements.length; i += 40)
      await db.batch(statements.slice(i, i + 40));
    await persistPlan(
      db,
      normalizeCsv(await readFile("initial_collection.csv", "utf8")),
    );
    await seedSampleCds(db);
  } finally {
    await db.close();
  }
  const child = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "pages",
      "dev",
      "dist",
      "--ip",
      "127.0.0.1",
      "--port",
      process.env.STRAWBY_TEST_PORT ?? "4321",
      "--inspector-port",
      "9235",
      "--binding",
      "APP_ENV=local",
      "--binding",
      "LOCAL_DEV_AUTH=true",
      "--persist-to",
      directory,
    ],
    { stdio: "inherit" },
  );
  let stopping = false;
  const stop = () => {
    if (!stopping) {
      stopping = true;
      child.kill("SIGTERM");
    }
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const code = await new Promise<number>((resolve) =>
    child.once("exit", (code) => resolve(code ?? 0)),
  );
  process.exitCode = code;
} finally {
  await rm(directory, { recursive: true, force: true });
}
