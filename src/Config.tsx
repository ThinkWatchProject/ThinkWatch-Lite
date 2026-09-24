import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import Update from "./Update";
import NoticeSettings from "./NoticeSettings";
import { LanguageSection } from "./Language";
import { AppearanceSection } from "./Appearance";
import MenubarSettings from "./MenubarSettings";
import { ListenSection } from "./settings/ListenSection";
import { RetentionSection } from "./settings/RetentionSection";
import { ConnectionsSection } from "./connection/ConnectionsSection";
import type { CoreStatus, Overview } from "./types";
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
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import type { RemoteCore } from "@/connection/api";

/**
 * 设置：这个应用自己的，和网关那几项配一次就不动的。
 *
 * **两类东西，两种改法。**语言、外观、开机启动、提醒改的是这个应用，点一下
 * 就换；监听、日志保留改的是 config.yaml，改完点保存才生效 —— 它们
 * 改错的代价是客户端连不上、或者日志被删。上游、路由、密钥这些要天天看、
 * 常常改的，各有自己的页。
 */
export default function Config({
  ov,
  status,
  onChanged,
}: {
  ov: Overview | null;
  status: CoreStatus | null;
  /** 存完监听设置之后叫一声，状态和概览跟着重读 */
  onChanged: () => void;
}) {
  const t = useText(configText);
  const rt = useText(remoteText);
  const remote = useRemote();
  useEffect(() => {
    void invoke<boolean>("autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);
  // 开机自启。**出厂是关的** —— null 表示还没读到，别在读到之前先画一个
  // 勾或不勾出来：那一瞬间画错的话，用户会以为是自己之前设的。
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const autostartSection = (
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
              toast.error(errorText(err));
            }
          }}
        />
        <FieldContent>
          <FieldLabel htmlFor="autostart">{t.autostartLabel}</FieldLabel>
          <FieldDescription>
            {/*
                一句话说清开了会怎样，不用悬停才看得到。出厂是关的（装完就往
                登录项里写东西的工具，用户第一次发现它是在系统设置里看到一个
                自己没同意过的条目），但开关本身就显示着关，不用再写一遍。
              */}
            {t.autostartNote}
          </FieldDescription>
        </FieldContent>
      </Field>
    </section>
  );
  const serverSections = (
    <>
      {/* 监听原来在「接入」页上，和密钥同屏。它是配一次就不动的网关设置，
          和密钥（要天天拿去填客户端）不是一类东西 */}
      {ov && (
        <ListenSection
          view={ov.listen}
          status={status}
          configVersion={ov.config_version}
          onChanged={onChanged}
        />
      )}

      {/*
        日志保留归设置，不归流量页。**它管的是「留多久」，不是「看哪一段」**
        —— 那一页上曾经有个时间范围选择器，而让人先选一段才能开始搜，
        等于在一个本来就不大的集合前面加一道门。
      */}
      {ov && (
        <RetentionSection retention={ov.retention} configVersion={ov.config_version} />
      )}
    </>
  );

  /*
    **连着远程 core 时分成两组**（设计稿 ⑧）：改这个应用自己的，和改服务器配置的。
    混在一起的话，「语言」和「监听」挨着，用户分不清哪一项改的是服务器。诊断包在
    这时不给：它生成在服务器的文件系统上，远程拿不到。
  */
  if (remote) {
    return (
      <div className="space-y-8 p-5">
        <Group title={rt.appGroup}>
          <ConnectionsSection />
          <LanguageSection />
          <AppearanceSection />
          <MenubarSettings />
          {autostartSection}
          <Update />
          <NoticeSettings />
          <About remote={remote} />
          <Uninstall remote={remote} />
        </Group>
        <Group title={rt.serverGroup(remote.name)}>
          {serverSections}
          <p className="tw-body text-muted-foreground">{rt.controlReadOnly}</p>
        </Group>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-5">
      {/* 最上面：连不上的时候用户就是来这里的 */}
      <ConnectionsSection />

      <LanguageSection />

      <AppearanceSection />

      <MenubarSettings />

      {autostartSection}

      {serverSections}

      <Update />
      <NoticeSettings />

      {/* 诊断包和卸载改的是这个应用本身，归「设置」 */}
      <About remote={null} />

      <Diagnostics />

      <Uninstall remote={null} />
    </div>
  );
}

/** 远程模式下设置页的一组。组名比各节标题低一档，只是分隔 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <h2 className="border-b border-border pb-1.5 tw-label font-medium text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

/**
 * 关于。
 *
 * **排查时最先要问的就是这几个**：哪个版本、数据在哪、core 从哪儿加载的。
 * 之前它们只在日志里，而用户在交出诊断包之前根本看不到自己要交什么。
 */
function About({ remote }: { remote: RemoteCore | null }) {
  const t = useText(configText);
  const rt = useText(remoteText);
  const [info, setInfo] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    void invoke<Record<string, string>>("app_info")
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (!info) return null;
  // 连着远程时说连的是哪一台、它的 core 是哪一版；本机 core 的二进制那时不在用
  const rows: [string, string][] = remote
    ? [
        [t.version, info.version ?? "—"],
        [rt.connection, `${remote.name} · ${remote.addr}`],
        [rt.serverCore, remote.core ?? "—"],
        [t.dataDir, info.data_dir ?? "—"],
      ]
    : [
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
function Uninstall({ remote }: { remote: RemoteCore | null }) {
  const t = useText(configText);
  const rt = useText(remoteText);
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
            {remote && <span className="mt-1 block">{rt.uninstallServer(remote.name)}</span>}
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
