import { hc, type InferResponseType } from "hono/client";
import type { AppType } from "@/lib/hono-app";
import { ApiError } from "@/lib/api-client";

/**
 * Type-safe RPC client for the Hono API.
 *
 * `import type { AppType }` keeps server-only deps (Drizzle, postgres, Stripe,
 * jose, ...) out of the client bundle.
 */
export const rpc = hc<AppType>("");

function isErrorBody(body: unknown): body is { error: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  );
}

type SuccessBody<T extends { json: () => Promise<unknown> }> = Exclude<
  Awaited<ReturnType<T["json"]>>,
  { error: string }
>;

/**
 * Await an RPC response, throw ApiError on non-2xx (or on a 2xx that still
 * carries an `{ error }` envelope), and return the success-branch body.
 */
export async function unwrap<
  T extends { ok: boolean; json: () => Promise<unknown>; status: number },
>(promise: Promise<T>): Promise<SuccessBody<T>> {
  const res = await promise;
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body: unknown = await res.json();
      if (isErrorBody(body)) msg = body.error;
    } catch {
      /* body not JSON */
    }
    throw new ApiError(res.status, { error: msg });
  }
  const body: unknown = await res.json();
  if (isErrorBody(body)) {
    throw new ApiError(res.status, { error: body.error });
  }
  return body as SuccessBody<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcData<T extends (...args: any[]) => any> = Exclude<
  InferResponseType<T>,
  { error: string }
>;
