import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import Update from "./Update";
import NoticeSettings from "./NoticeSettings";
import { LanguageSection } from "./Language";
import { AppearanceSection } from "./Appearance";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/ui/field";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { ButtonGroup } from "@/ui/button-group";
import { Tip } from "@/ui/tip";
import { toast } from "sonner";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { configText } from "./Config.i18n";
import { errorText } from "@/i18n/core.i18n";

/** 应用自己的设置。网关的配置在「接入」「上游」「路由」几页 */
export default function Config() {
  const t = useText(configText);
  useEffect(() => {
    void invoke<boolean>("autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);
  // 开机自启。**出厂是关的** —— null 表示还没读到，别在读到之前先画一个
  // 勾或不勾出来：那一瞬间画错的话，用户会以为是自己之前设的。
  const [autostart, setAutostart] = useState<boolean | null>(null);
  return (
    <div className="space-y-8 p-5">
      <LanguageSection />

      <AppearanceSection />

      <section>
        <h2 className="tw-title font-semibold">{t.autostartTitle}</h2>
        <Field orientation="horizontal" className="mt-2">
          {/*
              **开关而不是复选框。**复选框是「在一组里挑几个」，而这是
              「打开或关掉一个系统行为」—— macOS 的系统设置里这一类一律
              是开关。`Field` 的 horizontal 布局两者通用。
            */}
          <Switch
            id="autostart"
            checked={autostart === true}
            disabled={autostart === null}
            onCheckedChange={async (checked) => {
              const want = checked === true;
              // 先乐观地画上，失败再弹回去 —— 但**以后端返回的实际
              // 状态为准**，不是以这里传出去的那个为准。注册可能失败
              // （只读的 LaunchAgents 目录、权限），那时勾必须弹回去。
              setAutostart(want);
              try {
                setAutostart(
                  await invoke<boolean>("set_autostart", { on: want }),
                );
              } catch (err) {
                setAutostart(!want);
                toast.error(typeof err === "string" ? err : String(err));
              }
            }}
          />
          <FieldContent>
            <FieldLabel htmlFor="autostart">{t.autostartLabel}</FieldLabel>
            <FieldDescription>
              {/*
                  说清「默认是关的」和「勾了会发生什么」。一个装完就往
                  登录项里写东西的工具，用户第一次发现它是在系统设置里
                  看到一个自己没同意过的条目 —— 所以这里出厂不勾，而且
                  要讲清勾上之后系统设置里会多出什么。
                */}
              {t.autostartNote((label) => (
                <Tip text={t.autostartTip}>
                  <span className="underline decoration-dotted underline-offset-2">
                    {label}
                  </span>
                </Tip>
              ))}
            </FieldDescription>
          </FieldContent>
        </Field>
      </section>

      <Update />
      <NoticeSettings />

      {/* 诊断包和卸载改的是这个应用本身，归「设置」 */}
      <About />

      <Diagnostics />

      <Uninstall />
    </div>
  );
}

/**
 * 关于。
 *
 * **排查时最先要问的就是这几个**：哪个版本、数据在哪、core 从哪儿加载的。
 * 之前它们只在日志里，而用户在交出诊断包之前根本看不到自己要交什么。
 */
function About() {
  const t = useText(configText);
  const [info, setInfo] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    void invoke<Record<string, string>>("app_info")
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (!info) return null;
  const rows: [string, string][] = [
    [t.version, info.version ?? "—"],
    [t.dataDir, info.data_dir ?? "—"],
    [t.coreBin, info.core_bin ?? "—"],
  ];
  return (
    <section>
      <h2 className="tw-title font-semibold">{t.aboutTitle}</h2>
      <dl className="mt-2 space-y-0.5 tw-body">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3">
            {/* 96px：中文的标签只要 80，英文的 Data directory 要 86 —— 窄了会折成两行 */}
            <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-all font-mono tw-label text-muted-foreground">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * 诊断包（M6+）。
 *
 * 遇到问题时一次性交出「我这儿是什么情况」，省掉来回问一轮（版本？配置？
 * 哪家上游？）—— 而每一趟都可能问漏。
 *
 * **里面的东西全部脱敏过，但仍然要求用户自己看一眼再交出去。**我们是个
 * 看得见所有 API key 的网关，这一步值得多花十秒。
 */
function Diagnostics() {
  const t = useText(configText);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.diagnosticsTitle}</h2>
      <p className="mt-1 tw-body text-muted-foreground">
        {t.diagnosticsBody((label) => (
          <Tip text={t.diagnosticsTip}>
            <span className="underline decoration-dotted underline-offset-2">
              {label}
            </span>
          </Tip>
        ))}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setPath(await invoke<string>("save_diagnostics"));
          } catch (e) {
            // Tauri 的 invoke 用字符串 reject，不是 Error
            toast.error(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner />}
        {t.generate}
      </Button>
      {path && (
        <div className="mt-2 tw-body">
          {t.saved(<code className="break-all">{path}</code>)}
          <div className="mt-1 text-muted-foreground">
            {t.review((text) => (
              <span className="font-medium">{text}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 完全卸载（第二层的第三个入口）。
 *
 * **macOS 上删除应用没有卸载钩子。**拖进废纸篓就是拖进废纸篓，我们没有
 * 任何机会做清理 —— 而那时五个客户端的 `base_url` 全都指向一个已经没有
 * 东西在听的端口，所有 AI 客户端同时失效，用户很可能已经忘了是什么改的。
 *
 * 所以这个入口必须存在，而且要在他还没删应用的时候就看得见。
 *
 * 顺序是**先还原、再注销自启、最后才提删数据** —— 反过来的话，中途失败
 * 会留下一个「客户端还指着一个不在的端口」的状态，而那正是这一整节要
 * 防的事。
 */
function Uninstall() {
  const t = useText(configText);
  const common = useText(commonText);
  const [step, setStep] = useState<"idle" | "ask" | "done">("idle");
  const [drop, setDrop] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (step === "done") {
    return (
      <section className="rounded-md border border-border p-3 tw-body">
        <h2 className="tw-title font-semibold">{t.uninstalled}</h2>
        <ul className="mt-2 space-y-0.5 text-muted-foreground">
          {log.map((l, i) => (
            <li key={i}>· {l}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border p-3 tw-body">
      <h2 className="tw-title font-semibold">{t.uninstallTitle}</h2>
      {step === "idle" ? (
        <div className="mt-1.5 flex items-start justify-between gap-4">
          <p className="text-muted-foreground">
            {t.uninstallIntro((text) => (
              <span className="font-medium">{text}</span>
            ))}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setStep("ask")}
          >
            {t.uninstall}
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 space-y-2">
          <p className="text-muted-foreground">{t.willDo}</p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>· {t.restoreClients}</li>
            <li>· {t.stopAutostart}</li>
          </ul>
          <Field
            orientation="horizontal"
            className="w-auto text-muted-foreground"
          >
            <Checkbox
              id="drop-data"
              checked={drop}
              onCheckedChange={(c) => setDrop(c === true)}
            />
            {/* **默认不删。**请求历史和成本记录是用户自己的东西，而
                「删了才发现还想看」是不可逆的 */}
            <FieldLabel htmlFor="drop-data">{t.dropData}</FieldLabel>
          </Field>
          <ButtonGroup>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setLog(
                    await invoke<string[]>("uninstall", { dropData: drop }),
                  );
                  setStep("done");
                } catch (e) {
                  setLog([errorText(e)]);
                  setStep("done");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.confirmUninstall}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setStep("idle")}>
              {common.cancel}
            </Button>
          </ButtonGroup>
        </div>
      )}
    </section>
  );
}
