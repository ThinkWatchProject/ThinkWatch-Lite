import { messages } from "@/i18n";

export const probesTabText = messages(
  {
    intro:
      "客户端自动发起的辅助请求，不由用户操作触发，同样产生费用。这一层先过，剩下的才轮到规则。",
    intercept: "本地应答",
    interceptWhat: "由网关直接应答，不发送到上游，不产生费用。",
    forward: "转发",
    forwardWhat: "和普通请求一样按路由规则转发，按转发到的上游产生费用。",
    ruleHint: "规则可用「辅助请求」条件匹配设为转发的类别，例如分流至费用更低的上游。",
  },
  {
    intro:
      "Auxiliary requests that clients send on their own, without any user action. They incur costs as well, and they pass through here before any rule is evaluated.",
    intercept: "Answer locally",
    interceptWhat: "The gateway answers directly. Nothing is sent upstream and no cost is incurred.",
    forward: "Forward",
    forwardWhat: "Forwarded by the routing rules like any other request, with costs according to the upstream it goes to.",
    ruleHint:
      "Rules can match the kinds set to “Forward” with the “Auxiliary request” condition, for example to send them to a lower-cost upstream.",
  },
);
