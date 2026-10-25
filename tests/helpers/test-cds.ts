import { stableId, searchKey } from "../../scripts/lib/identity.ts";
import { insertStatement } from "../../scripts/lib/import.ts";
import type { Database, Statement } from "../../scripts/lib/types.ts";

// Four CDs with unresolved release data, for tests that need CDs on a
// disposable database. The app itself never seeds CDs.
const cds = [
  { key: "kessoku-band", title: "Kessoku Band", artist: "Kessoku Band", artistKind: "group" },
  { key: "your-name", title: "Your Name OST", artist: "RADWIMPS", artistKind: "group" },
  { key: "evangelion-finally", title: "Evangelion Finally", artist: null, artistKind: "unknown" },
  { key: "hirasawa", title: "Susumu Hirasawa (album unresolved)", artist: "Susumu Hirasawa", artistKind: "person" },
];
export const TEST_CD_COUNT = cds.length;

/** Idempotent: repeated calls leave the same four CDs. */
export async function seedTestCds(db: Database) {
  const statements: Statement[] = [];
  for (const cd of cds) {
    const albumId = stableId("test-album", cd.key), releaseId = stableId("test-release", cd.key);
    const itemId = stableId("test-cd", cd.key);
    statements.push(insertStatement("albums", { id: albumId, title: cd.title, sort_title: searchKey(cd.title) }));
    if (cd.artist) {
      const creatorId = stableId("test-artist", cd.artist);
      statements.push(insertStatement("creators", { id: creatorId, display_name: cd.artist, search_key: searchKey(cd.artist), kind: cd.artistKind }));
      statements.push({ sql: "INSERT INTO album_creators(album_id, creator_id, role, credit_order) VALUES (?, ?, ?, ?) ON CONFLICT (album_id, creator_id, role) DO NOTHING", params: [albumId, creatorId, "artist", 0] });
    }
    statements.push(insertStatement("album_releases", { id: releaseId, album_id: albumId, metadata_state: "unverified" }));
    statements.push(insertStatement("collection_items", { id: itemId, media_kind: "cd", idempotency_key: `test-cd:${cd.key}` }));
    statements.push({ sql: "INSERT INTO cds(item_id, media_kind, release_id) VALUES (?, 'cd', ?) ON CONFLICT (item_id) DO NOTHING", params: [itemId, releaseId] });
  }
  await db.batch(statements);
  return cds.length;
}
