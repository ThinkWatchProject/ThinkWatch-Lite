import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Overview } from "./types";

/**
 * 防护 —— 三条防线的策略（DESIGN.md §5.0）。
 *
 * 在这一页之前，这三个开关**只能改 config.yaml**。而 §5.0 的整个设计
 * 是：出厂全部停在「观察」，不打扰任何人，同时攒下属于用户自己的证据；
 * 他看到「过去 7 天有 3 个请求把密钥发给了 relay-cn」之后，自己决定要
 * 不要切到「拦截」。**证据在界面上，开关在 YAML 里，那条路就断了。**
 *
 * 三件事要在这一页说清楚：
 *
 * **一、「拦截」在每条防线上做的事不一样。**脱敏是替换成占位符、审查是
 * 切断响应流、扫描只是告警（它本来就不删东西）。统一标成「拦截」的话，
 * 用户点下去并不知道会发生什么 —— 所以每一档旁边写的是它自己的动词。
 *
 * **二、观察态不是「没开」。**它照常检测、照常记录，只是不改变任何请求。
 * 界面上要让这件事看得见，否则用户会以为自己什么防护都没有。
 *
 * **三、切到拦截是有代价的，要说在前面。**脱敏会改请求体（§4.1 说过那
 * 可能影响缓存）、审查会切断流。不说的话，第一次误报发生时用户不知道
 * 是谁干的，然后把整个功能关掉 —— 连真有用的那部分一起关掉。
 */

type Mode = "off" | "observe" | "enforce";

/** 一条防线的全部描述。动词和代价都从这里来，不散在 JSX 里。 */
const LINES: {
  key: "redact" | "inspect_tools" | "scan_configs";
  path: string;
  title: string;
  what: string;
  /** 「拦截」在这一条上具体做什么 —— 三条各不相同 */
  verb: string;
  /** 切到拦截之后，会有什么变化。写在用户点之前 */
  cost: string;
}[] = [
  {
    key: "redact",
    path: "/security/redact",
    title: "出站脱敏",
    what: "请求发出去之前，先看看里面有没有你的密钥、私钥、连接串。",
    verb: "把它们换成占位符再发，响应回来时换回真值",
    cost: "会改动请求体。同一段上下文改过之后可能不再命中上游的缓存（§4.1）。",
  },
  {
    key: "inspect_tools",
    path: "/security/inspect_tools",
    title: "工具调用审查",
    what: "上游返回的工具调用里，有没有一步就能拿到执行权的命令。",
    verb: "切断这一次的响应流，客户端拿到的是残缺的调用（拼不出合法参数）",
    cost: "只对不受信任的上游生效。误判一次的代价是这一条回答断在半路。",
  },
  {
    key: "scan_configs",
    path: "/security/scan_configs",
    title: "配置面扫描",
    what: "客户端那些配置文件里，有没有隐藏字符、注入、危险命令、过宽权限。",
    verb: "在界面上告警",
    cost: "它永远不删任何东西 —— 这一条的「拦截」就只是把话说得更响。",
  },
];

const MODES: { id: Mode; label: string }[] = [
  { id: "off", label: "关闭" },
  { id: "observe", label: "观察" },
  { id: "enforce", label: "拦截" },
];

