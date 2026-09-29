import { useState } from "react";
import { Button } from "@/ui/button";
import { Banner } from "@/ui/banner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { SecretInput } from "@/ui/secret-input";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { ImportProposal, Overview } from "@/types";
import { api } from "@/upstreams/api";
import { protocolLabel } from "@/upstreams/labels";
import { DialogError, FormItem } from "@/upstreams/parts";
import { nameFromUrl } from "@/upstreams/presets";
import {
  blankForm,
  connectionMissing,
  freeName,
  toInput,
  type UpstreamForm,
} from "@/upstreams/upstreamForm";
import { importDialogText } from "./ImportDialog.i18n";

/**
 * 导入链接（`thinkwatch://import?…`）提议的新上游，给人确认。
 *
 * **链接来自任何一个网页**，内容在 Rust 侧逐项校验过（`import_link.rs`），这里仍然：
 *
 * - 每一项都当纯文本画：不注入 HTML、不解析 Markdown、地址不做成链接；
 * - 醒目地写出请求和密钥会发往哪台主机（ASCII，IDN 已转成 punycode，防形近字）；
 * - 点「创建」之前不写配置、不连接这个地址（不检测、不取模型列表）；
 * - 只新建：名称和已有的重复时要改一个名字，没有「覆盖」。不设默认、不进路由。
 *
 * 能改的只有名称。密钥照「不打码」的规矩原样放在 `SecretInput` 里，默认隐藏。
 */
export function ImportDialog({
  proposal,
  ov,
  onClose,
  onCreated,
}: {
  proposal: ImportProposal;
  ov: Overview;
  onClose: () => void;
  /** 创建成功：外面重读概览、落到上游页 */
  onCreated: (name: string) => void;
}) {
  const t = useText(importDialogText);
  const c = useText(commonText);
  const taken = ov.providers.map((p) => p.name);
  // 链接给了名称就用它（重名要改）；没给按地址起一个不重名的，和新建对话框一样
  const [name, setName] = useState(
    () => proposal.name ?? freeName(nameFromUrl(proposal.base_url) || proposal.host, taken),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form: UpstreamForm = {
    ...blankForm(),
    name,
    baseUrl: proposal.base_url,
    protocol: proposal.protocol ?? "",
    key: proposal.key ?? "",
    manualModels: proposal.models,
  };
  const blocking = connectionMissing(form, null, taken);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await api.createProvider({ provider: toInput(form), base_version: ov.config_version });
      onCreated(form.name);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[min(88vh,640px)] flex-col gap-4 sm:max-w-[560px]"
        // 点到外面不关：误点一下不该丢掉这次导入
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="tw-title">{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-1">
          <Banner layout="inline" tone="warning" title={t.sendsTo}>
            <span data-testid="import-host" className="font-mono font-semibold break-all select-text">
              {proposal.host}
            </span>
            <span className="block">{t.trust}</span>
          </Banner>

          <FormItem label={t.name} htmlFor="import-name">
            <Input
              id="import-name"
              value={name}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
          </FormItem>

          <FormItem label={t.baseUrl}>
            <p data-testid="import-url" className="font-mono tw-body break-all select-text">
              {proposal.base_url}
            </p>
          </FormItem>

          <FormItem label={t.protocol}>
            <p className="tw-body">{proposal.protocol ? protocolLabel(proposal.protocol) : t.auto}</p>
          </FormItem>

          <FormItem label={t.key}>
            {proposal.key ? (
              <SecretInput value={proposal.key} readOnly aria-label={t.key} />
            ) : (
              <p className="tw-body text-muted-foreground">{t.noKey}</p>
            )}
          </FormItem>

          {proposal.models.length > 0 && (
            <FormItem label={t.models}>
              <p data-testid="import-models" className="font-mono tw-body break-all select-text">
                {proposal.models.join(", ")}
              </p>
            </FormItem>
          )}
        </div>

        <DialogError error={error} />

        <DialogFooter className="items-center">
          {blocking && <span className="mr-auto tw-label text-muted-foreground">{blocking}</span>}
          <Button variant="outline" onClick={onClose}>
            {c.cancel}
          </Button>
          <Button onClick={create} pending={saving} disabled={blocking != null}>
            {t.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
