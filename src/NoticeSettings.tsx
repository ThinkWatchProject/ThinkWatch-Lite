import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Segmented } from "@/upstreams/parts";
import { useText } from "@/i18n";
import { noticeSettingsText } from "./NoticeSettings.i18n";
import { errorText } from "@/i18n/core.i18n";

export type NoticeMode = "system" | "app" | "off";

/**
 * 设置里的「提醒」：系统通知 / 仅在应用内 / 关闭。
 *
 * **只有一个开关，不分类。**哪件事该打断人是通知总线的判断（见
 * `src-tauri/src/notices`），不该变成设置页上的一长串下拉。三档固定，
 * 所以和外观一样摆成三个按钮。
 */
export default function NoticeSettings() {
  const t = useText(noticeSettingsText);
  const [mode, setMode] = useState<NoticeMode | null>(null);

  useEffect(() => {
    void invoke<NoticeMode>("notice_mode")
      .then(setMode)
      .catch(() => {});
  }, []);

  if (!mode) return null;

  async function choose(next: NoticeMode) {
    const before = mode;
    // 先画上，以后端返回的为准 —— 存不进去的时候要弹回去
    setMode(next);
    try {
      setMode(await invoke<NoticeMode>("set_notice_mode", { mode: next }));
    } catch (e) {
      setMode(before);
      toast.error(errorText(e));
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <div className="mt-2">
        <Segmented<NoticeMode>
          value={mode}
          options={[
            { id: "system", label: t.system },
            { id: "app", label: t.app },
            { id: "off", label: t.off },
          ]}
          onChange={(v) => void choose(v)}
        />
      </div>
    </section>
  );
}
