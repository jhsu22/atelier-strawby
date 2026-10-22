import { readdir } from 'node:fs/promises';
// node:test auto-runs registered tests in this process; no child-process permission
// is needed. Each integration test still creates its own disposable database.
const suite = process.argv[2];
if (!suite || !['unit', 'integration', 'd1'].includes(suite)) throw new Error('Choose unit, integration, or d1');
const dir = new URL(`../tests/${suite}/`, import.meta.url);
const files = (await readdir(dir)).filter(name => name.endsWith('.test.ts')).sort();
if (!files.length) throw new Error(`No tests in ${suite}`);
for (const file of files) await import(new URL(file, dir).href);
