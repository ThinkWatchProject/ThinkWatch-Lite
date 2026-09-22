/**
 * 放行网段的写法：一个网段（`192.168.1.0/24`、`fc00::/7`）或一个地址
 * （`192.168.1.5`，就是这一台）。
 *
 * **和 core 的 `Cidr::from_str` 同一套规矩**（tw-gateway 的 access.rs）：
 * 地址按标准写法解析，前缀 IPv4 最多 32、IPv6 最多 128，不带前缀的是单个
 * 地址。这里先挡一遍是为了当场说清哪一条写错了 —— 等存的时候再由 core
 * 报错，用户已经不知道是哪一条。
 */

export type Range =
  | { v: 4; addr: string; prefix: number }
  | { v: 6; addr: string; prefix: number };

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** 四段十进制。**不收前导零**：`010` 在有的解析器里是八进制 */
function isV4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => OCTET.test(p));
}

/** 标准的 IPv6 写法：八组十六进制，`::` 最多一次，最后可以嵌一个 IPv4 */
function isV6(s: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return false;
  const [front = "", back, ...more] = s.split("::");
  if (more.length > 0) return false;
  const squeezed = back !== undefined;
  const groups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = groups(front);
  const tail = squeezed ? groups(back) : [];
  const all = [...head, ...tail];
  // 嵌进来的 IPv4 只能是整个地址的最后一段
  const lastSide = squeezed ? tail : head;
  let count = 0;
  for (const [i, g] of all.entries()) {
    if (g.includes(".")) {
      if (i !== all.length - 1 || lastSide.length === 0 || !isV4(g)) return false;
      count += 2;
    } else if (/^[0-9a-fA-F]{1,4}$/.test(g)) {
      count += 1;
    } else {
      return false;
    }
  }
  return squeezed ? count <= 7 : count === 8;
}

/** 读一条。写得不对就是 null */
export function parseRange(raw: string): Range | null {
  const s = raw.trim();
  const slash = s.indexOf("/");
  const addr = slash < 0 ? s : s.slice(0, slash);
  const p = slash < 0 ? null : s.slice(slash + 1);
  const v = isV4(addr) ? 4 : isV6(addr) ? 6 : null;
  if (v === null) return null;
  const max = v === 4 ? 32 : 128;
  if (p !== null && !/^\d{1,3}$/.test(p)) return null;
  const prefix = p === null ? max : Number(p);
  if (prefix > max) return null;
  return { v, addr: v === 6 ? addr.toLowerCase() : addr, prefix };
}

/** 存进配置的写法：两头的空白去掉，IPv6 转小写，其余照用户写的 */
export function rangeText(r: Range, raw: string): string {
  const slash = raw.trim().indexOf("/");
  return slash < 0 ? r.addr : `${r.addr}/${r.prefix}`;
}

const toInt = (a: string) => a.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const toDotted = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

/**
 * 一个 IPv4 网段从哪儿到哪儿。**主机位写了也照网段算**：`192.168.1.5/24`
 * 覆盖的是 `192.168.1.0` 到 `192.168.1.255`，core 匹配时也是这么掩的。
 * 单个地址和 IPv6 不给（IPv6 的起止长到没法读）。
 */
export function v4Span(r: Range): [string, string] | null {
  if (r.v !== 4 || r.prefix === 32) return null;
  const size = 2 ** (32 - r.prefix);
  const start = Math.floor(toInt(r.addr) / size) * size;
  return [toDotted(start), toDotted(start + size - 1)];
}
