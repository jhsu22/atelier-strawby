import { ZodError } from "zod";
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function readJson(
  request: Request,
  limit = 1024 * 1024,
): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ApiError(415, "Send application/json.");
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new ApiError(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
}
export async function api(
  work: () => Promise<unknown>,
  status = 200,
): Promise<Response> {
  try {
    return Response.json(await work(), { status });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        {
          error: "Please correct the highlighted fields.",
          issues: error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 422 },
      );
    if (error instanceof ApiError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json(
      { error: "The operation could not be completed. Refresh and try again." },
      { status: 503 },
    );
  }
}
