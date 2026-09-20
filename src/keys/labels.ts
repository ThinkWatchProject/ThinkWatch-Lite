import { textOf } from "@/i18n";
import type { ClientView, DetectedClient, KnownModel } from "@/types";
import { labelsText } from "./labels.i18n";
import { splitEntries, visibleCount } from "./scope";

/** 这把密钥是给谁用的。**接管过的说出客户端的名字**，其余的说「手动配置」 */
export function useLabel(k: ClientView, clients: DetectedClient[]): string {
  const t = textOf(labelsText);
  if (!k.client) return t.manual;
  const c = clients.find((x) => x.id === k.client);
  const name = c?.name ?? k.client;
  // 取消接管之后密钥留着，下次接管直接复用 —— 行里要看得出它是留给谁的
  return c?.adopted_at_ms ? `${name} · ${t.connected}` : `${name} · ${t.notConnected}`;
}

/**
 * 可见模型那一栏。
 *
 * **数的是模型，不是条目。**`allow` 里一条 `claude-*` 是一条规则，可能命中
 * 三个模型 —— 按条目数说「1 个模型」是错的。目录还没到手时就只说有几条
 * 规则，不谎报一个算不出来的数。
 *
 * **第三态要单独说**：它等于这把钥匙现在用不了。
 */
export function scopeLabel(
  allow: string[] | null | undefined,
  catalog: KnownModel[],
): { text: string; warn: boolean } {
  const t = textOf(labelsText);
  if (allow == null) return { text: t.allModels, warn: false };
  if (allow.length === 0) return { text: t.noModels, warn: true };
  const { patterns, picked } = splitEntries(allow);
  if (catalog.length === 0) {
    // 明细不用目录也数得出；只有规则时就说规则
    const parts = [picked.length > 0 ? t.models(picked.length) : null, patterns.length > 0 ? t.rules(patterns.length) : null];
    return { text: parts.filter(Boolean).join(" · "), warn: false };
  }
  const n = visibleCount(allow, catalog);
  const text = patterns.length > 0 ? `${t.models(n)} · ${t.rules(patterns.length)}` : t.models(n);
  return { text, warn: false };
}

export { errorText } from "@/i18n/core.i18n";

/**
 * 没绑路由时那一格写什么。
 *
 * **默认路由本来就叫「默认」时，不写成「默认（默认）」** —— 括号里重复一遍
 * 同一个词，读起来像个 bug。
 */
export function routeLabel(route: string | null | undefined, defaultRoute: string): string {
  if (route) return route;
  const t = textOf(labelsText);
  return defaultRoute === t.defaultRoute ? t.defaultRoute : t.defaultNamed(defaultRoute);
}
