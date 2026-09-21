import { useState } from "react";
import { Tip } from "@/ui/tip";
import type { Overview } from "@/types";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { toast } from "sonner";
import { patchConfig } from "@/patch";
import { redactLabel } from "@/upstreams/labels";
import { useText } from "@/i18n";
import { guardText } from "./Defences.i18n";
import {
  Item,
  ItemActions,
  ItemDescription,
  ItemHeader,
  ItemTitle,
} from "@/ui/item";
import { errorText } from "@/i18n/core.i18n";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

/**
 * 防护 —— 三条防线的策略。
 *
 * 在这一页之前，这三个开关**只能改 config.yaml**。而整个设计
 * 是：出厂全部停在「观察」，不打扰任何人，同时攒下属于用户自己的证据；
 * 他看到「过去 7 天有 3 个请求把密钥发给了 relay」之后，自己决定要
 * 不要切到「拦截」。**证据在界面上，开关在 YAML 里，那条路就断了。**
 *
 * 三件事要在这一页说清楚：
 *
 * **一、「拦截」在每条防线上做的事不一样。**脱敏是替换成占位符、审查是
 * 切断响应流、扫描只是告警（它本来就不删东西）。统一标成「拦截」的话，
 * 用户点下去并不知道会发生什么 —— 所以每一档旁边写的是它自己的动词。
 *
 * **二、观察态不是「没开」。**它照常检测、照常记录，只是不改变任何请求。
 * 界面上要让这件事看得见，否则用户会以为自己什么防护都没有。
 *
 * **三、切到拦截是有代价的，要说在前面。**脱敏会改请求体（说过那
 * 可能影响缓存）、审查会切断流。不说的话，第一次误报发生时用户不知道
 * 是谁干的，然后把整个功能关掉 —— 连真有用的那部分一起关掉。
 */

type Mode = "off" | "observe" | "enforce";

type GuardText = typeof guardText.zh;

/** 一条防线的全部描述。动词和代价都从这里来，不散在 JSX 里。 */
const lines = (
  t: GuardText,
): {
  key: "redact" | "inspect_tools" | "scan_configs";
  path: string;
  title: string;
  what: string;
  /** 「拦截」在这一条上具体做什么 —— 三条各不相同 */
  verb: string;
  /** 切到拦截之后，会有什么变化。写在用户点之前 */
  cost: string;
  /** 它查到的东西留在哪一页 —— 三条各不相同 */
  where: string;
}[] => [
  {
    key: "redact",
    path: "/security/redact",
    ...t.redact,
  },
  {
    key: "inspect_tools",
    path: "/security/inspect_tools",
    ...t.inspectTools,
  },
  {
    key: "scan_configs",
    path: "/security/scan_configs",
    ...t.scanConfigs,
  },
];

const modes = (t: GuardText): { id: Mode; label: string }[] => [
  { id: "off", label: t.off },
  { id: "observe", label: t.observe },
  { id: "enforce", label: t.enforce },
];

