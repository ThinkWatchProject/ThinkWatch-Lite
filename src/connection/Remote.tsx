import { MonitorIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import type { Retargeted } from "@/types";
import { remoteText } from "./remote.i18n";
import { useRemote } from "./useRemote";

/**
 * 连着远程 core 时，客户端页、MCP 页顶上**固定**的那一条（设计稿 ⑧）：这里改的是这台
 * 机器上的文件，不是服务器上的。不能关 —— 它说的是这一页一直成立的事实。
 */
export function RemoteNote({ children }: { children: string }) {
  return (
    <Banner layout="inline" tone="info" icon={<MonitorIcon />}>
      {children}
    </Banner>
  );
}

/**
 * 把接管着的客户端改为指向服务器之后，**逐个说**：改好了哪几个，哪几个没改成、为什么。
 * 一个失败不影响其余的，所以也不能只说一句「失败了」。
 */
export function RetargetReport({ name, result }: { name: string; result: Retargeted }) {
  const t = useText(remoteText);
  return (
    <div className="flex flex-col gap-2">
      {result.synced.length > 0 && (
        <p className="tw-body">{t.retargeted(name, result.synced.map((s) => s.name))}</p>
      )}
      {result.failed.length > 0 && (
        <Banner layout="inline" tone="error" title={t.retargetFailedTitle(name)}>
          <ul className="flex flex-col gap-0.5">
            {result.failed.map((f) => (
              <li key={f.client}>
                <span className="font-medium">{f.name}</span>
                {t.sep}
                {coreText(f.error)}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {result.synced.length === 0 && result.failed.length === 0 && (
        <p className="tw-body text-muted-foreground">{t.retargetNone}</p>
      )}
    </div>
  );
}

/**
 * 出站选单里「系统代理」那一项怎么写。连着远程 core 时说清是**服务器的**系统代理：
 * 代理由 core 进程去读，读的是它那台机器的设置
 */
export function useSystemProxyLabel(local: string): string {
  const t = useText(remoteText);
  return useRemote() ? t.systemProxy : local;
}
