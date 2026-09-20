import type { Msg } from "@/types";
import { getLang } from "./index";

/**
 * core 发来的那些码，中文怎么说。
 *
 * **只有中文一份，没有英文那一份。**core 给的 `text` 已经是英文了 ——
 * 再在这里抄一份英文，core 一改措辞两边就对不上，而那份抄本没有任何
 * 东西在守着它。所以英文界面直接用 `text`，这张表只回答一个问题：
 * 「这句话中文怎么说」。
 *
 * **码不在表里就显示 `text`。**三种情况都会走到这条退路，而且都该走：
 * core 比界面新、这条记录是加码之前落的库、或者这条消息只是把更深一层
 * 的原话原样带出来（`{detail}` 那一类，翻它没有意义）。
 *
 * 码的写法和 core 一致：点分小写，第一段是发出它的那一层（`l1` 是链路
 * 测速，`gw` 是网关的数据面，`control` 是控制面）。
 */
type Args = Record<string, string>;

const ZH: Record<string, (a: Args) => string> = {
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

  // ── gw：网关的数据面。这些话同时发给 AI 客户端和界面 ──────────────
  "gw.internal": () => "请求被网关内部的错误中断。",
  "gw.overloaded": (a) => a.detail ?? "",
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
  "gw.toolcall.cut": (a) =>
    `上游「${a.upstream}」（非官方端点）返回的 ${a.tool} 调用命中规则「${a.rule}」（${a.why}），已切断响应。`,
  "gw.ws.bad_url": (a) => `上游地址不是合法的 WebSocket 地址：${a.detail}`,
  "gw.ws.bad_header": (a) => `上游的请求头「${a.header}」包含请求头中不允许的字符。`,
  "gw.ws.connect_failed": (a) => `无法连接上游的 WebSocket：${a.detail}`,
  "gw.ws.send_failed": (a) => `向上游发送数据失败：${a.detail}`,
  "gw.ws.upstream_broke": (a) => `上游连接中断：${a.detail}`,
  "gw.ws.proxy_unsupported": (a) =>
    `上游「${a.upstream}」配置了代理（${a.proxy}），WebSocket 连接暂不支持经代理转发，仅支持直连的上游。`,
  "gw.ws.toolcall_cut": (a) =>
    `上游「${a.upstream}」（非官方端点）返回的 ${a.tool} 调用命中规则「${a.rule}」（${a.detail}），已切断连接。`,

  // ── control：控制面的 HTTP 错误 ──────────────────────────────────
  "control.upstream_not_found": (a) => `未找到名为「${a.upstream}」的上游。`,
  "control.proxy_not_found": (a) => `未找到名为「${a.proxy}」的代理。`,
  "control.route_not_found": (a) => `未找到名为「${a.route}」的路由。`,
  "control.sheet_not_found": (a) => `未找到名为「${a.sheet}」的价目表。`,
  "control.key_not_found": (a) => `未找到名为「${a.key}」的网关密钥。`,
  "control.request_not_found": (a) => `未找到第 ${a.id} 号请求。`,
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
};

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
  return missing ? m.text : zh;
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
