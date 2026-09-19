import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/ui/button";
import { Field, FieldContent, FieldLabel } from "@/ui/field";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { toast } from "sonner";
import { useText } from "@/i18n";
import type { Found, UpdateView } from "./updateFlow";
import { updateText } from "./Update.i18n";

/**
 * 设置里的「更新」。
 *
 * **这里不装任何东西。**查到新版本时打开的是更新窗口 —— 自动检查查到的
 * 和这里手动查到的，走的是同一个窗口、同一套按钮。两处各有一套安装界面
 * 的话，其中一套迟早会和另一套说不一样的话。
 */
export default function Update() {
  const t = useText(updateText);
  const [view, setView] = useState<UpdateView | null>(null);
  /** 这次打开设置页之后查过没有 —— 「已是最新版本」只有在真查过之后才该说 */
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void invoke<UpdateView>("update_state").then(setView).catch(() => {});
  }, []);

  // 后台那轮自动检查查到了，这里也要跟着显示
  useEffect(() => {
    const un = listen<Found>("update-found", (e) =>
      setView((v) => (v ? { ...v, offer: e.payload } : v)),
    );
    return () => {
      void un.then((f) => f());
    };
  }, []);

  if (!view) return null;

  const look = async () => {
    setBusy(true);
    try {
      // 查到的话 Rust 那边会把更新窗口拉起来
      const found = await invoke<Found | null>("update_check");
      setView((v) => (v ? { ...v, offer: found } : v));
      setLooked(true);
    } catch (e) {
      toast.error(t.checkFailed(typeof e === "string" ? e : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>

      <Field orientation="horizontal" className="mt-2">
        <Switch
          id="check-updates"
          checked={view.check_updates}
          onCheckedChange={async (checked) => {
            const want = checked === true;
            const before = view;
            // 先画上，以后端返回的实际状态为准 —— 写不进去的时候
            // 开关必须弹回去（和开机自启同一条纪律）。
            setView({ ...view, check_updates: want });
            try {
              setView(await invoke<UpdateView>("set_update_check", { on: want }));
            } catch (err) {
              setView(before);
              toast.error(typeof err === "string" ? err : String(err));
            }
          }}
        />
        <FieldContent>
          <FieldLabel htmlFor="check-updates">{t.autoCheck}</FieldLabel>
        </FieldContent>
      </Field>

      <div className="mt-3 flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void look()}>
          {busy && <Spinner />}
          {t.checkNow}
        </Button>
        <span className="tw-body text-muted-foreground">
          {view.offer
            ? t.newer(view.offer.version, view.version)
            : looked
              ? t.latest(view.version)
              : t.current(view.version)}
        </span>
      </div>
    </section>
  );
}
