import { useMemo } from "react";
import { call } from "@/control";
import { useKnownModels } from "@/keys/data";
import { useResource } from "@/lib/resource";
import { aliasTable, type ViaConfig } from "./modelVia";

/**
 * 对模型名的原因要用的配置（见 `modelVia.ts`）：现在的路由（概览里的）和别名表（`GET /models`
 * 里的别名项）。概览还没取到是 `null`，什么都不标。模型目录取不到时别名表是空的：只标得出
 * 「指定」，「别名」一个都不标 —— 不知道就不说。
 */
export function useViaConfig(): ViaConfig | null {
  const ov = useResource("overview", () => call("Overview", null), { events: ["config_reloaded"] });
  const models = useKnownModels();
  const routes = ov.data?.routes;
  return useMemo(() => (routes ? { aliases: aliasTable(models.data), routes } : null), [routes, models.data]);
}
