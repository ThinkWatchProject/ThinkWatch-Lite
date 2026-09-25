import { useState } from "react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { notify } from "@/ui/notify";
import { Table, TableBody, TableCell, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import type { ClientView, ManualSetup, Msg } from "@/types";
import { ClientMark, CopyButton, Tile, focusSelf, useDialogFocus } from "@/keys/parts";
import { api } from "./api";
import { clientsText } from "./clients.i18n";

/** 手动配置的是谁：接管不了的（Cursor…），或者没检测到的（配置文件不在默认位置） */
export interface ManualTarget {
  id: string;
  name: string;
  setup: ManualSetup;
  /** 配完还漏什么。只有接管不了的那几个有 */
  caveat?: Msg | null;
  /** 为它生成的那把密钥 */
  key?: string | null;
  /** 在哪个 WSL 发行版里；这台电脑上的不给。WSL 里的那一份有它自己的一把密钥 */
  env?: string;
}

/** 选单里「新建一把」那一项的值。**密钥名首尾不能有空白**，所以没有哪把密钥叫这个 */
const NEW = " new";

/**
 * 手动配置一个客户端：几步说明、要写的字段，以及网关地址和密钥各一个复制按钮。
 *
 * **密钥默认是为它新建的那把专用密钥** —— 手动配进去的客户端也要分得清流量是
 * 谁的。点「创建并复制」那一刻才真的建（打开这个对话框不该有副作用）；已经有
 * 为它留着的，就直接是那一把。想用别的密钥（比如默认那把），在选单里换。
 */
export function ManualDialog({
  target,
  keys,
  onClose,
  onKeyReady,
}: {
  target: ManualTarget;
  keys: ClientView[];
  onClose: () => void;
  /** 新建了密钥：列表要跟着重读 */
  onKeyReady: () => void;
}) {
  const t = useText(clientsText);
  const dialogFocus = useDialogFocus();
  /** 为它留着的那把。刚建好的在列表重读回来之前也要能选到 */
  const [own, setOwn] = useState(target.key ?? null);
  const [choice, setChoice] = useState(target.key ?? NEW);

  /** 复制密钥；选的是「新建」就先建，建好的那一把从此是选中的 */
  async function copyKey() {
    try {
      let name = choice;
      if (choice === NEW) {
        name = await api.prepareKey(target.id, target.env);
        setOwn(name);
        setChoice(name);
        onKeyReady();
      }
      await api.copyKey(name);
    } catch (e) {
      notify.error(e);
      throw e;
    }
  }

  const { steps, fields, endpoint } = target.setup;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
        {...dialogFocus}
        // 点一行就打开：焦点落在对话框本身，不落到第一个按钮上 —— WebKit 里
        // 脚本给的焦点会在按钮上画一圈框，而用户根本没按过 Tab
        onOpenAutoFocus={focusSelf}
      >
        <DialogHeader className="flex-row items-center gap-3">
          <Tile className="size-9 rounded-lg [&_svg]:size-[18px]">
            <ClientMark id={target.id} name={target.name} size={18} />
          </Tile>
          <DialogTitle>{t.manualDialogTitle(target.name)}</DialogTitle>
        </DialogHeader>

        {/* 步骤带编号圆点：几步、做到哪一步，一眼数得出来 */}
        <ol className="flex flex-col gap-2.5 tw-body">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface tw-label tw-num text-muted-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 pt-px">{coreText(s)}</span>
            </li>
          ))}
        </ol>

        {fields.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.path} className="hover:bg-transparent">
                    <TableCell className="font-mono tw-label">{f.path}</TableCell>
                    <TableCell className="whitespace-normal break-all">
                      {f.secret ? (
                        <span className="text-muted-foreground">{t.keyGoesBelow}</span>
                      ) : (
                        <span className="font-mono tw-label select-text">{f.value}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border bg-surface/60">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="tw-label text-muted-foreground">{t.endpointLabel}</p>
              <p className="truncate font-mono tw-body select-text">{endpoint}</p>
            </div>
            <CopyButton
              onCopy={() =>
                api.copyEndpoint(target.id, target.env).catch((e: unknown) => {
                  notify.error(e);
                  throw e;
                })
              }
            />
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="tw-label text-muted-foreground" htmlFor="manual-key">
                {t.keyLabel}
              </label>
              <NativeSelect
                id="manual-key"
                size="sm"
                className="w-72 max-w-full"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                {own == null && <NativeSelectOption value={NEW}>{t.newKeyFor(target.name)}</NativeSelectOption>}
                {own != null && !keys.some((k) => k.name === own) && (
                  <NativeSelectOption value={own}>{own}</NativeSelectOption>
                )}
                {keys.map((k) => (
                  <NativeSelectOption key={k.name} value={k.name}>
                    {k.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <CopyButton label={choice === NEW ? t.createAndCopy : undefined} onCopy={copyKey} />
          </div>
        </div>

        {target.caveat && (
          <Banner layout="inline" tone="warning">
            {coreText(target.caveat)}
          </Banner>
        )}

        <DialogFooter>
          <Button onClick={onClose}>{t.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
