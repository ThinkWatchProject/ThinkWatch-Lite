import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call } from "@/control";
import type { CoreEvent } from "@/types";
import { applyFlightEvent, type Flight } from "./flights";

/** 走完的请求在图上多留这么久再熄：一闪而过的短请求也看得见 */
const LINGER_MS = 900;
/** 事件一串一串地来：攒这么久画一次，不是一条一画 */
const BATCH_MS = 120;

const NONE: ReadonlyMap<number, Flight> = new Map();

/**
 * 此刻在途的请求（见 `flights.ts`），给路由图画「正在走的路」。
 *
 * **先挂监听再问快照**，和流量页同一个顺序：问快照的那一会儿里开始、结束的请求，
 * 以事件为准。core 停了就全部熄灭（请求随之断开）；回来、或者事件流丢过事件，
 * 再问一次快照。
 */
export function useFlights(): ReadonlyMap<number, Flight> {
  const [flights, setFlights] = useState<ReadonlyMap<number, Flight>>(NONE);
  useEffect(() => {
    let alive = true;
    const live = new Map<number, Flight>();
    /** 问快照期间事件流上见过的请求：快照里的这几条作废 */
    let seen: Set<number> | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let batch: ReturnType<typeof setTimeout> | null = null;

    const publish = () => {
      if (batch) return;
      batch = setTimeout(() => {
        batch = null;
        if (alive) setFlights(live.size ? new Map(live) : NONE);
      }, BATCH_MS);
    };
    const end = (id: number) => {
      const h = setTimeout(() => {
        timers.delete(h);
        if (live.delete(id)) publish();
      }, LINGER_MS);
      timers.add(h);
    };

    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "events_dropped") {
        // 结局可能正在丢掉的那几条里：清掉，按快照重来
        live.clear();
        publish();
        void resync();
        return;
      }
      const r = applyFlightEvent(live, ev);
      if (r && seen) seen.add(ev.id);
      if (r === "ended") end(ev.id);
      else if (r === "changed") publish();
    });
    async function resync() {
      const mark = new Set<number>();
      seen = mark;
      try {
        // 等订阅真的挂上再问：`listen` 是异步注册的
        await un;
        const open = await call("InFlight", null);
        if (!alive || seen !== mark) return;
        // 每个请求到目前为止的事件按原来的顺序重放：已经路由了的，一打开就画到上游
        for (const { id, events } of open.requests) {
          if (mark.has(id) || live.has(id)) continue;
          for (const ev of events) applyFlightEvent(live, ev);
        }
        publish();
      } catch {
        // 问不到：已经在跑的这几条不画，下一个请求照常
      } finally {
        if (seen === mark) seen = null;
      }
    }
    void resync();
    const unState = listen<string>("core-state", (e) => {
      if (e.payload.startsWith("running")) {
        void resync();
        return;
      }
      seen = null;
      live.clear();
      publish();
    });

    return () => {
      alive = false;
      void un.then((f) => f());
      void unState.then((f) => f());
      if (batch) clearTimeout(batch);
      for (const h of timers) clearTimeout(h);
    };
  }, []);
  return flights;
}
