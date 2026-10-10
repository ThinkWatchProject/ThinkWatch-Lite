import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const chatgptLoginText = messages(
  {
    title: "重新登录 ChatGPT 账号",
    desc: (name: ReactNode) => <>为上游 {name} 换一次登录凭据。模型范围、计费方式等设置保持不变。</>,
    name: "名称",
    cancelSignIn: "取消登录",
    finish: "完成",
  },
  {
    title: "Sign in to ChatGPT again",
    desc: (name: ReactNode) => (
      <>
        Replaces the sign-in credential for the upstream {name}. Model scope, billing and other settings stay
        unchanged.
      </>
    ),
    name: "Name",
    cancelSignIn: "Cancel sign-in",
    finish: "Done",
  },
);
