/**
 * 别名表（`GET /aliases`）。上游页的标签名（个数、小圆点）和「别名」标签挂的是同一份缓存。
 */
import { useResource, type Resource } from "@/lib/resource";
import { dismissHints, useDismissedHints } from "@/guide/hints";
import { api } from "./api";
import type { AliasSuggestion, AliasesView } from "@/types";
import { suggestionKey, visibleSuggestions } from "./logic";

/**
 * 配置换了一版（别名、上游、启用范围）、某个上游的模型清单变了，谁能服务、建议哪几组
 * 都跟着变；请求落地了，24 小时的次数和费用跟着变。和上游页其余几份数据是同一组事件。
 */
export function useAliases(): Resource<AliasesView> {
  return useResource("aliases", api.aliases, {
    events: ["config_reloaded", "models_changed", "request_finished", "request_failed", "request_cancelled"],
  });
}

/** 还该说的建议（没点过「忽略」的）和「忽略」 */
export function useSuggestions(view: AliasesView | undefined): {
  visible: AliasSuggestion[];
  dismiss: (s: readonly AliasSuggestion[]) => void;
} {
  const dismissed = useDismissedHints();
  return {
    visible: visibleSuggestions(view?.suggestions ?? [], dismissed),
    dismiss: (s) => dismissHints(s.map(suggestionKey)),
  };
}
