import { describe, it, expect } from "vitest";
import { TOOLS, EMPTY_OBJECT_SCHEMA } from "../../claude-plugin/lib/tools.mjs";

describe("MCP TOOLS", () => {
  it("declares the five tools", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "feedback_status",
      "get_feedback",
      "request_component_snapshot",
      "request_console",
      "request_store_snapshot",
    ]);
  });

  it("get_feedback description documents element.sourceLoc", () => {
    const tool = TOOLS.find((t) => t.name === "get_feedback");
    expect(tool.description).toMatch(/sourceLoc/);
  });

  it("feedback_status and get_feedback share the empty-object input schema", () => {
    const feedback = TOOLS.find((t) => t.name === "get_feedback");
    const status = TOOLS.find((t) => t.name === "feedback_status");
    expect(feedback.inputSchema).toBe(EMPTY_OBJECT_SCHEMA);
    expect(status.inputSchema).toBe(EMPTY_OBJECT_SCHEMA);
  });
});
