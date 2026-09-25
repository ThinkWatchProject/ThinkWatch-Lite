import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子中间要加重的那几个字。怎么画由组件决定，这里只管是哪几个字、在句子的哪儿 */
type Em = (text: string) => ReactNode;

/** 英文的单复数：`count(3, "request", "requests")` 是 `3 requests` */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 主窗口外壳的文案：源列表、工具栏、状态带、退出确认。流量页的在 `traffic/Traffic.i18n.tsx`。
 *
 * `.tsx`：有几句话中间嵌着地址（`<code>`）、上游名或加粗的片段，而它们在
 * 中英文句子里的位置不同 —— 片段由组件画好传进来，放在哪儿由句子自己决定。
 */
export const appText = messages(
  {
    /** 源列表的各项，也是工具栏上「当前在哪一页」 */
    surfaces: {
      dashboard: "概览",
      requests: "流量",
      sessions: "会话",
      security: "安全",
      upstreams: "上游",
      routing: "路由",
      clients: "客户端",
      keys: "密钥",
      mcp: "MCP",
      settings: "设置",
    },
    newFindings: (label: string, n: number) => `${label} · ${n} 项新发现`,
    listenStale: (why: string) => `监听设置未生效：${why}`,

    // core 的状态。`…Short` 给收起的源列表用，那里只有 80px
    running: "运行中",
    starting: "启动中",
    restarting: (attempt: string) => `重启中（第 ${attempt} 次）`,
    restartingShort: "重启中",
    safeMode: "安全模式 · 网关未运行",
    safeModeShort: "安全模式",
    stopped: "已停止",
    cannotStart: "无法启动",

    // 工具栏
    collapseRail: "收起源列表",
    expandRail: "展开源列表",
    configFile: "配置文件",
    versionHistory: "版本历史",

    // 配置没通过校验。`rejectedAt` 后面直接接 core 给的那句错误
    rejectedTitle: "配置校验未通过，仍在使用上一版本",
    rejectedAt: (stage: string, line: number | null) =>
      `${stage}错误${line != null ? `（第 ${line} 行）` : ""}：`,

    // token 端点换发了新凭据
    rotatedSaved: (provider: ReactNode) => <>{provider} 的 token 端点已换发新凭据，并已写回 config.yaml。</>,
    reloadTip: "如果编辑器中打开了 config.yaml，编辑器可能提示「文件已在磁盘上更改」，需重新加载。",
    reload: "编辑器需重新加载",
    rotatedUnsaved: (provider: string) => `${provider} 已换发新凭据，但未能写回 config.yaml。当前转发正常。`,
    oldRevoked: (em: Em) => <>原凭据已在服务端失效。{em("重启前如未处理，该上游的请求将持续返回 401")}。</>,

    // 断线重连
    staleData: (what: string) => `${what} · 以下数据截至连接断开时`,
    restart: "重新启动",
  },
  {
    surfaces: {
      dashboard: "Overview",
      requests: "Traffic",
      sessions: "Sessions",
      security: "Security",
      upstreams: "Upstreams",
      routing: "Routing",
      clients: "Clients",
      keys: "Keys",
      mcp: "MCP",
      settings: "Settings",
    },
    newFindings: (label: string, n: number) => `${label} · ${count(n, "new finding", "new findings")}`,
    listenStale: (why: string) => `The listen settings did not take effect: ${why}`,

    // 展开的源列表里这一行约 167px，收起时约 51px：「Gateway stopped」比
    // 「Gateway not running」短一截才放得下；「Safe mode」中间是不换行空格，
    // 收起时不会折成两行
    running: "Running",
    starting: "Starting",
    restarting: (attempt: string) => `Restarting (attempt ${attempt})`,
    restartingShort: "Restarting",
    safeMode: "Safe mode · Gateway stopped",
    safeModeShort: "Safe\u00a0mode",
    stopped: "Stopped",
    cannotStart: "Cannot start",

    collapseRail: "Collapse sidebar",
    expandRail: "Expand sidebar",
    configFile: "Config file",
    versionHistory: "Version history",

    rejectedTitle: "Config validation failed; the previous version is still in use",
    rejectedAt: (stage: string, line: number | null) => `${stage} error${line != null ? ` (line ${line})` : ""}: `,

    rotatedSaved: (provider: ReactNode) => (
      <>The token endpoint for {provider} issued new credentials; they have been written back to config.yaml.</>
    ),
    reloadTip:
      "If config.yaml is open in an editor, the editor may report “The file has been changed on disk” and needs to reload it.",
    reload: "Editor needs to reload",
    rotatedUnsaved: (provider: string) =>
      `${provider} issued new credentials, but they could not be written back to config.yaml. Forwarding currently works normally.`,
    oldRevoked: (em: Em) => (
      <>
        The previous credentials are no longer valid on the server.{" "}
        {em("Unless this is resolved before the next restart, requests to this upstream will keep returning 401")}.
      </>
    ),

    staleData: (what: string) => `${what} · Data below is as of the disconnect`,
    restart: "Restart",
  },
);
