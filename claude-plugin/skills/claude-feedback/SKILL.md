---
name: claude-feedback
description: Use when the user says they sent feedback from the dev preview (Alt+C), asks you to check pending feedback, or when investigating a UI bug that might have an anchored preview report waiting.
---

# claude-feedback

Pull-based feedback from a live Vue+Vite dev preview. The user presses Alt+C in
the browser, optionally picks an element, and sends a message; it queues on the
project's dev-server bridge until you drain it.

## Steps

1. Call `get_feedback`. It drains and acknowledges every pending item — call it
   once, then process the whole batch.
2. For each item, read: `url`, `message`, `element` (tag/classes/selector),
   `component` (Vue name + `__file` + parent chain), and the recent browser
   `console`. Use `component.file` to jump straight to the source.
3. If the item is under-specified, call the matching request tool against the
   live preview tab:
   - `request_store_snapshot` — Pinia store state (omit `store` to list ids).
   - `request_component_snapshot` — props/state of an element (`selector` or
     `last: true` for the element the user most recently picked).
   - `request_console` — the current console ring-buffer, optionally filtered
     by `level`.
     These require the preview tab to still be open; if `feedback_status` shows
     no browser connected, ask the user to open/reopen the preview.
4. If no items are pending, use `feedback_status` to check the bridge is
   actually running before telling the user nothing arrived.

## Releasing changes to this plugin itself

If you're working on `vite-plugin-claude-feedback` or `claude-feedback`
themselves (not consuming feedback from a downstream project), a breaking or
notable change warrants `pnpm release minor` or `pnpm release major` instead
of relying on the automatic patch bump on commit.
