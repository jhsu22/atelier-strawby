import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import {
  authorize,
  validMutationOrigin,
} from "../../src/server/auth/access.ts";
import {
  itemSchema,
  memoryTags,
  publicImageUrl,
} from "../../src/domain/item.ts";
import {
  browseEntries,
  browseParams,
  defaultBrowseState,
  parseBrowseState,
} from "../../src/domain/library.ts";
import type { LibraryEntry } from "../../src/domain/library.ts";
import { readJson } from "../../src/server/http/api.ts";
import {
  allowedProviderUrl,
  boundedFetch,
} from "../../src/server/metadata/http.ts";
import { imageMime } from "../../src/server/metadata/artwork.ts";
import {
  editionVolume,
  samePublisher,
} from "../../src/server/metadata/providers.ts";

test("Stage 3 search combines fuzzy titles, edition, publisher/label, acquisition year, language and manual memory tags on the same copy", () => {
  const entries: LibraryEntry[] = [
    {
      kind: "manga",
      id: "series",
      title: "Manga Story",
      authors: ["Author"],
      aliases: ["日本語"],
      copies: [
        {
          id: "jp",
          editionRunId: "a",
          editionTitle: "Special edition",
          publisher: "Pub",
          language: "JP",
          languageBasis: "confirmed",
          volume: "1",
          volumeSort: 1000,
          numberingBasis: "printed",
          medium: "manga",
          format: "collectors",
          acquiredOn: "2025-01-02",
          notes: "Trip",
          tags: ["Korea Trip"],
        },
        {
          id: "en",
          editionRunId: "b",
          editionTitle: "English",
          publisher: "Other",
          language: "EN",
          languageBasis: "confirmed",
          volume: "1",
          volumeSort: 1000,
          numberingBasis: "printed",
          medium: "manga",
          format: "standard",
          acquiredOn: "2024-01-02",
          notes: null,
          tags: [],
        },
      ],
    },
    {
      kind: "cd",
      id: "release",
      title: "Album",
      artists: ["Artist"],
      editionTitle: "Limited",
      releaseId: "release",
      releaseDate: "2024",
      formats: ["CD"],
      labels: ["Music Label"],
      catalogNumbers: ["CAT-123"],
      tracks: [],
      copies: [
        {
          id: "cd",
          version: 1,
          acquiredOn: null,
          notes: "gift from family",
          isSample: false,
          tags: ["Gifts"],
        },
      ],
    },
  ];
  assert.equal(
    browseEntries(entries, {
      ...defaultBrowseState,
      query: "Stroy",
      language: "JP",
      publisher: "Pub",
      year: "2025",
      format: "collectors",
      memory: "Korea Trip",
    }).length,
    1,
  );
  assert.equal(
    browseEntries(entries, {
      ...defaultBrowseState,
      language: "JP",
      year: "2024",
    }).length,
    0,
  );
  assert.equal(
    browseEntries(entries, {
      ...defaultBrowseState,
      query: "CAT-123",
      publisher: "Music Label",
      year: "unknown",
      memory: "Gifts",
      format: "Limited",
    }).length,
    1,
  );
  assert.equal(
    browseEntries(entries, { ...defaultBrowseState, query: "日本語" }).length,
    1,
  );
  assert.equal(
    browseEntries(entries, {
      ...defaultBrowseState,
      query: "nonsense-that-cannot-match",
    }).length,
    0,
  );
});
test("editable memory classification is deterministic and input validation rejects impossible dates, tracks and unsafe URLs", () => {
  assert.deepEqual(
    memoryTags(
      "gift from sammy at Kinokuniya; box set; proxy haul; Korea trip",
    ),
    [
      "Gifts from Sammy",
      "Kinokuniya Trips",
      "Box Sets",
      "Korea Trip",
      "Proxy Hauls",
      "Box Set",
      "Gifts",
    ],
  );
  for (const value of [
    "javascript:alert(1)",
    "http://example.com/image",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://[::1]/x",
    "https://user:pass@example.com/x",
  ])
    assert.equal(publicImageUrl(value), false);
  assert.equal(publicImageUrl("https://example.com/image.jpg"), true);
  assert.equal(
    itemSchema.safeParse({
      kind: "manga",
      title: "Title",
      acquiredOn: "2025-02-29",
    }).success,
    false,
  );
  assert.equal(
    itemSchema.safeParse({
      kind: "cd",
      title: "Album",
      tracks: [{ medium: 2, position: 1, title: "Track" }],
    }).success,
    false,
  );
  assert.equal(
    itemSchema.safeParse({ kind: "cd", title: "Album", releaseDate: "2024-13" })
      .success,
    false,
  );
});
test("hosted Access checks verify signature, issuer, audience, expiry and owner; local flags never authorize a remote URL", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  jwk.alg = "RS256";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const env = {
    APP_ENV: "production",
    APP_ORIGIN: "https://library.example.com",
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ACCESS_AUDIENCE: "audience",
    ACCESS_OWNER_EMAIL: "owner@example.com",
  };
  const token = async (claims: Record<string, unknown> = {}) =>
    new SignJWT({ email: "owner@example.com", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("owner")
      .setIssuer("https://example.cloudflareaccess.com")
      .setAudience("audience")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  const req = (jwt: string, origin = "https://library.example.com") =>
    new Request(origin, { headers: { "Cf-Access-Jwt-Assertion": jwt } });
  const valid = await token();
  assert.equal(await authorize(req(valid), env, keys), true);
  assert.equal(
    await authorize(
      req(await token({ email: "stranger@example.com" })),
      env,
      keys,
    ),
    false,
  );
  assert.equal(
    await authorize(req(valid), { ...env, ACCESS_AUDIENCE: "other" }, keys),
    false,
  );
  assert.equal(
    await authorize(
      req(valid),
      { ...env, ACCESS_TEAM_DOMAIN: "other.cloudflareaccess.com" },
      keys,
    ),
    false,
  );
  assert.equal(
    await authorize(req(valid, "https://preview.example.com"), env, keys),
    false,
  );
  const expired = await new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("owner")
    .setIssuer("https://example.cloudflareaccess.com")
    .setAudience("audience")
    .setIssuedAt(1)
    .setExpirationTime(2)
    .sign(privateKey);
  assert.equal(await authorize(req(expired), env, keys), false);
  assert.equal(
    await authorize(req(valid.slice(0, -6) + "forged"), env, keys),
    false,
  );
  assert.equal(
    await authorize(new Request("https://library.example.com"), {
      APP_ENV: "local",
      LOCAL_DEV_AUTH: "true",
    }),
    false,
  );
  assert.equal(
    await authorize(new Request("http://127.0.0.1:4321"), {
      APP_ENV: "local",
      LOCAL_DEV_AUTH: "true",
    }),
    true,
  );
});
test("mutation boundary rejects cross-origin, missing intent, malformed and oversized bodies", async () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:4321/api/items", {
      method: "POST",
      headers,
      body: "{}",
    });
  const headers = {
    origin: "http://127.0.0.1:4321",
    "x-strawby-request": "1",
    "content-type": "application/json",
  };
  assert.equal(validMutationOrigin(request(headers)), true);
  assert.equal(
    validMutationOrigin(
      request({ ...headers, origin: "https://evil.example" }),
    ),
    false,
  );
  assert.equal(
    validMutationOrigin(request({ ...headers, "x-strawby-request": "" })),
    false,
  );
  await assert.rejects(readJson(request({}), 100), /application\/json/);
  await assert.rejects(
    readJson(
      new Request("https://example.com", {
        method: "POST",
        headers,
        body: "{invalid",
      }),
    ),
    /Invalid JSON/,
  );
  await assert.rejects(
    readJson(
      new Request("https://example.com", {
        method: "POST",
        headers,
        body: "123456789",
      }),
      4,
    ),
    /too large/,
  );
});
test("provider image fetching validates redirects, byte limits and signatures", async () => {
  assert.equal(
    allowedProviderUrl("https://archive.org.evil.example/file"),
    false,
  );
  await assert.rejects(
    boundedFetch(
      "https://coverartarchive.org/release/test",
      {},
      100,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        }),
    ),
    /not allowed/,
  );
  await assert.rejects(
    boundedFetch(
      "https://uploads.mangadex.org/image",
      {},
      3,
      async () => new Response("too big"),
    ),
    /size limit/,
  );
  assert.equal(
    imageMime(new TextEncoder().encode('<svg onload="bad()">')),
    null,
  );
  assert.equal(imageMime(new Uint8Array([255, 216, 255, 0])), "image/jpeg");
});

