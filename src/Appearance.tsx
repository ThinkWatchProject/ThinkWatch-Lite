import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useText } from "@/i18n";
import { Segmented } from "@/upstreams/parts";
import { appearanceText } from "./Appearance.i18n";

type Theme = "light" | "dark";
type Choice = "system" | Theme;

/** 现在用的、设置里选的（`null` 是跟随系统）、系统的 */
interface ThemeView {
  current: Theme;
  setting: Theme | null;
  system: Theme;
}

/**
 * 设置页的外观。
 *
 * **换的是窗口的外观，不是一套 CSS。**Rust 侧改 `NSApp` 的外观，WKWebView
 * 继承它，`prefers-color-scheme` 跟着翻 —— 界面这边什么都不用做，也不需要
 * 在 `<html>` 上挂类（见 `src/index.css` 开头和 `src-tauri/src/theme.rs`）。
 * 所以这里存完就结束了，没有第二步。
 *
 * **三个按钮，不是下拉。**一共就这三档，摆出来点一下就换；语言那边是下拉，
 * 因为语种还会增加。
 */
export function AppearanceSection() {
  const t = useText(appearanceText);
  const [view, setView] = useState<ThemeView | null>(null);
  useEffect(() => {
    void invoke<ThemeView>("app_theme").then(setView).catch(() => {});
  }, []);
  if (!view) return null;

  async function choose(v: Choice) {
    const setting: Theme | null = v === "system" ? null : v;
    try {
      setView(await invoke<ThemeView>("set_theme", { setting }));
    } catch (err) {
      toast.error(typeof err === "string" ? err : t.saveFailed);
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <div className="mt-2 flex flex-col gap-1.5">
        <Segmented<Choice>
          value={view.setting ?? "system"}
          options={[
            { id: "system", label: t.system },
            { id: "light", label: t.light },
            { id: "dark", label: t.dark },
          ]}
          onChange={(v) => void choose(v)}
        />
        {/* 跟随系统时写出系统现在是哪一档 —— 否则这一行只说了「跟着走」，
            没说会走到哪里去 */}
        {view.setting == null && (
          <p className="tw-label text-muted-foreground">
            {t.systemNow(view.system === "dark" ? t.dark : t.light)}
          </p>
        )}
      </div>
    </section>
  );
}
