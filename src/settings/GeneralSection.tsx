import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Reveal } from "@/ui/motion";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";
import { Button } from "@/ui/button";
import { notify } from "@/ui/notify";
import { guideText } from "@/guide/guide.i18n";
import { resetHints, useAnyDismissed } from "@/guide/hints";
import { resetIgnored, useAnyIgnored } from "@/ignore";
import { invalidate, useResource } from "@/lib/resource";
import { useTauriEvent } from "@/lib/tauriEvent";
import { LANG_NAMES, setLang, useText, type Lang } from "@/i18n";
import { isMac } from "@/platform";
import { errorText } from "@/i18n/core.i18n";
import { COMBOS, comboText, hotkeyCombo, isInAppCombo, Keys } from "@/palette/keys";
import {
  APP_KEYS,
  settingsApi,
  ZOOM_STEPS,
  type HotkeyCombo,
  type HotkeyView,
  type LanguageView,
  type MenubarStyle,
  type NoticeMode,
  type ThemeChoice,
  type ThemeView,
  type UiZoom,
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
  // 通用偏好经同步从别的设备过来、Rust 那边已经换上了：这几项重读（`src-tauri/src/client_prefs.rs`）
  useTauriEvent<null>("client-prefs-applied", () => invalidate("app:"));
  return (
    <SettingsGroup id="general" title={t.title}>
      <SettingsCard>
        <LanguageRow />
        <AppearanceRow />
        <ZoomRow />
        <HotkeyRow />
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
 * 界面大小：整个界面等比缩放（webview 的缩放，见 `src-tauri/src/zoom.rs`），存在这台
 * 电脑上、不同步。快捷键（`shell/Workspace.tsx`）和命令面板换了档，Rust 发
 * `ui-zoom-changed`，这一行跟着动。
 */
function ZoomRow() {
  const t = useText(generalText);
  const r = useResource(APP_KEYS.zoom, settingsApi.zoom);
  const [, set] = useWrite(r, settingsApi.setZoom);
  const { mutate } = r;
  useTauriEvent<UiZoom>("ui-zoom-changed", (e) => void mutate(e.payload));
  return (
    <SettingsRow
      anchor="zoom"
      label={t.zoom}
      description={t.zoomKeys(comboText(COMBOS.zoomIn), comboText(COMBOS.zoomOut), comboText(COMBOS.zoomReset))}
      control={
        <Loaded r={r} width="w-72">
          {(zoom) => (
            <Segmented<string>
              label={t.zoom}
              value={String(zoom)}
              options={ZOOM_STEPS.map((s) => ({ id: String(s), label: `${s}%` }))}
              onChange={(s) => {
                const next = ZOOM_STEPS.find((z) => String(z) === s);
                if (next !== undefined) void set(next);
              }}
            />
          )}
        </Loaded>
      }
    />
  );
}

/** 录入时不当主键的键：修饰键自己按下时还在等主键 */
const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "Fn",
]);

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

/**
 * 呼出快捷键（`src-tauri/src/hotkey.rs`）：出厂是 Ctrl+Alt+H（⌃⌥H），可以录一个别的、关掉、
 * 恢复缺省。**点一下就生效**，和这一节别的行一样。
 *
 * 录入：点那个框，按下组合键；Esc 取消、点别处也取消。录入期间 Rust 先放掉现在的那一个
 * （`setHotkeyRecording`），不然按下它窗口就收起了。**先在这里挡掉两种**：没带修饰键的
 * （F1–F12 除外）、和界面里已有的快捷键相同的（拿去做呼出，界面里那个就按不到了）。
 * 被别的程序占着的由 Rust 注册时发现，原来那一个照旧。
 *
 * 说明那一行在出问题时换成红字：录的不能用、注册不上，或者设置里那个启动时就被占着
 * （`active` 是 false）。
 */
