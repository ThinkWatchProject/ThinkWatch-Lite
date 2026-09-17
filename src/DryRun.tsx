import { useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldLabel } from "@/ui/field";
import type { DryRunResult } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import { skipLabel } from "./upstreams/labels";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/ui/combobox";

/**
 * 路由试算。
 *
 * 它回答的不是「会走到哪儿」，而是**「为什么没走我以为的那条」** ——
 * 后者才是用户真正在问的问题，所以每条没命中的规则也要列出来，并说清
 * 它卡在哪个条件上。
 *
 * **只算，不发任何请求**，也不改任何东西。
 */
export default function DryRun({ models }: { models: string[] }) {
  const [model, setModel] = useState(models[0] ?? "claude-sonnet-4-5");
  const [cache, setCache] = useState(false);
  const [tools, setTools] = useState(false);
  const [image, setImage] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [kTokens, setKTokens] = useState(8);
  const [r, setR] = useState<DryRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();

  async function run() {
    setBusy(true);
    try {
      setR(
        await invoke<DryRunResult>("dry_run", {
          req: {
            model,
            cache,
            tools,
            image,
            thinking,
            input_tokens: kTokens * 1000,
            dialect: "anthropic",
            stream: true,
            client: "",
            intent: "",
            tool_count: tools ? 5 : 0,
            max_tokens: null,
          },
        }),
      );
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">路由试算</h2>
      <p className="mt-1 tw-body text-muted-foreground">
        按给定条件计算该请求将匹配的路由及其原因。仅计算，不发起请求。
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 tw-body">
        {/*
          **自由输入 + 建议**,不是受限选择:模型名可能是刚发布的、也可能
          是中转自己起的,列表里没有的照样得能敲进去。原来用的是原生
          `<datalist>` —— 它能做到这件事,但样式完全不受控(系统画的),
          而且不支持模糊匹配。`Combobox` 的 `inputValue` 就是自由输入。
        */}
        <Combobox
          items={models}
          inputValue={model}
          onInputValueChange={setModel}
        >
          <ComboboxTrigger className="w-56">
            <ComboboxInput placeholder="模型名" />
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxEmpty>无匹配项，可直接输入完整模型名</ComboboxEmpty>
            <ComboboxList>
              {(m: string) => (
                <ComboboxItem key={m} value={m}>
                  {m}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <label className="flex items-center gap-1">
          上下文
          <Input
            className="w-16"
            type="number"
            value={kTokens}
            min={0}
            onChange={(e) => setKTokens(Number(e.target.value))}
          />
          k
        </label>
        {(
          [
            ["带缓存", cache, setCache],
            ["带工具", tools, setTools],
            ["带图片", image, setImage],
            ["扩展思考", thinking, setThinking],
          ] as const
        ).map(([label, v, set]) => (
          /*
            **`w-auto` 是布局,不是配色。**`Field` 默认 `w-full` —— 那是
            给表单一行一个字段用的,而这四个是挤在一条工具条里的开关,
            撑满会把后面的按钮挤下去。
          */
          <Field key={label} orientation="horizontal" className="w-auto">
            <Checkbox
              id={`${uid}-${label}`}
              checked={v}
              onCheckedChange={(c) => set(c === true)}
            />
            <FieldLabel htmlFor={`${uid}-${label}`}>{label}</FieldLabel>
          </Field>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy && <Spinner />}
          试算
        </Button>
      </div>

      {r && <Result r={r} />}
    </section>
  );
}

/** 规则选中了、但服务不了这个请求的上游。**要列出来** —— 「规则明明写的是 A」正是来试算的原因 */
function Skipped({ r }: { r: DryRunResult }) {
  if (r.skipped.length === 0) return null;
  return (
    <div className="mt-1 text-muted-foreground">
      已跳过：
      {r.skipped.map((s, i) => (
        <span key={s.provider}>
          {i > 0 && "、"}
          <span className="text-foreground">{s.provider}</span>（{skipLabel(s.reason)}）
        </span>
      ))}
    </div>
  );
}

function Result({ r }: { r: DryRunResult }) {
  const matched = (
    <>
      命中规则「<span className="font-medium">{r.rule}</span>」
      {r.via_group && (
        <>
          {" "}
          · 策略组「{r.via_group}」{r.strategy && `（${r.strategy}）`}
        </>
      )}
    </>
  );
  return (
    <div className="mt-3 rounded-md border border-border p-3 tw-body">
      {r.outcome === "deny" ? (
        <div>
          <span className="text-destructive">拒绝</span> · 规则「{r.rule}」：{r.reason}
        </div>
      ) : r.outcome === "no_match" ? (
        <div className="text-warning">{r.reason}</div>
      ) : r.outcome === "unavailable" ? (
        <div>
          {matched}
          {/* core 的 reason 是把下面这份清单拼成的一句话，这里直接列清单 */}
          <div className="mt-1 text-warning">选中的上游均无法服务此请求，请求将返回错误。</div>
          <Skipped r={r} />
        </div>
      ) : (
        <div>
          {matched}
          <div className="mt-1">
            尝试顺序：
            {r.candidates.map((c, i) => (
              <span key={c}>
                {i > 0 && " → "}
                <span
                  className={
                    // **熔断是当下的事实，不是静态结论。**不说出来的话，
                    // 用户会拿着一个对的答案去查一个错的现象
                    r.circuit_open.includes(c) ? "text-warning line-through" : ""
                  }
                >
                  {c}
                </span>
              </span>
            ))}
            {r.circuit_open.length > 0 && (
              <span className="ml-1 text-warning">（划线的上游当前处于熔断状态，将被跳过）</span>
            )}
          </div>
          <Skipped r={r} />
          {r.hurts_cache && (
            // 要直说 —— 它决定账单
            <div className="mt-1 text-warning">
              该策略组在上游之间分配请求，prompt cache 命中率会下降。
            </div>
          )}
          {r.set.length > 0 && (
            <div className="mt-1">
              参数改写：
              {r.set.map((s) => (
                <div key={s} className="ml-2">
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* **「为什么没走我以为的那条」才是用户在问的问题。** */}
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">规则匹配明细</summary>
        <ul className="mt-1 space-y-0.5">
          {r.trace.map((t) => (
            <li key={t.name} className="flex gap-2">
              <span
                className={
                  t.verdict === "matched" ? "text-success" : "text-muted-foreground"
                }
              >
                {t.verdict === "matched" ? "✓" : t.verdict === "phase_two" ? "…" : "·"}
              </span>
              <span className="w-40 shrink-0">{t.name}</span>
              <span className="text-muted-foreground">{t.why ?? "命中"}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
