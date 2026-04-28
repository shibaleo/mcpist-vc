import { useMutation, useQuery } from "@tanstack/react-query";
import { rpc, unwrap, type RpcData } from "@/lib/rpc-client";

export const oauthKeys = {
  all: ["oauth"] as const,
  providers: () => [...oauthKeys.all, "providers"] as const,
};

export type OAuthProvider =
  RpcData<typeof rpc.api.v1.me.oauth.providers.$get>["data"][number];

/** Providers reachable through DB or env credentials. */
export function useOAuthProviders() {
  return useQuery({
    queryKey: oauthKeys.providers(),
    queryFn: () => unwrap(rpc.api.v1.me.oauth.providers.$get()),
    select: (r) => r.data,
  });
}

/**
 * Get the authorize URL for `module`. The caller navigates the browser to
 * it full-page — popup-based PKCE breaks once cross-site cookies are blocked.
 */
export function useOAuthStart() {
  return useMutation({
    mutationFn: ({
      module,
      redirect,
    }: {
      module: string;
      redirect?: string;
    }) =>
      unwrap(
        rpc.api.v1.me.oauth.start.$get({
          query: { module, ...(redirect ? { redirect } : {}) },
        }),
      ),
  });
}

/**
 * Default module to connect for each provider. The "Connect" button on the
 * Credentials page uses this to pick a sensible target module — for
 * single-module providers (notion, github) it's the same name; for Google
 * we default to drive (the most general-purpose Google module).
 */
export const providerDefaultModule: Record<string, string> = {
  notion: "notion",
  github: "github",
  google: "google_drive",
  atlassian: "jira",
  microsoft: "microsoft_todo",
  asana: "asana",
  todoist: "todoist",
  ticktick: "ticktick",
  airtable: "airtable",
  dropbox: "dropbox",
};
