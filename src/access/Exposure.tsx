import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { EditableCell } from "./EditableCell";
import { patchConfig } from "@/patch";
import type { NicView, Overview, PatchOp } from "@/types";
import { Segmented } from "@/upstreams/parts";
import { accessText } from "./Access.i18n";

/** 谁能连进来。三档答的是同一个问题，网卡和网段是它的实现 */
export type Level = "local" | "lan" | "all";

/** 写死的回环地址。`bind: 127.0.0.1` 和 `loopback` 是同一件事 */
function isLoopback(bind: string): boolean {
  return bind === "::1" || bind === "127.0.0.1" || bind.startsWith("127.");
}

export function levelOf(bind: string): Level {
  if (bind === "loopback") return "local";
  if (bind === "all") return "all";
  // **判的是地址，不是写法** —— core 的 `is_exposed` 也是这么判的，
  // 把 `bind: 127.0.0.1` 说成「局域网」等于凭空报一次暴露
  if (isLoopback(bind)) return "local";
  // 网卡名，或者一张具体网卡的地址
  return "lan";
}

/**
 * 监听范围。
 *
 * **先问「谁能连」，网卡是它的实现。**以前这里问的是「绑哪张网卡」，
 * 而用户心里的问题是前者；决定放行范围的 `allow_from` 则藏在暴露之后，
 * 连它默认放行私网段这件事都没说过。
 *
 * 「局域网」绑的是**一张具体的网卡**，不是 `0.0.0.0` 加一层来源过滤：
 * 绑那张网卡，别的网卡上这个端口根本不存在。曾经有过的 `lan` 正是倒过来
 * 做的，所以它被删掉了 —— core v0.12.0 起 `bind` 认网卡名，这一档才真正
 * 站得住（按名字存，换网络之后不失效）。
 */
export function Exposure({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string | null;
}) {
  const t = useText(accessText);
  const [nics, setNics] = useState<NicView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const bind = ov.listen.bind;
  const level = levelOf(bind);

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

  async function write(ops: PatchOp[]) {
    if (!configVersion) {
      toast.error(t.versionNotLoaded);
      return;
    }
    setBusy(true);
    try {
      await patchConfig(ops, configVersion);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const setBind = (value: string) =>
    value === bind
      ? undefined
      : void write([{ op: "replace", path: "/listen/gateway/bind", value }]);

  function pick(next: Level) {
    if (next === level) return;
    if (next === "local") return setBind("loopback");
    if (next === "all") return setBind("all");
    // 选「局域网」时落到第一张网卡，用户再从选单里换。**写名字不写地址** ——
    // 地址会随 DHCP 变，名字不会
    const first = nics?.[0];
    if (!first) {
      toast.error(t.noNic);
      return;
    }
    setBind(first.name);
  }

  const what =
    level === "local" ? t.localWhat : level === "lan" ? t.lanWhat : t.allWhat;
  // 选单按名字。**配置里写的是地址时，认出它属于哪张网卡** —— 老配置和
  // 手写的都是地址；认出来之后选单是对的，用户下次动它就顺手存成名字
  const byAddr = nics?.find((n) => n.addr === bind);
  const selected = byAddr?.name ?? bind;
  const known = byAddr != null || (nics?.some((n) => n.name === bind) ?? false);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="tw-title font-semibold">{t.title}</h2>

      <Segmented<Level>
        value={level}
        disabled={busy}
        options={[
          { id: "local", label: t.local },
          { id: "lan", label: t.lan },
          { id: "all", label: t.all },
        ]}
        onChange={pick}
      />
      <p className="tw-body text-muted-foreground">{what}</p>

      {level === "lan" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="tw-body text-muted-foreground">{t.nic}</span>
          <NativeSelect
            size="sm"
            aria-label={t.nic}
            className="font-mono"
            value={selected}
            disabled={busy}
            onChange={(e) => setBind(e.target.value)}
          >
            {/* 配置里写着一张当前枚举不到的网卡 —— 网线拔了、换了网络。
             **必须列出来**，否则选单会显示成别的网卡，看起来像是它变了 */}
            {!known && (
              <NativeSelectOption value={bind}>
                {t.nicMissing(bind)}
              </NativeSelectOption>
            )}
            {nics?.map((n) => (
              <NativeSelectOption key={`${n.name}-${n.addr}`} value={n.name}>
                {t.nicOption(n.name, n.addr)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className="tw-label text-muted-foreground">{t.nicStable}</span>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 tw-body">
        <dt className="text-muted-foreground">{t.listening}</dt>
        <dd className="flex items-baseline gap-1 font-mono">
          {bind} :
          <EditableCell
            value={String(ov.listen.port)}
            path="/listen/gateway/port"
            version={configVersion}
          />
        </dd>

        {ov.listen.exposed && (
          <>
            <dt className="text-muted-foreground">{t.allowlist}</dt>
            <dd className="flex flex-col gap-1">
              <CidrList
                items={ov.listen.allow_from}
                configVersion={configVersion}
              />
              <span className="tw-label text-muted-foreground">
                {ov.listen.allow_from.length === 0
                  ? t.allowlistEmpty
                  : t.allowlistWhat}
              </span>
            </dd>
            <dt className="text-muted-foreground" />
            <dd>
              <Tip text={t.keyEnforcedTip}>
                <span className="tw-label text-muted-foreground underline decoration-dotted underline-offset-2">
                  {t.keyEnforced}
                </span>
              </Tip>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

/**
 * 放行网段（CIDR）。
 *
 * **每一条单独增删，不是一个逗号分隔的输入框。**一个框装一串 CIDR 的话，
 * 改错任何一处的后果都是整份名单失效 —— 而它失效的表现是「全放行」，
 * 不是「全拦住」。错在安全的那一侧比错在另一侧更该避免。
 */
function CidrList({
  items,
  configVersion,
}: {
  items: string[];
  configVersion: string | null;
}) {
  const t = useText(accessText);
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
            onClick={() =>
              void run([
                { op: "remove", path: `/listen/gateway/allow_from/${i}` },
              ])
            }
            aria-label={t.removeSource(c)}
          >
            ×
          </Button>
        </span>
      ))}
      <Input
        className="w-44 font-mono"
        aria-label={t.addSource}
        value={adding}
        disabled={busy}
        placeholder={t.cidrPlaceholder}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing || !adding.trim())
            return;
          e.preventDefault();
          void run([
            {
              op: "append",
              path: "/listen/gateway/allow_from",
              item: adding.trim(),
            },
          ]);
        }}
      />
    </div>
  );
}
