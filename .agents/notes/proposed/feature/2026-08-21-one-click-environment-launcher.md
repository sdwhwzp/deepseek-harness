# Agent Note: Bundled DeepSeek Harness desktop application

Status: proposed

English | [中文](2026-08-21-one-click-environment-launcher.zh.md)

## Problem

The ordinary customer entry, `npx @deepseek-ai/dsh web`, assumes that a compatible Node.js installation already exists. Running from a checkout additionally requires Git, the repository-pinned pnpm version, dependency installation, a complete build, and terminal knowledge. An environment checker inside the existing Node CLI cannot help a customer whose machine cannot start that CLI.

The repository deliberately leaves checkout placement, Git updates, and artifact freshness to source users in [Source run without a managed installer](../../implemented/simplification/2026-08-10-source-run-without-managed-installer.md) and [Separate source launch from repository build](../../implemented/simplification/2026-08-12-separate-source-launch-from-build.md). A customer-facing desktop product must not turn those contributor responsibilities into a graphical source installer: network, elevation, package-manager, and compiler failures would remain customer setup failures behind a different interface.

Customers instead need an installed application with its own window, desktop integration, tested runtime, and predictable lifecycle. It must start DeepSeek Harness without Git, Node.js, pnpm, a source checkout, or an external browser while preserving the existing Web experience and user data.

## Proposal

### Product and platform scope

Add a private workspace application under `apps/desktop` with the package name `@deepseek-ai/dsh-desktop`. Its release products contain Electron, a dedicated Node 24 Harness runtime, the production Web assets, and every runtime dependency. The desktop application is an artifact distribution, not an npm entry and not a source installer.

The first release supports:

- Windows 10 and Windows 11 on x64, as an NSIS installer and a portable executable.
- Mainstream glibc-based Linux distributions on x64, with a deb package for Debian-family systems and an AppImage qualified on Ubuntu, Debian, Fedora, openSUSE, and Arch Linux.
- Simplified Chinese and English application-owned startup, failure, update, and shutdown states. The loaded Harness Web UI retains its own locale behavior.

macOS, ARM64, headless servers, source-branch selection, customer-supplied runtime packages, and a resident system-tray mode remain outside the first release.

### Desktop process model

Electron owns the native application lifecycle, one `BrowserWindow`, update coordination, and one bundled Harness runtime child. The main process takes the current-user single-instance lock before creating either child or window. A second invocation focuses the existing window and exits.

The Harness child is built as a separate Node 24 executable with the `@yao-pkg/pkg --sea` foundation already measured by [Single-file executable SDK runtime distribution](../../implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md). It has a desktop-specific entry that boots the production Web profile on `127.0.0.1` with an operating-system-assigned port and never opens the default browser. Its closed runtime payload includes the Loader composition, dynamic imports, native modules, production Web manifests, and client assets required by that profile. Electron and the runtime remain separate release closures so Electron upgrades cannot silently change the Harness Node engine or native-module ABI.

The runtime reports a versioned `ready` or `fatal` message over a dedicated parent-child control channel. A ready message carries only the loopback URL and runtime version. Electron validates the message, requires a loopback address, and completes an HTTP health request before loading the URL. Runtime logs use a separate bounded stream so a log line cannot imitate readiness.

Closing the main window requests graceful Harness disposal, waits for the runtime and its owned subprocess tree to become completely stopped, then exits Electron. Update installation follows the same shutdown path. A bounded shutdown timeout may escalate through the repository's platform process-tree provider, but the desktop application never kills a process identified only by a persisted PID. The first release does not continue running after the window closes.

### Desktop window and startup experience

The application initially displays a packaged startup document that does not depend on the Harness server. It presents four ordered states:

1. Verify the supported operating system, x64 architecture, packaged-resource manifest, and executable integrity.
2. Verify that the Electron data directory and `$DSH_HOME` are writable without changing existing contents.
3. Start the bundled Harness runtime and wait for its structured readiness and health response.
4. Replace the startup document with the existing Harness Web UI in the same window.

Each state has Chinese and English labels, an accessible live status, bounded sanitized diagnostics, and an appropriate retry or exit action. A runtime failure keeps the packaged startup document available; it never leaves a blank window or starts an external browser. Corrupt or missing bundled resources require reinstalling the signed application rather than downloading executable code during startup.

