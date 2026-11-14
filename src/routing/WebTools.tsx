import { useId, useRef, useEffect, useState } from "react";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { useLang, useText } from "@/i18n";
import { useRemote } from "@/connection/useRemote";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Checkbox } from "@/ui/checkbox";
import { Segmented } from "@/ui/segmented";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/ui/dialog";
import { DialogError, FormItem } from "@/upstreams/parts";
import { errorText } from "@/upstreams/labels";
import type { Overview, WebToolsConfig, WebToolsView, WebToolResult, WebToolRequest, SearchEngine } from "@/types";
import { webToolsText } from "./WebTools.i18n";
import { domains, validWebConfig, WEB_LIMITS } from "./webToolsForm";
import { localeName, localeOptions, type LocaleKind, type LocaleOption } from "./webToolsLocale";

export function WebTools({ overview }: { overview: Overview }) {
  const t = useText(webToolsText);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const remote = useRemote();
  const resource = useResource("web-tools", () => call("WebTools", null), { deps: [overview.config_version] });
  const [dialog, setDialog] = useState<"config" | "test" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = resource.data;
  async function save(config: WebToolsConfig, base = view?.config_version) {
    if (!base || !view) return;
    setBusy(true); setError(null);
    try {
      const result = await call("SaveWebTools", { base_version: base, config });
      if (!active.current) return;
      resource.mutate({ ...view, config, config_version: result.version });
      setDialog(null);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <section className="rounded-lg border border-border bg-background p-3.5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><div className="tw-body font-medium">{t.title}</div><p className="mt-1 tw-body text-muted-foreground">{t.intro}</p></div>
      {view && <Segmented label={t.title} value={view.config.mode} disabled={busy} options={[{ id: "core", label: t.core }, { id: "upstream", label: t.upstream }]} onChange={(mode) => void save({ ...view.config, mode })} />}
    </div>
    <p className="mt-2 tw-label text-muted-foreground">{remote ? t.remote(remote.name) : t.local}</p>
    {view ? <>
      <p className="mt-1 tw-label text-muted-foreground">{view.config.mode === "core" ? t.coreHelp : t.upstreamHelp}</p>
      <div className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={() => { setError(null); setDialog("config"); }}>{t.configure}</Button><Button variant="outline" size="sm" onClick={() => { setError(null); setDialog("test"); }}>{t.test}</Button></div>
    </> : <div className="mt-2 tw-body text-muted-foreground">{resource.error ? <>{t.unavailable} <Button variant="ghost" size="sm" onClick={() => void resource.reload()}>{t.retry}</Button></> : t.loading}</div>}
    <DialogError error={dialog ? null : error} />
    <Dialog open={dialog !== null && !!view} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-[640px]" onInteractOutside={(e) => e.preventDefault()}>
        {view && dialog === "config" && <Configuration view={view} overview={overview} busy={busy} error={error} save={save} close={() => setDialog(null)} />}
        {view && dialog === "test" && <Tester />}
      </DialogContent>
    </Dialog>
  </section>;
}

function Configuration({ view, overview, busy, error, save, close }: { view: WebToolsView; overview: Overview; busy: boolean; error: string | null; save: (config: WebToolsConfig, base: string) => Promise<void>; close: () => void }) {
  const t = useText(webToolsText);
  const remote = useRemote();
  const id = useId();
  const [baseVersion] = useState(view.config_version);
  const [config, setConfig] = useState(view.config);
  const [allowed, setAllowed] = useState(config.allowed_domains.join(", "));
  const [blocked, setBlocked] = useState(config.blocked_domains.join(", "));
  const set = <K extends keyof WebToolsConfig>(key: K, value: WebToolsConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const draft = { ...config, allowed_domains: domains(allowed), blocked_domains: domains(blocked) };
  const valid = validWebConfig(draft);
  const numeric = [
    ["max_results", t.maxResults], ["read_pages", t.readPages], ["max_page_chars", t.pageChars], ["timeout_secs", t.timeout],
    ["max_concurrent", t.concurrent], ["interval_ms", t.interval], ["cache_secs", t.cache], ["max_tool_calls", t.toolCalls],
  ] as const;
  return <>
    <DialogHeader><DialogTitle>{t.title}</DialogTitle><DialogDescription>{t.intro}</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="grid min-h-0 min-w-0 gap-4 overflow-y-auto border-0 p-0 sm:grid-cols-2">
      <FormItem label={t.engines} htmlFor={`${id}-engines`}><NativeSelect id={`${id}-engines`} value={config.engines.join(",")} onChange={(e) => set("engines", e.target.value ? e.target.value.split(",") as SearchEngine[] : [])}>
        <NativeSelectOption value="">{t.auto}</NativeSelectOption><NativeSelectOption value="bing,duckduckgo">{t.bingFirst}</NativeSelectOption><NativeSelectOption value="duckduckgo,bing">{t.duckFirst}</NativeSelectOption><NativeSelectOption value="bing">Bing</NativeSelectOption><NativeSelectOption value="duckduckgo">DuckDuckGo</NativeSelectOption>
      </NativeSelect></FormItem>
      <FormItem label={t.proxy} htmlFor={`${id}-proxy`}><NativeSelect id={`${id}-proxy`} value={config.proxy} onChange={(e) => set("proxy", e.target.value)}><NativeSelectOption value="system">{t.system}</NativeSelectOption><NativeSelectOption value="direct">{t.direct}</NativeSelectOption>{overview.proxies.map((p) => <NativeSelectOption key={p.name} value={p.name}>{p.name}</NativeSelectOption>)}</NativeSelect></FormItem>
      <LocalePicker id={`${id}-language`} kind="language" value={config.language} detected={view.system_locale.language} disabled={busy} onChange={(value) => set("language", value)} />
      <LocalePicker id={`${id}-region`} kind="region" value={config.region} detected={view.system_locale.region} disabled={busy} onChange={(value) => set("region", value)} />
      <p className="tw-label text-muted-foreground sm:col-span-2">{remote ? t.localeRemote(remote.name) : t.localeLocal} {t.localeHelp}</p>
      <FormItem label={t.allowed} htmlFor={`${id}-allowed`}><Input id={`${id}-allowed`} value={allowed} onChange={(e) => setAllowed(e.target.value)} /></FormItem>
      <FormItem label={t.blocked} htmlFor={`${id}-blocked`}><Input id={`${id}-blocked`} value={blocked} onChange={(e) => setBlocked(e.target.value)} /></FormItem>
      <p className="tw-label text-muted-foreground sm:col-span-2">{t.domainsHelp}</p>
      {numeric.slice(0, 2).map(([key, label]) => <FormItem key={key} label={label} htmlFor={`${id}-${key}`}><Input id={`${id}-${key}`} type="number" min={WEB_LIMITS[key][0]} max={WEB_LIMITS[key][1]} step={1} value={config[key]} onChange={(e) => set(key, Number(e.target.value))} /></FormItem>)}
      <details className="sm:col-span-2"><summary className="cursor-pointer tw-body font-medium">{t.advanced}</summary><div className="mt-3 grid gap-4 sm:grid-cols-2">
        {numeric.slice(2).map(([key, label]) => <FormItem key={key} label={label} htmlFor={`${id}-${key}`}><Input id={`${id}-${key}`} type="number" min={WEB_LIMITS[key][0]} max={WEB_LIMITS[key][1]} step={1} value={config[key]} onChange={(e) => set(key, Number(e.target.value))} /></FormItem>)}
      </div></details>
      <p className="tw-label text-muted-foreground sm:col-span-2">{t.readHelp}</p>
      <label className="flex items-center gap-2 tw-body sm:col-span-2"><Checkbox checked={config.fallback_to_upstream} onCheckedChange={(value) => set("fallback_to_upstream", value === true)} />{t.fallback}</label>
      <p className="tw-label text-muted-foreground sm:col-span-2">{t.fallbackHelp}</p>
    </fieldset>
    <DialogError error={error ?? (!valid ? t.invalid : null)} />
    <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>{t.cancel}</Button><Button disabled={busy || !valid} onClick={() => void save(draft, baseVersion)}>{t.save}</Button></DialogFooter>
  </>;
}

function LocalePicker({ id, kind, value, detected, disabled, onChange }: { id: string; kind: LocaleKind; value: string; detected: string; disabled: boolean; onChange: (value: string) => void }) {
  const t = useText(webToolsText);
  const lang = useLang();
  const detectedName = localeName(kind, detected, lang);
  const automatic = detectedName ? t.automatic(detectedName) : t.automaticUnknown;
  const options = localeOptions(kind, lang, value, automatic, t.unknownLocale);
  return <FormItem label={kind === "language" ? t.language : t.region} htmlFor={id}>
    <Combobox items={options} value={options.find((option) => option.value === value)} disabled={disabled} itemToStringLabel={(option: LocaleOption) => option.label} onValueChange={(option) => { if (option) onChange(option.value); }}>
      <ComboboxInput id={id} disabled={disabled} className="w-full" />
      <ComboboxContent><ComboboxEmpty>{t.noLocaleMatch}</ComboboxEmpty><ComboboxList>{(option: LocaleOption) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
  </FormItem>;
}

function Tester() {
  const id = useId();
  const t = useText(webToolsText);
  const [action, setAction] = useState<WebToolRequest["action"]>("search");
  const [input, setInput] = useState("");
  const [pattern, setPattern] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebToolResult | null>(null);
  async function run() {
    const request: WebToolRequest = action === "search" ? { action, query: input, allowed_domains: [], blocked_domains: [] }
      : action === "open_page" ? { action, url: input, offset: 0 } : { action, url: input, pattern };
    setBusy(true); setError(null); setResult(null);
    try { setResult(await call("TestWebTool", request)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <>
    <DialogHeader><DialogTitle>{t.test} · {t.title}</DialogTitle><DialogDescription>{t.testHelp}</DialogDescription></DialogHeader>
    <Segmented label={t.test} disabled={busy} value={action} options={[{ id: "search", label: t.search }, { id: "open_page", label: t.open }, { id: "find_in_page", label: t.find }]} onChange={(value) => { setAction(value); setResult(null); setError(null); }} />
    <FormItem label={action === "search" ? t.query : t.url} htmlFor={`${id}-input`}><Input id={`${id}-input`} disabled={busy} value={input} onChange={(e) => setInput(e.target.value)} /></FormItem>
    {action === "find_in_page" && <FormItem label={t.pattern} htmlFor={`${id}-pattern`}><Input id={`${id}-pattern`} disabled={busy} value={pattern} onChange={(e) => setPattern(e.target.value)} /></FormItem>}
    <DialogError error={error} />
    {result && <div className="grid min-h-0 gap-3 overflow-y-auto">
      <p className="tw-label text-muted-foreground">{result.cached ? t.cached : t.fetched} · {t.elapsed(result.elapsed_ms)}{result.truncated ? ` · ${t.truncated}` : ""}</p>
      {result.warnings.map((warning, i) => <p key={i} className="tw-label text-muted-foreground">{t.partial}: {errorText(warning)}</p>)}
      {!result.sources.length && <p className="tw-body">{t.noResults}</p>}
      {result.sources.map((source, i) => <article key={`${source.url}-${i}`} className="rounded-md border border-border p-3"><a className="tw-body font-medium break-all underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a><p className="tw-label text-muted-foreground break-all">{source.url}{source.engine ? ` · ${source.engine}` : ""}</p><p className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words tw-body">{source.text}</p></article>)}
    </div>}
    <DialogFooter><Button disabled={busy || !input.trim() || (action === "find_in_page" && !pattern.trim())} onClick={() => void run()}>{busy ? t.testing : t.run}</Button></DialogFooter>
  </>;
}
