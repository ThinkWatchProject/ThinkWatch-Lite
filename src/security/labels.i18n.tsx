import type { ReactNode } from "react";
import { messages } from "@/i18n";
// 规则名、防护名和 core 消息的中文是同一张表（Rust 写系统通知时也读它）
import CORE_ZH from "@/i18n/core.zh.json";
import type { SavedSourceKind } from "@/types";

/** 句子里要按代码样式画的那一段。怎么画由组件决定，这里只管是哪几个字 */
type Code = (text: string) => ReactNode;

/** 卡组织在中文里的名字。只有银联有通行的中文名，别家照写英文 */
const CARD_NETWORK_ZH: Record<string, string> = { UnionPay: "银联" };

const or = (xs: ReactNode[], sep: ReactNode, last: ReactNode) =>
  xs.flatMap((x, i) => (i === 0 ? [x] : [i === xs.length - 1 ? last : sep, x]));

/**
 * 各项防护共用的名称：状态、动作、类别、规则名，以及内置规则的匹配判据。
 *
 * **规则名只收内置的。**自定义规则的名字就是用户起的，原样显示；表里没有
 * 的，退回 core 给的英文名或 id。
 *
 * **三种状态各项一样**：开启、监控、关闭（配置里是 `enforce` / `observe` / `off`）。
 */