The desktop application preserves the existing Web credential onboarding, settings, sessions, tools, and plugin behavior. Harness data continues to use `$DSH_HOME`, including the default `~/.dsh`, so desktop and CLI runs share the same supported data. Electron-owned logs, update state, and crash reports use Electron's per-user `userData` directory and never contain credential values.

### Electron and loopback security

The Harness window enables `contextIsolation` and Chromium sandboxing and disables `nodeIntegration`. Its preload exposes only typed desktop operations for application version, platform, runtime status, retry, exit, update status, and confirmed update installation. It exposes no generic IPC, subprocess, shell, environment, or filesystem primitive.

The main process restricts navigation and API traffic to the exact random loopback origin returned by the trusted runtime. It denies unexpected windows, permissions, downloads, protocols, and navigations; an explicit external-link allowlist may open ordinary HTTPS documentation in the operating-system browser. Browser content cannot choose a command, executable, working directory, or runtime URL.

Every desktop run generates an unpredictable bearer token and transfers it to the trusted runtime through the private control channel, not argv, a URL, or a persisted file. Electron's request layer adds the token only to API requests for the validated Harness origin, so renderer JavaScript cannot read it. The desktop Web composition requires that token in addition to the existing Host, Origin, method, content-type, and request-size checks. The ordinary `dsh web` composition keeps its current browser-trust behavior.

Content Security Policy permits only the production Web resources and exact loopback connection required by the application. Release builds reject Electron development tools, remote module access, an unexpected unpacked executable, an unverified runtime payload, or a dependency license inventory that is missing from the published notices.

### Packaging, updates, and release ownership

`electron-builder` produces the Windows NSIS installer, Windows portable executable, Linux AppImage, and Linux deb package from the same tagged source version. Native runners build and smoke their own platform products. The desktop artifact embeds a manifest of every runtime resource and SHA-256 value; startup verifies that manifest before executing the runtime.

The application checks signed release metadata after a successful startup without blocking current use. It downloads an applicable update only after reporting the version and size, verifies the signature and checksum, then asks the customer to restart and install. NSIS and AppImage products may complete replacement in application; the portable executable and deb package download the verified product and guide the customer through explicit replacement or package installation. No product silently replaces itself, and an unreachable update service never prevents the installed version from running.

Windows release artifacts require Authenticode signing. Every platform publishes immutable installers, SHA-256 checksums, provenance, a software bill of materials, and third-party notices. Publication refuses a missing signature where required, a stale runtime manifest, a version mismatch between Electron and Harness, an unverified packaged entry, or a failed clean-machine smoke test.

### Documentation ownership

The desktop application README owns supported systems, installer choices, data and log paths, startup and shutdown behavior, security restrictions, update behavior, troubleshooting, and removal. Root and user documentation present the desktop application as the ordinary customer path while retaining `npx`, installed CLI, and manual source instructions for developers and automation. English and Simplified Chinese documentation change together.

The existing source-run decisions remain current because the desktop application neither clones nor updates a checkout and never installs a development toolchain. The desktop runtime consumes only release-built artifacts from the tagged commit.

## Alternatives considered

**Keep the graphical source installer.** It could expose branch selection and rebuild current source, but it would make Git hosts, registries, package managers, elevation, disk capacity, and compiler behavior part of every customer's first run. A complete release runtime makes those release qualification concerns instead of customer setup concerns.

**Package only the existing CLI.** A standalone CLI would remove the Node prerequisite but would still require terminal use and external-browser process ownership. It would not provide the requested installed desktop lifecycle, window, update interaction, or application-level security restrictions.

**Use Tauri with a Node sidecar.** Tauri would reduce the desktop shell size, but it adds Rust and system-WebView variability while still requiring the complete Node runtime sidecar. Electron reuses the repository's TypeScript expertise and supplies one qualified Chromium implementation on both target systems.

**Run Harness inside Electron's main process.** This removes one executable, but a Harness failure would take down the native lifecycle and an Electron upgrade would change its Node engine and native-module ABI. A separate runtime has an explicit readiness channel, independent crash containment, and the same Node 24 semantics on both platforms.

