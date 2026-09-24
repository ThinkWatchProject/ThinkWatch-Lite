import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BanIcon } from "lucide-react";
import { IconRoute } from "@/ui/icons";
import { prefersReducedMotion } from "@/ui/motion";
import { StatusDot } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { groupKindLabel, targetLabel } from "@/labels";
import type { Overview } from "@/types";
import {
  buildChain,
  focusId,
  layoutChain,
  litBy,
  membersOf,
  NODE_H,
  orderedRoutes,
  type ChainFocus,
  type ChainNode,
  type PlacedEdge,
} from "./chain";
import { chainMapText } from "./ChainMap.i18n";
import { activityOf, type Flight } from "./flights";
import { usersOf } from "./model";
import { KeyIcon, TargetIcon, upstreamState } from "./parts";
import { partsText } from "./parts.i18n";
import { routingText } from "./routing.i18n";

/**
 * 悬停的那一处。**离开时等一小会儿再清**：鼠标从一个节点移到相邻的节点、从表格的
 * 一行移到下一行，中间那一瞬间什么都没悬停 —— 直接清掉的话整张图会闪一下全亮。
 */
export function useChainFocus() {
  const [focus, setFocus] = useState<ChainFocus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = useCallback((f: ChainFocus) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setFocus((cur) => (cur && cur.kind === f.kind && cur.name === f.name ? cur : f));
  }, []);
  const leave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFocus(null);
    }, 90);
  }, []);
  return { focus, enter, leave };
}

/**
 * 路由图：每一把密钥经哪条路由、哪条规则，落到哪个策略组、哪个上游。
 *
 * **它是这一页的全貌，下面的表格是细节。**悬停表格的一行（或图上一个节点），经过它
 * 的每一条路亮起来、从左往右画过去，其余的淡下去；点节点打开它（路由、策略组在这一页
 * 编辑，密钥、上游去各自那一页）。
 *
 * **请求在途时，它走的那条路是亮的**：线深一档，两头的密钥和上游带一个脉冲点。走完
 * 就熄。
 *
 * 单色：线和节点都是前景色的深浅；颜色只留给状态（停用、熔断、拒绝）。
 */
export function ChainMap({
  ov,
  flights,
  focus,
  onEnter,
  onLeave,
  onOpen,
  className,
}: {
  ov: Overview;
  /** 在途的请求（`useFlights`） */
  flights: ReadonlyMap<number, Flight>;
  focus: ChainFocus | null;
  onEnter: (f: ChainFocus) => void;
  onLeave: () => void;
  /** 点了一个节点。拒绝那一格点不了 */
  onOpen: (f: ChainFocus) => void;
  className?: string;
}) {
  const t = useText(chainMapText);
  const chain = useMemo(() => buildChain(ov), [ov]);
  const activity = useMemo(() => activityOf(flights, ov, chain), [flights, ov, chain]);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => (width > 0 ? layoutChain(chain, width) : null), [chain, width]);
  const lit = useMemo(() => litBy(chain, focus ? focusId(focus) : null), [chain, focus]);
  const calm = prefersReducedMotion();

  const count = (layer: number) => chain.nodes.filter((n) => n.layer === layer && n.kind !== "via" && n.kind !== "deny").length;
  const caption: Record<number, string> = { 0: t.keys, 1: t.routes, 2: t.groups, 3: t.upstreams };

  return (
    <section
      data-slot="chain-map"
      className={cn("rounded-xl border border-border bg-surface/45 px-5 pt-3 pb-5", className)}
    >
      {/* 列名不带数：数在页头和标签上，这里再写一遍会和它们对不上（图里不画没被引用的内置策略组） */}
      <div className="relative mb-2.5 h-5" aria-hidden>
        {layout?.cols.map((c) => (
          <div
            key={c.layer}
            className="absolute top-0 flex items-center tw-label text-muted-foreground"
            style={{ left: c.x, width: c.w }}
          >
            {caption[c.layer]}
          </div>
        ))}
      </div>
      <div
        ref={box}
        role="img"
        aria-label={t.label(count(0), count(1), count(2), count(3))}
        className="relative"
        style={{ height: layout?.height ?? NODE_H }}
      >
        {layout && (
          <>
            <svg
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute inset-0 overflow-visible"
              aria-hidden
            >
              <g fill="none" strokeLinecap="round">
                {layout.edges.map((e) => (
                  <BaseEdge key={e.edge.id} e={e} dim={lit !== null && !lit.edges.has(e.edge.id)} />
                ))}
                {layout.edges.map((e) => (
                  <LiveEdge
                    key={e.edge.id}
                    e={e}
                    on={activity?.edges.has(e.edge.id) ?? false}
                    dim={lit !== null && !lit.edges.has(e.edge.id)}
                    calm={calm}
                  />
                ))}
                {layout.edges.map((e) => (
                  <LitEdge key={e.edge.id} e={e} on={lit?.edges.has(e.edge.id) ?? false} calm={calm} />
                ))}
              </g>
            </svg>
            {layout.nodes
              .filter((p) => p.node.kind !== "via")
              .map((p) => (
                <Node
                  key={p.node.id}
                  node={p.node}
                  ov={ov}
                  live={activity?.nodes.get(p.node.id) ?? 0}
                  style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
                  state={
                    lit === null
                      ? "rest"
                      : focus && focusId(focus) === p.node.id
                        ? "focus"
                        : lit.nodes.has(p.node.id)
                          ? "lit"
                          : "dim"
                  }
                  onEnter={onEnter}
                  onLeave={onLeave}
                  onOpen={onOpen}
                />
              ))}
          </>
        )}
      </div>
    </section>
  );
}

