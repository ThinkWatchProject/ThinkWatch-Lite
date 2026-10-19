/**
 * 同步用到的调用。
 *
 * **同步本身在 core**（`/sync…`，类型化的 `call`）。这一侧（Rust）只做 core 看不见的几样：
 * 选文件夹的系统对话框、这台电脑的名字、哪几把密钥被接管着的客户端用着（`sync_pin_keys`，
 * 开启同步之前报一次，「使用同步数据替换本机配置」时 core 据此保留它们）。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type {
  ImportDecision,
  SyncEncryptionAction,
  SyncJoin,
  SyncConflictDecision,
  SyncSettingsSave,
  SyncTarget,
} from "@/types";

export const syncApi = {
  status: () => call("SyncStatus", null),
  test: (target: SyncTarget, passphrase: string | null) => call("SyncTest", { target, passphrase }),
  joinPreview: (target: SyncTarget, passphrase: string | null) => call("SyncJoinPreview", { target, passphrase }),
  enable: (req: {
    target: SyncTarget;
    encrypt: boolean;
    passphrase: string | null;
    device_name: string;
    join: SyncJoin;
    decisions: ImportDecision[];
  }) => call("SyncEnable", req),
  save: (req: SyncSettingsSave) => call("SyncSave", req),
  now: () => call("SyncNow", null),
  conflicts: () => call("SyncConflicts", null),
  resolve: (decisions: SyncConflictDecision[]) => call("SyncResolve", { decisions }),
  encryption: (action: SyncEncryptionAction, passphrase: string | null, newPassphrase: string | null) =>
    call("SyncEncryption", { action, passphrase, new_passphrase: newPassphrase }),
  unlock: (passphrase: string) => call("SyncUnlock", { passphrase }),
  disable: (purge: boolean) => call("SyncDisable", { purge }),
  /** 同步位置空了、同步密钥不可用之后：重新上传本机配置（放回本设备记着的同步密钥） */
  republish: () => call("SyncRepublish", null),
  /** 系统的「选择文件夹」对话框。只在连着本机时有；取消了是 null */
  pickFolder: () => invoke<string | null>("pick_sync_folder"),
  /** 这台电脑的名字（本设备名称的缺省值） */
  computerName: () => invoke<string>("sync_device_name"),
  /** 把接管着的客户端在用的密钥报给 core */
  pinKeys: () => invoke<string[]>("sync_pin_keys"),
};

/** `useResource` 的键。属于连着的那个 core，换连接时清掉 */
export const SYNC_KEYS = {
  status: "sync:status",
  conflicts: "sync:conflicts",
} as const;
