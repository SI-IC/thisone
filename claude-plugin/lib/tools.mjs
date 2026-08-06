export const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const TOOLS = [
  {
    name: "get_feedback",
    description:
      "Drain and return all pending element-anchored feedback messages the user sent from the Vue+Vite dev preview (Alt+C). Each item has: url, message, element (tag/classes/selector/sourceLoc — start/end line+column of the tag in its .vue file, when resolvable), component (Vue name + __file + parent chain), and recent browser console. Acknowledges (removes) the items it returns, so call once and process the whole batch.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "request_store_snapshot",
    description:
      "Ask the live browser preview for a snapshot of a Pinia store's state. Omit `store` to list available store ids first. Requires the preview tab to be open.",
    inputSchema: {
      type: "object",
      properties: {
        store: {
          type: "string",
          description:
            "Pinia store id to snapshot; omit to list available ids.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "request_component_snapshot",
    description:
      "Ask the live browser preview for a snapshot (props + state) of a Vue component. Pass a CSS `selector`, or `last: true` to use the element the user most recently picked. Requires the preview tab to be open.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the target element.",
        },
        last: {
          type: "boolean",
          description: "Use the last element the user picked.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "request_console",
    description:
      "Ask the live browser preview for its current console ring-buffer, optionally filtered by `level`. Requires the preview tab to be open.",
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["log", "info", "warn", "error", "debug"],
          description: "Only return entries at this level.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "feedback_status",
    description:
      "Report the dev-server bridge status: whether the preview browser is connected, open tabs, queued feedback count, port and version. Use this to check the tooling is live before asking the user to retry.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
];
