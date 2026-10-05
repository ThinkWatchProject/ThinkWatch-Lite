import { useCallback, useState } from "react";
import { PlusIcon, TagIcon } from "lucide-react";
import { useText } from "@/i18n";
import { useNav } from "@/nav";
import type { ProviderView } from "@/types";
import { Button } from "@/ui/button";
import { Count } from "@/ui/count";
import { EmptyState, Loadable, TableSkeleton } from "@/ui/states";
import { useDismissedHints } from "@/guide/hints";
import type { AliasInput, AliasSuggestion, AliasView } from "@/types";
import { aliasesText } from "./aliases.i18n";
import { AliasTable } from "./AliasTable";
import { useAliases, useSuggestions } from "./data";
import { DeleteAliasDialog } from "./DeleteAliasDialog";
import { showTabDot, suggestionInput } from "./logic";
import { SuggestionList, SuggestionsBanner, SuggestionsDialog } from "./Suggestions";

/**
 * 新建或编辑别名的对话框要打开成什么样（对话框本身是 `AliasDialog.tsx`，上游页挂它）。
 * `initial`：从建议、上游模型弹窗进来时的预填。
 */
export type AliasDialogMode = { kind: "create"; initial?: Partial<AliasInput> } | { kind: "edit"; name: string };

type Providers = Pick<ProviderView, "name" | "base_url" | "protocol">[];

/**
 * 上游页的「别名」标签：别名表、顶上的建议、尚无别名时直接列出建议。
 *
 * 新建与编辑的对话框不在这里，交给上游页（`onCreate` / `onEdit`）：上游模型弹窗里的
 * 「起别名…」打开的是同一个。同一模型不同名称的对话框和删除对话框在这里。
 */
export function AliasesTab({
  providers,
  configVersion,
  onCreate,
  onEdit,
  onChanged,
}: {
  providers: Providers;
  configVersion: string;
  onCreate: (initial?: Partial<AliasInput>) => void;
  onEdit: (name: string) => void;
  /** 写入之后（删除）让外面重读概览 */
  onChanged: () => void;
}) {
  const t = useText(aliasesText);
  const nav = useNav();
  const aliases = useAliases();
  const { visible, dismiss } = useSuggestions(aliases.data);
  const [dialog, setDialog] = useState<null | { kind: "suggestions" } | { kind: "delete"; alias: AliasView }>(null);
  const close = useCallback(() => setDialog(null), []);
  const fromSuggestion = (s: AliasSuggestion) => {
    setDialog(null);
    onCreate(suggestionInput(s));
  };

  return (
    <>
      <Loadable
        r={aliases}
        loading={<TableSkeleton rows={4} cols={4} />}
        errorTitle={t.loadFailed}
        isEmpty={(d) => d.aliases.length === 0}
        empty={
          <div className="flex flex-col gap-5">
            <EmptyState
              icon={<TagIcon />}
              title={t.empty}
              description={t.emptyDesc}
              className={visible.length > 0 ? "py-8" : undefined}
              action={
                <Button size="sm" onClick={() => onCreate()}>
                  <PlusIcon />
                  {t.newAlias}
                </Button>
              }
            />
            {visible.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="tw-body font-medium">{t.emptySuggestions}</h3>
                <SuggestionList
                  suggestions={visible}
                  providers={providers}
                  onCreate={fromSuggestion}
                  onDismiss={dismiss}
                />
              </section>
            )}
          </div>
        }
      >
        {(d) => (
          <div className="flex flex-col gap-3">
            <SuggestionsBanner
              suggestions={visible}
              onCreate={fromSuggestion}
              onView={() => setDialog({ kind: "suggestions" })}
              onDismiss={dismiss}
            />
            <AliasTable
              aliases={d.aliases}
              providers={providers}
              actions={{
                edit: onEdit,
                traffic: (name) => nav.open("requests", { filter: { model: name } }),
                remove: (name) => {
                  const alias = d.aliases.find((a) => a.name === name);
                  if (alias) setDialog({ kind: "delete", alias });
                },
              }}
            />
          </div>
        )}
      </Loadable>

      {dialog?.kind === "suggestions" && (
        <SuggestionsDialog
          suggestions={visible}
          providers={providers}
          onCreate={fromSuggestion}
          onDismiss={dismiss}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteAliasDialog
          alias={dialog.alias}
          configVersion={configVersion}
          onClose={close}
          onDeleted={() => {
            setDialog(null);
            void aliases.reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/**
 * 标签名上的两样：别名的个数（读到了、而且有才写），和有没点过「忽略」的建议时的小圆点
 * （看着这个标签时不画）。
 */
export function AliasTabLabel({ active }: { active: boolean }) {
  const t = useText(aliasesText);
  const aliases = useAliases();
  const dismissed = useDismissedHints();
  const n = aliases.data?.aliases.length ?? 0;
  const dot = showTabDot(aliases.data?.suggestions, dismissed, active);
  return (
    <>
      {t.tab}
      {n > 0 && <Count n={n} />}
      {dot && <span role="img" aria-label={t.tabDot} className="size-1.5 shrink-0 rounded-full bg-foreground" />}
    </>
  );
}
