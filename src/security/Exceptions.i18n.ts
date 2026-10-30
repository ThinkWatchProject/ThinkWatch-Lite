import { messages } from "@/i18n";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** 密钥与隐私的例外值：规则表下方一节、添加、移出，以及安全日志里「列为例外」 */
export const exceptionsText = messages(
  {
    /** 节标题：「例外 · 3 个值」 */
    title: "例外",
    count: (n: number) => `${n} 个值`,
    /** 没有例外时这一节只有这一句和「添加例外」 */
    none: "无例外值。被误认的值可在安全日志中列为例外，或在此添加。",
    add: "添加例外",
    /** 满了：「添加例外」置灰，旁边写明原因 */
    full: (max: number) => `已达上限 ${max} 个`,
    value: "值",
    rule: "首次认出的规则",
    /** 确认对话框里的「规则」一行 */
    ruleLabel: "规则",
    addedAt: "加入时间",
    remove: "移出例外",
    removeFor: (masked: string) => `将 ${masked} 移出例外`,
    /** 手动加入的值没有规则 */
    noRule: "—",

    addTitle: "添加例外",
    addDesc: "此值今后在任何规则下都不替换，也不记录。",
    addLabel: "值",
    addPlaceholder: "粘贴要列为例外的值",
    addFailed: "未能添加",

    exceptTitle: "列为例外",
    exceptDesc: "此值今后不再替换，也不再记录。",
    exceptFailed: "未能列为例外",

    removeTitle: "移出例外",
    removeDesc: "此值今后照常替换并记录。",
    removeFailed: "未能移出",

    /** 日志、命中详情里的标签 */
    tag: "例外",
    /** 「测试…」里例外的值 */
    trial: "例外，不处理",
  },
  {
    title: "Exceptions",
    count: (n: number) => plural(n, "value", "values"),
    none: "No exceptions. A value matched by mistake can be listed as an exception from the security log, or added here.",
    add: "Add exception",
    full: (max: number) => `Limit of ${max} reached`,
    value: "Value",
    rule: "First found by",
    ruleLabel: "Rule",
    addedAt: "Added",
    remove: "Remove",
    removeFor: (masked: string) => `Remove ${masked} from the exceptions`,
    noRule: "—",

    addTitle: "Add exception",
    addDesc: "This value is no longer replaced or recorded under any rule.",
    addLabel: "Value",
    addPlaceholder: "Paste the value to except",
    addFailed: "Not added",

    exceptTitle: "List as exception",
    exceptDesc: "This value is no longer replaced or recorded.",
    exceptFailed: "Not listed as an exception",

    removeTitle: "Remove from exceptions",
    removeDesc: "This value is replaced and recorded again.",
    removeFailed: "Not removed",

    tag: "Exception",
    trial: "Exception, not handled",
  },
);
