import { messages } from "./index";

/**
 * 到处都用的几个词。**同一个动作只有一种说法**（见 copy.test.ts），所以它们
 * 只在这里写一次。
 */
export const commonText = messages(
  {
    cancel: "取消",
    close: "关闭",
    save: "保存",
    delete: "删除",
    edit: "编辑",
    retry: "重试",
    copy: "复制",
    copied: "已复制",
    confirm: "确认",
    none: "无",
  },
  {
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    retry: "Retry",
    copy: "Copy",
    copied: "Copied",
    confirm: "Confirm",
    none: "None",
  },
);
