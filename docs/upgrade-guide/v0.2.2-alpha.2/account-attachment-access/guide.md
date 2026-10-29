---
kind: upgrade-guide
description: "Account deployments require independent attachment grants and cannot use the raw file route."
---

# Account attachment access

English | [中文](guide.zh.md)

## Change

Authenticated attachment reads and ZIP exports require independent account grants. Session readability or a reference in its history is insufficient. Browser Session and subagent prompts reject durable references and record ownership of validated uploads before delivery. Providers without attachment support deny these operations. Markdown export checks the exact Session before reading content or metadata.

`GET|HEAD /api/file` returns 403 whenever an account principal, request-authentication provider, or principal-access provider exists. It performs no path resolution, metadata read, redirect, or content read. Local-anonymous file display retains its previous behavior. Previously cached file responses may remain in a browser cache; server denial cannot revoke bytes already delivered.

## Migration

1. Upgrade all Host, CLI, SDK, Web readers and writers together. Update the deployment provider to resolve `subjects.attachmentIds` into `readableAttachmentIds` and implement `recordAttachments(principal, { sessionId, attachmentIds }, signal)`. Revalidate the effective account and current Session ownership, then persist idempotent grants before returning.
2. Snapshot account grants with Session files and attachment objects. Preserve old attachment access only through trusted, operator-reviewed ownership evidence; never infer ownership solely from Session history. Keep unknown ownership denied or require a fresh byte upload. No attachment-byte or Session-format rewrite is required.
3. Replace authenticated raw-path file display with an independently authorized endpoint. Session attachment reads use the complete image reference and its account grant. Clear previously cached raw-file responses on shared browser profiles.
4. Verify own preexisting grants, fresh uploads, foreign-reference prompt rejection, cross-account attachment and export denial, and GET/HEAD raw-file denial. Verify incomplete authentication fails closed and local-anonymous operation remains available.
