---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-20-fork-principal-and-ptc-correlation

English | [中文](2026-09-20-fork-principal-and-ptc-correlation.zh.md)

## Summary

Records optional authenticated-principal fields on queued inputs and turn facts, plus root tool-call sequences on PTC dispatch events against the V4 Session inventory.

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
    previous: "2026-09-16-session-format-v4"
    after: "fb911dfe70f07d7ec51cab5b937d89366ef8085cfd7b2f3dbd819bbc76185c8a"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "4f1959776af618db1e6a764cc1814b8621d91c9e7abf826947a811a11f624e81"
    decision: same-version
  - root: "event:step/start"
    previous: "2026-09-11-initial"
    after: "e45e981c9edcdd8ac4a5ffa272c28ae489ddfe1c8e5b470aebd38d4c2fb5c30e"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "4465bc52bed5d33d47c737509c16a1b41ebc17673c03e4ecb3c3a11f02481e89"
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
    previous: "2026-09-16-session-format-v4"
    after: "8590c9e7c0f4787f8b02742a82b6d5165c95ec84834634162ceb9cb7fcdd3938"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing V4 events may omit these fields. Authenticated execution supplies verified account identity independently; absence never grants access. PTC readers use rootCallSeq when available to distinguish repeated provider call ids and retain legacy correlation when absent. Released V3 data uses the explicit V3-to-V4 migration with historical child facts. No committed Session format generation is changed.

<a id="verification"></a>
## Verification

The full unit suite completed, followed by passing focused account authorization, Session migration, workspace feed, Connection, Gateway, workflow and UI regression tests. pnpm run build passed on Node 22.21.1.

<a id="dev-note"></a>
## Dev Note

None.
