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
  "control.session_not_found": (a) => `未找到会话 ${a.id}。`,
  "control.client_unknown": (a) => `未知的客户端「${a.client}」。`,
  "control.store_off": () => "请求记录未启动。",
  "control.store_unavailable": () =>
    "请求记录不可用，数据库无法打开或磁盘出错，转发不受影响。",
  "control.no_keys": () => "config.yaml 中尚无网关密钥，请先创建网关密钥，再接管客户端。",
  "control.key_create_failed": (a) => `无法创建网关密钥：${a.detail}`,
  "control.key_bind_failed": (a) => `无法记录密钥归属：${a.detail}`,
  "control.name_empty": (a) => `${a.kind}名称不能为空。`,
  "control.name_whitespace": (a) => `${a.kind}名称首尾不能包含空白。`,
  "control.name_is_builtin": (a) => `「${a.name}」是内置选项的名称，请使用其他名称。`,
  "control.unsupported_value": (a) => `${a.kind}「${a.value}」不受支持。`,
  "control.unsupported_action": (a) => `不支持的操作「${a.action}」。`,
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
  "control.device_code_unavailable": () => "这个账号还不能用设备码登录，请改用在这台电脑上登录。",
  "control.device_code_failed": (a) => `换设备码时返回 ${a.status}：${a.detail}`,
  "control.callback_ports_busy": (a) =>
    `登录回调端口 ${a.ports} 均被占用。如果 Codex 正在登录，请先完成或关闭它。`,
  "control.redirect_must_be_app_scheme": () =>
    "登录完成后的跳转地址只能使用应用自己的协议，不能是网页地址。",
  "control.name_taken_not_chatgpt": (a) =>
    `已有名为「${a.name}」的上游，且不是 ChatGPT 账号上游，请使用其他名称。`,
  "control.not_a_chatgpt_account": (a) => `上游「${a.upstream}」不是 ChatGPT 账号上游。`,
  "control.signin_gone": () => "没有这次登录，或者它已被新的登录替代。",
  "control.chatgpt_backend_status": (a) => `ChatGPT 后端返回 ${a.status}：${a.detail}`,
  "control.chatgpt_backend_not_json": () => "ChatGPT 后端的响应不是 JSON。",
  "control.chatgpt_backend_unreachable": (a) => `无法连接 ChatGPT 后端：${a.detail}`,
  "control.reset_cards_unreadable": (a) => `无法识别重置卡清单：${a.detail}`,
  "control.reset_card_result_unreadable": () => "无法识别使用重置卡的结果。",
  "control.bad_idempotency_key": () => "幂等键不能为空，且不超过 128 个字符。",

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
  "adopt.manual.continue.entry": () =>
    "在 models 列表中新增一项：provider 设为 openai，apiBase 设为网关地址，apiKey 设为密钥。",
  "adopt.manual.continue.caveat": () =>
    "接入需要在 models 列表中新增条目，不提供自动接管，请按上述步骤手动配置。",
  "adopt.manual.gemini_cli.export": () =>
    "在 shell 配置文件中导出 GOOGLE_GEMINI_BASE_URL（网关地址）和 GEMINI_API_KEY（密钥）。",
  "adopt.manual.gemini_cli.reopen": () => "然后重新打开终端。",
  "adopt.manual.gemini_cli.caveat": () =>
    "Gemini CLI 只从环境变量读取接口地址。ThinkWatch 不修改 shell 配置文件，请手动添加。",

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
