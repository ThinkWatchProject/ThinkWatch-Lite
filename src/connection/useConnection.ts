import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { connApi, type ConnView } from "./api";

/**
 * 连接列表和当前连接的状态。**推过来的**（`connection` 事件），挂上时先读一次。
 *
 * 先挂监听再读，顺序不能反：两者之间发生的那一次变化会丢。
 */
export function useConnection(): ConnView | null {
  const [view, setView] = useState<ConnView | null>(null);
  useEffect(() => {
    let alive = true;
    const un = listen<ConnView>("connection", (e) => {
      if (alive) setView(e.payload);
    });
    void un
      .then(() => connApi.view())
      .then((v) => {
        if (alive) setView(v);
      })
      .catch(() => {
        /* 不在应用里（隔离预览没 mock 它）：没有连接这一层 */
      });
    return () => {
      alive = false;
      void un.then((f) => f());
    };
  }, []);
  return view;
}
