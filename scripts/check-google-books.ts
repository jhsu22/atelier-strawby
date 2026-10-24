import { openLocalPlatform } from "./lib/d1.ts";
import { lookupMetadata } from "../src/server/metadata/providers.ts";

const platform = await openLocalPlatform();
try {
  if (!platform.googleBooksKey?.trim()) {
    console.error("Google Books is not configured. Paste your key into GOOGLE_BOOKS_API_KEY in .dev.vars, then rerun this command. See docs/GOOGLE_BOOKS.md. No request was sent.");
    process.exitCode = 2;
  } else {
    const result = await lookupMetadata(platform.db, {kind: "manga", medium: "book", provider: "googlebooks", query: "Project Hail Mary", language: "EN", retry: true}, {googleBooksKey: platform.googleBooksKey, contact: platform.contact});
    console.log(JSON.stringify({ configured: true, usable: !result.failures?.length, returnedResults: result.candidates.length, matchingSuggestions: result.candidates.filter(candidate => candidate.applicable !== false).length, warnings: result.warnings }, null, 2));
    if (result.failures?.length) process.exitCode = 1;
  }
} finally { await platform.db.close(); }
