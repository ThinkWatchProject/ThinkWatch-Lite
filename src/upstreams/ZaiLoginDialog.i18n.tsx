import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const zaiLoginText = messages(
  {
    expired: "授权未在有效期内完成",
    cancelled: "登录已取消",
    title: "使用 Z.ai 或 BigModel 账号",
    desc: "登录账号，把它的编程套餐额度作为一个上游使用。",
    service: "账号归属",
    serviceDesc: (url: ReactNode) => (
      <>两者是同一服务的两个站点，账号不通用；请求发往 {url}</>
    ),
    noticeTitle: "登录之前请确认以下几点",
    noticeTheirPage:
      "授权页由对方提供，页面上显示的是他们自己的客户端名称 —— 该服务不开放第三方注册授权应用。",
    noticeKey:
      "登录会在账号中创建一把名为 thinkwatch 的 API 密钥（已存在则直接使用），额度按该密钥计入套餐。",
    noticeHonest: "请求会如实说明来自 ThinkWatch，不伪装成其他客户端。",
    noticeStorage: "得到的密钥保存在本机的配置文件中，与其他上游一同管理。",
    name: "名称",
    nameDesc: "配置中这个上游的名称",
    nameTaken: "这个名称已被占用",
    nameReplaces: "将替换该上游的密钥",
    proxy: "出站代理",
    proxyDesc: "登录与后续请求都经此发出",
    direct: "直连",
    systemProxy: "系统代理",
    understood: "已阅读上述说明，继续登录",
    waiting: "授权页已在浏览器中打开，完成授权后此处会自动继续。",
    hint: "浏览器未打开时可再打开一次。授权完成后浏览器会停在对方的页面上，可直接关闭。",
    reopen: "重新打开授权页",
    done: (provider: ReactNode) => <>已登录，上游 {provider} 已写入配置。</>,
    account: (who: string) => `账号 ${who}。`,
    doneHint: "模型范围、计费方式等可在该上游的编辑对话框中调整。",
    finish: "完成",
    signIn: "登录",
  },
  {
    expired: "Authorization was not completed within the time limit",
    cancelled: "Sign-in was canceled",
    title: "Use a Z.ai or BigModel account",
    desc: "Signs in to an account and uses its coding plan quota as an upstream.",
    service: "Account service",
    serviceDesc: (url: ReactNode) => (
      <>Two sites of the same service; an account works on one of them only. Requests go to {url}</>
    ),
    noticeTitle: "Confirm the following before signing in",
    noticeTheirPage:
      "The authorization page is theirs, and it names their own client, because the service does not let third parties register an authorization app.",
    noticeKey:
      "Signing in creates an API key named thinkwatch on the account, or uses the existing one. Quota is counted against that key.",
    noticeHonest:
      "Requests truthfully identify themselves as coming from ThinkWatch and do not impersonate other clients.",
    noticeStorage:
      "The key obtained by signing in is stored in the config file on this computer and managed together with the other upstreams.",
    name: "Name",
    nameDesc: "This upstream's name in the config",
    nameTaken: "This name is already in use",
    nameReplaces: "The key of that upstream will be replaced",
    proxy: "Outbound proxy",
    proxyDesc: "Used for sign-in and all later requests",
    direct: "Direct",
    systemProxy: "System proxy",
    understood: "Acknowledge the notes above and continue signing in",
    waiting:
      "The authorization page is open in the browser. Sign-in continues here automatically once authorization is complete.",
    hint: "If the browser did not open, the page can be opened again. After authorization the browser stays on their page and can simply be closed.",
    reopen: "Reopen authorization page",
    done: (provider: ReactNode) => <>Signed in. The upstream {provider} has been saved to the config.</>,
    account: (who: string) => `Account: ${who}.`,
    doneHint: "Model scope, billing and other settings can be changed in the upstream's edit dialog.",
    finish: "Done",
    signIn: "Sign in",
  },
);
