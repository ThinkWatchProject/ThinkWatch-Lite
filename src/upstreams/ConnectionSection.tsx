import { CircleAlertIcon, CircleCheckIcon, PlugIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import type { Overview, ProviderPreview, ProviderTestResult, ProviderView } from "@/types";
import { connectionSectionText } from "./ConnectionSection.i18n";
import { HeaderEditor, type AuthRow } from "./HeaderEditor";
import {
  AUTH_MODES,
  PROTOCOLS,
  authHeaderParts,
  egressLabel,
  protocolLabel,
  proxyKindLabel,
} from "./labels";
import { FormItem, Note, Segmented } from "./parts";
import { CHATGPT, CUSTOM, PRESETS, ZAI, nameFromUrl, presetById } from "./presets";
import { describeModelList, freeName, type UpstreamForm } from "./upstreamForm";

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
  onChatgptLogin,
  onZaiLogin,
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
  /** 服务类型选了 ChatGPT 账号：那一条走登录，不走这张表单 */
  onChatgptLogin: () => void;
  /** 服务类型选了 Z.ai / BigModel 账号：同样走登录 */
  onZaiLogin: () => void;
}) {
  const t = useText(connectionSectionText);
  const proxies = ov.proxies;
  const taken = ov.providers.map((p) => p.name);
  const autoProtocol = !form.baseUrl.trim()
    ? t.auto
    : preview?.protocol
      ? t.autoDetected(protocolLabel(preview.protocol))
      : t.autoUndetected;

  function pickPreset(id: string) {
    if (id === CHATGPT) {
      onChatgptLogin();
      return;
    }
    if (id === ZAI) {
      onZaiLogin();
      return;
    }
    const prev = presetById(form.preset);
    const next = presetById(id);
    set({
      preset: id,
      // 名称没被手动改过（空的，或者还是上一个预设填的）才跟着换
      name:
        form.name === "" || form.name === freeName(prev.name, taken)
          ? freeName(next.name, taken)
          : form.name,
      baseUrl: next.baseUrl,
      protocol: next.protocol,
      billing: next.billing ?? "per-token",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        {editing ? (
          <FormItem label={t.protocol} htmlFor="up-protocol">
            <ProtocolSelect form={form} set={set} auto={autoProtocol} />
          </FormItem>
        ) : (
          <FormItem label={t.service} htmlFor="up-preset">
            <NativeSelect
              id="up-preset"
              className="w-full"
              value={form.preset}
              onChange={(e) => pickPreset(e.target.value)}
            >
              <NativeSelectOption value="custom">{CUSTOM.label}</NativeSelectOption>
              <NativeSelectOption value={CHATGPT}>{t.chatgpt}</NativeSelectOption>
              <NativeSelectOption value={ZAI}>{t.zai}</NativeSelectOption>
              {PRESETS.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormItem>
        )}
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

      <FormItem
        label={t.baseUrl}
        htmlFor="up-url"
        desc={editing?.base_url_masked && !form.baseUrlTouched ? t.baseUrlMasked : t.baseUrlDesc}
      >
        <Input
          id="up-url"
          className="font-mono"
          value={form.baseUrl}
          placeholder="https://api.example.com"
          onChange={(e) =>
            set({
              baseUrl: e.target.value,
              baseUrlTouched: true,
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
        {!editing && (
          <FormItem label={t.protocol} htmlFor="up-protocol">
            <ProtocolSelect form={form} set={set} auto={autoProtocol} />
          </FormItem>
        )}
        <FormItem label={t.auth}>
          {/* 和旁边的下拉框等高 */}
          <div className="flex h-8 items-center">
            <Segmented
              value={form.authMode}
              options={AUTH_MODES}
              onChange={(authMode) => set({ authMode })}
            />
          </div>
        </FormItem>
      </div>

      {form.authMode === "key" ? (
        <ApiKey form={form} set={set} editing={editing} />
      ) : (
        <OAuth form={form} set={set} />
      )}

      <FormItem label={t.headers} hint={t.headersHint}>
        <HeaderEditor
          form={form}
          set={set}
          auth={authRow(form, editing, preview?.auth_header ?? editing?.auth_header ?? null, {
            unknown: t.authUnknown,
            token: t.renewedToken,
          })}
        />
      </FormItem>

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
            onChange={(e) => set({ onProxyFail: e.target.value })}
          >
            <NativeSelectOption value="fail">{t.failWithError}</NativeSelectOption>
            <NativeSelectOption value="direct">{t.fallBackDirect}</NativeSelectOption>
          </NativeSelect>
        </FormItem>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
            {testing ? <Spinner /> : <PlugIcon />}
            {t.check}
          </Button>
          <Note>{t.checkNote}</Note>
        </div>
        {test && <TestLine result={test} />}
      </div>
    </div>
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
      onChange={(e) => set({ protocol: e.target.value })}
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
  editing: ProviderView | null,
  /** 按选定或识别出的协议，凭据放在哪个请求头里。地址还没填时不知道 */
  header: string | null,
  text: { unknown: string; token: string },
): AuthRow | null {
  const parts = header ? authHeaderParts(header) : null;
  const name = parts?.name ?? null;
  const prefix = parts?.prefix ?? "";
  if (form.authMode === "oauth") {
    return { source: "oauth", name, unknownName: text.unknown, prefix, value: null, placeholder: text.token };
  }
  const key = form.key.trim();
  if (key) {
    // 环境变量引用不是秘密，照写；其余打码，不管多长都是十个点
    const value = key.includes("${") ? key : "●".repeat(10);
    return { source: "key", name, unknownName: text.unknown, prefix, value, placeholder: "" };
  }
  if (form.keySaved && editing?.key) {
    return { source: "key", name, unknownName: text.unknown, prefix, value: editing.key.display, placeholder: "" };
  }
  return null;
}

function ApiKey({
  form,
  set,
  editing,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  editing: ProviderView | null;
}) {
  const t = useText(connectionSectionText);
  return (
    <FormItem label={t.apiKey} htmlFor="up-key">
      <div className="flex items-center gap-2">
        <Input
          id="up-key"
          type={ENV_REF.test(form.key.trim()) ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          value={form.key}
          placeholder={
            form.keySaved
              ? t.keySaved
              : editing?.key
                ? t.keyRemoved
                : t.keyPlaceholder
          }
          onChange={(e) => set({ key: e.target.value })}
        />
        {form.keySaved && form.key.trim() === "" && (
          <Button variant="outline" onClick={() => set({ keySaved: false })}>
            {t.remove}
          </Button>
        )}
      </div>
    </FormItem>
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
  // 已保存的 OAuth 凭据整份沿用：Refresh Token 与 Client Secret 不回显，点「更换」重新填写
  if (form.oauthSaved) {
    return (
      <FormItem label={t.tokenEndpoint} desc={t.oauthSaved}>
        <div className="flex items-center gap-2">
          <Input readOnly value={form.oauthEndpoint} className="font-mono text-muted-foreground" />
          <Button
            variant="outline"
            onClick={() =>
              set({ oauthSaved: false, oauthRefresh: "", oauthClientSecret: "", oauthAccess: "" })
            }
          >
            {t.replace}
          </Button>
        </div>
      </FormItem>
    );
  }
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
        <Input
          id="up-refresh"
          type="password"
          autoComplete="off"
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
        <Input
          id="up-client-secret"
          type="password"
          autoComplete="off"
          className="font-mono"
          value={form.oauthClientSecret}
          onChange={(e) => set({ oauthClientSecret: e.target.value })}
        />
      </FormItem>
      <FormItem
        label={t.accessToken}
        htmlFor="up-access"
        className="col-span-2"
        desc={t.accessTokenDesc}
      >
        <Input
          id="up-access"
          type="password"
          autoComplete="off"
          className="font-mono"
          value={form.oauthAccess}
          onChange={(e) => set({ oauthAccess: e.target.value })}
        />
      </FormItem>
    </div>
  );
}

/** 「连接正常 · 认证通过 · 响应 312 ms · 经由 hk-socks · 发现 6 个模型」 */
export function TestLine({ result }: { result: ProviderTestResult }) {
  const t = useText(connectionSectionText);
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 border-t border-border pt-2.5">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="tw-body font-medium">{t.failed}</span>
          {result.error && <Note>{result.error}</Note>}
        </div>
      </div>
    );
  }
  const parts = [
    t.authenticated,
    t.responded(result.latency_ms),
    result.via ? t.via(result.via) : null,
    describeModelList(result.models),
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2 border-t border-border pt-2.5">
      <CircleCheckIcon className="size-4 shrink-0 text-success" />
      <span className="tw-body font-medium">{t.ok}</span>
      <span className="tw-label tabular-nums text-muted-foreground">{parts.join(" · ")}</span>
    </div>
  );
}
