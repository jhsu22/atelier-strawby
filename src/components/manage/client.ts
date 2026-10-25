/** The request never reached the server (offline, or a connection that dropped). */
export class NetworkError extends Error {}

export async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
  /** Give up after this long and treat it as a lost connection. */
  timeoutMs?: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Strawby-Request": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch {
    // The request never reached the server, so nothing was saved.
    throw new NetworkError(
      navigator.onLine
        ? "The connection failed before the request was sent. Nothing was saved; try again."
        : "You’re offline. Nothing was saved; reconnect and try again.",
    );
  }
  const data = (await response.json()) as {
    error?: string;
    issues?: { field: string; message: string }[];
  };
  if (!response.ok)
    throw new Error(
      [
        data.error || "Request failed.",
        ...(data.issues ?? []).map(
          (issue: { field: string; message: string }) =>
            `${issue.field}: ${issue.message}`,
        ),
      ].join(" "),
    );
  return data as T;
}
