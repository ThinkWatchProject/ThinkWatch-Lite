import { useEffect, useState, type ReactNode } from "react";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { Banner } from "@/ui/banner";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import { useText } from "@/i18n";
import { isLinux } from "@/platform";
import { coreText, errorText } from "@/i18n/core.i18n";
import type { CoreStatus, ListenSave, ListenView } from "@/types";
import { NumberInput, intIn, useFormDraft } from "./form";
import { RowError, SaveBar, SettingsCard, SettingsGroup, SettingsRow, useDirtyMark, useSavedFlash } from "./kit";
import { listenText } from "./ListenSection.i18n";
import { RangeList } from "./RangeList";

/** 谁能连进来。三档答的是同一个问题，网卡和网段是它的实现 */
export type Level = "local" | "lan" | "all";

/** 写死的回环地址。`bind: 127.0.0.1` 和 `loopback` 是同一件事 */
function isLoopback(bind: string): boolean {
  return bind === "::1" || bind.startsWith("127.");
}

export function levelOf(bind: string): Level {
  if (bind === "loopback" || isLoopback(bind)) return "local";
  // **判的是地址，不是写法** —— `0.0.0.0` 和 `all` 是同一件事
  if (bind === "all" || bind === "0.0.0.0" || bind === "::") return "all";
  // 网卡名，或者一张具体网卡的地址
  return "lan";
}

interface Draft {
  level: Level;
  /** 局域网那一档选的网卡。配置里写的是地址时就是那个地址，存的时候换成名字 */
  nic: string;
  port: string;
  allow: string[];
}

function draftOf(v: ListenView): Draft {
  const level = levelOf(v.bind);
  return { level, nic: level === "lan" ? v.bind : "", port: String(v.port), allow: v.allow_from };
}

function same(a: Draft, b: Draft): boolean {
  return (
    a.level === b.level &&
    (a.level !== "lan" || a.nic === b.nic) &&
    a.port === b.port &&
    a.allow.length === b.allow.length &&
    a.allow.every((x, i) => x === b.allow[i])
  );
}

/**
 * 网关监听：谁能连、在哪个端口。
 *
 * **改完点保存才生效。**以前三个档位点下去立刻写配置、端口格子失焦就写盘 —— 从
 * 「仅本机」换到「局域网」再选网卡，中间那一版监听在一个用户没选过的地址上；而换到
 * 一个被占的端口，网关当场退出。现在几项一起改好再存，core 在写配置之前先试着绑一下，
 * 绑不上就不写，并且说清为什么。
 *
 * 第一行是网关**此刻**在听的地址：它跟着真实的监听器走，存完之后这里（和侧栏底部）
 * 就变成新的。对外开放时下面写出别的设备该用的地址（core 按网卡算好的，不是这里猜的）。
 */
