import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/control";
import { errorText } from "@/i18n/core.i18n";
import type { ManifestView, OnError, PluginInspection, PluginLoadError, PluginScope, SettingSpecView, SettingValue } from "@/types";
import { localSchema } from "./defaults";
import { draftOf, scopeOf, scopeProblem, settingsDraftOf, settingsOf, type ScopeDraft, type SettingsDraft } from "./fields";
import type { ScopePart } from "./model";

/**
 * 编辑器的表单：出错时、适用范围、设置项。**都写在插件的代码里**（manifest），表单只是它们
 * 的另一种样子：从代码读出来，改了写回代码里。
 */
export interface Form {
  onError: OnError;
  scope: ScopeDraft;
  settings: SettingsDraft;
  /** 设置项：键、类型、标签（默认插件的标签按界面语言） */
  schema: SettingSpecView[];
}

/** 代码里的 manifest 变成表单。`id`：装着的插件的（默认插件的标签按界面语言），新插件是 `null` */
export function formOf(id: string | null, m: ManifestView): Form {
  const schema = localSchema(id, m.name, m.settings_schema);
  return { onError: m.on_error, scope: draftOf(m.scope), settings: settingsDraftOf(schema), schema };
}

/** 交给 core 改写代码的值 */
export interface Values {
  on_error: OnError;
  scope: PluginScope;
  settings: Record<string, SettingValue>;
}

/** 表单里填得不对的一处：选了「指定」却没加名单的那一项，或者不是数的那一个设置 */
export type Problem = { kind: "scope"; part: ScopePart } | { kind: "number"; label: string };

export function valuesOf(f: Form): { values: Values; problem: Problem | null } {
  const s = settingsOf(f.schema, f.settings);
  const part = scopeProblem(f.scope);
  const problem: Problem | null = part ? { kind: "scope", part } : s.bad[0] ? { kind: "number", label: s.bad[0] } : null;
  return { values: { on_error: f.onError, scope: scopeOf(f.scope), settings: s.values }, problem };
}

/** 代码停下来多久再交给 core 读一遍 */
const CHECK_AFTER = 400;
/** 表单停下来多久再改写代码 */
const REWRITE_AFTER = 250;

/** 读到的 manifest 里换上表单的值（改写只动这几项，权限、名字照旧） */
function withValues(m: ManifestView, v: Values): ManifestView {
  return {
    ...m,
    on_error: v.on_error,
    scope: v.scope,
    settings_schema: m.settings_schema.map((s) => ({ ...s, value: v.settings[s.key] ?? s.value })),
  };
}

/**
 * 编辑器的两头：**代码是唯一的真相**，表单是从它读出来的。
 *
 * - 改代码：停下 0.4 秒交给 core 读一遍（`PluginInspect`，不写任何东西）。读得了，表单换成
 *   代码里的值；读不了，记下第几行第几列、为什么，表单停在上一次读得了的样子、不能改。
 * - 改表单：停下 0.25 秒请 core 按表单的值改写代码里的 manifest（`PluginRewrite`，没有副作用），
 *   代码换成改写之后的那一份。
 * - **晚到的回答不覆盖更新的改动**：读的时候代码又改了，那次的结果不要；读的时候表单又改了，
 *   表单不跟着那次的结果变（改写会把表单的值写进去）。
 * - 表单改回了打开时的值、代码也没动过：代码回到打开时的那一份（不留一份只是换了排版的
 *   「改动」）。
 *
 * `flush()` 把等着的那一次马上发出去，并等所有在路上的回答落地：切换标签、保存之前调用，
 * 让两头一致。
 */
