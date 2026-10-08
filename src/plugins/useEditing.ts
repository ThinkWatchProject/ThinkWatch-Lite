import { useEffect, useState, useSyncExternalStore } from "react";
import { call } from "@/control";
import type { PluginInspection } from "@/types";
import { EditingEngine } from "./editing";

/**
 * 编辑器的代码和表单两头（`EditingEngine`，做法和理由都在它那里），接到组件上。
 * core 那两步是真的 `PluginInspect`、`PluginRewrite`。
 */
export function useEditing(id: string | null, start: { source: string; inspection: PluginInspection }) {
  const [engine] = useState(
    () =>
      new EditingEngine(id, start, {
        inspect: (source) => call("PluginInspect", { source }),
        rewrite: async (source, values) => (await call("PluginRewrite", { source, ...values })).source,
      }),
  );
  useEffect(() => {
    engine.id = id;
  }, [engine, id]);
  useEffect(() => engine.attach(), [engine]);
  const s = useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
  return {
    source: s.source,
    editCode: engine.editCode,
    form: s.form,
    editForm: engine.editForm,
    /** 最近一次读得了的 manifest（代码读不了时是上一次的） */
    manifest: s.manifest,
    /** 现在的代码读不了的原因 */
    error: s.error,
    checking: s.checking,
    /** 读或改写这一步本身没成（连不上 core 之类） */
    syncError: s.syncError,
    flush: engine.flush,
    /** 「现在」的代码、manifest 和读不了的原因：保存时用（`flush` 之后，不等渲染） */
    now: engine.now,
  };
}
