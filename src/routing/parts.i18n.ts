import { messages } from "@/i18n";

/** 路由页几处共用的小件（`parts.tsx`）：上游的状态、密钥的状态 */
export const partsText = messages(
  {
    disabled: "已停用",
    circuitOpen: "熔断中",
    needsLogin: "需要重新登录",
    authRejected: "凭据被拒",
    keyDisabled: "已停用",
  },
  {
    disabled: "Disabled",
    circuitOpen: "Circuit open",
    needsLogin: "Sign in again",
    authRejected: "Credential rejected",
    keyDisabled: "Disabled",
  },
);
