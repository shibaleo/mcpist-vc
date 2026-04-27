import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc, unwrap, type RpcData } from "@/lib/rpc-client";

const apiKeysClient = rpc.api.v1.me["api-keys"];

export const apiKeysKeys = {
  all: ["api-keys"] as const,
  list: () => [...apiKeysKeys.all, "list"] as const,
};

export type ApiKey = RpcData<typeof apiKeysClient.$get>["data"][number];
export type IssuedApiKey = RpcData<typeof apiKeysClient.$post>["data"];

export function useApiKeysList() {
  return useQuery({
    queryKey: apiKeysKeys.list(),
    queryFn: () => unwrap(apiKeysClient.$get()),
    select: (r) => r.data,
  });
}

export function useIssueApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: {
      display_name: string;
      expires_at?: string;
      no_expiry?: boolean;
    }) => unwrap(apiKeysClient.$post({ json })),
    onSuccess: () => qc.invalidateQueries({ queryKey: apiKeysKeys.all }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      unwrap(apiKeysClient[":id"].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: apiKeysKeys.all }),
  });
}
