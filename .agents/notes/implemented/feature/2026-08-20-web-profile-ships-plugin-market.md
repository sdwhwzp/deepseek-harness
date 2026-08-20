# Agent Note: Web profile ships the plugin market

Status: implemented

English | [中文](2026-08-20-web-profile-ships-plugin-market.zh.md)

## Problem

The `dshmarket` plugin market is a web-profile plugin installed per machine through `dsh plugin --profile web add dshmarket`. Its bundle list lives in `~/.dsh/profiles/web/package.json` under the Harness home, which git does not track, so cloning this repository on another machine starts without the market and the manual install step must be repeated every time.

## Decision

`dshmarket@^1.15.0` is a dependency of `apps/cli` (the dsh installation anchor) and `PROFILE_TEMPLATES.web` in `dsh-app-boot` is `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket']`. A fresh `web` profile therefore auto-initializes with the plugin-market bundle on first load, and the bundle resolves from the installation anchor (`apps/cli`) where pnpm installs it. Existing profiles keep their own `dsh.profile.bundles` lists — the template applies only when the profile directory does not exist yet.

`knip.json` ignores `dshmarket` for `apps/cli` because the Loader resolves the bundle at runtime rather than from a static import. The root `pnpm-workspace.yaml` `minimumReleaseAgeExclude` carries the current market version, matching the profile workspace's own supply-chain handling.

## Alternatives considered

- **Commit a repo profile directory and redirect `DSH_HOME`.** Versioning the profile's `package.json`, patch, and workspace config in git keeps the market in the repository, but every machine must set `DSH_HOME` and reinstall `node_modules`; the market still does not ship in the product.
- **Document or script the install step.** A one-line setup note is the lightest change but leaves the market absent on a fresh clone, which is exactly the gap this decision closes.
- **Add `dshmarket` to the `dsh-web-app` bundle.** Baking a community-plugin surface into the mode bundle makes every consumer of the app bundle depend on it; keeping it a profile-template layer lets a profile remove or replace the market by editing `dsh.profile.bundles`.

## Verification

`dsh-app-boot` profile tests pin `PROFILE_TEMPLATES.web` to the shipped list and its auto-initialization, and a fresh-`DSH_HOME` `dsh --profile web --dump-config` composes the `dshmarket` layer into the tree.

## Consequences

Every fresh web profile on this fork opens the plugin market without an install step, and the versioned dependency travels with the repository across machines. The dsh installation now depends on a third-party npm package; the market's optional `@deepseek-ai/dsh-settings` peer resolves through the installation closure because `dsh-web-app` already reaches it. New market releases arrive through the normal dependency bump; each recent release needs a `minimumReleaseAgeExclude` entry until it ages out.
