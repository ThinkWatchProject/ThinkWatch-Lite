import type { ReactNode } from "react";
import { messages } from "@/i18n";
import type { SecurityOutcome } from "@/types";

/** 英文句中的「Since 9/8」要小写开头 */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const securityPageText = messages(
  {
    /** 和源列表里那一项同一个词 */
    title: "安全",
    log: "日志",
    /** 页头上几项防护各在哪一档：「2 项拦截」 */
    modes: {
      enforce: "项拦截",
      observe: "项观察",
      off: "项关闭",
    },
    /**
     * 页头上日志那段时间里一共命中了几次。`count` 是条数（英文按它分单复数），
     * `n` 是画好的数字。自定义区间的名字本身是「9/8 至今」，不再加「内」
     */
    hits: (_count: number, n: ReactNode, range: string, custom: boolean) => (
      <>
        {custom ? range : `${range}内`} {n} 次命中
      </>
    ),
    /** 页头上各做了什么：「1 已切断」。和日志「处置」一栏同一组词 */
    outcomes: {
      cut: "已切断",
      blocked: "已拒绝",
      replaced: "已替换",
      recorded: "仅记录",
    } satisfies Record<SecurityOutcome, string>,
    /** 标签上的名字。和源列表、规则表里的名字一致 */
    tabs: {
      redact: "出站脱敏",
      inspect_tools: "工具调用审查",
      hidden_text: "隐藏字符",
      content: "内容过滤",
      output_limit: "输出长度",
    },
    loadFailed: "安全设置读取失败",
    /** 撤销提示 */
    ruleOn: (name: string) => `已启用「${name}」`,
    ruleOff: (name: string) => `已停用「${name}」`,
    modeSet: (guard: string, mode: string) => `${guard}已切换到「${mode}」`,
    ruleCreated: (name: string) => `已创建规则「${name}」`,
  },
  {
    title: "Security",
    log: "Log",
    modes: {
      enforce: "enforcing",
      observe: "observing",
      off: "off",
    },
    hits: (count: number, n: ReactNode, range: string, custom: boolean) => (
      <>
        {n} {count === 1 ? "match" : "matches"} {custom ? lower(range) : `in the last ${range}`}
      </>
    ),
    outcomes: {
      cut: "cut off",
      blocked: "refused",
      replaced: "replaced",
      recorded: "recorded",
    },
    // 英文名长，标签用短名；全名在每一项的档位那一块上
    tabs: {
      redact: "Redaction",
      inspect_tools: "Tool calls",
      hidden_text: "Hidden text",
      content: "Content",
      output_limit: "Output limit",
    },
    loadFailed: "The security settings could not be loaded",
    ruleOn: (name: string) => `“${name}” turned on`,
    ruleOff: (name: string) => `“${name}” turned off`,
    modeSet: (guard: string, mode: string) => `${guard} set to ${mode}`,
    ruleCreated: (name: string) => `Rule “${name}” created`,
  },
);
