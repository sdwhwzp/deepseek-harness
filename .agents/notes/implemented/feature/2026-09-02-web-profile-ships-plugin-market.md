# Agent Note: Web profile ships the plugin market

Status: implemented

English | [中文](2026-09-02-web-profile-ships-plugin-market.zh.md)

## Problem

The `dshmarket` plugin market is otherwise installed separately in every machine-local web profile. Cloning or deploying this fork on another machine would therefore omit the market until an administrator repeated the installation.

## Decision

`dshmarket@^1.39.0` is a dependency of the dsh installation anchor, and the shipped `web` profile template includes `dshmarket` after the base and web-app bundles. A fresh profile resolves the market from the installation and composes it on first load. Existing profiles retain their own bundle lists because the template applies only when the profile does not exist.

The exact release is exempted from the repository's minimum-release-age policy so a deployment that intentionally updates the bundled market can install that reviewed version immediately.

## Alternatives considered

**Keep installation manual.** This leaves every fresh machine without the market until an administrator repeats a machine-local action, so the fork does not reproduce its intended web profile from source.

**Rewrite existing profiles during upgrade.** This would replace administrator-owned bundle choices. The template applies only to a missing profile instead.

## Verification

The app-boot profile test pins the market in the shipped web template. Package, dependency, documentation, and built-profile checks cover the runtime-resolved dependency and composed bundle.

## Consequences

Fresh installations of this fork include the plugin market without a separate command. The CLI installation carries one additional third-party runtime dependency, while administrators can still remove or replace the bundle in an existing profile.
