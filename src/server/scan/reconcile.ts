import type { ScanEdition, ScanMatch } from "../../domain/scan.ts";
import type { Medium } from "../../domain/types.ts";

export interface IndexedRun {
  id: string;
  editionTitle: string;
  language: "EN" | "JP" | "KR";
  languageBasis: "specified" | "assumed" | "confirmed";
  publisher: string;
  numberingBasis: "printed" | "source_record" | "unknown";
  format: "standard" | "omnibus" | "collectors" | "artbook" | "anthology" | "unknown";
  medium: Medium;
}
export interface IndexedSeries {
  id: string;
  title: string;
  aliases: string[];
  authors: string[];
  runs: IndexedRun[];
}
export interface IndexedVolume {
  runId: string;
  volume: string;
  isbn13: string | null;
  copies: { id: string; acquiredOn: string | null }[];
}
export interface CollectionIndex {
  series: IndexedSeries[];
  volumes: IndexedVolume[];
}

/** Title key: width/case folded, × as x, punctuation and a leading article removed. */
export function titleKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[×✕]/g, " x ")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Library catalogs often drop articles: "Sign of Affection Omnibus 1".
    .replace(/^(the|a|an) /, "");
}
const cjk = (value: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, "");
  const grams = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}
function dice(a: string, b: string): number {
  const left = bigrams(a), right = bigrams(b);
  let overlap = 0, total = 0;
  for (const count of left.values()) total += count;
  for (const count of right.values()) total += count;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return total ? (2 * overlap) / total : 0;
}

/** Similarity of two titles in [0, 1]. Equal keys are 1; containment is high. */
export function titleSimilarity(a: string, b: string): number {
  const left = titleKey(a), right = titleKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  // "fruits basket" within "fruits basket collectors edition": related, but
  // often a different edition, so it is offered without being preselected.
  if (short.length >= 4 && (long.startsWith(`${short} `) || (cjk(short) && long.startsWith(short))))
    return 0.7;
  if (cjk(left) || cjk(right)) return dice(left, right) * 0.9;
  const words = (value: string) => new Set(value.split(" "));
  const x = words(left), y = words(right);
  const shared = [...x].filter((word) => y.has(word)).length;
  return (shared / (x.size + y.size - shared)) * 0.8;
}

/** Names in either order and script variants compare as the same person. */
const personKey = (value: string) =>
  titleKey(value).replace(/ō|ou/g, "o").replace(/ū|uu/g, "u").split(" ").sort().join(" ");
export const sharesCreator = (a: string[], b: string[]) =>
  a.some((left) => b.some((right) => personKey(left) === personKey(right)));

const names = (series: IndexedSeries) => [
  { title: series.title, basis: "title" as const },
  ...series.aliases.map((title) => ({ title, basis: "alias" as const })),
  ...series.runs
    .filter((run) => run.editionTitle !== series.title)
    .map((run) => ({ title: run.editionTitle, basis: "alias" as const })),
];

export interface ReconcileInput {
  editions: ScanEdition[];
  /** Language of the scanned edition: verified catalog value, else ISBN hint. */
  language: "EN" | "JP" | "KR" | null;
  volume: string | null;
  medium: Medium | null;
  format: ScanEdition["format"];
  /** Alternate titles from a bridge source (MangaDex), labeled as such. */
  bridgeTitles?: string[];
}

