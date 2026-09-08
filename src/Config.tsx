import type { Overview } from "./types";

/**
 * 上游与规则。
 *
 * **按 §0.6 的触发条件显示**：只有一个 provider 的用户不会看到「故障
 * 转移」「分组」这些词 —— 那些概念对他确实不存在。但**模型路由一直在**，
 * 因为一个上游就有几十个模型，那个问题从第一天就存在。
 */
export default function Config({ ov }: { ov: Overview }) {
  const multi = ov.providers.length >= 2;

  return (
    <div className="space-y-8 p-5">
      <section>
        <h2 className="text-sm font-semibold">上游</h2>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-2 font-medium">名字</th>
              <th className="font-medium">地址</th>
              <th className="font-medium">协议</th>
              <th className="font-medium">密钥</th>
              <th className="font-medium">代理</th>
              {/* 只有一家的时候熔断是旁路的，显示健康列没有意义 */}
              {multi && <th className="font-medium">状态</th>}
            </tr>
          </thead>
          <tbody>
            {ov.providers.map((p) => (
              <tr key={p.name} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 font-medium">{p.name}</td>
                <td className="font-mono text-neutral-500">{p.base_url}</td>
                <td className="text-neutral-500">
                  {/* 猜不出协议不是错误 —— 但要说清按什么转发 */}
                  {p.protocol ?? <span title="按 Anthropic 转发">未知</span>}
                </td>
                {/* 来源，不是值 */}
                <td className="font-mono text-neutral-500">{p.key_source}</td>
                <td className="text-neutral-500">{p.proxy}</td>
                {multi && (
                  <td>
                    {p.health === "ok" ? (
                      <span className="text-emerald-600 dark:text-emerald-400">正常</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400" title="连续失败后暂时不派请求过去，冷却后自动恢复">
                        熔断中
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-sm font-semibold">路由规则</h2>
        <p className="mt-1 text-xs text-neutral-500">
          从上往下匹配，第一条命中的说了算。
        </p>
        <ol className="mt-2 space-y-1.5">
          {ov.routes.map((r, i) => (
            <li
              key={r.name}
              className="flex items-baseline gap-3 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"
            >
              <span className="w-4 shrink-0 text-neutral-400">{i + 1}</span>
              <span className="font-medium">{r.name}</span>
              <span className="text-neutral-500">
                {r.conditions.length === 0 ? (
                  // 兜底规则要标出来。少了它，用户会以为「没有兜底」
                  // 而反复调试一条其实一直在生效的规则。
                  <span className="rounded bg-neutral-200 px-1.5 py-0.5 dark:bg-neutral-800">
                    兜底
                  </span>
                ) : (
                  r.conditions.join(" 且 ")
                )}
              </span>
              <span className="ml-auto font-mono text-neutral-500">→ {r.to}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* §0.6：分组这个概念只在真的有组的时候出现 */}
      {ov.groups.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">策略组</h2>
          <ul className="mt-2 space-y-1.5">
            {ov.groups.map((g) => (
              <li
                key={g.name}
                className="rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-neutral-500">{g.kind}</span>
                  <span className="ml-auto font-mono text-neutral-500">
                    {g.providers.join(" → ")}
                  </span>
                </div>
                {g.hurts_cache && (
                  // 这句必须在界面上直说：它决定了用户的账单（§3.4）。
                  // 缓存命中与否成本差 5 到 10 倍，而为了省 20% 的单价
                  // 丢掉 90% 的缓存折扣，是一笔怎么算都不划算的账。
                  <p className="mt-1.5 text-amber-700 dark:text-amber-400">
                    ⚠ 这个策略会让 prompt cache 失效，长会话的成本会明显上升。
                    需要它的话记得开会话粘滞。
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold">监听与访问</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-neutral-500">地址</dt>
          <dd className="font-mono">
            {ov.listen.bind} : {ov.listen.port}
          </dd>
          <dt className="text-neutral-500">客户端密钥</dt>
          <dd className="font-mono">
            {ov.clients.map((c) => `${c.name} ${c.key}`).join("，")}
          </dd>
          {ov.listen.exposed && (
            <>
              <dt className="text-neutral-500">来源白名单</dt>
              <dd className="font-mono">{ov.listen.allow_from.join("，") || "（全放行）"}</dd>
            </>
          )}
        </dl>
        {ov.listen.exposed && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            网关监听在非本机地址上，局域网里的其他机器能连过来。密钥校验此时是强制的。
          </p>
        )}
      </section>
    </div>
  );
}
