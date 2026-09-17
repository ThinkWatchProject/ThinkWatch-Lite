import { useState } from "react";
import { Tip } from "@/ui/tip";
import type { Overview } from "./types";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { toast } from "sonner";
import { patchConfig } from "./patch";
import { redactLabel } from "./upstreams/labels";
import {
  Item,
  ItemActions,
  ItemDescription,
  ItemHeader,
  ItemTitle,
} from "@/ui/item";
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

/** 一条防线的全部描述。动词和代价都从这里来，不散在 JSX 里。 */
const LINES: {
  key: "redact" | "inspect_tools" | "scan_configs";
  path: string;
  title: string;
  what: string;
  /** 「拦截」在这一条上具体做什么 —— 三条各不相同 */
  verb: string;
  /** 切到拦截之后，会有什么变化。写在用户点之前 */
  cost: string;
}[] = [
  {
    key: "redact",
    path: "/security/redact",
    title: "出站脱敏",
    what: "请求发送前，检查其中是否含有密钥、私钥或连接串。",
    verb: "将检出的内容替换为占位符后发送，并在响应中还原为原值",
    cost: "请求体将被改写，相同上下文可能无法命中上游缓存。",
  },
  {
    key: "inspect_tools",
    path: "/security/inspect_tools",
    title: "工具调用审查",
    what: "检查上游返回的工具调用中是否含有可直接获得执行权限的命令。",
    verb: "切断响应流，客户端收到的工具调用不完整，无法构成有效参数",
    cost: "仅对不受信任的上游生效。发生误判时，回答将在中途中断。",
  },
  {
    key: "scan_configs",
    path: "/security/scan_configs",
    title: "配置面扫描",
    what: "检查客户端配置文件中是否含有隐藏字符、注入内容、危险命令或过宽权限。",
    verb: "在界面中发出告警",
    cost: "扫描不会删除任何内容，「拦截」仅在界面中发出告警。",
  },
];

const MODES: { id: Mode; label: string }[] = [
  { id: "off", label: "关闭" },
  { id: "observe", label: "观察" },
  { id: "enforce", label: "拦截" },
];

export default function Guard({
  ov,
  configVersion,
  onChanged,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const sec = ov.security;

  async function set(path: string, mode: Mode) {
    if (!configVersion) {
      toast.error("配置版本尚未读取，请稍后重试");
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
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-5">
      <div>
        <p className="tw-body text-muted-foreground">
          三项防护各有三档，默认均为「观察」。
          {/*
            「我现在到底有没有被保护」是用户在这一页的第一个判断，而
            「观察」这个词本身回答不了它 —— 所以展开说一句。
          */}
          <Tip text="「观察」照常检测并记录，但不改变任何请求。可根据记录结果决定是否切换到「拦截」。">
            <span className="ml-1 underline decoration-dotted underline-offset-2">「观察」的含义</span>
          </Tip>
        </p>
      </div>

      {!sec && (
        <p className="tw-body text-amber-700 dark:text-amber-300">
          core 版本较旧，未提供防护状态。升级后可使用此页面。
        </p>
      )}

      {sec &&
        LINES.map((l) => {
          const cur = (sec[l.key] as Mode) ?? "observe";
          return (
            /*
              **一行 = 标题 + 说明 + 右侧操作**，这正是 `Item` 的形状。
              原来是 `section` 里手拼 `flex items-baseline ml-auto`，而
              「操作靠右、标题截断、说明换行」这几件事每次都得重写一遍。
            */
            <Item key={l.key} variant="outline" className="flex-col items-stretch">
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
                  {MODES.map((m) => (
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
                  <span className="text-muted-foreground">当前：不检测，不记录。</span>
                )}
                {cur === "observe" && (
                  <span className="text-muted-foreground">
                    当前：检测并记录，<span className="font-medium">不改变任何请求</span>。检测结果显示在「安全 › 发现」中。
                  </span>
                )}
                {cur === "enforce" && (
                  <span className="text-foreground">
                    当前：{l.verb}。
                  </span>
                )}
              </p>

              {/* 代价写在切之前，不是切完之后 */}
              {cur !== "enforce" && (
                <p className="mt-1 tw-label text-neutral-400">
                  切换到「拦截」后：{l.cost}
                </p>
              )}
            </Item>
          );
        })}

      {sec && (
        <Item variant="outline" className="flex-col items-stretch">
          <ItemHeader>
            <ItemTitle>扫描规则</ItemTitle>
          </ItemHeader>
          <p className="mt-1.5 tw-body text-muted-foreground">
            扫描规则由内置规则与自定义规则组成。
            {/*
              语义是「加法加停用」而不是「整份替换」（core 那边改过一次）。
              这里要说清，否则用户以为自己那份是全集，而我们后来加的新
              攻击模式他一条都收不到。
            */}
            自定义规则<span className="font-medium">追加</span>在内置规则之后，不替换内置规则，新版本增加的内置规则同样生效。
          </p>
          <p className="mt-2 tw-body text-muted-foreground">
            已添加 {sec.scan_rules_added} 条自定义规则，停用 {sec.scan_rules_disabled} 条内置规则。增删规则需编辑
            config.yaml。
          </p>
        </Item>
      )}

      {sec && (
        <Item variant="outline" className="flex-col items-stretch">
          <ItemHeader>
            <ItemTitle>按上游配置脱敏范围</ItemTitle>
          </ItemHeader>
          <ItemDescription>
            「出站脱敏」决定是否脱敏，此处列出
            <span className="font-medium">各上游的脱敏类别</span>。官方端点默认不脱敏。
            <Tip text="在「上游」中编辑该上游，于「安全」一节设置发送前脱敏。">
              <span className="ml-1 underline decoration-dotted underline-offset-2">修改方式</span>
            </Tip>
          </ItemDescription>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>上游</TableHead>
                <TableHead>信任</TableHead>
                <TableHead>脱敏类别</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ov.providers.map((p) => (
                <TableRow
                  key={p.name}
                >
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* core 给的是 slug（`official` / `untrusted`），不能原样显示 */}
                    {p.trust === "official" ? "官方端点" : "非官方端点"}
                    {!p.trust_explicit && (
                      <span className="ml-1 text-neutral-400">（自动识别）</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.redact && p.redact.length > 0 ? (
                      p.redact.map(redactLabel).join(" · ")
                    ) : (
                      <span className="text-neutral-400">
                        {p.redact_explicit ? "已设置为不脱敏" : "不脱敏（官方端点）"}
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
