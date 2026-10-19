/**
 * 同步位置的表单：三种位置各几格，写成 `SyncTarget`、查填得对不对。设置里那一节和开启
 * 同步的第 1 步用的是同一份。纯函数，导出给测试。
 */
import type { SyncTarget } from "@/types";

export type TargetKind = SyncTarget["type"];

export const TARGET_KINDS: readonly TargetKind[] = ["folder", "webdav", "s3"];

/** 三种位置的格子都在：换了类型再换回来，填过的还在 */
export interface TargetDraft {
  type: TargetKind;
  path: string;
  url: string;
  user: string;
  pass: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  access_key_id: string;
  secret_access_key: string;
  /** `direct` 或代理的名字。只对 WebDAV、S3 有意义 */
  proxy: string;
}

export const EMPTY_TARGET: TargetDraft = {
  type: "folder",
  path: "",
  url: "",
  user: "",
  pass: "",
  endpoint: "",
  region: "",
  bucket: "",
  prefix: "",
  access_key_id: "",
  secret_access_key: "",
  proxy: "direct",
};

export function draftOf(t: SyncTarget | null | undefined): TargetDraft {
  if (!t) return { ...EMPTY_TARGET };
  const d: TargetDraft = { ...EMPTY_TARGET, type: t.type, proxy: t.proxy || "direct" };
  switch (t.type) {
    case "folder":
      return { ...d, path: t.path };
    case "webdav":
      return { ...d, url: t.url, user: t.user, pass: t.pass };
    case "s3":
      return {
        ...d,
        endpoint: t.endpoint,
        region: t.region,
        bucket: t.bucket,
        prefix: t.prefix,
        access_key_id: t.access_key_id,
        secret_access_key: t.secret_access_key,
      };
  }
}

/**
 * 交给 core 的那一份。地址、路径、名字去掉两头的空白；**密码、密钥原样**（空格可能是它的
 * 一部分）。文件夹不经代理，代理一律写 `direct`
 */
export function targetOf(d: TargetDraft): SyncTarget {
  switch (d.type) {
    case "folder":
      return { type: "folder", path: d.path.trim(), proxy: "direct" };
    case "webdav":
      return { type: "webdav", url: d.url.trim(), user: d.user.trim(), pass: d.pass, proxy: d.proxy };
    case "s3":
      return {
        type: "s3",
        endpoint: d.endpoint.trim(),
        region: d.region.trim(),
        bucket: d.bucket.trim(),
        prefix: d.prefix.trim(),
        access_key_id: d.access_key_id.trim(),
        secret_access_key: d.secret_access_key,
        proxy: d.proxy,
      };
  }
}

/** 写成 `SyncTarget` 之后一样吗（别的类型的格子不算） */
export function sameTarget(a: TargetDraft, b: TargetDraft): boolean {
  return JSON.stringify(targetOf(a)) === JSON.stringify(targetOf(b));
}

/** 还差哪一格（按格子从上到下的第一个）。都填好了是 null */
export type TargetProblem =
  | "path"
  | "url"
  | "url_scheme"
  | "endpoint"
  | "endpoint_scheme"
  | "bucket"
  | "access_key_id"
  | "secret_access_key";

const SCHEME = /^https?:\/\/\S+$/i;

export function targetProblem(d: TargetDraft): TargetProblem | null {
  switch (d.type) {
    case "folder":
      return d.path.trim() ? null : "path";
    case "webdav":
      if (!d.url.trim()) return "url";
      return SCHEME.test(d.url.trim()) ? null : "url_scheme";
    case "s3":
      if (!d.endpoint.trim()) return "endpoint";
      if (!SCHEME.test(d.endpoint.trim())) return "endpoint_scheme";
      if (!d.bucket.trim()) return "bucket";
      if (!d.access_key_id.trim()) return "access_key_id";
      if (!d.secret_access_key) return "secret_access_key";
      return null;
  }
}

/** 同步口令至少几个字符（方案 6.8） */
export const PASSPHRASE_MIN = 12;

/** 新口令填得对不对：够长、两次一样。对了是 null */
export function passphraseProblem(a: string, b: string): "short" | "mismatch" | null {
  if ([...a].length < PASSPHRASE_MIN) return "short";
  return a === b ? null : "mismatch";
}
