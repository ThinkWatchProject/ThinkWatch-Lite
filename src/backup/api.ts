/**
 * 导入导出与备份要用的调用：控制面的那几个端点，和 Rust 这一侧读写文件的两个命令。
 *
 * **文件只在 Rust 这一侧读写**（`src-tauri/src/export.rs`）：保存弹系统的「存储」对话框，打开
 * 弹「打开」对话框、只列配置包；网页拿到的是读出来的内容（Base64），交给 core 的导入预览，
 * 不能指定读写哪个路径。远程模式下也是这样：配置在服务器上，文件在这台设备上。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type {
  ExportRequest,
  ExportedFile,
  ImportDecision,
  ItemRef,
  PickedFile,
} from "@/types";

export const backupApi = {
  items: () => call("ConfigItems", null),
  export: (req: ExportRequest) => call("ExportConfig", req),
  preview: (file: PickedFile, passphrase: string | null) =>
    call("ImportPreview", { data_b64: file.data_b64, passphrase }),
  import: (file: PickedFile, passphrase: string | null, baseVersion: string, decisions: ImportDecision[]) =>
    call("ImportConfig", { data_b64: file.data_b64, passphrase, base_version: baseVersion, decisions }),
  list: () => call("Backups", null),
  file: (id: string, passphrase: string | null) => call("BackupFile", { id, passphrase }),
  /** 恢复会动什么。`items`：只恢复这几项时（null 是整个版本） */
  restorePreview: (id: string, items: ItemRef[] | null) => call("RestorePreview", items ? { id, items } : { id }),
  restore: (id: string, baseVersion: string, items: ItemRef[] | null) =>
    call("Restore", { id, base_version: baseVersion, items }),
  /**
   * 远程模式下 Lite 自己的通用偏好（导出时附上，规格 4.4）。本机模式下 core 存着它，不用附
   */
  clientPrefs: () => invoke<unknown>("client_prefs"),
  /** 远程模式下导入的配置包带着通用偏好：应用到这台设备上 */
  applyClientPrefs: (prefs: unknown) => invoke<boolean>("apply_client_prefs", { prefs }),
  /** 弹「打开」对话框，读所选的配置包。取消了是 `null` */
  open: () => invoke<PickedFile | null>("open_import"),
  /** 弹「存储」对话框，把配置包写到所选的位置。交回写到的路径；取消了是 `null` */
  save: (f: ExportedFile) =>
    invoke<string | null>("save_export", { name: f.file_name, contents: f.data_b64, base64: true }),
};

/** 备份列表在 `useResource` 里的键 */
export const BACKUPS_KEY = "backups";
