import { useEffect } from "react";
import { useText } from "@/i18n";
import type { ProviderView } from "@/types";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import type { AliasSuggestion } from "./api.provisional";
import { aliasesText } from "./aliases.i18n";
import { Lines } from "./AliasTable";
import { suggestionKey, suggestionProviders } from "./logic";

type Providers = Pick<ProviderView, "name" | "base_url" | "protocol">[];

/**
 * 「别名」标签顶上的一条：同一个模型在几个上游的名称不同。只有一条时直接给「建为别名…」，
 * 几条时给个数和「查看…」（打开 `SuggestionsDialog`）。「忽略」记在这台电脑上，和引导
 * 提示的「不再显示」同一处（设置里「重新显示」一起恢复）；几条时一次忽略全部。
 */
export function SuggestionsBanner({
  suggestions,
  onCreate,
  onView,
  onDismiss,
}: {
  /** 还该说的建议（没点过「忽略」的） */
  suggestions: AliasSuggestion[];
  onCreate: (s: AliasSuggestion) => void;
  onView: () => void;
  onDismiss: (s: AliasSuggestion[]) => void;
}) {
  const t = useText(aliasesText);
  const one = suggestions.length === 1 ? suggestions[0]! : null;
  return (
    <Banner
      show={suggestions.length > 0}
      layout="inline"
      tone="info"
      actions={
        <>
          {one ? (
            <Button size="sm" variant="outline" onClick={() => onCreate(one)}>
              {t.createFrom}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onView}>
              {t.view}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onDismiss(suggestions)}>
            {t.ignore}
          </Button>
        </>
      }
    >
      {one ? t.oneSuggestion(one.label, suggestionProviders(one)) : t.manySuggestions(suggestions.length)}
    </Banner>
  );
}

/**
 * 一组建议，每条一行：模型的名称、它在各个上游的名称、「建为别名…」和「忽略」。
 * 尚无别名时直接列在空状态下面，几条建议时在对话框里。
 */
export function SuggestionList({
  suggestions,
  providers,
  onCreate,
  onDismiss,
}: {
  suggestions: AliasSuggestion[];
  providers: Providers;
  onCreate: (s: AliasSuggestion) => void;
  onDismiss: (s: AliasSuggestion[]) => void;
}) {
  const t = useText(aliasesText);
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border tw-body">
      {suggestions.map((s) => (
        <li key={suggestionKey(s)} className="flex items-start gap-3.5 px-3 py-2.5">
          <span className="w-36 shrink-0 font-medium leading-5 @max-3xl/page:w-28">{s.label}</span>
          <Lines
            className="min-w-0 flex-1"
            lines={s.models.map((m) => ({ provider: m.provider, model: m.model }))}
            providers={providers}
          />
          <div className="-my-0.5 flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => onCreate(s)}>
              {t.createFrom}
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onDismiss([s])}>
              {t.ignore}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 几条建议时，顶上那条的「查看…」打开的对话框。全部建好或忽略完了就自己关上。
 */
export function SuggestionsDialog({
  suggestions,
  providers,
  onCreate,
  onDismiss,
  onClose,
}: {
  suggestions: AliasSuggestion[];
  providers: Providers;
  onCreate: (s: AliasSuggestion) => void;
  onDismiss: (s: AliasSuggestion[]) => void;
  onClose: () => void;
}) {
  const t = useText(aliasesText);
  const none = suggestions.length === 0;
  useEffect(() => {
    if (none) onClose();
  }, [none, onClose]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t.suggestTitle}</DialogTitle>
          <DialogDescription>{t.suggestDesc}</DialogDescription>
        </DialogHeader>
        <SuggestionList suggestions={suggestions} providers={providers} onCreate={onCreate} onDismiss={onDismiss} />
        <p className="tw-label text-muted-foreground">{t.suggestScope}</p>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
