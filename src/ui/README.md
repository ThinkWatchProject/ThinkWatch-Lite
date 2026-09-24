# ThinkWatch Lite UI kit

The rules every page follows. Read it top to bottom once; after that, use it as a
checklist. When a rule here and an older pattern in a page disagree, the rule wins —
migrate the page.

The look is deliberately restrained: **black, white and grey**. There is no brand or
accent colour. Colour appears only to say something about state (ok / warning / error)
and in data visualisation (`--chart-*`, `--cache-*`). The premium feel comes from the
material (translucent sidebar on macOS), consistent hierarchy, motion and complete
states — not from decoration.

House rules that also apply (from the product owner, binding):

- UI copy is written, declarative Chinese: no 你/我, amounts are 费用, titles are not
  questions. Every visible string lives in a `*.i18n.ts(x)` file with `zh` and `en`
  (`src/i18n.test.ts` fails otherwise). Strings that come from core are fixed in core.
- The UI never explains internal mechanics (intervals, data sources, why). One line of
  state, not a paragraph of reasons.
- Pick-one-of-several is always `Segmented` (`@/ui/segmented`), never a row of buttons
  or radio dots. On/off is `Switch`; multi-select is `Toggle`.
- Everything in one toolbar row is **28px**: `Segmented`, `Button size="sm"`,
  `Toggle size="sm"`, `NativeSelect size="sm"`, `Input variant="sm"`, `InputGroup
  className="h-7"`. Form fields in dialogs use the default 32px.
- Config objects (upstreams, proxies, keys, routes…) are created and edited in dialogs,
  never inline on the page.
- One icon = one meaning. `×` only closes. Item actions are written as words.
- Settings that write `config.yaml` use an explicit Save / Discard (`settings/form.tsx`).
- If the UI lacks data, the fix belongs in core. Do not fabricate or estimate numbers in
  the UI; degrade gracefully (hide the figure, or show `—`) and note the needed core change.

---

## Layout

Every page renders exactly this shape:

```tsx
import { Page, PageHeader, PageSection, SummaryItem } from "@/ui/page";

export default function KeysPage() {
  const t = useText(keysText);
  return (
    <Page width="wide">
      <PageHeader
        title={t.title}                       // same word as the sidebar item
        summary={<>
          <SummaryItem value={keys.length} label={t.keysUnit} />
          <SummaryItem lead={<StatusDot tone="idle" />} value={disabled} label={t.disabled} />
        </>}
        actions={<>
          <Button size="sm" variant="outline" onClick={adopt}>{t.adopt}</Button>
          <Button size="sm" onClick={create}><PlusIcon />{t.create}</Button>
        </>}
      />
      <KeysTable … />
    </Page>
  );
}
```

- **`Page`** (`@/ui/page`) sets the gutters (20px sides, 32px bottom) and the max width,
  centred on wide windows:
  - `width="full"` — no cap. Dense, many-column tables (Traffic).
  - `width="wide"` (default) — 1200px. Normal table pages, Overview.
  - `width="narrow"` — 760px. Forms, Settings, single-message pages (Unlinked).
  At the default 1100×720 window the content area is ~900px, so all three look the same;
  they only diverge when the user widens the window.
- The shell owns scrolling: each page is mounted inside its own `overflow-y-auto`
  container (Traffic scrolls itself). Do not add another scroll container around the
  whole page; inner scroll areas (a long list in a dialog) are fine.
- **`PageHeader`**: `title` (tw-title), one-line `summary` (numbers and status only,
  no explanations), `actions` on the right (`size="sm"`; at most one `default`-variant
  primary button, placed last), optional `tabs` (a `TabsList`; the header then draws a
  divider under it).
- **Page-level tabs** go in the header's `tabs` slot as a `variant="line"` list (the
  underline sits on the header's divider). Wrap the whole `Page` in `Tabs` so the list and
  the panels share state, and give each panel `pt-4`:

  ```tsx
  <Tabs value={tab} onValueChange={setTab}>
    <Page>
      <PageHeader title={t.title} tabs={
        <TabsList variant="line">
          <TabsTrigger value="upstreams">{t.upstreams}<Count n={n} /></TabsTrigger>
          <TabsTrigger value="proxies">{t.proxies}</TabsTrigger>
        </TabsList>
      } />
      <TabsContent value="upstreams" className="pt-4">…</TabsContent>
      <TabsContent value="proxies" className="pt-4">…</TabsContent>
    </Page>
  </Tabs>
  ```
