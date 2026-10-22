import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { options } from '../../scripts/lib/cli.ts';

test('private artifacts and SQLite databases cannot target static deployment directories', () => {
  for (const root of ['public', 'dist']) {
    for (const option of ['--output', '--database']) {
      for (const path of [root, `${root}/nested/private.sqlite`, resolve(root, 'private.sqlite')]) {
        assert.throws(() => options('sqlite', [option, path]), /cannot be written under public\/ or dist\//);
      }
    }
  }
});

test('private destinations remain protected through symlinks and missing descendants', () => {
  const directory = mkdtempSync(join(tmpdir(), 'strawby-paths-'));
  try {
    for (const root of ['public', 'dist']) {
      const alias = join(directory, root);
      symlinkSync(resolve(root), alias);
      const dangling = join(directory, `${root}.sqlite`);
      symlinkSync(resolve(root, 'not-created.sqlite'), dangling);
      for (const option of ['--output', '--database']) {
        assert.throws(() => options('sqlite', [option, join(alias, 'missing', 'private.sqlite')]), /cannot be written/);
        assert.throws(() => options('sqlite', [option, dangling]), /cannot be written/);
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('private paths, in-memory verification, and similarly named sibling directories are allowed', () => {
  const defaults = options('sqlite', []);
  assert.equal(defaults.database, 'data/generated/collection.sqlite');
  assert.equal(defaults.output, resolve('data/generated'));
  assert.equal(options('sqlite', ['--database', ':memory:']).database, ':memory:');
  for (const root of ['public-backup', 'dist-backup']) {
    assert.equal(options('sqlite', ['--output', root]).output, resolve(root));
    assert.equal(options('sqlite', ['--database', `${root}/collection.sqlite`]).database, `${root}/collection.sqlite`);
  }
});
