import { parseArgs } from 'node:util';
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Database } from './types.ts';

// Resolve existing ancestors as well as not-yet-created paths. This also catches
// an output/database path that reaches a static directory through a symlink.
function physicalPath(path: string, depth = 0): string {
  if (depth > 100) throw new Error('Cannot resolve private artifact path');
  const absolute = resolve(path);
  try { return realpathSync(absolute); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (lstatSync(absolute, { throwIfNoEntry: false })?.isSymbolicLink()) {
    return physicalPath(resolve(dirname(absolute), readlinkSync(absolute)), depth + 1);
  }
  return join(physicalPath(dirname(absolute), depth + 1), basename(absolute));
}
function assertPrivatePath(path: string) {
  const destinations = [resolve(path), physicalPath(path)];
  for (const dir of ['public', 'dist']) {
    for (const root of [resolve(dir), physicalPath(dir)]) {
      if (destinations.some(destination => destination === root || destination.startsWith(root + sep))) {
        throw new Error('Private artifacts and databases cannot be written under public/ or dist/.');
      }
    }
  }
}

export function options(defaultTarget = 'artifacts', args?: string[]) {
  const { values } = parseArgs({ args, options: {
    input: { type: 'string', default: 'initial_collection.csv' },
    target: { type: 'string', default: defaultTarget },
    database: { type: 'string', default: 'data/generated/collection.sqlite' },
    output: { type: 'string', default: 'data/generated' },
  } });
  if (!['artifacts', 'sqlite', 'd1-local'].includes(values.target!)) throw new Error('Target must be artifacts, sqlite, or d1-local; remote seeding is not supported.');
  const output = resolve(values.output!);
  assertPrivatePath(output);
  if (values.database !== ':memory:') assertPrivatePath(values.database!);
  return { input: values.input!, target: values.target!, database: values.database!, output };
}
export async function openTarget(opts: ReturnType<typeof options>): Promise<Database> {
  if (opts.target === 'sqlite') {
    const { openSqlite } = await import('./sqlite.ts');
    return openSqlite(opts.database);
  }
  if (opts.target === 'd1-local') {
    const { openLocalD1 } = await import('./d1.ts');
    return openLocalD1();
  }
  throw new Error('Choose --target sqlite or --target d1-local to read/write a database.');
}
