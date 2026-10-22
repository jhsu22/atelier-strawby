export interface NoteState {
  active: string | null;
  previousNote: string | null;
  previousDate: string | null;
}
export const newNoteState = (): NoteState => ({ active: null, previousNote: null, previousDate: null });

export function resolveNote(raw: string, date: string | null, state: NoteState) {
  const text = raw.trim();
  const closing = text === '\\/' || text === '\\\\/';
  let note: string | null = null;
  let warning: string | null = null;
  if (!text) state.active = null;
  else if (text === '|' || closing) {
    note = state.active;
    if (note === null && closing && date !== null && date === state.previousDate) note = state.previousNote;
    if (note === null) warning = closing ? 'ORPHAN_CLOSING_MARKER' : 'ORPHAN_CONTINUATION';
    if (closing) state.active = null;
  } else { note = text; state.active = text; }
  state.previousNote = note; state.previousDate = date;
  return { note, warning };
}
