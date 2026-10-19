import { useEffect } from "react";
import { useResource, type Resource } from "@/lib/resource";
import { subscribe } from "@/lib/tauriEvent";
import type { CoreEvent, SyncView } from "@/types";
import { SYNC_KEYS, syncApi } from "./api";

/**
 * 同步此刻的样子（`GET /sync`）。**core 一变就推整份过来**（`sync_status`），这里直接换上，
 * 不再问一遍；配置变了（存了同步设置、别处改了不同步的上游）也重读。
 *
 * 设置里的「同步」、上游页顶上的冲突提示、上游行上的「不同步」标签用的是同一份。
 */
export function useSyncView(): Resource<SyncView> {
  const r = useResource(SYNC_KEYS.status, syncApi.status, { events: ["config_reloaded"] });
  const { mutate } = r;
  useEffect(
    () =>
      subscribe<CoreEvent>("core-event", (e) => {
        const ev = e.payload;
        if (ev.kind === "sync_status") mutate(ev.view);
      }),
    [mutate],
  );
  return r;
}

/** 开着同步吗（`off` 以外都算开着：连不上、冲突、暂停都还是开着的） */
export function syncOn(v: SyncView | undefined): v is SyncView {
  return !!v && v.state !== "off";
}