export default function Guard({
  ov,
  configVersion,
  onChanged,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sec = ov.security;

  async function set(path: string, mode: Mode) {
    if (!configVersion) {
      setErr("还没读到配置版本，稍等一下再试");
      return;
    }
    setBusy(path);
    setErr(null);
    try {
      // 走和别的改动同一扇门（§3.8）：带版本号、span 补丁、三道校验。
      // **写进去的是 slug 不是中文标签** —— 写「观察」的话下一次加载
      // 会因为不是合法取值整份被拒，而这一层刻意不做静默回落（§5.0）。
      await invoke("patch_config", {
        ops: [{ op: "set", path, value: mode }],
        baseVersion: configVersion,
      });
      onChanged();
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-5">
      <div>
        <h2 className="text-[15px] font-semibold">防护</h2>
        <p className="mt-1 text-xs text-neutral-500">
          三条防线，各自三档。
          {/*
            说清出厂默认，以及为什么是这个默认。用户在这一页做的第一个
            判断是「我现在到底有没有被保护」，而「观察」这个词本身回答
            不了它。
          */}
          出厂都停在「观察」—— 照常检测、照常记录，但不改变任何请求。
        </p>
      </div>

      {!sec && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          这份 core 还没有报告防护状态 —— 它比界面旧。升级 core 之后这一页才能用。
        </p>
      )}

      {sec &&
        LINES.map((l) => {
          const cur = (sec[l.key] as Mode) ?? "observe";
          return (
            <section
              key={l.key}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex items-baseline gap-3">
                <h3 className="text-[13px] font-medium">{l.title}</h3>
                <div className="ml-auto flex rounded-md border border-neutral-300 p-0.5 dark:border-neutral-700">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      disabled={busy === l.path}
                      onClick={() => void set(l.path, m.id)}
                      className={
                        "rounded px-2.5 py-1 text-[12px] disabled:opacity-50 " +
                        (cur === m.id
                          ? m.id === "enforce"
                            ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                            : "bg-neutral-200 dark:bg-neutral-800"
                          : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")
                      }
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                {l.what}
              </p>

              {/*
                当前这一档到底在做什么 —— 一句话，随档变化。
                「观察」最需要这句：它看起来像「没开」，而它其实一直在记。
              */}
              <p className="mt-1.5 text-xs">
                {cur === "off" && (
                  <span className="text-neutral-500">现在：不检测，也不记录。</span>
                )}
                {cur === "observe" && (
                  <span className="text-neutral-500">
                    现在：检测并记录，<span className="font-medium">不改变任何请求</span>。
                    发现会出现在「安全 › 发现」里。
                  </span>
                )}
                {cur === "enforce" && (
                  <span className="text-neutral-800 dark:text-neutral-200">
                    现在：{l.verb}。
                  </span>
                )}
              </p>

              {/* 代价写在切之前，不是切完之后 */}
              {cur !== "enforce" && (
                <p className="mt-1 text-[11px] text-neutral-400">
                  切到「拦截」：{l.cost}
                </p>
              )}
            </section>
          );
        })}

      {sec && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-[13px] font-medium">扫描规则</h3>
          <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            内置规则加上你自己的那几条。
            {/*
              语义是「加法加停用」而不是「整份替换」（core 那边改过一次）。
              这里要说清，否则用户以为自己那份是全集，而我们后来加的新
              攻击模式他一条都收不到。
            */}
            自己写的是<span className="font-medium">加进去</span>
            ，不是替换掉内置的 —— 所以以后新增的规则你照样收得到。
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            你加了 {sec.scan_rules_added} 条，停用了 {sec.scan_rules_disabled} 条内置的。
            增删规则要改 config.yaml —— 它是一组带正则的结构，表单填不了（§3.8）。
          </p>
        </section>
      )}

      {sec && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-[13px] font-medium">按上游的脱敏类别</h3>
          <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            上面那个总闸决定脱不脱，这里决定
            <span className="font-medium">每家脱哪几类</span>。
            官方端点默认一类都不脱 —— 为了防一个你本来就信任的对象而自废武功，是这一节最要避免的事（§5.1）。
          </p>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-1.5 font-medium">上游</th>
                <th className="font-medium">信任</th>
                <th className="font-medium">脱敏类别</th>
              </tr>
            </thead>
            <tbody>
              {ov.providers.map((p) => (
                <tr
                  key={p.name}
                  className="border-b border-neutral-100 dark:border-neutral-900"
                >
                  <td className="py-1.5 font-medium">{p.name}</td>
                  <td className="text-neutral-500">
                    {p.trust}
                    {!p.trust_explicit && (
                      <span className="ml-1 text-neutral-400">（自动判）</span>
                    )}
                  </td>
                  <td className="font-mono text-neutral-500">
                    {p.redact && p.redact.length > 0 ? (
                      p.redact.join(" · ")
                    ) : (
                      <span className="font-sans text-neutral-400">
                        {p.redact_explicit ? "显式设成不脱" : "不脱（官方端点）"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}
