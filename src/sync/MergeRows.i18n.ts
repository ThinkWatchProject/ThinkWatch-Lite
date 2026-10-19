import { messages } from "@/i18n";

export const mergeRowsText = messages(
  {
    counts: (n: number, c: number, s: number, e: number) =>
      [n && `新增 ${n}`, c && `冲突 ${c}`, s && `相同 ${s}`, e && `错误 ${e}`].filter(Boolean).join(" · "),
    all: { overwrite: "全部覆盖", rename: "全部改名导入", skip: "全部跳过" },
    name: "名称",
    status: "状态",
    action: "处理",
    statusOf: { new: "新增", same: "相同", conflict: "冲突", error: "错误" },
    differs: (units: string) => `${units}不同`,
    flag: { missing_key: "缺少密钥", needs_login: "需要登录", plugin_disabled: "插件停用" },
    choice: { overwrite: "覆盖", rename: "改名导入", skip: "跳过" },
    importIt: "导入",
    cannot: "不可导入",
    /** 两边的默认网关密钥同名、值不同：采用同步数据的值，不用选 */
    takeRemote: "采用同步数据",
    defaultKey: "默认网关密钥",
    clientsFollow: "采用同步数据的值。本机已接管的客户端将自动更新。",
    newName: (name: string) => `「${name}」的新名称`,
    renameFlags: (flags: string) => `改名导入后：${flags}`,
    renameEmpty: "填写新名称。",
    renameSame: "新名称与原名称相同。",
    renameTaken: "已有同名项。",
  },
  {
    counts: (n: number, c: number, s: number, e: number) =>
      [n && `${n} new`, c && `${c} ${c === 1 ? "conflict" : "conflicts"}`, s && `${s} same`, e && `${e} ${e === 1 ? "error" : "errors"}`]
        .filter(Boolean)
        .join(" · "),
    all: { overwrite: "Overwrite all", rename: "Rename all", skip: "Skip all" },
    name: "Name",
    status: "Status",
    action: "Action",
    statusOf: { new: "New", same: "Same", conflict: "Conflict", error: "Error" },
    differs: (units: string) => `${units} differ`,
    flag: { missing_key: "Key missing", needs_login: "Sign-in required", plugin_disabled: "Plugin disabled" },
    choice: { overwrite: "Overwrite", rename: "Rename", skip: "Skip" },
    importIt: "Import",
    cannot: "Cannot import",
    takeRemote: "Use sync data",
    defaultKey: "Default gateway key",
    clientsFollow: "The value from the sync data is used. Clients connected on this device are updated automatically.",
    newName: (name: string) => `New name for “${name}”`,
    renameFlags: (flags: string) => `After renaming: ${flags}`,
    renameEmpty: "Enter a new name.",
    renameSame: "The new name is the same as the old one.",
    renameTaken: "That name is already used.",
  },
);
