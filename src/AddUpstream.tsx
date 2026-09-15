import { useState } from "react";
import { Tip } from "./ui/Tooltip";
import { invoke } from "@tauri-apps/api/core";
import type { ModelList, ProbeResponse, SetupResponse } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

/**
 * 加第一个上游 —— **长在配置页里，不是一个把人挡在外面的独立页面。**
 *
 * 原来这是全屏的首次运行向导：没有上游就什么都看不见，只能先填表。
 * 那个形状有两个毛病。一是它把「还没配」变成了一堵墙，而这时候网关
 * 其实已经在跑了，界面上那些东西（端口、密钥、客户端检测）本来就该
 * 看得见。二是一个只在第一次出现的页面，没有别的地方可以参照，于是
 * 它长得和产品其余部分都不像。
 *
 * 现在的做法：主界面照常进，零上游时首页挂一条引导指向配置页，真正
 * 要填的东西就在配置页「上游」那一节里 —— **配置就该在配置的地方**。
 *
 * 只问两样：地址和密钥。名字从 URL 猜，协议不问（对绝大多数上游
 * 「按 Anthropic 转发」就是对的）。这是那条纪律：能少问一个就
 * 少问一个。
 *
 * 只在一个上游都没有的时候出现：核心那个 `/setup` 端点在已经有配置时
 * 会返回 409 而不是覆盖 —— 整文件重写会把用户的注释和格式全抹掉。之后
 * 再加上游走文本模式（结构性增删）。
 */
export default function AddUpstream({ onDone }: { onDone: () => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 从 URL 猜一个名字。用户几乎不会想改它，改名走配置页。
  const guessedName = (() => {
    try {
      const h = new URL(baseUrl).hostname;
      return h.replace(/^api\./, "").split(".")[0] || "upstream";
    } catch {
      return "upstream";
    }
  })();

  const ready = baseUrl.trim() !== "" && key.trim() !== "";

  async function doProbe() {
    setBusy(true);
    setError(null);
    setProbe(null);
    try {
      // Tauri 的 invoke 用**字符串** reject，不是 Error 对象
      setProbe(await invoke<ProbeResponse>("probe_upstream", { baseUrl, key }));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doSetup() {
    setBusy(true);
    setError(null);
    try {
      await invoke<SetupResponse>("setup_first_provider", {
        name: guessedName,
        baseUrl,
        key,
      });
      onDone();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ModelList 是个带 kind 的联合：「列出来了」「上游没这个接口」
  // 「2xx 但形状没认出来」「空的」是四件不同的事，说成同一句会让用户
  // 以为是自己配错了。
  function describeModels(m: ModelList | undefined): string {
    if (!m) return "";
    switch (m.kind) {
      case "listed":
        return `，列出了 ${m.models.length} 个模型`;
      case "not_implemented":
        return "。它没有模型列表接口，照样能转发，只是按模型名路由那类功能对它用不上";
      case "unrecognized":
        return "。模型列表是个未识别的形状 —— 转发不受影响，值得报一个 issue";
      case "empty":
        return "。它的模型列表是空的，照样能转发";
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-5 dark:border-neutral-700">
      <p className="tw-head text-neutral-700 dark:text-neutral-300">
        还没有上游。加一个就能开始转发。
      </p>
      <p className="mt-1 tw-body text-neutral-500">
        只要地址和密钥。
        <Tip text="名字按地址猜，协议默认按 Anthropic 转发 —— 对绝大多数上游这是对的。两样之后都能在这一页改。">
          <span className="ml-1 underline decoration-dotted underline-offset-2">其余都有默认值</span>
        </Tip>
      </p>

      <div className="mt-4 grid max-w-xl gap-3">
        <label className="grid gap-1">
          <span className="tw-body text-neutral-500">接口地址</span>
          <Input
            className="font-mono"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setProbe(null);
            }}
            placeholder="https://api.anthropic.com"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="tw-body text-neutral-500">密钥</span>
          {/*
            **不是 type="password"。**这是用户自己机器上自己的 key，而
            填错一个字符的代价是一次看不懂的 401 —— 让他看得见自己粘了
            什么，比把它盖成圆点有用。
            autoCapitalize/autoCorrect 那一组不能少：macOS 会把首字母
            大写，那是一类稳定复现的「key 明明是对的却认证失败」。
          */}
          <Input
            className="font-mono"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setProbe(null);
            }}
            placeholder="sk-..."
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={doProbe}
          disabled={!ready || busy}
        >
          {busy && !probe ? "测试中…" : "测试连接"}
        </Button>
        {/* 说清这一下不花钱，否则谨慎的用户不会点 */}
        <span className="tw-body text-neutral-400">不花钱，可以随便点</span>
        {probe?.ok && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={doSetup}
            disabled={busy}
          >
            保存并启用
          </Button>
        )}
      </div>

      {probe && (
        <p
          className={
            "mt-3 tw-body " +
            (probe.ok
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-amber-700 dark:text-amber-300")
          }
        >
          {probe.ok ? (
            <>
              连上了（{probe.latency_ms}ms），会存成「{guessedName}」
              {describeModels(probe.models)}。
            </>
          ) : (
            probe.error
          )}
        </p>
      )}

      {error && (
        <p className="mt-3 tw-body text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
