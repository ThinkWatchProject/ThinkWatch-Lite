import { messages } from "@/i18n";

export const connectText = messages(
  {
    missing: "未找到 core 程序",
    restarting: (attempt: string) => `core 已退出，正在进行第 ${attempt} 次重启`,
    retryIn: (secs: number) => `${secs} 秒后重试`,
    safeMode: "安全模式：网关未运行",
    safeModeNext: "配置、回滚与还原接管仍可使用。安全模式通常由配置错误导致，请检查配置文件。",
    stopped: "core 未运行",
    stoppedNext: "点击「重新启动」以启动 core",
    starting: "正在启动 core",
    wait: "请稍候",
    connecting: "正在连接控制面",
    attempt: (n: number) => `第 ${n} 次尝试`,
    restart: "重新启动",
  },
  {
    missing: "The core program was not found",
    restarting: (attempt: string) => `core exited; restarting (attempt ${attempt})`,
    retryIn: (secs: number) => `Retrying in ${secs} s`,
    safeMode: "Safe mode: the gateway is not running",
    safeModeNext:
      "Config editing, rollback and restoring clients remain available. Safe mode is usually caused by a config error; check the config file.",
    stopped: "core is not running",
    stoppedNext: "Click Restart to start core",
    starting: "Starting core",
    wait: "This takes a moment",
    connecting: "Connecting to the control plane",
    attempt: (n: number) => `Attempt ${n}`,
    restart: "Restart",
  },
);
