---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-24-fork-account-source-integration

English | [中文](2026-10-24-fork-account-source-integration.zh.md)

## Summary

Integrates the released fork account-attribution fields with the upstream action-card source attribution.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-24-fork-account-source-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-21-fork-account-history-integration"
    integrates: ["2026-10-22-action-card-status"]
    after: "592802389adc4c2348e68c191d87fea52c36acee11215dc1da969403d0365e3d"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-21-fork-account-history-integration"
    integrates: ["2026-10-22-action-card-status"]
    after: "0b74a0f5f0797f71e5df9b3d3b4e9d659d3f3f09e5bce48c38dc388a0e2223fa"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-21-fork-account-history-integration"
    integrates: ["2026-10-22-action-card-status"]
    after: "00be6ea5299e69419b3240ff89dc719a6550d86aa27332a01e785457a05bbc81"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both accepted branches remain format 4. Existing fork records retain optional message/turn/step principals and PTC root-call sequence fields; absent principals remain anonymous and never inherit a later request. Upstream records without these optional fields remain readable. The action-cards source kind only attributes already stored message content; the declared source-attribution policy preserves unknown kinds without dispatching actions from them. The four attribution-kind additions and seven optional-field differences were reviewed independently against both committed branch inventories. Accepted records and their root digests are preserved; their node-table encoding changes no schemas or fingerprints.

<a id="verification"></a>
## Verification

Read-only persistence-review against HEAD and MERGE_HEAD: four attribution-kind additions and seven optional-property additions, no compatibility-review-required changes. Focused principal/controller/goal tests: 80 passed. Session repair, format admission/migrations, scoped sidebar and PTC correlation regressions: 1130 passed. Complete main build including Host and Client aggregate checks: 10 gates passed.

<a id="dev-note"></a>
## Dev Note

None.
