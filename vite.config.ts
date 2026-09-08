import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri 期望一个固定端口，随机端口会让它连不上
  server: { port: 1420, strictPort: true },
  // 构建产物给 Tauri 打包用
  build: { outDir: "dist", emptyOutDir: true },
  clearScreen: false,
});
