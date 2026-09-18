import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";

export type NoticeMode = "system" | "app" | "off";

export interface NoticePref {
  category: string;
  label: string;
  mode: NoticeMode;
}

export const MODES: { id: NoticeMode; label: string }[] = [
  { id: "system", label: "系统通知" },
  { id: "app", label: "仅在应用内" },
  { id: "off", label: "关闭" },
];

/**
 * 设置里的「提醒」：每一类怎么对待。
 *
 * **按类，不按条** —— 「不再提醒这一条」对明天还会再发生的事没有意义。
 */
export default function NoticeSettings() {
  const [prefs, setPrefs] = useState<NoticePref[] | null>(null);

  useEffect(() => {
    void invoke<NoticePref[]>("notice_prefs")
      .then(setPrefs)
      .catch(() => {});
  }, []);

  if (!prefs) return null;

  async function set(category: string, mode: NoticeMode) {
    const before = prefs;
    // 先画上，以后端返回的为准 —— 写不进去的时候要弹回去
    setPrefs((p) => p?.map((x) => (x.category === category ? { ...x, mode } : x)) ?? p);
    try {
      setPrefs(await invoke<NoticePref[]>("set_notice_pref", { category, mode }));
    } catch (e) {
      setPrefs(before);
      toast.error(typeof e === "string" ? e : String(e));
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">提醒</h2>
      <p className="mt-1 tw-body text-muted-foreground">
        选择「系统通知」的类别在需要处理时弹出系统通知，其余只记录在工具栏的提醒列表中。
      </p>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2">
        {prefs.map((p) => (
          <div key={p.category} className="contents">
            <label htmlFor={`notice-${p.category}`} className="tw-body">
              {p.label}
            </label>
            <NativeSelect
              id={`notice-${p.category}`}
              value={p.mode}
              onChange={(e) => void set(p.category, e.target.value as NoticeMode)}
            >
              {MODES.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
    </section>
  );
}
