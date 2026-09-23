import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Segmented } from "@/ui/segmented";
import { useText } from "@/i18n";
import { isMac } from "@/platform";
import { errorText } from "@/i18n/core.i18n";
import { menubarSettingsText } from "./MenubarSettings.i18n";

export type MenubarStyle = "full" | "icon" | "numbers";

/**
 * 设置里的「菜单栏」：标识和数值 / 仅标识 / 仅数值。数值是今日 token 和今日费用。
 *
 * 和外观、提醒一样是应用自己的设置，**改了就生效**，不走配置文件的「保存」。
 */
export default function MenubarSettings() {
  const t = useText(menubarSettingsText);
  const [style, setStyle] = useState<MenubarStyle | null>(null);

  useEffect(() => {
    if (!isMac) return;
    void invoke<MenubarStyle>("menubar_style")
      .then(setStyle)
      .catch(() => {});
  }, []);

  // **只有 macOS 有这三档。**别处的通知区只认一张正方形图标（100% DPI 下
  // 16×16），塞不下两行数字 —— 那几行在右键菜单里给。留着一个点了没反应的
  // 选择，比没有这一节糟。
  if (!isMac) return null;
  if (!style) return null;

  async function choose(next: MenubarStyle) {
    const before = style;
    // 先画上，以后端返回的为准 —— 存不进去的时候要弹回去
    setStyle(next);
    try {
      setStyle(await invoke<MenubarStyle>("set_menubar_style", { style: next }));
    } catch (e) {
      setStyle(before);
      toast.error(errorText(e));
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <div className="mt-2">
        <Segmented<MenubarStyle>
          value={style}
          options={[
            { id: "full", label: t.full },
            { id: "icon", label: t.icon },
            { id: "numbers", label: t.numbers },
          ]}
          onChange={(v) => void choose(v)}
        />
      </div>
    </section>
  );
}
