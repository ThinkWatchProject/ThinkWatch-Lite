import { Label } from "@/ui/label";
import { ChevronRightIcon } from "lucide-react";
import { useId, useRef, useEffect, useState, type KeyboardEvent } from "react";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { useLang, useText } from "@/i18n";
import { useRemote } from "@/connection/useRemote";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Checkbox } from "@/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import { TableRow, TableCell } from "@/ui/table";
import { DomainList } from "./DomainList";
import { EnginePicker } from "./EnginePicker";
import { engineName } from "@/webToolsCompat";
import { Segmented } from "@/ui/segmented";
import { SelectField, SelectOption } from "@/ui/select-field";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/ui/dialog";
import { DialogError, FormItem } from "@/upstreams/parts";
import { errorText } from "@/upstreams/labels";
import type { Overview, WebToolsConfig, WebToolsView, WebToolResult, WebToolRequest } from "@/types";
import { webToolsText } from "./WebTools.i18n";
import { domainList, validWebConfig, WEB_LIMITS } from "./webToolsForm";
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
  return <>
    <TableRow>
      <TableCell className="whitespace-normal align-top px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="tw-body font-medium">{t.title}</div>
          {view && <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => { setError(null); setDialog("config"); }}>{t.configure}</Button><Button variant="ghost" size="sm" onClick={() => { setError(null); setDialog("test"); }}>{t.test}</Button></div>}
        </div>
        <p className="mt-1 tw-label text-muted-foreground">{view?.config.mode === "core" ? t.coreHelp : t.upstreamHelp}</p>
        {view?.config.mode === "core" && <p className="mt-1 tw-label text-muted-foreground">{remote ? t.remote(remote.name) : t.local}</p>}
        {!view && <p className="mt-1 tw-label text-muted-foreground">{resource.error ? <>{t.unavailable} <Button variant="ghost" size="sm" onClick={() => void resource.reload()}>{t.retry}</Button></> : t.loading}</p>}
        <DialogError error={dialog ? null : error} />
      </TableCell>
      <TableCell className="align-top py-3 pr-3.5">
        {view && <div className="flex justify-end"><Segmented label={t.title} value={view.config.mode} disabled={busy} options={[{ id: "core", label: t.core }, { id: "upstream", label: t.upstream }]} onChange={(mode) => void save({ ...view.config, mode })} /></div>}
      </TableCell>
    </TableRow>
    <Dialog open={dialog !== null && !!view} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-[640px]" onInteractOutside={(e) => e.preventDefault()}>
        {view && dialog === "config" && <Configuration view={view} overview={overview} busy={busy} error={error} save={save} close={() => setDialog(null)} />}
        {view && dialog === "test" && <Tester view={view} />}
      </DialogContent>
    </Dialog>
  </>;
}