/** Rank owned series for a scanned edition. Returns at most five candidates. */
export function reconcile(index: CollectionIndex, input: ReconcileInput): ScanMatch[] {
  const verified = input.editions.filter((edition) => edition.isbnVerified);
  // Format words are compared separately (run selection), so "A Sign of
  // Affection Omnibus" is also tried as "A Sign of Affection".
  const scanned = [
    ...new Set(
      verified
        .flatMap((edition) => [edition.seriesTitle, edition.title, edition.seriesTitle.replace(/\s*\b(omnibus|deluxe edition|\d+-in-1 edition)\b/gi, "")])
        .map((title) => title.trim())
        .filter(Boolean),
    ),
  ];
  const authors = verified.flatMap((edition) => edition.authors);
  const publishers = verified.map((edition) => edition.publisher).filter(Boolean);
  const matches: ScanMatch[] = [];
  for (const series of index.series) {
    let best = { score: 0, basis: "title" as ScanMatch["basis"], reason: "" };
    for (const name of names(series)) {
      for (const title of scanned) {
        const score = titleSimilarity(title, name.title);
        if (score > best.score)
          best = { score, basis: name.basis, reason: `Catalog title “${title}” ${score === 1 ? "matches" : "resembles"} “${name.title}”.` };
      }
      for (const title of input.bridgeTitles ?? []) {
        const score = titleSimilarity(title, name.title) * 0.9;
        if (score > best.score)
          best = { score, basis: "bridge", reason: `MangaDex lists “${title}” as an alternate title of this work, matching “${name.title}”.` };
      }
    }
    if (best.score < 0.45) continue;
    const reasons = [best.reason];
    let score = best.score;
    if (authors.length && sharesCreator(authors, series.authors)) {
      score += 0.1;
      reasons.push("A credited author matches.");
    }
    // Only an exact title or alternate title is preselected. A shared author
    // does not promote a partial title: spin-offs share their creators.
    if (best.score < 0.9) score = Math.min(score, 0.79);
    // Prefer the owned run in the scanned language, then the same publisher.
    const runs = series.runs
      .map((run) => {
        let fit = 0;
        if (input.language && run.language === input.language) fit += 2;
        if (publishers.some((publisher) => titleSimilarity(publisher, run.publisher) >= 0.8)) fit += 1;
        if (input.medium && run.medium !== input.medium) fit -= 3;
        // An omnibus or collector's volume 1 is not a standard volume 1.
        const special = (format: string | null) => ["omnibus", "collectors", "artbook", "anthology"].includes(format ?? "");
        if ((special(input.format) || special(run.format)) && run.format !== input.format) fit -= 2;
        return { run, fit };
      })
      .sort((a, b) => b.fit - a.fit);
    const chosen = runs[0] && runs[0].fit >= 2 ? runs[0].run : null;
    const medium = chosen?.medium ?? series.runs[0]?.medium ?? "manga";
    if (input.medium && series.runs.length && series.runs.every((run) => run.medium !== input.medium)) {
      score -= 0.3;
      reasons.push(`Your copies of this series are ${series.runs[0]!.medium.replace("_", " ")}s; the catalog suggests a ${input.medium.replace("_", " ")}.`);
    }
    const sameLanguage = series.runs.find((run) => run.language === input.language);
    if (chosen) reasons.push(`You own the ${chosen.language} ${chosen.publisher || "edition"} run.`);
    else if (sameLanguage)
      reasons.push(`Your ${sameLanguage.language} copies are a different edition (${sameLanguage.format}${input.format ? ` vs ${input.format}` : ""}); saving starts a separate edition.`);
    else if (input.language) reasons.push(`No ${input.language} edition of this series is in your collection yet; saving starts one.`);
    const volume = chosen && input.volume
      ? index.volumes.find((entry) => entry.runId === chosen.id && entry.volume === input.volume)
      : undefined;
    matches.push({
      seriesId: series.id,
      seriesTitle: series.title,
      aliases: series.aliases.slice(0, 50),
      authors: series.authors.slice(0, 30),
      medium,
      run: chosen
        ? {
            editionTitle: chosen.editionTitle,
            language: chosen.language,
            languageBasis: chosen.languageBasis,
            publisher: chosen.publisher,
            format: chosen.format,
            numberingBasis: chosen.numberingBasis,
          }
        : null,
      volume: volume?.volume ?? null,
      copies: (volume?.copies ?? []).map((copy) => ({ ...copy, isbn13: volume!.isbn13 })),
      recordedIsbn: volume?.isbn13 ?? null,
      basis: best.basis,
      score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
      reasons: reasons.slice(0, 10),
    });
  }
  return matches.sort((a, b) => b.score - a.score || a.seriesTitle.localeCompare(b.seriesTitle)).slice(0, 5);
}