export function Defences({
  ov,
  configVersion,
  onChanged,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
}) {
  const t = useText(guardText);
  const [busy, setBusy] = useState<string | null>(null);
  const sec = ov.security;

  async function set(path: string, mode: Mode) {
    if (!configVersion) {
      toast.error(t.noVersion);
      return;
    }
    setBusy(path);
    try {
      // 走和别的改动同一扇门：带版本号、span 补丁、三道校验。
      // **写进去的是 slug 不是中文标签** —— 写「观察」的话下一次加载
      // 会因为不是合法取值整份被拒，而这一层刻意不做静默回落。
      await patchConfig([{ op: "replace", path, value: mode }], configVersion);
      onChanged();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="tw-body text-muted-foreground">
          {t.intro}
          {/*
            「我现在到底有没有被保护」是用户在这一页的第一个判断，而
            「观察」这个词本身回答不了它 —— 所以展开说一句。
          */}
          <Tip text={t.observeTip}>
            <span className="ml-1 underline decoration-dotted underline-offset-2">
              {t.observeMeaning}
            </span>
          </Tip>
        </p>
      </div>

      {!sec && (
        <p className="tw-body text-amber-700 dark:text-amber-300">
          {t.oldCore}
        </p>
      )}

      {sec &&
        lines(t).map((l) => {
          const cur = (sec[l.key] as Mode) ?? "observe";
          return (
            /*
              **一行 = 标题 + 说明 + 右侧操作**，这正是 `Item` 的形状。
              原来是 `section` 里手拼 `flex items-baseline ml-auto`，而
              「操作靠右、标题截断、说明换行」这几件事每次都得重写一遍。
            */
            <Item
              key={l.key}
              variant="outline"
              className="flex-col items-stretch"
            >
              <ItemHeader>
                <ItemTitle>{l.title}</ItemTitle>
                <ItemActions>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    value={cur}
                    disabled={busy === l.path}
                    onValueChange={(v) => v && void set(l.path, v as Mode)}
                  >
                    {modes(t).map((m) => (
                      <ToggleGroupItem key={m.id} value={m.id}>
                        {m.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </ItemActions>
              </ItemHeader>

              <ItemDescription>{l.what}</ItemDescription>

              {/*
                当前这一档到底在做什么 —— 一句话，随档变化。
                「观察」最需要这句：它看起来像「没开」，而它其实一直在记。
              */}
              <p className="mt-1.5 tw-body">
                {cur === "off" && (
                  <span className="text-muted-foreground">{t.nowOff}</span>
                )}
                {cur === "observe" && (
                  <span className="text-muted-foreground">
                    {t.nowObserve((s) => (
                      <span className="font-medium">{s}</span>
                    ))}
                  </span>
                )}
                {cur === "enforce" && (
                  <span className="text-foreground">
                    {t.nowEnforce(l.verb)}
                  </span>
                )}
              </p>

              {/* 代价写在切之前，不是切完之后 */}
              {cur !== "enforce" && (
                <p className="mt-1 tw-label text-neutral-400">
                  {t.ifEnforced(l.cost)}
                </p>
              )}

              {/*
                **三条防线的证据不在同一个地方。**脱敏和工具审查留在
                单个请求上（流量页），扫描留在旁边的「发现」里。开着一道
                防线却不知道去哪儿看它查到了什么，等于没开。
              */}
              {cur !== "off" && (
                <p className="mt-1 tw-label text-muted-foreground">{l.where}</p>
              )}
            </Item>
          );
        })}

      {sec && (
        <Item variant="outline" className="flex-col items-stretch">
          <ItemHeader>
            <ItemTitle>{t.rules}</ItemTitle>
          </ItemHeader>
          <p className="mt-1.5 tw-body text-muted-foreground">
            {t.rulesMadeOf}
            {/*
              语义是「加法加停用」而不是「整份替换」（core 那边改过一次）。
              这里要说清，否则用户以为自己那份是全集，而我们后来加的新
              攻击模式他一条都收不到。
            */}
            {t.rulesAppended((s) => (
              <span className="font-medium">{s}</span>
            ))}
          </p>
          <p className="mt-2 tw-body text-muted-foreground">
            {t.rulesCount(sec.scan_rules_added, sec.scan_rules_disabled)}
          </p>
        </Item>
      )}

      {sec && (
        <Item variant="outline" className="flex-col items-stretch">
          <ItemHeader>
            <ItemTitle>{t.scope}</ItemTitle>
          </ItemHeader>
          <ItemDescription>
            {t.scopeNote((s) => (
              <span className="font-medium">{s}</span>
            ))}
            <Tip text={t.howToChangeTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">
                {t.howToChange}
              </span>
            </Tip>
          </ItemDescription>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>{t.upstream}</TableHead>
                <TableHead>{t.trust}</TableHead>
                <TableHead>{t.categories}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ov.providers.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* core 给的是 slug（`official` / `untrusted`），不能原样显示 */}
                    {p.trust === "official" ? t.official : t.unofficial}
                    {!p.trust_explicit && (
                      <span className="ml-1 text-neutral-400">
                        {t.autoDetected}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.redact && p.redact.length > 0 ? (
                      p.redact.map(redactLabel).join(" · ")
                    ) : (
                      <span className="text-neutral-400">
                        {p.redact_explicit ? t.noRedactSet : t.noRedactOfficial}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Item>
      )}
    </div>
  );
}
