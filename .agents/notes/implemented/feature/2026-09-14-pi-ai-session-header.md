# Agent Note: a pi-ai route can carry the session id to a per-conversation provider

Status: implemented

## Problem

OpenCode Go began refusing requests that omit `x-opencode-session` on 2026-09-05, answering `400 {"type":"MissingSessionID"}` with the routing rationale: a stable per-conversation id is what its router and prompt cache key on. A deployment serving `opencode-go` through `@deepseek-ai/dsh-llm-pi-ai` cannot satisfy that from configuration. The route's `headers` dict is static, so every conversation would present the same id — accepted by the endpoint, but pinned to one routing bucket, which is the opposite of what the header exists for.

The adapter already had the value. `PiAiAdapter.stream` forwards `options.sessionId` to `Models.streamSimple` as a stream option; only the header map was built without it, from `profile.headers` plus Harness attribution. The Harness's own DeepSeek adapter has sent `x-deepseek-harness-session-id` from the same field since it shipped, so the seam carries what a per-conversation provider needs and one adapter family was not spending it.

## Decision

A route may name `sessionHeader`. When it does and the request carries a session id, the completion request adds `{ [sessionHeader]: sessionId }`; when either is absent it sends what it sent before.

`requestHeaders` takes the name and the id rather than reading them from the profile, so the merge order stays visible in one expression: deployment headers, then the session header, then attribution — attribution still wins every collision it owns.

Resolution refuses two names rather than accepting them into a route that cannot work. A name Fetch cannot send would throw per request, at the provider, long after the write that caused it. A name the attribution headers own (`user-agent` today) would be overwritten at merge time, so the route would look configured while the provider received the product identity under the header it uses for routing.

A request with no session id is sent without the header instead of with a generated one. Configuration probes and one-shot utility calls are not conversations; a fresh id per such request would be indistinguishable to the provider from a conversation that never continues, and the value's whole meaning is that two requests share it only when they belong together.

## Alternatives considered

- **A static `x-opencode-session` in `headers`.** Rejected as the permanent answer, and recorded as what a deployment does while waiting: it passes the check and forfeits per-conversation routing and cache locality for the whole deployment.
- **Hard-code the OpenCode header name in the adapter.** Rejected: the requirement is a provider policy, not a pi-ai one, and a second gateway asking for its own header name would need the same change again. The name belongs to the route that talks to that provider.
- **Send the session id to every route unconditionally under one Harness name.** Rejected: it puts a Harness-internal identifier on every third-party request the deployment makes, including providers that neither ask for it nor say what they do with it.
- **Derive the header value from a hash of the session id.** Rejected without a stated requirement: no provider asked for an opaque form, and an extra transform makes a support conversation about routing harder to have.

## Consequences

- A route naming `sessionHeader` sends one more header per completion request; the value is the session id already present in the session log, so nothing new becomes model-visible or durable.
- Provider-side prompt caches can now key on the conversation for these routes. A deployment that had a static header should drop it when it sets `sessionHeader`, or the static value keeps overriding nothing — the two names would differ — while advertising a second, meaningless id.
- `packages/llm/llm-pi-ai/tests/adapter.spec.ts` fixes the three request-path cases (configured route with a session, configured route without one, unconfigured route), and `tests/config.spec.ts` fixes the two refusals plus the accepted name.
