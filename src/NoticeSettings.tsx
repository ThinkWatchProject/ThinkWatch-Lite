import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { useText } from "@/i18n";
import { noticeSettingsText } from "./NoticeSettings.i18n";
import { errorText } from "@/i18n/core.i18n";

export type NoticeMode = "system" | "app" | "off";

export interface NoticePref {
  category: string;
  label: string;
  mode: NoticeMode;
}

export const modes = (t: typeof noticeSettingsText.zh): { id: NoticeMode; label: string }[] => [
  { id: "system", label: t.system },
  { id: "app", label: t.app },
  { id: "off", label: t.off },
];

/**
 * 设置里的「提醒」：每一类怎么对待。
 *
 * **按类，不按条** —— 「不再提醒这一条」对明天还会再发生的事没有意义。
 */
export default function NoticeSettings() {
  const t = useText(noticeSettingsText);
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
      toast.error(errorText(e));
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <p className="mt-1 tw-body text-muted-foreground">
        {t.note}
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
              {modes(t).map((m) => (
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
