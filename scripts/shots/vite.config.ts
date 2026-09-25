import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 截图页的构建。**和应用的构建是两回事**：应用只认根目录的 index.html，这里的入口是
 * scripts/shots/index.html，产物放在 node_modules/.cache/shots/site，截图程序从那里读。
 *
 * 根目录仍是仓库根，`@/` 和应用里一样解析。`base: "./"`：截图程序按 `shots://app/`
 * 把文件交给 WKWebView，资源要按相对路径找。
 */
export default defineConfig({
  root,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("../../node_modules/.cache/shots/site", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./index.html", import.meta.url)) },
    // 整个应用在一块里，只在本机读：分块的提醒对这里没有意义
    chunkSizeWarningLimit: 4096,
  },
  clearScreen: false,
});
