import { useMemo } from "react";
import { appLabel, KNOWN_APPS } from "@/labels";
import { useClients } from "@/clients/data";
import { useKnownModels } from "@/keys/data";
import type { Overview } from "@/types";
import type { ScopeSuggestions, Suggestion } from "./fields";

/**
 * 适用范围输入时给的建议：已知的客户端（认得出名字的应用，和这台机器上找到的客户端）、
 * 网关知道的模型、配置里的上游。**只是建议**：名单里写什么都行，包括带 `*` 的通配。
 */
export function useScopeSuggestions(ov: Overview): ScopeSuggestions {
  const clients = useClients();
  const models = useKnownModels();
  return useMemo(() => {
    // 客户端的 id → 产品名
    const names = new Map(KNOWN_APPS.map((id) => [id, appLabel(id)]));
    for (const c of [...(clients.data?.clients ?? []), ...(clients.data?.manual ?? [])]) names.set(c.id, c.name);
    const client = [...names.keys()]
      .sort()
      .map((id): Suggestion => ({ value: id, note: names.get(id) !== id ? names.get(id) : undefined }));
    const model = (models.data ?? []).map((m): Suggestion => ({ value: m.id }));
    const upstream = ov.providers.map((p): Suggestion => ({ value: p.name }));
    return { clients: client, models: model, upstreams: upstream };
  }, [clients.data, models.data, ov.providers]);
}
