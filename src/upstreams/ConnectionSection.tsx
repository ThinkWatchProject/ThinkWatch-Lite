import { useState, type ReactNode } from "react";
import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, PlugIcon } from "lucide-react";
import { Button, DISCLOSURE } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { SecretInput } from "@/ui/secret-input";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { ms } from "@/format";
import { useText } from "@/i18n";
import type { Overview, Protocol, ProviderPreview, ProviderTestResult, ProviderView, ZaiFamily } from "@/types";
import { AccountKeyPanel } from "./AccountPanel";
import { connectionSectionText } from "./ConnectionSection.i18n";
import { balanceBrief } from "./balance";
import { useSystemProxyLabel } from "@/connection/Remote";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import { HeaderEditor, type AuthRow } from "./HeaderEditor";
import {
  BEDROCK_REGIONS,
  PROTOCOLS,
  authHeaderParts,
  authModeLabel,
  bedrockRegionOf,
  bedrockUrl,
  coreText,
  egressLabel,
  protocolLabel,
  proxyKindLabel,
} from "./labels";
import { FormItem, Note, SummaryRow } from "./parts";
import { nameFromUrl, presetById, type AuthMode } from "./presets";
import {
  advancedNonDefault,
  authModeOf,
  concurrencyOf,
  describeModelList,
  fieldRules,
  freeName,
  isBedrock,
  oauthKept,
  type FieldRules,
  type UpstreamForm,
} from "./upstreamForm";

/** 「新建代理…」在下拉里的占位值。名称首尾不能有空白，不会和真实名称重复 */
const NEW_PROXY = " new-proxy";

/**
 * 认证方式：各段等宽。**只在这种服务真有几种时出现**（见 `authOptions`）：OpenAI 是 API
 * 密钥和 ChatGPT 账号，Z.ai / BigModel 是 API 密钥和账号登录（和站点并排、各占一半），
 * Bedrock 是它那三种，自定义是 API 密钥和 OAuth。登录进行中和登录之后不能再换
 */
export function AuthField({
  form,
  options,
  onChange,
  disabled,
}: {
  form: UpstreamForm;
  options: AuthMode[];
  onChange: (mode: AuthMode) => void;
  disabled?: boolean;
}) {
  const t = useText(connectionSectionText);
  return (
    <FormItem label={t.auth}>
      <Segmented
        block
        label={t.auth}
        value={authModeOf(form)}
        options={options.map((id) => ({ id, label: authModeLabel(id, form.preset) }))}
        onChange={onChange}
        disabled={disabled}
      />
    </FormItem>
  );
}

/**
 * Z.ai / BigModel 的站点：BigModel（中国大陆）在前、默认选它。同一个服务的两个站点，账号和
 * 密钥不通用：API 密钥按它定地址，账号登录按它登哪一边
 */
export function SiteField({
  value,
  onChange,
  disabled,
}: {
  value: ZaiFamily;
  onChange: (family: ZaiFamily) => void;
  disabled?: boolean;
}) {
  const t = useText(connectionSectionText);
  return (
    <FormItem label={t.site}>
      <Segmented
        block
        label={t.site}
        value={value}
        options={[
          { id: "bigmodel" as ZaiFamily, label: t.siteBigmodel },
          { id: "zai" as ZaiFamily, label: t.siteZai },
        ]}
        onChange={onChange}
        disabled={disabled}
      />
    </FormItem>
  );
}

/**
 * 编辑 Z.ai / BigModel 上游时的账号登录：登录哪一边、密钥是不是登录换来的、打开重新登录的
 * 对话框（`AccountKeyPanel`）
 */
export interface ZaiAccount {
  family: ZaiFamily;
  signedIn: boolean;
  onSignIn: () => void;
}

