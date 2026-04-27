import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc, unwrap, type RpcData } from "@/lib/rpc-client";

export const modulesKeys = {
  all: ["modules"] as const,
  list: () => [...modulesKeys.all, "list"] as const,
  config: () => [...modulesKeys.all, "config"] as const,
};

export type ModuleListing =
  RpcData<typeof rpc.api.v1.modules.$get>["data"][number];

export type ModuleConfigRow =
  RpcData<typeof rpc.api.v1.me.modules.config.$get>["data"][number];

/** Public — list of installed modules + their tool catalogue. */
export function useModulesList() {
  return useQuery({
    queryKey: modulesKeys.list(),
    queryFn: () => unwrap(rpc.api.v1.modules.$get()),
    select: (r) => r.data,
  });
}

/** Per-user module/tool ON-OFF state. */
export function useModuleConfig() {
  return useQuery({
    queryKey: modulesKeys.config(),
    queryFn: () => unwrap(rpc.api.v1.me.modules.config.$get()),
    select: (r) => r.data,
  });
}

export function useUpsertToolSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      enabled_tools,
      disabled_tools,
    }: {
      name: string;
      enabled_tools: string[];
      disabled_tools: string[];
    }) =>
      unwrap(
        rpc.api.v1.me.modules[":name"].tools.$put({
          param: { name },
          json: { enabled_tools, disabled_tools },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: modulesKeys.config() }),
  });
}
