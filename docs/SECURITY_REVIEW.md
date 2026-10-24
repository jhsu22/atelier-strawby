# Stage 5 security and quality review

**Release decision: do not sign off production yet.** The private application passes local behavior checks, but its retained Astro 5/Pages stack has unresolved dependency advisories and its hosted access/operations have not been verified. `npm audit` is not an exploitability verdict; it is also not acceptable to hide its results. The machine-readable [dependency audit](verification/dependency-audit.json) records the final package graph.

## Dependency findings

A clean install initially reported 13 affected-package findings (6 moderate, 6 high, 1 critical). Compatible transitive patches now pin Undici 7.30.1 and ws 8.21.0 through `overrides`; installed runtime, D1/R2 and browser paths were retested. The final audit reports **11 findings: 4 moderate, 6 high, 1 critical**.

| Packages | Audit severity | Disposition |
| --- | --- | --- |
| `astro` | Critical | Audit includes AVIF image optimization and other framework advisories. This app selects passthrough images and does not accept AVIF into R2, but the framework is still flagged; this is not a complete reachability proof. |
| `@astrojs/cloudflare`, `miniflare`, `wrangler` | High | Transitive affected stack, including image/runtime dependencies. Local-only tooling is not exposed publicly, but needs remediation and regression testing. |
| `sharp` | High | Native image library advisories; not solved by blindly forcing a new native major/minor below every parent. |
| `zod`, `zod-to-ts` | High | Oversized constrained-collection validation advisory. Streamed body/UTF-8 limits and authenticated requests bound this app's inputs; retained Zod 3 is still flagged. |
| `drizzle-kit`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `esbuild` | Moderate | Development/build-tool graph; local dev binds loopback. Audit's suggested changes include incompatible downgrade/major paths. |

The npm registry exposed no newer Astro 5 patch during this audit. A force audit fix would move the framework/adapter or downgrade tooling and is not a verified Cloudflare Pages remediation. Prioritize a supported fixed framework deployment path (likely requiring revisiting Pages versus Workers), migrate the validation/tooling graph, and rerun the release suite. A security-reviewed vendor backport would also need explicit validation. The current application is not declared safe merely because Access protects it. [Astro AVIF advisory](https://github.com/advisories/GHSA-26w7-cxv4-gfx2), [Zod constrained-collection advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Application controls reviewed

| Area | Verified implementation | Remaining boundary |
| --- | --- | --- |
| Authentication | Local bypass requires loopback + APP_ENV=local + LOCAL_DEV_AUTH=true. Hosted checks require exact origin, RS256 signature, issuer, audience, required claims, expiry and owner email. Forged, expired and wrong-owner tokens tested. | Actual Cloudflare Access policy, login, aliases and credentials need a hosted drill. |
| Mutation authorization | Every non-GET/HEAD request passes origin, fetch-site and intent-header checks before handlers; all routes share authentication. | Private single-owner model; no multi-user role system. |
| SQL | User values bound; dynamic backup table/column names come only from Drizzle's allowlist. FK/CHECK constraints and revision guards enforce atomic writes. SQL-looking notes tested as text. | Future raw SQL changes still require review. |
| Validation/import | Bounded streamed JSON, shared Zod fields/enums/dates/URLs, strict backup table/column set and identity checks. Preview confirmation, duplicate policy, resume and conflict rejection. | CSV 900 KB/1,000 records; JSON 8 MiB/20,000 rows per table. Deeply hostile authenticated input is not a full fuzz campaign. |
| Backup integrity | Exact table equality in SQLite and D1 for 2,124 copies; failed chunks do not write copies. Restore chunks remain one atomic batch. Existing v1/small previews still load. | Larger-than-limit snapshots require D1 SQL restore. Full R2-byte backups are separate; no scheduled remote backup job. |
| Metadata egress | Provider allowlist, HTTPS, each redirect validated, credential redirect restriction, 8-second timeout, response/image byte bounds and MIME signatures. | Manual external image URLs load in the browser; the external host can observe the connection. |
| Throttling/cache | Shared provider-state leases, provider backoff and metadata snapshots tested, including forced retry and quota failure. Private data uses no-store. | No generic per-user API rate limiter. Preview/cache retention is not scheduled, so operational cleanup needs a future policy that preserves pending imports. |
| XSS/content handling | React escapes notes/titles; no imported HTML rendering. Spreadsheet export protects formula-like cells. Image URLs reject dangerous schemes/local literal addresses. | No full script-nonce CSP or penetration test. Dependency advisories remain. |
| Headers/secrets | Dynamic responses private/no-store, nosniff, no-referrer, frame denial. Keys remain server-side; provider errors do not echo credentials. Archive is allowlisted and checksummed. | Verify actual edge headers, logs, CI secret scope and Access redirects after deployment. |
| Mobile/a11y | 320–1600 px viewport coverage, axe light/dark scans, native dialog focus containment/return, Escape, touch dismissal and reduced-motion CSS. | Chromium emulation only; screen readers, Firefox, Safari and physical devices unverified. |
| Failure handling | Initial D1 failure page, empty/missing detail states, retained shelf on refresh failure, metadata/manual-entry fallback, form errors, image typography fallback. React render boundary added. | Forced React crash path not separately browser-tested; initial SSR render errors are not caught by a React boundary. |
| Scale | Indexed relationship lookups replace repeated scans; backup copy validation uses maps. Real D1 2,124-copy and synthetic 5,000-copy browser scenarios pass. | Whole-library SSR/hydration and full DOM rendering remain. Hosted CPU/latency, slow mobile networks and very large collections need pagination/virtualization and separate load tests. |

The existing owner database and `.dev.vars` were not reset, seeded or included in the release archive. Tests use disposable stores. The original CSV itself contains the supplied personal notes and is included because it is part of the requested complete project; keep the source archive private.
