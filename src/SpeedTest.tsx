import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usd, type SpeedQuote, type SpeedResult } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

/**
 * L3 模型测速。**这一层会花钱**。
 *
 * 所以它是三步而不是一步：填模型 → **看报价** → 点确认。中间那一步
 * 不能省 —— 触发前必须显示预估消耗，而不是点了才知道。
 */
export default function SpeedTest({ models }: { models: string[] }) {
  const [model, setModel] = useState(models[0] ?? "claude-sonnet-4-5");
  const [quote, setQuote] = useState<SpeedQuote | null>(null);
  const [results, setResults] = useState<SpeedResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      setQuote(await invoke<SpeedQuote>("speed_quote", { model }));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResults(await invoke<SpeedResult[]>("speed_run", { model }));
      setQuote(null);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <h2 className="tw-title font-semibold">模型测速</h2>
        {/* **说清这一下花钱。**L1 那一栏写的是「不花钱」，两句话必须
            一样醒目，否则用户会以为所有测速都一样 */}
        <span className="tw-body text-amber-700 dark:text-amber-400">
          会真的调用模型，花钱
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Input
          className="w-72 font-mono"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="claude-sonnet-4-5"
          list="tw-models"
        />
        <datalist id="tw-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Button
          variant="outline"
          size="sm"
          onClick={ask}
          disabled={busy || !model.trim()}
        >
          {busy && !quote ? "计算中…" : "预估用量"}
        </Button>
      </div>

      {/* **报价。**这一步不能省 */}
      {quote && (
        <Alert variant="warning" className="mt-3">
          <AlertTitle>即将测速 · {model}</AlertTitle>
          <AlertDescription>
          <ul className="mt-1.5 space-y-0.5 text-amber-800 dark:text-amber-300">
            {quote.items.map((i) => (
              <li key={i.provider}>
                {i.provider} · 输入 {i.input_tokens} / 输出最多 {i.max_output_tokens} token ·{" "}
                {i.note}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-amber-900 dark:text-amber-200">
            {/* **有一项算不出来就不给总计。**给一个看起来完整的数字，
                用户会以为那就是全部代价 */}
            合计{" "}
            {quote.total_micros != null ? (
              <span className="font-medium">{usd(quote.total_micros)}</span>
            ) : (
              <span>算不出来 —— 有上游的模型不在价目表里</span>
            )}
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              · 按 {quote.pricing_date} 的价目表
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={run}
              disabled={busy}
            >
              {busy ? "测试中…" : "确认并开始"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setQuote(null)}
            >
              取消
            </Button>
          </div>
        </AlertDescription>
        </Alert>
      )}

      {results && (
        <Table className="mt-3 tw-num">
          <TableHeader>
            <TableRow>
              <TableHead>上游</TableHead>
              <TableHead>建连</TableHead>
              {/* TTFT 才是这一层唯一值得测的东西 */}
              <TableHead>首 token</TableHead>
              <TableHead>总计</TableHead>
              <TableHead>实际消耗</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.provider}>
                <TableCell>{r.provider}</TableCell>
                {r.error ? (
                  <TableCell colSpan={4} className="text-red-600 dark:text-red-400">
                    {r.error}
                  </TableCell>
                ) : (
                  <>
                    <TableCell>{r.connect_ms}ms</TableCell>
                    <TableCell className="font-medium">
                      {r.ttft_ms != null ? `${r.ttft_ms}ms` : "—"}
                    </TableCell>
                    <TableCell>{r.total_ms}ms</TableCell>
                    {/* **实际消耗和预估对照。**有些上游会附加 system
                        prompt，那时实际比预估多 */}
                    <TableCell className="text-muted-foreground">
                      {r.input_tokens != null
                        ? `${r.input_tokens} / ${r.output_tokens ?? 0}`
                        : "上游没报"}
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {error && (
        <Alert variant="warning" className="mt-2">
          <AlertDescription>
          {error}
        </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
