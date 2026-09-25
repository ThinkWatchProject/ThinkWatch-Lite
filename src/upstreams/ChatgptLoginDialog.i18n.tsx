import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const chatgptLoginText = messages(
  {
    expired: "授权未在有效期内完成",
    cancelled: "登录已取消",
    reloginTitle: "重新登录 ChatGPT 账号",
    title: "使用 ChatGPT 账号",
    reloginDesc: (name: ReactNode) => (
      <>
        为上游 {name} 换一次登录凭据。
        模型范围、计费方式等设置保持不变。
      </>
    ),
    desc: "登录 OpenAI 账号，把 ChatGPT 订阅额度作为一个上游使用。",
    noticeTitle: "登录之前请确认以下几点",
    noticeOfficial:
      "ChatGPT 订阅的用途是在 OpenAI 的官方客户端中对话。把订阅额度用于其他客户端不受 OpenAI 支持，账号可能因此受限。",
    noticeHonest: "请求会如实说明来自 ThinkWatch，不伪装成其他客户端。",
    noticeStorage: "登录得到的凭据保存在本机的配置文件中，与其他上游一同管理。",
    noticeRevoke: "删除该上游时，登录凭据会一并吊销。",
    name: "名称",
    nameDesc: "配置中这个上游的名称",
    nameTaken: "这个名称已被占用",
    proxy: "出站代理",
    proxyDesc: "登录与后续请求都经此发出",
    direct: "直连",
    systemProxy: "系统代理",
    understood: "已阅读上述说明，继续登录",
    browserWaiting: "授权页已在浏览器中打开，完成授权后此处会自动继续。",
    browserHint: "授权有效期 15 分钟。浏览器未打开时可再打开一次。",
    reopen: "重新打开授权页",
    deviceStep: (url: ReactNode) => <>在另一台已登录 ChatGPT 的设备上打开 {url}，输入下面的登录码。</>,
    deviceWaiting: "输入完成后此处会自动继续。",
    deviceWarning: "登录码有效期 15 分钟。只输入这里显示的这一个；由他人提供的登录码请勿输入。",
    done: (provider: ReactNode) => <>已登录，上游 {provider} 已写入配置。</>,
    account: (email: string, plan: string | null) =>
      plan ? `账号 ${email}，订阅类型 ${plan}。` : `账号 ${email}。`,
    plan: (plan: string) => `订阅类型 ${plan}。`,
    doneHint: "模型范围、计费方式等可在该上游的编辑对话框中调整。",
    finish: "完成",
    otherDevice: "在其他设备上登录",
    thisComputer: "在这台电脑上登录",
  },
  {
    expired: "Authorization was not completed within the time limit",
    cancelled: "Sign-in was canceled",
    reloginTitle: "Sign in to ChatGPT again",
    title: "Use a ChatGPT account",
    reloginDesc: (name: ReactNode) => (
      <>
        Replaces the sign-in credential for the upstream {name}. Model scope, billing and other
        settings stay unchanged.
      </>
    ),
    desc: "Signs in to an OpenAI account and uses its ChatGPT subscription quota as an upstream.",
    noticeTitle: "Confirm the following before signing in",
    noticeOfficial:
      "A ChatGPT subscription is intended for chatting in OpenAI's official clients. Using the subscription quota in other clients is not supported by OpenAI, and the account may be restricted as a result.",
    noticeHonest: "Requests truthfully identify themselves as coming from ThinkWatch and do not impersonate other clients.",
    noticeStorage: "The credential obtained by signing in is stored in the config file on this computer and managed together with the other upstreams.",
    noticeRevoke: "Deleting this upstream also revokes its sign-in credential.",
    name: "Name",
    nameDesc: "This upstream's name in the config",
    nameTaken: "This name is already in use",
    proxy: "Outbound proxy",
    proxyDesc: "Used for sign-in and all later requests",
    direct: "Direct",
    systemProxy: "System proxy",
    understood: "Acknowledge the notes above and continue signing in",
    browserWaiting: "The authorization page is open in the browser. Sign-in continues here automatically once authorization is complete.",
    browserHint: "Authorization is valid for 15 minutes. If the browser did not open, the page can be opened again.",
    reopen: "Reopen authorization page",
    deviceStep: (url: ReactNode) => (
      <>On another device signed in to ChatGPT, open {url} and enter the sign-in code below.</>
    ),
    deviceWaiting: "Sign-in continues here automatically once the code is entered.",
    deviceWarning: "The sign-in code is valid for 15 minutes. Enter only the code shown here; do not enter a sign-in code provided by someone else.",
    done: (provider: ReactNode) => <>Signed in. The upstream {provider} has been saved to the config.</>,
    account: (email: string, plan: string | null) =>
      plan ? `Account: ${email}, plan: ${plan}.` : `Account: ${email}.`,
    plan: (plan: string) => `Plan: ${plan}.`,
    doneHint: "Model scope, billing and other settings can be changed in the upstream's edit dialog.",
    finish: "Done",
    otherDevice: "Sign in on another device",
    thisComputer: "Sign in on this computer",
  },
);