/** 底下那层线：一直在，悬停别处时淡下去 */
function BaseEdge({ e, dim }: { e: PlacedEdge; dim: boolean }) {
  return (
    <path
      d={e.d}
      stroke="currentColor"
      strokeWidth={1.25}
      strokeDasharray={e.edge.idle ? "3 4" : undefined}
      className={cn(
        "transition-opacity duration-(--motion-base) ease-(--motion-ease) motion-reduce:transition-none",
        e.edge.idle ? "text-foreground/15" : "text-foreground/22",
        dim && "opacity-40",
      )}
    />
  );
}

/**
 * 在途请求走的那段：比底下那层深一档，出现、熄灭都是淡入淡出。悬停别处时和底下那层
 * 一起淡下去。
 */
function LiveEdge({ e, on, dim, calm }: { e: PlacedEdge; on: boolean; dim: boolean; calm: boolean }) {
  return (
    <path
      data-live={on || undefined}
      d={e.d}
      stroke="currentColor"
      strokeWidth={1.5}
      className="text-foreground/50"
      style={{
        opacity: on ? (dim ? 0.4 : 1) : 0,
        transition: calm ? "none" : "opacity var(--motion-slow) var(--motion-ease)",
      }}
    />
  );
}

/**
 * 点亮时叠在上面的那条：**从起点画到终点**（`pathLength` 归一，虚线偏移从 1 走到 0），
 * 起点在越靠右的层越晚一点开始，读起来是请求从密钥走到上游。熄灭时直接淡出，再在
 * 看不见的时候把偏移拨回去，下一次还是从头画。
 */
function LitEdge({ e, on, calm }: { e: PlacedEdge; on: boolean; calm: boolean }) {
  const style: CSSProperties = calm
    ? { strokeDashoffset: on ? 0 : 1, opacity: on ? 1 : 0, transition: "none" }
    : on
      ? {
          strokeDashoffset: 0,
          opacity: 1,
          transition: `stroke-dashoffset var(--motion-slow) var(--motion-ease) ${e.layer * 70}ms, opacity 0s`,
        }
      : {
          strokeDashoffset: 1,
          opacity: 0,
          transition: "opacity var(--motion-fast) var(--motion-ease), stroke-dashoffset 0s linear var(--motion-fast)",
        };
  return (
    <path
      d={e.d}
      pathLength={1}
      strokeDasharray="1 1"
      stroke="currentColor"
      strokeWidth={1.5}
      className="text-foreground/75"
      style={style}
    />
  );
}

type NodeState = "rest" | "focus" | "lit" | "dim";

