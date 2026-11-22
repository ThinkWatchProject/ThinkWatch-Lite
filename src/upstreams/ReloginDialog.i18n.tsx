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
  {
    "zh-Hant": {
      chatgptTitle: "重新登入 ChatGPT 帳號",
      chatgptDesc: (name: ReactNode) => <>為上游 {name} 換一次登入憑據。模型範圍、計費方式等設定保持不變。</>,
      zaiTitle: (site: string) => `登入 ${site} 帳號`,
      zaiDesc: (name: ReactNode) => <>登入帳號，為上游 {name} 換一把新金鑰。模型範圍、計費方式等設定保持不變。</>,
      name: "名稱",
      cancelSignIn: "取消登入",
    },
    ko: {
      name: "이름",
    },
    es: {
      chatgptTitle: "Inicie sesión en ChatGPT de nuevo",
      chatgptDesc: (name: ReactNode) => (<>
        Reemplaza la credencial de inicio de sesión para el curso previo {name}. Model scope, billing and other settings stay
        unchanged.
       </>),
      zaiTitle: (site: string) => `Inicia sesión en ${site}`,
      zaiDesc: (name: ReactNode) => (<>
        Inicia sesión en la cuenta y reemplaza la clave del cursor {name}. Model scope, billing and other
        settings stay unchanged.
       </>),
      name: "Nombre",
      cancelSignIn: "Cancelar el inicio de sesión",
      finish: "Hecho",
    },
  },
);
