import { messages } from "@/i18n";

/** 设置页的骨架（目录、分组、保存栏）自己说的几句 */
export const kitText = messages(
  {
    index: "设置目录",
    unsaved: "有未保存的更改",
    saved: "已保存",
    discard: "放弃更改",
    offline: "连接到 core 后可修改此项。",
    loadFailed: "无法读取",
    /** 改配置文件的两节读不到网关配置时，那一行的标题 */
    configFailed: "无法读取网关配置",
  },
  {
    index: "Settings sections",
    unsaved: "Unsaved changes",
    saved: "Saved",
    discard: "Discard changes",
    offline: "Available once connected to a core.",
    loadFailed: "Could not load",
    configFailed: "The gateway configuration could not be read",
  },
);
