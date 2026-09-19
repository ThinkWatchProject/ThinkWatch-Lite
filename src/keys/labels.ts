import type { ClientView, DetectedClient } from "@/types";

/** 这把密钥是给谁用的。**接管过的说出客户端的名字**，其余的说「手动配置」 */
export function useLabel(k: ClientView, clients: DetectedClient[]): string {
  if (!k.client) return "手动配置的客户端";
  const c = clients.find((x) => x.id === k.client);
  const name = c?.name ?? k.client;
  // 取消接管之后密钥留着，下次接管直接复用 —— 行里要看得出它是留给谁的
  return c?.adopted_at_ms ? `${name} · 已接管` : `${name} · 未接管`;
}

/** 可见模型那一栏。**第三态要单独说**：它等于这把钥匙现在用不了 */
export function scopeLabel(allow: string[] | null | undefined): {
  text: string;
  warn: boolean;
} {
  if (allow == null) return { text: "不限", warn: false };
  if (allow.length === 0) return { text: "一个都不给", warn: true };
  return { text: `${allow.length} 个模型`, warn: false };
}

/** 错误文案：core 发来的字符串原样显示 */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

/**
 * 没绑路由时那一格写什么。
 *
 * **默认路由本来就叫「默认」时，不写成「默认（默认）」** —— 括号里重复一遍
 * 同一个词，读起来像个 bug。
 */
export function routeLabel(route: string | null | undefined, defaultRoute: string): string {
  if (route) return route;
  return defaultRoute === "默认" ? "默认" : `默认（${defaultRoute}）`;
}
