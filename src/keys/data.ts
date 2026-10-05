/**
 * 密钥页和客户端页共用的几份数据。
 *
 * **都走 `useResource`**：模块级缓存，换页回来先画上一次的数据、后台再取，两页
 * 挂同一个键只取一次。什么时候重取写在事件里，不轮询。
 */
import { useEffect, useMemo, useRef } from "react";
import { useResource, type Resource } from "@/lib/resource";
import type { ClientView, CoreEvent, KeyUsage, KnownModel } from "@/types";
import { useStartOf } from "@/useNow";
import { api } from "./api";
import { HOUR_MS, usageByKey, usageWindow, type KeyUse } from "./usage";

export type { KeyUse } from "./usage";

/** 请求落地、定价之后用量会变 */
const USAGE_EVENTS: CoreEvent["kind"][] = ["request_finished", "request_failed", "request_cancelled", "request_priced"];

/**
 * 每把密钥 24 小时的用量。取数那一刻现算时间窗，结果里带着它（`since_ms`），
 * 画的时候按结果里的来。
 *
 * 请求落地时重取；**到了整点也重取**（钟跳了也算，见 `useStartOf`）：一直开着、一直
 * 没有请求的话，时间窗不往前挪，「24 小时」里就会算进 24 小时之前的请求。
 */
export function useKeyUsage(): Resource<KeyUsage> & { byKey: Map<string, KeyUse> | undefined } {
  const hour = useStartOf(HOUR_MS);
  const r = useResource(
    "key-usage",
    () => {
      const w = usageWindow();
      return api.keyUsage(w.since, w.bucket);
    },
    { events: USAGE_EVENTS, deps: [hour] },
  );
  const byKey = useMemo(() => (r.data ? usageByKey(r.data) : undefined), [r.data]);
  return { ...r, byKey };
}

/**
 * 全部网关密钥。配置换了一版就重取（密钥页拿着概览里的版本号，直接按它；别的页
 * 听 `config_reloaded`）；请求落地时也重取，「最近使用」和用量上限跟着它走。某条上限
 * 到了八成、到了顶（`key_limit_alert`）也重取：那一刻请求可能还在跑，等它落地「已达上限」
 * 就晚了。
 */
export function useKeys(configVersion?: string): Resource<ClientView[]> {
  return useResource("keys", api.listKeys, {
    events:
      configVersion === undefined
        ? ["config_reloaded", "request_finished", "request_failed", "request_cancelled", "key_limit_alert"]
        : ["request_finished", "request_failed", "request_cancelled", "key_limit_alert"],
    deps: configVersion === undefined ? undefined : [configVersion],
  });
}

/** 网关聚合出来的模型目录。**取不到时是空的**：可见模型那一栏退回说规则条数 */
export function useKnownModels(): Resource<KnownModel[]> {
  return useResource("known-models", api.knownModels, { events: ["models_changed", "config_reloaded"] });
}

/** 客户端该连的网关地址。换了监听端口会变 */
export function useGatewayBase(): Resource<string> {
  return useResource("gateway-base", api.gatewayBase, { events: ["listen_changed"] });
}

/**
 * 写配置时带的版本号。
 *
 * **不能只用概览里那一份**：刚写完一次（停用一把密钥），紧接着撤销的时候概览还没
 * 重读，拿旧版本号去写会被 core 当成冲突拒掉。每次写完记下 core 回的新版本，
 * 概览换了版本再跟上它。
 */
export function useConfigVersion(fromOverview: string): { get: () => string; set: (v: string) => void } {
  const latest = useRef(fromOverview);
  useEffect(() => {
    latest.current = fromOverview;
  }, [fromOverview]);
  return useMemo(
    () => ({
      get: () => latest.current,
      set: (v: string) => {
        latest.current = v;
      },
    }),
    [],
  );
}