/**
 * 连接：名称和出站代理一行，地址和协议一行（协议只在有得选时出现），凭据，最后是收起的
 * 「高级设置」（请求头、转发客户端身份、代理不可用时、并发上限）。新建和编辑是同一张表单；
 * 新建时第一步选的服务类型已经定了的几项（地址、协议、要不要密钥）不再问，见 `presets.ts`。
 *
 * 认证方式那一行和 Z.ai 的站点在这一节上面（`AuthField`、`SiteField`），新建时登录账号
 * 这一节整个让位给登录那一块；编辑 Z.ai / BigModel 上游时账号登录只占密钥那一栏的位置。
 *
 * **「检测连接」只在编辑时是一个按钮**，在对话框底部左边（`CheckButton`）：新建时点「下一步」
 * 就检测，通过了结果在「模型」一步顶上，没通过时对话框底部说原因（见 `UpstreamDialog`）。
 */
export function ConnectionSection({
  form,
  set,
  editing,
  ov,
  preview,
  onNewProxy,
  account,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  /** 编辑时是原来那一家 */
  editing: ProviderView | null;
  ov: Overview;
  preview: ProviderPreview | null;
  onNewProxy: () => void;
  /** 编辑 Z.ai / BigModel 上游、它在能登录的那一边时有；认证方式是账号登录时显示 */
  account?: ZaiAccount;
}) {
  const t = useText(connectionSectionText);
  // 连着远程 core 时 `${变量名}` 取的是服务器上 core 进程的环境
  const rt = useText(remoteText);
  const remote = useRemote();
  const taken = ov.providers.map((p) => p.name);
  /** 密钥显示与否：输入框和请求头第一行是同一个值，跟着同一个开关 */
  const [showKey, setShowKey] = useState(false);
  /** 第一步选的服务类型。编辑时是认出来的那一种 */
  const preset = presetById(form.preset);
  /** 显示哪几项：这种服务定了的不问，写着的不藏 */
  const rules = fieldRules(form);
  const bedrock = isBedrock(form);
  const mode = authModeOf(form);
  /** 标准 Bedrock 地址里的区域；别的地址是 null */
  const region = bedrockRegionOf(form.baseUrl.trim());
  const autoProtocol = !form.baseUrl.trim()
    ? t.auto
    : preview?.protocol
      ? t.autoDetected(protocolLabel(preview.protocol))
      : t.autoUndetected;
  // 标准地址按区域生成；VPC 端点、代理这些地址，签名用的区域另写。只用 API 密钥时
  // 不签名，非标准地址也就用不着区域
  const showRegion = bedrock && (region !== null || mode !== "key");

  /*
    地址、协议、区域排成一行：地址占两份，协议、区域各占一份。地址由这一格定了的（Z.ai
    按站点）不显示，剩下的各占一半
  */
  const addr: { key: string; node: ReactNode }[] = [];
  if (rules.url) {
    addr.push({
      key: "url",
      node: (
        <FormItem label={t.baseUrl} htmlFor="up-url">
          <Input
            id="up-url"
            className="font-mono"
            value={form.baseUrl}
            placeholder={preset.id === "thinkwatch" ? "https://gateway.example.com" : "https://api.example.com"}
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
      ),
    });
  }
  // 协议只在真有得选时给选：只说一种接口的服务，选了那一格就定了
  if (rules.protocols) {
    addr.push({
      key: "protocol",
      node: (
        <FormItem label={t.protocol} htmlFor="up-protocol">
          <ProtocolSelect form={form} set={set} options={rules.protocols} auto={autoProtocol} />
        </FormItem>
      ),
    });
  }
  if (showRegion) {
    addr.push({
      key: "region",
      node: (
        <FormItem label={t.region} htmlFor="up-region" desc={region === null ? t.signingRegionDesc : undefined}>
          <RegionSelect
            value={region ?? form.awsRegion.trim()}
            onChange={(r) => (region !== null ? set({ baseUrl: bedrockUrl(r) }) : set({ awsRegion: r }))}
          />
        </FormItem>
      ),
    });
  }
  const addrColumns = rules.url
    ? addr.map((c) => (c.key === "url" ? "minmax(0,2fr)" : "minmax(0,1fr)")).join(" ")
    : "repeat(2,minmax(0,1fr))";

  return (
    <div className="flex flex-col gap-3.5">
      {/* 名称和出站代理在每种认证方式下都是这一行：换认证方式时它们不挪地方 */}
      <div className="grid grid-cols-2 gap-4">
        <FormItem label={t.name} htmlFor="up-name">
          <Input
            id="up-name"
            className="font-mono"
            value={form.name}
            placeholder={nameFromUrl(form.baseUrl) || (preset.id === "thinkwatch" ? t.namePlaceholderGateway : t.namePlaceholder)}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FormItem>
        <ProxyField ov={ov} value={form.proxy} onChange={(proxy) => set({ proxy })} onNewProxy={onNewProxy} />
      </div>

      {addr.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: addrColumns }}>
          {addr.map((c) => (
            <div key={c.key} className="min-w-0">
              {c.node}
            </div>
          ))}
        </div>
      )}

      {rules.key && (
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
      {mode === "account" && account && <AccountKeyPanel {...account} />}
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

      <AdvancedSettings form={form} set={set} rules={rules}>
        {/* `${变量名}` 在值的占位里说过；连着远程 core 时读的是服务器上的环境，另说一句 */}
        <FormItem label={t.headers} hint={remote ? rt.headersHint : undefined}>
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
      </AdvancedSettings>
    </div>
  );
}

