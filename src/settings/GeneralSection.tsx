import { useEffect } from "react";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Reveal } from "@/ui/motion";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";
import { Button } from "@/ui/button";
import { notify } from "@/ui/notify";
import { guideText } from "@/guide/guide.i18n";
import { resetHints, useAnyDismissed } from "@/guide/hints";
import { useResource } from "@/lib/resource";
import { useTauriEvent } from "@/lib/tauriEvent";
import { LANG_NAMES, setLang, useText, type Lang } from "@/i18n";
import { isMac } from "@/platform";
import {
  APP_KEYS,
  settingsApi,
  type LanguageView,
  type MenubarStyle,
  type NoticeMode,
  type ThemeChoice,
  type ThemeView,
} from "./api";
import { generalText } from "./GeneralSection.i18n";
import { Loaded, SettingsCard, SettingsGroup, SettingsRow, useWrite } from "./kit";

/**
 * 设置 → 通用。**改的是这个应用自己，点一下就换**，不走配置文件的「保存」：这几项
 * 改错了当场就看得见，也当场改得回来（改监听、日志保留那几节才要保存，见各自的文件）。
 *
 * 每一项都以 Rust 交回的实际状态为准：先按新值画上，存不进去就弹回去并报错。
 */
export function GeneralSection() {
  const t = useText(generalText);
  return (
    <SettingsGroup id="general" title={t.title}>
      <SettingsCard>
        <LanguageRow />
        <AppearanceRow />
        {/*
          **只有 macOS 有这几档。**别处的通知区只认一张正方形图标（100% DPI 下
          16×16），塞不下两行数字 —— 那几行在右键菜单里给；「不显示」也不给，见
          `src-tauri/src/menubar/mod.rs` 的 `drawn_style`
        */}
        {isMac && <MenubarRow />}
        <AutostartRow />
        <NoticesRow />
        <GuideRow />
      </SettingsCard>
    </SettingsGroup>
  );
}

/**
 * 语言。**跟随系统是一个选项，不是一个开关**：只有两种语言，三个选项放进一个
 * 下拉就说完了；括号里写出系统现在是哪种，选之前就知道会得到什么。
 */
function LanguageRow() {
  const t = useText(generalText);
  const r = useResource(APP_KEYS.language, settingsApi.language);
  const [, set] = useWrite(r, async (next: LanguageView) => {
    const v = await settingsApi.setLanguage(next.setting);
    // 事件也会到，这里先换：不让界面等一趟往返
    setLang(v.current);
    return v;
  });
  // 别的窗口（或者系统语言）换了：跟着重读
  useTauriEvent<Lang>("language-changed", () => void r.reload());
  return (
    <SettingsRow
      anchor="language"
      label={t.language}
      htmlFor="settings-language"
      control={
        <Loaded r={r} width="w-48">
          {(v) => (
            <NativeSelect
              id="settings-language"
              size="sm"
              className="w-48"
              value={v.setting ?? "system"}
              onChange={(e) => {
                const x = e.target.value;
                const setting: Lang | null = x === "zh" || x === "en" ? x : null;
                void set({ ...v, setting, current: setting ?? v.system });
              }}
            >
              <NativeSelectOption value="system">{t.languageSystem(LANG_NAMES[v.system])}</NativeSelectOption>
              <NativeSelectOption value="zh">{LANG_NAMES.zh}</NativeSelectOption>
              <NativeSelectOption value="en">{LANG_NAMES.en}</NativeSelectOption>
            </NativeSelect>
          )}
        </Loaded>
      }
    />
  );
}

/**
 * 外观。**换的是窗口的外观，不是一套 CSS**：Rust 侧改 `NSApp` 的外观，WKWebView
 * 继承它，`prefers-color-scheme` 跟着翻（见 `src-tauri/src/theme.rs`），界面这边
 * 存完就结束了。
 */
function AppearanceRow() {
  const t = useText(generalText);
  const r = useResource(APP_KEYS.theme, settingsApi.theme);
  const [, set] = useWrite(r, (next: ThemeView) => settingsApi.setTheme(next.setting));
  const { reload } = r;
  // 跟随系统时系统换了外观：下面那句「系统当前为…」跟着换
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => void reload();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [reload]);
  const v = r.data;
  const following = v !== undefined && v.setting === null;
  return (
    <SettingsRow
      anchor="appearance"
      label={t.appearance}
      // 跟随系统时写出系统现在是哪一档 —— 否则只说了「跟着走」，没说会走到哪里
      description={
        v && (
          <Reveal show={following}>
            <span>{t.systemNow(v.system === "dark" ? t.dark : t.light)}</span>
          </Reveal>
        )
      }
      control={
        <Loaded r={r} width="w-52">
          {(v) => (
            <Segmented<ThemeChoice>
              label={t.appearance}
              value={v.setting ?? "system"}
              options={[
                { id: "system", label: t.system },
                { id: "light", label: t.light },
                { id: "dark", label: t.dark },
              ]}
              onChange={(c) => {
                const setting = c === "system" ? null : c;
                void set({ ...v, setting, current: setting ?? v.system });
              }}
            />
          )}
        </Loaded>
      }
    />
  );
}

