import type { ReactNode } from "react";
import { useText } from "@/i18n";
import { appText } from "@/App.i18n";
import { SURFACES } from "@/nav";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { COMBOS, Keys, pageCombo, type Combo } from "./keys";
import { paletteText } from "./palette.i18n";

/**
 * 快捷键一览：`?`，或者命令面板左下角。
 *
 * **只列真有的键**，和判定它们的地方一一对应：全局的在 App.tsx，流量表的在
 * TrafficPage，命令面板的是 cmdk 自带的加上退格返回。改了键位要来这里改一行。
 * 一行里几个键帽并排是「按哪个都行」（↑ ↓），一个键帽里的几个键是同时按（⌘K）。
 */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useText(paletteText).sheet;
  const app = useText(appText);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // 开着它也照样能按 ⌘K、⌘1…⌘9（见 `modalOpen`）
        data-passive=""
        aria-describedby={undefined}
        className="max-h-[calc(100vh-4rem)] gap-0 overflow-y-auto p-0 sm:max-w-[640px]"
        // 打开时焦点放在对话框本身，不落在右上角的 ×：WebKit 里脚本聚焦的按钮会画一圈框
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        // 关上时不把焦点塞回去：打开它的多半是 `?` 或面板里的按钮，塞回按钮上又是一圈框；
        // 按 ⌘K 从这里换到命令面板时，焦点该在面板的输入框里
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          // 再按一次 ? 关掉，和打开它的键一样
          if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            onOpenChange(false);
            return;
          }
          // 流量表挂在 window 上的方向键、回车，这时候不该在背后动
          if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-1">
          <DialogTitle className="tw-title">{t.title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-10 px-5 pt-2 pb-5">
          <div className="flex flex-col gap-5">
            <Section title={t.general}>
              <Line label={t.openPalette} combos={[COMBOS.palette]} />
              <Line label={t.refresh} combos={[COMBOS.refresh]} />
              <Line label={t.rail} combos={[COMBOS.rail]} />
              <Line label={t.shortcuts} combos={[COMBOS.shortcuts]} />
            </Section>
            <Section title={t.pages}>
              {SURFACES.map((s, i) => (
                <Line
                  key={s}
                  label={app.surfaces[s]}
                  combos={s === "settings" ? [pageCombo(i), COMBOS.settings] : [pageCombo(i)]}
                />
              ))}
            </Section>
          </div>
          <div className="flex flex-col gap-5">
            <Section title={t.traffic}>
              <Line label={t.search} combos={[COMBOS.search]} />
              <Line label={t.rowMove} combos={[["up"], ["down"]]} />
              <Line label={t.rowOpen} combos={[["enter"]]} />
              <Line label={t.groupToggle} combos={[["right"], ["left"]]} />
              <Line label={t.detailClose} combos={[["esc"]]} />
            </Section>
            <Section title={t.palette}>
              <Line label={t.itemMove} combos={[["up"], ["down"]]} />
              <Line label={t.groupMove} combos={[["alt", "up"], ["alt", "down"]]} />
              <Line label={t.itemRun} combos={[["enter"]]} />
              <Line label={t.levelBack} combos={[["backspace"]]} />
              <Line label={t.close} combos={[["esc"]]} />
            </Section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 border-b border-border pb-1.5 tw-label font-medium text-muted-foreground">{title}</h3>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function Line({ label, combos }: { label: string; combos: Combo[] }) {
  return (
    <div className="flex h-8 items-center justify-between gap-4 tw-body">
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {combos.map((c) => (
          <Keys key={c.join("+")} combo={c} />
        ))}
      </span>
    </div>
  );
}
