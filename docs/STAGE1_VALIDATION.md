# Stage 1 validation results

Executed 2026-10-21 (America/Los_Angeles; shell timestamps may show 2026-10-22 UTC), using Node 26.11.1, npm 12.2.1, and SQLite 3.53.4.

**Stage 1 local functional acceptance passes.** Locked installation, full Astro/TypeScript checks, production build, Drizzle schema parity/history, actual local D1 migration/seed verification and Astro/built Pages HTTP smoke now pass. The dependency audit remains nonzero, including an upstream critical Astro/Sharp advisory; security-release readiness and hosted operation are not claimed. See [TESTING.md](TESTING.md) for exact evidence and [README](../README.md) for runnable commands. No later-stage work was started.

## Actual dataset

| Metric | Result |
| --- | ---: |
| Parsed data records (header excluded) | 177 |
| Blank or noncollection records skipped | 0 |
| Physical manga ownership records | 177 |
| Unique parent series | 38 |
| Edition runs | 42 |
| Bibliographic volume editions | 176 |
| English copies | 167 |
| Japanese copies | 9 |
| Korean copies | 1 |
| Copies with known acquisition dates | 172 |
| Copies with unknown acquisition dates | 5 |
| Distinct known acquisition dates | 55 |
| Copies with resolved acquisition notes | 97 |
| Applied field corrections | 13 |
| Blocking source issues | 0 |
| Personal CDs | 0 |
| Explicitly labeled demonstration CDs, excluded from personal counts | 4 |

The 177 count follows the source ownership records. The Steins;Gate packaging ambiguity below prevents independently asserting that all rows correspond to separately bound physical books.

The source remains unchanged, SHA-256:

```text
8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a
```

## Publisher distribution

| Publisher | Copies |
| --- | ---: |
| Kodansha | 76 |
| VIZ Media | 42 |
| Yen Press | 33 |
| Udon Entertainment | 9 |
| Houbunsha | 4 |
| Kadokawa | 4 |
| DNA Media | 3 |
| Seven Seas | 2 |
| Kaiten Books | 2 |
| Mag Garden | 1 |
| Square Enix | 1 |
| **Total** | **177** |

Acquisition years: **2021: 21; 2022: 96; 2023: 26; 2024: 29; unknown: 5.**

## Corrections and grouping

Source numbers here are one-based data records, excluding the header. The original specification uses zero-based correction indexes.

| Source record(s) | Applied correction / preserved identity |
| --- | --- |
| 1 | Yoshitoki Oima → Yoshitoki Ōima; shared creator identity with A Silent Voice |
| 121 (PRD index 120) | SPY x FAMILY 3 → Tatsuya Endo |
| 123 | Girls Last Tour → Girls' Last Tour; legacy title remains an alias and in provenance |
| 154 (PRD index 153) | Fruits Basket: Illustrations 1 → Natsuki Takaya / Yen Press |
| 174–176 (PRD indexes 173–175) | Fragrant Flower 1–3 → Saka Mikami / Kodansha |
| 177 (PRD index 176) | LOVE BULLET 1 → inee / Kadokawa |
| 158 and 173 | Two owned Vol 1 copies of The Guy She Was Interested in…; separate item UUIDs, shared provisional volume edition; second date remains null |

A Sign of Affection has one parent with eight EN, one KR, and one JP copy; the KR and Yubisaki edition titles remain intact. Fragrant Flower has three EN and one JP copy with the Kaoru Hana edition title retained. K-ON! has four Houbunsha JP and four Yen Press EN copies. All three Project SEKAI records are JP. Fruits Basket: Illustrations remains a separate work from Collector's Edition.

The first B&N cascade covers five copies, the Wotakoi Sammy cascade five, and Christmas 2022 nineteen. Quintuplets 14 inherits `box set` across a date change while keeping 2022-08-17. Records 12 and 139 inherit their preceding active notes; synthetic tests also cover truly isolated closers with equal/different/missing dates. The file has 57 continuation markers and 17 closing markers; none remains as a normalized acquisition note.

## Review items retained without guessing

| Issue | Records / consequence |
| --- | --- |
| Assumed English language | 163 copies use the PRD's EN default and `language_basis=assumed`; not externally verified |
| Unknown acquisition dates | Records 173–177 stay null |
| Steins;Gate omnibus packaging | Records 13–15 retained individually; format unknown, numbering basis `source_record`, per-copy Omnibus tags; no component-range inference |
| Korean publisher uncertainty | Record 169 retains source publisher Kodansha; regional edition publisher unverified |
| Repeated Vol 1 | Records 158 and 173 are intentionally preserved; no new edition is invented |

Four CD examples have unresolved release metadata and no fabricated tracklists/catalog numbers. No external metadata or artwork enrichment was attempted.

## Artifacts and validation boundary

- [Normalized data and audit](../data/generated/normalized-collection.json)
- [Full machine-readable validation summary](../data/generated/validation-summary.json), including affected source records and every correction outcome
- [Persisted-database verification output](../data/generated/persisted-verification.txt)
- [Database-backed HTML diagnostic](../data/generated/diagnostic.html)
- [Current check/test/build output](../data/generated/audit-validate.txt)
- [Current clean locked install](../data/generated/audit-npm-ci.txt)
- [Actual workerd D1 test output](../data/generated/audit-d1.txt)
- [Actual persisted D1 verification](../data/generated/audit-persisted.txt)
- [Schema parity verification](../data/generated/audit-schema.txt)
- [Built Pages runtime smoke](../data/generated/audit-pages-smoke.txt)
- [Dependency audit findings](../data/generated/audit-dependencies.json)

These generated files are deliberately ignored by source control and excluded from public assets. The commands in the README regenerate them.

**Executed after audit:** 38 unit tests, 17 integration tests and two real workerd D1 tests, all passing; full Astro and TypeScript checking; clean locked install; production build; 27-table schema/snapshot parity; real local Wrangler migration and repeat migration; actual D1 seed, samples, independent persisted queries and `already-imported` repeat; Astro and built Pages HTTP smoke, required layout CSS, private/no-store responses and a nonlocal Host rejection. A disposable Pages/D1 runtime also verified unavailable and empty database responses. The original CSV digest and all three deterministic JSON artifacts are unchanged. See [the audit report](STAGE1_AUDIT.md) for fixes, exact commands and current evidence.

**Remaining limitation:** the latest `npm audit` exits 1 with 11 findings (6 moderate, 4 high, 1 critical), recorded in `data/generated/audit-dependencies.json`; the earlier audit reported 17. The patched Drizzle version resolves its identifier-escaping advisory; unresolved Astro/adapter fixes require reconsidering the required Astro 5/Pages version boundary. Review the preserved audit and platform decision before hosted release. Actual hosted bindings, Access, external metadata/artwork, browser/device coverage and production deployment belong to later stages and remain unverified.
