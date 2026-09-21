import { Fragment, useRef, useState } from "react";
import { Tip } from "@/ui/tip";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/ui/field";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import Update from "./Update";
import NoticeSettings from "./NoticeSettings";
import { LanguageSection } from "./Language";
import { AppearanceSection } from "./Appearance";
import type { NicView, Overview, PatchOp } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { toast } from "sonner";
import { patchConfig } from "./patch";

import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { ButtonGroup } from "@/ui/button-group";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { configText } from "./Config.i18n";
import { errorText } from "@/i18n/core.i18n";

/**
 * 一个能改的字段。
 *
 * **失焦才提交，而且值没变就什么都不做。**每敲一个键就发一次 patch 会
 * 在历史里堆满噪音，而历史是回滚的依据。
 *
 * 提交时带上 `version` —— 那是乐观并发的凭据。用户在编辑器里同时改了
 * 什么，界面无从知道，所以永远不覆盖。
 */
function EditableCell({
  value,
  path,
  version,
  mono,
}: {
  value: string;
  path: string;
  version: string | null;
  mono?: boolean;
}) {
  const t = useText(configText);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  /**
   * 输入法正在组字。
   *
   * **那条数据丢失就在这儿**：cc-switch 报过一个 12 字符的值被
   * 膨胀成 1396 字符 —— 受控组件在输入法还持有 composition range 时
   * 把 state 写回 DOM。我们是 Tauri（WebKit）+ 中文用户 + 配置输入框，
   * 三个条件全中。
   *
   * 更阴的是 **WebKit 在窗口切换时不发 `compositionend`** —— 用户输到
   * 一半点了别的窗口，那个事件永远不来。所以 `blur` 里要强制收尾。
   */
  const composing = useRef(false);
  // 外面换了版本（别人改了文件）就跟着走 —— 否则用户会盯着一个已经
  // 不存在的值发呆
  useEffect(() => setDraft(value), [value]);

  async function commit() {
    // 组字中不提交 —— 中间态提交上去的是一段还没成形的文本
    if (composing.current || draft === value || busy) return;
    if (!version) {
      toast.error(t.versionNotLoaded);
      setDraft(value);
      return;
    }
    setBusy(true);
    try {
      const ops: PatchOp[] = [{ op: "replace", path, value: draft }];
      // Tauri 的 invoke 用字符串 reject，不是 Error
      await patchConfig(ops, version);
    } catch (e) {
      // **失败时把草稿退回原值。**留着一个没保存成功的值，用户下次
      // 看这一行会以为它已经生效了。
      setDraft(value);
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Input
      value={draft}
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={(e) => {
        composing.current = false;
        setDraft(e.currentTarget.value);
      }}
      onBlur={(e) => {
        // WebKit 窗口切换时不发 `compositionend`，这里强制收尾
        composing.current = false;
        setDraft(e.currentTarget.value);
        void commit();
      }}
      // **macOS 会把 API key 的首字母大写。**一行属性的事，不写就是
      // 一类稳定复现的「key 明明是对的却认证失败」
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        // Esc 放弃这次编辑
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      variant="inline"
      className={cn(mono && "font-mono")}
    />
  );
}

/**
 * 监听方式 —— 网关绑在哪张网卡上。
 *
 * 三个选择对应三件真实不同的事：
 *
 * · **仅本机** `loopback` —— 绑 127.0.0.1。别的设备连不过来。
 * · **指定网卡** `<IP>` —— 绑某一张网卡自己的地址。只有那张网卡所在的
 *   网络连得上。
 * · **所有网卡** `all` —— 绑 0.0.0.0。**每一张**网卡,包括对着公网的那张。
 *
 * 以前中间那档叫「局域网」,而它绑的也是 0.0.0.0 —— 和「所有网卡」是同
 * 一个地址,区别只在来源白名单的默认值。**那是个白名单概念,伪装成了网卡
 * 选择**:用户以为网关只在局域网那张网卡上听,实际它在所有网卡上听。
 *
 * 改完**立刻生效,不用重启**。core 的 `serve_following_config` 在
 * `relisten` 上等通知:地址变了就优雅停掉旧监听器(不再接新连接,在跑
 * 的请求自己跑完)再绑新的 —— nginx reload 的语义。所以这里**不要**加
 * 「重启网关」的按钮:那句提示会让用户以为还没生效,而它早就生效了。
 */
type BindKind = "loopback" | "nic" | "all";

function kindOf(bind: string): BindKind {
  if (bind === "loopback") return "loopback";
  if (bind === "all") return "all";
  return "nic";
}

function kinds(): { id: BindKind; label: string; what: string }[] {
  const t = textOf(configText);
  return [
    { id: "loopback", label: t.loopback, what: t.loopbackWhat },
    { id: "nic", label: t.nic, what: t.nicWhat },
    { id: "all", label: t.all, what: t.allWhat },
  ];
}

/**
 * 来源白名单（CIDR）。
 *
 * **每一条单独增删,不是一个逗号分隔的输入框。**一个框装一串 CIDR 的话,
 * 改错任何一处的后果都是整份白名单失效 —— 而白名单失效的表现是「全放行」,
 * 不是「全拦住」。错在安全的那一侧比错在另一侧更该避免。
 */
function CidrList({
  items,
  configVersion,
}: {
  items: string[];
  configVersion: string | null;
}) {
  const t = useText(configText);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(ops: PatchOp[]) {
    if (!configVersion) {
      toast.error(t.versionNotLoaded);
      return;
    }
    setBusy(true);
    try {
      await patchConfig(ops, configVersion);
      setAdding("");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.length === 0 && <span className="text-muted-foreground">{t.anySource}</span>}
      {items.map((c, i) => (
        <span
          key={c}
          className="flex items-center gap-1 rounded border border-input px-1.5 font-mono tw-label"
        >
          {c}
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={busy}
            onClick={() => void run([{ op: "remove", path: `/listen/gateway/allow_from/${i}` }])}
            aria-label={t.removeSource(c)}
          >
            ×
          </Button>
        </span>
      ))}
      <Input
        className="w-44 font-mono"
        value={adding}
        disabled={busy}
        placeholder={t.sourcePlaceholder}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && adding.trim()) {
            void run([
              { op: "append", path: "/listen/gateway/allow_from", item: adding.trim() },
            ]);
          }
        }}
      />
    </div>
  );
}

