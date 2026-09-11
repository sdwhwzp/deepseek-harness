# Agent Note: Preserve the authorizing principal on automatic goal rounds

Status: implemented

English | [中文](2026-09-12-goal-round-principal.zh.md)

## Problem

An authenticated Remote caller can create a goal in an empty session. The goal driver queues internal user messages without the caller identity, so account-scoped memory rejects execution and accounting cannot attribute model calls. Looking up an account from older session messages would also misattribute work when a different caller resumes a goal.

## Decision

The goal-round driver captures the authorizing principal synchronously on create and explicit resume, before durability waits and detached scheduling. For tool calls it reads the current initiator's open-turn owner from a host-only projection. For agentless Remote calls it reads the optional Gateway's verified caller. The projection folds committed turn boundaries, restores on mount, and clears at turn end; it does not read arbitrary history synchronously or expose account data in the Client projection.

Every reserved message carries that captured principal. Admission compares principal, source, and content with the reservation. Edits and competing prompts preserve the captured authority; explicit resume replaces it. Unload and session restart continue to disarm goals, so a restored projection does not grant automatic continuation. Anonymous local operation remains supported without borrowing a previous account.

## Alternatives considered

**Relax account checks in the memory provider.** This would conceal the missing identity without restoring model-call accounting or isolation in other account-scoped plugins.

**Recover the latest account from session history.** A closed turn may belong to a different caller, and new synchronous event-history reads violate the storage direction. Only the active tool turn or verified Remote caller owns a new authorization.

**Read the ambient Gateway caller when queuing each round.** Async checkpoints and detached scheduling can outlive the mutation request. Capturing at the authorizing operation preserves attribution across those waits.

## Consequences

The driver depends on the Session projection registry and the optional Gateway type contract. The owner projection retains only the current open-turn principal; continuation authority remains process-local. Model-visible prompt text and Session event formats do not change. Existing memory and accounting plugins receive the same principal that ordinary authenticated user turns carry.

## Testing

Focused tests cover checkpoint overlap, multi-round attribution, explicit resume after driver reload, tool ownership, and anonymous work after an authenticated turn. A Loader subprocess boots the shipped headless profile, invokes the real Gateway and goal service with a fixture account provider, and verifies persisted principals and an attributed model request. Existing goal replay expectations cover unchanged model-visible prompts and lifecycle behavior.