- **The page name is written once.** When a page renders a `PageHeader`, the 38px window
  toolbar hides its page name, and fades a small title back in when the header scrolls out
  of view (macOS behaviour). Pages without a header keep the toolbar title. Do not render
  a second title anywhere.
- **`PageSection`**: a titled block inside the page (tw-head title, optional one-line
  description and actions). Sections are 32px apart; the first one after the header
  is 4px below it.
- Toolbar-level page actions (Config file / Version history) are the shell's; pages do
  not repeat them.

### Spacing scale

Use the Tailwind 4px scale, and only these steps for layout:

| Use | Value |
| --- | --- |
| Inside a control / between an icon and its label | `gap-1.5` (6px) – `gap-2` (8px) |
| Between controls in a toolbar row | `gap-2` (8px) |
| Between a heading and its content | `mb-3` (12px) |
| Between blocks inside a section | `gap-4` (16px) |
| Page gutters | `px-5` (20px) — given by `Page` |
| Between sections | `mt-8` (32px) — given by `PageSection` |

Table rows are 36px (`h-9`), toolbar controls 28px, form fields 32px.

### Type scale

Five levels, named by purpose. Never use `text-xs`/`text-sm`/`text-[12px]` outside
`src/ui` (`copy.test.ts` enforces it).

| Class | Size | Use |
| --- | --- | --- |
| `tw-display` | 34px/600 | The one headline figure on Overview. Nowhere else. |
| `tw-title` | 15px/600 | Page title (`PageHeader`), dialog title. One per screen. |
| `tw-head` | 13px/500 | Section titles, table headers, emphasised labels. |
| `tw-body` | 13px | Body text, table cells. |
| `tw-label` | 11px | Secondary notes, units, timestamps, captions. |

Numbers that line up (amounts, latency, counts) add `tw-num` (tabular figures).
Windows and Linux shift every level up 1px automatically.

---

## Colour

All colours are CSS tokens (`src/index.css`) exposed as Tailwind colours. **Never write
`neutral-*`, `gray-*`, `amber-*`, `red-*`, `emerald-*` or hex values in a page.**

| Token (Tailwind) | Meaning |
| --- | --- |
| `background` / `foreground` | Content background / primary text |
| `muted-foreground` | Secondary text |
| `surface` | A panel one step off the background: code snippets, inline panels, icon tiles |
| `muted`, `accent` | Hover and selected fills inside menus and lists |
| `border` | Table rules, card borders, dividers |
| `input` | Control borders |
| `success` | ok: running, healthy, in effect |
| `warning` | needs attention but works: starting, retrying, degraded, will cost money |
| `destructive` | failed, stopped, unavailable, dangerous action |
| `idle` | not working but not a fault: unused, disabled, no data yet |
| `warning-foreground`, `destructive-foreground`, `success-foreground` | **Text** in that hue on a tinted background (`bg-warning/10`). Not text on a solid fill — that is `text-white`. |
| `chart-1…5`, `chart-other`, `cache-*` | Data visualisation only (`chart-other` is the grey "Other" series) |
| `--chrome-*` | Window chrome (sidebar, toolbar). Shell only. |

Tinted status backgrounds are the status colour at low alpha: `bg-warning/10`,
`bg-destructive/8`, `bg-success/10`, with a border at `/25–/30`.

---

## Status

```tsx
import { StatusDot, StatusLabel } from "@/ui/status-dot";

<StatusDot tone="ok" />                         // 6px dot, colour only
<StatusDot tone="pending" />                    // pulses by default (live)
<StatusLabel tone="error">{t.stopped}</StatusLabel>   // dot + text, same colour
<StatusLabel tone="ok" muted>{t.healthy}</StatusLabel> // grey text, coloured dot — use in columns where most rows are fine
```

Tones: `ok` | `warn` | `error` | `idle` | `pending`. Map every page-specific state to one
of these; do not hand-write `rounded-full bg-emerald-500` dots. Use `pulse` only for
something happening right now (a request in flight, connecting).

---

## State trio: loading, error, empty

**Every place that fetches data shows all three.** Use `useResource` + `Loadable`:

