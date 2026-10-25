import type { APIRoute } from "astro";
import { api } from "../../server/http/api.ts";
import { d1Store } from "../../server/db/store.ts";
import { exportBackup, exportCsv } from "../../server/services/transfer.ts";
export const GET: APIRoute = async ({ url, locals }) => {
  const kind = url.searchParams.get("kind"),
    db = d1Store(locals.runtime.env.DB);
  if (kind === "manga" || kind === "cd") {
    let csv = "";
    const result = await api(async () => {
      csv = await exportCsv(db, kind);
      return {};
    });
    if (!result.ok) return result;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="strawby-${kind}.csv"`,
      },
    });
  }
  const response = await api(() => exportBackup(db));
  if (response.ok)
    response.headers.set(
      "Content-Disposition",
      'attachment; filename="strawby-collection.json"',
    );
  return response;
};