function Node({
  node,
  ov,
  live,
  style,
  state,
  onEnter,
  onLeave,
  onOpen,
}: {
  node: ChainNode;
  ov: Overview;
  /** 经过它的在途请求数 */
  live: number;
  style: CSSProperties;
  state: NodeState;
  onEnter: (f: ChainFocus) => void;
  onLeave: () => void;
  onOpen: (f: ChainFocus) => void;
}) {
  const t = useText(chainMapText);
  const rt = useText(routingText);
  const f: ChainFocus = { kind: node.kind as ChainFocus["kind"], name: node.name };
  const group = node.kind === "group" ? ov.groups.find((g) => g.name === node.name) : undefined;
  // 拒绝没有东西可打开；内置的「全部上游」不能编辑
  const openable = node.kind !== "deny" && !group?.builtin;
  const { body, tip } = describe(node, ov, live, t, rt);
  return (
    <Tip text={tip}>
      <div
        data-chain-node={node.id}
        data-state={state}
        onMouseEnter={() => onEnter(f)}
        onMouseLeave={onLeave}
        onClick={openable ? () => onOpen(f) : undefined}
        className={cn(
          "absolute flex items-center gap-1.5 rounded-md border bg-background px-2 tw-body shadow-[0_1px_0_0_var(--border)]",
          "transition-[opacity,border-color,background-color] duration-(--motion-base) ease-(--motion-ease) motion-reduce:transition-none",
          node.idle ? "border-dashed border-foreground/20 text-muted-foreground shadow-none" : "border-border text-foreground",
          openable && "cursor-pointer hover:bg-muted/60",
          state === "focus" && "border-foreground/55",
          state === "lit" && !node.idle && "border-foreground/35",
          state === "dim" && "opacity-35",
        )}
        style={style}
      >
        {body}
      </div>
    </Tip>
  );
}

/** 节点里画什么，悬停说明里写什么。`live`：经过它的在途请求数 */
function describe(
  node: ChainNode,
  ov: Overview,
  live: number,
  t: (typeof chainMapText)["zh"],
  rt: (typeof routingText)["zh"],
): { body: ReactNode; tip: ReactNode } {
  const pt = textOf(partsText);
  const tip = (title: string, ...lines: (string | null | false | undefined)[]) => {
    const line = lines.filter(Boolean).join(rt.clauseSep);
    return (
      <div className="flex max-w-64 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {line && <span className="opacity-80">{line}</span>}
      </div>
    );
  };
  // 两头（密钥、上游）上的脉冲点：有请求正从这里走。中间几站看线就够了
  const pulse = live > 0 && <StatusDot tone="pending" className="shrink-0" />;
  const flying = live > 0 && t.inFlight(live);
  switch (node.kind) {
    case "key": {
      const k = ov.clients.find((c) => c.name === node.name)!;
      const route = k.route ?? orderedRoutes(ov.routes).find((r) => r.default)?.name ?? "";
      return {
        body: (
          <>
            <KeyIcon k={k} />
            <span className="min-w-0 truncate">{k.name}</span>
            {(pulse || k.disabled) && (
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {pulse}
                {k.disabled && <StatusDot tone="idle" />}
              </span>
            )}
          </>
        ),
        tip: tip(k.name, t.usesRoute(route), k.disabled && pt.keyDisabled, flying),
      };
    }
    case "route": {
      const r = ov.routes.find((x) => x.name === node.name)!;
      const users = usersOf(r, ov.clients);
      // 默认路由不在节点上标：下面的表里那一行带「默认」，悬停说明里也写着
      return {
        body: (
          <>
            <IconRoute aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">{r.name}</span>
          </>
        ),
        tip: tip(
          r.name,
          r.default && t.defaultRoute,
          users.length ? t.keyCount(users.length) : t.unusedRoute,
          t.ruleCount(r.rules.length),
        ),
      };
    }
    case "group": {
      const g = ov.groups.find((x) => x.name === node.name)!;
      const ms = membersOf(
        g,
        ov.providers.map((p) => p.name),
      );
      const ordered = g.kind === "fallback" || g.kind === "select";
      const line = node.idle && !g.builtin ? t.unreferenced : (ordered ? t.members : t.membersUnordered)(groupKindLabel(g.kind), ms);
      return {
        body: (
          <>
            <TargetIcon name={g.name} providers={[]} />
            <span className="min-w-0 truncate">{targetLabel(g.name)}</span>
          </>
        ),
        tip: tip(targetLabel(g.name), line),
      };
    }
    case "deny": {
      const by = ov.routes.flatMap((r) =>
        r.rules.filter((x) => !x.to && x.deny != null && !x.shadowed && !x.phase_two).map((x) => t.denyBy(r.name, x.name)),
      );
      return {
        body: (
          <>
            <BanIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0 truncate text-destructive">{rt.deny}</span>
          </>
        ),
        tip: tip(rt.deny, by.join(rt.listSep)),
      };
    }
    default: {
      const p = ov.providers.find((x) => x.name === node.name)!;
      const s = upstreamState(p);
      return {
        body: (
          <>
            <TargetIcon name={p.name} providers={[p]} />
            <span className="min-w-0 truncate">{p.name}</span>
            {(pulse || s) && (
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {pulse}
                {s && <StatusDot tone={s.tone} />}
              </span>
            )}
          </>
        ),
        tip: tip(p.name, s?.label ?? (node.idle && t.unreachable), flying),
      };
    }
  }
}
