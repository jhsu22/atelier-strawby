/** RFC 4180 state machine: quoted commas/newlines, escaped quotes, CRLF, BOM.
 * Deliberately dependency-free so the authoritative import can run with Node alone.
 * Returns logical records, not physical lines; malformed quoting is blocking.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let pending = false;
  const endField = () => { row.push(field); field = ''; state = 'start'; };
  const endRow = () => { endField(); rows.push(row); row = []; pending = false; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else field += char;
      continue;
    }
    if (char === ',') { endField(); pending = true; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow(); continue;
    }
    if (state === 'closed') throw new Error(`Unexpected text after closing quote in record ${rows.length + 1}`);
    if (char === '"') {
      if (state !== 'start') throw new Error(`Unexpected quote in record ${rows.length + 1}`);
      state = 'quoted'; pending = true; continue;
    }
    field += char; state = 'plain'; pending = true;
  }
  if (state === 'quoted') throw new Error(`Unclosed quote in record ${rows.length + 1}`);
  if (pending || row.length || field.length) endRow();
  return rows;
}
