import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import UpdateWindow from "./UpdateWindow";
import "./index.css";

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

const Root = windowLabel() === "update" ? UpdateWindow : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
