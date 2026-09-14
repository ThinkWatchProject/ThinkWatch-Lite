import { Fragment, useRef, useState } from "react";
import { Tip } from "./ui/Tooltip";
import AddUpstream from "./AddUpstream";
import Proxies from "./Proxies";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import ConfigTextMode from "./ConfigText";
import Pricing from "./Pricing";
import SpeedTest from "./SpeedTest";
import { triggers } from "./triggers";
import DryRun from "./DryRun";
import type {
  ConfigText,
  ConfigVersion,
  L1Result,
  NicView,
  Overview,
  PatchOp,
} from "./types";

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
  onSaved,
  mono,
}: {
  value: string;
  path: string;
  version: string | null;
  onSaved: (err: string | null) => void;
  mono?: boolean;
}) {
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
      onSaved("还没读到配置版本，稍等一下再试");
      setDraft(value);
      return;
    }
    setBusy(true);
    try {
      const ops: PatchOp[] = [{ op: "replace", path, value: draft }];
      // Tauri 的 invoke 用字符串 reject，不是 Error
      await invoke("patch_config", { ops, baseVersion: version });
      onSaved(null);
    } catch (e) {
      // **失败时把草稿退回原值。**留着一个没保存成功的值，用户下次
      // 看这一行会以为它已经生效了。
      setDraft(value);
      onSaved(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
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
      className={
        "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 " +
        "hover:border-neutral-300 focus:border-neutral-400 focus:outline-none " +
        "disabled:opacity-50 dark:hover:border-neutral-700 dark:focus:border-neutral-600 " +
        (mono ? "font-mono" : "")
      }
    />
  );
}

/**
 * 一个下拉改一个标量字段。
 *
 * **和 `EditableCell` 走同一条路**（`patch_config` + 乐观并发），只是
 * 输入形状不同 —— 枚举字段让用户手打，打错一个字母就是一次静默的
 * 「配了没生效」。
 */
