import { useMemo } from "react";
import { Heart, ArrowUpRight, CalendarDays, Store } from "lucide-react";
import type { LibraryEntry } from "../../domain/library.ts";
import { acquisitions, calendarLabel, emptyTimelineFilters, haulTimeline, memoryTags } from "../../domain/collection-insights.ts";
import type { Acquisition, TimelineFilters } from "../../domain/collection-insights.ts";
import { MediaArtwork } from "../covers/MediaArtwork.tsx";

export function HaulTimeline({ entries, onOpen, filters, onFilters }: { entries: LibraryEntry[]; onOpen: (entry: LibraryEntry) => void; filters: TimelineFilters; onFilters: (filters: TimelineFilters) => void }) {
  const items = useMemo(() => acquisitions(entries), [entries]);
  const hauls = useMemo(() => haulTimeline(items, filters), [items, filters]);
  const years = [...new Set(items.map(item => item.copy.acquiredOn?.slice(0, 4) ?? "unknown"))].sort().reverse();
  const memories = [...new Set(items.flatMap(item => memoryTags(item.copy.tags ?? [])))].sort();
  const update = (value: Partial<TimelineFilters>) => onFilters({ ...filters, ...value });
  return <div className="haul-timeline">
    <div className="journal-intro"><span className="journal-eyebrow">THE COLLECTION DIARY</span>
      <p>A shelf full of little moments.</p>
      <span>Bookstore afternoons, gifts, and everything that came home along the way. Your notes, just as you wrote them.</span>
    </div>
    <div className="timeline-filters">
      <label className="filter-field">Haul year<select value={filters.year} onChange={event => update({ year: event.target.value })}>
        <option value="">All years</option>{years.map(year => <option key={year} value={year}>{year === "unknown" ? "Date unknown" : year}</option>)}
      </select></label>
      <label className="filter-field">Haul media<select value={filters.media} onChange={event => update({ media: event.target.value as TimelineFilters["media"] })}>
        <option value="all">All media</option><option value="manga">Manga & light novels</option><option value="book">Books</option><option value="cd">CDs</option>
      </select></label>
      <label className="filter-field">Memory tag<select value={filters.memory} onChange={event => update({ memory: event.target.value })}>
        <option value="">All memories</option>{memories.map(memory => <option key={memory}>{memory}</option>)}
      </select></label>
    </div>
    <div className="timeline-results"><p role="status">{new Set(hauls.flatMap(haul => haul.date ? [haul.date] : [])).size} recorded dates{hauls.some(haul => haul.logged) && ` · ${hauls.filter(haul => haul.logged).length} logged hauls`} · {hauls.reduce((sum, haul) => sum + haul.items.length, 0)} matching copies</p>
      {(filters.year || filters.media !== "all" || filters.memory) && <button className="text-button" onClick={() => onFilters(emptyTimelineFilters)}>Reset timeline filters</button>}</div>
    <p className="chart-rule">Copies logged together as a haul share one card. Other copies get one card per exact recorded date, so separate purchases on the same day appear together. Filters show matching copies within each card. Undated copies appear last. Sample CDs are excluded.</p>
    {!hauls.length && <div className="quiet-state"><CalendarDays size={28} /><p>No acquisitions match these filters.</p></div>}
    <ol className="haul-list">{hauls.map(haul => {
      const titles = new Map<string, { entry: LibraryEntry; items: Acquisition[] }>();
      const notes = new Map<string, Acquisition[]>();
      for (const item of haul.items) {
        const group = titles.get(item.entry.id) ?? { entry: item.entry, items: [] };
        group.items.push(item);
        titles.set(item.entry.id, group);
        if (item.copy.notes) notes.set(item.copy.notes, [...(notes.get(item.copy.notes) ?? []), item]);
      }
      const manga = haul.items.filter(item => item.entry.kind === "manga").length;
      const cds = haul.items.filter(item => item.entry.kind === "cd").length;
      const books = haul.items.filter(item => item.entry.kind === "book").length;
      const tags = [...new Set(haul.items.flatMap(item => memoryTags(item.copy.tags ?? [])))];
      return <li key={haul.logged ? `haul:${haul.logged.id}` : (haul.date ?? "undated")} className="haul-card" data-haul-date={haul.date ?? "unknown"} {...(haul.logged ? { "data-logged-haul": haul.logged.id } : {})}>
        <div className="haul-date"><CalendarDays size={17} aria-hidden="true" /><h3>{haul.date ? <time dateTime={haul.date}>{calendarLabel(haul.date)}</time> : haul.logged ? "A haul without a date" : "Memories without a date"}</h3></div>
        {haul.logged?.store && <p className="haul-store"><Store size={14} aria-hidden="true" /><span>{haul.logged.store}</span>{haul.logged.storePrivate && <span className="note-privacy">Private</span>}</p>}
        <p className="haul-count">{[manga && `${manga} manga / LN`, books && `${books} books`, cds && `${cds} CDs`].filter(Boolean).join(" · ")}{haul.logged && " · logged together"}</p>
        {!haul.date && !haul.logged && <p className="chart-rule">These copies have no recorded acquisition date. They may belong to different hauls.</p>}
        <div className="haul-covers">{[...titles.values()].slice(0, 4).map(({ entry, items }) => {
          const pictured: LibraryEntry = entry.kind === "cd" ? entry : { ...entry, copies: items.map(item => item.copy as Exclude<LibraryEntry, {kind: "cd"}>["copies"][number]) };
          return <button key={entry.id} type="button" onClick={() => onOpen(entry)} aria-label={`Open ${entry.title}`}><MediaArtwork entry={pictured} compact /></button>;
        })}</div>
        <p className="artwork-caption">Selected covers · artwork falls back to typography when unavailable.</p>
        {[...notes].map(([note, notedItems]) => <blockquote className="haul-memory" key={note}><Heart size={15} aria-hidden="true" /><div><p>{note}</p><cite>Recorded on {notedItems.length} {notedItems.length === 1 ? "copy" : "copies"} · {[...new Set(notedItems.map(item => item.entry.title))].join(" · ")}{notedItems.every(item => item.copy.notesPrivate) && " · Private, hidden on the public shelf"}</cite></div></blockquote>)}
        {!!tags.length && <div className="item-tags">{tags.map(tag => <button type="button" className="memory-chip" key={tag} aria-pressed={filters.memory === tag} onClick={() => update({ memory: filters.memory === tag ? "" : tag })}>{tag}</button>)}</div>}
        <ul className="haul-items">{[...titles.values()].map(({ entry, items }) => <li key={entry.id}>
          <button type="button" onClick={() => onOpen(entry)}><span><strong>{entry.title}</strong><small>{entry.kind === "cd" ? `${items.length} owned CD ${items.length === 1 ? "copy" : "copies"}` : items.map(item => "volume" in item.copy ? `Vol. ${item.copy.volume} · ${item.copy.language}` : "").join(" / ")}</small></span><ArrowUpRight size={16} aria-hidden="true" /></button>
        </li>)}</ul>
      </li>;
    })}</ol>
  </div>;
}
