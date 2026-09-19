import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Field } from "@/ui/field";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { LANG_NAMES, setLang, useText, type Lang } from "@/i18n";
import { languageText } from "./Language.i18n";

/** 现在用的、设置里选的（`null` 是跟随系统）、系统的 */
interface LanguageView {
  current: Lang;
  setting: Lang | null;
  system: Lang;
}

/**
 * 设置页的语言。
 *
 * **跟随系统是一个选项，不是一个开关。**只有两种语言，三个选项放进一个
 * 下拉框就说完了；括号里写出系统现在是哪种，选它之前就知道会得到什么。
 */
export function LanguageSection() {
  const t = useText(languageText);
  const [view, setView] = useState<LanguageView | null>(null);
  useEffect(() => {
    void invoke<LanguageView>("app_language").then(setView).catch(() => {});
  }, []);
  if (!view) return null;

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <Field className="mt-2 max-w-72">
        <NativeSelect
          aria-label={t.title}
          value={view.setting ?? "system"}
          onChange={async (e) => {
            const v = e.target.value;
            const setting: Lang | null = v === "zh" || v === "en" ? v : null;
            try {
              const next = await invoke<LanguageView>("set_language", { setting });
              setView(next);
              // 事件也会到，这里先换：不让界面等一趟往返
              setLang(next.current);
            } catch (err) {
              toast.error(typeof err === "string" ? err : t.saveFailed);
            }
          }}
        >
          <NativeSelectOption value="system">{t.system(LANG_NAMES[view.system])}</NativeSelectOption>
          <NativeSelectOption value="zh">{LANG_NAMES.zh}</NativeSelectOption>
          <NativeSelectOption value="en">{LANG_NAMES.en}</NativeSelectOption>
        </NativeSelect>
      </Field>
    </section>
  );
}
