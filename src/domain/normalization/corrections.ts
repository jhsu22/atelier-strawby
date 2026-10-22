export const HEADERS = ['Title', 'Volume', 'Author', 'Publisher', 'Date Acquired', 'Notes'] as const;
export type SourceRow = Record<typeof HEADERS[number], string>;
export interface Correction { rule: string; field: keyof SourceRow; from: string; to: string; status: 'applied' | 'already-correct' | 'conflict'; specificationIndex?: number }

/** PRD indexes are zero-based; source record numbers in reports are one-based.
 * Semantic identity plus expected old values protects reordered/edited inputs.
 */
export function correctRow(source: SourceRow) {
  const row = { ...source };
  const audit: Correction[] = [];
  const fix = (rule: string, field: keyof SourceRow, from: string, to: string, specificationIndex?: number) => {
    const status = row[field] === from ? 'applied' : row[field] === to ? 'already-correct' : 'conflict';
    audit.push({ rule, field, from: row[field], to, status, ...(specificationIndex === undefined ? {} : { specificationIndex }) });
    if (status === 'applied') row[field] = to;
  };
  if (row.Title === 'Girls Last Tour') fix('girls-title', 'Title', 'Girls Last Tour', "Girls' Last Tour");
  if (row.Author === 'Yoshitoki Oima') fix('oima-author', 'Author', 'Yoshitoki Oima', 'Yoshitoki Ōima');
  if (row.Title === 'SPY x FAMILY' && row.Volume === '3') fix('spy-author', 'Author', 'Tatsuki Fujimoto', 'Tatsuya Endo', 120);
  if (row.Title === 'Fruits Basket: Illustrations' && row.Volume === '1') {
    fix('fruits-author', 'Author', 'Keigo Maki', 'Natsuki Takaya', 153);
    fix('fruits-publisher', 'Publisher', 'Kodansha', 'Yen Press', 153);
  }
  if (row.Title === 'The Fragrant Flower Blooms With Dignity' && ['1', '2', '3'].includes(row.Volume)) {
    fix('fragrant-author', 'Author', '', 'Saka Mikami', 172 + Number(row.Volume));
    fix('fragrant-publisher', 'Publisher', '', 'Kodansha', 172 + Number(row.Volume));
  }
  if (row.Title === 'LOVE BULLET' && row.Volume === '1') {
    fix('love-bullet-author', 'Author', '', 'inee', 176);
    fix('love-bullet-publisher', 'Publisher', '', 'Kadokawa', 176);
  }
  return { row, audit };
}

export function editionIdentity(row: SourceRow) {
  const aliases: Record<string, string> = {
    'A Sign of Affection (KR)': 'A Sign of Affection',
    'Yubisaki to Renren': 'A Sign of Affection',
    'Kaoru Hana wa Rin to Saku': 'The Fragrant Flower Blooms With Dignity',
  };
  let language: 'EN' | 'JP' | 'KR' = 'EN';
  let languageBasis: 'specified' | 'assumed' = 'assumed';
  if (row.Title === 'A Sign of Affection (KR)') { language = 'KR'; languageBasis = 'specified'; }
  if (['Yubisaki to Renren', 'Kaoru Hana wa Rin to Saku'].includes(row.Title)
      || (row.Title === 'K-ON!' && row.Publisher === 'Houbunsha')
      || (row.Title === 'Project SEKAI Comic Anthology' && row.Publisher === 'DNA Media')) {
    language = 'JP'; languageBasis = 'specified';
  }
  if (row.Title === 'K-ON!' && row.Publisher === 'Yen Press') languageBasis = 'specified';
  return { canonicalTitle: aliases[row.Title] ?? row.Title, language, languageBasis };
}
