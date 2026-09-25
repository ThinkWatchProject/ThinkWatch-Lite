import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { appLabel } from "@/labels";
import { keyText } from "@/KeyLabel";
import type { RequestRow } from "@/types";
import { IconRemote } from "@/ui/icons";
import { ClientLogo } from "@/ui/logos";
import { notify } from "@/ui/notify";
import { Tip } from "@/ui/tip";
import { trafficText } from "./Traffic.i18n";

/**
 * 请求行和组头共用的几样：行的底色、压暗的格子、密钥那一格、悬停里的几行字、复制。
 */

/**
 * 行的几种底色。**用前景色压一层，不用 `bg-muted`**：窗口底色本身就是一档浅灰，
 * muted 和它只差不到 1%，选中的那一行在浅色下几乎看不出来。和源列表的选中、悬停
 * 是同一个做法。`group/row`：行尾的「…」按它决定露不露出来。
 */
export const ROW =
  "group/row cursor-pointer border-b border-border/60 transition-colors duration-(--motion-fast) hover:bg-foreground/[0.035] data-[state=selected]:bg-foreground/[0.07] data-[state=selected]:hover:bg-foreground/[0.07]";

/** 和上一行相同的格子淡一档 —— 眼睛要找的是变化的那一行 */
export const DIM = "text-muted-foreground/60";

/** 行尾「…」外面那一层：悬停、选中、菜单开着、键盘聚焦时才露出来 */
export const MENU_REVEAL =
  "inline-flex opacity-0 transition-opacity duration-(--motion-fast) group-hover/row:opacity-100 group-data-[state=selected]/row:opacity-100 has-[[data-state=open]]:opacity-100 has-focus-visible:opacity-100";

/** 复制一段文字，成了说一声：复制这件事在界面上看不出来。`done` 是成了之后那一句 */
export async function copyText(text: string, done?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify.success(done ?? textOf(commonText).copied);
  } catch (e) {
    notify.error(e);
  }
}

/**
 * 密钥那一格：推测出的应用的标志，加密钥的名字。
 *
 * **打码的密钥值进悬停。**`tw-9Wm…b1Qs（claude-code）` 这样写满一格有两百多像素，
 * 默认窗口下整张表被撑宽，被挤出视野的是最后一列费用。名字够认出是哪一把；打码
 * 的值、推测的应用、来源一项一行写在悬停里，请求详情里也都有。
 *
 * `hints`：表里有哪一行带着推测出的应用。有的话没有应用的行也留出标志的位置，
 * 名字才对得齐。
 */
export function KeyCell({
  client,
  masked,
  hint,
  peer,
  hints,
}: {
  client: string;
  masked?: string;
  hint?: string;
  peer?: string;
  hints: boolean;
}) {
  const t = useText(trafficText);
  const tip = [
    t.keyTip(keyText(client, masked)),
    ...(hint ? [t.appTip(appLabel(hint))] : []),
    ...(peer ? [t.fromPeer(peer)] : []),
  ];
  return (
    <Tip text={<Lines lines={tip} />}>
      <span className="flex max-w-40 items-center gap-1.5">
        {hints &&
          (hint ? (
            <ClientLogo id={hint} name={appLabel(hint)} className="opacity-70" />
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          ))}
        <span className="min-w-0 truncate">{client}</span>
        {/*
          非本机来的，名字后面挂一个记号：这台网关对局域网开着，这一条不是本机发的。
          **地址进悬停**，不写在格子里 —— 一串 IP 有一百像素，整列跟着它变宽，
          被挤出视野的是最后一列费用。
        */}
        {peer && (
          <>
            <IconRemote aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="sr-only">{t.fromPeer(peer)}</span>
          </>
        )}
      </span>
    </Tip>
  );
}

/** 一条请求的密钥那一格 */
export function RowKeyCell({ r, hints }: { r: RequestRow; hints: boolean }) {
  return <KeyCell client={r.client} masked={r.keyMasked} hint={r.hint} peer={r.peer} hints={hints} />;
}

/** 悬停里的几句话，一句一行。气泡本身是横排的 flex，要包成一块 */
export function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-0.5">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