test("Open Library edition titles yield a volume only for the series itself, and publishers match across legal suffixes", () => {
  const cases: [string, string[], string | null][] = [
    ["Spy x Family, Vol. 4", ["SPY x FAMILY"], "4"],
    ["Spy X Family, Vol. 12", ["SPY x FAMILY"], "12"],
    ["Laid-Back Camp, Vol. 5", ["Laid Back Camp"], "5"],
    [
      "Summertime Rendering Volume 2 (Paperback)",
      ["Summertime Rendering"],
      "2",
    ],
    ["Shikimori's Not Just a Cutie 7", ["Shikimori's not Just a Cutie"], "7"],
    ["A Silent Voice 03", ["A Silent Voice"], "3"],
    [
      "Kaoru Hana wa Rin to Saku 1",
      ["The Fragrant Flower", "Kaoru Hana wa Rin to Saku"],
      "1",
    ],
    ["BAKEMONOGATARI (manga), Volume 3", ["Bakemonogatari"], "3"],
    ["A Silent Voice Special Movie Book", ["A Silent Voice"], null],
    ["86--Eighty-Six, Vol. 1 (light novel)", ["86: EIGHTY-SIX"], null],
    ["Story: Box Set 1-3", ["Story"], null],
    ["Wotakoi", ["Wotakoi: Love is Hard for Otaku"], null],
    ["Spy x Family: Family Portrait", ["SPY x FAMILY"], null],
  ];
  for (const [title, series, volume] of cases)
    assert.equal(editionVolume(title, series), volume, title);
  assert.ok(samePublisher("Kodansha", ["Kodansha America, Incorporated"]));
  assert.ok(samePublisher("Yen Press", ["Yen Press LLC"]));
  assert.ok(samePublisher("VIZ Media", ["Viz Media"]));
  assert.ok(samePublisher("VIZ Media", ["SHONEN JUMP"]));
  assert.ok(samePublisher("Kodansha", ["Vertical, Incorporated"]));
  assert.ok(samePublisher("VIZ Media", ["Viz Communications"]));
  assert.ok(
    samePublisher("Udon Entertainment", ["UDON Entertainment Corporation"]),
  );
  assert.ok(!samePublisher("VIZ Media", ["Ivrea"]));
  assert.ok(!samePublisher("Yen Press", ["Yen On"]));
  assert.ok(!samePublisher("Square Enix", ["Yen On"]));
  assert.ok(!samePublisher("", ["Yen Press"]));
});

