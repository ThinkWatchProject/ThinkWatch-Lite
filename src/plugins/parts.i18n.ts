import { messages } from "@/i18n";

export const pluginPartsText = messages(
  {
    lines: (n: number) => `${n.toLocaleString()} 行`,
    unchangedLines: (n: number) => `${n.toLocaleString()} 行未改动`,
    tally: (added: number, removed: number) => `新增 ${added.toLocaleString()} 行，删除 ${removed.toLocaleString()} 行`,
    noDifference: "内容相同",
    invisible: (code: string) => `看不见的字符 ${code}`,
    loadingCode: "正在打开代码",
    /** 读屏读出来的代码框 */
    codeLabel: "插件代码",
    permissions: "申请的权限",
    /** 这一项权限这一版没有了 */
    permissionRemoved: "不再申请",
    statsTitle: "运行统计",
    errorAt: (line: number, column: number | null) => (column != null ? `第 ${line} 行第 ${column} 列` : `第 ${line} 行`),
  },
  {
    lines: (n: number) => `${n.toLocaleString()} ${n === 1 ? "line" : "lines"}`,
    unchangedLines: (n: number) => `${n.toLocaleString()} unchanged ${n === 1 ? "line" : "lines"}`,
    tally: (added: number, removed: number) => `${added.toLocaleString()} added, ${removed.toLocaleString()} removed`,
    noDifference: "The contents are the same",
    invisible: (code: string) => `Invisible character ${code}`,
    loadingCode: "Opening the code",
    codeLabel: "Plugin code",
    permissions: "Requested permissions",
    permissionRemoved: "No longer requested",
    statsTitle: "Runs",
    errorAt: (line: number, column: number | null) => (column != null ? `line ${line}, column ${column}` : `line ${line}`),
  },
);
