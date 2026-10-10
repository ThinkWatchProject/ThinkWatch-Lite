import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const reloginText = messages(
  {
    chatgptTitle: "重新登录 ChatGPT 账号",
    chatgptDesc: (name: ReactNode) => <>为上游 {name} 换一次登录凭据。模型范围、计费方式等设置保持不变。</>,
    zaiTitle: (site: string) => `登录 ${site} 账号`,
    zaiDesc: (name: ReactNode) => <>登录账号，为上游 {name} 换一把新密钥。模型范围、计费方式等设置保持不变。</>,
    name: "名称",
    cancelSignIn: "取消登录",
    finish: "完成",
  },
  {
    chatgptTitle: "Sign in to ChatGPT again",
    chatgptDesc: (name: ReactNode) => (
      <>
        Replaces the sign-in credential for the upstream {name}. Model scope, billing and other settings stay
        unchanged.
      </>
    ),
    zaiTitle: (site: string) => `Sign in to ${site}`,
    zaiDesc: (name: ReactNode) => (
      <>
        Signs in to the account and replaces the key of the upstream {name}. Model scope, billing and other
        settings stay unchanged.
      </>
    ),
    name: "Name",
    cancelSignIn: "Cancel sign-in",
    finish: "Done",
  },
);
