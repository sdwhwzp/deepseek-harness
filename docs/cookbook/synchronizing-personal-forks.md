---
description: "Synchronize the personal Harness fork and integrated plugin forks without losing deployment adaptations or unpublished branches."
---

# Synchronizing personal forks

English | [中文](synchronizing-personal-forks.zh.md)

These rules cover this Harness fork and its integrated dsh plugin forks. Record each source repository/branch, owned fork push URL, current branch, and remote commit before synchronizing.

1. Fetch the fork source and owned remotes first, preserving uncommitted work. Merge the fetched source into the current working branch; an old `dev` or default branch does not substitute for the active deployment branch.
2. Prefer incoming source implementations when resolving conflicts. Adapt the merged code to the current Harness and user requirements, retaining required account isolation and persisted-data compatibility with minimal local changes. Do not discard unmerged work through reset or blanket conflict resolution.
3. Finish adaptation and the relevant checks before pushing, following [pre-push checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md). A failed check leaves synchronization incomplete.
4. Enumerate every local branch in each synchronized repository and upload every unpublished branch or commit to its owned fork. Verify each remote branch matches its local commit; do not stop after pushing only the current branch. Preserve branch histories and remote-only branches; never use `--mirror` or raw `--force`.
5. Fetch again after all pushes. Compare the current branch against the latest source commits and inspect remaining source differences. Merge, adapt, check, and push again if new source commits remain. Report branch hashes, checks, and intentional adaptation differences; claim completion only when no source commits or unpublished local branches remain.
