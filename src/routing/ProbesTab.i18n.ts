import { messages } from "@/i18n";

export const probesTabText = messages(
  {
    intro:
      "客户端自动发起的辅助请求，不由用户操作触发，同样产生费用。这一层先过，剩下的才轮到规则。",
    intercept: "本地应答",
    interceptWhat: "由网关直接应答，不发送到上游，不产生费用。",
    passthrough: "原样放行",
    passthroughWhat: "作为普通请求转发，按上游计费方式产生费用。",
    routed: "交给路由",
    routedWhat: "按「路由」标签里的规则转发，可分流至费用更低的上游。",
    /** 从「本地应答」改成「交给路由」时说清代价 */
    nowCosts: "改为交给路由后，这一类请求将发送到上游并产生费用。",
    ruleHint: "规则里的「辅助请求」条件只对设为「交给路由」的类别成立。",
  },
  {
    intro:
      "Auxiliary requests that clients send on their own, without any user action. They incur costs as well, and they pass through here before any rule is evaluated.",
    intercept: "Answer locally",
    interceptWhat: "The gateway answers directly. Nothing is sent upstream and no cost is incurred.",
    passthrough: "Pass through",
    passthroughWhat: "Forwarded as an ordinary request, with costs according to the upstream's billing.",
    routed: "Use routing",
    routedWhat:
      "Forwarded by the rules under the Routes tab, which can send it to a lower-cost upstream.",
    nowCosts:
      "Once it uses routing, this kind of request goes upstream and costs what the upstream charges.",
    ruleHint:
      "The “Auxiliary request” condition in a rule only holds for the kinds set to “Use routing”.",
  },
);
