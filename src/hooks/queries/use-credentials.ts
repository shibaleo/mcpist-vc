/**
 * Hooks for /api/v1/me/credentials.
 *
 * Types are inferred from the server's chained Hono route schema via
 * `RpcData<typeof rpc.api.v1.me.credentials.$get>` — there's no shared
 * "DTO" file, no manual zod mirror, no openapi-typescript generation
 * step. The route's response shape *is* the client's type.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc, unwrap, type RpcData } from "@/lib/rpc-client";

export const credentialsKeys = {
  all: ["credentials"] as const,
  list: () => [...credentialsKeys.all, "list"] as const,
};

export type Credential =
  RpcData<typeof rpc.api.v1.me.credentials.$get>["data"][number];

export function useCredentialsList() {
  return useQuery({
    queryKey: credentialsKeys.list(),
    queryFn: () => unwrap(rpc.api.v1.me.credentials.$get()),
    select: (r) => r.data,
  });
}

export function useUpsertCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      module,
      credentials,
    }: {
      module: string;
      credentials: unknown;
    }) =>
      unwrap(
        rpc.api.v1.me.credentials[":module"].$put({
          param: { module },
          json: { credentials },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: credentialsKeys.all }),
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ module }: { module: string }) =>
      unwrap(
        rpc.api.v1.me.credentials[":module"].$delete({
          param: { module },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: credentialsKeys.all }),
  });
}