function Configuration({ view, overview, busy, error, save, close }: { view: WebToolsView; overview: Overview; busy: boolean; error: string | null; save: (config: WebToolsConfig, base: string) => Promise<void>; close: () => void }) {
  const t = useText(webToolsText);
  const remote = useRemote();
  const id = useId();
  const [baseVersion] = useState(view.config_version);
  const [config, setConfig] = useState(view.config);
  const [allowed, setAllowed] = useState("");
  const [blocked, setBlocked] = useState("");
  const set = <K extends keyof WebToolsConfig>(key: K, value: WebToolsConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const draft = { ...config, allowed_domains: domainList(config.allowed_domains, allowed), blocked_domains: domainList(config.blocked_domains, blocked) };
  const valid = validWebConfig(draft);
  const numeric = [
    ["max_results", t.maxResults], ["read_pages", t.readPages], ["max_page_chars", t.pageChars], ["timeout_secs", t.timeout],
    ["max_concurrent", t.concurrent], ["interval_ms", t.interval], ["cache_secs", t.cache], ["max_tool_calls", t.toolCalls],
  ] as const;
  return <>
    <DialogHeader><DialogTitle>{t.title}</DialogTitle><DialogDescription>{t.intro}</DialogDescription></DialogHeader>
    <div className="min-h-0 overflow-y-auto"><fieldset disabled={busy} className="grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
      <FormItem label={t.engines} htmlFor={`${id}-engines`}><EnginePicker id={`${id}-engines`} value={config.engines} available={view.available_engines} disabled={busy} onChange={(value) => set("engines", value)} /></FormItem>
      <FormItem label={t.proxy} htmlFor={`${id}-proxy`}><SelectField className="w-full" id={`${id}-proxy`} value={config.proxy} onValueChange={(nextValue) => set("proxy", nextValue)}><SelectOption value="system">{t.system}</SelectOption><SelectOption value="direct">{t.direct}</SelectOption>{overview.proxies.map((p) => <SelectOption key={p.name} value={p.name}>{p.name}</SelectOption>)}</SelectField></FormItem>
      <p className="tw-label text-muted-foreground sm:col-span-2">{t.engineHelp}</p>
      {view.available_engines?.some((engine) => engine.id === "google_docs") && (!config.engines.length || config.engines.includes("google_docs")) && <p className="tw-label text-muted-foreground sm:col-span-2">{t.googleDocsHelp}</p>}
      <LocalePicker id={`${id}-language`} kind="language" value={config.language} detected={view.system_locale.language} disabled={busy} onChange={(value) => set("language", value)} />
      <LocalePicker id={`${id}-region`} kind="region" value={config.region} detected={view.system_locale.region} disabled={busy} onChange={(value) => set("region", value)} />
      <p className="tw-label text-muted-foreground sm:col-span-2">{remote ? t.localeRemote(remote.name) : t.localeLocal} {t.localeHelp}</p>
      <div className="sm:col-span-2"><FormItem label={t.allowed} htmlFor={`${id}-allowed`}><DomainList id={`${id}-allowed`} value={config.allowed_domains} draft={allowed} onDraft={setAllowed} onChange={(value) => set("allowed_domains", value)} /></FormItem><p className="tw-label text-muted-foreground">{t.allowedHelp}</p></div>
      <div className="sm:col-span-2"><FormItem label={t.blocked} htmlFor={`${id}-blocked`}><DomainList id={`${id}-blocked`} value={config.blocked_domains} draft={blocked} onDraft={setBlocked} onChange={(value) => set("blocked_domains", value)} /></FormItem><p className="tw-label text-muted-foreground">{t.blockedHelp}</p></div>
      <p className="tw-label text-muted-foreground sm:col-span-2">{t.domainsHelp}</p>
      {draft.allowed_domains.some((domain) => draft.blocked_domains.includes(domain)) && <p className="tw-label text-warning sm:col-span-2">{t.domainConflict(draft.allowed_domains.filter((domain) => draft.blocked_domains.includes(domain)).join(", "))}</p>}
      {numeric.slice(0, 2).map(([key, label]) => <FormItem key={key} label={label} htmlFor={`${id}-${key}`}><Input id={`${id}-${key}`} type="number" min={WEB_LIMITS[key][0]} max={WEB_LIMITS[key][1]} step={1} value={config[key]} onChange={(e) => set(key, Number(e.target.value))} /></FormItem>)}
      <Collapsible className="border-t border-border sm:col-span-2"><CollapsibleTrigger asChild><Button type="button" variant="ghost" className="group h-9 w-full justify-start gap-2 rounded-none px-0 font-normal hover:bg-transparent aria-expanded:bg-transparent">
        <ChevronRightIcon aria-hidden className="size-3.5 text-muted-foreground transition-transform duration-(--motion-fast) ease-(--motion-ease) group-aria-expanded:rotate-90 motion-reduce:transition-none" />
        <span className="font-medium">{t.advanced}</span>
      </Button></CollapsibleTrigger><CollapsibleContent className="mt-3 grid gap-4 sm:grid-cols-2">
        {numeric.slice(2).map(([key, label]) => <FormItem key={key} label={label} htmlFor={`${id}-${key}`}><Input id={`${id}-${key}`} type="number" min={WEB_LIMITS[key][0]} max={WEB_LIMITS[key][1]} step={1} value={config[key]} onChange={(e) => set(key, Number(e.target.value))} /></FormItem>)}
      </CollapsibleContent></Collapsible>
      <p className="tw-label text-muted-foreground sm:col-span-2">{t.readHelp}</p>
      <Label className="flex items-center gap-2 tw-body sm:col-span-2"><Checkbox checked={config.fallback_to_upstream} onCheckedChange={(value) => set("fallback_to_upstream", value === true)} />{t.fallback}</Label>
      <p className="tw-label text-muted-foreground sm:col-span-2">{t.fallbackHelp}</p>
    </fieldset></div>
    <DialogError error={error ?? (!valid ? t.invalid : null)} />
    <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>{t.cancel}</Button><Button pending={busy} disabled={!valid} onClick={() => void save(draft, baseVersion)}>{t.save}</Button></DialogFooter>
  </>;
}

function LocalePicker({ id, kind, value, detected, disabled, onChange }: { id: string; kind: LocaleKind; value: string; detected: string; disabled: boolean; onChange: (value: string) => void }) {
  const t = useText(webToolsText);
  const lang = useLang();
  const detectedName = localeName(kind, detected, lang);
  const automatic = detectedName ? t.automatic(detectedName) : t.automaticUnknown;
  const options = localeOptions(kind, lang, value, automatic, t.unknownLocale);
  return <FormItem label={kind === "language" ? t.language : t.region} htmlFor={id}>
    <Combobox items={options} value={options.find((option) => option.value === value)} isItemEqualToValue={(option, selected) => option.value === selected.value} disabled={disabled} itemToStringLabel={(option: LocaleOption) => option.label} onValueChange={(option) => { if (option) onChange(option.value); }}>
      <ComboboxInput id={id} disabled={disabled} className="w-full" />
      <ComboboxContent><ComboboxEmpty>{t.noLocaleMatch}</ComboboxEmpty><ComboboxList>{(option: LocaleOption) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
  </FormItem>;
}

function Tester({ view }: { view: WebToolsView }) {
  const id = useId();
  const t = useText(webToolsText);
  const [action, setAction] = useState<WebToolRequest["action"]>("search");
  const [input, setInput] = useState("");
  const [pattern, setPattern] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebToolResult | null>(null);
  const canRun = !busy && !!input.trim() && (action !== "find_in_page" || !!pattern.trim());
  async function run() {
    if (!canRun) return;
    const request: WebToolRequest = action === "search" ? { action, query: input, allowed_domains: [], blocked_domains: [] }
      : action === "open_page" ? { action, url: input, offset: 0 } : { action, url: input, pattern };
    setBusy(true); setError(null); setResult(null);
    try { setResult(await call("TestWebTool", request)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // WebKit 确认输入法候选词时可能先结束 composition，仍需检查 229。
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat) void run();
  }
  return <>
    <DialogHeader><DialogTitle>{t.test} · {t.title}</DialogTitle><DialogDescription>{t.testHelp}</DialogDescription></DialogHeader>
    <Segmented label={t.test} disabled={busy} value={action} options={[{ id: "search", label: t.search }, { id: "open_page", label: t.open }, { id: "find_in_page", label: t.find }]} onChange={(value) => { setAction(value); setResult(null); setError(null); }} />
    <FormItem label={action === "search" ? t.query : t.url} htmlFor={`${id}-input`}><Input id={`${id}-input`} disabled={busy} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onInputKeyDown} /></FormItem>
    {action === "find_in_page" && <FormItem label={t.pattern} htmlFor={`${id}-pattern`}><Input id={`${id}-pattern`} disabled={busy} value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={onInputKeyDown} /></FormItem>}
    <DialogError error={error} />
    {result && <div className="grid min-h-0 gap-3 overflow-y-auto">
      <p className="tw-label text-muted-foreground">{result.cached ? t.cached : t.fetched} · {t.elapsed(result.elapsed_ms)}{result.truncated ? ` · ${t.truncated}` : ""}</p>
      {result.warnings.map((warning, i) => <p key={i} className="tw-label text-muted-foreground">{t.partial}: {errorText(warning)}</p>)}
      {!result.sources.length && <p className="tw-body">{t.noResults}</p>}
      {result.sources.map((source, i) => <article key={`${source.url}-${i}`} className="rounded-md border border-border p-3"><a className="tw-body font-medium break-all underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a><p className="tw-label text-muted-foreground break-all">{source.url}{source.engine ? ` · ${engineName(source.engine, view.available_engines)}` : ""}</p><p className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words tw-body">{source.text}</p></article>)}
    </div>}
    <DialogFooter><Button disabled={!canRun} onClick={() => void run()}>{busy ? t.testing : t.run}</Button></DialogFooter>
  </>;
}
