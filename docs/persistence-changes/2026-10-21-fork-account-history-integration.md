---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-21-fork-account-history-integration

English | [中文](2026-10-21-fork-account-history-integration.zh.md)

## Summary

Integrates the accepted account-principal and PTC call-occurrence additions with the source PTC operation metadata history. User messages, turn/step starts, spliced inbox messages, and title-model message snapshots retain optional authenticated principals. PTC dispatch and dispatch-start retain optional rootCallSeq alongside the source fields.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-fork-account-history-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "8b04696820fb5727b8c5ca712b7bcae2d9ae1cf48c137aa137f80fed0e142a8a"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "09fbaa24d601c69a74ddf4d00ba68213219cf1438ecf6c5b616a62b488bd53f5"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-20-fork-principal-and-ptc-correlation"
    integrates: ["2026-10-05-ptc-operation-metadata"]
    after: "659206c0b922b56ce3393db46f0b37ea519f1bc8678a4da00724483fc58aac4b"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "20d66b7e6b62db7f3403b772eb9fe0eb91ef0ee15db55745085463806d271b3a"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The Session header and envelope remain unchanged. Every added account or root-call field is optional; current readers accept source records without those fields and retain existing fork records with them. PTC operation metadata and rootCallSeq occupy separate optional properties, so the integration validates both predecessor schemas without rewriting either acknowledgement. Historical V4 JSONL fixtures, committed format generations, and finalized checkpoints remain intact. Principal availability does not grant access by itself: current request authorization still gates session and workspace operations. Older source readers do not implement the fork account authorization and are not a supported account-isolated deployment target.

<a id="verification"></a>
## Verification

Reviewed the seven root differences against the merged source schema and the two independent tool/ptc-dispatch branch tips. Focused account, gateway, workspace, subagent and deliverable checks passed (330 tests); workflow fixture regressions passed (44 tests). Persistence-history tests passed (85 tests), including explicit integration, missing/cyclic/duplicate/ancestor parents, preserved predecessor files, and finalized integration-parent tampering rejection. No production migration or deployment has been performed.

<a id="dev-note"></a>
## Dev Note

None.
