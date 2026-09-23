---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-20-fork-principal-and-ptc-correlation

English | [中文](2026-09-20-fork-principal-and-ptc-correlation.zh.md)

## Summary

Records optional authenticated-principal fields on queued inputs and turn facts, plus the root tool-call sequence on PTC dispatch events.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-20-fork-principal-and-ptc-correlation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "04099928dfb41064f13b163f2a3a5aa2bd59369e4dcd679f13f3317bab4d53fd"
    decision: same-version
  - root: "event:step/start"
    previous: "2026-09-11-initial"
    after: "e45e981c9edcdd8ac4a5ffa272c28ae489ddfe1c8e5b470aebd38d4c2fb5c30e"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-14-image-offload"
    after: "0441c8b328c191656598ddbf831c529979076453f24595557610839b2a004223"
    decision: same-version
  - root: "event:tool/ptc-dispatch-start"
    previous: "2026-09-11-initial"
    after: "54f30a440e3764d81ad52bb0ea26c662195d96a1135e72c94a7506592e218774"
    decision: same-version
  - root: "event:turn/start"
    previous: "2026-09-11-initial"
    after: "171a37e51ed002a77b9976094748fb961f573bfa5a65e5a17c0c645964a96a6d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "6cfa6375a1763421c2f18ba7a608aa79fbad51c258a68e6f1b9ee06e83e1fac6"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing events may omit these fields. Principal readers retain their legacy missing-principal behavior; authenticated execution supplies the account identity independently. PTC readers use rootCallSeq when available to distinguish repeated provider call ids and retain legacy correlation when absent. The fields do not alter message content or require a Session format increment.

<a id="verification"></a>
## Verification

The focused API, principal-access, tool, agent-loop, subagent and export suites passed 2527 tests; the single timed-out cold-delivery test passed in an isolated rerun. The Host and Client typecheck and complete build passed.

<a id="dev-note"></a>
## Dev Note

None.
