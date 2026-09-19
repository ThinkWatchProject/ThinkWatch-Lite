import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // shadcn 抄进来的组件一律按 `@/` 引用（`@/lib/utils`、`@/ui/button`），
  // 它的 CLI 也按这个别名写文件。tsconfig 里有一份一模一样的。
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Tauri 期望一个固定端口，随机端口会让它连不上
  server: { port: 1420, strictPort: true },
  // 构建产物给 Tauri 打包用
  build: { outDir: "dist", emptyOutDir: true },
  clearScreen: false,
  test: {
    /**
     * **把工作树里的副本挡在外面。**
     *
     * `.claude/worktrees/` 下是同一个仓库的另一个检出，里面有一整套同名
     * 的测试文件。vitest 的默认排除项不包含它，于是套件会被悄悄翻倍：
     * 这里一度报 8 个文件 68 个测试，而仓库里只有 4 个文件 38 个测试。
     *
     * 多跑一遍不是问题，**跑的是旧代码才是** —— 那些副本停在创建工作树
     * 那天，既可能掩盖真文件的失败，也可能报出一个早已修好的失败。
     */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
    // 界面语言按中文起步，见 src/test-setup.ts
    setupFiles: ["src/test-setup.ts"],
  },
});