```tsx
import { useResource } from "@/lib/resource";
import { Loadable, TableSkeleton, EmptyState } from "@/ui/states";

const keys = useResource("keys", () => call("Keys", null), { events: ["config_reloaded"] });

<Loadable
  r={keys}
  loading={<TableSkeleton rows={5} cols={5} />}
  isEmpty={(d) => d.length === 0}
  empty={
    <EmptyState
      icon={<IconKey />}
      title={t.noKeys}
      description={t.noKeysHint}
      action={<Button size="sm" onClick={create}>{t.create}</Button>}
    />
  }
>
  {(data) => <KeysTable rows={data} />}
</Loadable>
```

- **Loading**: when the shape is known, a skeleton of that shape (`TableSkeleton`,
  `ListSkeleton`, or `Skeleton` blocks). Otherwise `LoadingState` (appears only after
  180ms, so fast loads do not flash). Never a bare "读取中…" line.
- **Error**: `ErrorState` with the message (`errorText` is applied for you) and a
  Retry button. Never swallow an error and render nothing. A *background refresh* that
  fails while data is shown keeps showing the data (no error UI).
- **Empty**: `EmptyState` — the title says what is missing, the description says how it
  gets there, the action is the button that does it. `variant="outlined"` inside a bounded
  area (a section, a dialog).
- A *filtered* list with no matches is not "empty": say it is filtered and offer "clear
  filters" (see Traffic).

---

## Data: `useResource`

`@/lib/resource`. Stale-while-revalidate with a module-level cache, so switching back to
a page shows the last data instantly and refreshes in the background.

```ts
const r = useResource(key, fetcher, { events?, throttleMs?, deps? });
r.data        // T | undefined
r.error       // last error, until the next success
r.loading     // no data yet and fetching → show a skeleton
r.refreshing  // data shown, background fetch in flight
r.reload()    // fetch now; resolves to the data (or undefined on error)
r.mutate(next | (prev) => next, { revalidate? })  // optimistic update; returns rollback()
```

- `key` names the data, not the request: `"keys"`, `"upstream-models:" + name`. Pass
  `null` to disable. Two components using the same key share one request and one cache.
- `events`: core / local event kinds that make the data stale (throttled 2.5s, like
  `useCoreEvent`). Prefer this over polling — never add `setInterval`.
- `deps`: values that change the answer (config version, a filter). The old data stays
  on screen while the new one loads.
- `invalidate("keys")` / `invalidate("upstream:")` (prefix) from anywhere after a
  mutation that affects another page's data.
- The cache is dropped when the connection switches (`resetResources`, wired in App).

---

## Feedback

```ts
import { notify, undoable, usePending } from "@/ui/notify";
```

- `notify.success(msg)` — only when the result is not visible on screen (saved to disk,
  copied, sent). If the row appears or the switch flips, no toast.
- `notify.error(e, title?)` — every failed action. Pass the caught value; it is
  translated with `errorText`. **Never call `toast` from sonner directly.**
- **Persistent state is a `Banner`, not a toast.** Toasts float away; "config rejected",
  "disconnected", "credentials not written back" must stay until resolved.
- **Reversible actions use `undoable`** (disable/enable a key, remove an item from a list
  that can be restored). No confirmation dialog; optimistic; Undo in the toast:

```ts
await undoable({
  message: t.keyDisabled(name),
  apply: () => keys.mutate((ks) => ks!.map((k) => (k.name === name ? { ...k, disabled: true } : k))),
  do: () => setDisabled(name, true),     // your page's API call
  undo: () => setDisabled(name, false),
  after: () => keys.reload(),
});
```

- Irreversible destructive actions (delete an upstream) keep an `AlertDialog`; its title
  has no question mark.
- **Pending buttons**: every async button shows it is working. `Button` has a `pending`
  prop (spinner, disabled, `aria-busy`, label unchanged so nothing shifts):

```tsx
const [saving, save] = usePending();   // run() catches and notify.error()s for you
<Button pending={saving} onClick={() => save(async () => { await call(…); notify.success(t.saved); })}>
  {t.save}
</Button>
```

- **Pending switches**: `Switch` has `pending` too. Flip the value optimistically, set
  `pending` while the request runs, flip back and `notify.error` on failure.

### Banner

```tsx
import { Banner } from "@/ui/banner";

<Banner show={!!problem} tone="warning" title={t.title} actions={<Button size="sm" variant="outline">…</Button>}>
  {detail}
</Banner>
<Banner layout="inline" tone="info" title={t.noUpstreams} actions={…}>…</Banner>
```