**Run the Harness child through Electron's embedded Node.** `ELECTRON_RUN_AS_NODE` would avoid duplicating Node, but it couples native dependencies and supported engine behavior to Electron's release train. The measured SEA packaging foundation accepts a larger installation in exchange for a separately qualified Harness runtime.

**Keep an external browser instead of a `BrowserWindow`.** This is smaller and already supported by `dsh web`, but it does not behave as an installed desktop application and cannot enforce the same navigation, permission, token-injection, update, or close-to-stop lifecycle.

**Keep running in a system tray after the window closes.** Background operation can shorten reopen time, but it makes process ownership and resource use less visible. The first release chooses explicit close-to-stop behavior; a later tray mode requires a separately visible user preference and lifecycle design.

## Acceptance criteria

- A customer can install or run the appropriate signed Windows or Linux x64 product on a clean machine without Git, Node.js, pnpm, a source checkout, or a terminal and reach the existing Harness Web UI in the desktop window.
- Startup independently rejects an unsupported platform, wrong architecture, corrupt or missing packaged resource, unwritable data directory, malformed readiness message, non-loopback runtime URL, failed health response, and runtime exit before readiness.
- Successful startup performs no package-manager operation, privilege escalation, source download, branch selection, dependency installation, or customer-machine build.
- The application exposes bilingual, keyboard-accessible startup, failure, retry, update, and shutdown states. Snapshots cover both languages and every material application-owned state.
- The Harness Web UI preserves credential onboarding, settings, session persistence, and normal tool behavior against the shared `$DSH_HOME` without exposing credentials in Electron logs or update state.
- Security tests prove renderer content cannot access Node APIs, generic IPC, the bearer token, arbitrary navigation, permissions, downloads, external protocols, commands, filesystem paths, or non-Harness loopback origins.
- Loopback API tests reject absent or wrong desktop tokens and invalid Host, Origin, method, content type, or body size while ordinary `dsh web` retains its existing trust behavior.
- Repeated application execution focuses the existing window and does not start another runtime. Closing the window, selecting exit, installing an update, or handling a normal operating-system termination leaves no owned Harness or descendant process running.
- A runtime crash retains the packaged error UI and bounded sanitized diagnostics. Retry starts one fresh runtime; it cannot adopt or terminate an unrelated process through stale state or PID reuse.
- Native CI produces and smokes the NSIS installer, portable executable, AppImage, and deb package. Release qualification covers clean Windows 10 and 11 x64 systems plus the declared Linux distribution matrix without development tools installed.
- Update tests cover valid, unavailable, interrupted, corrupt, unsigned, wrong-version, and user-declined updates for each product's supported update path. The current application remains usable after every non-installed outcome.
- Focused unit and integration tests, bilingual desktop snapshots, packaged-runtime smokes, typecheck, lint, documentation synchronization, website link validation, dependency notices, and whitespace validation pass.

## Risks

Electron plus a dedicated Node runtime creates a substantially larger installation than a browser launcher or Tauri shell. The release must publish size measurements and keep Electron, Harness, duplicated native components, and Web assets in separately auditable closures; size alone must not motivate coupling Harness to Electron's Node ABI.

The desktop application turns the loopback Web server into part of an installed local security boundary. A leaked bearer token, permissive navigation, renderer Node access, weak Content Security Policy, forged readiness message, or incomplete process cleanup could expose Harness capabilities or credentials. Token transfer, request injection, BrowserWindow restrictions, structured readiness, and complete child disposal are release-blocking behavior.

Shipping a complete runtime moves dependency and compiler failures out of customer setup but makes every release artifact platform-specific. Electron, Node, native addons, the packaged Web closure, installers, signatures, update metadata, provenance, and clean-machine tests must be rebuilt and qualified together for each supported platform.

Linux desktop integration and self-update behavior differ across AppImage and deb installations. The application must describe the applicable update path instead of claiming that every package can replace itself. Enterprise proxy, signing, or execution policies may block update download or runtime execution; the installed version must remain usable and report the exact blocked operation.

Sharing `$DSH_HOME` preserves CLI interoperability but allows a desktop and CLI process to contend for the same supported data. Existing persistence locking and corruption behavior remain authoritative; the desktop application must surface those failures and must not invent a second data migration or silently copy credentials.
