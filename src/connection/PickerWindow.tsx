import { RadioGroup, RadioGroupItem } from "@/ui/radio-group";
import { Label } from "@/ui/label";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { IconLocal, IconRemote } from "@/ui/icons";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { connApi, type ConnView } from "./api";
import { connText } from "./connection.i18n";
import { profileName } from "./describe";

declare global {
  interface Window {
    /** 为什么先显示连接选择：按住了 ⌥，或者上次启动没能完成。Rust 建窗时注入 */
    __TW_PICK__?: "option" | "unfinished";
  }
}

/**
 * 启动时的连接选择（设计稿 ⑦ 右）。
 *
 * 按住 ⌥ 启动，或者连着两次启动没能走到就绪时，**先显示这个小窗口，主窗口等选好了再开**。
 * 它不依赖 core 的任何数据：列表来自应用自己存的那一份。
 *
 * 「连接」连选中的那一个、打开主界面；「管理连接…」同样连选中的那一个，主界面落到设置页
 * 的「连接」一节。**没有「不连」**：关掉这扇窗，菜单栏里的「连接」子菜单还能选。
 */
export default function PickerWindow() {
  const t = useText(connText);
  const [view, setView] = useState<ConnView | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    void connApi.view().then((v) => {
      setView(v);
      setChosen(v.profiles.some((p) => p.id === v.last_used) ? v.last_used : "local");
    });
  }, []);

  // 量出内容多高再定窗口，第一次量完才亮出来（和更新窗口一样，理由见 `window::fit`）
  useEffect(() => {
    const el = body.current;
    if (!view || !el) return;
    const fit = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      void invoke("picker_fit", { height })
        .then(async () => {
          if (shown.current) return;
          shown.current = true;
          const w = getCurrentWindow();
          await w.show();
          await w.setFocus();
        })
        .catch(() => {});
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  async function go(then: string | null) {
    if (!chosen || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await connApi.pick(chosen, then);
    } catch (e) {
      setFailed(errorText(e));
      setBusy(false);
    }
  }

  if (!view) return null;
  const why = window.__TW_PICK__ === "option" ? t.pickOption : t.pickUnfinished;

  return (
    <div className="min-h-screen bg-background text-foreground select-none">
      <div ref={body} className="flex flex-col gap-3 p-5">
        <div>
          <h1 className="tw-title font-semibold">{t.pickTitle}</h1>
          <p className="mt-1 tw-body text-muted-foreground">{why}</p>
        </div>
        <RadioGroup value={chosen ?? ""} onValueChange={setChosen} disabled={busy} aria-label={t.pickTitle} className="flex flex-col gap-1">
          {view.profiles.map((p) => {
            const on = p.id === chosen;
            const Icon = p.local ? IconLocal : IconRemote;
            return (
              <Label
                key={p.id}
                onDoubleClick={() => void go(null)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  on ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <RadioGroupItem value={p.id} autoFocus={on} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!busy) void go(null); } }} />
                <Icon className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate tw-body font-medium">{profileName(p)}</span>
                  <span className="block truncate font-mono tw-label text-muted-foreground">
                    {p.local ? view.data_dir : p.addr}
                  </span>
                </span>
                {p.id === view.last_used && <Badge variant="secondary">{t.lastUsed}</Badge>}
              </Label>
            );
          })}
        </RadioGroup>
        {failed && <p className="tw-body text-destructive">{failed}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Button variant="ghost" disabled={busy} onClick={() => void go("settings")}>
            {t.manage}
          </Button>
          <Button className="ml-auto" disabled={busy || !chosen} onClick={() => void go(null)}>
            {t.connect}
          </Button>
        </div>
      </div>
    </div>
  );
}
