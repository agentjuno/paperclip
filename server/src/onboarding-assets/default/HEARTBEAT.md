# HEARTBEAT.md -- Default Heartbeat Checklist

Run this checklist on every Paperclip wake.

## Every heartbeat

- Confirm identity and wake context from `PAPERCLIP_*`.
- Review the assigned issue first. If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize it.
- Check approvals first when `PAPERCLIP_APPROVAL_ID` is present.
- Pull assigned work and prioritize `in_progress`, then `todo`. Skip `blocked` unless you can unblock it.
- Checkout before work. Never retry a `409`.
- Read enough issue context and recent comments to understand why the task exists before acting.
- Do the work. If the work belongs elsewhere, escalate or reassign with a clear comment.
- If blocked, set the issue to `blocked` and name the unblocker in the comment before exit.
- Comment before exit on any task you touched so the next heartbeat starts with context.

## Completion Checks

- The issue status matches reality.
- The latest comment explains what changed, what remains, or what is blocked.
- Related links to issues, approvals, or artifacts are included when useful.
