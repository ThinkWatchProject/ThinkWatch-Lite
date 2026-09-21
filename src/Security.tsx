import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import type {
  AdoptResponse,
  BaselineResponse,
  McpOpRequest,
  McpTargetView,
  PlanView,
  Overview,
  ScanFinding,
  ScanResponse,
} from "./types";
import { scanRulesText } from "./labels";
import { Button } from "@/ui/button";
import { Alert, AlertDescription } from "@/ui/alert";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { Count } from "@/ui/count";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { securityText } from "./Security.i18n";
import { Behaviour } from "./security/Behaviour";
import { Defences } from "./security/Defences";
import { Matrix, McpConfirm } from "./security/Matrix";
import { coreText, errorText } from "@/i18n/core.i18n";

/**
 * 客户端配置面。
 *
 * 两件事放在一页，因为**它们是同一件事的两面**：扫描要知道去哪儿找，
 * 而清单正是那份地址簿。
 *
 * 三条纪律写在界面上：
 *
 * - **只报告，不自动删除。**这一页没有任何删除按钮。误报删掉用户的
 *   正常配置比漏报还糟 —— 它会摧毁信任，然后用户关掉整个功能。
 * - **查干净了要说「没发现问题」**，而不是让这一块消失。
 * - **不存任何状态。**每次打开现扫一遍，你看到的永远是磁盘上此刻的
 *   真实情况；没有「同步失效了」这种问题，因为压根没有同步状态。
 */
/** 四个标签，前后就是「改策略」和「看证据」 */
type SecurityTab = "guards" | "findings" | "surface" | "behaviour";

