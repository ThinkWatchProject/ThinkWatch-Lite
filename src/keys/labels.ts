import { textOf } from "@/i18n";
import type { ClientView, DetectedClient, KnownModel, ManualClient } from "@/types";
import { labelsText } from "./labels.i18n";
import { splitEntries, visibleCount } from "./scope";

/**
 * 这把密钥是为谁生成的：正被接管的、当前未接管的、手动配置的。`id` 是客户端的
 * id（`claude-code`，画标志用），`client` 是显示名。
 */
export type KeyOwner = { id: string; client: string; kind: "adopted" | "idle" | "manual" };

/**
 * 这把密钥是为哪个客户端生成的。
 *
 * **手动创建的返回 null** —— 那是常态，每行都写一句「手动」是噪声；要单独
 * 标出来的是为某个客户端生成的那几把：接管时生成的，和手动配置 Cursor 这类
 * 客户端时生成的。能接管的客户端还要说清此刻是不是正被接管着（决定了能不能删）。
 */
export function takeoverOf(
  k: ClientView,
  clients: DetectedClient[],
  manual: ManualClient[] = [],
): KeyOwner | null {
  if (!k.client) return null;
  const m = manual.find((x) => x.id === k.client);
  if (m) return { id: m.id, client: m.name, kind: "manual" };
  const c = clients.find((x) => x.id === k.client);
  return { id: k.client, client: c?.name ?? k.client, kind: c?.adopted_at_ms ? "adopted" : "idle" };
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
 * 同一个词，读起来像个 bug。叫 `default` 的（新装时 core 生成的那一条就叫这个）
 * 同理：「默认（default）」「Default (default)」也是同一个词说两遍。
 */
export function routeLabel(route: string | null | undefined, defaultRoute: string): string {
  if (route) return route;
  const t = textOf(labelsText);
  const name = defaultRoute.trim().toLowerCase();
  return name === "default" || name === t.defaultRoute.toLowerCase() ? t.defaultRoute : t.defaultNamed(defaultRoute);
}