export function useEditing(id: string | null, start: { source: string; inspection: PluginInspection }) {
  const first = start.inspection.manifest;
  const [source, setSourceState] = useState(start.source);
  const [manifest, setManifestState] = useState<ManifestView | null>(first);
  const [error, setErrorState] = useState<PluginLoadError | null>(start.inspection.error);
  const [form, setFormState] = useState<Form | null>(() => (first ? formOf(id, first) : null));
  const [checking, setChecking] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // 异步回来时要比的「现在」、保存时读的「现在」：改的那一刻同步更新，不等渲染
  const sourceNow = useRef(start.source);
  const manifestNow = useRef(first);
  const errorNow = useRef(start.inspection.error);
  const formNow = useRef(form);
  const formGen = useRef(0);
  const codeTouched = useRef(false);
  const pristine = useRef(form ? JSON.stringify(valuesOf(form).values) : null);
  const timer = useRef<{ kind: "check" | "rewrite"; handle: ReturnType<typeof setTimeout> } | null>(null);
  const checkSeq = useRef(0);
  const rewriteSeq = useRef(0);
  const inFlight = useRef(new Set<Promise<void>>());
  const alive = useRef(true);
  useEffect(() => {
    // 开发模式下 effect 会先卸一次再装：装上时重新记成「在」
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current.handle);
    };
  }, []);

  const setSource = useCallback((next: string) => {
    sourceNow.current = next;
    setSourceState(next);
  }, []);
  const setManifest = useCallback((next: ManifestView | null) => {
    manifestNow.current = next;
    setManifestState(next);
  }, []);
  const setError = useCallback((next: PluginLoadError | null) => {
    errorNow.current = next;
    setErrorState(next);
  }, []);

  const track = useCallback((p: Promise<void>) => {
    inFlight.current.add(p);
    void p.finally(() => inFlight.current.delete(p));
  }, []);

  /** 读一遍现在的代码 */
  const check = useCallback(() => {
    const src = sourceNow.current;
    const gen = formGen.current;
    const seq = ++checkSeq.current;
    setChecking(true);
    track(
      (async () => {
        let r: PluginInspection;
        try {
          r = await call("PluginInspect", { source: src });
        } catch (e) {
          if (alive.current && seq === checkSeq.current) setSyncError(errorText(e));
          return;
        } finally {
          if (alive.current && seq === checkSeq.current) setChecking(false);
        }
        if (!alive.current || seq !== checkSeq.current || src !== sourceNow.current) return;
        setSyncError(null);
        setError(r.error);
        if (!r.manifest) return;
        setManifest(r.manifest);
        // 读的时候表单又改过：不跟着这次的结果变，改写会把表单的值写进代码
        if (formGen.current !== gen) return;
        const next = formOf(id, r.manifest);
        formNow.current = next;
        setFormState(next);
      })(),
    );
  }, [id, track, setError, setManifest]);

  /** 按表单改写代码 */
  const rewrite = useCallback(() => {
    const f = formNow.current;
    if (!f) return;
    const { values, problem } = valuesOf(f);
    if (problem) return;
    const src = sourceNow.current;
    const seq = ++rewriteSeq.current;
    track(
      (async () => {
        let next: string;
        try {
          next = (await call("PluginRewrite", { source: src, ...values })).source;
        } catch (e) {
          if (alive.current && seq === rewriteSeq.current) setSyncError(errorText(e));
          return;
        }
        if (!alive.current || seq !== rewriteSeq.current || src !== sourceNow.current) return;
        setSyncError(null);
        setSource(next);
        const m = manifestNow.current;
        setManifest(m ? withValues(m, values) : m);
      })(),
    );
  }, [setSource, setManifest, track]);

  /** 等着的那一次马上发 */
  const runPending = useCallback(() => {
    const p = timer.current;
    if (!p) return;
    clearTimeout(p.handle);
    timer.current = null;
    if (p.kind === "check") check();
    else rewrite();
  }, [check, rewrite]);

  const schedule = useCallback(
    (kind: "check" | "rewrite", ms: number) => {
      // 等着的是另一头的：先发出去，两头的改动不搅在一起
      if (timer.current && timer.current.kind !== kind) runPending();
      if (timer.current) clearTimeout(timer.current.handle);
      timer.current = {
        kind,
        handle: setTimeout(() => {
          timer.current = null;
          if (kind === "check") check();
          else rewrite();
        }, ms),
      };
    },
    [check, rewrite, runPending],
  );

  /** 代码改了（打字、撤销）。`now`：马上读（从文件导入的） */
  const editCode = useCallback(
    (next: string, now = false) => {
      if (next === sourceNow.current) return;
      codeTouched.current = true;
      setSource(next);
      if (now) {
        if (timer.current?.kind === "check") {
          clearTimeout(timer.current.handle);
          timer.current = null;
        }
        runPending();
        check();
      } else schedule("check", CHECK_AFTER);
    },
    [check, runPending, schedule, setSource],
  );

  /** 表单改了 */
  const editForm = useCallback(
    (next: Form) => {
      formNow.current = next;
      formGen.current++;
      setFormState(next);
      const { values, problem } = valuesOf(next);
      if (problem) {
        // 填得不对的不往代码里写：等改对了再写
        if (timer.current?.kind === "rewrite") {
          clearTimeout(timer.current.handle);
          timer.current = null;
        }
        return;
      }
      if (!codeTouched.current && JSON.stringify(values) === pristine.current) {
        // 改回了打开时的样子：代码也回到打开时的那一份，在路上的改写作废
        if (timer.current?.kind === "rewrite") {
          clearTimeout(timer.current.handle);
          timer.current = null;
        }
        rewriteSeq.current++;
        setSource(start.source);
        const m = manifestNow.current;
        setManifest(m ? withValues(m, values) : m);
        return;
      }
      schedule("rewrite", REWRITE_AFTER);
    },
    [schedule, setSource, setManifest, start.source],
  );

  /** 两头一致了再往下走：等着的马上发，在路上的等它落地 */
  const flush = useCallback(async () => {
    runPending();
    while (inFlight.current.size > 0) await Promise.all([...inFlight.current]);
  }, [runPending]);

  return {
    source,
    editCode,
    form,
    editForm,
    /** 最近一次读得了的 manifest（代码读不了时是上一次的） */
    manifest,
    /** 现在的代码读不了的原因 */
    error,
    checking,
    /** 读或改写这一步本身没成（连不上 core 之类） */
    syncError,
    flush,
    /** 「现在」的代码、manifest 和读不了的原因：保存时用（`flush` 之后，不等渲染） */
    now: () => ({ source: sourceNow.current, manifest: manifestNow.current, error: errorNow.current }),
  };
}
