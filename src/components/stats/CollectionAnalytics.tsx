import { useMemo } from "react";
import type { LibraryEntry } from "../../domain/library.ts";
import { calendarLabel, collectionAnalytics } from "../../domain/collection-insights.ts";

function Bars({ title, rule, rows, onOpen }: { title: string; rule: string; rows: {label: string; count: number; id?: string}[]; onOpen?: (id: string) => void }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <section className="analytics-chart" aria-label={title}><h3>{title}</h3><p className="chart-rule">{rule}</p>
    {rows.length ? <ul className="analytics-bars">{rows.map(row => <li key={row.id ?? row.label}>
      <span>{row.id && onOpen ? <button className="text-button" onClick={() => onOpen(row.id!)}>{row.label}</button> : row.label}</span>
      <strong className="mono">{row.count}</strong><span className="analytics-bar" aria-hidden="true"><i style={{width: `${row.count / max * 100}%`}} /></span>
    </li>)}</ul> : <p className="chart-rule">No personal copies recorded.</p>}
  </section>;
}
export function CollectionAnalytics({ entries, onOpen, onTimeline }: { entries: LibraryEntry[]; onOpen: (entry: LibraryEntry) => void; onTimeline: () => void }) {
  const stats = useMemo(() => collectionAnalytics(entries), [entries]);
  const open = (id: string) => { const entry = entries.find(entry => entry.id === id); if (entry) onOpen(entry); };
  const publisher = stats.publishers.filter(row => row.label !== "Unknown publisher");
  const leaders = publisher.filter(row => row.count === publisher[0]?.count);
  const largest = stats.largestHauls[0];
  const most = stats.mostCollected.filter(row => row.count === stats.mostCollected[0]?.count);
  const growth = stats.mangaYears.filter(row => row.label !== "Unknown date");
  const latest = growth.at(-1), previous = growth.at(-2);
  return <div className="collection-analytics">
    <div className="journal-intro"><span className="journal-eyebrow">A PORTRAIT OF YOUR SHELVES</span><p>The collection, in numbers.</p><span>Calculated from your current owned records. Every copy has a place.</span></div>
    <div className="stats-grid analytics-totals">{[[stats.mangaCopies, "Physical manga volumes"], [stats.uniqueSeries, "Unique manga series"], [stats.cds, "Personal CDs"], [stats.books, "Books (separate)"]].map(([count, label]) => <div key={label} data-metric={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
    <p className="chart-rule">Manga includes {stats.lightNovels} light novel copies. {stats.samples} sample CDs excluded. {stats.undated} personal copies have no acquisition date.</p>
    <section className="collection-insights" aria-label="Personal collection insights">
      <h3>Little things your shelves tell us</h3>
      <ul>
        {!!leaders.length && <li><span>Most common recorded publisher{leaders.length > 1 ? "s (tie)" : ""}</span><strong>{leaders.map(row => row.label).join(" · ")}</strong><small>{leaders[0]!.count} manga / LN copies each. Unknown publishers excluded from this comparison.</small></li>}
        {largest && <li><span>{largest.logged ? "Largest logged haul" : "Largest recorded date"}{stats.largestHauls.filter(haul => haul.items.length === largest.items.length).length > 1 ? " (tied)" : ""}</span><button className="text-button" onClick={onTimeline}>{calendarLabel(largest.date!)}{largest.logged?.store ? ` · ${largest.logged.store}` : ""}</button><small>{largest.items.length} personal copies across all media. {largest.logged ? "Logged together as one haul." : "Same-day purchases may be separate hauls."}</small></li>}
        {!!most.length && <li><span>Most collected series{most.length > 1 ? " (tie)" : ""}</span>{most.map(row => <button className="text-button" key={row.id} onClick={() => open(row.id)}>{row.label}</button>)}<small>{most[0]!.count} owned copies per series, including duplicates and alternate editions.</small></li>}
        {latest && previous && <li><span>Recorded manga acquisitions</span><strong>{latest.label}: {latest.count} · {previous.label}: {previous.count}</strong><small>{latest.count - previous.count >= 0 ? "+" : ""}{latest.count - previous.count} copies between these recorded years. Undated copies excluded; years may be incomplete. This measures currently owned acquisitions, not historical inventory.</small></li>}
      </ul>
    </section>
    <div className="analytics-charts">
      <Bars title="Volumes by language" rule="One language per manga / LN copy. Includes recorded assumptions; alternate languages count separately." rows={stats.languages} />
      <Bars title="Publisher distribution" rule="One recorded publisher per manga / LN copy. Unknown publishers retain their own bucket." rows={stats.publishers} />
      <Bars title="Manga acquisitions by year" rule="Currently owned manga / LN copies by acquisition year, including an unknown-date bucket. Years with no records are omitted." rows={stats.mangaYears} />
      <Bars title="CD acquisitions by year" rule="Personal owned CD release copies by acquisition year. Multi-disc releases count once per owned copy. Years with no records are omitted." rows={stats.cdYears} />
      <Bars title="Top authors" rule="Top 10 recorded series credits by owned manga / LN copies; each credited name receives the full series copy count. Collaborations overlap. Collective credits remain as recorded." rows={stats.authors.slice(0, 10)} />
      <Bars title="Most collected series" rule="Top 10 canonical manga / LN series by physical records, across languages and editions; duplicate copies count." rows={stats.mostCollected.slice(0, 10)} onOpen={open} />
    </div>
    <section className="analytics-chart"><h3>Largest individual hauls</h3><p className="chart-rule">Top 5 hauls across all personal media: copies logged together count as one haul; other copies group by exact recorded date. Undated copies are excluded. Ties use the most recent date first; unlogged same-day purchases cannot be separated.</p>
      {stats.largestHauls.length ? <ol className="haul-ranking">{stats.largestHauls.slice(0, 5).map(haul => <li key={haul.logged ? haul.logged.id : haul.date}><time dateTime={haul.date!}>{calendarLabel(haul.date!)}</time>{haul.logged?.store && <span> · {haul.logged.store}</span>}<strong>{haul.items.length} copies</strong></li>)}</ol> : <p className="chart-rule">No dated acquisitions recorded.</p>}
      <button type="button" className="text-button" onClick={onTimeline}>Explore the haul timeline →</button>
    </section>
    <section className="analytics-chart"><h3>Longest observed volume gaps</h3><p className="chart-rule">Top 5 internal ranges within compatible edition, language, publisher, format and medium groups. Duplicates are ignored. Uncertain sequences are withheld. These are observations between owned numbers, not release or completeness claims.</p>
      {stats.gaps.length ? <ol className="gap-ranking">{stats.gaps.slice(0, 5).map(gap => <li key={`${gap.entryId}:${gap.group.key}:${gap.start}`}><button type="button" className="text-button" onClick={() => open(gap.entryId)}>{gap.series}</button><strong>{gap.start === gap.end ? gap.start : `${gap.start}–${gap.end}`} · {gap.count} unowned numbers</strong><small>{gap.group.title} · {gap.group.language} · {gap.group.publisher} · {gap.group.format}</small></li>)}</ol> : <p className="chart-rule">No observable gaps in comparable sequences.</p>}
    </section>
    <details className="counting-rules"><summary>How these numbers are counted</summary><div>
      <p>Each visible, committed owned record counts once. Multiple copies of one volume count separately. Canonical series count once across languages, alternate editions and light novels; books are separate. Empty catalog entries and samples do not count.</p>
      <p>An omnibus counts as one owned record when its physical packaging is confirmed. Ambiguous source records are retained individually rather than converted into invented physical totals. {stats.uncertainNumbering} manga / LN records have unconfirmed numbering or format; the physical volume total is therefore a record-based total pending review.</p>
      <p>Language and publisher totals use recorded metadata. {stats.assumedLanguages} manga / LN language values are assumed. These are not verified edition facts. Author credits use the recorded series names, with no invented splits of collective credits.</p>
      <p>Acquisitions use exact calendar dates without timezone shifts. Unknown dates stay unknown. Notes are preserved verbatim; repeated notes are displayed once per date with their copy count. A recorded date is a grouping convention, not proof of one shopping trip. Deleting a copy removes it from these views.</p>
      <p>Gap detection requires positive safe integer printed labels and known edition metadata. It compares printed omnibus numbers only when the omnibus format and numbering basis are explicit; content ranges, specials, source-record numbering and incomplete metadata are withheld. No volumes before the first or after the last owned number are inferred. Language assumptions and unverified bibliographic metadata still limit confidence.</p>
    </div></details>
  </div>;
}
