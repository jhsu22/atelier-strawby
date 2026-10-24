# Google Books metadata setup

Google Books is the preferred optional fallback ahead of Open Library. Manga metadata starts with MangaDex, then Google Books, then Open Library; books and light novels start with Google Books, then Open Library. It supports manga, light novels, and prose books; CD lookup keeps its music sources. You only need an API key for public metadata search, not OAuth or access to your private Google bookshelves.

## Keep setup within free access

Use a dedicated Google Cloud project **without a billing account**. Do not start a paid service, link a payment method, or request a paid quota increase for Atelier. This integration uses the public Books API and stops on access/quota errors; it never enables billing or purchases books. Google assigns the actual quota to your project. Check that quota in your console instead of assuming a universal daily allowance. If your account cannot enable Books API or get a usable quota without billing, leave this optional provider disabled and keep using MangaDex/Open Library.

Official references: [Google Books API access and API keys](https://developers.google.com/books/docs/v1/using), [Google API billing behavior](https://support.google.com/googleapi/answer/6158867), [API key restrictions](https://docs.cloud.google.com/docs/authentication/api-keys), [Google API key security](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices).

## Create the key with your Google account

1. Open [Create a Google Cloud project](https://console.cloud.google.com/projectcreate). Name it **Atelier Strawby**. Create/select it. Leave billing unlinked; no free-trial enrollment is needed by this application.
2. With that project selected, open the [Books API library page](https://console.cloud.google.com/apis/library/books.googleapis.com) and click **Enable**.
3. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Choose **Create credentials → API key**. Name the key **Atelier Strawby local metadata**. Do not bind it to a service account; we are reading public book data.
4. Under **API restrictions**, select **Restrict key → Books API** and save. Google may take a few minutes to apply changes.
5. This is a **server** key. Website/HTTP referrer restrictions are inappropriate for the app's server requests. For local use you may restrict it to your computer/network's public outbound IP if stable; `localhost` and private LAN addresses are not valid public IP restrictions. Otherwise use the Books-API-only restriction while developing locally. Hosted Cloudflare workers do not have a single stable outbound IP by default; configure an appropriate server credential policy separately before hosting.
6. Open **APIs & Services → Books API → Quotas & System Limits** and review the quota assigned to your project. Leave the project without billing. Quota exhaustion should mean waiting or using another source, not enabling billing for Atelier.

## Add it locally

The repository root `.dev.vars` is already ignored by Git and has an empty slot:

```dotenv
GOOGLE_BOOKS_API_KEY=
```

Paste your key after `=` **in that local file**. Do not paste it into chat, `.dev.vars.example`, source code, `wrangler.toml`, or a `PUBLIC_` environment variable. Preserve the file's existing authentication settings. Restart the running Astro/Pages development server so it reads the new binding.

Run:

```bash
npm run metadata:google-check
```

This performs one live Google Books query for *Project Hail Mary* using the local platform bindings. It reports whether access works and the number of returned/matching suggestions; it never prints the key or changes physical collection records. A successful lookup caches provider JSON in D1. An absent key sends no request. A rejected key or exhausted quota produces a short diagnostic. The check uses a forced lookup so cached success cannot hide a broken key.

Then open a volume's **Edit** form or **Add to collection**, expand **Find metadata & artwork**, select **Google Books** under **Metadata source**, and click **Search Books**. Enter a title or ISBN in **Lookup title**. Review the source and edition before choosing **Use these details**, then save the form. Automatic lookup prefers Google Books over Open Library when a server key exists and Google returns an applicable match. In manga lookup, its volume suggestions appear ahead of MangaDex series candidates. Incompatible Google results or provider failure allow the Open Library fallback. No key means automatic lookup simply skips Google.

For a separately configured hosted environment, set `GOOGLE_BOOKS_API_KEY` as a Cloudflare Pages **secret**, separately for preview/production. Local `.dev.vars` is not deployed. Hosted release remains a separate task.

## Behavior and limits

- Google Books result IDs are individual catalog listings; `totalItems` is a search-result count, **not the number of released volumes in a manga series**. This integration does not use it for missing-volume claims.
- The query requests the chosen language and includes the volume number for manga/light novels. Results retain Google's order and context. Incompatible title/number/medium, language, author, or ISBN matches are shown for context with application disabled. Publisher differences and eBook listings are disclosed for manual review.
- Missing language or ISBN evidence does not become an exact match. Physical format is unverified even when a catalog title and ISBN match. Artwork is labeled representative; Google covers remain external HTTPS references and are not added to the unattended cover-caching utility.
- Applying a candidate never changes acquisition dates, notes, memory tags, volume numbering, media classification, or physical format. Manga/light-novel canonical titles stay as entered. Book titles, recorded creators/publisher and optional artwork can be applied to the form, with normal save required to persist.
- The server sends the key in `X-Goog-Api-Key`, not browser requests or query strings. Secret-bearing requests cannot follow a redirect to another origin. Credentials are not written into provider cache payloads/keys or error messages.
- Existing bounded requests, D1 caching, provider spacing and Retry-After handling apply. Successful responses cache for seven days; editor search is limited to 12 returned results per lookup. The released-volume panel uses paginated catalog queries described in [RELEASED_VOLUMES.md](RELEASED_VOLUMES.md), initiated per edition by the owner. Force retry spends another request and retains provider throttling.
- Google Books links and the official **Powered by Google** graphic accompany search results, following [Google's branding guidelines](https://developers.google.com/books/branding). The unmodified attribution image in `public/images/googlebooks-poweredby.png` comes from Google's published branding assets.

## Verification

Fixture tests cover language/volume/medium mismatches, publisher and digital-edition warnings, ISBN and standalone book lookup, absent images, disallowed cover hosts, missing key, secret headers, secret-free caches/errors, cross-origin redirect rejection, quota/access failures, and cached automatic fallback. Browser tests cover selecting the third provider, absent-key guidance, and applying a synthetic book suggestion without changing the owner's database.

Verified locally: 65 unit tests, 37 integration tests, desktop/mobile Google Books form tests and axe scans, Astro/TypeScript checks, and the production build passed. The missing-key diagnostic sent no upstream request.

A live authenticated released-volume query succeeded with the owner-configured key on 2026-10-24: the English *Girls' Last Tour* catalog returned volume numbers 1–6, with 2–5 absent from the owned English edition. Only provider caches were written; physical collection records were preserved. Project billing and assigned quotas remain settings in the owner's Google Cloud account; this application does not change them.
