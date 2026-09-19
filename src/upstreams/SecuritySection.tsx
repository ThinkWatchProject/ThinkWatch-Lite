import { InfoIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { useText } from "@/i18n";
import type { Overview, ProviderPreview } from "@/types";
import { REDACT_KINDS } from "./labels";
import { RadioRow } from "./parts";
import { securitySectionText } from "./SecuritySection.i18n";
import type { UpstreamForm } from "./upstreamForm";

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
  const t = useText(securitySectionText);
  const modeLabel: Record<string, string> = t.modes;
  const official = preview?.official;
  const autoKinds = preview?.redact ?? [];
  const kinds = form.redactMode === "custom" ? form.redact : autoKinds;
  const redactMode = ov.security?.redact ?? "observe";
  const toolMode = ov.security?.inspect_tools ?? "observe";

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label={t.trust} className="flex flex-col gap-3">
        <span className="tw-body font-medium">{t.trust}</span>
        <RadioRow
          checked={form.trust === ""}
          onSelect={() => set({ trust: "" })}
          title={t.auto}
          desc={official == null ? t.byUrl : t.trustDetected(official)}
        />
        <RadioRow
          checked={form.trust === "official"}
          onSelect={() => set({ trust: "official" })}
          title={t.official}
          desc={t.officialDesc}
        />
        <RadioRow
          checked={form.trust === "untrusted"}
          onSelect={() => set({ trust: "untrusted" })}
          title={t.unofficial}
          desc={t.unofficialDesc}
        />
      </div>

      <div className="h-px bg-border" />

      <div role="radiogroup" aria-label={t.redact} className="flex flex-col gap-3">
        <span className="tw-body font-medium">{t.redact}</span>
        <RadioRow
          checked={form.redactMode === "auto"}
          onSelect={() => set({ redactMode: "auto" })}
          title={t.auto}
          desc={official == null ? t.byUrl : official ? t.redactOfficial : t.redactUnofficial}
        />
        <RadioRow
          checked={form.redactMode === "custom"}
          onSelect={() =>
            // 从自动识别此刻的结果开始改，而不是从空白开始
            set({ redactMode: "custom", redact: form.redactMode === "custom" ? form.redact : autoKinds })
          }
          title={t.custom}
          desc={t.customDesc}
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
          {t.status(modeLabel[redactMode] ?? redactMode, modeLabel[toolMode] ?? toolMode)}
          <Button variant="link" size="xs" className="h-auto px-1 py-0" onClick={onGoToGuard}>
            {t.goToGuard}
          </Button>
        </p>
      </div>
    </div>
  );
}
