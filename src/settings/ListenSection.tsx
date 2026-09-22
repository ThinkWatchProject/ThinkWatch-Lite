import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Segmented } from "@/ui/segmented";
import { useText } from "@/i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import type { ConfigWritten, CoreStatus, ListenSave, ListenView, NicView } from "@/types";
import { FormActions, FormRow, FormRows, NumberInput, intIn } from "./form";
import { listenText } from "./ListenSection.i18n";

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

/** 看起来像一个地址或网段。**只挡明显的笔误** —— 真正的校验在 core */
const CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

/**
 * 网关监听：谁能连、在哪个端口。
 *
 * **改完点保存才生效。**以前三个档位点下去立刻写配置、端口格子失焦就写盘
 * —— 从「仅本机」换到「局域网」再选网卡，中间那一版监听在一个用户没选过
 * 的地址上；而换到一个被占的端口，网关当场退出。现在几项一起改好再存，
 * core 在写配置之前先试着绑一下，绑不上就不写，并且说清为什么。
 *
 * 最上面一行是网关**此刻**在听的地址：它跟着真实的监听器走，存完之后
 * 这里（和侧栏底部）就变成新的。
 */
export function ListenSection({
  view,
  status,
  configVersion,
  onChanged,
}: {
  view: ListenView;
  status: CoreStatus | null;
  configVersion: string;
  onChanged: () => void;
}) {
  const t = useText(listenText);
  const [draft, setDraft] = useState(() => draftOf(view));
  const [nics, setNics] = useState<NicView[] | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = draftOf(view);
  const dirty = !same(draft, saved);
  // 配置换了一份（别处改的、或者刚存完）：没在改的时候跟着走
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const viewKey = JSON.stringify(view);
  useEffect(() => {
    if (!dirtyRef.current) setDraft(draftOf(JSON.parse(viewKey) as ListenView));
  }, [viewKey]);

  // 网卡清单每次打开这一节现拉 —— 它会变（插拔网线、换 Wi-Fi、起 VPN）
  useEffect(() => {
    let alive = true;
    void invoke<NicView[]>("interfaces")
      .then((list) => alive && setNics(list.filter((n) => !n.loopback)))
      .catch(() => alive && setNics([]));
    return () => {
      alive = false;
    };
  }, []);

  // 选「局域网」时网卡清单还没到：到了就落到第一张，不让保存一直灰着
  useEffect(() => {
    const first = nics?.[0]?.name;
    if (first) setDraft((d) => (d.level === "lan" && !d.nic ? { ...d, nic: first } : d));
  }, [nics]);

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

  function add() {
    const v = adding.trim();
    if (!v) return;
    if (!CIDR.test(v)) {
      setError(t.badRange(v));
      return;
    }
    if (!draft.allow.includes(v)) set({ allow: [...draft.allow, v] });
    setAdding("");
  }

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
      await invoke<ConfigWritten>("save_listen", { save: body });
      // 存上了就不算在改：配置换回来那一刻表单跟着新值走。网卡按名字存，
      // 草稿里若还是地址，先换成名字，否则配置回来之后两边对不上、表单一直显示改过
      dirtyRef.current = false;
      setDraft((d) => ({ ...d, nic: d.level === "lan" ? bind : "" }));
      toast.success(t.saved);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const what = draft.level === "local" ? t.localWhat : draft.level === "lan" ? t.lanWhat : t.allWhat;

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <FormRows>
        <FormRow label={t.current}>
          <span className="pt-1 font-mono tw-body">{status?.gateway_addr ?? t.notListening}</span>
        </FormRow>

        <FormRow label={t.scope} hint={what}>
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
        </FormRow>

        {draft.level === "lan" && (
          <FormRow label={t.nic} htmlFor="listen-nic" hint={nics?.length === 0 ? t.noNic : undefined}>
            <NativeSelect
              id="listen-nic"
              size="sm"
              className="w-64 font-mono"
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
          </FormRow>
        )}

        <FormRow label={t.port} htmlFor="listen-port" hint={portOk ? undefined : t.badPort}>
          <NumberInput
            id="listen-port"
            value={draft.port}
            invalid={!portOk}
            disabled={busy}
            onChange={(port) => set({ port })}
          />
        </FormRow>

        {exposed && (
          <FormRow label={t.allowlist} htmlFor="listen-allow" hint={t.allowlistWhat}>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.allow.map((c) => (
                <span
                  key={c}
                  className="inline-flex h-7 items-center gap-0.5 rounded-md border border-input pr-0.5 pl-2 font-mono tw-body"
                >
                  {c}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label={t.removeRange(c)}
                    onClick={() => set({ allow: draft.allow.filter((x) => x !== c) })}
                  >
                    <XIcon />
                  </Button>
                </span>
              ))}
              <Input
                id="listen-allow"
                className="h-7 w-44 font-mono"
                value={adding}
                disabled={busy}
                placeholder={t.rangePlaceholder}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  add();
                }}
                // 输了没按回车就去点保存：这一条也算上，不让它悄悄丢掉
                onBlur={add}
              />
            </div>
          </FormRow>
        )}

        <FormActions
          dirty={dirty}
          busy={busy}
          invalid={!portOk || !nicOk}
          onSave={() => void save()}
          onDiscard={() => {
            setError(null);
            setAdding("");
            setDraft(saved);
          }}
        />
      </FormRows>

      {error && (
        <Alert variant="destructive" className="mt-3">
          <TriangleAlertIcon />
          <AlertTitle>{t.saveFailed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 配置里写的地址没换上（手改了配置、网卡没了地址）：旧地址还在服务 */}
      {!error && status?.listen_error && (
        <Alert variant="warning" className="mt-3">
          <TriangleAlertIcon />
          <AlertTitle>{t.staleTitle}</AlertTitle>
          <AlertDescription>
            {t.staleBody(coreText(status.listen_error), status.gateway_addr ?? "")}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
