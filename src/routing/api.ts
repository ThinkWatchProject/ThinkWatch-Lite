/**
 * 路由页用到的控制面调用。**只是类型化的 invoke**：规则怎么校验、改名时
 * 密钥和规则怎么跟着改、删除时密钥改用哪条路由，全在 core。
 */
import { call } from "@/control";
import type { DryRunRequest, GroupSave, RouteSave } from "@/types";
import type { DryRunRequestX, DryRunResultX, RouteSaveX } from "./provisional";

// 规则的 `to` 可以是指定模型的列表：生成的类型换上之前，按 `provisional.ts` 里的写法交出去
export const api = {
  createRoute: (save: RouteSaveX) => call("CreateRoute", save as RouteSave),
  updateRoute: (name: string, save: RouteSaveX) => call("UpdateRoute", save as RouteSave, name),
  /** `reassignTo` 为空：使用它的密钥改用默认路由 */
  deleteRoute: (name: string, baseVersion: string, reassignTo: string | null) =>
    call("DeleteRoute", { base_version: baseVersion, reassign_to: reassignTo }, name),
  setDefaultRoute: (name: string, baseVersion: string) =>
    call("SetDefaultRoute", { name, base_version: baseVersion }),
  createGroup: (save: GroupSave) => call("CreateGroup", save),
  updateGroup: (name: string, save: GroupSave) => call("UpdateGroup", save, name),
  deleteGroup: (name: string, baseVersion: string) =>
    call("DeleteGroup", { base_version: baseVersion }, name),
  knownModels: () => call("KnownModels", null),
  /** 一个上游的模型清单（指定模型时从这里选，带上下文窗口） */
  providerModels: (name: string) => call("ProviderModels", null, name),
  dryRun: (req: DryRunRequestX): Promise<DryRunResultX> => call("DryRun", req as DryRunRequest),
  /** 从 `fromMs` 到现在，各条路由、各条规则命中了多少，以及记录从哪一刻起是全的 */
  routeStats: (fromMs: number) => call("RouteStats", { from_ms: fromMs }),
};
