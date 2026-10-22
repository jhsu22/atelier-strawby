import { readFile } from 'node:fs/promises';
import { stableId, searchKey } from './identity.ts';
import { insertStatement } from './import.ts';
import type { Database, Statement } from './types.ts';

interface Sample { key: string; title: string; artist: string | null; artistKind: string; source: string; resolution: string; isSample: boolean }
export async function seedSampleCds(db: Database) {
  const samples: Sample[] = JSON.parse(await readFile(new URL('../../data/sample-cds.json', import.meta.url), 'utf8'));
  const statements: Statement[] = [];
  for (const sample of samples) {
    if (sample.isSample !== true || sample.resolution !== 'unresolved' || !sample.key || !sample.title) throw new Error('Invalid sample definition');
    const albumId = stableId('sample-album', sample.key); const releaseId = stableId('sample-release', sample.key);
    const itemId = stableId('sample-cd', sample.key);
    statements.push(insertStatement('albums', { id: albumId, title: sample.title, sort_title: searchKey(sample.title), description: `DEMONSTRATION ONLY. Source: ${sample.source}. Exact release, format, label, date, catalog number and tracklist are unresolved.` }));
    if (sample.artist) {
      const creatorId = stableId('sample-artist', sample.artist);
      statements.push(insertStatement('creators', { id: creatorId, display_name: sample.artist, search_key: searchKey(sample.artist), kind: sample.artistKind }));
      // Composite credit key handled explicitly; artist names are not globally unique.
      statements.push({ sql: 'INSERT INTO album_creators(album_id, creator_id, role, credit_order) VALUES (?, ?, ?, ?) ON CONFLICT (album_id, creator_id, role) DO NOTHING', params: [albumId, creatorId, 'artist', 0] });
    }
    statements.push(insertStatement('album_releases', { id: releaseId, album_id: albumId, metadata_state: 'unverified' }));
    statements.push(insertStatement('collection_items', { id: itemId, media_kind: 'cd', is_sample: 1, idempotency_key: `sample-cd:${sample.key}`, notes: 'Demonstration record; not an owned CD.' }));
    statements.push({ sql: "INSERT INTO cds(item_id, media_kind, release_id) VALUES (?, 'cd', ?) ON CONFLICT (item_id) DO NOTHING", params: [itemId, releaseId] });
  }
  // All four sample definitions fit in one bounded atomic batch.
  await db.batch(statements);
  return samples.length;
}