/** 并发上限。以前这一整段也没有界面。 */
function LimitsSection({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string | null;
}) {
  const t = useText(configText);
  const l = ov.limits;
  if (!l) return null;
  const rows: [string, keyof typeof l, string][] = [
    [t.maxConcurrent, "max_concurrent", t.maxConcurrentWhat],
    [t.perProvider, "per_provider", t.perProviderWhat],
    [t.queueDepth, "queue_depth", t.queueDepthWhat],
    [t.queueTimeout, "queue_timeout_secs", t.queueTimeoutWhat],
  ];
  return (
    <section>
      <h2 className="tw-title font-semibold">{t.limitsTitle}</h2>
      <dl className="mt-2 grid grid-cols-[auto_auto_1fr] items-baseline gap-x-4 gap-y-1 tw-body">
        {rows.map(([label, key, what]) => (
          <Fragment key={key}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono">
              <EditableCell
                value={String(l[key])}
                path={`/limits/${key}`}
                version={configVersion}
              />
            </dd>
            <dd className="tw-label text-muted-foreground">{what}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

function ListenSection({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string | null;
}) {
  const t = useText(configText);
  const [busy, setBusy] = useState(false);
  const [nics, setNics] = useState<NicView[] | null>(null);
  const cur = ov.listen.bind;
  const kind = kindOf(cur);

  // 网卡清单每次打开这一页现拉 —— 它会变（插拔网线、换 Wi-Fi、起 VPN）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await invoke<NicView[]>("interfaces");
        if (alive) setNics(list.filter((n) => !n.loopback));
      } catch {
        // 拉不到就只是选单是空的，前后两档照常能选
      }
    })();
    return () => {
      alive = false;
    };
  }, [configVersion]);

  async function write(value: string) {
    if (value === cur || busy) return;
    if (!configVersion) {
      toast.error(t.versionNotLoaded);
      return;
    }
    setBusy(true);
    try {
      await patchConfig([{ op: "replace", path: "/listen/gateway/bind", value }], configVersion);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function pickKind(k: BindKind) {
    if (k === "loopback") return void write("loopback");
    if (k === "all") return void write("all");
    // 选「指定网卡」时先落到第一张，用户再从选单里换
    const first = nics?.[0];
    if (!first) {
      toast.error(t.noNic);
      return;
    }
    void write(first.addr);
  }

  const options = kinds();
  const picked = options.find((k) => k.id === kind);

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <h2 className="tw-title font-semibold">{t.listenTitle}</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="ml-auto"
          value={kind}
          onValueChange={(v) => v && pickKind(v as BindKind)}
        >
          {options.map((k) => (
            <ToggleGroupItem
              key={k.id}
              value={k.id}
              disabled={busy || (k.id === "nic" && nics?.length === 0)}
            >
              {k.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <p className="mt-2 tw-body text-muted-foreground">
        {picked?.what}
      </p>

      {/*
        **「已经不只是本机了」这句话得有人说。**原来是把选中的那一档染成
        琥珀色 —— 那是这个控件里唯一的暴露信号,而换成 ToggleGroup 之后
        选中态是统一的,信号就没了。与其在一个按钮上盖颜色,不如让库里
        那个专门说这种话的组件来说。
      */}
      {ov.listen.exposed && (
        <Alert variant="warning" className="mt-2">
          <AlertTitle>{t.exposedTitle}</AlertTitle>
          <AlertDescription>
            {t.exposedBody}
            <Tip text={t.enforcedTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">
                {t.enforced}
              </span>
            </Tip>
          </AlertDescription>
        </Alert>
      )}

      {kind === "nic" && (
        <div className="mt-2 flex items-center gap-2">
          <NativeSelect
            size="sm"
            className="font-mono"
            value={cur}
            disabled={busy}
            onChange={(e) => void write(e.target.value)}
          >
            {/* 配置里写着一个当前枚举不到的地址 —— 网线拔了、换了网络。
                **必须列出来**，否则选单会显示成别的地址，看起来像是它变了 */}
            {!nics?.some((n) => n.addr === cur) && (
              <NativeSelectOption value={cur}>
                {t.nicMissing(cur)}
              </NativeSelectOption>
            )}
            {nics?.map((n) => (
              <NativeSelectOption key={`${n.name}-${n.addr}`} value={n.addr}>
                {t.nicOption(n.name, n.addr)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Tip text={t.addressTip}>
            <span className="tw-label text-muted-foreground underline decoration-dotted underline-offset-2">
              {t.addressMayChange}
            </span>
          </Tip>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tw-body">
        <dt className="text-muted-foreground">{t.listening}</dt>
        <dd className="flex items-baseline gap-1 font-mono">
          {ov.listen.bind} :
          <EditableCell
            value={String(ov.listen.port)}
            path="/listen/gateway/port"
            version={configVersion}
          />
        </dd>
        <dt className="text-muted-foreground">{t.clientKeys}</dt>
        <dd className="font-mono">
          {t.keyList(ov.clients.map((c) => `${c.name} ${c.key}`))}
        </dd>
        {ov.listen.exposed && (
          <>
            <dt className="text-muted-foreground">{t.allowlist}</dt>
            <dd>
              <CidrList
                items={ov.listen.allow_from}
                configVersion={configVersion}
              />
            </dd>
          </>
        )}
      </dl>

      {/*
        白名单还只能读不能改：`PatchOp::Replace` 只吃标量，而 `allow_from`
        是一个列表。要在界面上编辑它，得先给补丁协议加一个列表操作 ——
        那是另一件事，不该在这里塞一个只能改第一项的半吊子输入框。
      */}
    </section>
  );
}

export default function Config({
  section = "gateway",
  ov,
  configVersion,
}: {
  /**
   * 这一次渲染哪一域。路由与策略组在 `routing/`，上游、代理与价目表在
   * `upstreams/`。
   */
  section?: "gateway" | "settings";
  ov: Overview;
  configVersion: string | null;
}) {
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
      {section === "settings" && <LanguageSection />}

      {section === "settings" && <AppearanceSection />}

      {section === "settings" && (
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
                  setAutostart(await invoke<boolean>("set_autostart", { on: want }));
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
                    <span className="underline decoration-dotted underline-offset-2">{label}</span>
                  </Tip>
                ))}
              </FieldDescription>
            </FieldContent>
          </Field>
        </section>
      )}

      {section === "settings" && <Update />}
      {section === "settings" && <NoticeSettings />}

      {section === "gateway" && (
        <ListenSection ov={ov} configVersion={configVersion} />
      )}

      {section === "gateway" && (
        <LimitsSection ov={ov} configVersion={configVersion} />
      )}

      {/* 诊断包和卸载改的是这个应用本身，归「设置」 */}
      {section === "settings" && <About />}

      {section === "settings" && <Diagnostics />}

      {section === "settings" && <Uninstall />}
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
    void invoke<Record<string, string>>("app_info").then(setInfo).catch(() => {});
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
            <span className="underline decoration-dotted underline-offset-2">{label}</span>
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
            {t.review((text) => <span className="font-medium">{text}</span>)}
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
            {t.uninstallIntro((text) => <span className="font-medium">{text}</span>)}
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
            <FieldLabel htmlFor="drop-data">
              {t.dropData}
            </FieldLabel>
          </Field>
          <ButtonGroup>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setLog(await invoke<string[]>("uninstall", { dropData: drop }));
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep("idle")}
            >
              {common.cancel}
            </Button>
                    </ButtonGroup>
        </div>
      )}
    </section>
  );
}
