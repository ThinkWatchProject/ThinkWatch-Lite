import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { focusSelf } from "@/ui/dialog-focus";
import { Input } from "@/ui/input";
import { SecretInput } from "@/ui/secret-input";
import { Segmented } from "@/ui/segmented";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { FormRow, FormRows } from "@/settings/form";
import { useRemote } from "@/connection/useRemote";
import type { SyncDevice, SyncJoin, SyncJoinPreview, SyncProbe } from "@/types";
import { syncApi } from "./api";
import { initialPicks, mergeDecisions, unresolved, type MergePicks } from "./decide";
import { NewPassphrase, TargetFields, type RowOf } from "./Fields";
import { syncFieldsText } from "./fields.i18n";
import { joinWizardText } from "./JoinWizard.i18n";
import { ago } from "./labels";
import { MergeRows } from "./MergeRows";
import { EMPTY_TARGET, passphraseProblem, PASSPHRASE_MIN, sameTarget, targetOf, targetProblem, type TargetDraft } from "./target";

type Step = "location" | "encryption" | "merge";

/** 测试连接的结果，连同测的是哪一份（改了之后就不作数） */
interface Tested {
  draft: TargetDraft;
  probe: SyncProbe;
}

/**
 * 开启同步（方案 6.8），三步：
 *
 * 1. **同步位置**：类型与连接参数、本设备名称；「测试连接」验证读写。同步位置为空 → 第 2 步
 *    新建；已有加密的同步数据 → 第 2 步输入口令；已有未加密的 → 跳过第 2 步。
 * 2. **加密**：新建时选加密（缺省）或不加密，加密要两次口令、至少 12 个字符；加入时输入一次。
 * 3. **合并**：只在加入已有同步、本机又不是初始配置时出现。和导入同一套预览，另可选「使用
 *    同步数据替换本机配置」。本机是初始配置的，直接用同步数据，不出现这一步。
 *
 * 开启、加入之前先把接管着的客户端在用的密钥报给 core（「替换」时 core 据此把它们并入）。
 */
