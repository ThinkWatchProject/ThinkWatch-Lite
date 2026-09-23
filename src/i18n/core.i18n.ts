import type { Msg } from "@/types";
import { securityLabelsText } from "@/security/labels.i18n";
import { getLang } from "./index";

/**
 * core 发来的那些码，中文怎么说。
 *
 * **只有中文一份，没有英文那一份。**core 给的 `text` 已经是英文了 ——
 * 再在这里抄一份英文，core 一改措辞两边就对不上，而那份抄本没有任何
 * 东西在守着它。所以英文界面直接用 `text`，这张表只回答一个问题：
 * 「这句话中文怎么说」。
 *
 * **码不在表里就显示 `text`。**两种情况会走到这条退路，而且都该走：
 * 这句还没进词表，或者这条消息只是把更深一层的原话原样带出来（`{detail}`
 * 那一类，翻它没有意义）。
 *
 * 码的写法和 core 一致：点分小写，第一段是发出它的那一层（`l1` 是链路
 * 测速，`gw` 是网关的数据面，`control` 是控制面）。
 */
type Args = Record<string, string>;

/**
 * 扫描发现里的「哪一类文件」。
 *
 * **core 给的参数是词，不是句子** —— 它传 `kind=hooks`，句子在这边拼。
 * 传一句拼好的英文过来的话，这边就只剩把它照抄出去一条路了。
 */
const SOURCE_KIND: Record<string, { label: string; why: string }> = {
  hooks: {
    label: "hook",
    why: "hook 在工具调用前后直接执行 shell 命令，无需模型参与即可获得执行权限。",
  },
  mcp: {
    label: "MCP server",
    why: "MCP server 配置指定了可执行程序及其参数，相当于直接运行该程序。",
  },
  skill: { label: "skill", why: "SKILL.md 的内容会被注入模型上下文，成为指令。" },
  command: { label: "斜杠命令", why: "斜杠命令的内容会被注入模型上下文，成为指令。" },
  agent: {
    label: "subagent",
    why: "subagent 定义会被注入模型上下文，并可能声明宽松的工具权限。",
  },
  instructions: { label: "项目指令", why: "该文件会被自动读入模型上下文。" },
};

/**
 * 藏起来的那五类字符。**说清「它能干什么」，不是「它是什么」** ——
 * 「U+200B ZWSP」对绝大多数人不构成信息。
 *
 * 标题只取冒号前的那个名字，和 core 拼英文时的做法一致。
 */
const HIDDEN_KIND: Record<string, string> = {
  zero_width: "零宽字符：在编辑器中不可见，但会被模型读取。",
  tag: "Unicode 标签字符：在编辑器中完全不可见，但会原样进入模型上下文，可用于隐藏整段指令。",
  bidi: "双向控制符：可使屏幕上的显示顺序与实际字符顺序不一致。",
  homoglyph: "同形字符：外观与拉丁字母相同，实际是其他字符，常用于伪装命令和域名。",
  private_use: "私用区码位：没有标准含义，出现在指令文件中即属可疑。",
};

/**
 * 内置规则命中之后那一句「为什么」。
 *
 * **只有内置的这些。**用户在安全页上自己加的规则不在这里，它们的 `why`
 * 是用户自己写的一句话 —— 那句话原样显示才对。
 */
const RULE_WHY: Record<string, string> = {
  "ignore-previous": "典型的提示注入开头",
  disregard: "典型的提示注入开头，使用 disregard 一类的动词",
  "you-are-now": "试图重新设定模型的身份",
  "ignore-previous-zh": "中文提示注入，要求忽略先前的指令",
  "new-instructions-zh": "中文提示注入，声明新的指令",
  "you-are-now-zh": "试图重新设定模型的身份",
  "chat-marker": "伪造对话标记，试图让模型将正文当作系统消息",
  "fake-system": "伪装成系统或助手的发言",
  "curl-pipe-sh": "下载后直接执行，执行的内容由远端决定且无法预先查看",
  "rm-rf-root": "删除整个主目录或根目录",
  "chmod-777": "将文件权限设为所有人可写",
  "base64-decode-exec": "将要执行的内容隐藏在 base64 编码中",
  "exfil-env": "将环境变量（通常包含密钥）发送到外部",
  "exfil-credentials": "要求模型将凭据文件的内容发送出去",
  "exfil-credentials-reversed": "要求模型将凭据文件的内容发送出去",
  "write-startup-item": "写入开机或打开终端时自动执行的位置",
  "crontab-install": "安装定时任务，或删除全部现有定时任务",
  "ssh-key-read": "读取私钥或云服务凭据",
};

/** 「hook 中」要空一格，「项目指令中」不要：只有西文词后面接中文时才空 */
const spaced = (label: string) => (/[A-Za-z0-9]$/.test(label) ? `${label} ` : label);

/** 内置扫描规则的中文名。和安全页、MCP 页用的是同一张表 */
const ruleNameZh = (id: string | undefined): string | undefined =>
  id === undefined ? undefined : securityLabelsText.zh.rules[id];

/**
 * 工具调用命中的那条规则，中文怎么说：名字，以及括号里的「为什么」。
 *
 * **自定义规则没有「为什么」**（core 发来的 `why` 是空的），名字是用户自己
 * 起的，原样用，也不留一对空括号。内置规则两样都要查得到，查不到就整句
 * 退回英文 —— 拼出半句中文比英文更难读。
 */
function toolRuleZh(a: Args, why: string | undefined): { name: string; why: string } | undefined {
  if (!why) return { name: a.name ?? a.rule ?? "", why: "" };
  const name = ruleNameZh(a.rule);
  const reason = word(RULE_WHY, a.rule);
  return name && reason ? { name, why: `（${reason}）` } : undefined;
}

/** 接管什么时候生效。core 也把这个词当参数发过来 */
const TAKES_EFFECT: Record<string, string> = {
  immediately: "下一个请求即使用新配置。",
  on_restart: "重新打开终端后生效，在此之前网关不会收到该客户端的请求。",
};

/** 词表里查一个词。**查不到就是「这句说不出来」**，交给调用处退回英文 */
const word = <T,>(table: Record<string, T>, key: string | undefined): T | undefined =>
  key === undefined ? undefined : table[key];

/**
 * 配置里一类东西的名字。core 发的是英文词（`upstream`、`price sheet`），
 * 同一个词既进它的英文句子，也进 `args` 给这边挑中文。
 */
const KIND: Record<string, string> = {
  upstream: "上游",
  proxy: "代理",
  "price sheet": "价目表",
  route: "路由",
  rule: "规则",
  group: "策略组",
  "gateway key": "网关密钥",
  "redaction rule": "出站脱敏规则",
  "tool-call rule": "工具调用审查规则",
};

/** 自定义规则属于哪一道防护（`config.rule_*` 的 `what`） */
const RULE_LINE: Record<string, string> = {
  redaction: "出站脱敏",
  "tool-call": "工具调用审查",
};

/** 配置卡在哪一关（`config.rejected*` 的 `stage`） */
const STAGE: Record<string, string> = {
  syntax: "语法",
  schema: "字段",
  semantics: "语义",
};

/** 价目表里的哪一项价格（`pricing.sheet.bad_price` 的 `field`） */
const PRICE_FIELD: Record<string, string> = {
  "input price": "输入价格",
  "output price": "输出价格",
  "cache-read price": "缓存读取价格",
  "cache-write price (5 minutes)": "缓存写入价格（5 分钟）",
  "cache-write price (1 hour)": "缓存写入价格（1 小时）",
  "long-context input price": "长上下文输入价格",
  "long-context output price": "长上下文输出价格",
};

/**
 * core 用反引号括名字（`` `官方`, `中转` ``），中文界面里名字用「」、并列用顿号。
 * 只有名字的列表才这样换；夹着英文说明的引用列表（「rule `x` of route `y`」）原样显示。
 */
