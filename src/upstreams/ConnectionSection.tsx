import { useState } from "react";
import { CircleAlertIcon, CircleCheckIcon, PlugIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { SecretInput } from "@/ui/secret-input";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { cn } from "@/lib/utils";
import { ms } from "@/format";
import { useText } from "@/i18n";
import type { Overview, ProviderPreview, ProviderTestResult, ProviderView } from "@/types";
import { connectionSectionText } from "./ConnectionSection.i18n";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import { HeaderEditor, type AuthRow } from "./HeaderEditor";
import {
  AUTH_MODES,
  BEDROCK_AUTH_MODES,
  BEDROCK_REGIONS,
  PROTOCOLS,
  authHeaderParts,
  bedrockRegionOf,
  bedrockUrl,
  coreText,
  egressLabel,
  protocolLabel,
  proxyKindLabel,
} from "./labels";
import { FormItem, Note } from "./parts";
import { nameFromUrl } from "./presets";
import {
  authModeOf,
  concurrencyOf,
  describeModelList,
  freeName,
  isBedrock,
  oauthKept,
  type UpstreamForm,
} from "./upstreamForm";

/** 「新建代理…」在下拉里的占位值。名称首尾不能有空白，不会和真实名称重复 */
const NEW_PROXY = " new-proxy";

export function ConnectionSection({
  form,
  set,
  editing,
  ov,
  preview,
  testing,
  test,
  onTest,
  onNewProxy,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  /** 编辑时是原来那一家 */
  editing: ProviderView | null;
  ov: Overview;
  preview: ProviderPreview | null;
  testing: boolean;
  test: ProviderTestResult | null;
  onTest: () => void;
  onNewProxy: () => void;
}) {
  const t = useText(connectionSectionText);
  // 连着远程 core 时 `${变量名}` 取的是服务器上 core 进程的环境
  const rt = useText(remoteText);
  const remote = useRemote();
  const proxies = ov.proxies;
  const taken = ov.providers.map((p) => p.name);
  /** 密钥显示与否：输入框和请求头第一行是同一个值，跟着同一个开关 */
  const [showKey, setShowKey] = useState(false);
  const bedrock = isBedrock(form);
  const mode = authModeOf(form);
  /** 标准 Bedrock 地址里的区域；别的地址是 null */
  const region = bedrockRegionOf(form.baseUrl.trim());
  const autoProtocol = !form.baseUrl.trim()
    ? t.auto
    : preview?.protocol
      ? t.autoDetected(protocolLabel(preview.protocol))
      : t.autoUndetected;

  return (
    <div className="flex flex-col gap-4">
      {/* 服务类型在上一步选定；这里新建和编辑是同一张表单 */}
      <div className="grid grid-cols-2 gap-4">
        <FormItem label={t.protocol} htmlFor="up-protocol">
          <ProtocolSelect form={form} set={set} auto={autoProtocol} />
        </FormItem>
        <FormItem label={t.name} htmlFor="up-name">
          <Input
            id="up-name"
            className="font-mono"
            value={form.name}
            placeholder={nameFromUrl(form.baseUrl) || t.namePlaceholder}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FormItem>
      </div>

      <FormItem label={t.baseUrl} htmlFor="up-url" desc={t.baseUrlDesc}>
        <Input
          id="up-url"
          className="font-mono"
          value={form.baseUrl}
          placeholder="https://api.example.com"
          onChange={(e) =>
            set({
              baseUrl: e.target.value,
              // 新建时名称跟着地址猜，直到用户自己填了
              name:
                !editing && (form.name === "" || form.name === freeName(nameFromUrl(form.baseUrl), taken))
                  ? freeName(nameFromUrl(e.target.value), taken)
                  : form.name,
            })
          }
        />
      </FormItem>

      <div className="grid grid-cols-2 gap-4">
        <FormItem label={t.auth}>
          {/* 和旁边的下拉框等高 */}
          <div className="flex h-8 items-center">
            {bedrock ? (
              <Segmented value={mode} options={BEDROCK_AUTH_MODES} onChange={(authMode) => set({ authMode })} />
            ) : (
              <Segmented value={mode} options={AUTH_MODES} onChange={(authMode) => set({ authMode })} />
            )}
          </div>
        </FormItem>
      </div>

      {/* 标准地址按区域生成；VPC 端点、代理这些地址，签名用的区域另写。只用 API 密钥时
          不签名，非标准地址也就用不着区域 */}
      {bedrock && (region !== null || mode !== "key") && (
        <div className="grid grid-cols-2 gap-4">
          <FormItem
            label={t.region}
            htmlFor="up-region"
            desc={region === null ? t.signingRegionDesc : undefined}
          >
            <RegionSelect
              value={region ?? form.awsRegion.trim()}
              onChange={(r) =>
                region !== null ? set({ baseUrl: bedrockUrl(r) }) : set({ awsRegion: r })
              }
            />
          </FormItem>
        </div>
      )}

      {mode === "key" && (
        <FormItem label={t.apiKey} htmlFor="up-key" desc={remote ? rt.keyHint : undefined}>
          <SecretInput
            id="up-key"
            className="font-mono"
            value={form.key}
            placeholder={bedrock ? "${AWS_BEARER_TOKEN_BEDROCK}" : t.keyPlaceholder}
            plain={ENV_REF.test(form.key.trim())}
            revealed={showKey}
            onRevealedChange={setShowKey}
            onChange={(e) => set({ key: e.target.value })}
          />
        </FormItem>
      )}
      {mode === "oauth" && <OAuth form={form} set={set} />}
      {mode === "aws-keys" && <AccessKeys form={form} set={set} remote={remote != null} />}
      {mode === "aws-profile" && (
        <FormItem label={t.awsProfile} htmlFor="up-profile" desc={remote ? rt.profileHint : t.profileDesc}>
          <Input
            id="up-profile"
            className="font-mono"
            value={form.awsProfile}
            placeholder="default"
            onChange={(e) => set({ awsProfile: e.target.value })}
          />
        </FormItem>
      )}

      <FormItem label={t.headers} hint={remote ? rt.headersHint : t.headersHint}>
        <HeaderEditor
          form={form}
          set={set}
          auth={authRow(form, preview?.auth_header ?? editing?.auth_header ?? null, showKey, {
            unknown: t.authUnknown,
            token: t.renewedToken,
            signed: t.signedPerRequest,
          })}
        />
      </FormItem>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2.5 tw-body font-medium">
          <Switch
            checked={form.forwardClientIdentity}
            onCheckedChange={(c) => set({ forwardClientIdentity: c === true })}
          />
          {t.clientIdentity}
        </label>
        <p className="tw-label text-muted-foreground">{t.clientIdentityDesc}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormItem label={t.proxy} htmlFor="up-proxy">
          <NativeSelect
            id="up-proxy"
            className="w-full"
            value={form.proxy}
            onChange={(e) =>
              e.target.value === NEW_PROXY ? onNewProxy() : set({ proxy: e.target.value })
            }
          >
            <NativeSelectOption value="direct">{egressLabel("direct")}</NativeSelectOption>
            <NativeSelectOption value="system">{egressLabel("system")}</NativeSelectOption>
            {proxies.map((x) => (
              <NativeSelectOption key={x.name} value={x.name}>
                {x.name} · {proxyKindLabel(x.kind)} {x.addr}
              </NativeSelectOption>
            ))}
            {form.proxy !== "direct" &&
              form.proxy !== "system" &&
              !proxies.some((x) => x.name === form.proxy) && (
                <NativeSelectOption value={form.proxy}>{form.proxy}</NativeSelectOption>
              )}
            <NativeSelectOption value={NEW_PROXY}>{t.newProxy}</NativeSelectOption>
          </NativeSelect>
        </FormItem>
        <FormItem label={t.onProxyFail} htmlFor="up-proxy-fail">
          <NativeSelect
            id="up-proxy-fail"
            className="w-full"
            value={form.onProxyFail}
            disabled={form.proxy === "direct"}
            onChange={(e) => set({ onProxyFail: e.target.value === "direct" ? "direct" : "fail" })}
          >
            <NativeSelectOption value="fail">{t.failWithError}</NativeSelectOption>
            <NativeSelectOption value="direct">{t.fallBackDirect}</NativeSelectOption>
          </NativeSelect>
        </FormItem>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ConcurrencyField form={form} set={set} />
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={onTest} pending={testing}>
            {!testing && <PlugIcon />}
            {t.check}
          </Button>
          {testing ? (
            <StatusLabel tone="pending" muted>
              {t.checking}
            </StatusLabel>
          ) : (
            <Note>{t.checkNote}</Note>
          )}
        </div>
        {test && !testing && <TestLine result={test} />}
      </div>
    </div>
  );
}

/**
 * 并发上限：同时最多发给这家几个请求。空着是不限，格子里写着「不限」。**写错了当场标红**，
 * 保存按不下去（`connectionMissing`），不等 core 拒。账号上游的「账号」一节也用它
 */
export function ConcurrencyField({
  form,
  set,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
}) {
  const t = useText(connectionSectionText);
  const bad = concurrencyOf(form) === undefined;
  return (
    <FormItem
      label={t.concurrency}
      htmlFor="up-concurrency"
      desc={bad ? <span className="text-destructive">{t.badConcurrency}</span> : t.concurrencyDesc}
    >
      <Input
        id="up-concurrency"
        inputMode="numeric"
        className="font-mono tabular-nums"
        value={form.maxConcurrent}
        placeholder={t.noLimit}
        aria-invalid={bad || undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => set({ maxConcurrent: e.target.value.trim() })}
      />
    </FormItem>
  );
}

function ProtocolSelect({
  form,
  set,
  auto,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  auto: string;
}) {
  return (
    <NativeSelect
      id="up-protocol"
      className="w-full"
      value={form.protocol}
      onChange={(e) => set({ protocol: PROTOCOLS.find((p) => p.id === e.target.value)?.id ?? "" })}
    >
      <NativeSelectOption value="">{auto}</NativeSelectOption>
      {PROTOCOLS.map((p) => (
        <NativeSelectOption key={p.id} value={p.id}>
          {p.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** `${NAME}` 整个就是一个环境变量引用：不是秘密，明文显示 */
const ENV_REF = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/**
 * 请求头列表的第一行：密钥或 OAuth token 实际放进的那个鉴权头。
 *
 * **跟着密钥和协议走，不能单独改**：core 按协议把密钥放进鉴权头，`headers` 里
 * 再写同一个头会被判成冲突。要用别的头发凭据，就不填密钥、自己加一行。
 * 没有密钥就没有这一行 —— 那时确实什么都不发。
 */
function authRow(
  form: UpstreamForm,
  /** 按选定或识别出的协议，凭据放在哪个请求头里。地址还没填时不知道 */
  header: string | null,
  /** 密钥那一栏此刻显示着没有 */
  revealed: boolean,
  text: { unknown: string; token: string; signed: string },
): AuthRow | null {
  const parts = header ? authHeaderParts(header) : null;
  const name = parts?.name ?? null;
  const prefix = parts?.prefix ?? "";
  const mode = authModeOf(form);
  if (mode === "oauth") {
    return { source: "oauth", name, unknownName: text.unknown, prefix, value: null, placeholder: text.token };
  }
  // 访问密钥不放进哪个头：每个请求在发出时签名，签出来的是 `Authorization` 那一行
  if (mode === "aws-keys" || mode === "aws-profile") {
    return {
      source: "signed",
      name: "Authorization",
      unknownName: text.unknown,
      prefix: "",
      value: null,
      placeholder: text.signed,
    };
  }
  const key = form.key.trim();
  if (!key) return null;
  // 环境变量引用不是秘密，照写；密钥跟着那一栏显示或隐藏，隐藏时不管多长都是十个点
  const value = revealed || ENV_REF.test(key) ? key : "●".repeat(10);
  return { source: "key", name, unknownName: text.unknown, prefix, value, placeholder: "" };
}

/** Bedrock 的区域。列表外的区域（地址里写的、配置里写的）也照样显示成选中 */
function RegionSelect({ value, onChange }: { value: string; onChange: (region: string) => void }) {
  const t = useText(connectionSectionText);
  const known = (BEDROCK_REGIONS as readonly string[]).includes(value);
  return (
    <NativeSelect
      id="up-region"
      className="w-full font-mono"
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
    >
      {value === "" && <NativeSelectOption value="">{t.pickRegion}</NativeSelectOption>}
      {!known && value !== "" && <NativeSelectOption value={value}>{value}</NativeSelectOption>}
      {BEDROCK_REGIONS.map((r) => (
        <NativeSelectOption key={r} value={r}>
          {r}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** AWS 访问密钥：写在这里，每一项都可以写 `${变量名}` */
function AccessKeys({
  form,
  set,
  remote,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  remote: boolean;
}) {
  const t = useText(connectionSectionText);
  const rt = useText(remoteText);
  const env = (v: string) => ENV_REF.test(v.trim());
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormItem label={t.accessKeyId} htmlFor="up-aws-id">
        <Input
          id="up-aws-id"
          className="font-mono"
          value={form.awsKeyId}
          placeholder="${AWS_ACCESS_KEY_ID}"
          onChange={(e) => set({ awsKeyId: e.target.value })}
        />
      </FormItem>
      <FormItem label={t.secretAccessKey} htmlFor="up-aws-secret">
        <SecretInput
          id="up-aws-secret"
          className="font-mono"
          value={form.awsSecret}
          placeholder="${AWS_SECRET_ACCESS_KEY}"
          plain={env(form.awsSecret)}
          onChange={(e) => set({ awsSecret: e.target.value })}
        />
      </FormItem>
      <FormItem
        label={t.sessionToken}
        htmlFor="up-aws-token"
        className="col-span-2"
        desc={remote ? rt.keyHint : t.sessionTokenDesc}
      >
        <SecretInput
          id="up-aws-token"
          className="font-mono"
          value={form.awsToken}
          placeholder="${AWS_SESSION_TOKEN}"
          plain={env(form.awsToken)}
          onChange={(e) => set({ awsToken: e.target.value })}
        />
      </FormItem>
    </div>
  );
}

function OAuth({
  form,
  set,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
}) {
  const t = useText(connectionSectionText);
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormItem label={t.tokenEndpoint} htmlFor="up-endpoint">
        <Input
          id="up-endpoint"
          className="font-mono"
          placeholder="https://auth.example.com/oauth/token"
          value={form.oauthEndpoint}
          onChange={(e) => set({ oauthEndpoint: e.target.value })}
        />
      </FormItem>
      <FormItem label={t.refreshToken} htmlFor="up-refresh">
        <SecretInput
          id="up-refresh"
          className="font-mono"
          value={form.oauthRefresh}
          onChange={(e) => set({ oauthRefresh: e.target.value })}
        />
      </FormItem>
      <FormItem label={t.clientId} htmlFor="up-client-id">
        <Input
          id="up-client-id"
          className="font-mono"
          value={form.oauthClientId}
          onChange={(e) => set({ oauthClientId: e.target.value })}
        />
      </FormItem>
      <FormItem label={t.clientSecret} htmlFor="up-client-secret">
        <SecretInput
          id="up-client-secret"
          className="font-mono"
          value={form.oauthClientSecret}
          onChange={(e) => set({ oauthClientSecret: e.target.value })}
        />
      </FormItem>
      {/* 凭据没改时检测用网关现有的 token；新填或改过的才需要现成的 Access Token */}
      {!oauthKept(form) && (
        <FormItem
          label={t.accessToken}
          htmlFor="up-access"
          className="col-span-2"
          desc={t.accessTokenDesc}
        >
          <SecretInput
            id="up-access"
            className="font-mono"
            value={form.oauthAccess}
            onChange={(e) => set({ oauthAccess: e.target.value })}
          />
        </FormItem>
      )}
    </div>
  );
}

/** 「连接正常 · 认证通过 · 响应 312ms · 经由 hk-socks · 发现 6 个模型」 */
export function TestLine({ result, bordered = true }: { result: ProviderTestResult; bordered?: boolean }) {
  const t = useText(connectionSectionText);
  if (!result.ok) {
    return (
      <div className={cn("flex items-start gap-2 motion-fade", bordered && "border-t border-border pt-2.5")}>
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="tw-body font-medium">{t.failed}</span>
          {result.error && <p className="tw-label break-words text-muted-foreground">{coreText(result.error)}</p>}
        </div>
      </div>
    );
  }
  const parts = [
    t.authenticated,
    t.responded(ms(result.latency_ms)),
    result.via ? t.via(result.via) : null,
    describeModelList(result.models),
  ].filter(Boolean);
  return (
    <div className={cn("flex items-center gap-2 motion-fade", bordered && "border-t border-border pt-2.5")}>
      <CircleCheckIcon className="size-4 shrink-0 text-success" />
      <span className="tw-body font-medium">{t.ok}</span>
      <span className="tw-label tw-num text-muted-foreground">{parts.join(" · ")}</span>
    </div>
  );
}