/**
 * 菜单栏：标识和数值 / 仅标识 / 仅数值 / 不显示。数值是今日的 token 和费用。
 *
 * **选了不显示，说明那一句换成怎么回到窗口**：窗口关着时应用不在 Dock 里，菜单栏上也
 * 没有它，再打开一次应用是唯一的入口（Rust 那边接的是 `RunEvent::Reopen`）。一直写在
 * 这一行上，而不是弹一次就没了 —— 要找的时候还在这里
 */
function MenubarRow() {
  const t = useText(generalText);
  const r = useResource(APP_KEYS.menubar, settingsApi.menubar);
  const [, set] = useWrite(r, settingsApi.setMenubar);
  const { mutate } = r;
  useTauriEvent<MenubarStyle>("menubar-style-changed", (e) => void mutate(e.payload));
  return (
    <SettingsRow
      anchor="menubar"
      label={t.menubar}
      description={r.data === "hidden" ? t.menubarHiddenWhat : t.menubarWhat}
      control={
        <Loaded r={r} width="w-72">
          {(style) => (
            <Segmented<MenubarStyle>
              label={t.menubar}
              value={style}
              options={[
                { id: "full", label: t.menubarFull },
                { id: "icon", label: t.menubarIcon },
                { id: "numbers", label: t.menubarNumbers },
                { id: "hidden", label: t.menubarHidden },
              ]}
              onChange={(s) => void set(s)}
            />
          )}
        </Loaded>
      }
    />
  );
}

/**
 * 开机启动。**出厂是关的**；读到之前画一块灰，不先画一个开或关 —— 那一瞬间画错
 * 的话，用户会以为是自己之前设的。**开关而不是复选框**：这是「打开或关掉一个系统
 * 行为」，macOS 的系统设置里这一类一律是开关。
 */
function AutostartRow() {
  const t = useText(generalText);
  const r = useResource(APP_KEYS.autostart, settingsApi.autostart);
  const [pending, set] = useWrite(r, settingsApi.setAutostart);
  // 菜单栏设成不显示时，登录后菜单栏上也没有它（和上面那一行同一份数据，不多问一次）
  const menubar = useResource(isMac ? APP_KEYS.menubar : null, settingsApi.menubar);
  return (
    <SettingsRow
      anchor="autostart"
      label={t.autostart}
      htmlFor="settings-autostart"
      description={menubar.data === "hidden" ? t.autostartHiddenWhat : t.autostartWhat}
      control={
        <Loaded r={r} width="h-[18px] w-8 rounded-full">
          {(on) => (
            <Switch
              id="settings-autostart"
              checked={on}
              pending={pending}
              onCheckedChange={(c) => void set(c === true)}
            />
          )}
        </Loaded>
      }
    />
  );
}

/**
 * 提醒：系统通知 / 仅在应用内 / 关闭。**只有一个开关，不分类**：哪件事该打断人是
 * 通知总线的判断（`src-tauri/src/notices`），不该变成设置页上的一长串下拉。
 */
function NoticesRow() {
  const t = useText(generalText);
  const r = useResource(APP_KEYS.noticeMode, settingsApi.noticeMode);
  const [, set] = useWrite(r, settingsApi.setNoticeMode);
  const { mutate } = r;
  useTauriEvent<NoticeMode>("notice-mode-changed", (e) => void mutate(e.payload));
  return (
    <SettingsRow
      anchor="notices"
      label={t.notices}
      control={
        <Loaded r={r} width="w-60">
          {(mode) => (
            <Segmented<NoticeMode>
              label={t.notices}
              value={mode}
              options={[
                { id: "system", label: t.noticeSystem },
                { id: "app", label: t.noticeApp },
                { id: "off", label: t.noticeOff },
              ]}
              onChange={(m) => void set(m)}
            />
          )}
        </Loaded>
      }
    />
  );
}

/**
 * 引导提示：点过「不再显示」的那几条重新显示。**只动这台电脑上的记录**（见
 * `guide/hints.ts`），不写配置文件，所以和这一节别的行一样点一下就生效。一条都没
 * 关过时按钮置灰 —— 按了也不会有任何变化。
 */
function GuideRow() {
  const t = useText(guideText);
  const any = useAnyDismissed();
  return (
    <SettingsRow
      anchor="guide"
      label={t.hintsLabel}
      description={t.hintsHint}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={!any}
          onClick={() => {
            resetHints();
            notify.success(t.hintsResetDone);
          }}
        >
          {t.hintsReset}
        </Button>
      }
    />
  );
}
