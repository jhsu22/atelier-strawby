export async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Strawby-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
