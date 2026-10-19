import { useState } from "react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { notify } from "@/ui/notify";
import { noMore, useIgnored } from "@/ignore";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { settingsApi } from "@/settings/api";
import type { SyncView } from "@/types";
import { ConflictDialog } from "./ConflictDialog";
import { StopDialog, UnlockDialog } from "./Dialogs";
import { syncApi } from "./api";
import { syncNoticeText } from "./SyncPart.i18n";
import { syncOn, useSyncView } from "./useSync";

/**
 * core 的同步原因是可以接在句子里的半句（英文小写开头、没有句号）。单独成行时写成一整句：
 * 首字母大写、补上句号。中文译文本来就是整句，不动
 */
export function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const head = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?。！？]$/.test(head) ? head : `${head}.`;
}

/** 冲突提示的忽略记号：设置里和上游页顶上是同一条，忽略一处两处都不再出现，直到冲突变多 */
const CONFLICT_KEY = "sync:conflicts";
/** 别的几种状态（连不上、拒绝访问、口令改了、版本过新）共用一个，印记是这一次出事的样子 */
const STATE_KEY = "sync:state";

/** 这一次出事的样子：状态、从什么时候起失败、上一次同步到哪儿。好了又坏，印记就换了 */
export function stateMark(v: SyncView): string {
  return `${v.state}:${v.failing_since_ms ?? ""}:${v.last_synced_ms ?? ""}`;
}

/**
 * 同步要人处理的几件事，黄色提示（方案 6.10），**都可以忽略**。`only="conflicts"`：上游页
 * 顶上只说冲突，别的几件在设置里说。`withoutConflicts`：设置里的状态行已经写着冲突数、
 * 带着「处理冲突…」，那里不再重复一条冲突提示。
 *
 * 正常运转（已同步、同步中）什么都不说。安全模式下暂停是灰色的告知，不用处理，也不给忽略。
 */
export function SyncNotices({
  view,
  only,
  withoutConflicts = false,
  onChanged,
}: {
  view: SyncView;
  only?: "conflicts";
  withoutConflicts?: boolean;
  /** 处理了冲突、输了口令：外面换上新的状态 */
  onChanged: (v: SyncView) => void;
}) {
  const t = useText(syncNoticeText);
  const [dialog, setDialog] = useState<"conflicts" | "unlock" | "stop" | null>(null);
  const [republishing, setRepublishing] = useState(false);
  const conflicts = useIgnored(CONFLICT_KEY, view.conflicts, noMore);
  const state = useIgnored(STATE_KEY, stateMark(view), (a, b) => a === b);
  const all = only !== "conflicts";
  const why = view.error ? sentence(errorText(view.error)) : "";

  /** 同步位置空了、同步密钥不可用：重新上传本机配置，换上 core 交回的状态 */
  async function republish() {
    setRepublishing(true);
    try {
      onChanged(await syncApi.republish());
    } catch (e) {
      notify.error(e);
    } finally {
      setRepublishing(false);
    }
  }
  /** 那两种状态的两个操作：重新上传本机配置、停止同步 */
  const recover = (
    <>
      <Button size="sm" variant="outline" pending={republishing} onClick={() => void republish()}>
        {t.republish}
      </Button>
      <Button size="sm" variant="outline" disabled={republishing} onClick={() => setDialog("stop")}>
        {t.stop}
      </Button>
    </>
  );

  async function checkUpdate() {
    try {
      await settingsApi.checkUpdate();
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <>
      <Banner
        layout="inline"
        tone="warning"
        show={!withoutConflicts && view.conflicts > 0 && !conflicts.ignored}
        title={t.conflictTitle(view.conflicts)}
        onIgnore={conflicts.ignore}
        actions={
          <Button size="sm" variant="outline" onClick={() => setDialog("conflicts")}>
            {t.resolve}
          </Button>
        }
      >
        {t.conflictBody}
      </Banner>
      {all && (
        <>
          <Banner
            layout="inline"
            tone="warning"
            show={view.state === "unreachable" && !state.ignored}
            title={t.unreachableTitle}
            onIgnore={state.ignore}
          >
            {/* 原因（core 的那一句）单独一行，再说接下来会怎样 */}
            {why && <span className="block">{why}</span>}
            {t.unreachableBody}
          </Banner>
          <Banner
            layout="inline"
            tone="warning"
            show={view.state === "auth_failed" && !state.ignored}
            title={t.authTitle}
            onIgnore={state.ignore}
          >
            {why && <span className="block">{why}</span>}
            {t.authBody}
          </Banner>
          <Banner
            layout="inline"
            tone="warning"
            show={view.state === "locked" && !state.ignored}
            title={t.lockedTitle}
            onIgnore={state.ignore}
            actions={
              <Button size="sm" variant="outline" onClick={() => setDialog("unlock")}>
                {t.unlock}
              </Button>
            }
          >
            {t.lockedBody}
          </Banner>
          <Banner
            layout="inline"
            tone="warning"
            show={view.state === "too_new" && !state.ignored}
            title={t.tooNewTitle}
            onIgnore={state.ignore}
            actions={
              <Button size="sm" variant="outline" onClick={() => void checkUpdate()}>
                {t.update}
              </Button>
            }
          >
            {t.tooNewBody}
          </Banner>
          <Banner
            layout="inline"
            tone="warning"
            show={view.state === "keyring_missing" && !state.ignored}
            title={t.keyringTitle}
            onIgnore={state.ignore}
            actions={recover}
          >
            {t.keyringBody}
          </Banner>
          <Banner
            layout="inline"
            tone="warning"
            show={view.state === "emptied" && !state.ignored}
            title={t.emptiedTitle}
            onIgnore={state.ignore}
            actions={recover}
          >
            {t.emptiedBody}
          </Banner>
          <Banner
            layout="inline"
            tone="warning"
            show={view.state === "misconfigured" && !state.ignored}
            title={t.misconfiguredTitle}
            onIgnore={state.ignore}
          >
            {why && <span className="block">{why}</span>}
            {t.misconfiguredBody}
          </Banner>
          <Banner layout="inline" tone="info" show={view.state === "paused"} title={t.pausedTitle}>
            {t.pausedBody}
          </Banner>
        </>
      )}
      {dialog === "conflicts" && <ConflictDialog onClose={() => setDialog(null)} onResolved={onChanged} />}
      {dialog === "unlock" && <UnlockDialog onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === "stop" && (
        <StopDialog onClose={() => setDialog(null)} onDone={() => void syncApi.status().then(onChanged, () => {})} />
      )}
    </>
  );
}

/**
 * 上游页顶上那一条：同步有冲突时说一声，点开处理。没开同步、读不到同步状态（旧版 core）
 * 时什么都不画
 */
export function SyncConflictBanner() {
  const r = useSyncView();
  const v = r.data;
  if (!syncOn(v)) return null;
  return <SyncNotices view={v} only="conflicts" onChanged={(next) => r.mutate(next)} />;
}
