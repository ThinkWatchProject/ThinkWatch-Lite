import { CircleAlertIcon, CircleCheckIcon, PlugIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Spinner } from "@/ui/spinner";
import type { Overview, ProviderPreview, ProviderTestResult, ProviderView } from "@/types";
import { HeaderEditor } from "./HeaderEditor";
import { AUTH_MODES, PROTOCOLS, authHeaderLabel, protocolLabel, proxyKindLabel } from "./labels";
import { FormItem, Note, Segmented } from "./parts";
import { CHATGPT, PRESETS, nameFromUrl, presetById } from "./presets";
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
}) {
  const proxies = ov.proxies ?? [];
  const taken = ov.providers.map((p) => p.name);
  const autoProtocol = !form.baseUrl.trim()
    ? "自动识别"
    : preview?.protocol
      ? `自动识别（${protocolLabel(preview.protocol)}）`
      : "自动识别（未识别，按原格式转发）";

  function pickPreset(id: string) {
    if (id === CHATGPT) {
      onChatgptLogin();
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
      billing: next.billing ?? "",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        {editing ? (
          <FormItem label="接口协议" htmlFor="up-protocol">
            <ProtocolSelect form={form} set={set} auto={autoProtocol} />
          </FormItem>
        ) : (
          <FormItem label="服务类型" htmlFor="up-preset">
            <NativeSelect
              id="up-preset"
              className="w-full"
              value={form.preset}
              onChange={(e) => pickPreset(e.target.value)}
            >
              <NativeSelectOption value="custom">自定义</NativeSelectOption>
              <NativeSelectOption value={CHATGPT}>ChatGPT 账号（登录）</NativeSelectOption>
              {PRESETS.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormItem>
        )}
        <FormItem label="名称" htmlFor="up-name">
          <Input
            id="up-name"
            className="font-mono"
            value={form.name}
            placeholder={nameFromUrl(form.baseUrl) || "例如 relay-hk"}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FormItem>
      </div>

      <FormItem
        label="接口地址"
        htmlFor="up-url"
        desc={
          editing?.base_url_masked && !form.baseUrlTouched
            ? "地址中的凭据部分已隐去。修改地址时请填写完整地址。"
            : "不含 /v1 等路径前缀，网关按客户端请求的路径转发。"
        }
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
          <FormItem label="接口协议" htmlFor="up-protocol">
            <ProtocolSelect form={form} set={set} auto={autoProtocol} />
          </FormItem>
        )}
        <FormItem label="认证方式">
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
        <ApiKey form={form} set={set} editing={editing} authHeader={preview?.auth_header ?? null} />
      ) : (
        <OAuth form={form} set={set} />
      )}

      <FormItem
        label="请求头"
        desc={
          form.authMode === "oauth"
            ? "随每个请求发送。值中可使用 ${变量名} 引用环境变量，{{client}} 代入网关密钥名称，{{access_token}} 代入当前 Access Token。"
            : "随每个请求发送。值中可使用 ${变量名} 引用环境变量，{{client}} 代入网关密钥名称。"
        }
      >
        <HeaderEditor form={form} set={set} />
      </FormItem>

      <div className="grid grid-cols-2 gap-4">
        <FormItem label="出站代理" htmlFor="up-proxy">
          <NativeSelect
            id="up-proxy"
            className="w-full"
            value={form.proxy}
            onChange={(e) =>
              e.target.value === NEW_PROXY ? onNewProxy() : set({ proxy: e.target.value })
            }
          >
            <NativeSelectOption value="direct">直连</NativeSelectOption>
            <NativeSelectOption value="system">系统代理</NativeSelectOption>
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
            <NativeSelectOption value={NEW_PROXY}>新建代理…</NativeSelectOption>
          </NativeSelect>
        </FormItem>
        <FormItem label="代理不可用时" htmlFor="up-proxy-fail">
          <NativeSelect
            id="up-proxy-fail"
            className="w-full"
            value={form.onProxyFail}
            disabled={form.proxy === "direct"}
            onChange={(e) => set({ onProxyFail: e.target.value })}
          >
            <NativeSelectOption value="fail">返回错误</NativeSelectOption>
            <NativeSelectOption value="direct">改为直连</NativeSelectOption>
          </NativeSelect>
        </FormItem>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
            {testing ? <Spinner /> : <PlugIcon />}
            检测连接
          </Button>
          <Note>验证地址与凭据，并获取模型列表。不产生费用。</Note>
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

