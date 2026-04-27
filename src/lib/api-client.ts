/**
 * Tiny error class returned from rpc-client.unwrap() when the API responds
 * non-2xx (or 2xx with an `{ error }` envelope). Components inspect `.status`
 * to choose the user-facing message (401 → re-login, 404 → not found, ...).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error: string },
  ) {
    super(body.error);
    this.name = "ApiError";
  }
}