test("light-novel edition titles and imprints match only the light-novel medium", () => {
  const ln = (title: string, series: string[]) =>
    editionVolume(title, series, "light_novel");
  assert.equal(
    ln("86—EIGHTY-SIX, Vol. 4 (light novel)", ["86: EIGHTY-SIX"]),
    "4",
  );
  assert.equal(
    editionVolume("86—EIGHTY-SIX, Vol. 4 (light novel)", ["86: EIGHTY-SIX"]),
    null,
  );
  assert.equal(ln("BAKEMONOGATARI, Part 02", ["Bakemonogatari"]), "2");
  assert.equal(
    editionVolume("BAKEMONOGATARI, Part 02", ["Bakemonogatari"]),
    null,
  );
  assert.equal(
    ln("BAKEMONOGATARI (manga), Volume 3", ["Bakemonogatari"]),
    null,
  );
  // Standalone novels are unnumbered; unnumbered manga may be an omnibus.
  assert.equal(ln("Three Days of Happiness", ["Three Days of Happiness"]), "1");
  assert.equal(editionVolume("Wotakoi", ["Wotakoi"]), null);
  assert.ok(samePublisher("Yen Press", ["Yen On"], "light_novel"));
  assert.ok(!samePublisher("Yen Press", ["Yen On"], "manga"));
  assert.ok(
    samePublisher("Kodansha", ["Vertical, Incorporated"], "light_novel"),
  );
});

test("browse URL state keeps the Books tab and manga type filter", () => {
  const state = parseBrowseState(
    new URLSearchParams("media=book&type=light_novel"),
  );
  assert.equal(state.media, "book");
  assert.equal(state.type, "light_novel");
  assert.equal(browseParams(state).toString(), "media=book&type=light_novel");
  assert.equal(parseBrowseState(new URLSearchParams("type=comic")).type, "");
});
