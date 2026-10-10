/**
 * 手动添加模型的名单式输入，两处共用：模型弹窗的「添加模型…」对话框（`ManualModelsDialog`），
 * 和编辑对话框的「模型」一节（`ModelsSection`）。
 *
 * 写法和放行网段、插件范围一样：一条一行，最后一行输入，右边写「回车添加」，一次粘贴几个按
 * 空白和逗号拆开；写错的、重复的、已经加过的、上游已经列出的当场说，留在输入框里。失焦也算
 * 添加。框里输入行上面放什么（待添加的几行、整张模型表）由调用方给。
 *
 * 加进哪儿、拿什么查重也由调用方定（`useManualEntry` 的 `add`）：对话框加进「待添加」，
 * 编辑对话框直接加进表单里的手动清单。
 */
import { type ReactNode, type Ref, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Input } from "@/ui/input";
import { useText } from "@/i18n";
import { MANUAL_MODEL_MAX, type ManualProblem } from "./manualModels";
import { manualModelInputText } from "./ManualModelInput.i18n";
import { Boxed } from "./parts";

/** 加一次的结果：输入框里留下的（有毛病的那几个）和第一个毛病 */
export interface ManualAdd {
  rest: string;
  problem: ManualProblem | null;
}

export interface ManualEntry<R extends ManualAdd> {
  input: string;
  problem: ManualProblem | null;
  change: (value: string) => void;
  /**
   * 把输入框里的加进去，交回 `add` 的结果。输入框是空的时为 null —— `quiet`（失焦、保存前
   * 顺手加一下）时不说「不能为空」，空着就是没东西要加
   */
  commit: (quiet?: boolean) => R | null;
}

/** 输入框的字和毛病。`add` 把一段输入加进调用方的名单，交回加的结果 */
export function useManualEntry<R extends ManualAdd>(add: (raw: string) => R): ManualEntry<R> {
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState<ManualProblem | null>(null);
  return {
    input,
    problem,
    change: (value) => {
      setInput(value);
      setProblem(null);
    },
    commit: (quiet = false) => {
      if (input.trim() === "") {
        // 空着离开不算写错：按回车时说过的「不能为空」也收掉
        setProblem(quiet ? (p) => (p?.kind === "blank" ? null : p) : { kind: "blank" });
        return null;
      }
      const r = add(input);
      setInput(r.rest);
      setProblem(r.problem);
      return r;
    },
  };
}

/**
 * 一个框：`children`（已有的几行）在上，最后一行是输入框；框下面一行是提示，有毛病时换成
 * 毛病（整个框描红）。
 */
export function ManualModelList<R extends ManualAdd>({
  entry,
  children,
  label,
  placeholder,
  hint,
  inputRowClassName,
  inputRef,
  fill = false,
}: {
  entry: ManualEntry<R>;
  children?: ReactNode;
  /** 输入框的无障碍名称。不给是「模型 ID」 */
  label?: string;
  /** 不给是「例如 gpt-6-luna」 */
  placeholder?: string;
  /** 框下面那一行。不给是「可添加多个……」 */
  hint?: string;
  /** 输入那一行：比如左边让出表格勾选的那一列，和上面的模型 ID 对齐 */
  inputRowClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
  /**
   * 放在一屏排满的一节里（上游对话框的「模型」）：框按剩下的高度收，`children` 里那一层滚动的
   * 跟着收，输入行和提示不收
   */
  fill?: boolean;
}) {
  const t = useText(manualModelInputText);
  const noteId = useId();
  const message = entry.problem ? problemText(entry.problem, t) : null;
  return (
    <div className={cn("flex flex-col gap-1", fill && "min-h-0")}>
      <Boxed className={cn(fill && "flex min-h-0 flex-col", entry.problem && "border-destructive")}>
        {children}
        <div className={cn("flex h-8 shrink-0 items-center gap-2.5 bg-background px-3", inputRowClassName)}>
          <Input
            ref={inputRef}
            aria-label={label ?? t.models}
            aria-describedby={noteId}
            // 写错时整个框变红就够了，框里的输入框不再套一圈
            className="h-7 flex-1 border-0 bg-transparent px-0 font-mono shadow-none focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent"
            value={entry.input}
            placeholder={placeholder ?? t.placeholder}
            aria-invalid={entry.problem ? true : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => entry.change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              // 回车是添加这一条，不是提交对话框
              e.preventDefault();
              entry.commit();
            }}
            // 输了没按回车就去点别处：这一条也算上，不让它悄悄丢掉
            onBlur={() => entry.commit(true)}
          />
          <span className="shrink-0 tw-label text-muted-foreground">{t.enterToAdd}</span>
        </div>
      </Boxed>
      <p id={noteId} className={cn("shrink-0 tw-label", message ? "text-destructive" : "text-muted-foreground")}>
        {message ?? hint ?? t.hint}
      </p>
    </div>
  );
}

/**
 * 模型名后面的「手动」标记。上游也列了的照样标：手动清单里有什么，一样不藏，悬停说上游
 * 列没列它
 */
export function ManualTag({ listed }: { listed: boolean }) {
  const t = useText(manualModelInputText);
  return (
    <Badge
      variant="secondary"
      title={listed ? t.manualListedTitle : t.manualOnlyTitle}
      className="h-4 shrink-0 rounded-[4px] px-1 font-sans font-normal"
    >
      {t.manualTag}
    </Badge>
  );
}

function problemText(problem: ManualProblem, t: (typeof manualModelInputText)["zh"]): string {
  switch (problem.kind) {
    case "blank":
      return t.blank;
    case "wildcard":
      return t.wildcard(problem.id);
    case "tooLong":
      return t.tooLong(MANUAL_MODEL_MAX);
    case "duplicate":
      return t.duplicate(problem.id);
    case "added":
      return t.added(problem.id);
    case "listed":
      return t.listed(problem.id);
  }
}
