---
description: Fetch pending feedback from the Vue+Vite dev preview and start working through it.
---

Call the `get_feedback` MCP tool from the claude-feedback server now. If items
come back, process each one per the `claude-feedback` skill (open the linked
component file, request a store/component/console snapshot if needed). If the
queue is empty, call `feedback_status` and report whether the bridge is even
running before telling the user nothing arrived.