Tones: `info` (grey, tell), `warning` (amber, works but watch out), `error` (red, must
act). `layout="strip"` (default) is a full-width strip under the toolbar or at the top of
a region; `layout="inline"` is a rounded box inside a page, below the `PageHeader`.
Passing `show` animates it in and out; without `show` it is static.

---

## Motion

Intensity is **medium**: things arrive and settle; nothing bounces. 150–250ms, always
ease-out (`--motion-ease`). **Everything honours `prefers-reduced-motion`**: the
utilities below turn off, and shadcn component transitions keep their fade but lose
movement. Do not write your own `@keyframes` or `transition-all` in pages.

| What | How |
| --- | --- |
| Page switch (fade + 4px rise) | Automatic — the shell wraps each page in `motion-page`. |
| Tab content | Automatic — `TabsContent` has `motion-fade`. Other swapped content: `motion-fade`. |
| New row in a list | `usePresentList(items, keyOf)` → `rowMotion(presence)` on the row (`motion-row-in`: slides 3px, background flashes once). Rows present on first load do not animate. |
| Removed row | Same hook: the row stays for 200ms with `motion-row-out` (fade, not clickable). |
| Banner / inline notice appearing | `Banner show` or `<Reveal show>` (height + fade). |
| Numbers that change | `<AnimatedNumber value format scope />` (`@/ui/motion`), built on `useCountUp`. Change `scope` when the meaning changes (time range) so it jumps instead of counting. |
| Bars, meters, progress | `motion-bar` on the element whose width/height changes. |
| Live / in-flight | `<StatusDot tone="pending" />` or `motion-live` on a dot. |
| New data at a live edge | `motion-ping` on a dot (HTML or SVG): one ring, not looping. Re-key the element to play it again. |
| Skeleton shimmer | Built into `Skeleton` (`motion-shimmer`). |
| Hover / press | `transition-colors duration-(--motion-fast)`. |

```tsx
const shown = usePresentList(keys, (k) => k.name);
<TableBody>
  {shown.map(({ item, key, presence }) => (
    <TableRow key={key} className={rowMotion(presence)}>…</TableRow>
  ))}
</TableBody>
```

---

## Logos

`@/ui/logos`. Official vendor and client marks, **monochrome** (`currentColor`), so they
sit in the grey palette. Unknown ones render a letter tile of the same size.

```tsx
<UpstreamLogo name={p.name} baseUrl={p.base_url} protocol={p.protocol} />  // matched by host first, then name
<ClientLogo id="claude-code" name="Claude Code" />
<Logo id="anthropic" size={20} />
```

- 16px in table rows and lists, 20–24px in headers and empty states; `gap-2` to the label.
- Colour: `text-muted-foreground` in tables, `text-foreground` when selected or in a title.
- Covered: Anthropic, Claude, OpenAI/ChatGPT, OpenRouter, DeepSeek, Gemini, Ollama, Z.ai,
  Zhipu, Moonshot, Kimi, Qwen, xAI, Mistral, Groq, Bedrock, Azure; clients Claude Code,
  Claude Desktop, Codex, opencode, Cursor, Gemini CLI, Cline, Zed, Windsurf. VS Code,
  Aider and Continue use the letter tile (no permissive source).
- Sources and licences: `src/ui/logo-data.ts` header and `/NOTICE`. Add new marks only from
  MIT/CC0 sets (Lobe Icons, Simple Icons); never from LGPL projects.

---

## Navigation

`@/nav`. Pages link to each other through the shell:

```ts
const nav = useNav();
nav.open("requests", { filter: { client: key.name } });   // Traffic filtered to a key
nav.open("keys", { key: "claude-code" });                   // Keys, highlight a row
nav.open("security", { focus: { range, at: Date.now() } });

// in the target page:
useNavParams("keys", (p) => setHighlight(p.key ?? null));
```

Add new deep-link parameters to `NavParams` in `src/nav.tsx`. Keyboard: ⌘1…⌘9 follow
the sidebar order (`SURFACES`), ⌘K opens the command palette, ⌘F focuses Traffic search,
⌘, opens Settings, ⌘R refreshes, `?` (outside text fields) shows the shortcut sheet.

