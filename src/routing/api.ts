/**
 * 路由页用到的控制面调用。**只是类型化的 invoke**：规则怎么校验、改名时
 * 密钥和规则怎么跟着改、删除时密钥改用哪条路由，全在 core。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ConfigWritten,
  DryRunRequest,
  DryRunResult,
  GroupSave,
  KnownModel,
  RouteSave,
} from "@/types";

type Base = string | null;

export const api = {
  createRoute: (save: RouteSave) => invoke<ConfigWritten>("create_route", { save }),
  updateRoute: (name: string, save: RouteSave) =>
    invoke<ConfigWritten>("update_route", { name, save }),
  /** `reassignTo` 为空：使用它的密钥改用默认路由 */
  deleteRoute: (name: string, baseVersion: Base, reassignTo: string | null) =>
    invoke<ConfigWritten>("delete_route", { name, baseVersion, reassignTo }),
  setDefaultRoute: (name: string, baseVersion: Base) =>
    invoke<ConfigWritten>("set_default_route", {
      save: { name, base_version: baseVersion ?? undefined },
    }),
  createGroup: (save: GroupSave) => invoke<ConfigWritten>("create_group", { save }),
  updateGroup: (name: string, save: GroupSave) =>
    invoke<ConfigWritten>("update_group", { name, save }),
  deleteGroup: (name: string, baseVersion: Base) =>
    invoke<ConfigWritten>("delete_group", { name, baseVersion }),
  knownModels: () => invoke<KnownModel[]>("known_models"),
  dryRun: (req: DryRunRequest) => invoke<DryRunResult>("dry_run", { req }),
};
