import { messages } from "@/i18n";

/**
 * 界面组件库（`src/ui`）自己的几句话：状态三件套、撤销提示、读屏标签。
 *
 * 页面上的句子仍写在各页的词表里；这里只放组件默认说的那几句，页面可以传
 * 自己的覆盖掉。
 */
export const uiText = messages(
  {
    loading: "读取中…",
    loadFailed: "读取失败",
    retry: "重试",
    undo: "撤销",
    undone: "已撤销",
    dismiss: "关闭",
    live: "实时",
  },
  {
    loading: "Loading…",
    loadFailed: "Could not load",
    retry: "Retry",
    undo: "Undo",
    undone: "Undone",
    dismiss: "Dismiss",
    live: "Live",
  },
);