function SelectCell({
  value,
  options,
  path,
  version,
  onSaved,
  onDone,
}: {
  value: string;
  /** `[写进 YAML 的值, 显示给人看的字]` */
  options: [string, string][];
  path: string;
  version: string | null;
  onSaved: (err: string | null) => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <select
      value={value}
      disabled={busy}
      onChange={async (e) => {
        if (!version) {
          onSaved("还没读到配置版本，稍等一下再试");
          return;
        }
        const v = e.target.value;
        setBusy(true);
        try {
          await invoke("patch_config", {
            // 空串写成 null —— 「没写这个字段」和「写了个空值」是两回事，
            // 而前者才是「按默认/自动判」的意思
            ops: [{ op: "replace", path, value: v === "" ? null : v }],
            baseVersion: version,
          });
          onSaved(null);
          onDone?.();
        } catch (err) {
          onSaved(typeof err === "string" ? err : String(err));
        } finally {
          setBusy(false);
        }
      }}
      className={
        "rounded border border-transparent bg-transparent px-1 py-0.5 " +
        "hover:border-neutral-300 focus:border-neutral-400 focus:outline-none " +
        "disabled:opacity-50 dark:hover:border-neutral-700 dark:focus:border-neutral-600"
      }
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

/**
 * 一次 L1 测速的结果。
 *
 * **每一段单独一行，不画一根合成的进度条。**「建连 292ms」说不出任何
 * 该修的东西，而「DNS 5ms / TCP 3ms / TLS 283ms」一眼能看出问题在哪
 * 一层。
 */
function SpeedRows({ r }: { r: L1Result }) {
  return (
    <div className="mt-1.5 space-y-0.5 tw-body">
      {r.segments.map((seg) => (
        <div key={seg.name} className="flex gap-3 text-neutral-500">
          <span className="w-32 shrink-0">{seg.name}</span>
          <span className="font-mono tw-num">{seg.ms} ms</span>
        </div>
      ))}
      {r.ok && (
        <div className="flex gap-3">
          <span className="w-32 shrink-0 text-neutral-500">建连总计</span>
          <span className="font-mono tw-num font-medium">{r.total_ms} ms</span>
        </div>
      )}
      {r.error && (
        <p className="text-amber-700 dark:text-amber-400">{r.error}</p>
      )}
      {/* 缺一段一定要有话交代，否则看起来像 bug */}
      {r.notes?.map((n) => (
        <p key={n} className="text-neutral-400">· {n}</p>
      ))}
    </div>
  );
}

/**
 * 上游与规则。
 *
 * **按触发条件显示**：只有一个 provider 的用户不会看到「故障
 * 转移」「分组」这些词 —— 那些概念对他确实不存在。但**模型路由一直在**，
 * 因为一个上游就有几十个模型，那个问题从第一天就存在。
 */
/**
 * 监听方式 —— 网关绑在哪张网卡上。
 *
 * 三个选择对应三件真实不同的事：
 *
 * · **仅本机** `loopback` —— 绑 127.0.0.1。别的设备连不过来。
 * · **指定网卡** `<IP>` —— 绑某一张网卡自己的地址。只有那张网卡所在的
 *   网络连得上。
 * · **全部网卡** `all` —— 绑 0.0.0.0。**每一张**网卡,包括对着公网的那张。
 *
 * 以前中间那档叫「局域网」,而它绑的也是 0.0.0.0 —— 和「全部网卡」是同
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

const KINDS: { id: BindKind; label: string; what: string }[] = [
  {
    id: "loopback",
    label: "仅本机",
    what: "绑 127.0.0.1。只有这台电脑上的程序连得上，别的设备连不过来。",
  },
  {
    id: "nic",
    label: "指定网卡",
    what: "只绑这一张网卡自己的地址，只有它所在的那个网络连得上。密钥校验强制开启。",
  },
  {
    id: "all",
    label: "全部网卡",
    what: "绑 0.0.0.0，每一张网卡都在听 —— 包括对着公网的那张。密钥校验强制开启。",
  },
];

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
  onErr,
}: {
  items: string[];
  configVersion: string | null;
  onErr: (e: string | null) => void;
}) {
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(ops: PatchOp[]) {
    if (!configVersion) {
      onErr("还没读到配置版本，稍等一下再试");
      return;
    }
    setBusy(true);
    onErr(null);
    try {
      await invoke("patch_config", { ops, baseVersion: configVersion });
      setAdding("");
    } catch (e) {
      onErr(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.length === 0 && <span className="text-neutral-500">（全放行）</span>}
      {items.map((c, i) => (
        <span
          key={c}
          className="flex items-center gap-1 rounded border border-neutral-300 px-1.5 font-mono tw-label dark:border-neutral-700"
        >
          {c}
          <button
            disabled={busy}
            onClick={() => void run([{ op: "remove", path: `/listen/gateway/allow_from/${i}` }])}
            className="text-neutral-400 hover:text-red-600 disabled:opacity-30"
            aria-label={`删掉 ${c}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={adding}
        disabled={busy}
        placeholder="加一段，比如 192.168.1.0/24"
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && adding.trim()) {
            void run([
              { op: "append", path: "/listen/gateway/allow_from", item: adding.trim() },
            ]);
          }
        }}
        className="w-44 rounded border border-neutral-300 bg-transparent px-1.5 font-mono tw-label outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
    </div>
  );
}

const PROBE_MODES: { id: string; label: string; what: string }[] = [
  { id: "intercept", label: "本地应答", what: "一个字节都不发给上游，不花钱。" },
  { id: "passthrough", label: "原样放行", what: "当成普通请求发出去，按量计费。" },
  { id: "route", label: "交给路由", what: "走路由规则，可以分流到更便宜的地方。" },
];

/**
 * 客户端自己发的辅助请求。
 *
 * **这一段以前在界面上完全不存在,而它的缺席是连锁的**:路由条件
 * `when.intent` 只有在对应那一类被配成「交给路由」时才可能命中 ——
 * 所以任何写了 `intent` 的规则都是死的,而用户无从知道为什么。
 */
function ProbesSection({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string | null;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const probes = ov.client_probes ?? [];
  if (probes.length === 0) return null;

  async function set(id: string, mode: string) {
    if (!configVersion) {
      setErr("还没读到配置版本，稍等一下再试");
      return;
    }
    setBusy(id);
    setErr(null);
    try {
      await invoke("patch_config", {
        ops: [{ op: "replace", path: `/client_probes/${id}`, value: mode }],
        baseVersion: configVersion,
      });
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">客户端的辅助请求</h2>
      <p className="mt-1 tw-body text-neutral-500">
        客户端自己发的、你没点过的那些请求。它们也花钱。
      </p>
      <ul className="mt-2 space-y-1.5">
        {probes.map((p) => (
          <li
            key={p.id}
            className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
          >
            <div className="flex items-baseline gap-3">
              <span className="tw-body font-medium">{p.label}</span>
              <div className="ml-auto flex rounded-md border border-neutral-300 p-0.5 dark:border-neutral-700">
                {PROBE_MODES.map((m) => (
                  <button
                    key={m.id}
                    disabled={busy === p.id}
                    onClick={() => void set(p.id, m.id)}
                    className={
                      "rounded px-2 py-0.5 tw-body disabled:opacity-50 " +
                      (p.mode === m.id
                        ? "bg-neutral-200 dark:bg-neutral-800"
                        : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 tw-body text-neutral-600 dark:text-neutral-400">{p.what}</p>
            <p className="mt-0.5 tw-label text-neutral-500">
              {PROBE_MODES.find((m) => m.id === p.mode)?.what}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 tw-label text-neutral-500">
        路由规则里的「辅助请求」条件，只有在这一类选了「交给路由」时才可能命中。
      </p>
      {err && <p className="mt-2 tw-body text-red-600 dark:text-red-400">{err}</p>}
    </section>
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
  const [err, setErr] = useState<string | null>(null);
  const l = ov.limits;
  if (!l) return null;
  const rows: [string, keyof typeof l, string][] = [
    ["全局并发", "max_concurrent", "同时在飞的请求上限。超了先排队。"],
    ["单个上游", "per_provider", "一家上游同时最多几个。防止一家慢拖垮全部。"],
    ["队列上限", "queue_depth", "排队排到这么多就真的拒绝了。"],
    ["排队超时", "queue_timeout_secs", "排这么多秒还没轮到就放弃（秒）。"],
  ];
  return (
    <section>
      <h2 className="tw-title font-semibold">并发</h2>
      <dl className="mt-2 grid grid-cols-[auto_auto_1fr] items-baseline gap-x-4 gap-y-1 tw-body">
        {rows.map(([label, key, what]) => (
          <Fragment key={key}>
            <dt className="text-neutral-500">{label}</dt>
            <dd className="font-mono">
              <EditableCell
                value={String(l[key])}
                path={`/limits/${key}`}
                version={configVersion}
                onSaved={setErr}
              />
            </dd>
            <dd className="tw-label text-neutral-500">{what}</dd>
          </Fragment>
        ))}
      </dl>
      {err && <p className="mt-2 tw-body text-red-600 dark:text-red-400">{err}</p>}
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
  const [err, setErr] = useState<string | null>(null);
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
      setErr("还没读到配置版本，稍等一下再试");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await invoke("patch_config", {
        ops: [{ op: "replace", path: "/listen/gateway/bind", value }],
        baseVersion: configVersion,
      });
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
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
      setErr("没找到可以绑的网卡。插着网线或连着 Wi-Fi 吗？");
      return;
    }
    void write(first.addr);
  }

  const picked = KINDS.find((k) => k.id === kind);

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <h2 className="tw-title font-semibold">监听与访问</h2>
        <div className="ml-auto flex rounded-md border border-neutral-300 p-0.5 dark:border-neutral-700">
          {KINDS.map((k) => (
            <button
              key={k.id}
              disabled={busy || (k.id === "nic" && nics?.length === 0)}
              onClick={() => pickKind(k.id)}
              className={
                "rounded px-2.5 py-1 tw-body disabled:opacity-40 " +
                (kind === k.id
                  ? k.id === "loopback"
                    ? "bg-neutral-200 dark:bg-neutral-800"
                    : "bg-amber-500 text-white"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")
              }
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 tw-body text-neutral-600 dark:text-neutral-400">
        {picked?.what}
      </p>

      {kind === "nic" && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={cur}
            disabled={busy}
            onChange={(e) => void write(e.target.value)}
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono tw-body disabled:opacity-50 dark:border-neutral-700"
          >
            {/* 配置里写着一个当前枚举不到的地址 —— 网线拔了、换了网络。
                **必须列出来**，否则选单会显示成别的地址，看起来像是它变了 */}
            {!nics?.some((n) => n.addr === cur) && (
              <option value={cur}>{cur}（现在找不到这张网卡）</option>
            )}
            {nics?.map((n) => (
              <option key={`${n.name}-${n.addr}`} value={n.addr}>
                {n.name}　{n.addr}
              </option>
            ))}
          </select>
          <Tip text="这是这张网卡此刻的地址。DHCP 续租、换一个网络、VPN 起落都可能让它变掉 —— 变了之后网关绑不上，起不来。想要「不管地址怎么变都能用」，选「全部网卡」并留着来源白名单。">
            <span className="tw-label text-neutral-500 underline decoration-dotted underline-offset-2">
              地址会变
            </span>
          </Tip>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tw-body">
        <dt className="text-neutral-500">正在监听</dt>
        <dd className="flex items-baseline gap-1 font-mono">
          {ov.listen.bind} :
          <EditableCell
            value={String(ov.listen.port)}
            path="/listen/gateway/port"
            version={configVersion}
            onSaved={(e) => setErr(e)}
          />
        </dd>
        <dt className="text-neutral-500">客户端密钥</dt>
        <dd className="font-mono">
          {ov.clients.map((c) => `${c.name} ${c.key}`).join("，")}
        </dd>
        {ov.listen.exposed && (
          <>
            <dt className="text-neutral-500">来源白名单</dt>
            <dd>
              <CidrList
                items={ov.listen.allow_from}
                configVersion={configVersion}
                onErr={setErr}
              />
            </dd>
          </>
        )}
      </dl>

      {ov.listen.exposed && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          监听在非本机地址上，局域网里的机器能连过来
          <Tip text="这种情况下密钥校验是强制的，关不掉 —— 否则同网段任何人都能用你的上游额度。">
            <span className="ml-1 underline decoration-dotted underline-offset-2">
              密钥强制校验
            </span>
          </Tip>
        </p>
      )}

      {err && (
        <p className="mt-2 tw-body text-red-600 dark:text-red-400">{err}</p>
      )}

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
  rejectedLine,
  onProviderAdded,
}: {
  /**
   * 这一次渲染哪一域。
   *
   * IA 上「路由」和「网关」是源列表里两个并列的面,实现上还是同一个
   * 组件 —— 因为策略组那一节和 `SelectCell`、配置版本、以及跳去文本
   * 模式那条路都缠在一起,硬拆会弄坏正在工作的东西。**这是分面的第一
   * 步,不是终点**:组件真正拆开是下一步的事,拆之前这个参数不该被当成
   * 一个可以随便加值的开关。
   *
   * 文本模式两个面共用 —— 它编辑的是整份文件,本来就不分域。
   */
  /**
   * 这一次渲染哪一域。
   *
   * `routing` 这一域现在只剩「试算」和「策略组」—— 路由本身搬去了
   * `Routes.tsx`。**没跟着搬的原因是它俩和 `SelectCell`、配置版本、
   * 以及跳去文本模式那条路缠在一起**，硬拆会弄坏正在工作的东西。
   * 路由页把两个组件叠起来渲染，对用户是一页。
   */
  section?: "gateway" | "upstreams" | "routing" | "settings";
  ov: Overview;
  configVersion: string | null;
  /** 最近一次校验失败指到的行号。文本模式会把它滚进视野 */
  rejectedLine?: number | null;
  /** 加完第一个上游之后让外面立刻重拉概览，不等那两秒的轮询 */
  onProviderAdded: () => void;
}) {
  // 触发条件全在一个地方 —— 散在各个组件里的
  // `providers.length >= 2` 回答不了那条反面判据
  const t = triggers(ov, null);
  useEffect(() => {
    void invoke<boolean>("autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);
  const multi = t.health;
  const [cfg, setCfg] = useState<ConfigText | null>(null);
  const [history, setHistory] = useState<ConfigVersion[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 开机自启。**出厂是关的** —— null 表示还没读到，别在读到之前先画一个
  // 勾或不勾出来：那一瞬间画错的话，用户会以为是自己之前设的。
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [autostartErr, setAutostartErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  /**
   * 表单还是文本。**默认表单** —— 大多数改动是改一个值，而文本模式要求
   * 用户知道 YAML 长什么样（默认值不该要求用户额外懂什么）。
   */
  const [mode, setMode] = useState<"form" | "text">("form");
  /**
   * 跳到文本模式时要定位的名字。
   *
   * 表单和文本**是同一份文件的两种视图**，不是两个割裂的东西 —— 而让
   * 用户建立这个心智最有效的一下，就是他点「在文件里看」时那一段真的
   * 被选中了。
   */
  const [focus, setFocus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 每次配置换了版本就重新拉一遍 —— 手里那份的 version 过期之后，
  // 下一次编辑会撞 409，而用户看不出为什么
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await invoke<ConfigText>("get_config");
        if (alive) setCfg(c);
        const h = await invoke<ConfigVersion[]>("config_history");
        if (alive) setHistory(h);
      } catch (e) {
        if (alive) setSaveError(typeof e === "string" ? e : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [configVersion, reloadKey]);
  const [speed, setSpeed] = useState<Record<string, L1Result>>({});
  const [testing, setTesting] = useState<string | null>(null);

  // 测速零成本，所以点了就跑，不弹确认框 —— **要确认的是 L3**，
  // 那一层会真的调用模型。这里连一个 token 都不产生。
  async function test(provider?: string) {
    setTesting(provider ?? "*");
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      const rs = await invoke<L1Result[]>("speed_test", { provider, proxy: null });
      setSpeed((prev) => {
        const next = { ...prev };
        for (const r of rs) next[r.target] = r;
        return next;
      });
    } catch (e) {
      // 连不上控制面时也要落到界面上，而不是只进控制台
      const msg = typeof e === "string" ? e : String(e);
      setSpeed((prev) => ({
        ...prev,
        [provider ?? "*"]: {
          target: provider ?? "*",
          ok: false,
          segments: [],
          total_ms: 0,
          error: msg,
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  if (mode === "text") {
    return (
      <div className="space-y-3 p-5">
        <div className="flex items-baseline gap-3">
          <h2 className="tw-title font-semibold">配置文件</h2>
          <button
            onClick={() => {
              setFocus(null);
              setMode("form");
            }}
            className="tw-body text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            回到表单
          </button>
        </div>
        {cfg ? (
          <ConfigTextMode
            doc={cfg}
            focus={focus}
            rejectedLine={rejectedLine ?? null}
            onJumpToForm={(name) => {
              // 回表单并把那一行滚进视野。**两个方向都要通** ——
              // 只通一半的话，用户会觉得这两个视图还是两个东西
              setFocus(null);
              setMode("form");
              setTimeout(() => {
                document
                  .querySelector(`[data-row="${CSS.escape(name)}"]`)
                  ?.scrollIntoView({ block: "center" });
              }, 0);
            }}
            onSaved={() => setReloadKey((k) => k + 1)}
          />
        ) : (
          <p className="tw-body text-neutral-500">读取中…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 p-5">
      {section === "upstreams" && (
      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="tw-title font-semibold">上游</h2>
          {t.comparison && (
            <button
              onClick={() => test(undefined)}
              disabled={testing !== null}
              className="tw-body text-neutral-500 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
            >
              {testing === "*" ? "测速中…" : "全部测一遍"}
            </button>
          )}
          {/* 说清这一下不花钱。**不说的话，谨慎的用户就不会点** —— 而
              这是排查线路问题最直接的一个动作 */}
          <span className="tw-body text-neutral-400">只握手，不发请求，不花钱</span>
          <button
            onClick={() => setMode("text")}
            className="ml-auto tw-body text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            改文件
          </button>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="tw-body text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {showHistory ? "收起历史" : `历史（${history.length}）`}
          </button>
        </div>

        {/* 保存失败要说出来。**尤其是 409** —— 它不是「你写错了」，是
            「有人抢先改了」，正确的反应是刷新再改 */}
        {saveError && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            没能保存：{saveError}
          </p>
        )}

        {showHistory && (
          <div className="mt-2 rounded-md border border-neutral-200 dark:border-neutral-800">
            {history.length === 0 && (
              <p className="px-3 py-2 tw-body text-neutral-500">
                还没有历史版本 —— 第一次改配置之后就有了。
              </p>
            )}
            {history.map((v) => (
              <div
                key={v.version}
                className="flex items-baseline gap-3 border-b border-neutral-100 px-3 py-1.5 tw-body last:border-b-0 dark:border-neutral-900"
              >
                <span className="font-mono text-neutral-500">{v.version.slice(7)}</span>
                <span className="text-neutral-500">{v.origin}</span>
                <span className="text-neutral-400">
                  {new Date(v.at_ms).toLocaleString()}
                </span>
                {v.current ? (
                  // 不标出来的话，用户会以为第一条是「上一版」然后回滚到自己身上
                  <span className="ml-auto text-emerald-600 dark:text-emerald-400">现在这版</span>
                ) : (
                  <button
                    onClick={async () => {
                      setSaveError(null);
                      try {
                        await invoke("rollback_config", { version: v.version });
                      } catch (e) {
                        setSaveError(typeof e === "string" ? e : String(e));
                      }
                    }}
                    className="ml-auto text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    回到这版
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {/*
          一个上游都没有时，这一节是「加第一个」而不是一张空表头。
          原来这件事是一个全屏的首次运行页面做的 —— 把人挡在产品外面，
          而那时候网关已经在跑了。配置就该在配置的地方。
        */}
        {ov.providers.length === 0 ? (
          <div className="mt-3">
            <AddUpstream onDone={onProviderAdded} />
          </div>
        ) : (
        <table className="mt-2 w-full text-left tw-body">
          <thead className="text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-2 font-medium">名字</th>
              <th className="font-medium">地址</th>
              <th className="font-medium">协议</th>
              <th className="font-medium">密钥</th>
              <th className="font-medium">代理</th>
              <th className="font-medium">计费</th>
              <th className="font-medium">信任</th>
              {/* 只有一家的时候熔断是旁路的，显示健康列没有意义 */}
              {multi && <th className="font-medium">状态</th>}
              <th className="font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {ov.providers.map((p) => (
              <tr key={p.name} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 font-medium" data-row={p.name}>
                  {p.name}
                  <Tip text="跳到配置文件里这一段，并选中它">
                  <button
                    onClick={() => {
                      setFocus(p.name);
                      setMode("text");
                    }}
                    className="ml-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    ↗
                  </button>
                  </Tip>
                </td>
                <td className="text-neutral-500">
                  <EditableCell
                    mono
                    value={p.base_url}
                    path={`/providers/${p.name}/base_url`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                  />
                </td>
                <td className="text-neutral-500">
                  {/*
                    猜不出协议不是错误 —— 但要能改。自动判错的时候，
                    这一格就是修它的地方，而原来只能去改 YAML。
                  */}
                  <SelectCell
                    value={p.protocol ?? ""}
                    options={[
                      ["", "自动（按 Anthropic 转发）"],
                      ["anthropic", "anthropic"],
                      ["openai-chat", "openai-chat"],
                      ["openai-responses", "openai-responses"],
                      ["gemini", "gemini"],
                    ]}
                    path={`/providers/${p.name}/protocol`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
                {/* 来源，不是值 */}
                <td className="font-mono text-neutral-500">{p.key_source}</td>
                <td className="text-neutral-500">
                  <SelectCell
                    value={p.proxy}
                    options={[
                      ["direct", "直连"],
                      ["system", "跟随系统"],
                      ...(ov.proxies ?? []).map(
                        (x) => [x.name, `${x.name}（${x.kind} ${x.addr}）`] as [string, string],
                      ),
                    ]}
                    path={`/providers/${p.name}/proxy`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
                {/*
                  计费方式：它同时决定成本栏怎么显示和
                  `cheapest` 怎么排 —— 订阅制的边际成本是零。
                */}
                <td className="text-neutral-500">
                  <SelectCell
                    value={p.billing ?? ""}
                    options={[
                      ["", "自动判"],
                      ["per-token", "按量"],
                      ["subscription", "订阅"],
                      ["unknown", "未知"],
                    ]}
                    path={`/providers/${p.name}/billing`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
                {/*
                  信任级别。**没显式写过的时候要说清是自动判的**
                  —— 否则用户会以为这一格改不动，或者以为是他自己设的。
                */}
                <td className="text-neutral-500">
                  <SelectCell
                    value={p.trust_explicit ? (p.trust === "官方" ? "official" : "untrusted") : ""}
                    options={[
                      ["", `自动判（现在是${p.trust ?? "不受信任"}）`],
                      ["official", "官方"],
                      ["untrusted", "不受信任"],
                    ]}
                    path={`/providers/${p.name}/trust`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
                {multi && (
                  <td>
                    {p.health === "ok" ? (
                      <span className="text-emerald-600 dark:text-emerald-400">正常</span>
                    ) : (
                      <Tip text="连续失败后暂时不派请求过去，冷却之后自动恢复">
                        <span className="text-amber-600 dark:text-amber-400">熔断中</span>
                      </Tip>
                    )}
                  </td>
                )}
                <td className="text-right">
                  <button
                    onClick={() => test(p.name)}
                    disabled={testing !== null}
                    className="text-neutral-500 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
                  >
                    {testing === p.name ? "测速中…" : "测试"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        {/* 结果放在表下面而不是挤进单元格：分段有三到四行，塞进表格会把
            每一行都撑高，而大多数时候它们并不存在 */}
        {ov.providers.map((p) => {
          const r = speed[p.name];
          if (!r) return null;
          return (
            <div
              key={p.name}
              className="mt-3 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              <div className="flex items-baseline gap-2 tw-body">
                <span>{r.ok ? "✅" : "❌"}</span>
                <span className="font-medium">{p.name}</span>
                {r.via && <span className="text-neutral-500">经 {r.via}</span>}
              </div>
              <SpeedRows r={r} />
            </div>
          );
        })}
        {speed["*"]?.error && (
          <p className="mt-2 tw-body text-amber-700 dark:text-amber-400">{speed["*"].error}</p>
        )}
      </section>
      )}

      {/* L3 测速。**放在 L1 下面，两句成本说明并排** —— 用户要能一眼
          看出「那个不花钱、这个花钱」 */}
      <SpeedTest models={[]} />

      {section === "routing" && <DryRun models={[]} />}

      {/* 分组这个概念只在真的有组的时候出现 */}
      {section === "routing" && ov.groups.length > 0 && (
        <section>
          <h2 className="tw-title font-semibold">策略组</h2>
          <ul className="mt-2 space-y-1.5">
            {ov.groups.map((g) => (
              <li
                key={g.name}
                data-row={g.name}
                className="rounded-md border border-neutral-200 px-3 py-2 tw-body dark:border-neutral-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{g.name}</span>
                  <Tip text="跳到配置文件里这一段，并选中它">
                  <button
                    onClick={() => {
                      setFocus(g.name);
                      setMode("text");
                    }}
                    className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    ↗
                  </button>
                  </Tip>
                  <SelectCell
                    value={
                      { 按顺序: "fallback", 手动选: "select", 轮流: "load-balance", 选最快: "url-test", 选最便宜: "cheapest" }[
                        g.kind
                      ] ?? "fallback"
                    }
                    options={[
                      ["fallback", "按顺序"],
                      ["select", "手动选"],
                      ["load-balance", "轮流"],
                      ["url-test", "选最快"],
                      ["cheapest", "选最便宜"],
                    ]}
                    path={`/groups/${g.name}/type`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                  <span className="ml-auto font-mono text-neutral-500">
                    {g.providers.join(" → ")}
                  </span>
                </div>
                {/*
                  **`select` 组要能在这儿切。**这个策略本身就是
                  「UI 上点选」，而切不了的话它等于一个只能改 YAML
                  才能用的功能。

                  选中之后其余的仍然留着做故障转移 —— 手动选一家不等于
                  放弃容错，所以这里说的是「优先」而不是「只用」。
                */}
                {g.kind === "手动选" && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-neutral-500">优先用</span>
                    <select
                      value={g.selected ?? ""}
                      onChange={async (e) => {
                        if (!cfg?.version) {
                          setSaveError("还没读到配置版本，稍等一下再试");
                          return;
                        }
                        try {
                          await invoke("patch_config", {
                            ops: [
                              {
                                op: "replace",
                                path: `/groups/${g.name}/selected`,
                                value: e.target.value,
                              },
                            ],
                            baseVersion: cfg.version,
                          });
                          setSaveError(null);
                          setReloadKey((k) => k + 1);
                        } catch (err) {
                          setSaveError(typeof err === "string" ? err : String(err));
                        }
                      }}
                      className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700"
                    >
                      {g.providers.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <span className="text-neutral-500">
                      其余的仍然是它的故障转移备选
                    </span>
                  </div>
                )}
                {/*
                  **会话粘滞要摆在明面上，因为它直接决定账单。**
                  关掉它，一次长会话每轮跳一家，prompt cache 全部失效，
                  而缓存命中与否成本差 5 到 10 倍。
                */}
                {g.kind === "轮流" && (
                  <label className="mt-1.5 flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                    <input
                      type="checkbox"
                      checked={g.session_affinity ?? true}
                      onChange={async (e) => {
                        if (!cfg?.version) {
                          setSaveError("还没读到配置版本，稍等一下再试");
                          return;
                        }
                        try {
                          await invoke("patch_config", {
                            ops: [
                              {
                                op: "replace",
                                path: `/groups/${g.name}/session_affinity`,
                                value: e.target.checked,
                              },
                            ],
                            baseVersion: cfg.version,
                          });
                          setSaveError(null);
                          setReloadKey((k) => k + 1);
                        } catch (err) {
                          setSaveError(typeof err === "string" ? err : String(err));
                        }
                      }}
                    />
                    会话粘滞（同一次对话固定走同一家）
                  </label>
                )}
                {g.hurts_cache && (
                  // 这句必须在界面上直说：它决定了用户的账单。
                  // 缓存命中与否成本差 5 到 10 倍，而为了省 20% 的单价
                  // 丢掉 90% 的缓存折扣，是一笔怎么算都不划算的账。
                  <p className="mt-1.5 text-amber-700 dark:text-amber-400">
                    ⚠ 这个策略会让 prompt cache 失效，长会话的成本会明显上升。
                    {g.kind === "轮流" ? "把上面那个粘滞打开就好。" : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {section === "settings" && (
        <section>
          <h2 className="tw-title font-semibold">开机启动</h2>
          <label className="mt-2 flex items-start gap-2 tw-body">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={autostart === true}
              disabled={autostart === null}
              onChange={async (e) => {
                const want = e.target.checked;
                setAutostartErr(null);
                // 先乐观地画上，失败再弹回去 —— 但**以后端返回的实际
                // 状态为准**，不是以这里传出去的那个为准。注册可能失败
                // （只读的 LaunchAgents 目录、权限），那时勾必须弹回去。
                setAutostart(want);
                try {
                  setAutostart(await invoke<boolean>("set_autostart", { on: want }));
                } catch (err) {
                  setAutostart(!want);
                  setAutostartErr(typeof err === "string" ? err : String(err));
                }
              }}
            />
            <span>
              <span className="text-neutral-800 dark:text-neutral-200">开机时自动启动</span>
              <span className="mt-0.5 block text-neutral-500">
                {/*
                  说清「默认是关的」和「勾了会发生什么」。一个装完就往
                  登录项里写东西的工具，用户第一次发现它是在系统设置里
                  看到一个自己没同意过的条目 —— 所以这里出厂不勾，而且
                  要讲清勾上之后系统设置里会多出什么。
                */}
                默认不开。
                <Tip text="勾上会在「系统设置 › 通用 › 登录项」里注册一条。开机后只有菜单栏多一个图标，不会弹出窗口。">
                  <span className="underline decoration-dotted underline-offset-2">勾上会发生什么</span>
                </Tip>
              </span>
            </span>
          </label>
          {autostartErr && (
            <p className="mt-1.5 tw-body text-amber-700 dark:text-amber-300">
              {autostartErr}
            </p>
          )}
        </section>
      )}

      {section === "upstreams" && (
        <Proxies ov={ov} configVersion={configVersion} onChanged={onProviderAdded} />
      )}

      {section === "gateway" && (
        <ListenSection ov={ov} configVersion={configVersion} />
      )}

      {section === "gateway" && (
        <ProbesSection ov={ov} configVersion={configVersion} />
      )}

      {section === "gateway" && (
        <LimitsSection ov={ov} configVersion={configVersion} />
      )}

      {/*
        价格是 config.yaml 旁边那份 pricing.yaml —— 属于网关配置。
        诊断包和卸载改的是这个应用本身，归「设置」。
      */}
      {section === "gateway" && <Pricing />}

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
  const [info, setInfo] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    void invoke<Record<string, string>>("app_info").then(setInfo).catch(() => {});
  }, []);
  if (!info) return null;
  const rows: [string, string][] = [
    ["版本", info.version ?? "—"],
    ["数据目录", info.data_dir ?? "—"],
    ["core 二进制", info.core_bin ?? "—"],
  ];
  return (
    <section>
      <h2 className="tw-title font-semibold">关于</h2>
      <dl className="mt-2 space-y-0.5 tw-body">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-20 shrink-0 text-neutral-500">{k}</dt>
            <dd className="min-w-0 break-all font-mono tw-label text-neutral-600 dark:text-neutral-400">
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
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <h2 className="tw-title font-semibold">诊断包</h2>
      <p className="mt-1 tw-body text-neutral-500">
        版本、上游、熔断状态、最近的失败、脱敏后的配置原文。
        <Tip text="不含请求体和响应体。那两样排查时最有用，但也最可能带着你粘进去的东西。">
          <span className="underline decoration-dotted underline-offset-2">不含请求与响应正文</span>
        </Tip>。
      </p>
      <button
        className="mt-2 rounded border border-neutral-300 px-2 py-1 tw-body dark:border-neutral-700"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setPath(await invoke<string>("save_diagnostics"));
          } catch (e) {
            // Tauri 的 invoke 用字符串 reject，不是 Error
            setError(typeof e === "string" ? e : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "攒着…" : "生成"}
      </button>
      {error && <div className="mt-2 tw-body text-amber-600 dark:text-amber-400">{error}</div>}
      {path && (
        <div className="mt-2 tw-body">
          写好了：<code className="break-all">{path}</code>
          <div className="mt-1 text-neutral-500">
            里面的密钥和地址都打过码了，但<span className="font-medium">交出去之前请自己扫一眼</span>。
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
  const [step, setStep] = useState<"idle" | "ask" | "done">("idle");
  const [drop, setDrop] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (step === "done") {
    return (
      <section className="rounded-md border border-neutral-200 p-3 tw-body dark:border-neutral-800">
        <h2 className="tw-title font-semibold">卸载完成</h2>
        <ul className="mt-2 space-y-0.5 text-neutral-600 dark:text-neutral-400">
          {log.map((l, i) => (
            <li key={i}>· {l}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-neutral-200 p-3 tw-body dark:border-neutral-800">
      <h2 className="tw-title font-semibold">完全卸载</h2>
      {step === "idle" ? (
        <div className="mt-1.5 flex items-start justify-between gap-4">
          <p className="text-neutral-500">
            把接管过的客户端改回原样，注销开机自启。
            <span className="font-medium">直接把应用拖进废纸篓不会做这些</span>
            —— 那时客户端会指着一个没有东西在听的端口。
          </p>
          <button
            onClick={() => setStep("ask")}
            className="shrink-0 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            卸载…
          </button>
        </div>
      ) : (
        <div className="mt-1.5 space-y-2">
          <p className="text-neutral-600 dark:text-neutral-400">要做这几件事：</p>
          <ul className="space-y-0.5 text-neutral-600 dark:text-neutral-400">
            <li>· 把所有接管过的客户端改回接管之前的样子</li>
            <li>· 注销开机自启</li>
          </ul>
          <label className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={drop} onChange={(e) => setDrop(e.target.checked)} />
            {/* **默认不删。**请求历史和成本记录是用户自己的东西，而
                「删了才发现还想看」是不可逆的 */}
            连同数据目录一起删掉（请求历史、成本记录、配置备份）
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setLog(await invoke<string[]>("uninstall", { dropData: drop }));
                  setStep("done");
                } catch (e) {
                  setLog([typeof e === "string" ? e : String(e)]);
                  setStep("done");
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              确认卸载
            </button>
            <button
              onClick={() => setStep("idle")}
              className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
