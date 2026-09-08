import { useState } from "react";
import type { SetupResponse } from "./types";

/**
 * 引导的最后两步（§7.6 第 4、5 步）：给出可复制的客户端配置，然后等
 * 第一个请求。
 *
 * 第 5 步值得多花力气 —— 这类工具最难的一关是让用户相信「流量真的经过
 * 我了」，而一个实时跳出来的请求行比任何文案都有说服力。
 */
export default function Connect({
  setup,
  seen,
  onEnter,
}: {
  setup: SetupResponse;
  seen: boolean;
  onEnter: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = [
    `export ANTHROPIC_BASE_URL=http://${setup.gateway_addr}`,
    `export ANTHROPIC_AUTH_TOKEN=${setup.gateway_key}`,
  ].join("\n");

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <h1 className="text-lg font-semibold">把客户端指过来</h1>
      <p className="mt-1 text-xs text-neutral-500">
        配置已经写到 <code className="font-mono">{setup.config_path}</code>
      </p>

      <pre className="mt-5 overflow-x-auto rounded-md border border-neutral-200 bg-neutral-100 p-3 font-mono text-[11px] leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
        {snippet}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(snippet);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700"
      >
        {copied ? "已复制" : "复制"}
      </button>

      <div className="mt-8 rounded-md border border-dashed border-neutral-300 p-4 dark:border-neutral-700">
        {seen ? (
          <>
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              ✅ 收到第一个请求，它真的在工作了。
            </p>
            <button
              onClick={onEnter}
              className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              进入主界面
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              等第一个请求…
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              回到 Claude Code 敲一句话。它出现在这里，就说明流量真的经过我们了。
            </p>
            {/* 如实说：接管本身要重启一次客户端。不说的话用户会以为哪里
                出错了 —— 而「不重启」指的是之后的所有切换（§7.6）。 */}
            <p className="mt-3 text-xs text-neutral-500">
              注意：改完环境变量之后，那个终端要重开一次才生效。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
