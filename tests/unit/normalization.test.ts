import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../../src/domain/normalization/csv.ts';
import { parseAcquiredOn } from '../../src/domain/normalization/dates.ts';
import { newNoteState, resolveNote } from '../../src/domain/normalization/notes.ts';
import { deriveTags } from '../../src/domain/normalization/tags.ts';
import { normalizeCsv, validationSummary, assertImportable, SOURCE_SHA256 } from '../../scripts/lib/normalize.ts';
import { importStatements } from '../../scripts/lib/import.ts';
import { digest } from '../../scripts/lib/identity.ts';
import { allowLocalAccess } from '../../src/server/auth/local-access.ts';

const source = readFileSync('initial_collection.csv', 'utf8');
const plan = normalizeCsv(source);
const summary = validationSummary(plan);
const record = (number: number) => plan.copies.find(c => c.sourceRecordNumber === number)!;
const fixture = (rows: string[][]) => ['Title,Volume,Author,Publisher,Date Acquired,Notes', ...rows.map(row => row.map(x => `"${x.replaceAll('"', '""')}"`).join(','))].join('\n');
const row = (note = '', date = '1/2/2024') => ['Test Series', '1', 'Test Author', 'Test Publisher', date, note];

test('authoritative source has 177 collection records, no blank/legend-only rows, and unchanged bytes', () => {
  assert.equal(digest(source), SOURCE_SHA256);
  assert.equal(parseCsv(source).length, 178);
  assert.equal(plan.parsedRecords, 177); assert.equal(plan.copies.length, 177); assert.equal(plan.skipped.length, 0);
  assertImportable(plan);
});
test('42 input title spellings normalize to 38 parent series and 42 edition runs', () => {
  assert.equal(new Set(plan.copies.map(c => c.source.Title.trim())).size, 42);
  assert.equal(summary.uniqueSeries, 38); assert.equal(summary.editionRuns, 42); assert.equal(summary.volumeEditions, 176);
  const girls = plan.copies.filter(c => c.canonicalTitle === "Girls' Last Tour");
  assert.equal(girls.length, 2); assert.equal(new Set(girls.map(c => c.seriesId)).size, 1);
  assert.notEqual(plan.copies.find(c => c.canonicalTitle === 'Fruits Basket: Illustrations')!.seriesId,
    plan.copies.find(c => c.canonicalTitle === "Fruits Basket: Collector's Edition")!.seriesId);
});
test('CSV parser handles BOM, empty headers, quoted commas, newlines, doubled quotes and CRLF', () => {
  assert.deepEqual(parseCsv('\uFEFFa,,c\r\n"one,two","three\nlines","say ""hi"""\r\n'), [['a', '', 'c'], ['one,two', 'three\nlines', 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b\n,'), [['a', 'b'], ['', '']]);
  assert.deepEqual(parseCsv('a,b\n\n'), [['a', 'b'], ['']]);
});
for (const malformed of ['a\n"unclosed', 'a\n"closed"suffix', 'a\nun"quoted']) {
  test(`malformed CSV is blocked: ${JSON.stringify(malformed)}`, () => assert.throws(() => parseCsv(malformed)));
}
test('legend columns never enter normalized rows or audit snapshots', () => {
  for (const copy of plan.copies) assert.deepEqual(Object.keys(copy.source), ['Title', 'Volume', 'Author', 'Publisher', 'Date Acquired', 'Notes']);
  assert.equal(JSON.stringify(plan).includes('Language Legend'), false);
  assert.equal(JSON.stringify(plan).includes('Total Volumes'), false);
});
test('whitespace is trimmed while original source values remain auditable', () => {
  assert.equal(record(46).source.Publisher, 'Kodansha ');
  assert.equal(record(46).corrected.Publisher, 'Kodansha');
  assert.equal(record(72).source.Author, 'Kakifly ');
  assert.equal(record(72).corrected.Author, 'Kakifly');
  const c = normalizeCsv(fixture([[' Title ', ' 1 ', ' Author ', ' Publisher ', ' 1/2/2024 ', ' note ']])).copies[0]!;
  assert.equal(c.canonicalTitle, 'Title'); assert.equal(c.notes, 'note'); assert.equal(c.acquiredOn, '2024-01-02');
});
test('all exact row corrections target semantic identity and retain specification indexes', () => {
  assert.equal(record(1).corrected.Author, 'Yoshitoki Ōima');
  assert.equal(record(121).corrected.Author, 'Tatsuya Endo');
  assert.equal(record(121).corrections[0]!.specificationIndex, 120);
  assert.equal(record(154).corrected.Author, 'Natsuki Takaya'); assert.equal(record(154).corrected.Publisher, 'Yen Press');
  assert.ok(record(154).corrections.every(c => c.specificationIndex === 153));
  for (const n of [174, 175, 176]) {
    assert.equal(record(n).corrected.Author, 'Saka Mikami'); assert.equal(record(n).corrected.Publisher, 'Kodansha');
    assert.ok(record(n).corrections.every(c => c.specificationIndex === n - 1));
  }
  assert.equal(record(177).corrected.Author, 'inee'); assert.equal(record(177).corrected.Publisher, 'Kadokawa');
  assert.equal(summary.correctionOutcomes.filter(c => c.status === 'applied').length, 13);
});
test('corrections survive shifted rows; conflicting source edits block instead of being overwritten', () => {
  const shifted = normalizeCsv(source.replace('\r\n', '\r\n,,,,,,,,\r\n'));
  assert.equal(shifted.copies.find(c => c.corrected.Title === 'SPY x FAMILY' && c.volumeLabel === '3')!.corrected.Author, 'Tatsuya Endo');
  assert.equal(shifted.skipped.length, 1);
  const changed = normalizeCsv(source.replace('SPY x FAMILY,3,Tatsuki Fujimoto', 'SPY x FAMILY,3,Owner-confirmed name'));
  assert.equal(changed.copies.find(c => c.sourceRecordNumber === 121)!.corrected.Author, 'Owner-confirmed name');
  assert.throws(() => assertImportable(changed), /blocked/);
  const corrected = normalizeCsv(source.replace('SPY x FAMILY,3,Tatsuki Fujimoto', 'SPY x FAMILY,3,Tatsuya Endo'));
  assert.equal(corrected.copies.find(c => c.sourceRecordNumber === 121)!.corrections[0]!.status, 'already-correct');
});
test('publisher distribution and author Unicode normalization match the independent baseline', () => {
  assert.deepEqual(summary.publisherDistribution, { 'DNA Media': 3, Houbunsha: 4, Kadokawa: 4, 'Kaiten Books': 2, Kodansha: 76, 'Mag Garden': 1, 'Seven Seas': 2, 'Square Enix': 1, 'Udon Entertainment': 9, 'VIZ Media': 42, 'Yen Press': 33 });
  assert.equal(Object.values(summary.publisherDistribution).reduce((a, b) => a + b, 0), 177);
  const oima = plan.tables.creators!.filter(c => c.display_name === 'Yoshitoki Ōima');
  assert.equal(oima.length, 1); assert.equal(plan.tables.creators!.some(c => c.display_name === 'Yoshitoki Oima'), false);
});
test('multilingual parent grouping preserves edition titles and language provenance', () => {
  assert.deepEqual(summary.volumesPerLanguage, { EN: 167, JP: 9, KR: 1 });
  assert.equal(plan.copies.filter(c => c.languageBasis === 'assumed').length, 163);
  const sign = plan.copies.filter(c => c.canonicalTitle === 'A Sign of Affection');
  assert.equal(sign.length, 10); assert.equal(new Set(sign.map(c => c.seriesId)).size, 1);
  assert.equal(sign.filter(c => c.language === 'EN').length, 8);
  assert.equal(sign.find(c => c.language === 'KR')!.editionTitle, 'A Sign of Affection (KR)');
  assert.equal(sign.find(c => c.language === 'JP')!.editionTitle, 'Yubisaki to Renren');
  const flower = plan.copies.filter(c => c.canonicalTitle === 'The Fragrant Flower Blooms With Dignity');
  assert.equal(flower.length, 4); assert.equal(new Set(flower.map(c => c.seriesId)).size, 1);
  assert.equal(flower.find(c => c.language === 'JP')!.editionTitle, 'Kaoru Hana wa Rin to Saku');
  const kon = plan.copies.filter(c => c.canonicalTitle === 'K-ON!');
  assert.equal(kon.filter(c => c.corrected.Publisher === 'Houbunsha' && c.language === 'JP').length, 4);
  assert.equal(kon.filter(c => c.corrected.Publisher === 'Yen Press' && c.language === 'EN' && c.languageBasis === 'specified').length, 4);
  assert.equal(plan.copies.filter(c => c.canonicalTitle === 'Project SEKAI Comic Anthology' && c.language === 'JP').length, 3);
});
test('both repeated Vol 1 physical copies survive with separate stable ownership IDs', () => {
  const a = record(158), b = record(173);
  assert.notEqual(a.itemId, b.itemId); assert.equal(a.volumeEditionId, b.volumeEditionId);
  assert.equal(a.acquiredOn, '2024-05-10'); assert.equal(b.acquiredOn, null);
  assert.match(a.itemId, /^[a-f\d]{8}-[a-f\d]{4}-5[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  assert.equal(new Set(plan.copies.map(c => c.itemId)).size, 177);
});
test('all real note cascades including cross-date batches preserve exact note text', () => {
  assert.equal(summary.recordsWithNotes, 97);
  assert.equal(plan.copies.filter(c => c.notes === 'first b&n manga trip').length, 5);
  assert.equal(plan.copies.filter(c => c.notes === 'xmas gifts').length, 19);
  assert.equal(plan.copies.filter(c => c.notes === 'from sammy <3').length, 5);
  assert.equal(record(71).notes, 'box set'); assert.equal(record(71).acquiredOn, '2022-08-17');
  assert.equal(record(12).notes, ':skull:'); assert.equal(record(139).notes, 'from sammy c:');
  assert.equal(record(7).notes, null); assert.equal(record(117).notes, 'proxy shipped from jp');
  assert.equal(plan.copies.filter(c => c.source.Notes.trim() === '|').length, 57);
  assert.equal(plan.copies.filter(c => ['\\/', '\\\\/'].includes(c.source.Notes.trim())).length, 17);
  assert.ok(plan.copies.every(c => !['|', '\\/', '\\\\/'].includes(c.notes ?? '')));
});
for (const closing of ['\\/', '\\\\/']) {
  test(`closing marker ${JSON.stringify(closing)} applies then terminates a cascade`, () => {
    const normalized = normalizeCsv(fixture([row('batch'), row('|'), row(closing), row('|')]));
    assert.deepEqual(normalized.copies.map(c => c.notes), ['batch', 'batch', 'batch', null]);
    assert.ok(normalized.issues.some(i => i.code === 'ORPHAN_CONTINUATION'));
  });
}
test('blank notes reset state and date changes alone do not stop an explicit cascade', () => {
  const p = normalizeCsv(fixture([row('batch'), row('|', '1/3/2024'), row(''), row('|')]));
  assert.deepEqual(p.copies.map(c => c.notes), ['batch', 'batch', null, null]);
});
test('isolated closing markers reuse only the immediately preceding resolved note with a known equal calendar date', () => {
  const p = normalizeCsv(fixture([row('batch'), row('\\/'), row('\\/'), row('\\/', '1/3/2024')]));
  assert.deepEqual(p.copies.map(c => c.notes), ['batch', 'batch', 'batch', null]);
  const equal = { active: null, previousNote: 'earlier', previousDate: '2024-01-02' };
  assert.equal(resolveNote('\\/', '2024-01-02', equal).note, 'earlier');
  assert.equal(resolveNote('\\/', null, { active: null, previousNote: 'earlier', previousDate: null }).note, null);
  assert.equal(resolveNote('\\/', '2024-01-02', newNoteState()).note, null);
  assert.equal(resolveNote('\\/', '2024-01-03', { active: null, previousNote: 'earlier', previousDate: '2024-01-02' }).note, null);
});
test('ordinary punctuation is text, not a marker or HTML', () => {
  for (const note of ['from sammy <3', 'pipe | inside', 'path \\/ here', ':skull:', 'a/b']) assert.equal(resolveNote(note, null, newNoteState()).note, note);
});
test('blank and legend-only rows are reported and reset note state; malformed noncollection rows block', () => {
  const p = normalizeCsv('Title,Volume,Author,Publisher,Date Acquired,Notes,,Language Legend,\nA,1,B,C,1/2/2024,note,,,\n,,,,,,,Total,177\nA,2,B,C,1/2/2024,|,,,\n');
  assert.equal(p.copies.length, 2); assert.equal(p.skipped.length, 1);
  assert.deepEqual(p.copies.map(c => c.sourceRecordNumber), [1, 3]); assert.equal(p.copies[1]!.notes, null);
  const bad = normalizeCsv(fixture([['Total Volumes', '', '', '', '', '']]));
  assert.throws(() => assertImportable(bad), /blocked/);
  assert.throws(() => normalizeCsv('Title,Title\na,b'), /exactly one/);
  assert.ok(normalizeCsv('Title,Volume,Author,Publisher,Date Acquired,Notes\nA,1,B,C').issues.some(i => i.code === 'COLUMN_COUNT'));
});
test('calendar dates preserve mixed padding, leap days and five null dates', () => {
  assert.equal(parseAcquiredOn('1/2/2024'), '2024-01-02'); assert.equal(parseAcquiredOn('01/02/2024'), '2024-01-02');
  assert.equal(parseAcquiredOn('2/29/2000'), '2000-02-29'); assert.equal(parseAcquiredOn(''), null);
  assert.equal(summary.datedCopies, 172); assert.equal(summary.undatedCopies, 5); assert.equal(summary.distinctAcquisitionDates, 55);
  assert.deepEqual(summary.acquisitionYears, { 2021: 21, 2022: 96, 2023: 26, 2024: 29, unknown: 5 });
});
for (const value of ['2/29/1900', '2/29/2023', '4/31/2024', '13/1/2024', '0/1/2024', '1/0/2024', '1/1/0000', '2024-01-02', 'yesterday']) {
  test(`invalid nonempty date blocks: ${value}`, () => {
    assert.throws(() => parseAcquiredOn(value));
    assert.throws(() => assertImportable(normalizeCsv(fixture([row('', value)]))), /blocked/);
  });
}
test('dates do not shift in UTC, Los Angeles or Tokyo', () => {
  const previous = process.env.TZ;
  try {
    for (const [zone, offset] of [['UTC', 0], ['America/Los_Angeles', 480], ['Asia/Tokyo', -540]] as const) {
      process.env.TZ = zone;
      assert.equal(new Date('2024-01-01T12:00:00Z').getTimezoneOffset(), offset);
      assert.equal(parseAcquiredOn('9/18/2021'), '2021-09-18');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('deterministic normalization and parameterized statements contain no wall-clock values', () => {
  assert.equal(JSON.stringify(plan), JSON.stringify(normalizeCsv(source)));
  assert.equal(JSON.stringify(importStatements(plan)), JSON.stringify(importStatements(normalizeCsv(source))));
  assert.ok(importStatements(plan).every(s => s.params.length <= 100));
  assert.equal(importStatements(plan).some(s => s.sql.includes('from sammy')), false);
});
test('memory and edition tags preserve note text without inventing Sammy gifts or omnibus contents', () => {
  assert.deepEqual(deriveTags('xmas gifts', 'A'), []);
  assert.deepEqual(deriveTags('from sammy <3', 'A'), ['gifts-from-sammy']);
  assert.deepEqual(deriveTags('box set bday gift', 'A'), ['box-sets', 'box-set']);
  assert.deepEqual(deriveTags(null, "Fruits Basket: Collector's Edition"), ['collectors-edition']);
  for (const c of plan.copies.filter(c => c.canonicalTitle === 'Steins;Gate')) {
    assert.equal(c.format, 'unknown'); assert.equal(c.numberingBasis, 'source_record'); assert.ok(c.tags.includes('omnibus'));
  }
});
test('unverified language, date, packaging and regional publisher facts are reported', () => {
  const sizes = Object.fromEntries(plan.issues.map(i => [i.code, i.sourceRecords.length]));
  assert.deepEqual(sizes, { ASSUMED_LANGUAGE: 163, UNKNOWN_ACQUISITION_DATE: 5, AMBIGUOUS_OMNIBUS: 3, REGIONAL_PUBLISHER_REVIEW: 1, REPEATED_PHYSICAL_COPY: 2 });
  assert.equal(plan.issues.filter(i => i.severity === 'error').length, 0);
});
test('local development identity requires explicit flags and localhost; hosted reads fail closed', () => {
  assert.equal(allowLocalAccess(new URL('http://localhost:4321'), { APP_ENV: 'local', LOCAL_DEV_AUTH: 'true' }), true);
  for (const env of [{}, { APP_ENV: 'production', LOCAL_DEV_AUTH: 'true' }, { APP_ENV: 'local' }]) assert.equal(allowLocalAccess(new URL('http://localhost'), env), false);
  assert.equal(allowLocalAccess(new URL('https://library.pages.dev'), { APP_ENV: 'local', LOCAL_DEV_AUTH: 'true' }), false);
});