**Opening a page's dialog from elsewhere.** A dialog lives in exactly one place, its page.
Other places (the command palette, another page) open it through `NavParams`, and the page
handles the param in `useNavParams` exactly as its own button or row click would:

```ts
nav.open("upstreams", { create: "upstream" });      // or "proxy" / "sheet"
nav.open("upstreams", { edit: "deepseek" });        // = clicking that row
nav.open("upstreams", { test: "speed" });           // or "link"
nav.open("keys", { create: true });   nav.open("keys", { edit: "codex" });
nav.open("routing", { create: "route" });           // or "group"; { editRoute }, { editGroup }, { dryRun: true }
nav.open("clients", { detail: "codex" });           // installed; { setup: id } = manual setup
nav.open("settings", { section: "appearance" });    // the Settings page scrolls there

// in the page, next to its dialog state:
useNavParams("keys", (p) => {
  if (p.edit) setDialog({ kind: "edit", name: p.edit });
  else if (p.create) setDialog({ kind: "edit", name: null });
});
```

Wait for the data a dialog needs before rendering it (an edit dialog opened by a deep link
may mount before its row is loaded). The Settings page handles `section` itself
(`revealSection` finds `data-section="<id>"`, or the heading whose text is the title in
`palette/sections.ts`). When the Settings page is restructured, keep one palette entry per
setting a user would search for and point its `id` at the section that now holds it.

### Command palette and shortcuts

`src/palette/`: ⌘K palette (cmdk via `@/ui/command`) and the `?` shortcut sheet.

- **The palette only navigates.** Every action and search result is a `nav.open(…)` into a
  page (see above) or one of the shell's own actions; it never renders a page's dialog. To
  make a new dialog reachable, add a `NavParams` field, handle it in the page, then add the
  item in `palette/items.tsx` (strings, including search-only aliases in both languages, in
  `palette/palette.i18n.ts`).
- It searches data that is already loaded: the overview (upstreams, keys, routes, groups),
  Traffic's loaded rows (by id or model), connections, Settings sections, and the client
  list (read when the palette opens).
- **Key caps come from `palette/keys.tsx`** (`Keys`, `COMBOS`, `pageCombo`). The palette rows,
  the shortcut sheet and the sidebar tooltips all render from it; the handlers are in
  `App.tsx` (global) and the pages (Traffic's row keys). Change a key in both places.
- Global shortcuts do nothing while a modal dialog is open (`modalOpen()`), so ⌘2 never
  throws away a half-edited form. The request drawer does not count as modal, and neither
  does a dialog marked `data-passive` (the palette and the shortcut sheet: nothing in them
  can be lost, so ⌘4 read off the sheet works).
- Search stays focused: pages, actions and entity **names** score first; aliases (the other
  language, synonyms, a base URL) score lower, and requests match by model or id only, one
  row per model. Add aliases to `palette.i18n.ts` in both languages, never to the title.

---

## Do / Don't

Do:

- Start every page with `Page` + `PageHeader`.
- Fetch with `useResource`; render with `Loadable` (or the three states by hand).
- Use `StatusDot`/`StatusLabel` for every status, `Banner` for every persistent notice.
- Use tokens (`text-muted-foreground`, `bg-surface`, `border-border`, `text-warning`).
- Give every async button `pending`, every failure `notify.error`.
- Keep toolbar rows at 28px.
- Look at your page in light and dark, zh and en, at 1100×720 and 820×560, and with
  empty and failing data (`.claude/preview/full`, `?empty`, `?fail`, `?lang=en`).

Don't:

- Don't write raw `<button>` for actions — use `Button` (`variant="ghost" size="icon-sm"`
  for icon-only; always an `aria-label`).
- Don't hard-code colours (`neutral-*`, `amber-*`, hex) or font sizes (`text-[12px]`).
- Don't show a bare "读取中…" / "Loading…" line, and don't leave a spinner forever if the
  first load fails — show `ErrorState` with Retry.
- Don't swallow errors (`catch {}`) on user actions.
- Don't use `toast` directly; don't use a toast for a state that persists.
- Don't add explanations of how things work to the UI.
- Don't add a second title, a card around the whole page, or a drop shadow on page content.
- Don't animate with JS timers or `transition-all`; don't animate on every data refresh.

Reference implementation: `src/connection/Unlinked.tsx` (Page, StatusLabel, Button
pending with `usePending`) and the shell in `src/App.tsx` (Banner, nav, motion).