export function ListenSection({
  view,
  status,
  configVersion,
  note,
  onChanged,
}: {
  view: ListenView;
  status: CoreStatus | null;
  configVersion: string;
  /** 这一节最下面的一句（连着远程时：远程控制的监听只能在服务器上改） */
  note?: ReactNode;
  onChanged: () => void;
}) {
  const t = useText(listenText);
  const saved = draftOf(view);
  const { draft, setDraft, dirty, commit, reset } = useFormDraft("listen", saved, same);
  // 网卡清单每次打开这一节都重取 —— 它会变（插拔网线、换 Wi-Fi、起 VPN）；取到之前先画上一次的
  const nicList = useResource("settings:interfaces", () =>
    call("Interfaces", null).then((list) => list.filter((n) => !n.loopback)),
  );
  const nics = nicList.data ?? null;
  // 放弃更改时连同名单里没加进去的那一行一起清掉：换一个 key 让它重来
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, flash] = useSavedFlash();
  useDirtyMark("listen", dirty);

  // 选「局域网」时网卡清单还没到：到了就落到第一张，不让保存一直灰着
  useEffect(() => {
    const first = nics?.[0]?.name;
    if (first) setDraft((d) => (d.level === "lan" && !d.nic ? { ...d, nic: first } : d));
  }, [nics, setDraft]);

  const set = (patch: Partial<Draft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  function pick(level: Level) {
    // 选「局域网」时落到第一张网卡，用户再从选单里换
    if (level === "lan" && !draft.nic) return set({ level, nic: nics?.[0]?.name ?? "" });
    set({ level });
  }

  /** 选单按名字。配置里写的是地址时认出它属于哪张网卡 */
  const nicName = (v: string) => nics?.find((n) => n.addr === v)?.name ?? v;
  const selected = nicName(draft.nic);
  const known = nics?.some((n) => n.name === selected) ?? false;

  const portOk = intIn(draft.port, 1, 65535);
  const nicOk = draft.level !== "lan" || !!draft.nic;
  const exposed = draft.level !== "local";

  async function save() {
    const bind = draft.level === "local" ? "loopback" : draft.level === "all" ? "all" : nicName(draft.nic);
    const body: ListenSave = {
      bind,
      port: Number(draft.port),
      allow_from: draft.allow,
      base_version: configVersion,
    };
    setBusy(true);
    setError(null);
    try {
      await call("SaveListen", body);
      // 网卡按名字存。草稿里若还是地址，先换成名字，否则配置推回来之后两边对不上、
      // 表单一直显示改过
      commit({ ...draft, nic: draft.level === "lan" ? bind : "" });
      flash();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const what = draft.level === "local" ? t.localWhat : draft.level === "lan" ? t.lanWhat : t.allWhat;
  /**
   * **防火墙那一句只在 Linux 上说。**macOS 和 Windows 的防火墙在应用第一次对外监听
   * 时会弹窗问放不放行，用户当场就知道有这么一道；Fedora、openSUSE 默认开着的
   * firewalld（以及手动开了的 ufw）不问，直接丢包 —— 另一台机器上只看到连接超时，
   * 而界面这边一切正常。
   */
  const scopeHint = exposed && isLinux ? `${what}${t.firewall}` : what;
  const addr = status?.gateway_addr ?? null;
  // 别的设备该连的地址：只在配置里已经对外开放、core 也算出来了的时候写
  const reachable = levelOf(view.bind) !== "local" ? (status?.gateway_reachable ?? []) : [];

  return (
    <SettingsGroup id="listen" title={t.title}>
      {/* 配置里写的地址没换上（手改了配置、网卡没了地址）：旧地址还在服务 */}
      <Banner layout="inline" tone="warning" show={!error && !!status?.listen_error} title={t.staleTitle}>
        {status?.listen_error ? t.staleBody(coreText(status.listen_error), addr ?? "") : null}
      </Banner>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !busy && portOk && nicOk) void save();
        }}
      >
        <SettingsCard>
          <SettingsRow
            label={t.current}
            description={reachable.length > 0 ? t.reachable(reachable.join(t.sep)) : undefined}
            control={
              addr ? (
                <StatusLabel tone={status?.listen_error ? "warn" : "ok"} muted>
                  <span className="font-mono text-foreground select-text">{addr}</span>
                </StatusLabel>
              ) : (
                <StatusLabel tone="idle">{t.notListening}</StatusLabel>
              )
            }
          />

          <SettingsRow
            label={t.scope}
            description={scopeHint}
            control={
              <Segmented<Level>
                label={t.scope}
                value={draft.level}
                disabled={busy}
                options={[
                  { id: "local", label: t.local },
                  { id: "lan", label: t.lan },
                  { id: "all", label: t.all },
                ]}
                onChange={pick}
              />
            }
          />

          {draft.level === "lan" && (
            <SettingsRow
              label={t.nic}
              htmlFor="listen-nic"
              description={nics?.length === 0 ? t.noNic : undefined}
              className="motion-fade"
              control={
                // 清单读不出来：说出来、给重试，不当成「没有网卡」
                nics === null && nicList.error !== undefined ? (
                  <RowError error={nicList.error} onRetry={() => void nicList.reload()} />
                ) : (
                  <NativeSelect
                    id="listen-nic"
                    size="sm"
                    className="w-60 font-mono"
                    value={selected}
                    disabled={busy || !nics?.length}
                    onChange={(e) => set({ nic: e.target.value })}
                  >
                    {/* 配置里写着一张当前枚举不到的网卡 —— 网线拔了、换了网络。
                        **必须列出来**，否则选单会显示成别的网卡，看起来像是它变了 */}
                    {selected && !known && (
                      <NativeSelectOption value={selected}>{t.nicMissing(selected)}</NativeSelectOption>
                    )}
                    {nics?.map((n) => (
                      <NativeSelectOption key={`${n.name}-${n.addr}`} value={n.name}>
                        {t.nicOption(n.name, n.addr)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )
              }
            />
          )}

          <SettingsRow
            label={t.port}
            htmlFor="listen-port"
            description={portOk ? undefined : <span className="text-destructive">{t.badPort}</span>}
            control={
              <NumberInput
                id="listen-port"
                value={draft.port}
                invalid={!portOk}
                disabled={busy}
                onChange={(port) => set({ port })}
              />
            }
          />

          {exposed && (
            <SettingsRow
              stack
              label={t.allowlist}
              htmlFor="listen-allow"
              className="motion-fade"
              control={
                <RangeList
                  key={epoch}
                  id="listen-allow"
                  value={draft.allow}
                  defaults={view.default_allow_from}
                  disabled={busy}
                  onChange={(allow) => set({ allow })}
                />
              }
            />
          )}

          <SaveBar
            dirty={dirty}
            pending={busy}
            saved={justSaved}
            invalid={!portOk || !nicOk}
            onDiscard={() => {
              setError(null);
              setEpoch((n) => n + 1);
              reset();
            }}
          />
        </SettingsCard>
      </form>
      <Banner layout="inline" tone="error" show={error !== null} title={t.saveFailed}>
        {error}
      </Banner>
      {note && <p className="tw-label text-muted-foreground">{note}</p>}
    </SettingsGroup>
  );
}

