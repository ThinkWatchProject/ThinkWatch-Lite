import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import type { PriceRow, PricingView, UpdateOffer, UpdatePreview } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import { ButtonGroup } from "@/ui/button-group";
import { Progress } from "@/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

/**
 * 自定义价格（第三层）。
 *
 * **中转站的价格和官方不同，而没有任何公开数据集会收录它们** —— 这一层
 * 是必需的，而在此之前它只能靠用户手写 `~/.thinkwatch/pricing.yaml`。
 *
 * # 这一页什么时候出现
 *
 * **有算不出价钱的请求时才展开。**用户不会主动想起要配价格 —— 只有
 * 「最近 7 天有 37 条请求算不出钱，用的是这两个模型」这种具体证据才会
 * （高级功能的触发条件要绑在「这个问题存不存在」上，不绑在数量上）。
 * 没有这个问题时它就是一行折叠起来的小字，说一句「都能算出价钱」。
 *
 * # 单位
 *
 * **每百万 token 的美元，和厂商定价页上印的一样。**让用户填 `0.000003`
 * 是在要求他做一次换算，而换算是会错的 —— 差一个数量级的价格，比没有
 * 价格更糟，因为它看起来是个确定的数字。
 */
export default function Pricing() {
  const [data, setData] = useState<PricingView | null>(null);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /**
   * 「检查价格更新」走到哪一步了。
   *
   * **三步，不是一步。**一步意味着「检查」和「写入」是同一次点击，
   * 而那正是「静默下载」的定义 —— 零上传的承诺同时意味着零静默
   * 下载。用户要先看见「要连哪儿、多大」，再看见「变了什么」，才轮到
   * 「写进去」。
   */
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [step, setStep] = useState<"idle" | "offering" | "fetching" | "applying">("idle");
  /** 三步里的第几步。`offer`/`preview` 已经拿到就算这一步过了 */
  const stepAt = preview || step === "applying" ? 3 : offer || step === "fetching" ? 2 : 1;

  const load = useCallback(async () => {
    try {
      const d = await invoke<PricingView>("pricing");
      setData(d);
      setRows(d.rows);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      toast.error(typeof e === "string" ? e : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;
  const dirty = JSON.stringify(rows) !== JSON.stringify(data.rows);
  const problem = data.unpriced_recent > 0;

  async function save() {
    setBusy(true);
    try {
      const d = await invoke<PricingView>("save_pricing", { rows });
      setData(d);
      setRows(d.rows);
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-border p-3 tw-body">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="tw-title font-semibold">自定义价格</h2>
          {problem ? (
            // **具体证据，不是功能介绍**
            <p className="mt-1 text-amber-700 dark:text-amber-400">
              最近 7 天有 {data.unpriced_recent} 条请求算不出价钱
              {data.unpriced_models.length > 0 && (
                <>
                  ，用的是{" "}
                  <span className="font-mono">{data.unpriced_models.slice(0, 3).join("、")}</span>
                  {data.unpriced_models.length > 3 ? " 等" : ""}
                </>
              )}
              。填上单价，成本栏就能算出来了。
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              经过的请求都能算出价钱。内置价目表是 {data.snapshot_date} 那份快照。
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setOpen(!open)}
        >
          {open ? "收起" : rows.length > 0 ? `${rows.length} 条自定义` : "加一条"}
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground">
            单价按<span className="font-medium">每百万 token 的美元</span>填，和厂商定价页一致。
            <Tip text="留空上游对所有上游生效；填了上游则只有那一家按这个价算。">
              <span className="ml-1 underline decoration-dotted underline-offset-2">上游这一列</span>
            </Tip>
          </p>
          <Table className="tw-num">
            <TableHeader>
              <TableRow>
                <TableHead>上游</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>输入 $/M</TableHead>
                <TableHead>输出 $/M</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Cell
                      value={r.provider ?? ""}
                      placeholder="（所有）"
                      onChange={(v) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, provider: v || null } : x)))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Cell
                      mono
                      value={r.model}
                      placeholder="模型名"
                      onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, model: v } : x)))}
                    />
                    {/* **「覆盖」和「补一个」是两件事** —— 前者要让用户
                        知道他在推翻一个已有的价 */}
                    {r.overrides_builtin && (
                      <span className="ml-1 tw-label text-neutral-400">覆盖内置</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Num
                      value={r.input}
                      onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, input: v } : x)))}
                    />
                  </TableCell>
                  <TableCell>
                    <Num
                      value={r.output}
                      onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, output: v } : x)))}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Tip text="删掉这一条自定义价格">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        ×
                      </Button>
                    </Tip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows([
                  ...rows,
                  {
                    provider: null,
                    // 有算不出价的模型时直接填上第一个 —— 用户不用自己抄
                    model: data.unpriced_models[0] ?? "",
                    input: 0,
                    output: 0,
                    overrides_builtin: false,
                  },
                ])
              }
            >
              加一条
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={busy || !dirty}
            >
              {busy && <Spinner />}
              保存
            </Button>
            {dirty && <span className="text-muted-foreground">有未保存的改动</span>}
          </div>
          <p className="text-muted-foreground">
            写进 <code>pricing.yaml</code>，和 <code>config.yaml</code> 放在一起。手改那个文件也可以，它只是一份普通 YAML。
          </p>
        </div>
      )}

      {/*
        检查价格更新（第二层）。**绝不在启动时后台偷偷拉** ——
        零上传的承诺同时意味着零静默下载。
      */}
      <div className="mt-3 border-t border-border pt-2">
        {/*
          **三步走到哪儿了,要画出来。**原来只有按钮上一个转圈 ——
          转圈说的是「在忙」,说不出「第二步的下载在忙,还有第三步」。
          零静默下载这件事的全部意义就是让人看见每一步,那就得把「一共
          几步、现在第几步」也算进去。
        */}
        {(offer || preview || step !== "idle") && (
          <div className="space-y-1">
            <Progress value={stepAt * 33.34} className="h-1" />
            <p className="tw-label text-muted-foreground">
              第 {stepAt} / 3 步 ·{" "}
              {stepAt === 1 ? "看对面有没有新的" : stepAt === 2 ? "下载并对比" : "写入"}
            </p>
          </div>
        )}

        {!offer && !preview && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={step !== "idle"}
              onClick={async () => {
                setStep("offering");
                try {
                  setOffer(await invoke<UpdateOffer>("update_offer"));
                } catch (e) {
                  toast.error(typeof e === "string" ? e : String(e));
                } finally {
                  setStep("idle");
                }
              }}
            >
              {step === "offering" && <Spinner />}
              检查价格更新
            </Button>
            <span className="text-muted-foreground">
              内置的是 {data.snapshot_date} 那份。不会自动检查。
            </span>
          </div>
        )}

        {offer && !preview && (
          <div className="space-y-1.5">
            {/* **先说要连哪儿、多大。**这是零静默下载里最容易被省掉的一半 */}
            <p className="text-muted-foreground">
              要访问：<code className="font-mono">{offer.url}</code>
            </p>
            <p className="text-muted-foreground">
              大小 {offer.bytes ? `${(offer.bytes / 1024 / 1024).toFixed(1)} MB` : "对面没说"}
              ；下载后先显示变更，确认才写入。
            </p>
            <ButtonGroup>
              <Button
                size="sm"
                disabled={step !== "idle"}
                onClick={async () => {
                  setStep("fetching");
                  try {
                    setPreview(await invoke<UpdatePreview>("update_fetch"));
                  } catch (e) {
                    toast.error(typeof e === "string" ? e : String(e));
                  } finally {
                    setStep("idle");
                  }
                }}
              >
                {step === "fetching" && <Spinner />}
              下载并对比
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffer(null)}
              >
                算了
              </Button>
                        </ButtonGroup>
          </div>
        )}

        {preview && (
          <div className="space-y-1.5">
            <p className="text-muted-foreground">
              拉回来 {preview.models} 个带价的模型，
              {preview.changes.length === 0 ? (
                <span className="font-medium">和现在这份没有差别</span>
              ) : (
                <>
                  其中 <span className="font-medium">{preview.changes.length}</span> 个和现在不一样
                </>
              )}
              。
            </p>
            {preview.changes.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded border border-border">
                <Table className="tw-num">
                  <TableBody>
                    {preview.changes.map((c) => (
                      <TableRow key={c.model} className="last:border-0">
                        <TableCell className="font-mono">{c.model}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.old_input === null ? (
                            "新增"
                          ) : (
                            <>
                              入 {(c.old_input * 1e6).toFixed(2)} → {(c.new_input * 1e6).toFixed(2)}
                              ，出 {((c.old_output ?? 0) * 1e6).toFixed(2)} →{" "}
                              {(c.new_output * 1e6).toFixed(2)}
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <ButtonGroup>
              <Button
                size="sm"
                disabled={step !== "idle"}
                onClick={async () => {
                  setStep("applying");
                  try {
                    const d = await invoke<PricingView>("update_apply", { token: preview.token });
                    setData(d);
                    setRows(d.rows);
                    setPreview(null);
                    setOffer(null);
                  } catch (e) {
                    toast.error(typeof e === "string" ? e : String(e));
                  } finally {
                    setStep("idle");
                  }
                }}
              >
                {step === "applying" && <Spinner />}
              确认更新
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreview(null);
                  setOffer(null);
                }}
              >
                不更新
              </Button>
                        </ButtonGroup>
            <p className="text-muted-foreground">
              你的自定义价格不受影响，更新只换底下那份公共价目表。
            </p>
          </div>
        )}
      </div>

          </section>
  );
}

function Cell({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      // macOS 会把首字母大写，而模型名是大小写敏感的
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      variant="inline"
      className={cn(mono && "font-mono")}
    />
  );
}

/** 数字格。**空串不等于 0** —— 但保存时要是个数，所以空的按 0 走。 */
function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Input
      variant="inline"
      className="w-20 text-right font-mono"
      value={text}
      inputMode="decimal"
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
