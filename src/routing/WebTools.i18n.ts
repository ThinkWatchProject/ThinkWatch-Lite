import { messages } from "@/i18n";

export const webToolsText = messages(
  {
    title: "联网搜索与网页读取", intro: "选择搜索、读取网页和页内查找由谁执行。普通对话继续按路由规则选择模型。",
    core: "Core 执行", upstream: "上游执行", coreHelp: "独立搜索直接返回结果；对话中的联网操作执行后交回模型。主模型仍按实际用量计费。",
    upstreamHelp: "保留客户端原有请求，按路由规则交给上游。", configure: "配置", test: "测试", save: "保存", cancel: "取消", retry: "重试", loading: "正在读取搜索配置…",
    unavailable: "无法读取联网工具配置。请确认连接正常，且 Core 已支持联网工具。", local: "执行位置：本机 Core", remote: (name: string) => `执行位置：${name}`,
    googleDocsHelp: "Google (Docs) 搜索公开网页，请求间隔至少 6 秒，不支持地区偏好。",
    engines: "搜索引擎", auto: "自动", findEngine: "查找引擎", noEngineMatch: "没有匹配的引擎", engineCount: (n: number) => `已选 ${n} 个引擎`, proxy: "网络出口", system: "跟随系统", direct: "直连",
    language: "搜索语言", region: "国家或地区", automatic: (name: string) => `跟随系统（${name}）`, automaticUnknown: "跟随系统（由搜索引擎决定）", unknownLocale: "当前设置", noLocaleMatch: "没有匹配的语言或地区",
    localeLocal: "自动使用本机 Core 的系统设置。", localeRemote: (name: string) => `自动使用远程 Core「${name}」的系统设置。`, localeHelp: "可按名称搜索并单独修改语言或地区；搜索引擎会尽量按此偏好返回结果。", allowed: "允许的域名", blocked: "排除的域名", domainsHelp: "支持粘贴多行域名，规则包含子域名并同时约束网页读取。排除优先。", allowedHelp: "留空时不限制域名。", blockedHelp: "留空时不排除域名。", add: "添加", remove: "删除", removeDomain: (domain: string) => `删除 ${domain}`, domainPlaceholder: "添加域名，例如 sqlite.org", invalidDomains: (names: string) => `域名格式不正确：${names}`, tooManyDomains: "每份列表最多 100 个域名。", domainConflict: (names: string) => `以下域名同时出现在两份列表中，将被排除：${names}`, engineHelp: "自动按 Core 推荐顺序搜索，失败或无可用结果时切换引擎；也可多选指定优先顺序。",
    maxResults: "搜索结果数", readPages: "摘要不足时读取网页数", pageChars: "每页最多返回字符", timeout: "每次操作超时（秒）", concurrent: "最大并发", interval: "同一引擎请求间隔（毫秒）", cache: "缓存有效期（秒）", toolCalls: "每个请求最多执行工具次数",
    fallback: "独立搜索失败时允许回退上游", fallbackHelp: "回退可能产生上游模型和搜索费用；已交回模型的工具结果不重放。", advanced: "限额与缓存", readHelp: "设为 0 时搜索只返回摘要；模型仍可明确请求读取网页。",
    search: "搜索", open: "读取网页", find: "页内查找", query: "查询词", url: "网页 URL", pattern: "查找文本", run: "执行测试", testing: "正在执行…", testHelp: "使用已保存的配置，由当前连接的 Core 实际联网执行。", noResults: "没有匹配的结果。", cached: "命中缓存", fetched: "实际获取", elapsed: (ms: number) => `${ms} 毫秒`, partial: "部分来源未成功", truncated: "内容已按配置截断", invalid: "请检查数值范围和域名格式。",
  },
  {
    title: "Web search and page reading", intro: "Choose who runs search, page reading, and find-in-page. Model requests continue to follow routing rules.",
    core: "Run in Core", upstream: "Run upstream", coreHelp: "Standalone searches return results directly. Web operations within a conversation return to the model. Main-model usage is still billed.",
    upstreamHelp: "Forward the client's original requests through routing rules.", configure: "Configure", test: "Test", save: "Save", cancel: "Cancel", retry: "Retry", loading: "Loading web-tool configuration…",
    unavailable: "Web-tool configuration is unavailable. Check the connection and that Core supports web tools.", local: "Runs on: local Core", remote: (name: string) => `Runs on: ${name}`,
    googleDocsHelp: "Google (Docs) searches the web, with at least 6 seconds between requests. Regional preferences are not supported.",
    engines: "Search engines", auto: "Automatic", findEngine: "Find an engine", noEngineMatch: "No matching engines", engineCount: (n: number) => `${n} engines selected`, proxy: "Network", system: "System proxy", direct: "Direct",
    language: "Search language", region: "Country or region", automatic: (name: string) => `System (${name})`, automaticUnknown: "System (search engine default)", unknownLocale: "Current selection", noLocaleMatch: "No matching language or region",
    localeLocal: "Automatic uses the local Core’s system settings.", localeRemote: (name: string) => `Automatic uses the system settings of remote Core “${name}”.`, localeHelp: "Search by name to override either preference. Search engines apply these preferences where supported.", allowed: "Allowed domains", blocked: "Blocked domains", domainsHelp: "Paste multiple hostnames on separate lines. Rules include subdomains and apply to page reading. Blocked domains take priority.", allowedHelp: "Empty allows all domains.", blockedHelp: "Empty blocks no domains.", add: "Add", remove: "Delete", removeDomain: (domain: string) => `Delete ${domain}`, domainPlaceholder: "Add a hostname, e.g. sqlite.org", invalidDomains: (names: string) => `Invalid hostnames: ${names}`, tooManyDomains: "Each list supports up to 100 hostnames.", domainConflict: (names: string) => `These domains appear in both lists and will be blocked: ${names}`, engineHelp: "Automatic follows Core’s recommended order and switches engines on failure or no usable results. Select engines to set your own priority.",
    maxResults: "Search results", readPages: "Read pages when snippets are insufficient", pageChars: "Maximum characters per page", timeout: "Operation timeout (seconds)", concurrent: "Concurrent operations", interval: "Interval per engine (milliseconds)", cache: "Cache lifetime (seconds)", toolCalls: "Maximum tool calls per request",
    fallback: "Allow upstream fallback if a standalone search fails", fallbackHelp: "Fallback may incur upstream model and search fees. Tool results already given to the model are not replayed.", advanced: "Limits and cache", readHelp: "Zero returns snippets only from searches. The model can still explicitly request a page.",
    search: "Search", open: "Read page", find: "Find in page", query: "Query", url: "Page URL", pattern: "Find text", run: "Run test", testing: "Running…", testHelp: "Uses the saved configuration and makes real network requests from the connected Core.", noResults: "No matching results.", cached: "Cache hit", fetched: "Fetched", elapsed: (ms: number) => `${ms} ms`, partial: "Some sources failed", truncated: "Content was truncated to the configured limit", invalid: "Check the numeric ranges and domain names.",
  },
);