/**
 * 「高级设置」：请求头、转发客户端身份（中转站和自定义才有）、代理不可用时、并发上限。
 *
 * **默认收起**，收起时那一行写着里面有哪几项；有一项不是默认值就自动展开（`advancedNonDefault`）
 * —— 收着的一节里藏着一项在起作用的设置，等于看不见它。展开与否在这一节出现时定，之后由
 * 用户收放
 */
function AdvancedSettings({
  form,
  set,
  rules,
  children,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  rules: FieldRules;
  /** 请求头那一项：它跟着连接一节里密钥的显示开关 */
  children: ReactNode;
}) {
  const t = useText(connectionSectionText);
  const [open, setOpen] = useState(() => advancedNonDefault(form));
  const inside = [t.headers, rules.clientIdentity ? t.clientIdentity : null, t.onProxyFail, t.concurrency].filter(
    (x): x is string => x !== null,
  );
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls="up-advanced"
        onClick={() => setOpen((o) => !o)}
        className={cn("-ml-2 w-fit max-w-full gap-2 px-2", DISCLOSURE)}
      >
        <ChevronRightIcon className={cn("text-muted-foreground motion-bar", open && "rotate-90")} />
        <span className="font-medium">{t.advanced}</span>
        {!open && <span className="truncate font-normal text-muted-foreground">{inside.join(t.listSep)}</span>}
      </Button>
      {/*
        展开时左右两栏：左边请求头，右边转发客户端身份、代理不可用时和并发上限 —— 上下排开
        放不进一屏
      */}
      {open && (
        <div id="up-advanced" className="grid grid-cols-2 items-start gap-x-6 motion-fade">
          <div className="min-w-0">{children}</div>
          <div className="flex min-w-0 flex-col gap-4">
            {/* 只有中转站和自定义的服务会只接受特定客户端；各家官方的接口不看这个 */}
            {rules.clientIdentity && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2.5 tw-body font-medium">
                  <Switch
                    checked={form.forwardClientIdentity}
                    onCheckedChange={(c) => set({ forwardClientIdentity: c === true })}
                  />
                  {t.clientIdentity}
                </label>
                <p className="tw-label text-muted-foreground">{t.clientIdentityDesc}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
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
              <ConcurrencyField form={form} set={set} bare />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 出站代理：直连、系统代理（连着远程 core 时是服务器的）、各个代理，最后一项新建一个。
 * 登录账号那一块也用它：登录本身也经它发出
 */
export function ProxyField({
  ov,
  value,
  onChange,
  onNewProxy,
  disabled,
  desc,
}: {
  ov: Overview;
  value: string;
  onChange: (proxy: string) => void;
  /** 下拉最后一项「新建代理…」。不给就没有这一项（重新登录的对话框里不套一层新建） */
  onNewProxy?: () => void;
  disabled?: boolean;
  desc?: string;
}) {
  const t = useText(connectionSectionText);
  const systemProxy = useSystemProxyLabel(egressLabel("system"));
  const proxies = ov.proxies;
  return (
    <FormItem label={t.proxy} htmlFor="up-proxy" desc={desc}>
      <NativeSelect
        id="up-proxy"
        className="w-full"
        value={value}
        disabled={disabled}
        onChange={(e) => (e.target.value === NEW_PROXY ? onNewProxy?.() : onChange(e.target.value))}
      >
        <NativeSelectOption value="direct">{egressLabel("direct")}</NativeSelectOption>
        <NativeSelectOption value="system">{systemProxy}</NativeSelectOption>
        {proxies.map((x) => (
          <NativeSelectOption key={x.name} value={x.name}>
            {x.name} · {proxyKindLabel(x.kind)} {x.addr}
          </NativeSelectOption>
        ))}
        {value !== "direct" && value !== "system" && !proxies.some((x) => x.name === value) && (
          <NativeSelectOption value={value}>{value}</NativeSelectOption>
        )}
        {onNewProxy && <NativeSelectOption value={NEW_PROXY}>{t.newProxy}</NativeSelectOption>}
      </NativeSelect>
    </FormItem>
  );
}

/**
 * 并发上限：同时最多发给这家几个请求。空着是不限，格子里写着「不限」。**写错了当场标红**，
 * 保存按不下去（`connectionMissing`），不等 core 拒。账号上游的「账号」一节也用它
 */
export function ConcurrencyField({
  form,
  set,
  bare = false,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  /** 不写那句说明（窄的一格里）。写错时照样说 */
  bare?: boolean;
}) {
  const t = useText(connectionSectionText);
  const bad = concurrencyOf(form) === undefined;
  return (
    <FormItem
      label={t.concurrency}
      htmlFor="up-concurrency"
      desc={bad ? <span className="text-destructive">{t.badConcurrency}</span> : bare ? undefined : t.concurrencyDesc}
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

/**
 * 接口协议。`all`：全部，外加自动识别（按地址认，认不出来按客户端发来的格式原样转发）；
 * 给了几种就只在这几种里选（OpenAI 的 Chat Completions 和 Responses）
 */
function ProtocolSelect({
  form,
  set,
  options,
  auto,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  options: Protocol[] | "all";
  auto: string;
}) {
  const list = options === "all" ? PROTOCOLS : PROTOCOLS.filter((p) => options.includes(p.id));
  return (
    <NativeSelect
      id="up-protocol"
      className="w-full"
      value={form.protocol}
      onChange={(e) => set({ protocol: list.find((p) => p.id === e.target.value)?.id ?? "" })}
    >
      {options === "all" && <NativeSelectOption value="">{auto}</NativeSelectOption>}
      {list.map((p) => (
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

/** AWS 访问密钥：三项一行，每一项都可以写 `${变量名}`。会话令牌只有临时凭证才有 */
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
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-4">
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
        <FormItem label={t.sessionToken} htmlFor="up-aws-token">
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
      {remote && <Note>{rt.keyHint}</Note>}
    </div>
  );
}

/**
 * OAuth 凭据，两行：Token 端点和 Refresh Token；Client ID、Client Secret，和检测用的
 * Access Token（凭据没改时检测用网关现有的 token，不要它）
 */
function OAuth({
  form,
  set,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
}) {
  const t = useText(connectionSectionText);
  const access = !oauthKept(form);
  return (
    <div className="flex flex-col gap-3.5">
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
      </div>
      <div className={cn("grid gap-4", access ? "grid-cols-3" : "grid-cols-2")}>
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
        {access && (
          <FormItem label={t.accessToken} htmlFor="up-access">
            <SecretInput
              id="up-access"
              className="font-mono"
              value={form.oauthAccess}
              onChange={(e) => set({ oauthAccess: e.target.value })}
            />
          </FormItem>
        )}
      </div>
    </div>
  );
}

/**
 * 行菜单「检测连接」对话框里的结果：「连接正常 · 认证通过 · 响应 312ms · 经由 hk-socks ·
 * 发现 6 个模型」。
 *
 * 检测时一并读了余额的，下面再一行：从哪儿读的，和上游表那一格写的那几样（`balanceBrief`）。
 * 读取失败时这一行是琥珀色的原因。
 */
export function TestLine({ result }: { result: ProviderTestResult }) {
  const t = useText(connectionSectionText);
  if (!result.ok) {
    return (
      <div className="flex min-w-0 items-start gap-2 motion-fade">
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
  const balance = balanceBrief(result.balance, Date.now());
  return (
    <div className="flex min-w-0 flex-col gap-0.5 motion-fade">
      <div className="flex items-center gap-2">
        <CircleCheckIcon className="size-4 shrink-0 text-success" />
        <span className="shrink-0 tw-body font-medium">{t.ok}</span>
        <span className="tw-label tw-num text-muted-foreground">{parts.join(" · ")}</span>
      </div>
      {/* 和上一行的字对齐：图标 16px 加间距 8px */}
      {balance && (
        <p
          className={cn(
            "pl-6 tw-label tw-num break-words",
            balance.failed ? "text-warning" : "text-muted-foreground",
          )}
        >
          {balance.source} · {balance.text}
        </p>
      )}
    </div>
  );
}

/**
 * 编辑时对话框底部左边的「检测连接」，结果接在右边一行：「✓ 连接正常 · 认证通过 · 响应
 * 312ms · 发现 6 个模型」，没通过是「连接失败」和 core 给的原因。一行放不下的截断，全文
 * （和检测时读到的余额）在悬停里
 */
export function CheckButton({
  testing,
  test,
  onTest,
}: {
  testing: boolean;
  test: ProviderTestResult | null;
  onTest: () => void;
}) {
  const t = useText(connectionSectionText);
  const lines = test ? testLines(test, t) : [];
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <Tip text={t.checkNote}>
        <Button variant="outline" className="shrink-0" onClick={onTest} pending={testing}>
          {!testing && <PlugIcon />}
          {t.check}
        </Button>
      </Tip>
      {testing ? (
        <StatusLabel tone="pending" muted>
          {t.checking}
        </StatusLabel>
      ) : (
        test && (
          <Tip
            text={
              <span className="flex flex-col gap-0.5">
                {lines.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </span>
            }
          >
            <div className="flex min-w-0 items-center gap-2 motion-fade" tabIndex={0}>
              {test.ok ? (
                <CircleCheckIcon className="size-4 shrink-0 text-success" />
              ) : (
                <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
              )}
              <span className="shrink-0 tw-body font-medium">{test.ok ? t.ok : t.failed}</span>
              <span className="truncate tw-label tw-num text-muted-foreground">{lines.slice(1).join(" · ")}</span>
            </div>
          </Tip>
        )
      )}
    </div>
  );
}

/** 检测结果写成几行：结论、细节（或原因）、余额 */
function testLines(r: ProviderTestResult, t: (typeof connectionSectionText)["zh"]): string[] {
  if (!r.ok) return [t.failed, ...(r.error ? [coreText(r.error)] : [])];
  const parts = [t.authenticated, t.responded(ms(r.latency_ms)), r.via ? t.via(r.via) : null, describeModelList(r.models)];
  const balance = balanceBrief(r.balance, Date.now());
  return [
    t.ok,
    parts.filter(Boolean).join(" · "),
    ...(balance ? [`${balance.source} · ${balance.text}`] : []),
  ];
}

/**
 * 新建时「模型」一步顶上的一行：点「下一步」检测通过的结果。「连接正常 · 响应 312ms · 发现
 * 24 个模型」，经由代理时带上代理；检测时读到了余额的，右边写余额（和上游表那一格同一套写法）
 */
export function CheckSummary({ result }: { result: ProviderTestResult }) {
  const t = useText(connectionSectionText);
  const parts = [
    t.responded(ms(result.latency_ms)),
    result.via ? t.via(result.via) : null,
    describeModelList(result.models),
  ].filter(Boolean);
  const balance = balanceBrief(result.balance, Date.now());
  return (
    <SummaryRow>
      <CircleCheckIcon className="size-4 shrink-0 text-success" />
      <span className="shrink-0 tw-body font-medium">{t.ok}</span>
      <span className="min-w-0 truncate tw-body tw-num text-muted-foreground">{parts.join(" · ")}</span>
      {balance && (
        <span
          className={cn(
            "ml-auto min-w-0 shrink truncate pl-3 tw-body tw-num",
            balance.failed ? "text-warning" : "text-muted-foreground",
          )}
        >
          {balance.source} · {balance.text}
        </span>
      )}
    </SummaryRow>
  );
}
