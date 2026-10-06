import { useState } from "react";
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
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/ui/input-group";
import { Segmented } from "@/ui/segmented";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ModelRow, SpecSource } from "@/types";
import { api } from "./api";
import { errorText } from "./labels";
import { isEmptySpec, manualOf, sameSpec, specOf, tokensOf, type SpecFlag } from "./modelSpec";
import { modelSpecDialogText } from "./ModelSpecDialog.i18n";
import { DialogError, FormItem } from "./parts";

/**
 * 手写一家上游的一个模型的上下文窗口、输出上限、推理、图片输入（`PUT /provider-model-spec`）。
 *
 * 价目表不认识的中转站模型说不出上下文窗口，价目表写错的也有：这里写的只管这一家的
 * 这一个模型，写了就优先于价目表。**四项都不写就是删掉手写的**，回到价目表。
 *
 * 格子里是手写的那个数；没手写的空着，占位写价目表给的数（没有就说价目表中没有）——
 * 留空是什么意思，看占位就知道。推理、图片输入是三段：价目表 / 支持 / 不支持，价目表怎么说
 * 写在下面一行。
 *
 * 挂载方：上游表「模型」一格的弹窗（「规格…」）。对话框挂在弹窗外面：弹窗一收起，里面的
 * 东西就卸掉了。
 */
export function ModelSpecDialog({
  open,
  onOpenChange,
  provider,
  row,
  configVersion,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string;
  /** 点开时的那一行。关着的时候可以是 null */
  row: ModelRow | null;
  /** 概览里的配置版本。**只取打开那一刻的**，见 `Body` 的 `base` */
  configVersion: string;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open && row !== null} onOpenChange={onOpenChange}>
      {/* 点到对话框外面不关：填了一半的数不该因为一次误点丢掉。Esc、×、取消照常 */}
      <DialogContent className="flex flex-col gap-4 sm:max-w-[520px]" onInteractOutside={(e) => e.preventDefault()}>
        {/* 内容只在开着时挂上：每次打开都从这一行此刻的值填起 */}
        {row && (
          <Body
            provider={provider}
            row={row}
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
  provider,
  row,
  configVersion,
  onClose,
  onSaved,
}: {
  provider: string;
  row: ModelRow;
  configVersion: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useText(modelSpecDialogText);
  const c = useText(commonText);
  const manual = manualOf(row);
  const [context, setContext] = useState(manual.context);
  const [output, setOutput] = useState(manual.output);
  const [reasoning, setReasoning] = useState(manual.reasoning);
  const [imageInput, setImageInput] = useState(manual.imageInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    **打开时的版本号，保存时带它。**格子是照打开那一刻的清单填的：开着的时候别处改了配置，
    带保存那一刻的版本号，core 的冲突检查永远通过，旧的数就把别人的改动盖掉了
  */
  const [base] = useState(configVersion);

  const spec = specOf({ context, output, reasoning, imageInput });
  /** 打开时的四项。打开时的值是 core 给的，一定写得对 */
  const before = specOf(manual)!;
  const changed = spec !== undefined && !sameSpec(spec, before);
  /** 原来手写过、现在四项都不写了：保存就是删掉，回到价目表 */
  const removing = spec !== undefined && isEmptySpec(spec) && !isEmptySpec(before);

  async function save() {
    if (!spec) return;
    setSaving(true);
    setError(null);
    try {
      await api.setModelSpec({
        provider,
        model: row.id,
        ...spec,
        base_version: base,
      });
      // 用到规格的几处：这家的模型清单（弹窗、路由里指定的模型）、别名、模型目录
      invalidate(`upstream-models:${provider}`);
      invalidate("aliases");
      invalidate("known-models");
      onSaved?.();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed && !saving) void save();
      }}
    >
      <DialogHeader>
        <DialogTitle className="tw-title">{t.title}</DialogTitle>
        <DialogDescription className="truncate">
          <span className="font-mono text-foreground" title={row.id}>
            {row.id}
          </span>{" "}
          · {provider}
        </DialogDescription>
      </DialogHeader>

      <p className="tw-body text-muted-foreground">{t.desc}</p>

      <div className="grid grid-cols-2 gap-4">
        <TokensField
          id="spec-context"
          label={t.contextWindow}
          value={context}
          onChange={setContext}
          placeholder={placeholderOf(row.context_window, row.context_window_source, t)}
          bad={tokensOf(context) === undefined}
        />
        <TokensField
          id="spec-output"
          label={t.maxOutput}
          value={output}
          onChange={setOutput}
          placeholder={placeholderOf(row.max_output_tokens, row.max_output_tokens_source, t)}
          bad={tokensOf(output) === undefined}
        />
        <FlagField
          label={t.reasoning}
          value={reasoning}
          onChange={setReasoning}
          table={row.reasoning}
          source={row.reasoning_source}
        />
        <FlagField
          label={t.imageInput}
          value={imageInput}
          onChange={setImageInput}
          table={row.image_input}
          source={row.image_input_source}
        />
      </div>

      <DialogError error={error} />

      <DialogFooter className="items-center">
        {removing && <span className="mr-auto tw-label text-muted-foreground">{t.removing}</span>}
        <Button type="button" variant="outline" onClick={onClose}>
          {c.cancel}
        </Button>
        <Button type="submit" pending={saving} disabled={!changed}>
          {c.save}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * 空着的格子写什么：价目表给的数（留空就用它）。此刻是手写的，价目表给多少这里不知道，
 * 只说留空用价目表；价目表也没有的，说没有 —— 留空就是不知道。
 */
function placeholderOf(
  value: number | null | undefined,
  source: SpecSource | null | undefined,
  t: { fromTable: (n: string) => string; useTable: string; notInTable: string },
): string {
  if (source === "price_table" && value != null) return t.fromTable(value.toLocaleString());
  if (source === "manual") return t.useTable;
  return t.notInTable;
}

/**
 * 推理、图片输入：价目表 / 支持 / 不支持。下面一行写价目表怎么说，和数的占位是同一个说法；
 * 此刻是手写的，价目表怎么说这里不知道，就不写。
 */
function FlagField({
  label,
  value,
  onChange,
  table,
  source,
}: {
  label: string;
  value: SpecFlag;
  onChange: (v: SpecFlag) => void;
  /** 行里的值：来源是价目表时就是价目表说的 */
  table: boolean | null | undefined;
  source: SpecSource | null | undefined;
}) {
  const t = useText(modelSpecDialogText);
  const desc =
    source === "price_table" && table != null
      ? t.fromTable(table ? t.yes : t.no)
      : source === "manual"
        ? undefined
        : t.notInTable;
  return (
    <FormItem label={label} desc={desc}>
      <Segmented<SpecFlag>
        label={label}
        value={value}
        options={[
          { id: "table", label: t.table },
          { id: "yes", label: t.yes },
          { id: "no", label: t.no },
        ]}
        onChange={onChange}
      />
    </FormItem>
  );
}

function TokensField({
  id,
  label,
  value,
  onChange,
  placeholder,
  bad,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  bad: boolean;
}) {
  const t = useText(modelSpecDialogText);
  return (
    <FormItem label={label} htmlFor={id} desc={bad ? <span className="text-destructive">{t.bad}</span> : undefined}>
      <InputGroup>
        <InputGroupInput
          id={id}
          inputMode="numeric"
          // 占位是一句话，不用等宽字
          className={value ? "font-mono tabular-nums" : undefined}
          value={value}
          placeholder={placeholder}
          aria-invalid={bad || undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="tw-label">tokens</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </FormItem>
  );
}