export function JoinWizard({
  proxies,
  onClose,
  onDone,
}: {
  proxies: readonly string[];
  onClose: () => void;
  /** 开好了：外面重读同步状态 */
  onDone: () => void;
}) {
  const t = useText(joinWizardText);
  const ft = useText(syncFieldsText);
  const common = useText(commonText);
  const remote = useRemote();

  const [step, setStep] = useState<Step>("location");
  const [draft, setDraft] = useState<TargetDraft>({ ...EMPTY_TARGET });
  const [device, setDevice] = useState(remote?.name ?? "");
  const [tested, setTested] = useState<Tested | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [encrypt, setEncrypt] = useState(true);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [preview, setPreview] = useState<SyncJoinPreview | null>(null);
  const [devices, setDevices] = useState<SyncDevice[]>([]);
  const [join, setJoin] = useState<SyncJoin>("merge");
  const [picks, setPicks] = useState<MergePicks>({});
  const [busy, setBusy] = useState<"test" | "next" | "enable" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 本设备名称的缺省值：这台电脑的名字（远程 core 用连接的名字）。已经开始填的不盖掉
  useEffect(() => {
    if (remote) return;
    let alive = true;
    syncApi
      .computerName()
      .then((n) => alive && setDevice((typed) => typed || n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [remote]);

  const fresh = tested && sameTarget(tested.draft, draft) ? tested : null;
  const existing = fresh?.probe.existing ?? null;
  const problem = targetProblem(draft);
  const deviceOk = device.trim() !== "";
  /** 这一步还差什么：页脚左边那一句 */
  const missing =
    step === "location"
      ? problem
        ? ft.problem[problem]
        : !deviceOk
          ? ft.deviceNameMissing
          : null
      : step === "encryption"
        ? existing
          ? pass === ""
            ? t.enterPassphrase
            : null
          : encrypt
            ? passphraseHint(passphraseProblem(pass, pass2))
            : null
        : join === "merge" && preview && unresolved(preview.rows, picks, preview.auto) > 0
          ? t.unresolved(unresolved(preview.rows, picks, preview.auto))
          : null;

  function passphraseHint(p: "short" | "mismatch" | null): string | null {
    if (p === "short") return ft.passphraseShort(PASSPHRASE_MIN);
    if (p === "mismatch") return ft.passphraseMismatch;
    return null;
  }

  async function test(): Promise<Tested | null> {
    setTestError(null);
    setTested(null);
    try {
      const probe = await syncApi.test(targetOf(draft), null);
      const r = { draft, probe };
      setTested(r);
      return probe.writable ? r : null;
    } catch (e) {
      setTestError(errorText(e));
      return null;
    }
  }

  async function run<T>(kind: "test" | "next" | "enable", f: () => Promise<T>) {
    setBusy(kind);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  /** 开启或加入。`how`：新建时无所谓，加入时是合并还是替换 */
  async function enable(how: SyncJoin, decisions = mergeDecisions(preview?.rows ?? [], picks, preview?.auto ?? [])) {
    // 在用的密钥先报上去；报不上不挡着（core 用上一次报的）
    await syncApi.pinKeys().catch(() => {});
    await syncApi.enable({
      target: targetOf(draft),
      encrypt: existing ? existing.encrypted : encrypt,
      passphrase: (existing ? existing.encrypted : encrypt) ? pass : null,
      device_name: device.trim(),
      join: how,
      decisions: how === "merge" ? decisions : [],
    });
    onDone();
    onClose();
  }

  /** 加入已有的：先看合并预览。本机是初始配置的直接用同步数据 */
  async function previewJoin(passphrase: string | null) {
    if (passphrase !== null) {
      // 先验口令，顺带拿到已在同步的设备
      const probe = await syncApi.test(targetOf(draft), passphrase);
      if (!probe.existing?.unlocked) {
        setError(probe.error ? coreText(probe.error) : t.wrongPassphrase);
        return;
      }
      setDevices(probe.existing.devices);
    } else {
      setDevices(existing?.devices ?? []);
    }
    const p = await syncApi.joinPreview(targetOf(draft), passphrase);
    if (p.initial) {
      await enable("use_remote", []);
      return;
    }
    setPreview(p);
    setPicks(initialPicks(p.rows, p.auto));
    setStep("merge");
  }

  async function next() {
    if (step === "location") {
      const r = fresh ?? (await test());
      if (!r?.probe.writable) return;
      const ex = r.probe.existing;
      if (ex && !ex.encrypted) return previewJoin(null);
      setStep("encryption");
      return;
    }
    if (step === "encryption") {
      if (existing) return previewJoin(pass);
      return enable("merge", []);
    }
    return enable(join);
  }

  const row: RowOf = ({ id, label, htmlFor, hint, control }) => (
    <FormRow key={id} label={label} htmlFor={htmlFor} hint={hint}>
      {control}
    </FormRow>
  );

  const finish = step === "merge" || (step === "encryption" && !existing);
  const steps: { id: Step; label: string; skipped?: boolean }[] = [
    { id: "location", label: t.steps.location },
    { id: "encryption", label: existing && !existing.encrypted ? t.skipped : t.steps.encryption, skipped: !!existing && !existing.encrypted },
    // 测过了才知道：同步位置是空的就没有合并这一步
    { id: "merge", label: t.steps.merge, skipped: !!fresh && !existing },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && busy !== "enable" && onClose()}>
      <DialogContent
        className={cn("flex max-h-[calc(100vh-4rem)] flex-col gap-4", step === "merge" ? "sm:max-w-[720px]" : "sm:max-w-[600px]")}
        onOpenAutoFocus={focusSelf}
      >
        <DialogHeader>
          <DialogTitle className="tw-title">{t.title}</DialogTitle>
          <Steps steps={steps} current={step} />
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
          {step === "location" && (
            <>
              <DialogDescription>{t.locationDesc}</DialogDescription>
              <FormRows>
                <TargetFields
                  draft={draft}
                  proxies={proxies}
                  remote={!!remote}
                  disabled={busy !== null}
                  onChange={(patch) => {
                    setDraft((d) => ({ ...d, ...patch }));
                    setError(null);
                  }}
                  row={row}
                />
                <FormRow label={ft.deviceName} htmlFor="sync-device" hint={ft.deviceNameHint}>
                  <Input
                    id="sync-device"
                    className="w-60"
                    value={device}
                    disabled={busy !== null}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setDevice(e.target.value)}
                  />
                </FormRow>
              </FormRows>
              <TestResult testing={busy === "test" || (busy === "next" && !fresh)} tested={fresh} error={testError} />
            </>
          )}

          {step === "encryption" && !existing && (
            <>
              <DialogDescription>{t.encryptDesc}</DialogDescription>
              <Segmented<"on" | "off">
                block
                label={t.steps.encryption}
                value={encrypt ? "on" : "off"}
                disabled={busy !== null}
                options={[
                  { id: "on", label: t.encrypt },
                  { id: "off", label: t.noEncrypt },
                ]}
                onChange={(v) => setEncrypt(v === "on")}
              />
              {encrypt ? (
                <FormRows>
                  <NewPassphrase
                    id="sync-pass"
                    a={pass}
                    b={pass2}
                    onA={setPass}
                    onB={setPass2}
                    hint={t.encryptHint}
                    disabled={busy !== null}
                    row={row}
                  />
                </FormRows>
              ) : (
                <Banner layout="inline" tone="warning" title={t.plainTitle}>
                  {t.plainBody}
                </Banner>
              )}
            </>
          )}

          {step === "encryption" && existing && (
            <>
              <DialogDescription>{t.joinDesc}</DialogDescription>
              <FormRows>
                <FormRow label={ft.passphrase} htmlFor="sync-join-pass">
                  <div className="w-80">
                    <SecretInput
                      id="sync-join-pass"
                      value={pass}
                      disabled={busy !== null}
                      onChange={(e) => {
                        setPass(e.target.value);
                        setError(null);
                      }}
                    />
                  </div>
                </FormRow>
              </FormRows>
            </>
          )}

          {step === "merge" && preview && (
            <>
              <DialogDescription>{t.mergeDesc}</DialogDescription>
              {devices.length > 0 && (
                <p className="tw-body text-muted-foreground">
                  {t.devices(devices.map((d) => t.deviceLine(d.name, ago(d.last_seen_ms))).join(t.deviceSep))}
                </p>
              )}
              <Segmented<SyncJoin>
                block
                label={t.steps.merge}
                value={join}
                disabled={busy !== null}
                options={[
                  { id: "merge", label: t.mode.merge },
                  { id: "use_remote", label: t.mode.use_remote },
                ]}
                onChange={setJoin}
              />
              {join === "merge" ? (
                preview.rows.some((r) => r.status !== "same") ? (
                  <MergeRows
                    rows={preview.rows}
                    auto={preview.auto}
                    picks={picks}
                    onPicks={setPicks}
                    disabled={busy !== null}
                  />
                ) : (
                  <p className="tw-body text-muted-foreground">{t.noDifferences}</p>
                )
              ) : (
                <Banner layout="inline" tone="info">
                  {t.replaceNote}
                </Banner>
              )}
            </>
          )}

          <Banner layout="inline" tone="error" show={error !== null} title={t.failed}>
            {error}
          </Banner>
        </div>

        <DialogFooter className="items-center">
          {step === "location" ? (
            <Button
              variant="outline"
              className="sm:mr-auto"
              pending={busy === "test"}
              disabled={busy !== null || problem !== null}
              onClick={() => void run("test", test)}
            >
              {t.test}
            </Button>
          ) : (
            <Button
              variant="outline"
              className="sm:mr-auto"
              disabled={busy !== null}
              onClick={() => {
                setError(null);
                setStep(step === "merge" && existing?.encrypted ? "encryption" : "location");
              }}
            >
              {t.back}
            </Button>
          )}
          {missing && <span className="tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" disabled={busy === "enable"} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            pending={busy === "next" || busy === "enable"}
            disabled={busy !== null || missing !== null}
            onClick={() => void run(finish ? "enable" : "next", next)}
          >
            {step === "merge" ? t.join : finish ? t.enable : t.next}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 第几步：做过的、当前的、跳过的（未加密时的「加密」，同步位置为空时的「合并」） */
function Steps({ steps, current }: { steps: { id: Step; label: string; skipped?: boolean }[]; current: Step }) {
  const t = useText(joinWizardText);
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol className="flex items-center gap-2 tw-label text-muted-foreground">
      {steps.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex items-center gap-2",
            i === at && "font-medium text-foreground",
            s.skipped && i !== at && "opacity-50",
          )}
        >
          {i > 0 && <span aria-hidden className="h-px w-4 bg-border" />}
          <span>{t.stepOf(i + 1, s.label)}</span>
        </li>
      ))}
    </ol>
  );
}

/** 测试连接的结果：在连就转圈；可以读写说同步位置是空的还是已有数据；不行说原因 */
function TestResult({ testing, tested, error }: { testing: boolean; tested: Tested | null; error: string | null }) {
  const t = useText(joinWizardText);
  let body: ReactNode = null;
  if (testing) {
    body = (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface/45 px-3.5 py-2.5 tw-body text-muted-foreground motion-fade">
        <Spinner />
        {t.testing}…
      </div>
    );
  } else if (error) {
    body = (
      <Banner layout="inline" tone="error" title={t.testFailed} className="motion-fade">
        {error}
      </Banner>
    );
  } else if (tested && !tested.probe.writable) {
    body = (
      <Banner layout="inline" tone="error" title={t.notWritable} className="motion-fade">
        {tested.probe.error ? coreText(tested.probe.error) : null}
      </Banner>
    );
  } else if (tested) {
    const ex = tested.probe.existing;
    body = (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface/45 px-3.5 py-2.5 tw-body motion-fade">
        <CheckIcon className="size-4 shrink-0 text-success" aria-hidden />
        {ex ? t.existingOk(ex.devices.length, ex.encrypted) : t.emptyOk}
      </div>
    );
  }
  return body;
}
