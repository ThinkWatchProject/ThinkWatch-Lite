import { textOf } from "@/i18n";
import { parseCoreState } from "@/coreState";
import type { Surface } from "@/nav";
import { appText } from "@/App.i18n";

/** core 此刻怎么样，侧栏左下角和设置页里同一句 */
export interface CoreLine {
  text: string;
  short: string;
  tone: "ok" | "warn" | "bad";
}

/**
 * core 的状态说成人话。
 *
 * `short` 是给收起的源列表用的 —— 那里只有 80px。**不是截断，是另写一句**：截断
 * 出来的「安全模式 · 网关未…」比四个字更难读。
 */
export function describeCore(raw: string): CoreLine {
  const t = textOf(appText);
  const s = parseCoreState(raw);
  switch (s.kind) {
    case "running":
      return { text: t.running, short: t.running, tone: "ok" };
    case "starting":
      return { text: t.starting, short: t.starting, tone: "warn" };
    case "restarting":
      return { text: t.restarting(String(s.attempt)), short: t.restartingShort, tone: "warn" };
    // 安全模式必须显眼：这时候网关不转发了，所有 AI 客户端都停着
    case "safe_mode":
      return { text: t.safeMode, short: t.safeModeShort, tone: "bad" };
    // 程序运行不了。原因在启动画面上说（见 launch/trouble.ts）
    case "failed":
    case "exited":
      return { text: t.cannotStart, short: t.cannotStart, tone: "bad" };
    default:
      return { text: t.stopped, short: t.stopped, tone: "bad" };
  }
}

/** 编辑 config.yaml 的几页。工具栏上的「配置文件」「版本历史」只在这几页出现 */
export const CONFIG_PAGES = new Set<Surface>(["upstreams", "keys", "routing", "security", "plugins"]);

/** 配置文件里的一段由哪一页管理 */
export function surfaceOf(section: string | null): Surface {
  switch (section) {
    case "providers":
    case "proxies":
    case "pricing":
      return "upstreams";
    case "clients":
      return "keys";
    case "routes":
    case "groups":
    case "default_route":
      return "routing";
    case "security":
      return "security";
    case "plugins":
      return "plugins";
    default:
      // 监听、日志保留在设置页；辅助请求在路由页，但它没有自己的段名
      return "settings";
  }
}
