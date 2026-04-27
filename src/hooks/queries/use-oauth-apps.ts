import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc, unwrap, type RpcData } from "@/lib/rpc-client";

export const oauthAppsKeys = {
  all: ["oauth-apps"] as const,
  list: () => [...oauthAppsKeys.all, "list"] as const,
};

// Bracket access on the hyphenated key inside `typeof` confuses the parser
// when piped straight into a generic — split the lookup out.
type OAuthAppsGet = (typeof rpc.api.v1.admin)["oauth-apps"]["$get"];
export type OAuthAppRow = RpcData<OAuthAppsGet>["data"][number];

export function useOAuthAppsList() {
  return useQuery({
    queryKey: oauthAppsKeys.list(),
    queryFn: () => unwrap(rpc.api.v1.admin["oauth-apps"].$get()),
    select: (r) => r.data,
  });
}

export interface UpsertOAuthAppInput {
  provider: string;
  client_id: string;
  /** Empty string leaves the existing secret unchanged. */
  client_secret: string;
  redirect_uri?: string;
  enabled?: boolean;
}

export function useUpsertOAuthApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, ...json }: UpsertOAuthAppInput) =>
      unwrap(
        rpc.api.v1.admin["oauth-apps"][":provider"].$put({
          param: { provider },
          json,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: oauthAppsKeys.all }),
  });
}

export function useDeleteOAuthApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider }: { provider: string }) =>
      unwrap(
        rpc.api.v1.admin["oauth-apps"][":provider"].$delete({
          param: { provider },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: oauthAppsKeys.all }),
  });
}
