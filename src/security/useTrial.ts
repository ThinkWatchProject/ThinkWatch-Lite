import { useEffect, useState } from "react";
import { errorText } from "@/i18n/core.i18n";
import type { ContentMatch, Guard, RuleAction, SecurityTestResult } from "@/types";
import { api } from "./api";

export type Trial =
  | { state: "idle" }
  | { state: "running" }
  | ({ state: "done" } & SecurityTestResult)
  | { state: "failed"; error: string };

/**
 * 拿一段文本试规则，**边输入边试**。
 *
 * 试的是 core：正则方言、JSON 里的转义、报哪几处命中、替换和删除之后发出去的样子，
 * 这些都和网关一致。界面自己跑一遍的话，结论可能和真的请求对不上。
 *
 * 输入停下 250ms 再发，每敲一个字都问一次没有意义；慢的那次回来时如果
 * 输入又变了，丢掉它。
 */
export function useTrial(
  guard: Guard,
  sample: string,
  only: { pattern?: string; match?: ContentMatch; rule?: string; label?: string; action?: RuleAction },
  /** 为 false 时不试（比如正则还是空的、码位写错了） */
  ready = true,
): Trial {
  const [trial, setTrial] = useState<Trial>({ state: "idle" });
  const { pattern, match, rule, label, action } = only;
  useEffect(() => {
    if (!ready || sample.length === 0) {
      setTrial({ state: "idle" });
      return;
    }
    let alive = true;
    setTrial((t) => (t.state === "done" ? t : { state: "running" }));
    const h = setTimeout(() => {
      api
        .test(guard, sample, { pattern, match, rule, label, action })
        .then((r) => alive && setTrial({ state: "done", ...r }))
        .catch((e) => alive && setTrial({ state: "failed", error: errorText(e) }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [guard, sample, pattern, match, rule, label, action, ready]);
  return trial;
}
