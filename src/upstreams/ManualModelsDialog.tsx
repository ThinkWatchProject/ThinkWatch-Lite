import { useState } from "react";
import { cn } from "@/lib/utils";
import { invalidate } from "@/lib/resource";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { rowMotion, usePresentList } from "@/ui/motion";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ProviderView } from "@/types";
import { api } from "./api";
import { modelsKey } from "./data";
import { globMatch } from "./glob";
import { errorText } from "./labels";
import { ManualModelList, useManualEntry } from "./ManualModelInput";
import { manualModelInputText } from "./ManualModelInput.i18n";
import { addIds } from "./manualModels";
import { manualModelsDialogText } from "./ManualModelsDialog.i18n";
import { DialogError } from "./parts";

/**
 * 给一家上游手动添加模型（`PUT /provider-manual-models`）：上游能服务、却没列进模型列表的
 * 模型。添加之后它们和列出的模型一样出现在客户端的模型列表里、路由到这家。
 *
 * 名单式输入和编辑对话框的「模型」一节共用（`ManualModelInput`）。**交给 core 的是整份手动
 * 清单**：原来的接上这次添加的。
 *
 * 挂载方：上游表「模型」一格的弹窗（「添加模型…」）。对话框挂在弹窗外面：弹窗一收起，
 * 里面的东西就卸掉了。
 */
export function ManualModelsDialog({
  open,
  onOpenChange,
  p,
  listed,
  configVersion,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  p: ProviderView;
  /** 上游自己列出的模型。加它们不改变什么，当场说 */
  listed: readonly string[];
  /** 概览里的配置版本。**只取打开那一刻的**，见 `Body` 的 `base` */
  configVersion: string;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 点到对话框外面不关：填了一半的名单不该因为一次误点丢掉。Esc、×、取消照常 */}
      <DialogContent className="flex flex-col gap-4 sm:max-w-[520px]" onInteractOutside={(e) => e.preventDefault()}>
        {/* 内容只在开着时挂上：每次打开都从空的名单起 */}
        {open && (
          <Body
            p={p}
            listed={listed}
            configVersion={configVersion}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  p,
  listed,
  configVersion,
  onClose,
  onSaved,
}: {
  p: ProviderView;
  listed: readonly string[];
  configVersion: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useText(manualModelsDialogText);
  const shared = useText(manualModelInputText);
  const c = useText(commonText);
  const [drafts, setDrafts] = useState<string[]>([]);
  const entry = useManualEntry((raw) => {
    const r = addIds(raw, { drafts, manual: p.models, listed });
    setDrafts(r.drafts);
    return r;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = usePresentList(drafts, (x) => x);
  /*
    **打开时的版本号，保存时带它。**交的是原来的手动清单接上这次的：开着的时候别处改了这份
    清单，带保存那一刻的版本号，core 的冲突检查永远通过，别人的改动就被盖掉了
  */
  const [base] = useState(configVersion);

  async function save() {
    // 输入框里还有没按回车的：先加上，写错了就不存（毛病留在输入框里说）
    const r = entry.commit(true);
    if (r?.problem) return;
    const next = r ? r.drafts : drafts;
    if (next.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.setManualModels({ provider: p.name, models: [...p.models, ...next], base_version: base });
      // 用到这家清单的几处：模型弹窗、路由里指定的模型、测速、价目表，别名和模型目录
      invalidate(modelsKey(p.name));
      invalidate("aliases");
      invalidate("known-models");
      onSaved?.();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const inScope = (id: string) => !p.models_only || p.models_only.some((g) => globMatch(g, id));

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) void save();
      }}
    >
      <DialogHeader>
        <DialogTitle className="tw-title">{t.title}</DialogTitle>
        <DialogDescription className="truncate">{p.name}</DialogDescription>
      </DialogHeader>

      <p className="tw-body text-muted-foreground">{shared.about}</p>

      <ManualModelList entry={entry}>
        {rows.map(({ item: id, key, presence }) => (
          <div
            key={key}
            className={cn("flex h-8 items-center gap-2.5 border-b border-border pr-1 pl-3", rowMotion(presence))}
          >
            <span className="min-w-0 flex-1 truncate font-mono tw-body" title={id}>
              {id}
            </span>
            {!inScope(id) && <span className="shrink-0 tw-label text-muted-foreground">{t.outOfScope}</span>}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t.remove(id)}
              className="shrink-0 text-muted-foreground"
              onClick={() => setDrafts((ds) => ds.filter((x) => x !== id))}
            >
              {t.removeShort}
            </Button>
          </div>
        ))}
      </ManualModelList>

      <DialogError error={error} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {c.cancel}
        </Button>
        <Button type="submit" pending={saving} disabled={drafts.length === 0 && entry.input.trim() === ""}>
          {c.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
