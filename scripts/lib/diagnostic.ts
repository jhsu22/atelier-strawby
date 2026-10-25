import type { CollectionSummary } from '../../src/domain/types.ts';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function renderDiagnostic(summary: CollectionSummary): string {
  const table = (caption: string, rows: { label: string; count: number }[]) => `<table><caption>${caption}</caption><thead><tr><th scope="col">${caption === 'Publishers' ? 'Publisher' : 'Language'}</th><th scope="col">Copies</th></tr></thead><tbody>${rows.map(r => `<tr><th scope="row">${escape(r.label)}</th><td>${r.count}</td></tr>`).join('')}</tbody></table>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Strawby Stacks — Offline diagnostic</title>
<style>body{font:1rem system-ui;max-width:50rem;margin:3rem auto;padding:1rem;background:#faf8f5;color:#141413}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #ddd}table{width:100%;margin:2rem 0}caption{text-align:left;font-weight:bold}dt{margin-top:1rem}dd{font-size:1.5rem;margin-left:0}</style></head>
<body><main><h1>Strawby Stacks</h1><p>Stage 1 offline diagnostic · SQLite verification database</p>
<p>These counts are queried from the SQLite database using the same collection queries as the Astro page. This diagnostic does not verify Astro or Cloudflare D1. Regenerate this file after changing the offline database.</p>
<dl><dt>Physical manga copies</dt><dd>${summary.physicalCopies}</dd><dt>Unique series</dt><dd>${summary.uniqueSeries}</dd><dt>Acquisition dates</dt><dd>${summary.distinctAcquisitionDates}</dd><dt>Copies with notes</dt><dd>${summary.recordsWithNotes}</dd></dl>
${table('Copies by language', summary.languages)}
<p>${summary.datedCopies} dated · ${summary.undatedCopies} undated</p>
${table('Publishers', summary.publishers)}</main></body></html>\n`;
}
