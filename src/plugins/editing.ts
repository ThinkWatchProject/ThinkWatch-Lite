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
export const CHECK_AFTER = 400;
/** 表单停下来多久再改写代码 */
export const REWRITE_AFTER = 250;

/** 读到的 manifest 里换上表单的值（改写只动这几项，权限、名字照旧） */
function withValues(m: ManifestView, v: Values): ManifestView {
  return {
    ...m,
    on_error: v.on_error,
    scope: v.scope,
    settings_schema: m.settings_schema.map((s) => ({ ...s, value: v.settings[s.key] ?? s.value })),
  };
}

/** 编辑器此刻的样子 */
export interface EditingState {
  source: string;
  /** 最近一次读得了的 manifest（代码读不了时是上一次的） */
  manifest: ManifestView | null;
  /** 现在的代码读不了的原因 */
  error: PluginLoadError | null;
  form: Form | null;
  checking: boolean;
  /** 读或改写这一步本身没成（连不上 core 之类） */
  syncError: string | null;
}

/** 编辑器要 core 做的两件事。都没有副作用 */
export interface EditingCore {
  /** 读一遍代码（`PluginInspect`） */
  inspect: (source: string) => Promise<PluginInspection>;
  /** 按表单的值改写代码里的 manifest（`PluginRewrite`），返回改写之后的代码 */
  rewrite: (source: string, values: Values) => Promise<string>;
}

/**
 * 编辑器的两头：**代码是唯一的真相**，表单是从它读出来的。不挂在 React 上，测试拿假的
 * core 和假的计时器驱动它（`editing.test.ts`）；`useEditing` 只是把它接到组件上。
 *
 * - 改代码：停下 0.4 秒交给 core 读一遍（`inspect`，不写任何东西）。读得了，表单换成
 *   代码里的值；读不了，记下第几行第几列、为什么，表单停在上一次读得了的样子、不能改。
 * - 改表单：停下 0.25 秒请 core 按表单的值改写代码里的 manifest（`rewrite`，没有副作用），
 *   代码换成改写之后的那一份。
 * - **晚到的回答不覆盖更新的改动**：读的时候代码又改了，那次的结果不要；读的时候表单又改了，
 *   表单不跟着那次的结果变（改写会把表单的值写进去）。
 * - 表单改回了打开时的值、代码也没动过：代码回到打开时的那一份（不留一份只是换了排版的
 *   「改动」）。
 *
 * `flush()` 把等着的那一次马上发出去，并等所有在路上的回答落地：切换标签、保存之前调用，
 * 让两头一致。
 */
export class EditingEngine {
  /** 换了就是新的一份对象：`useSyncExternalStore` 按引用比 */
  private state: EditingState;
  private readonly listeners = new Set<() => void>();
  /** 表单改过几次。读的时候表单又改过，读回来的不往表单上写 */
  private formGen = 0;
  private codeTouched = false;
  /** 打开时表单的值：改回了它、代码又没动过，代码就回到打开时的那一份 */
  private readonly pristine: string | null;
  private readonly startSource: string;
  private timer: { kind: "check" | "rewrite"; handle: ReturnType<typeof setTimeout> } | null = null;
  private checkSeq = 0;
  private rewriteSeq = 0;
  private readonly inFlight = new Set<Promise<void>>();
  /** 挂着它的组件还在。不在了，回来的结果都不要 */
  private alive = true;

