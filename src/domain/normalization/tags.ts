export const TAG_RULE_VERSION = '1';
export const TAGS = [
  { slug: 'gifts-from-sammy', label: 'Gifts from Sammy', category: 'memory', pattern: /from sammy/i },
  { slug: 'kinokuniya-trips', label: 'Kinokuniya Trips', category: 'memory', pattern: /kinokuniya/i },
  { slug: 'box-sets', label: 'Box Sets', category: 'memory', pattern: /box set/i },
  { slug: 'korea-trip', label: 'Korea Trip', category: 'memory', pattern: /korea trip/i },
  { slug: 'proxy-hauls', label: 'Proxy Hauls', category: 'memory', pattern: /proxy/i },
  { slug: 'box-set', label: 'Box Set', category: 'edition', pattern: /box set/i },
  { slug: 'omnibus', label: 'Omnibus', category: 'edition', pattern: /omnibus/i },
  { slug: 'collectors-edition', label: "Collector's Edition", category: 'edition', pattern: /collector's edition/i },
] as const;
export function deriveTags(note: string | null, title: string): string[] {
  return TAGS.filter(rule => rule.pattern.test(rule.slug === 'collectors-edition' ? title : note ?? '')).map(rule => rule.slug);
}
