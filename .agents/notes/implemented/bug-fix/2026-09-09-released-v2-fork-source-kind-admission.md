# Agent Note: Admitting the fork's released v2 message source kind

Status: implemented

English | [中文](2026-09-09-released-v2-fork-source-kind-admission.zh.md)

## Problem

This fork installs a `dsh-at-file` plugin that stamps `source.kind: 'at-file-mention'` on the user messages it contributes. Released v2 Sessions written on the fork's servers therefore carry that kind in a durable, immutable generation.

The v2-to-v3 edge classifies message sources against a closed inventory and refuses an unrecognized kind for the whole Session, because a source kind it cannot classify may hide a Session reference it would have to remap. Upstream never saw this plugin, so its inventory omits the kind, and every Session carrying one refuses migration with `SessionFormatUnsupportedMigrationError`. Restoring the production corpus before the fix measured 13 such messages in 5 of 57 Sessions; those Sessions would open on the predecessor generation and refuse on this one.

## Decision

The released v2 source inventory admits `at-file-mention`. Admission classifies the kind only; it interprets no member of the source as a Session reference, matching how agent relay attribution is admitted.

Native V3 classifies no source kind at all, so the plugin needs no admission beyond this edge and keeps writing the kind unchanged.

## Alternatives considered

**Rewrite the stored bytes to a classified kind.** Rejected: committed generations are immutable, and a migration that repaired its own source would break the guarantee that a predecessor stays readable.

**Make the inventory configurable.** Rejected: the admitted set is a fixed historical fact about bytes already written, not a choice that varies by deployment.

**Leave the Sessions refused.** Rejected: it silently costs users their history at upgrade, and the refusal is indistinguishable from corruption at the point the product reports it.

## Consequences

Every released Session this fork wrote restores on the current generation, including those carrying [principal identity](../architecture/2026-09-05-principal-authorization-across-013-upstream.md).

The cost is a fork edit inside an upstream-owned released-format file: each upstream sync must re-apply it, and a sync that drops it silently re-breaks only the Sessions that carry the kind. The admission is one entry with the plugin named at the edit, so a reviewer can tell it from an upstream member.

## Testing

`admission.spec.ts` asserts the kind is admitted at both generations, beside the existing case proving an unrelated unknown kind is still refused at v2 and retained at v3 — the closed set stays closed. Restoring the production corpus after the change migrated all 106 logs to v3, 57 from v2 and 49 from v0, with no refusal.