  /**
   * `id`：装着的插件的（默认插件的标签按界面语言），新插件是 `null`。
   * `start`：打开时的代码和 core 读它的结果。
   */
  constructor(
    public id: string | null,
    start: { source: string; inspection: PluginInspection },
    private readonly core: EditingCore,
  ) {
    const first = start.inspection.manifest;
    const form = first ? formOf(id, first) : null;
    this.startSource = start.source;
    this.pristine = form ? JSON.stringify(valuesOf(form).values) : null;
    this.state = { source: start.source, manifest: first, error: start.inspection.error, form, checking: false, syncError: null };
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = (): EditingState => this.state;

  /** 组件挂上时调，返回卸下时调的那个。开发模式下会先卸一次再装：装上时重新记成「在」 */
  readonly attach = () => {
    this.alive = true;
    return () => {
      this.alive = false;
      if (this.timer) clearTimeout(this.timer.handle);
    };
  };

  private set(patch: Partial<EditingState>) {
    this.state = { ...this.state, ...patch };
    for (const f of this.listeners) f();
  }

  private track(p: Promise<void>) {
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }

  /** 读一遍现在的代码 */
  private check() {
    const src = this.state.source;
    const gen = this.formGen;
    const seq = ++this.checkSeq;
    this.set({ checking: true });
    this.track(
      (async () => {
        let r: PluginInspection;
        try {
          r = await this.core.inspect(src);
        } catch (e) {
          if (this.alive && seq === this.checkSeq) this.set({ syncError: errorText(e) });
          return;
        } finally {
          if (this.alive && seq === this.checkSeq) this.set({ checking: false });
        }
        if (!this.alive || seq !== this.checkSeq || src !== this.state.source) return;
        this.set({ syncError: null, error: r.error });
        if (!r.manifest) return;
        this.set({ manifest: r.manifest });
        // 读的时候表单又改过：不跟着这次的结果变，改写会把表单的值写进代码
        if (this.formGen !== gen) return;
        this.set({ form: formOf(this.id, r.manifest) });
      })(),
    );
  }

  /** 按表单改写代码 */
  private rewrite() {
    const f = this.state.form;
    if (!f) return;
    const { values, problem } = valuesOf(f);
    if (problem) return;
    const src = this.state.source;
    const seq = ++this.rewriteSeq;
    this.track(
      (async () => {
        let next: string;
        try {
          next = await this.core.rewrite(src, values);
        } catch (e) {
          if (this.alive && seq === this.rewriteSeq) this.set({ syncError: errorText(e) });
          return;
        }
        if (!this.alive || seq !== this.rewriteSeq || src !== this.state.source) return;
        const m = this.state.manifest;
        this.set({ syncError: null, source: next, manifest: m ? withValues(m, values) : m });
      })(),
    );
  }

  /** 等着的那一次马上发 */
  private runPending() {
    const p = this.timer;
    if (!p) return;
    clearTimeout(p.handle);
    this.timer = null;
    if (p.kind === "check") this.check();
    else this.rewrite();
  }

  /** 等着的是这一种的话作废它 */
  private cancel(kind: "check" | "rewrite") {
    if (this.timer?.kind !== kind) return;
    clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private schedule(kind: "check" | "rewrite", ms: number) {
    // 等着的是另一头的：先发出去，两头的改动不搅在一起
    if (this.timer && this.timer.kind !== kind) this.runPending();
    if (this.timer) clearTimeout(this.timer.handle);
    this.timer = {
      kind,
      handle: setTimeout(() => {
        this.timer = null;
        if (kind === "check") this.check();
        else this.rewrite();
      }, ms),
    };
  }

  /** 代码改了（打字、撤销）。`now`：马上读（从文件导入的） */
  readonly editCode = (next: string, now = false) => {
    if (next === this.state.source) return;
    this.codeTouched = true;
    this.set({ source: next });
    if (now) {
      this.cancel("check");
      this.runPending();
      this.check();
    } else this.schedule("check", CHECK_AFTER);
  };

  /** 表单改了 */
  readonly editForm = (next: Form) => {
    this.formGen++;
    this.set({ form: next });
    const { values, problem } = valuesOf(next);
    if (problem) {
      // 填得不对的不往代码里写：等改对了再写
      this.cancel("rewrite");
      return;
    }
    if (!this.codeTouched && JSON.stringify(values) === this.pristine) {
      // 改回了打开时的样子：代码也回到打开时的那一份，在路上的改写作废
      this.cancel("rewrite");
      this.rewriteSeq++;
      const m = this.state.manifest;
      this.set({ source: this.startSource, manifest: m ? withValues(m, values) : m });
      return;
    }
    this.schedule("rewrite", REWRITE_AFTER);
  };

  /** 两头一致了再往下走：等着的马上发，在路上的等它落地 */
  readonly flush = async () => {
    this.runPending();
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  };

  /** 「现在」的代码、manifest 和读不了的原因：保存时用（`flush` 之后，不等渲染） */
  readonly now = () => ({ source: this.state.source, manifest: this.state.manifest, error: this.state.error });
}
