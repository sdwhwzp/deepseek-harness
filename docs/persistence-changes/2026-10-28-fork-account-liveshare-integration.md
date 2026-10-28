---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-28-fork-account-liveshare-integration

English | [中文](2026-10-28-fork-account-liveshare-integration.zh.md)

## Summary

Integrates account attribution with the LiveShare user-source principal and incomplete skill-catalog marker.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-fork-account-liveshare-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    integrates: ["2026-10-24-fork-account-source-integration"]
    after: "b4553372e6b73575587d5f2287247449bf9986c1b70f5cc49df4275979e6058d"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    integrates: ["2026-10-24-fork-account-source-integration"]
    after: "eea2a423cc8d4f402dcd24c8c4dc30678f177037ad3f28375523689a64fd02b9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    integrates: ["2026-10-24-fork-account-source-integration"]
    after: "7243359ab15787a5c02be1b36423cf3810ebd299e36d961faef623370f0128f6"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both accepted histories and all committed format generations remain intact. Current readers accept older records without the optional message principal or skill-catalog incomplete marker; an absent account principal remains anonymous. Readers from the LiveShare branch can ignore the additional optional account principal. Readers from the account fork retain ordinary user-message content when they do not drive a source principal kind. Account authorization uses the transport-verified AuthenticatedPrincipal stored on the message; source.principal is a separate discriminated attribution value and never grants account access. The share-viewer kind carries optional displayName for display, while LiveShare admission rechecks the Relay identity and grant before each step. A composition without LiveShare treats the content as ordinary user input. Existing user-source principals and title-request messages remain interpretable through their discriminants. The eight differences across the three competing roots comprise five optional additions, two source-principal value-type changes and one title-message union change; the latter three were reviewed in both reader directions. SESSION_FORMAT_VERSION remains unchanged.

<a id="verification"></a>
## Verification

The read-only branch comparison reviewed both accepted predecessors against the combined source and found no new roots. Persistence catalog/principal, Session JSON/repair and LiveShare host/viewer admission regressions: 5 files, 66 tests passed. Controller authorization, cancellation, listener, LiveShare and build-fixture regressions: 11 files, 239 tests passed after repairing failures from the initial full run. The initial full test run was not green; complete runtime build and aggregate build checks passed before the final cancellation adjustment.

<a id="dev-note"></a>
## Dev Note

None.
