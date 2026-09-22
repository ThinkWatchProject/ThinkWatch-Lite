import { Button } from "@/ui/button";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { when } from "@/format";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import type { CostGroup, DetectedClient, ManualClient } from "@/types";
import { clientsText } from "./clients.i18n";
import { hostOf, manualStatusOf, statusOf, type Status } from "./status";
import { reasonText, StatusLabel } from "./StatusLabel";

export interface RowActions {
  details: (c: DetectedClient) => void;
  adopt: (c: DetectedClient) => void;
  restore: (c: DetectedClient) => void;
  manual: (id: string) => void;
  reveal: (c: DetectedClient) => void;
  traffic: (key: string) => void;
  openKey: (key: string) => void;
}

/**
 * 能接管的客户端，一行一个：客户端、状态、密钥、24 小时、操作。
 *
 * **排序是检测到的在前、没检测到的在后且淡显** —— 没检测到不等于用不了
 * （配置文件可能不在默认位置），所以它们也留在表里，操作换成「配置方法…」。
 *
 * 行上只放一个主按钮（接管… / 还原… / 配置方法…），其余在行菜单里。
 * 点一行打开详情；没检测到的打开手动配置。
 */
export function ClientsTable({
  clients,
  manual,
  usage,
  gatewayBase,
  actions,
}: {
  clients: DetectedClient[];
  /** 接管不了、要手动配置的那几个。**在同一张表里另起一组**，列才对得齐 */
  manual: ManualClient[];
  usage: CostGroup[];
  gatewayBase: string;
  actions: RowActions;
}) {
  const t = useText(clientsText);
  const rows = [...clients.filter((c) => c.installed), ...clients.filter((c) => !c.installed)];
  return (
    <Table>
      <Header />
      <TableBody>
        {rows.map((c) => {
          const status = statusOf(c, gatewayBase);
          const absent = status.state === "absent";
          const items = menu(c, actions, t);
          const open = () => (absent ? actions.manual(c.id) : actions.details(c));
          return (
            <RowMenu key={c.id} items={items}>
              <TableRow
                data-row={c.id}
                onClick={open}
                className={cn("cursor-default", absent && "text-muted-foreground")}
              >
                <TableCell className="w-full max-w-0 py-2">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate font-mono tw-label text-muted-foreground">{c.path}</div>
                </TableCell>
                <TableCell>
                  <StatusCell
                    status={status}
                    sub={subline(c, status, t)}
                    onWhy={status.state === "broken" ? () => actions.details(c) : undefined}
                  />
                </TableCell>
                <TableCell>
                  <KeyCell name={c.key} onOpen={actions.openKey} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <UsageCell keyName={c.key} lastSeen={c.last_seen_ms} usage={usage} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="xs" onClick={() => primary(c, status, actions)}>
                      {absent ? t.manual : c.adopted_at_ms != null ? t.restore : t.adopt}
                    </Button>
                    <RowMenuButton items={items} label={t.actionsFor(c.name)} />
                  </div>
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
        {manual.length > 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={5} className="pt-5 pb-2 whitespace-normal">
              <div className="tw-head font-semibold">{t.manualTitle}</div>
              <div className="tw-body text-muted-foreground">{t.manualIntro}</div>
            </TableCell>
          </TableRow>
        )}
        {/*
          需要手动配置的那几个。**和上面同一套列**：配过的一样看得到它的密钥和
          用量，状态只能按密钥判断 —— 这几个客户端检测不到。
        */}
        {manual.map((m) => {
          const items: MenuItems = [
            { kind: "item", label: t.manual, onSelect: () => actions.manual(m.id) },
            {
              kind: "item",
              label: t.traffic,
              onSelect: () => m.key && actions.traffic(m.key),
              disabled: !m.key,
            },
          ];
          return (
            <RowMenu key={m.id} items={items}>
              <TableRow data-row={m.id} onClick={() => actions.manual(m.id)} className="cursor-default">
                <TableCell className="w-full max-w-0 py-2">
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="truncate tw-label text-muted-foreground">{coreLine(m)}</div>
                </TableCell>
                <TableCell>
                  <StatusCell status={manualStatusOf(m)} manual />
                </TableCell>
                <TableCell>
                  <KeyCell name={m.key} onOpen={actions.openKey} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <UsageCell keyName={m.key} lastSeen={m.last_seen_ms} usage={usage} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="xs" onClick={() => actions.manual(m.id)}>
                      {t.manual}
                    </Button>
                    <RowMenuButton items={items} label={t.actionsFor(m.name)} />
                  </div>
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Header() {
  const t = useText(clientsText);
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{t.client}</TableHead>
        <TableHead>{t.status}</TableHead>
        <TableHead>{t.key}</TableHead>
        <TableHead className="text-right">{t.last24h}</TableHead>
        <TableHead className="w-36" />
      </TableRow>
    </TableHeader>
  );
}

function StatusCell({
  status,
  sub,
  manual,
  onWhy,
}: {
  status: Status;
  sub?: string | null;
  manual?: boolean;
  onWhy?: () => void;
}) {
  const t = useText(clientsText);
  return (
    <>
      <StatusLabel status={status} manual={manual} />
      {(sub || onWhy) && (
        // 原因可能很长（英文的「地址已改为 …」），限宽折行，不把整张表撑出横向滚动
        <div className="max-w-52 whitespace-normal tw-label text-muted-foreground">
          {sub}
          {sub && onWhy && " · "}
          {onWhy && (
            <button
              type="button"
              className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onWhy();
              }}
            >
              {t.seeWhy}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** 密钥名，点了去密钥页定位到那一行。还没有就是一道横线 */
function KeyCell({ name, onOpen }: { name?: string | null; onOpen: (key: string) => void }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(name);
      }}
    >
      {name}
    </button>
  );
}

/** 24 小时的请求数，下面是最近一次。**按那把密钥算** */
function UsageCell({
  keyName,
  lastSeen,
  usage,
}: {
  keyName?: string | null;
  lastSeen?: number | null;
  usage: CostGroup[];
}) {
  const t = useText(clientsText);
  const n = keyName ? (usage.find((u) => u.name === keyName)?.requests ?? 0) : 0;
  if (!keyName) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <div className={n > 0 ? undefined : "text-muted-foreground"}>{n > 0 ? t.requests(n) : "—"}</div>
      <div className="tw-label text-muted-foreground">{lastSeen ? when(lastSeen) : t.neverUsed}</div>
    </>
  );
}

/** 状态下面那一行 */
function subline(c: DetectedClient, s: Status, t: typeof clientsText.zh): string | null {
  const why = reasonText(s.reason, t);
  if (why) return why;
  if (s.state === "idle") return c.endpoint ? t.pointsTo(hostOf(c.endpoint)) : t.ownService;
  return null;
}

/** 主按钮：没检测到的看配置方法，接管过的还原，其余接管 */
function primary(c: DetectedClient, s: Status, a: RowActions) {
  if (s.state === "absent") return a.manual(c.id);
  if (c.adopted_at_ms != null) return a.restore(c);
  a.adopt(c);
}

function menu(c: DetectedClient, a: RowActions, t: typeof clientsText.zh): MenuItems {
  const installed = c.installed;
  return [
    { kind: "item", label: t.details, onSelect: () => a.details(c), disabled: !installed },
    { kind: "item", label: t.manual, onSelect: () => a.manual(c.id) },
    { kind: "sep" },
    {
      kind: "item",
      label: t.reveal,
      onSelect: () => a.reveal(c),
      disabled: !c.has_config,
    },
    {
      kind: "item",
      label: t.traffic,
      onSelect: () => c.key && a.traffic(c.key),
      disabled: !c.key,
    },
  ];
}

/** 手动配置的客户端，名字下面那一行说它配完还漏什么 */
function coreLine(m: ManualClient): string {
  return coreText(m.caveat);
}
