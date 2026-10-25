# Public viewing and owner editing

Share `https://atelier-strawby.pages.dev/`. Visitors can browse/search the shelf, open copy details, view acquisition notes the owner has made public, tags, the haul timeline, collection statistics, artwork and previously saved release comparisons. The public view has no add, edit, delete, import, export or provider lookup controls. The owner opens `/edit` to manage the collection, and can use the footer's Public view link to return to the shareable shelf.

## Cloudflare Access

In Zero Trust → Access → Applications, edit the existing self-hosted Atelier application:

- Change the protected public hostname/path from `atelier-strawby.pages.dev` to `atelier-strawby.pages.dev/edit`. Access includes `/edit` and its subpaths. Do the same for the preview hostname if configured on this application.
- Keep the Allow policy restricted to the owner's email. Do not replace that policy with an Everyone or Bypass rule.
- Leave Cookie Path Attribute disabled. The signed `CF_Authorization` cookie must have `Path=/` so same-origin API calls can carry it. Keep HttpOnly enabled. SameSite Lax is suitable for this flow.
- Preserve the application's AUD and issuer in the runtime configuration. If creating a different application, update `ACCESS_AUDIENCE` in both Wrangler configs and Pages runtime variables before redeploying.
- Remove any other whole-host Access rule covering the production hostname. A broader preview-only rule may remain if preview should stay private.

Deploy the new worker before narrowing the Access path. Until both steps are complete, the Cloudflare edge may still challenge visitors or the old worker may reject public reads.

Cloudflare references: [application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), [authorization cookies and Cookie Path Attribute](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/).

## Application enforcement

Only GET/HEAD for `/`, `/foundation`, `/api/library`, `/api/artwork/:id` and `/api/releases` are public. Other routes, including `/edit`, the owner's library view `/api/library/owner`, item editor data, import previews and full backups/CSV exports require a verified owner JWT. All non-read methods require owner authentication plus the existing same-origin and `X-Strawby-Request: 1` checks. Missing or invalid tokens, other emails, wrong audience/issuer, expired tokens and cross-origin requests are rejected. Unknown future APIs require owner authentication by default.

The canonical HTTPS origin and environment must be configured even for public reads; deployment aliases fail closed. Public reads do not fetch JWKS or require the owner identity service. Responses remain `private, no-store`, preventing editor HTML or owner data from entering a shared cache. Editing requires `ACCESS_OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUDIENCE`. Only localhost can use the explicit local editing flags.

The R2 bucket remains private; visitors receive selected artwork through the application. No schema migration, data import or changes to collection records are required.

## Private notes

Notes are private by default (`collection_items.notes_private`, migration `0003_private_notes`). The server removes them before anything reaches a visitor. `/` and `/api/library` send `notes: null` for each private note and drop the derived memory tags (`item_tags.source = 'derived'`, `tags.category = 'memory'`). Manual and edition tags remain. The privacy flag itself is never sent publicly. Only the owner's `/edit` page and the owner-only `/api/library/owner` include private notes. Owner tools (item editor, CSV/JSON export, import duplicate checks) read the full notes. `libraryData()` defaults to the public view, so any new caller must opt in with `{ owner: true }` before it can see private notes.

A logged haul's store follows the same rule. `acquisition_batches.store_private` (default on, set by the haul form's privacy box) blanks the store in the public payload, and the flag itself is sent only to the owner. Haul saves (`POST /api/hauls`) are owner-only like every other write.

The offline service worker caches `/` and `/api/library` for visitors and `/edit` and `/api/library/owner` for the owner, in each person's own browser. It never caches item editor data, imports, exports, scans, metadata or any write. Responses that aren't successful, same-origin and un-redirected, such as an Access login redirect or a 403, are never stored.

## Verification

Use a fresh browser context with no owner cookies:

1. Open the shareable root URL: shelf and artwork load without a login redirect. Search, filters, details, timeline and statistics work. Editing/import/export buttons are absent, including on mobile.
2. Follow Owner sign in: `/edit` redirects to Cloudflare's owner login. Another email cannot enter. Signing in as the owner reveals add/edit/import/export controls.
3. Anonymous requests to item/import/export APIs and every mutation return 403, even with the application's origin and intent headers. Spoofed email headers or unsigned cookies cannot grant editing access.
4. Owner same-origin requests work with the signed domain cookie, and cross-origin/missing-intent requests remain blocked. Share the root URL rather than `/edit`.

Automated coverage: `tests/unit/public-access.test.ts` checks public/private routes, every mutation method, verified owner cookies and CSRF rejection; existing Access tests check signature, issuer, audience and expiry. Run anonymous compiled-worker/browser checks with `STRAWBY_TEST_READ_ONLY=true STRAWBY_TEST_PORT=4337 npx playwright test public-access.spec.ts`. Normal browser tests retain the explicit local owner mode.

## Rollout record — 2026-10-24

Production worker deployment `c3a5ee20-634f-4b9a-96d4-aa24de63fdb7` succeeded. Type checks, lint, 71 unit tests, 43 integration tests, two anonymous browser checks and 18 owner-management/release browser checks passed. Browser checks use disposable local D1/R2, on desktop and mobile. Existing workspace edits were preserved in the deployed build; no production collection data or schema was changed.

The live canonical host still returns Cloudflare Access login redirects for the shelf and read APIs. The available Wrangler OAuth connection can deploy Pages, but does not expose the existing Access application for management. Narrowing the existing Cloudflare rule to `/edit` remains required, followed by live anonymous and signed-in owner verification. The public-sharing rollout is incomplete until that setting changes.

### Follow-up verification — 2026-10-24

After the deployment and Access configuration changes, anonymous HTTP checks at the canonical host returned 200 for `/` and `/api/library`, a 302 sign-in redirect for `/edit`, and 403 for `/api/items` and `/api/export`. These checks confirm that public browsing is reachable and owner routes remain protected. A signed-in owner session was not exercised in this follow-up.
