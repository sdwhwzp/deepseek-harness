---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-18-fork-timeline-account-integration

English | [中文](2026-11-18-fork-timeline-account-integration.zh.md)

## Summary

Records Timeline priority notices alongside account attribution for queued messages, user input and title requests.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-18-fork-timeline-account-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-04-fork-retry-subagent-integration"
    integrates: ["2026-11-05-timeline-priority-notice"]
    after: "4189cf72d2a40231786bdd3de765b37eb6ead8ad84de2dee480ffd711b89399f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-04-fork-retry-subagent-integration"
    integrates: ["2026-11-05-timeline-priority-notice"]
    after: "de5749bfc55fd3a3993d75b512d9d686b728434cb7b657ff08c7145ad85194b8"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-04-fork-retry-subagent-integration"
    integrates: ["2026-11-05-timeline-priority-notice"]
    after: "f44bc89170b749b222742569f0bd9c291fbc6421cd8b583235352be02c737052"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Messages from either predecessor remain readable. A Timeline priority notice carries ordinary text with a source discriminator. Readers without Timeline can retain its source and read its text. An absent principal records no authenticated account and grants no account access. Readers that understand principals preserve them independently of the message source. The Session writer remains at V4.

<a id="verification"></a>
## Verification

Compared the generated V4 schema with both parent inventories using persistence-review. Ran the Timeline feedback, account access, JSONL generation, migration refusal and multi-edge publication tests (240 passing). Ran the Agent loop, Workspace and Session controller regressions that cover account attribution and transport.

<a id="dev-note"></a>
## Dev Note

None.