export const securityLabelsText = messages(
  {
    guards: CORE_ZH.tables.guard,
    /** 日志「类型」一栏，短一点 */
    guardShort: {
      redact: "密钥与隐私",
      inspect_tools: "危险命令",
      content: "内容过滤",
    },
    /** 一项防护的三种状态，各项一样 */
    modes: {
      enforce: "开启",
      observe: "监控",
      off: "关闭",
    },
    /** 防护处于「监控」时，规则的动作后面那一句：实际只记录 */
    monitoring: "监控中",
    /** 日志里每一条做了什么 */
    actions: {
      recorded: "仅记录",
      replaced: "已替换",
      cut: "已切断",
      stripped: "已删除",
      blocked: "已拒绝",
    } as Record<string, string>,
    /** 规则在「开启」状态下做什么 */
    ruleActions: {
      placeholder: "替换为占位符",
      cut: "切断",
      block: "拒绝",
      strip: "删除",
      replace: "替换",
      record: "仅记录",
    } as Record<string, string>,
    /** 规则表的分组。密钥与隐私的按 core 给的顺序排，保存的密钥在最前 */
    kinds: {
      saved: "保存的密钥",
      "ai-services": "AI 服务",
      "dev-platforms": "代码托管与软件发布",
      cloud: "云服务与基础设施",
      business: "支付、通信与协作",
      "private-keys": "私钥",
      jwt: "JWT",
      "conn-strings": "连接串",
      "in-context": "固定位置的凭据",
      crypto: "加密货币",
      "id-documents": "证件号码",
      "foreign-ids": "境外证件号码",
      financial: "金融账户",
      contact: "联系方式",
      location: "住址与位置",
      vehicle: "车辆",
      device: "设备与网络标识",
      "labeled-personal": "带字段名的个人信息",
      internal: "内网地址",
      command: "内置",
      injection: "指令覆盖",
      persona: "身份与提示词",
      chinese: "中文说法",
      invisible: "隐藏字符",
      custom: "自定义",
    } as Record<string, string>,
    custom: "自定义",
    /** 命中处在工具结果里（日志的 `tool` 是 `tool_result`） */
    toolResult: "工具结果",
    /** 命中的一处在请求（或回答）的哪一段。消息按第几条数，从 1 数 */
    parts: {
      system: "系统提示",
      message: (n: number) => `第 ${n} 条消息`,
      tool_result: "工具结果",
      tool_call: "工具调用",
      response_text: "回答 · 正文",
    },
    /** 消息的角色，按客户端写的查；表里没有的照写 */
    roles: {
      user: "用户",
      assistant: "助手",
      tool: "工具",
      system: "系统",
      developer: "开发者",
    } as Record<string, string>,
    /** 命中在请求里还是回答里 */
    directions: {
      request: "请求",
      response: "回答",
    },
    /** 内容规则怎么认（规则快照、导出） */
    matching: {
      contains: "包含",
      regex: "正则",
      codepoints: "码位",
    },
    caseSensitive: "区分大小写",
    /** 日志按天分组时，一天的标题 */
    day: {
      today: "今天",
      yesterday: "昨天",
    },
    /**
     * 「ThinkWatch 中保存的密钥」命中的是哪一处配置里的值。**只写是哪一处，不写值的任何部分**
     * （日志一条的第二行、流量页徽标的提示、导出）
     */
    savedSource: {
      "upstream-key": (name: string) => `上游「${name}」的密钥`,
      "upstream-header": (name: string) => `上游「${name}」请求头中的值`,
      "access-key": (name: string) => `网关密钥「${name}」`,
      "proxy-password": (name: string) => `代理「${name}」的密码`,
      "control-key": () => "远程控制密钥",
      "sync-credential": () => "同步与备份凭据",
    } as Record<SavedSourceKind, (name: string) => string>,
    /** 日志一条的第二行 */
    detail: {
      /** 出站脱敏：同一个值在一个请求里出现了几次；内容过滤：这条规则命中了几处 */
      times: (n: number) => `出现 ${n} 次`,
      /** 码位规则命中标签字符时，解出来的原文 */
      revealed: (text: string) => `隐藏内容「${text}」`,
      /** 码位规则：命中了几个字符 */
      chars: (n: number) => `共 ${n.toLocaleString()} 个字符`,
    },
    /** 内容过滤的内置规则 */
    contentRules: CORE_ZH.tables.content_rule as Record<string, string>,
    /**
     * 内置扫描规则的名字。工具调用审查用其中的危险命令一组；MCP 页的扫描
     * 发现两组都用（提示注入那一组只查客户端配置，不查工具调用）。
     */
    rules: CORE_ZH.tables.scan_rule as Record<string, string>,
    matcher: {
      prefix: (code: Code, prefix: string, n: number) => (
        <>
          {code(prefix)} 开头，其后至少 {n} 个字符
        </>
      ),
      openaiLegacy: (code: Code, n: number) => (
        <>
          {code("sk-")} 开头，全长至少 {n} 个字符，同时含字母和数字
        </>
      ),
      pem: (code: Code) => <>{code("-----BEGIN … PRIVATE KEY-----")} 至对应的 END，整段</>,
      jwt: (code: Code) => <>三段 base64url，首段解码后含 {code('"alg"')}</>,
      connString: (code: Code) => <>{code("协议://用户:口令@主机")} 中的口令，只换口令</>,
      /** 多前缀：尾部要求相同的几个前缀合成一段，各段用 `sep` 连起来 */
      prefixes: (code: Code, prefixes: string[], n: number, tail: string) => (
        <>
          {or(prefixes.map(code), "、", "、")} 开头，其后至少 {n} 个{tail}
        </>
      ),
      prefixesSep: "；",
      /** 尾部允许的字符 */
      tails: {
        any: "字符",
        hex: "十六进制字符",
        alnum: "字母或数字",
      } as Record<string, string>,
      saved:
        "按值识别 ThinkWatch 中保存的密钥，与格式无关：上游密钥与请求头中的值、网关密钥、代理密码、远程控制密钥、同步与备份凭据。不足 12 个字符的值不识别",
      assignment: (code: Code, suffixes: string[]) => (
        <>
          {code(".env")}、YAML、TOML、INI、JSON 中变量名以 {or(suffixes.map(code), "、", "、")} 结尾（不区分大小写）、值为至少 8
          个字符的字面量的赋值；只换值，表达式、变量引用和占位写法不算
        </>
      ),
      labeled: (code: Code, names: string[]) => (
        <>
          字段名为 {or(names.map(code), "、", "、")} 的值，包括 {code("字段名: 值")}、{code('"字段名": "值"')} 与表格表头的写法；只换值
        </>
      ),
      privateIp: (code: Code) => (
        <>
          {code("10.")}、{code("172.16–31.")}、{code("192.168.")}、{code("100.64–127.")} 开头的地址与 {code("fc00::/7")} 内的
          IPv6 地址，不含 127.0.0.1
        </>
      ),
      domainSuffix: (code: Code, suffixes: string[]) => (
        <>以 {or(suffixes.map(code), "、", "、")} 结尾的域名</>
      ),
      cnResidentId: (bornSince: number) => (
        <>
          18 位居民身份证号（含港澳台居民居住证、外国人永久居留身份证）：地区码、{bornSince} 年以来的出生日期和校验码都对得上
        </>
      ),
      /** 卡组织的名字按英文名查，查不到的照写 */
      bankCard: (networks: string[]) => (
        <>{or(networks.map((n) => CARD_NETWORK_ZH[n] ?? n), "、", "、")} 的卡号：号段、位数对得上并通过 Luhn 校验；公开的测试卡号除外</>
      ),
      email: (code: Code) => <>邮箱地址：{code("名称@域名")}</>,
      /**
       * 代码里做的检查（`builtin`），按检查名说它查什么。出站脱敏里按校验位、词表、位置认的
       * 那些，检查名就是规则 id；按位置认的写明只换哪一段
       */
      builtin: {
        "credential-to-network": () => "凭据发往本机和该凭据的服务商以外的主机",
        "file-to-network": () => "本地文件的内容上传到外部主机",
        "thinkwatch-data": () => "路径或命令指向 ThinkWatch 的数据目录；只是提到不算",
        // ---- 凭据
        "zhipu-api-key": (code: Code) => <>32 个十六进制字符、{code(".")} 与 16 个字母或数字相连</>,
        "qianfan-api-key": (code: Code) => (
          <>
            {code("bce-v3/ALTAK-")} 开头，其后为 21 个字母或数字、{code("/")} 与 40 个十六进制字符，整段
          </>
        ),
        "sk-compat-key": (code: Code) => (
          <>{code("sk-")} 开头，其后恰为 32 个字母和数字（两者都有），或恰为 48 个小写字母</>
        ),
        "azure-ad-client-secret": (code: Code) => <>3 个字符、1 位数字与 {code("Q~")}，其后 31 至 34 个字符</>,
        "terraform-token": (code: Code) => <>14 个字母或数字与 {code(".atlasv1.")}，其后 60 至 70 个字符</>,
        "auth-header-credential": (code: Code) => (
          <>
            {or(["Authorization", "X-Api-Key", "Api-Key", "X-Goog-Api-Key"].map(code), "、", "、")}{" "}
            请求头的值，包括 curl 的 {code("-H")}、HTTP 原文与代码中的写法；只换值
          </>
        ),
        "command-line-password": (code: Code) => (
          <>
            命令行中的口令：{code("curl -u 用户:口令")}、{code("--user")}、{code("mysql -p口令")}、{code("PGPASSWORD=… psql")}
            ；只换口令
          </>
        ),
        "url-token": (code: Code) => (
          <>
            URL 查询参数{" "}
            {or(
              ["access_token", "api_key", "apikey", "client_secret", "sig", "X-Amz-Signature", "X-Goog-Signature"].map(code),
              "、",
              "、",
            )}{" "}
            的值；只换参数值
          </>
        ),
        "bot-webhook": () => "飞书 / Lark、钉钉、企业微信、Slack、Discord、Microsoft Teams 机器人 Webhook 地址中的令牌；只换令牌段",
        "telegram-bot-token": (code: Code) => <>8 至 10 位数字与 {code(":AA")}，其后 33 个字符</>,
        "crypto-mnemonic": () =>
          "连续 12、15、18、21 或 24 个 BIP39 英文或简体中文词表中的词，并通过校验和；可带编号，整段",
        "crypto-wif-key": () => "51 或 52 个字符的 WIF 私钥：Base58Check 校验通过，版本字节对得上",
        "crypto-extended-key": (code: Code) => (
          <>{or(["xprv", "tprv", "yprv", "zprv"].map(code), "、", "、")} 开头，Base58Check 校验通过</>
        ),
        // ---- 个人信息
        "cn-resident-id-15": () => "15 位旧身份证号：地区码、6 位出生日期都对得上，其后 3 位顺序码",
        "passport-mrz": (code: Code) => (
          <>两行各 44 个字符、以 {code("P")} 开头，四处校验位与综合校验位都对得上；整段</>
        ),
        "cn-passport": (code: Code) => (
          <>
            {code("E")} 或 {code("E")} 加一个字母开头、其后 7 至 8 位数字，且前 20 个字符内出现「护照」或「passport」
          </>
        ),
        "hk-macau-taiwan-id": () => "香港、澳门、台湾身份证号：香港、台湾的校验码对得上；澳门的须前文写明证件名称",
        "mainland-travel-permit": (code: Code) => (
          <>
            港澳居民来往内地通行证（{code("H")} 或 {code("M")} 加 8 位数字）与台湾居民来往大陆通行证（8
            位数字），且前 20 个字符内出现「通行证」「回乡证」或「台胞证」
          </>
        ),
        "us-ssn": (code: Code) => <>{code("ddd-dd-dddd")} 写法的美国社会安全号，不会分配的区号、组号与序号除外</>,
        "uk-nino": () => "2 个字母、6 位数字与 A 至 D 之一组成的英国国民保险号，不会分配的字母组合除外",
        "sg-nric": () => "S、T、F、G 之一开头，7 位数字加校验字母，校验字母对得上",
        "kr-rrn": (code: Code) => <>6 位出生日期、{code("-")} 与 7 位数字，日期有效、第 8 位为 1 至 8</>,
        "jp-my-number": () => "12 位数字，校验位对得上，且前 20 个字符内出现「マイナンバー」「個人番号」或「My Number」",
        "in-aadhaar": () => "12 位数字（可四位一组），首位为 2 至 9，Verhoeff 校验通过",
        "br-cpf": (code: Code) => <>{code("ddd.ddd.ddd-dd")} 写法的巴西 CPF，两位校验码对得上</>,
        iban: () => "国家代码、两位校验码与该国规定位数的账号，MOD 97-10 校验通过；连写或四位一组",
        "cn-landline": (code: Code) => (
          <>
            {code("0")} 开头的 2 至 3 位区号加 7 至 8 位号码，区号有效，须带括号或连字符（{code("010-12345678")}、
            {code("(0755)1234567")}）
          </>
        ),
        "intl-phone": (code: Code) => <>{code("+")} 开头，国家码有效、位数与该国规定一致；可带空格与连字符</>,
        "cn-address": () => "行政区划名称、街道路巷村之一与门牌号（号、栋、单元、室）组成的中国大陆详细地址；只到区县的不算",
        "geo-coordinates": () => "成对出现、在取值范围内、小数不少于 5 位的纬度与经度",
        "cn-license-plate": () => "省份简称、字母与 5 位字母或数字（新能源车为 6 位），不含 I、O",
        vin: () => "17 个字符、不含 I、O、Q，第 9 位校验码对得上",
        imei: () => "15 位数字，Luhn 校验通过，且前 20 个字符内出现「IMEI」",
        "mac-address": (code: Code) => (
          <>6 组两位十六进制字符，以 {code(":")} 或 {code("-")} 分隔；全零、广播与组播地址除外</>
        ),
        "public-ip": () => "公网 IPv4、IPv6 地址；私有、回环、链路本地、运营商级 NAT、文档示例与组播地址除外",
      } as Record<string, (code: Code) => ReactNode>,
      /** 没见过的检查名 */
      builtinOther: "由内置检查判断",
      cnMobilePhone: (code: Code) => (
        <>
          中国大陆手机号：{code("1")} 开头的 11 位数字，第二位为 3 到 9，前后不紧挨其他数字；可带 {code("+86")}、
          {code("0086")}、{code("86-")} 前缀，可按 3-4-4 以空格或连字符分隔
        </>
      ),
      // 正则一般区分大小写，不区分的才说；包含两种都说
      regex: (code: Code, pattern: string, cased: boolean) => (
        <>
          正则 {code(pattern)}
          {!cased && "，不区分大小写"}
        </>
      ),
      contains: (code: Code, text: string, cased: boolean) => (
        <>
          包含 {code(text)}，{cased ? "区分大小写" : "不区分大小写"}
        </>
      ),
      codepoints: (code: Code, ranges: string[]) => <>码位 {or(ranges.map(code), "、", "、")}</>,
    },
  },
  {
    guards: {
      redact: "Secrets & privacy",
      inspect_tools: "Dangerous commands",
      content: "Content filter",
    },
    guardShort: {
      redact: "Secrets",
      inspect_tools: "Commands",
      content: "Content",
    },
    modes: {
      enforce: "On",
      observe: "Monitor",
      off: "Off",
    },
    monitoring: "Monitoring",
    actions: {
      recorded: "Recorded",
      replaced: "Replaced",
      cut: "Cut off",
      stripped: "Deleted",
      blocked: "Refused",
    },
    ruleActions: {
      placeholder: "Replace with placeholder",
      cut: "Cut off",
      block: "Refuse",
      strip: "Delete",
      replace: "Replace",
      record: "Record only",
    },
    kinds: {
      saved: "Saved credentials",
      "ai-services": "AI services",
      "dev-platforms": "Code hosting and publishing",
      cloud: "Cloud and infrastructure",
      business: "Payments, messaging and collaboration",
      "private-keys": "Private keys",
      jwt: "JWTs",
      "conn-strings": "Connection strings",
      "in-context": "Credentials by position",
      crypto: "Cryptocurrency",
      "id-documents": "ID documents",
      "foreign-ids": "Foreign ID numbers",
      financial: "Financial accounts",
      contact: "Contact details",
      location: "Addresses and locations",
      vehicle: "Vehicles",
      device: "Device and network identifiers",
      "labeled-personal": "Personal information by field name",
      internal: "Internal addresses",
      command: "Built-in",
      injection: "Instruction override",
      persona: "Identity and prompts",
      chinese: "Chinese phrasing",
      invisible: "Hidden characters",
      custom: "Custom",
    },
    custom: "Custom",
    toolResult: "tool result",
    parts: {
      system: "System prompt",
      message: (n: number) => `Message ${n}`,
      tool_result: "Tool result",
      tool_call: "Tool call",
      response_text: "Answer · text",
    },
    roles: {
      user: "User",
      assistant: "Assistant",
      tool: "Tool",
      system: "System",
      developer: "Developer",
    },
    directions: {
      request: "Request",
      response: "Answer",
    },
    matching: {
      contains: "Contains",
      regex: "Regex",
      codepoints: "Code points",
    },
    caseSensitive: "Matching case",
    day: {
      today: "Today",
      yesterday: "Yesterday",
    },
    savedSource: {
      "upstream-key": (name: string) => `Key of upstream “${name}”`,
      "upstream-header": (name: string) => `Header value of upstream “${name}”`,
      "access-key": (name: string) => `Gateway key “${name}”`,
      "proxy-password": (name: string) => `Password of proxy “${name}”`,
      "control-key": () => "Remote control key",
      "sync-credential": () => "Sync and backup credential",
    },
    detail: {
      times: (n: number) => `${n} times`,
      revealed: (text: string) => `hidden text “${text}”`,
      chars: (n: number) => (n === 1 ? "1 character" : `${n.toLocaleString()} characters`),
    },
    contentRules: {
      "unicode-tags": "Unicode tag characters",
      "bidi-controls": "Bidirectional controls",
      "zero-width": "Zero-width characters",
      "private-use": "Private-use characters",
      "ignore-previous-instructions": "Ignore previous instructions",
      "ignore-all-previous": "Ignore all previous",
      "disregard-your-instructions": "Disregard your instructions",
      jailbreak: "Jailbreak",
      dan: "DAN",
      "developer-mode": "Developer mode",
      "you-are-now": "Persona manipulation",
      "new-persona": "New persona",
      "act-as": "Act as",
      "pretend-to-be": "Pretend to be",
      "system-prompt": "System prompt extraction",
      "reveal-your-instructions": "Reveal instructions",
      "what-are-your-rules": "What are your rules",
      "base64-wall": "Base64 smuggling",
      "zh-ignore-previous": "Ignore previous instructions (Chinese)",
      "zh-forget-your": "Forget your instructions (Chinese)",
      "zh-do-not-follow": "Do not follow (Chinese)",
      "zh-you-are-now": "You are now (Chinese)",
      "zh-role-play": "Role-play (Chinese)",
      "zh-reveal-your": "Reveal your instructions (Chinese)",
      "zh-system-prompt": "System prompt (Chinese)",
      "zh-jailbreak": "Jailbreak (Chinese)",
    },
    rules: {
      "ignore-previous": "Ignore previous instructions",
      disregard: "Disregard the system prompt",
      "you-are-now": "Reset the model's identity",
      "ignore-previous-zh": "Ignore previous instructions (Chinese)",
      "new-instructions-zh": "New instructions (Chinese)",
      "you-are-now-zh": "Reset the model's identity (Chinese)",
      "chat-marker": "Forged chat markers",
      "fake-system": "Disguised system text",
      "curl-pipe-sh": "Download and run",
      "base64-decode-exec": "Decode and run",
      "exfil-env": "Send out environment variables",
      "exfil-credentials": "Send out a credential file",
      "exfil-credentials-reversed": "Send out a credential file (verb first)",
      "ssh-key-read": "Read a private key or cloud credential",
      "write-startup-item": "Write a startup item",
      "crontab-install": "Install a scheduled job",
      "rm-rf-root": "Delete home or root",
      "chmod-777": "World-writable permissions",
      "secret-to-unknown-host": "Send a credential to an unknown host",
      "thinkwatch-data": "Read or change ThinkWatch's own data",
      "upload-file-to-host": "Upload a local file to an external host",
    },
    matcher: {
      prefix: (code: Code, prefix: string, n: number) => (
        <>
          Starts with {code(prefix)}, followed by at least {n} characters
        </>
      ),
      openaiLegacy: (code: Code, n: number) => (
        <>
          Starts with {code("sk-")}, at least {n} characters, with both letters and digits
        </>
      ),
      pem: (code: Code) => <>From {code("-----BEGIN … PRIVATE KEY-----")} to its END, as a whole</>,
      jwt: (code: Code) => <>Three base64url parts; the first decodes to text containing {code('"alg"')}</>,
      connString: (code: Code) => <>Only the password in {code("scheme://user:password@host")}</>,
      prefixes: (code: Code, prefixes: string[], n: number, tail: string) => (
        <>
          Starts with {or(prefixes.map(code), ", ", " or ")}, followed by at least {n} {tail}
        </>
      ),
      prefixesSep: "; ",
      tails: {
        any: "characters",
        hex: "hex characters",
        alnum: "letters or digits",
      },
      saved:
        "Recognized by value, whatever the format: credentials saved in ThinkWatch, namely upstream keys and header values, gateway keys, proxy passwords, the remote control key, and sync and backup credentials. Values shorter than 12 characters are not matched",
      assignment: (code: Code, suffixes: string[]) => (
        <>
          Assignments in {code(".env")}, YAML, TOML, INI or JSON whose variable name ends in {or(suffixes.map(code), ", ", " or ")}{" "}
          (ignoring case) and whose value is a literal of at least 8 characters; only the value is replaced. Expressions,
          variable references and placeholders do not count
        </>
      ),
      labeled: (code: Code, names: string[]) => (
        <>
          The value of a field named {or(names.map(code), ", ", " or ")}, written as {code("name: value")},{" "}
          {code('"name": "value"')} or under a table header; only the value is replaced
        </>
      ),
      privateIp: (code: Code) => (
        <>
          Addresses starting with {code("10.")}, {code("172.16–31.")}, {code("192.168.")} or {code("100.64–127.")}, and IPv6
          addresses in {code("fc00::/7")}; not 127.0.0.1
        </>
      ),
      domainSuffix: (code: Code, suffixes: string[]) => (
        <>Domains ending in {or(suffixes.map(code), ", ", " or ")}</>
      ),
      cnResidentId: (bornSince: number) => (
        <>
          An 18-character resident ID number, including residence permits for Hong Kong, Macau and Taiwan residents and
          foreign permanent residence ID cards, whose region code, birth date since {bornSince} and check character all check
          out
        </>
      ),
      bankCard: (networks: string[]) => (
        <>A {or(networks, ", ", " or ")} card number whose prefix and length match and that passes the Luhn check; public test card numbers excepted</>
      ),
      email: (code: Code) => <>Email addresses: {code("name@domain")}</>,
      builtin: {
        "credential-to-network": () => "A credential sent to a host other than this machine and the credential's provider",
        "file-to-network": () => "The contents of a local file uploaded to an external host",
        "thinkwatch-data": () => "A path or command that points into ThinkWatch's data directory; a mention does not count",
        "zhipu-api-key": (code: Code) => <>32 hex characters, {code(".")} and 16 letters or digits, run together</>,
        "qianfan-api-key": (code: Code) => (
          <>
            Starts with {code("bce-v3/ALTAK-")}, followed by 21 letters or digits, {code("/")} and 40 hex characters, as a
            whole
          </>
        ),
        "sk-compat-key": (code: Code) => (
          <>
            Starts with {code("sk-")}, followed by exactly 32 letters and digits (both present) or exactly 48 lowercase letters
          </>
        ),
        "azure-ad-client-secret": (code: Code) => (
          <>Three characters, a digit and {code("Q~")}, followed by 31 to 34 characters</>
        ),
        "terraform-token": (code: Code) => (
          <>14 letters or digits and {code(".atlasv1.")}, followed by 60 to 70 characters</>
        ),
        "auth-header-credential": (code: Code) => (
          <>
            The value of an {or(["Authorization", "X-Api-Key", "Api-Key", "X-Goog-Api-Key"].map(code), ", ", " or ")} header,
            in curl {code("-H")}, raw HTTP or code; only the value is replaced
          </>
        ),
        "command-line-password": (code: Code) => (
          <>
            Passwords on a command line: {code("curl -u user:password")}, {code("--user")}, {code("mysql -ppassword")},{" "}
            {code("PGPASSWORD=… psql")}; only the password is replaced
          </>
        ),
        "url-token": (code: Code) => (
          <>
            The value of the URL query parameter{" "}
            {or(
              ["access_token", "api_key", "apikey", "client_secret", "sig", "X-Amz-Signature", "X-Goog-Signature"].map(code),
              ", ",
              " or ",
            )}
            ; only the parameter value is replaced
          </>
        ),
        "bot-webhook": () =>
          "The token in a Feishu / Lark, DingTalk, WeCom, Slack, Discord or Microsoft Teams bot webhook URL; only the token is replaced",
        "telegram-bot-token": (code: Code) => <>8 to 10 digits and {code(":AA")}, followed by 33 characters</>,
        "crypto-mnemonic": () =>
          "12, 15, 18, 21 or 24 consecutive words from the BIP39 English or Simplified Chinese word list that pass the checksum; numbering allowed, replaced as a whole",
        "crypto-wif-key": () => "A WIF private key of 51 or 52 characters that passes Base58Check with a valid version byte",
        "crypto-extended-key": (code: Code) => (
          <>Starts with {or(["xprv", "tprv", "yprv", "zprv"].map(code), ", ", " or ")} and passes Base58Check</>
        ),
        "cn-resident-id-15": () =>
          "A 15-digit legacy resident ID number with a valid region code and 6-digit birth date, followed by a 3-digit sequence",
        "passport-mrz": (code: Code) => (
          <>
            Two lines of 44 characters starting with {code("P")}, with all four check digits and the composite check digit
            correct; replaced as a whole
          </>
        ),
        "cn-passport": (code: Code) => (
          <>
            Starts with {code("E")}, or {code("E")} and a letter, followed by 7 or 8 digits, with “护照” or “passport” in the
            20 characters before it
          </>
        ),
        "hk-macau-taiwan-id": () =>
          "Hong Kong, Macau and Taiwan ID numbers: Hong Kong and Taiwan ones with a correct check character; Macau ones only when the document is named just before",
        "mainland-travel-permit": (code: Code) => (
          <>
            Mainland travel permits for Hong Kong and Macau residents ({code("H")} or {code("M")} and 8 digits) and for
            Taiwan residents (8 digits), with “通行证”, “回乡证” or “台胞证” in the 20 characters before it
          </>
        ),
        "us-ssn": (code: Code) => (
          <>A US Social Security number written as {code("ddd-dd-dddd")}, excluding area, group and serial numbers never issued</>
        ),
        "uk-nino": () =>
          "A UK National Insurance number: 2 letters, 6 digits and one of A to D, excluding letter pairs never issued",
        "sg-nric": () => "Starts with S, T, F or G, followed by 7 digits and a correct check letter",
        "kr-rrn": (code: Code) => (
          <>A 6-digit birth date, {code("-")} and 7 digits, with a valid date and an 8th digit from 1 to 8</>
        ),
        "jp-my-number": () =>
          "12 digits with a correct check digit, with “マイナンバー”, “個人番号” or “My Number” in the 20 characters before it",
        "in-aadhaar": () => "12 digits (optionally in groups of four), the first from 2 to 9, passing the Verhoeff check",
        "br-cpf": (code: Code) => <>A Brazilian CPF written as {code("ddd.ddd.ddd-dd")}, with both check digits correct</>,
        iban: () =>
          "A country code, two check digits and the account number length set for that country, passing MOD 97-10; written in one run or in groups of four",
        "cn-landline": (code: Code) => (
          <>
            A 2- or 3-digit area code starting with {code("0")} and a 7- or 8-digit number, with a valid area code and
            brackets or a hyphen ({code("010-12345678")}, {code("(0755)1234567")})
          </>
        ),
        "intl-phone": (code: Code) => (
          <>Starts with {code("+")}, with a valid country code and the length set for that country; spaces and hyphens allowed</>
        ),
        "cn-address": () =>
          "A Chinese mainland street address: administrative area names, a street, road, lane or village, and a house number; addresses that stop at the district do not count",
        "geo-coordinates": () => "A latitude and longitude pair within range, each with at least 5 decimal places",
        "cn-license-plate": () =>
          "A province abbreviation, a letter and 5 letters or digits (6 for new-energy vehicles), without I or O",
        vin: () => "17 characters without I, O or Q, with a correct check character in position 9",
        imei: () => "15 digits passing the Luhn check, with “IMEI” in the 20 characters before it",
        "mac-address": (code: Code) => (
          <>
            6 pairs of hex characters separated by {code(":")} or {code("-")}; all-zero, broadcast and multicast addresses
            excepted
          </>
        ),
        "public-ip": () =>
          "Public IPv4 and IPv6 addresses; private, loopback, link-local, carrier-grade NAT, documentation and multicast addresses excepted",
      },
      builtinOther: "Decided by a built-in check",
      cnMobilePhone: (code: Code) => (
        <>
          Chinese mainland mobile numbers: 11 digits starting with {code("1")}, the second 3 to 9, not run together with other
          digits; a {code("+86")}, {code("0086")} or {code("86-")} prefix and 3-4-4 groups separated by spaces or hyphens are
          allowed
        </>
      ),
      regex: (code: Code, pattern: string, cased: boolean) => (
        <>
          Regex {code(pattern)}
          {!cased && ", ignoring case"}
        </>
      ),
      contains: (code: Code, text: string, cased: boolean) => (
        <>
          Contains {code(text)}, {cased ? "matching case" : "ignoring case"}
        </>
      ),
      codepoints: (code: Code, ranges: string[]) => <>Code points {or(ranges.map(code), ", ", " and ")}</>,
    },
  },
);