const names = (list: string | undefined): string => (list ?? "").replace(/`([^`]*)`/g, "「$1」").replace(/, /g, "、");

/**
 * 可选的前缀参数。**用 `in` 判断，不直接取值** —— 取一个不存在的参数会让整句
 * 退回英文，而这两个参数本来就可有可无：同一个码，有时带着上游名或规则名，
 * 有时不带（编辑对话框里就是正在改的那一个）。
 */
const inUpstream = (a: Args, s: string) => ("upstream" in a ? `上游「${a.upstream}」的凭据：${s}` : s);
const inRule = (a: Args, s: string) => ("rule" in a ? `规则「${a.rule}」：${s}` : s);

/**
 * 一条码怎么说成中文。
 *
 * **返回 `undefined` 就是「这句我说不出来」**，整句退回 core 给的英文。
 * 句子是用词拼出来的那几条（扫描发现）靠它：参数里的词不在词表里 ——
 * 用户自己写的扫描规则就是这种 —— 拼出来会是一句缺了半截的中文。
 */
type Say = (a: Args) => string | undefined;

const ZH: Record<string, Say> = {
  // ── l1：链路测速 ────────────────────────────────────────────────
  "l1.timeout": (a) => `${a.seconds} 秒内未完成`,
  "l1.unreachable": () => "无法连接该代理。",
  "l1.config.system_proxy": () =>
    "该上游使用系统代理，代理地址在建立连接时才由环境决定，链路测速无法测量。将代理配置为命名条目后即可测速。",
  "l1.config.proxy_undefined": (a) =>
    `上游「${a.upstream}」使用的代理「${a.proxy}」未在 proxies 中定义。`,
  "l1.config.proxy_password": (a) => `无法读取代理「${a.proxy}」的密码：${a.detail}`,
  "l1.config.bad_url": (a) => `接口地址不是合法的 URL：${a.detail}`,
  "l1.config.unsupported_scheme": (a) =>
    `接口地址使用了 ${a.scheme} 协议，仅支持 http 和 https。`,
  "l1.config.no_host": () => "接口地址中缺少主机名。",
  "l1.config.proxy_addr_form": () => "代理地址应写成 主机:端口 的形式。",
  "l1.config.proxy_addr_ipv6_form": () => "IPv6 代理地址应写成 [::1]:1080 的形式。",
  "l1.config.proxy_addr_ipv6_brackets": (a) =>
    `${a.addr} 中的 IPv6 地址需要加方括号，应写成 [${a.host}]:${a.port}。`,
  "l1.config.proxy_port_not_a_number": (a) => `端口「${a.port}」不是数字。`,
  "l1.dns.timeout": (a) => `解析 ${a.host} 超过 ${a.seconds} 秒未完成，DNS 服务器可能无法访问。`,
  "l1.dns.failed": (a) =>
    `无法解析 ${a.host}。请检查域名拼写；如果该地址需要经代理访问，请先配置代理。`,
  "l1.dns.no_records": (a) => `${a.host} 解析成功，但结果中没有地址。`,
  "l1.tcp.refused": (a) => `${a.addr} 拒绝连接，该端口上没有服务在监听。请检查地址和端口。`,
  "l1.tcp.timeout": (a) =>
    `连接 ${a.addr} 没有响应。请检查网络，或确认该地址是否需要经代理访问。`,
  "l1.tcp.unreachable": (a) => `无法访问 ${a.addr} 所在的网络，请检查本机网络。`,
  "l1.tcp.failed": (a) => `无法连接 ${a.addr}：${a.detail}`,
  // 读写失败按系统给的种类说；其余种类（`l1.io`）只有系统原话，不在表里
  "l1.io.refused": () => "连接被拒绝。",
  "l1.io.reset": () => "连接被对端重置。",
  "l1.io.aborted": () => "连接被中止。",
  "l1.io.timed_out": () => "连接超时。",
  "l1.io.addr_not_available": () => "该地址在本机不可用。",
  "l1.io.not_found": () => "未找到目标。",
  "l1.io.permission_denied": () => "操作系统不允许该连接，可能被防火墙或网络权限设置阻止。",
  "l1.io.eof": () => "对端在响应前关闭了连接。",
  "l1.io.broken_pipe": () => "发送数据时对端关闭了连接。",
  "l1.io.host_unreachable": () => "无法访问该主机。",
  "l1.io.network_unreachable": () => "无法访问该网络，请检查本机网络。",
  "l1.tls.bad_hostname": (a) => `${a.host} 不是有效的 TLS 主机名。`,
  "l1.tls.failed": (a) => `TLS 握手失败：${a.detail}`,
  "l1.tls.cert_expired": (a) =>
    `证书验证未通过：${a.detail}。证书已过期或尚未生效，也可能是本机时间不准确，请先核对系统时间。`,
  "l1.tls.cert_untrusted_issuer": (a) =>
    `证书验证未通过：${a.detail}。证书的签发者不在系统信任列表中。如果本机安装了抓包工具或企业根证书，证书链可能已被替换。`,
  "l1.tls.cert_invalid": (a) =>
    `证书验证未通过：${a.detail}。如果网络中有抓包工具或企业代理拦截 TLS 连接，也会出现此错误。`,
  "l1.socks5.not_socks5": (a) =>
    `代理的响应不是 SOCKS5 协议（版本字节 ${a.byte}），该端口上可能是 HTTP 代理。`,
  "l1.socks5.auth_required": () => "代理要求用户名和密码认证，但该代理未配置认证信息。",
  "l1.socks5.credentials_too_long": () => "SOCKS5 的用户名和密码均不能超过 255 字节。",
  "l1.socks5.auth_rejected": () => "代理拒绝了用户名和密码。",
  "l1.socks5.no_acceptable_auth": () => "代理不接受所提供的认证方式。",
  "l1.socks5.unsupported_auth": (a) => `代理要求的认证方式 ${a.method} 不受支持。`,
  "l1.socks5.host_too_long": () => "域名超过 255 字节，无法通过 SOCKS5 发送。",
  "l1.socks5.unknown_address_type": (a) => `代理返回了无法识别的地址类型 ${a.kind}。`,
  "l1.socks5.general_failure": () => "代理内部错误。",
  "l1.socks5.not_allowed": () => "代理规则不允许连接该地址。",
  "l1.socks5.network_unreachable": () => "代理无法访问该网络。",
  "l1.socks5.host_unreachable": () => "代理无法访问该主机。",
  "l1.socks5.connection_refused": () => "目标拒绝连接。",
  "l1.socks5.ttl_expired": () => "TTL 已过期。",
  "l1.socks5.command_unsupported": () => "代理不支持 CONNECT。",
  "l1.socks5.address_type_unsupported": () => "代理不支持该地址类型。",
  "l1.socks5.rejected": (a) => `代理拒绝了连接（应答码 ${a.reply}）。`,
  "l1.http_proxy.headers_too_large": () =>
    "代理的响应头超过 8 KB，该端口上可能不是 HTTP 代理。",
  "l1.http_proxy.auth_required": () => "代理要求认证（HTTP 407），请检查用户名和密码。",
  "l1.http_proxy.unreadable_response": (a) => `代理返回了无法识别的响应：${a.line}`,
  "l1.http_proxy.connect_rejected": (a) =>
    `代理拒绝了 CONNECT 请求（HTTP ${a.status}）：${a.line}`,

  // ── l3：推理测速 ────────────────────────────────────────────────
  "l3.refused": (a) => `上游返回 ${a.status}：${a.detail}`,
  "l3.stream_failed": (a) => `上游在回答过程中报错：${a.detail}`,
  "l3.not_streamed": () => "上游没有以流式回答，无法测得首 token 时间。",

  // ── lite：桌面版自己说的。core 停了，没法再替那些请求说话 ─────────
  "lite.core_stopped": () => "core 在请求完成前停止运行，请求已中断。",

  // ── gw：网关的数据面。这些话同时发给 AI 客户端和界面 ──────────────
  "gw.internal": () => "请求被网关内部的错误中断。",
  "gw.auth.no_key": () =>
    "请求未携带网关密钥。请将 config.yaml 的 clients 中的网关密钥配置到客户端。",
  "gw.auth.key_invalid": () => "网关密钥无效。请检查客户端配置中的密钥与 config.yaml 是否一致。",
  "gw.auth.key_disabled": (a) => `网关密钥「${a.key}」已停用。在应用的密钥页启用它即可恢复。`,
  "gw.auth.source_not_allowed": (a) => `${a.peer} 不在允许的来源地址中。`,
  "gw.auth.source_not_allowed_hint": (a) =>
    `${a.peer} 不在允许的来源地址中。请修改 listen.gateway.allow_from，或将 bind 改为 loopback。`,
  "gw.config.no_upstreams": () =>
    "尚未配置任何上游。请在 ThinkWatch Lite 中添加上游，或在 config.yaml 的 providers 中添加。",
  "gw.config.proxy_undefined": (a) =>
    `上游「${a.upstream}」使用的代理「${a.proxy}」未在 proxies 中定义，内置选项只有 direct 和 system。`,
  "gw.config.proxy_password": (a) => `无法读取代理「${a.proxy}」的密码：${a.detail}`,
  "gw.config.proxy_unusable": (a) => `上游「${a.upstream}」的代理「${a.proxy}」不可用：${a.detail}`,
  "gw.config.http_client": (a) => `无法创建 HTTP 客户端：${a.detail}`,
  "gw.config.allow_from": (a) => `listen.gateway.allow_from：${a.detail}`,
  "gw.config.security_rules": (a) => `安全规则无法使用：${a.detail}`,
  "gw.credentials.failed": (a) => `无法获取上游「${a.upstream}」的凭据：${a.detail}`,
  "gw.model.unknown": (a) => `不存在模型 ${a.model}，可用模型请参见 GET /v1/models。`,
  "gw.model.no_upstream": (a) => `没有上游提供模型 ${a.model}，可用模型请参见 GET /v1/models。`,
  "gw.model.not_allowed": (a) =>
    `网关密钥「${a.key}」无权使用模型 ${a.model}，可用模型请参见 GET /v1/models。`,
  "gw.model.no_upstream_available": (a) => `没有可用的上游提供模型 ${a.model}：${a.detail}`,
  "gw.route.failed": (a) => `路由失败：${a.detail}`,
  "gw.route.rule_failed": (a) => `规则求值失败：${a.detail}`,
  "gw.route.denied": (a) => `规则「${a.rule}」拒绝了这个请求：${a.reason}`,
  "gw.route.no_upstream_alive": () => "没有可用的上游。",
  "gw.route.upstream_missing": (a) => `配置中不存在「${a.upstream}」。`,
  "gw.route.selected_upstream_missing": (a) =>
    `规则「${a.rule}」选中的上游「${a.upstream}」在配置中不存在。`,
  "gw.route.all_selected_disabled": (a) => `路由选中的上游均已停用：${a.detail}`,
  "gw.route.protocol_mismatch": (a) =>
    `${a.path} 只能由 ${a.wanted} 格式的上游处理，而上游「${a.upstream}」是 ${a.got} 格式。`,
  "gw.convert.failed": (a) => `无法转换为上游「${a.upstream}」的格式：${a.detail}`,
  "gw.request.body_too_large": (a) => `请求体大小为 ${a.size} 字节，超过上限 ${a.max} 字节。`,
  "gw.upstream.timeout": () => "上游响应超时。",
  "gw.upstream.unreachable": (a) =>
    `无法连接上游 ${a.url}，请检查接口地址、网络和代理设置。`,
  "gw.upstream.forward_failed": (a) => `转发失败：${a.detail}`,
  "gw.upstream.rate_limited": (a) => `上游「${a.upstream}」触发限流。`,
  "gw.upstream.status": (a) => `上游「${a.upstream}」返回 ${a.status}。`,
  "gw.toolcall.cut": (a) => {
    const r = toolRuleZh(a, a.why);
    return r && `上游「${a.upstream}」返回的 ${a.tool} 调用命中规则「${r.name}」${r.why}，已切断响应。`;
  },
  "gw.toolcall.blocked": (a) => {
    const r = toolRuleZh(a, a.why);
    return r && `上游「${a.upstream}」返回的 ${a.tool} 调用命中规则「${r.name}」${r.why}，整份响应已扣下。`;
  },
  "gw.ws.bad_url": (a) => `上游地址不是合法的 WebSocket 地址：${a.detail}`,
  "gw.ws.bad_header": (a) => `上游的请求头「${a.header}」包含请求头中不允许的字符。`,
  "gw.ws.connect_failed": (a) => `无法连接上游的 WebSocket：${a.detail}`,
  "gw.ws.send_failed": (a) => `向上游发送数据失败：${a.detail}`,
  "gw.ws.upstream_broke": (a) => `上游连接中断：${a.detail}`,
  "gw.ws.proxy_unsupported": (a) =>
    `上游「${a.upstream}」配置了代理（${a.proxy}），WebSocket 连接暂不支持经代理转发，仅支持直连的上游。`,
  "gw.ws.toolcall_cut": (a) => {
    const r = toolRuleZh(a, a.detail);
    return r && `上游「${a.upstream}」返回的 ${a.tool} 调用命中规则「${r.name}」${r.why}，已切断连接。`;
  },

  // ── control：控制面的 HTTP 错误 ──────────────────────────────────
  "control.upstream_not_found": (a) => `未找到名为「${a.upstream}」的上游。`,
  "control.proxy_not_found": (a) => `未找到名为「${a.proxy}」的代理。`,
  "control.route_not_found": (a) => `未找到名为「${a.route}」的路由。`,
  "control.sheet_not_found": (a) => `未找到名为「${a.sheet}」的价目表。`,
  "control.key_not_found": (a) => `未找到名为「${a.key}」的网关密钥。`,
  "control.listen.bad_port": () => "端口须在 1 到 65535 之间。",

  // ── gw.listen：网关换监听地址 ────────────────────────────────────
  "gw.listen.port_taken": (a) => `${a.addr} 已被其他程序占用。`,
  "gw.listen.addr_unavailable": (a) => `${a.addr} 当前不是本机的地址。`,
  "gw.listen.denied": (a) => `系统不允许监听 ${a.addr}，1024 以下的端口需要管理员权限。`,
  "gw.listen.bind_failed": (a) => `无法监听 ${a.addr}：${a.detail}`,
  "gw.listen.no_such_nic": (a) => `本机没有名为 ${a.name} 的网卡，现有网卡：${a.available}。`,
  "gw.listen.nic_no_addr": (a) => `网卡 ${a.name} 当前没有地址，请检查网线或 Wi-Fi 连接。`,
  "control.request_not_found": (a) => `未找到第 ${a.id} 号请求。`,

  // ── security：安全页的规则与档位 ──────────────────────────────────
  "security.unknown_guard": (a) => `「${a.guard}」不是一项防护，只能是 redact 或 inspect_tools。`,
  "security.unknown_mode": (a) => `「${a.mode}」不是一个档位，只能是 off、observe 或 enforce。`,
  "security.unknown_rule": (a) => `没有名为「${a.rule}」的内置规则。`,
  "security.rule_name_empty": () => "规则需要一个名称。",
  "security.bad_pattern": (a) => `正则表达式有误：${a.detail}`,
  "security.unknown_action": (a) => `「${a.action}」不是一种处置，只能是 cut 或 record。`,
  "security.no_action": () => "出站脱敏规则不单独设处置，命中后的处理由档位决定。",
  "control.session_not_found": (a) => `未找到会话 ${a.id}。`,
  "control.client_unknown": (a) => `未知的客户端「${a.client}」。`,
  "control.store_off": () => "请求记录未启动。",
  "control.store_unavailable": () =>
    "请求记录不可用，数据库无法打开或磁盘出错，转发不受影响。",
  "control.no_keys": () => "config.yaml 中尚无网关密钥，请先创建网关密钥，再接管客户端。",
  "control.key_create_failed": (a) => `无法创建网关密钥：${a.detail}`,
  "control.key_bind_failed": (a) => `无法记录密钥归属：${a.detail}`,
  "control.name_empty": (a) => {
    const kind = word(KIND, a.kind);
    return kind && `${kind}名称不能为空。`;
  },
  "control.name_whitespace": (a) => {
    const kind = word(KIND, a.kind);
    return kind && `${kind}名称首尾不能包含空白。`;
  },
  "control.name_reserved": (a) => {
    const kind = word(KIND, a.kind);
    return kind && `${kind}名称不能以 ${a.prefix} 开头，该前缀保留给内置项。`;
  },
  "control.name_is_builtin": (a) => `「${a.name}」是内置选项的名称，请使用其他名称。`,
  "control.unsupported_value": (a) => `${a.kind}「${a.value}」不受支持。`,
  "control.unsupported_action": (a) => `不支持的操作「${a.action}」。`,
  "control.shutdown": () => "网关正在关闭。",
  "control.base_url_empty": () => "接口地址不能为空。",
  "control.api_key_empty": () => "API 密钥不能为空。",
  "control.user_empty": () => "用户名不能为空。",
  "control.pass_has_expansion": () => "密码中不能包含 ${。",
  "control.header_no_value": (a) => `请求头「${a.header}」缺少值。`,
  "control.proxy_addr_form": (a) => `代理地址「${a.addr}」应写成 主机:端口 的形式。`,
  "control.dryrun_needs_target": () => "请指定网关密钥或路由。",
  "control.credentials_failed": (a) => `无法获取上游「${a.upstream}」的凭据：${a.detail}`,
  "control.request_body_gone": (a) => `第 ${a.id} 号请求的请求体已不存在，可能已被清理。`,
  "control.response_body_gone": (a) => `第 ${a.id} 号请求的响应体已不存在，可能已被清理。`,
  "control.request_body_truncated": (a) =>
    `第 ${a.id} 号请求的请求体有 ${a.original} 字节，仅保存了 ${a.kept} 字节，无法原样重放。`,
  "control.unknown_signin_mode": (a) => `不支持的登录方式「${a.mode}」。`,
  "control.unknown_account_family": (a) => `「${a.family}」不是可登录的账号类型。`,
  "control.signin_response_unusable": (a) => `无法开始登录：${a.detail}`,
  "control.device_code_unavailable": () => "这个账号还不能用设备码登录，请改用在这台电脑上登录。",
  "control.device_code_failed": (a) => `换设备码时返回 ${a.status}：${a.detail}`,
  "control.callback_ports_busy": (a) =>
    `登录回调端口 ${a.ports} 均被占用。如果 Codex 正在登录，请先完成或关闭它。`,
  "control.redirect_must_be_app_scheme": () =>
    "登录完成后的跳转地址只能使用应用自己的协议，不能是网页地址。",
  "control.name_taken_not_chatgpt": (a) =>
    `已有名为「${a.name}」的上游，且不是 ChatGPT 账号上游，请使用其他名称。`,
  "control.name_taken_not_zai": (a) =>
    `已有名为「${a.name}」的上游，且不是该服务的账号上游，请使用其他名称。`,
  "control.not_a_chatgpt_account": (a) => `上游「${a.upstream}」不是 ChatGPT 账号上游。`,
  "control.signin_gone": () => "没有这次登录，或者它已被新的登录替代。",
  "control.chatgpt_backend_status": (a) => `ChatGPT 后端返回 ${a.status}：${a.detail}`,
  "control.chatgpt_backend_not_json": () => "ChatGPT 后端的响应不是 JSON。",
  "control.chatgpt_backend_unreachable": (a) => `无法连接 ChatGPT 后端：${a.detail}`,
  "control.reset_cards_unreadable": (a) => `无法识别重置卡清单：${a.detail}`,
  "control.reset_card_result_unreadable": () => "无法识别使用重置卡的结果。",
  "control.bad_idempotency_key": () => "幂等键不能为空，且不超过 128 个字符。",
  "control.device_code_unreadable": (a) => `无法识别设备码请求的响应：${a.detail}`,
  "control.account_service_status": (a) => `账号服务返回 ${a.status}：${a.detail}`,
  "control.account_service_not_json": (a) => `账号服务的响应不是 JSON：${a.detail}`,
  "control.account_service_refused": (a) => `账号服务拒绝了请求：${a.why}`,
  "control.unauthorized": () =>
    "控制面需要启动时生成的令牌。桌面版会自动携带；自行编写的客户端需从配置目录中的 control.token 读取。",
  "control.internal_error": (a) => `网关内部出错：${a.detail}`,
  "control.records_unreadable": (a) => `无法读取请求记录：${a.detail}`,
  "control.listen.bind_invalid": (a) =>
    `bind 只能是 loopback、all、网卡名（如 en0）或地址（如 192.168.1.5），当前为 ${a.bind}。`,

  // ── control：改配置时的失败 ────────────────────────────────────────
  "control.config_stale": (a) =>
    `版本不一致：本次修改基于 ${a.base}，当前版本为 ${a.current}。请刷新后重新修改。`,
  "control.no_such_version": (a) => `版本历史中没有 ${a.version}。`,
  "control.patch.no_entry": (a) =>
    `${a.path} 中没有名为「${a.name}」的条目。列表条目按名称或序号查找。`,
  "control.patch.not_an_entry": (a) =>
    `${a.path} 没有指向列表中的某一项。删除时需指明条目，例如 /clients/codex。`,
  "control.default_key_cannot_disable": () =>
    "默认密钥不能停用。所有未单独接入网关的客户端都使用它，停用会使这些客户端全部无法使用。",
  "control.default_key_cannot_delete": () =>
    "默认密钥不能删除。所有未单独接入网关的客户端都使用它，删除后这些客户端将无法连接。",
  "control.disabled_key_cannot_be_default": (a) => `网关密钥「${a.key}」已停用，不能设为默认密钥。`,
  "control.key_used_by_client": (a) =>
    `${a.client} 已接管到网关，其配置中使用了该密钥。请先还原该客户端，再删除密钥。`,
  // 引用列表是 core 拼的英文说明（「rule `x` of route `y`」），原样显示
  "control.key_in_use": (a) => `网关密钥「${a.key}」仍被 ${a.refs} 引用，请先移除这些引用再删除。`,
  "control.upstream_in_use": (a) =>
    `上游「${a.upstream}」仍被 ${a.refs} 引用，请先移除这些引用再删除。`,
  "control.group_in_use": (a) => `策略组「${a.group}」仍被 ${a.refs} 引用，请先移除这些引用再删除。`,
  "control.proxy_in_use": (a) =>
    `代理「${a.proxy}」仍被上游${names(a.upstreams)}使用，请先解除关联再删除。`,
  "control.sheet_in_use": (a) =>
    `价目表「${a.sheet}」仍被上游${names(a.upstreams)}使用，请先解除关联再删除。`,
  "control.default_route_cannot_delete": (a) =>
    `路由「${a.route}」是默认路由，不能删除。请先将其他路由设为默认路由。`,
  "control.reassign_to_deleted_route": (a) => `网关密钥不能改用正在删除的路由「${a.route}」。`,
  "control.unknown_probe_class": (a) => `没有「${a.class}」这一类辅助请求。`,
  "control.builtin_group_fixed": () => "每个上游的内置策略组随上游列表自动生成，不能编辑或删除。",
  "control.route.duplicate_rule": (a) => `路由中有两条名为「${a.rule}」的规则。`,
  "control.rule.condition_no_value": (a) => `规则「${a.rule}」：条件 ${a.field} 没有值。`,
  "control.rule.condition_one_value": (a) => `规则「${a.rule}」：条件 ${a.field} 只能有一个值。`,
  "control.rule.condition_twice": (a) => `规则「${a.rule}」：条件 ${a.field} 出现了两次。`,
  "control.rule.condition_not_bool": (a) =>
    `规则「${a.rule}」：条件 ${a.field} 只能是 true 或 false，当前为「${a.value}」。`,
  "control.rule.no_such_key": (a) => `规则「${a.rule}」：不存在网关密钥「${a.key}」。`,
  "control.rule.unknown_dialect": (a) => `规则「${a.rule}」：不支持客户端格式「${a.dialect}」。`,
  "control.rule.no_such_probe_class": (a) =>
    `规则「${a.rule}」：没有「${a.class}」这一类辅助请求。`,
  "control.rule.no_such_upstream": (a) => `规则「${a.rule}」：不存在上游「${a.upstream}」。`,
  "control.rule.unknown_condition": (a) => `规则「${a.rule}」：不支持条件 ${a.field}。`,
  "control.rule.deny_needs_reason": (a) => `规则「${a.rule}」：拒绝时需要填写原因。`,
  "control.rule.forward_and_deny": (a) => `规则「${a.rule}」不能同时转发和拒绝。`,
  "control.group.name_is_upstream": (a) =>
    `「${a.name}」已是上游的名称。规则按名称指向上游或策略组，两者不能同名。`,
  "control.group.unknown_strategy": (a) => `不支持策略「${a.strategy}」。`,
  "control.group.no_such_upstream": (a) => `不存在上游「${a.upstream}」。`,
  "control.group.upstream_twice": (a) => `上游「${a.upstream}」重复。`,
  "control.group.empty": () => "策略组至少需要一个上游。",
  "control.group.preferred_not_member": (a) => `优先使用的上游「${a.upstream}」不在该策略组中。`,

  // ── control.pricing：刷新默认价目表 ──────────────────────────────
  "control.pricing.unreachable": (a) => `无法连接价格数据源：${a.detail}`,
  "control.pricing.status": (a) => `价格数据源返回 HTTP ${a.status}。`,
  "control.pricing.broke_off": (a) => `下载中断：${a.detail}`,
  "control.pricing.too_large": (a) => `下载的文件超过 ${a.mb} MB，不是价格数据。`,
  "control.pricing.not_a_dataset": (a) => `下载的内容不是价格数据：${a.detail}`,
  "control.pricing.save_failed": (a) => `无法保存价目表：${a.detail}`,

  // ── config：配置文件的读写与校验 ─────────────────────────────────
  //
  // 语法和字段错误的原话是 serde 的英文，这边只翻外面那一层（哪一关、第几行）
  "config.rejected": (a) => {
    const stage = word(STAGE, a.stage);
    return stage && `配置有${stage}错误：${a.detail}`;
  },
  "config.rejected_at": (a) => {
    const stage = word(STAGE, a.stage);
    return stage && `配置第 ${a.line} 行有${stage}错误：${a.detail}`;
  },
  "config.schema_too_new": (a) =>
    `配置的格式版本为 ${a.found}，当前 twcore 最高支持 ${a.supported}。请升级应用，或将配置改回旧格式。`,
  "config.no_clients": () =>
    "配置的 clients 中没有网关密钥，所有请求都会被拒绝。首次启动时会自动生成一把。",
  "config.duplicate_upstream": (a) =>
    `上游名称「${a.upstream}」重复。路由规则按名称引用上游，名称必须唯一。`,
  "config.duplicate_key_name": (a) => `网关密钥名称「${a.key}」重复。`,
  "config.duplicate_key_value": (a) =>
    `网关密钥「${a.key}」和「${a.other}」的值相同。网关按密钥区分客户端，密钥的值必须唯一。`,
  "config.default_key_missing": (a) => `default_key 指向的网关密钥「${a.key}」不存在。`,
  "config.default_key_disabled": (a) =>
    `默认网关密钥「${a.key}」已停用。所有未单独接入网关的客户端都使用它，停用会使这些客户端全部无法使用。`,
  "config.duplicate_client_key": (a) =>
    `网关密钥「${a.key}」和「${a.other}」都标记为客户端 ${a.client} 专用，一个客户端只能有一把。`,
  "config.bad_base_url": (a) => `上游「${a.upstream}」的接口地址既不是 http 也不是 https：${a.url}`,
  "config.empty_key": (a) => `网关密钥「${a.key}」的值为空。`,
  "config.zero_concurrency": (a) =>
    `网关密钥「${a.key}」的 max_concurrent 为 0，使用它的请求会一直等待。不限制并发时请删除 max_concurrent。`,
  "config.name_collision": (a) =>
    `「${a.name}」同时是上游和策略组的名称，规则的 to 无法区分指的是哪一个。请重命名其中一个。`,
  "config.bad_allow_from": (a) =>
    `listen.gateway.allow_from 中的 ${a.entry} 不是有效的 IP 地址或 CIDR，应写成 192.168.0.0/16 的形式。`,
  "config.unknown_price_sheet": (a) => `上游「${a.upstream}」使用的价目表「${a.sheet}」不存在。`,
  "config.empty_models_only": (a) =>
    `上游「${a.upstream}」的模型范围（models_only）为空，不提供任何模型。暂停使用该上游请改为停用（disabled: true）。`,
  "config.blank_models_only": (a) => `上游「${a.upstream}」的模型范围（models_only）中有空白项。`,
  "config.reserved_name": (a) => {
    const kind = word(KIND, a.what);
    return kind && `${kind}名称「${a.name}」以 __ 开头，该前缀保留给内置项，请使用其他名称。`;
  },
  "config.rule_name_empty": (a) => {
    const line = word(RULE_LINE, a.what);
    return line && `有一条自定义${line}规则没有名称。`;
  },
  "config.rule_name_taken": (a) => {
    const line = word(RULE_LINE, a.what);
    return line && `自定义${line}规则名称「${a.name}」重复。`;
  },
  "config.rule_pattern_empty": (a) => {
    const line = word(RULE_LINE, a.what);
    return line && `自定义${line}规则「${a.name}」的正则表达式为空。`;
  },
  "config.rule_pattern_bad": (a) => {
    const line = word(RULE_LINE, a.what);
    return line && `自定义${line}规则「${a.name}」的正则表达式有误：${a.detail}`;
  },
  "config.unknown_rule": (a) => `security.${a.guard} 中的「${a.rule}」不是内置规则。`,
  "config.store.read_failed": (a) => `无法读取 ${a.path}：${a.detail}`,
  "config.store.missing": (a) => `${a.path} 不存在。`,
  "config.store.conflict": (a) =>
    `配置文件在此期间已被修改（当前版本 ${a.current}，本次修改基于 ${a.expected}），未覆盖。请查看当前内容后重试。`,
  "config.edit.name_taken": (a) => {
    const kind = word(KIND, a.what);
    return kind && `已存在名为「${a.name}」的${kind}。`;
  },
  "config.edit.not_found": (a) => {
    const kind = word(KIND, a.what);
    return kind && `未找到名为「${a.name}」的${kind}。`;
  },
  "config.edit.nameless": (a) => {
    const kind = word(KIND, a.what);
    return kind && `${kind}没有名称。`;
  },
  "config.edit.multiline": () => "值中不能包含换行。",
  "config.edit.parse": (a) => `无法解析配置文件：${a.detail}`,
  "config.edit.unwritable": (a) => `该值无法写入配置：${a.detail}`,
  "config.edit.self_check": (a) => `修改结果与预期不符（${a.detail}），未写入任何内容。`,

  // ── config.credential：上游凭据的写法 ────────────────────────────
  //
  // 整份配置校验时多带一个 `upstream`（是哪个上游），编辑对话框里不带
  "config.credential.empty_key": (a) => inUpstream(a, "API 密钥为空。"),
  "config.credential.key_and_oauth": (a) => inUpstream(a, "key 和 oauth 只能填写其中一项。"),
  "config.credential.empty_oauth": (a) => inUpstream(a, "oauth 的 refresh 和 endpoint 都不能为空。"),
  "config.credential.claude_subscription": (a) =>
    inUpstream(a, "不支持 Claude 订阅账号的登录凭据，请使用 Anthropic API 密钥。"),
  "config.credential.google_subscription": (a) =>
    inUpstream(a, "不支持 Gemini CLI 的 Google 登录凭据，请使用 Gemini API 密钥。"),
  "config.credential.chatgpt_without_login": (a) =>
    inUpstream(a, "ChatGPT 账号上游只接受登录获得的凭据。"),
  "config.credential.identity_header": (a) =>
    inUpstream(a, `请求头「${a.header}」如实说明请求的来源，由网关发送，不能在配置中设置。`),
  "config.credential.too_many_headers": (a) => inUpstream(a, `请求头最多 ${a.max} 个。`),
  "config.credential.bad_header_name": (a) =>
    inUpstream(
      a,
      `请求头名称「${a.header}」无效：只能包含字母、数字和 - _ . ~，且不超过 ${a.max} 个字符。`,
    ),
  "config.credential.reserved_header": (a) =>
    inUpstream(a, `请求头「${a.header}」由网关管理，不能在配置中设置。`),
  "config.credential.duplicate_header": (a) =>
    inUpstream(a, `请求头「${a.header}」重复（请求头名称不区分大小写）。`),
  "config.credential.bad_header_value": (a) =>
    inUpstream(a, `请求头「${a.header}」的值不能包含换行，且不超过 ${a.max} 个字符。`),
  "config.credential.unknown_placeholder": (a) =>
    inUpstream(
      a,
      `请求头「${a.header}」中的 ${a.placeholder} 无法识别，只支持 {{access_token}} 和 {{client}}。`,
    ),
  "config.credential.token_without_oauth": (a) =>
    inUpstream(a, `请求头「${a.header}」使用了 {{access_token}}，但该上游未配置 oauth。`),
  "config.credential.key_and_auth_header": (a) =>
    inUpstream(
      a,
      `已填写 key，API 密钥会通过请求头「${a.header}」发送，不能再在请求头中设置「${a.header}」。`,
    ),
  "config.credential.oauth_and_auth_header": (a) =>
    inUpstream(
      a,
      `配置 oauth 后，令牌默认通过请求头「${a.header}」发送。如需自行设置该请求头，请用 {{access_token}} 标明令牌的位置。`,
    ),
  "config.credential.no_token": (a) => inUpstream(a, "无法获取 OAuth 访问令牌。"),

  // ── yaml：按字段改配置文件 ───────────────────────────────────────
  "yaml.parse": (a) => `无法解析 YAML：${a.detail}`,
  "yaml.not_found": (a) => `配置中找不到 ${a.path}。`,
  "yaml.not_scalar": (a) => `${a.path} 不是标量，只有标量可以就地修改。`,
  "yaml.self_check": (a) => `修改结果未通过自检，未写入任何内容：${a.detail}`,
  "yaml.duplicate": (a) => `${a.path} 在配置中出现了多次，修改可能不会生效。请先手动删除重复项。`,
  "yaml.block_scalar": (a) =>
    `${a.path} 是多行块（| 或 >），无法自动修改，请直接编辑配置文件。`,
  "yaml.anchor_or_alias": (a) =>
    `${a.path} 位于 YAML 锚点或别名（&x / *x）中，修改会影响所有引用处，请直接编辑配置文件。`,

  // ── engine：路由规则本身的问题 ───────────────────────────────────
  "engine.no_match": () => "没有规则命中，且没有兜底规则。请在末尾添加一条不带条件的规则。",
  "engine.phase_two_with_to": (a) =>
    `规则「${a.rule}」同时设置了 provider_would_be 和 to。provider_would_be 要在选定上游之后才能判断，这类规则只能使用 set 或 deny。`,
  "engine.no_action": (a) => `规则「${a.rule}」没有设置 to、deny 或 set，命中后不起作用。`,
  "engine.unknown_target": (a) =>
    `规则「${a.rule}」指向的「${a.target}」既不是上游也不是策略组。`,
  "engine.empty_group": (a) => `策略组「${a.group}」中没有上游。`,
  "engine.duplicate_group": (a) =>
    `策略组名称「${a.group}」重复。规则按名称引用策略组，名称必须唯一。`,
  "engine.duplicate_route": (a) =>
    `路由名称「${a.route}」重复。网关密钥按名称绑定路由，名称必须唯一。`,
  "engine.unknown_default_route": (a) =>
    `default_route 指向的路由「${a.route}」不存在，未绑定路由的网关密钥将无法命中任何规则。`,
  "engine.unknown_route": (a) => `网关密钥「${a.key}」绑定的路由「${a.route}」不存在。`,
  // 比较式写错。在路由编辑对话框里多带一个 `rule`（是哪条规则）
  "engine.compare.empty": (a) => inRule(a, `条件 ${a.field} 写法有误：比较式为空。`),
  "engine.compare.no_operator": (a) =>
    inRule(
      a,
      `条件 ${a.field} 写法有误：「${a.value}」缺少比较符，应以 > < >= <= = 之一开头，例如 ">200k"。`,
    ),
  "engine.compare.bad_number": (a) =>
    inRule(a, `条件 ${a.field} 写法有误：无法解析「${a.value}」中的数字。`),
  "engine.compare.bad_unit": (a) =>
    inRule(
      a,
      `条件 ${a.field} 写法有误：无法识别「${a.value}」中的单位。支持 k（千）和 m（百万），金额写成 $2.5 的形式。`,
    ),

  // ── pricing.sheet：价目表的写法 ──────────────────────────────────
  "pricing.sheet.empty_name": () => "价目表没有名称。",
  "pricing.sheet.padded_name": (a) => `价目表名称「${a.sheet}」首尾不能包含空白。`,
  "pricing.sheet.duplicate_name": (a) => `价目表名称「${a.sheet}」重复。`,
  "pricing.sheet.bad_multiplier": (a) => `价目表「${a.sheet}」的倍率 ${a.value} 无效，倍率须大于 0。`,
  "pricing.sheet.empty_model": (a) => `价目表「${a.sheet}」中有模型没有名称。`,
  "pricing.sheet.bad_price": (a) => {
    const field = word(PRICE_FIELD, a.field);
    return field && `价目表「${a.sheet}」中模型 ${a.model} 的${field}为 ${a.value}，价格不能为负数。`;
  },
  "pricing.sheet.half_long_context": (a) =>
    `价目表「${a.sheet}」中的模型 ${a.model} 需要同时填写长上下文输入价格和输出价格，或者都不填。`,

  // ── scan：静态扫描发现了什么 ────────────────────────────────────
  //
  // 句子由「哪一类文件」和「命中了什么」两个词拼出来，两张词表在上面。
  // 词表里没有那个词就整句退回英文 —— 用户自定义的规则走的正是这条路。
  "scan.hidden": (a) => {
    const src = word(SOURCE_KIND, a.kind);
    const what = word(HIDDEN_KIND, a.what);
    if (!src || !what) return undefined;
    return `${spaced(src.label)}中含有${what.split("：")[0]}`;
  },
  "scan.hidden.detail": (a) => {
    const src = word(SOURCE_KIND, a.kind);
    const what = word(HIDDEN_KIND, a.what);
    if (!src || !what) return undefined;
    return `${what}${src.why}`;
  },
  "scan.mcp.remote": (a) => `MCP server「${a.name}」位于远端`,
  "scan.mcp.remote.detail": (a) =>
    `该 server 的地址为 ${a.url}，使用时相关上下文会发送到该服务器。`,
  "scan.rule": (a) => {
    const src = word(SOURCE_KIND, a.kind);
    const name = ruleNameZh(a.rule);
    if (!src || !name) return undefined;
    return `${spaced(src.label)}中命中规则「${name}」`;
  },
  "scan.rule.detail": (a) => {
    const src = word(SOURCE_KIND, a.kind);
    const why = word(RULE_WHY, a.rule);
    if (!src || !why) return undefined;
    return `${why}。${src.why}`;
  },
  "scan.skill.all_tools": (a) => `skill「${a.name}」声明了 allowed-tools: ["*"]`,
  "scan.skill.all_tools.detail": () =>
    "该 skill 可以使用任何工具。这可能是正常需要，建议确认是否确实需要此权限。",

  // ── adopt.cost：接管这个客户端要付出什么 ────────────────────────
  "adopt.cost.claude_code.remote_control": () =>
    "接口地址不是官方域名时，Remote Control 和语音输入不可用。",
  "adopt.cost.claude_code.mcp_tool_search": () => "MCP tool search 将默认关闭。",
  "adopt.cost.claude_code.welcome_screen": () =>
    "Claude Code 可能会显示一次欢迎页，关闭即可。",
  "adopt.cost.codex.model_list": () =>
    "Codex 不从网关获取模型列表，自定义模型名无效，模型列表以本地的模型目录文件为准。",
  "adopt.cost.codex.chatgpt_desktop": () =>
    "ChatGPT 桌面版读取同一份配置文件，其本地 Codex 会话也会一并接管，重新启动该应用后生效。",
  "adopt.cost.codex.reopen_terminal": () => "修改后需要重新打开终端。",
  "adopt.cost.opencode.restart": () => "修改后需要重新启动 opencode。",
  "adopt.cost.zed.key_store": () =>
    "Zed 的密钥不保存在配置文件中，需要在 Zed 的设置界面中手动填写一次。",
  "adopt.cost.aider.lookup_order": () =>
    "Aider 依次读取主目录、Git 项目根目录和当前目录中的配置，后读取的会覆盖先读取的，接管只修改主目录中的配置。",
  "adopt.cost.aider.restart": () => "修改后需要重新启动 Aider。",

  // ── adopt.diag：接管为什么没生效 ────────────────────────────────
  "adopt.diag.not_running": (a) => `${a.client} 当前未运行`,
  "adopt.diag.not_running.detail": () => "下次启动时将读取新配置。",
  "adopt.diag.started_before": (a) => `${a.client} 的进程启动于接管之前`,
  "adopt.diag.started_before.detail": (a) => {
    const note = word(TAKES_EFFECT, a.takes_effect);
    if (!note) return undefined;
    return `有 ${a.count} 个进程在接管之前启动，仍在使用旧配置。${note}`;
  },
  "adopt.diag.restart": (a) => `退出 ${a.client} 后重新打开`,
  "adopt.diag.started_after": (a) => `${a.client} 在接管之后启动`,
  "adopt.diag.started_after.detail": () => "已读取新配置。",
  "adopt.diag.not_adopted": () => "尚未接管该客户端",
  "adopt.diag.not_adopted.detail": (a) => `${a.path} 中没有接管记录。`,
  "adopt.diag.no_shadow": () => "没有优先级更高的配置文件",
  "adopt.diag.no_shadow.none": () => "该客户端没有优先级更高的配置文件。",
  "adopt.diag.no_shadow.absent": (a) => `${a.files} 不存在。`,
  "adopt.diag.shadowed": (a) => `${a.path} 的优先级高于接管写入的配置`,
  "adopt.diag.shadowed.no_fields": () => "该文件存在，但不包含相关字段。",
  "adopt.diag.shadowed.fields": (a) => `该文件中包含 ${a.fields}，会覆盖接管写入的设置。`,
  "adopt.diag.look_at_fields": (a) => `检查 ${a.path} 中的相关字段`,
  "adopt.diag.project_config": () => "当前项目中有同名配置文件",
  "adopt.diag.project_config.detail": (a) => `${a.path} 会覆盖用户级配置。`,
  "adopt.diag.look_at": (a) => `检查 ${a.path}`,
  "adopt.diag.managed": () => "本机存在管理策略文件",
  "adopt.diag.managed.detail": (a) =>
    `${a.path} 的优先级高于其他所有配置，包括用户配置。`,
  "adopt.diag.no_managed": () => "本机没有管理策略文件",
  "adopt.diag.no_managed.detail": () => "不存在优先级高于其他所有配置的管理策略文件。",
  "adopt.diag.no_exports": () => "shell 配置中没有同名环境变量",
  "adopt.diag.no_exports.detail": () => "已检查 .zshrc、.zprofile、.bashrc 等文件。",
  "adopt.diag.shell_export": (a) => `${a.path} 第 ${a.line} 行导出了 ${a.name}`,
  "adopt.diag.shell_export.harmless": (a) =>
    `不影响 ${a.client}（其配置文件优先级更高），但会影响读取环境变量的其他客户端。`,
  "adopt.diag.shell_export.overrides": (a) =>
    `${a.client} 读取环境变量，该行会覆盖接管写入的配置。`,
  // 一条命令，两种语言里是同一串字符
  "adopt.diag.delete_line": (a) => `sed -i '' '${a.line}d' ${a.path}`,
  // Windows 上同名变量在注册表里：没有文件，也没有行号
  "adopt.diag.registry_env": (a) => `注册表 ${a.key} 中设置了 ${a.name}`,
  "adopt.diag.registry_env.overrides": (a) =>
    `${a.client} 读取环境变量，该变量会覆盖接管写入的配置。`,
  "adopt.diag.no_registry_env": () => "没有同名的环境变量",
  "adopt.diag.no_registry_env.detail": () => "已检查用户和系统两级环境变量。",
  "adopt.diag.unset_env": (a) =>
    `reg delete "${a.root}\\${a.key}" /v ${a.name} /f（执行后重新打开终端）`,
  "adopt.diag.unset_env_machine": (a) =>
    `reg delete "${a.root}\\${a.key}" /v ${a.name} /f（需要以管理员身份打开终端）`,
  "adopt.diag.fields_gone": () => "接管写入的字段已不在配置中",
  "adopt.diag.fields_gone.detail": (a) =>
    `${a.path} 中未找到接管写入的接口地址，可能已被其他工具修改。`,
  "adopt.diag.adopt_again": () => "重新接管该客户端",
  "adopt.diag.endpoint_ok": () => "配置中的接口地址与接管时一致",
  "adopt.diag.endpoint_ok.detail": (a) => `当前指向 ${a.endpoint}。`,
  "adopt.diag.static_only": () => "以上均为静态检查",
  "adopt.diag.static_only.detail": () =>
    "静态检查无法确认配置已实际生效。收到该客户端的真实请求后，才能确认接管已生效。",

  // ── adopt.manual：手动配置的步骤 ────────────────────────────────
  // 地址和密钥不在句子里：界面各给一个复制按钮，句子只说填到哪儿
  "adopt.manual.file": (a) => `打开 ${a.file}，写入下面几项。`,
  "adopt.manual.zed.key": () => "然后在 Zed 的设置中，为 ThinkWatch 填入密钥。",
  "adopt.manual.cursor.open": () => "在 Cursor 中打开 Settings → Models。",
  "adopt.manual.cursor.base": () => "开启 Override OpenAI Base URL，填入网关地址。",
  "adopt.manual.cursor.key": () => "在 OpenAI API Key 中填入密钥，然后点击 Verify。",
  "adopt.manual.cursor.caveat": () =>
    "Tab 补全与 inline edit 仍由 Cursor 自身的服务处理，不经过网关，因此只能部分接管。",
  "adopt.manual.continue.open": () => "打开 ~/.continue/config.yaml。",
  "adopt.manual.continue.open_windows": () => "打开 %USERPROFILE%\\.continue\\config.yaml。",
  "adopt.manual.continue.entry": () =>
    "在 models 列表中新增一项：provider 设为 openai，apiBase 设为网关地址，apiKey 设为密钥。",
  "adopt.manual.continue.caveat": () =>
    "接入需要在 models 列表中新增条目，不提供自动接管，请按上述步骤手动配置。",
  "adopt.manual.gemini_cli.export": () =>
    "在 shell 配置文件中导出 GOOGLE_GEMINI_BASE_URL（网关地址）和 GEMINI_API_KEY（密钥）。",
  // Windows 上没有 shell 配置文件可 export，用户级环境变量用 setx 写
  "adopt.manual.gemini_cli.setx": () =>
    "在终端中运行 setx GOOGLE_GEMINI_BASE_URL，后接网关地址；再运行 setx GEMINI_API_KEY，后接密钥。",
  "adopt.manual.gemini_cli.reopen": () => "然后重新打开终端。",
  "adopt.manual.gemini_cli.caveat": () =>
    "Gemini CLI 只从环境变量读取接口地址。ThinkWatch 不修改 shell 配置文件，请手动添加。",
  "adopt.manual.gemini_cli.caveat_windows": () =>
    "Gemini CLI 只从环境变量读取接口地址。ThinkWatch 不修改环境变量，请手动添加。",

  // ── adopt.mcp：这份 MCP 配置为什么写不了 ────────────────────────
  "adopt.mcp.unverified_format": () =>
    "该客户端的 MCP 配置格式尚未验证，写入可能导致客户端无法读取配置",
  "adopt.mcp.zed_structure": () =>
    "Zed 的 context server 使用不同的配置结构，不支持 command/args 形式",

  // ── adopt：接管和还原的说明 ─────────────────────────────────────
  "adopt.takes_effect": (a) => word(TAKES_EFFECT, a.takes_effect),
  "adopt.plan.fields_only": () =>
    "字段名已查证，尚未在本机实际运行验证。收到第一个请求之前，请勿视为已生效。",
  "adopt.plan.shadowed": (a) =>
    `检测到 ${a.paths}，其优先级高于接管写入的配置，其中的同名设置会覆盖接管的设置。`,
  "adopt.restore.config_gone": () => "配置文件已不存在，仅删除接管记录。",
  "adopt.restore.secret_lost": (a) =>
    `${a.field} 的原值是密钥，仅保存在全文备份中，而 ${a.backup} 已不存在。该字段已删除，需要手动重新填写。`,
  "adopt.restore.file_removed": () => "该文件在接管时新建，还原后内容为空，已一并删除。",
  "adopt.warn.symlink": (a) => `${a.path} 是符号链接，实际写入的文件为 ${a.real}。`,
  "adopt.warn.world_readable": (a) =>
    `${a.path} 的权限为 ${a.mode}，本机其他用户可以读取写入的密钥。可执行 chmod 600 ${a.path} 收紧权限。`,

  // ── adopt：接管、还原、搬 MCP 时的失败 ──────────────────────────
  "adopt.file.read_failed": (a) => `无法读取 ${a.path}：${a.detail}`,
  "adopt.file.write_failed": (a) => `无法写入 ${a.path}：${a.detail}`,
  "adopt.file.changed": (a) => `${a.path} 在确认之后被修改，未写入任何内容。请重新查看改动。`,
  "adopt.file.verify_failed": (a) => `修改后的内容未通过校验，未写入任何内容（${a.detail}）。`,
  "adopt.file.readback_mismatch": (a) => `写入后读回的内容与预期不符，已从备份还原：${a.path}`,
  "adopt.file.link_loop": (a) => `符号链接层数过多：${a.path}`,
  "adopt.plan.read_failed": (a) => `无法读取 ${a.client} 的配置 ${a.path}：${a.detail}`,
  "adopt.plan.parse_failed": (a) => `无法解析 ${a.client} 的配置，未做任何修改：${a.detail}`,
  "adopt.plan.foreign_record": (a) =>
    `${a.path} 旁的接管记录属于 ${a.other}，而不是 ${a.client}，未做任何修改。`,
  "adopt.plan.no_record": (a) =>
    `没有 ${a.client} 的接管记录，无法还原。如需手动还原，请查看 ${a.path}。`,
  "adopt.mcp.unknown_client": (a) => `未知的客户端「${a.client}」。`,
  "adopt.mcp.parse_failed": (a) => `无法解析 ${a.client} 的 MCP 配置，未做任何修改：${a.detail}`,
  "adopt.mcp.not_there": (a) => `${a.client} 中没有名为「${a.name}」的 MCP server。`,
  "adopt.mcp.not_copyable": (a) => `${a.client} 的 MCP 配置格式尚未验证，不会写入。`,
};

/**
 * 内置扫描规则命中之后那一句「为什么」。
 *
 * **它不是 `Msg`，是一个规则 id 加一句话** —— 工具调用防火墙的事件里带
 * 的就是这两样。内置规则查表说中文；用户自己加的规则查不到，那句话本来
 * 就是他自己写的，原样显示。
 */
export function ruleWhy(rule: string, text: string): string {
  if (getLang() === "en") return text;
  return word(RULE_WHY, rule) ?? text;
}

/**
 * 一句没有码的话，包成 [`Msg`]。
 *
 * **给的是退路，不是常规写法。**界面自己造的失败（invoke 抛了别的东西、
 * 连不上 socket）没有码，但它们要能和 core 发来的那些放在同一个字段里。
 */
export function plain(text: string): Msg {
  return { code: "", text };
}

/**
 * 一条 core 消息在界面上怎么说。
 *
 * 传字符串进来也行：控制面之外的错误（连不上 socket 之类）本来就是
 * 一句现成的话。
 */
export function coreText(m: Msg | string | null | undefined): string {
  if (m == null) return "";
  if (typeof m === "string") return m;
  if (getLang() === "en") return m.text;
  const say = ZH[m.code];
  if (!say) return m.text;
  // **少一个参数就整句退回英文。**core 改了参数名而这张表还没跟上时，
  // 中文那句会缺一块（或者更糟，写出一个「undefined」）；一句完整的
  // 英文比一句缺了主语的中文好。
  const args = m.args ?? {};
  let missing = false;
  const seen = new Proxy(args, {
    get(t, k: string) {
      if (k in t) return t[k];
      missing = true;
      return "";
    },
  });
  const zh = say(seen);
  return missing || zh === undefined ? m.text : zh;
}

/**
 * invoke 抛出来的东西变成一句话。
 *
 * **Tauri 的 invoke 用字符串 reject，不是 Error。**控制面的错误是一个
 * JSON 的 [`Msg`]（core 那边的 `Fail`），别的错误就是一句现成的话 ——
 * 先按 JSON 试一次，不是就原样用。
 */
export function errorText(e: unknown): string {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const t = raw.trimStart();
  if (!t.startsWith("{")) return raw;
  try {
    const v = JSON.parse(t) as Partial<Msg>;
    if (typeof v?.code === "string" && typeof v?.text === "string") {
      return coreText(v as Msg);
    }
  } catch {
    // 不是 JSON：那它本来就是一句话
  }
  return raw;
}
