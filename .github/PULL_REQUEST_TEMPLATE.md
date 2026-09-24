<!--
Base branch: `dev`, not `main`.

GitHub pre-fills the base with this repo's default branch (`main`), the
release line. Use the "Edit" button next to the title to switch the base
to `dev`; with the CLI, pass `--base dev`.

Before writing: every release ships an arm64 disk image for macOS, x64
and arm64 installers for Windows, and x86_64 and aarch64 AppImages for
Linux. The macOS build is Apple Silicon only and not signed by Apple,
the Windows installers are not code-signed, and Linux gets the AppImage
and nothing else. Gateway behavior (routing, forwarding, cost,
redaction) lives in ThinkWatch Core, not here. See CONTRIBUTING.md.
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
