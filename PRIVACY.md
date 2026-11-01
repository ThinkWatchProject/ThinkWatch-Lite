# ThinkWatch Lite Privacy Policy

Last updated: October 31, 2026

**[English](PRIVACY.md) | [中文](PRIVACY.zh-CN.md)**

This policy describes how ThinkWatch Lite and its bundled ThinkWatch Core
gateway handle data. Both projects are fully open source under the MIT license:
[ThinkWatch Lite](https://github.com/ThinkWatchProject/ThinkWatch-Lite) and
[ThinkWatch Core](https://github.com/ThinkWatchProject/ThinkWatch-Core).

## No telemetry

ThinkWatch Lite and its bundled gateway do not send telemetry, usage analytics,
tracking events, or automatic crash reports to ThinkWatch or to third-party
analytics services. The app requires no ThinkWatch account and does not
automatically upload your conversations, code, API credentials, or request
history to the project.

Forwarding an AI request to a provider you configure is part of the gateway's
function, and is described below. It is not a telemetry submission to ThinkWatch.

## AI requests and your choice of destination

You choose which AI clients connect to the gateway and configure the upstream
services that receive their requests. An upstream can be an AI provider, a relay,
a gateway you operate, or a local model. Routing and failover use the upstreams
you configure.

To fulfill a request, the gateway processes and forwards the content your client
sends, which can include prompts, conversation history, code, file content,
images, tool definitions, and tool results. It sends the credentials needed to
authenticate to the configured service. Provider sign-in, token renewal, model
discovery, balance checks, and connection tests also contact the relevant
configured services when used.

Those services receive the requests sent to them and handle that data under
their own terms and privacy policies. Configuring a third-party service means
that service can see the content it receives; running a local gateway does not
make the upstream's processing local. You can stop forwarding by disconnecting
or restoring your clients, disabling the relevant upstreams, or stopping the
gateway.

## Sensitive information redaction

The gateway provides local **Secrets & privacy** protection to help reduce the
sensitive information disclosed to an upstream. When enabled with replacement
rules, it replaces matching credentials and personal information in outgoing
request text with placeholders before sending the request. Matching placeholders
in the response are restored locally. Built-in rules and custom rules determine
what is matched.

**The default mode is Monitor:** it records matches without replacing them.
To redact outgoing content, turn the protection on and set the relevant rules to
replace matches. Rules set to record only still leave their matches unchanged.
Redaction cannot guarantee detection of every secret, does not remove credentials
required to authenticate to the upstream, and does not encrypt local files or
guarantee that request history is free of sensitive content.

## Data stored on your computer

In the normal local setup, the app keeps configuration, API keys and sign-in
credentials, client configuration backups, preferences, request and response
content, usage and cost records, and security logs on your computer. This data
supports routing, request inspection, cost accounting, restoration, and
troubleshooting.

The default data locations are:

- macOS and Linux: `~/.thinkwatch`
- Windows installed copy: `%APPDATA%\ThinkWatch`
- Windows portable copy: `data\` next to the program

Configuration and local backups can contain credentials in plain text. Local
data is protected by operating-system access controls, not by application-level
encryption of the whole data directory. Programs running as you, administrators,
and backup or sync tools with access to that directory may be able to read it.

By default, request and response payloads are retained for 7 days, request
records for 90 days, and payload storage is capped at 5 GiB. Older payloads are
removed when the cap is exceeded. You can change these limits in **Settings ›
Log retention**. Configuration and its backups have a separate lifecycle and
are not deleted by the request-log retention settings.

## Other network connections

The app also makes the following connections for its features:

- **Updates:** it downloads release information and update files from GitHub.
  Homebrew installations also read the project's Homebrew tap. Automatic update
  checks can be disabled in **Settings › About**.
- **Public pricing data:** the gateway downloads LiteLLM's public price list
  from GitHub for local cost calculations. It does not send your prompts,
  credentials, or usage records to look up a price. Automatic refresh can be
  disabled in the pricing configuration.
- **Optional sync:** when you enable sync, configuration, including credentials,
  is copied to the folder, WebDAV service, or S3-compatible storage you choose.
  Sync content is encrypted with your passphrase by default. Request history is
  not synced. ThinkWatch does not provide a hosted sync service.
- **Optional remote Core:** when you configure a remote gateway, its
  configuration and request history reside on that server. The app exchanges
  control and display data with it over an authenticated, encrypted control
  connection. AI clients pointed at that gateway send their requests to that
  server, which forwards them to its configured upstreams. The server's operator
  controls access to the data there.

Network destinations, including GitHub, can receive ordinary connection metadata
such as your IP address, request time, requested resource, and HTTP headers.
GitHub can count release downloads. These downloads do not include AI request
content or a telemetry report from ThinkWatch Lite. Any proxy you configure is
also part of the network path.

## Diagnostics, exports, and deletion

Diagnostics are generated only when requested and saved as a local file. The
bundle redacts credentials and addresses and omits request and response bodies;
it is not automatically uploaded. Review it before choosing to share it.

Configuration exports can include credentials and can be encrypted with a
passphrase. The app does not automatically publish your exports or import
links. If you email a maintainer or post an issue, the recipients and the
platform receive what you submit. Public GitHub issues are visible to others.

You can disable optional sync and remove remote connections in Settings.
**Settings › Full uninstall** restores connected clients and offers local-data
deletion. You can also remove the data directory after closing the app and its
gateway. Copies you exported, synced, backed up elsewhere, or sent to providers
must be managed separately; uninstalling the app does not delete those copies.

## Changes and contact

Changes to this policy will be published in this repository with an updated
date. Its revision history is available in Git.

For privacy questions, contact the project maintainer at
[fylorn@outlook.com](mailto:fylorn@outlook.com). Do not post API keys or private
request content in a public issue.
