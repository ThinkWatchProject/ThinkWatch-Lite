/**
 * 路由页用到的控制面调用。**只是类型化的 invoke**：规则怎么校验、改名时
 * 密钥和规则怎么跟着改、删除时密钥改用哪条路由，全在 core。
 */
import { call } from "@/control";
import type { DryRunRequest, GroupSave, RouteSave } from "@/types";


export const api = {
  createRoute: (save: RouteSave) => call("CreateRoute", save),
  updateRoute: (name: string, save: RouteSave) => call("UpdateRoute", save, name),
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
  dryRun: (req: DryRunRequest) => call("DryRun", req),
  /** 从 `fromMs` 到现在，各条路由、各条规则命中了多少 */
  routeStats: (fromMs: number) => call("RouteStats", { from_ms: fromMs }),
};