function HotkeyRow() {
  const t = useText(generalText);
  const r = useResource(APP_KEYS.hotkey, settingsApi.hotkey);
  const { mutate, reload } = r;
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLButtonElement>(null);
  const recordingNow = useRef(false);

  const record = (on: boolean) => {
    if (recordingNow.current === on) return;
    recordingNow.current = on;
    setRecording(on);
    settingsApi.setHotkeyRecording(on).catch((e: unknown) => notify.error(e));
    if (!on) void reload();
  };
  // 录到一半离开设置页：注册回去
  useEffect(
    () => () => {
      if (recordingNow.current) void settingsApi.setHotkeyRecording(false).catch(() => undefined);
    },
    [],
  );

  // 取消录入：刚才那句「不能用」也不留
  const cancel = () => {
    setProblem(null);
    record(false);
  };

  const save = async (combo: HotkeyCombo | null) => {
    setPending(true);
    try {
      mutate(await settingsApi.setHotkey(combo));
      setProblem(null);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    // 录入时按键都归这里：不翻页、不开命令面板、不触发按钮
    e.preventDefault();
    e.stopPropagation();
    const mods = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
    if (e.code === "Escape" && !mods) {
      cancel();
      return;
    }
    if (MODIFIER_CODES.has(e.code)) return;
    const combo: HotkeyCombo = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code };
    if (!(combo.ctrl || combo.alt || combo.meta || FUNCTION_KEY.test(combo.code))) {
      setProblem(t.hotkeyNeedModifier);
      return;
    }
    const keys = hotkeyCombo(combo);
    if (isInAppCombo(keys)) {
      setProblem(t.hotkeyInApp(comboText(keys)));
      return;
    }
    record(false);
    void save(combo);
  };

  const v: HotkeyView | undefined = r.data;
  const taken = v !== undefined && v.combo !== null && !v.active && !recording;
  const note = !v
    ? undefined
    : !v.supported
      ? t.hotkeyUnsupported
      : (problem ?? (taken ? t.hotkeyTaken : null));
  return (
    <SettingsRow
      anchor="hotkey"
      label={t.hotkey}
      description={
        note ? (
          <span className={v?.supported ? "text-destructive" : undefined}>{note}</span>
        ) : (
          t.hotkeyWhat
        )
      }
      control={
        <Loaded r={r} width="w-60">
          {(v) => (
            <div className="flex items-center gap-2">
              <Button
                ref={field}
                size="sm"
                variant="outline"
                className="min-w-32 justify-center"
                disabled={!v.supported || pending}
                aria-label={t.hotkey}
                aria-pressed={recording}
                onClick={() => {
                  setProblem(null);
                  // WebKit 点按钮不给它焦点：不拿过来的话按键到不了这里
                  if (!recording) field.current?.focus();
                  record(!recording);
                }}
                onBlur={() => {
                  if (recordingNow.current) cancel();
                }}
                onKeyDown={onKeyDown}
              >
                {recording ? (
                  <span className="text-muted-foreground">{t.hotkeyPress}</span>
                ) : v.combo ? (
                  <Keys combo={hotkeyCombo(v.combo)} />
                ) : (
                  <span className="text-muted-foreground">{t.hotkeyNone}</span>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!v.supported || pending}
                onClick={() => {
                  setProblem(null);
                  void save(v.combo ? null : v.default);
                }}
              >
                {v.combo ? t.hotkeyOff : t.hotkeyRestore}
              </Button>
            </div>
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
  // 不显示时还能按呼出快捷键回来（注册着才算）
  const hotkey = useResource(APP_KEYS.hotkey, settingsApi.hotkey).data;
  const back = hotkey?.combo && hotkey.active ? comboText(hotkeyCombo(hotkey.combo)) : null;
  return (
    <SettingsRow
      anchor="menubar"
      label={t.menubar}
      description={
        r.data === "hidden" ? (back ? t.menubarHiddenWhatHotkey(back) : t.menubarHiddenWhat) : t.menubarWhat
      }
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
  const anyIgnored = useAnyIgnored();
  return (
    <SettingsRow
      anchor="guide"
      label={t.hintsLabel}
      description={t.hintsHint}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={!any && !anyIgnored}
          onClick={() => {
            resetHints();
            resetIgnored();
            notify.success(t.hintsResetDone);
          }}
        >
          {t.hintsReset}
        </Button>
      }
    />
  );
}
