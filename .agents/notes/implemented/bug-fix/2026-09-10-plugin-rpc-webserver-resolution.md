# Agent Note: Plugin RPC Web server resolution

Status: implemented

English | [中文](2026-09-10-plugin-rpc-webserver-resolution.zh.md)

## Problem

A plugin registering a legacy Connection RPC channel can fail with an undeclared `webServer` access even when the Web server is active. Cordis service getters retain the provider context for dependency checks; declaring the service in the caller does not grant it to the Connection provider.

## Decision

Connection resolves its optional Web server through `ctx.get` when registering a legacy channel. Absence rejects registration immediately. The registering plugin still owns the route disposer. Carrier-neutral exact Fetch routes and Remote interceptors remain available without a Web server.

## Alternatives considered

**Add a Web server injection to each consumer.** The provider context still owns the property access, so this does not resolve the failure.

**Require a Web server when loading Connection.** Headless and worker carriers need Connection without a Node HTTP server.

## Consequences

Optional carrier resolution occurs only when a legacy channel needs it. A Cordis service-backed fixture covers registration and removal; the full Mnemon Web profile verifies authenticated account RPC through the deployed carrier.
