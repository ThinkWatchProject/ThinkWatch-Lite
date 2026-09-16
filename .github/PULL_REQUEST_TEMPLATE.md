<!--
Base branch: `dev`, not `main`.

GitHub pre-fills the base with this repo's default branch (`main`), the
release line. Use the "Edit" button next to the title to switch the base
to `dev`; with the CLI, pass `--base dev`.

Before writing: this app ships as an unsigned arm64 build and nothing
else. Gateway behavior (routing, forwarding, cost, redaction) lives in
ThinkWatch Core, not here. See CONTRIBUTING.md.
-->

## What this changes

<!-- One or two sentences. What is different on screen, or in behavior? -->

## Why

<!-- The problem, not the patch. -->

## How it was verified

<!--
What you ran and what it showed. For UI changes, say what you actually
looked at — "the empty state now links to the Clients page, checked with
zero providers configured" beats "tested manually".
-->