export default function Security({
  ov,
  configVersion,
  onChanged,
  alerts,
  onSeen,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
  /** 监听到的、**新出现**的那些。它们已经在下面的完整列表里了，
   *  这里单独再说一遍是因为「刚刚变的」和「一直就有」是两个信号。 */
  alerts: ScanFinding[];
  onSeen: () => void;
}) {
  const t = useText(securityText);
  // **有新发现就直接落在「发现」上。**告警来了还让人先点一下标签，
  // 等于把那条通知又藏了一层
  const [tab, setTab] = useState<SecurityTab>(
    alerts.length > 0 ? "findings" : "guards",
  );
  const [data, setData] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ScanFinding | null>(null);
  const [targets, setTargets] = useState<McpTargetView[]>([]);
  const [base, setBase] = useState<BaselineResponse | null>(null);
  const [pending, setPending] = useState<{
    req: McpOpRequest;
    plan: PlanView;
  } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [scan, ts, bl] = await Promise.all([
        invoke<ScanResponse>("scan_configs", { projects: [] }),
        invoke<McpTargetView[]>("mcp_targets"),
        invoke<BaselineResponse>("baseline"),
      ]);
      setData(scan);
      setTargets(ts);
      setBase(bl);
      setError(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  /** 点了格子。**先算一份 diff**，不直接写 —— 和接管同一条纪律。 */
  async function ask(req: McpOpRequest) {
    setBusy(true);
    setError(null);
    try {
      setPending({ req, plan: await invoke<PlanView>("mcp_plan", { req }) });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await invoke<AdoptResponse>("mcp_apply", { req: pending.req });
      setPending(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="p-5 tw-head text-muted-foreground">
        {error ?? t.scanning}
      </div>
    );
  }

  const high = data.findings.filter((f) => f.level === "high").length;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as SecurityTab)}
      className="gap-3 p-5"
    >
      <TabsList>
        <TabsTrigger value="guards">{t.tabGuards}</TabsTrigger>
        <TabsTrigger value="findings">
          {t.tabFindings} <Count n={data.findings.length} />
        </TabsTrigger>
        <TabsTrigger value="surface">{t.tabSurface}</TabsTrigger>
        <TabsTrigger value="behaviour">{t.tabBehaviour}</TabsTrigger>
      </TabsList>

      <TabsContent value="guards">
        <Defences ov={ov} configVersion={configVersion} onChanged={onChanged} />
      </TabsContent>

      <TabsContent value="findings" className="space-y-5">
        <div className="flex items-center gap-2 tw-body text-muted-foreground">
          <span>{t.scanned(data.scanned, scanRulesText(data))}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={busy}
          >
            {busy && <Spinner />}
            {t.rescan}
          </Button>
        </div>

        {data.rules_warning && (
          <Alert variant="warning" className="px-3 py-2">
            <AlertDescription>{data.rules_warning}</AlertDescription>
          </Alert>
        )}

        {/* 悄悄跳过比不扫更糟：它会给人一种「查过了」的错觉 */}
        {data.unreadable.length > 0 && (
          <div className="tw-body text-amber-600 dark:text-amber-400">
            {t.unreadable(data.unreadable)}
          </div>
        )}

        {alerts.length > 0 && (
          <section className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <div className="flex items-center gap-2">
              <h2 className="tw-head font-medium text-red-900 dark:text-red-200">
                {t.newFindings(alerts.length)}
              </h2>
              <Button
                variant="destructive"
                size="xs"
                className="ml-auto"
                onClick={onSeen}
              >
                {t.markRead}
              </Button>
            </div>
            {/* 「一个用了半年的 skill 突然多了一段零宽字符」这个信号，
                  比「这个文件里有可疑内容」强得多 */}
            <p className="mt-1 tw-body text-red-800 dark:text-red-300">
              {t.newNote((s) => (
                <span className="font-medium">{s}</span>
              ))}
            </p>
            <ul className="mt-2 space-y-1 tw-body">
              {alerts.map((f, i) => (
                <li key={i}>
                  <Button
                    variant="link"
                    size="xs"
                    className="text-left"
                    onClick={() => setOpen(f)}
                  >
                    {coreText(f.title)}
                    <span className="ml-2 text-red-700 dark:text-red-400">
                      {f.path.replace(/^.*\//, "")}:{f.line}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 tw-head font-medium">
            {t.findings(data.findings.length)}
            {high > 0 && (
              <span className="ml-1 text-red-600 dark:text-red-400">
                {t.high(high)}
              </span>
            )}
          </h2>
          {data.findings.length === 0 ? (
            // 没风险的时候要说「安全」，而不是让这一块消失
            <Alert variant="default" className="px-3 py-2">
              <AlertDescription>
                ✓ {t.noIssues}
                <Tip text={t.checkedTip}>
                  <span className="ml-1 underline decoration-dotted underline-offset-2">
                    {t.checked}
                  </span>
                </Tip>
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="space-y-1">
              {data.findings.map((f, i) => (
                <li key={i}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex h-auto w-full items-start gap-2 text-left"
                    onClick={() => setOpen(f)}
                  >
                    <span
                      className={
                        f.level === "high"
                          ? "text-red-600 dark:text-red-400"
                          : f.level === "medium"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                      }
                    >
                      {f.level === "high"
                        ? "✗"
                        : f.level === "medium"
                          ? "?"
                          : "·"}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">{coreText(f.title)}</span>
                      <span className="ml-2 text-muted-foreground">
                        {f.path.replace(/^.*\//, "")}:{f.line}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </TabsContent>

      <TabsContent value="surface" className="space-y-5">
        <Matrix
          mcp={data.mcp}
          conflicting={data.conflicting}
          targets={targets}
          busy={busy}
          onAsk={ask}
        />

        {data.hooks.length > 0 && (
          <section>
            <h2 className="mb-1 tw-head font-medium">
              {t.hooks(data.hooks.length)}
            </h2>
            {/* 危险度第一：不需要模型参与就能拿到执行权 */}
            <p className="mb-2 tw-body text-muted-foreground">
              {t.hooksNote}
              <Tip text={t.hooksRiskTip}>
                <span className="ml-1 underline decoration-dotted underline-offset-2">
                  {t.hooksRisk}
                </span>
              </Tip>
            </p>
            <ul className="space-y-1 tw-body">
              {data.hooks.map((h, i) => (
                <li
                  key={i}
                  className="rounded border border-border px-3 py-1.5"
                >
                  <span className="text-muted-foreground">{h.event}</span>{" "}
                  <code className="break-all">{h.command}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.skills.length > 0 && (
          <section>
            <h2 className="mb-1 tw-head font-medium">
              {t.skills(data.skills.length)}
            </h2>
            {/* skill 只看不搬 —— 跨客户端的格式还没有事实标准 */}
            <p className="mb-2 tw-body text-muted-foreground">
              {t.skillsNote}
              <Tip text={t.skillsWhyTip}>
                <span className="ml-1 underline decoration-dotted underline-offset-2">
                  {t.skillsWhy}
                </span>
              </Tip>
            </p>
            <ul className="space-y-1 tw-body">
              {data.skills.map((s, i) => (
                <li
                  key={i}
                  className="rounded border border-border px-3 py-1.5"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-2 text-muted-foreground">{s.client}</span>
                  {s.allowed_tools.length > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      {t.tools(s.allowed_tools)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </TabsContent>

      <TabsContent value="behaviour">
        {base ? (
          <Behaviour b={base} />
        ) : (
          <p className="tw-body text-muted-foreground">{t.scanning}</p>
        )}
      </TabsContent>
      {open && <Detail f={open} onClose={() => setOpen(null)} />}
      {pending && (
        <McpConfirm
          plan={pending.plan}
          req={pending.req}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </Tabs>
  );
}

/** 一处发现的详情。**没有删除按钮** —— 删不删由用户自己去改文件。 */
function Detail({ f, onClose }: { f: ScanFinding; onClose: () => void }) {
  const t = useText(securityText);
  const common = useText(commonText);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{coreText(f.title)}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-2 tw-body text-muted-foreground">
          <div>{coreText(f.detail)}</div>
          <div>
            <code>
              {f.path}:{f.line}
            </code>
          </div>
          {/* 不可见字符已经换成可见记号，否则这一行看起来和正常行一样，
              用户会以为我们在误报 */}
          <pre className="overflow-x-auto rounded bg-neutral-50 p-2 dark:bg-neutral-950">
            {f.excerpt}
          </pre>
          <div className="text-muted-foreground">{t.reportOnly}</div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
