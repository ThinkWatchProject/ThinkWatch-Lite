import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import UpdateWindow from "./UpdateWindow";
import PickerWindow from "./connection/PickerWindow";
import { setLang, type Lang } from "./i18n";
import "./index.css";

// 设置里换了语言：每个开着的窗口当场换。不在应用里时没有事件可听
void listen<Lang>("language-changed", (e) => setLang(e.payload)).catch(() => {});

// 更新窗口和主窗口是同一份页面，按窗口的名字决定画哪一个。给一个小窗
// 单独起一个入口，就要多维护一份构建配置和一份样式入口。
//
// 取不到窗口名（页面不在 Tauri 里打开，比如直接用浏览器看 `pnpm dev`）
// 就当主窗口 —— 否则整个页面在第一行就白屏。
function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

const label = windowLabel();
const Root = label === "update" ? UpdateWindow : label === "picker" ? PickerWindow : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