function ApiKey({
  form,
  set,
  editing,
  authHeader,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  editing: ProviderView | null;
  /** 按选定或识别出的协议，密钥放在哪个请求头里。地址还没填时不知道 */
  authHeader: string | null;
}) {
  const env = "可使用 ${变量名} 引用环境变量。";
  return (
    <FormItem
      label="API 密钥"
      htmlFor="up-key"
      desc={authHeader ? `通过 ${authHeaderLabel(authHeader)} 请求头发送。${env}` : env}
    >
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
              ? "已保存，留空即保持不变"
              : editing?.key
                ? "保存后将移除原密钥"
                : undefined
          }
          onChange={(e) => set({ key: e.target.value })}
        />
        {form.keySaved && form.key.trim() === "" && (
          <Button variant="outline" onClick={() => set({ keySaved: false })}>
            移除
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
  // 已保存的 OAuth 凭据整份沿用：Refresh Token 与 Client Secret 不回显，点「更换」重新填写
  if (form.oauthSaved) {
    return (
      <FormItem label="Token 端点" desc="凭据不回显。更换后原凭据将被替换。">
        <div className="flex items-center gap-2">
          <Input readOnly value={form.oauthEndpoint} className="font-mono text-muted-foreground" />
          <Button
            variant="outline"
            onClick={() =>
              set({ oauthSaved: false, oauthRefresh: "", oauthClientSecret: "", oauthAccess: "" })
            }
          >
            更换
          </Button>
        </div>
      </FormItem>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormItem label="Token 端点" htmlFor="up-endpoint">
        <Input
          id="up-endpoint"
          className="font-mono"
          placeholder="https://auth.example.com/oauth/token"
          value={form.oauthEndpoint}
          onChange={(e) => set({ oauthEndpoint: e.target.value })}
        />
      </FormItem>
      <FormItem label="Refresh Token" htmlFor="up-refresh">
        <Input
          id="up-refresh"
          type="password"
          autoComplete="off"
          className="font-mono"
          value={form.oauthRefresh}
          onChange={(e) => set({ oauthRefresh: e.target.value })}
        />
      </FormItem>
      <FormItem label="Client ID（可选）" htmlFor="up-client-id">
        <Input
          id="up-client-id"
          className="font-mono"
          value={form.oauthClientId}
          onChange={(e) => set({ oauthClientId: e.target.value })}
        />
      </FormItem>
      <FormItem label="Client Secret（可选）" htmlFor="up-client-secret">
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
        label="Access Token（检测用，可选）"
        htmlFor="up-access"
        className="col-span-2"
        desc="保存前检测连接需要现有的 Access Token；保存后网关使用 Refresh Token 自动换发。"
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
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 border-t border-border pt-2.5">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="tw-body font-medium">连接失败</span>
          {result.error && <Note>{result.error}</Note>}
        </div>
      </div>
    );
  }
  const parts = [
    "认证通过",
    `响应 ${result.latency_ms.toLocaleString()} ms`,
    result.via ? `经由 ${result.via}` : null,
    describeModelList(result.models),
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2 border-t border-border pt-2.5">
      <CircleCheckIcon className="size-4 shrink-0 text-success" />
      <span className="tw-body font-medium">连接正常</span>
      <span className="tw-label tabular-nums text-muted-foreground">{parts.join(" · ")}</span>
    </div>
  );
}
