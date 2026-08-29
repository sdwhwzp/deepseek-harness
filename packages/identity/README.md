---
description: "The identity package group: deployment principal authorization and anonymous per-harness-home correlation ids."
kind: "package-group"
---

# identity/ — identity and access

English | [中文](README.zh.md)

## Summary

The identity group owns two distinct Host identities: a random per-harness-home correlation id for telemetry and feedback, and the deployment authorization seam that maps a transport-verified principal to readable Session and Workspace ids. The anonymous id needs no configuration. Authenticated deployments mount their own principal-access provider backed by authoritative account data; local anonymous deployments retain their existing reads without one. This page maps both packages, and each package README owns its details.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.md) | Gives every harness home one anonymous id that telemetry, feedback, and DeepSeek requests attach to their records, so records from one installation can be recognized without identifying the user |
| [`principal-access`](principal-access/README.md) | Defines the deployment authorization service, strict local-anonymous defaults, and batched Session/Workspace read decisions consumed by Host APIs |

<a id="related-documentation"></a>
## Related documentation

- [Session telemetry subsystem](../../docs/subsystems/session-telemetry.md) — the telemetry feature that carries the id on exports.
- [dsh-llm-deepseek](../llm/llm-deepseek/README.md) — the DeepSeek provider that carries the id on requests.
- [dsh-command-feedback](../feedback/command-feedback/README.md) — the feedback command that names the anonymous installation in its acknowledgement.
- [Session Controller](../api/session-controller/README.md) — Session read Consumer for principal-scoped lists, histories, and live state.

<a id="dev-note"></a>
## Dev Note

None.
