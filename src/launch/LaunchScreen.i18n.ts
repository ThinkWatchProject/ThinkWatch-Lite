import { messages } from "@/i18n";

export const launchText = messages(
  {
    starting: "正在启动网关",
    loading: "正在载入数据",
    slow: (secs: number) => `启动耗时较长，已用 ${secs} 秒`,
    /** 网关起来了、也答应了，状态却读不到：多半是两边版本对不上 */
    readFailed: "无法读取网关状态",
  },
  {
    starting: "Starting the gateway",
    loading: "Loading data",
    slow: (secs: number) => `Starting is taking longer than usual: ${secs} s so far`,
    readFailed: "The gateway status could not be read",
  },
);
