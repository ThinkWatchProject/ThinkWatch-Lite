// ─── 临时类型：等 core 发版后删掉这个文件 ───
//
// 扩充脱敏规则（保存的密钥、按服务拆开的类别、多前缀 / 赋值 / 字段名几种判据，规则的中英文
// 名字、说明和分组名由 core 给）的 core 还没有发版，`src/generated/tw-api.ts` 是钉着的那一版
// 生成的，里面还没有这些类型。这里先按
// core 的接口约定手写一份，`src/types.ts` 用同名导出盖住生成的那几个；**只加不改**：每个
// 类型都是生成那一版的超集，生成的值照样能传进来。
//
// core 发版后换成生成的类型：
// 1. 照常升级钉着的 core 版本，重新生成 `src/generated/tw-api.ts`；
// 2. 删掉这个文件，以及 `src/types.ts` 里从它转出的那一行；`scripts/shots/mock/config.ts`
//    的 `SecurityDetail` 改回从 `@/types` 取；
// 3. `tsc --noEmit` 报出的地方（一般没有）按生成的类型改，跑一遍 vitest。
import type * as Gen from "@/generated/tw-api";

/** 出站脱敏找到的东西属于哪一类。顺序就是规则表分组的顺序（core 按它排好再给） */
export type SecretKind =
  | "saved"
  | "ai-services"
  | "dev-platforms"
  | "cloud"
  | "business"
  | "private-keys"
  | "jwt"
  | "conn-strings"
  | "in-context"
  | "crypto"
  | "id-documents"
  | "foreign-ids"
  | "financial"
  | "contact"
  | "location"
  | "vehicle"
  | "device"
  | "labeled-personal"
  | "internal"
  | "custom";

/** 保存的密钥是哪一处配置里的 */
export type SavedSourceKind =
  | "upstream-key"
  | "upstream-header"
  | "access-key"
  | "proxy-password"
  | "control-key"
  | "sync-credential";

/** 「ThinkWatch 中保存的密钥」命中的那一个值来自哪儿。**只有名字，没有值** */
export type SavedSource = {
  kind: SavedSourceKind;
  /** 上游名、网关密钥名、代理名……；远程控制密钥是空的 */
  name: string;
};

/** 多前缀判据里的一个前缀。`tail` 是尾部允许的字符：`any` / `hex` / `alnum` */
export type PrefixView = { prefix: string; min_tail: number; tail: string };

/** 一条规则按什么认：生成的那些，加上新的四种 */
export type Matcher =
  | Gen.Matcher
  | { kind: "prefixes"; prefixes: PrefixView[] }
  | { kind: "saved" }
  | { kind: "assignment"; suffixes: string[] }
  | { kind: "labeled"; names: string[] };

/** 出站脱敏找到的一项。保存的密钥带着来源，`masked` 是空的 */
export type SecretItem = Omit<Gen.SecretItem, "kind"> & {
  kind: SecretKind;
  source?: SavedSource | null;
};

/** 安全日志的一条。保存的密钥带着来源，`excerpt` 是空的 */
export type SecurityEventView = Gen.SecurityEventView & { source?: SavedSource | null };

/**
 * 规则表的一条。名字、说明由 core 给，中英文各一个字段：`name_zh`（内置规则都有）、
 * `why` / `why_zh`（危险命令、内容过滤的内置规则，规则名说不清的才有）、`about` /
 * `about_zh`（密钥与隐私的内置规则：认什么，反引号括起来的一段是代码）
 */
export type SecurityRuleView = Omit<Gen.SecurityRuleView, "matcher"> & {
  matcher: Matcher;
  name_zh?: string;
  why_zh?: string;
  about?: string;
  about_zh?: string;
};

/** 规则表的一个分组：规则的 `kind` 就是它的 `slug` */
export type SecurityKindView = { slug: string; name: string; name_zh: string };

/**
 * 一项防护的视图。`kinds` 是分组，按界面上的顺序、最后一组是 `custom`。生成的类型里它是
 * 必有的；这里写成可选，钉着的旧 core 不给
 */
export type GuardDetail = Omit<Gen.GuardDetail, "rules"> & {
  rules: SecurityRuleView[];
  kinds?: SecurityKindView[];
};

export type SecurityDetail = { redact: GuardDetail; inspect_tools: GuardDetail; content: GuardDetail };
