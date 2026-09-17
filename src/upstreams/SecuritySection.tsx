import { InfoIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import type { Overview, ProviderPreview } from "@/types";
import { REDACT_KINDS } from "./labels";
import { RadioRow } from "./parts";
import type { UpstreamForm } from "./upstreamForm";

const MODE_LABEL: Record<string, string> = {
  off: "关闭",
  observe: "观察",
  enforce: "拦截",
};

export function SecuritySection({
  form,
  set,
  ov,
  preview,
  onGoToGuard,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  ov: Overview;
  /** 按接口地址自动识别的结果。还没取到是 null */
  preview: ProviderPreview | null;
  onGoToGuard: () => void;
}) {
  const official = preview?.official;
  const autoKinds = preview?.redact ?? [];
  const kinds = form.redactMode === "custom" ? form.redact : autoKinds;
  const redactMode = ov.security?.redact ?? "observe";
  const toolMode = ov.security?.inspect_tools ?? "observe";

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="信任级别" className="flex flex-col gap-3">
        <span className="tw-body font-medium">信任级别</span>
        <RadioRow
          checked={form.trust === ""}
          onSelect={() => set({ trust: "" })}
          title="自动识别"
          desc={
            official == null
              ? "按接口地址识别。"
              : `按接口地址识别，当前为${official ? "官方端点" : "非官方端点"}。`
          }
        />
        <RadioRow
          checked={form.trust === "official"}
          onSelect={() => set({ trust: "official" })}
          title="官方端点"
          desc="工具调用仅记录，不拦截。"
        />
        <RadioRow
          checked={form.trust === "untrusted"}
          onSelect={() => set({ trust: "untrusted" })}
          title="非官方端点"
          desc="拦截高危工具调用，中危工具调用发出告警。"
        />
      </div>

      <div className="h-px bg-border" />

      <div role="radiogroup" aria-label="发送前脱敏" className="flex flex-col gap-3">
        <span className="tw-body font-medium">发送前脱敏</span>
        <RadioRow
          checked={form.redactMode === "auto"}
          onSelect={() => set({ redactMode: "auto" })}
          title="自动识别"
          desc={
            official == null
              ? "按接口地址识别。"
              : official
                ? "按接口地址识别，当前为官方端点，不脱敏。"
                : "按接口地址识别，当前为非官方端点，对以下类别脱敏。"
          }
        />
        <RadioRow
          checked={form.redactMode === "custom"}
          onSelect={() =>
            // 从自动识别此刻的结果开始改，而不是从空白开始
            set({ redactMode: "custom", redact: form.redactMode === "custom" ? form.redact : autoKinds })
          }
          title="自定义"
          desc="为此上游单独指定脱敏类别。不勾选任何类别即不脱敏。"
        />
        <div className="grid max-w-md grid-cols-2 gap-x-4 gap-y-2.5 pl-6">
          {REDACT_KINDS.map((k) => (
            <label
              key={k.id}
              className={
                "flex items-center gap-2 tw-body " +
                (form.redactMode === "custom" ? "" : "opacity-50")
              }
            >
              <Checkbox
                checked={kinds.includes(k.id)}
                disabled={form.redactMode !== "custom"}
                onCheckedChange={(v) =>
                  set({
                    redact:
                      v === true
                        ? [...form.redact, k.id]
                        : form.redact.filter((x) => x !== k.id),
                  })
                }
              />
              {k.label}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-start gap-2 border-t border-border pt-3">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="tw-label text-muted-foreground">
          出站脱敏当前为「{MODE_LABEL[redactMode] ?? redactMode}」模式，工具调用审查当前为「
          {MODE_LABEL[toolMode] ?? toolMode}」模式。「观察」模式只记录命中，不改变请求。
          <Button variant="link" size="xs" className="h-auto px-1 py-0" onClick={onGoToGuard}>
            前往防护
          </Button>
        </p>
      </div>
    </div>
  );
}
