import assert from "node:assert/strict";
import test from "node:test";

import { reconcileTaskHistory } from "../src/app/taskHistory.ts";

function entry(taskId, state, updatedAt = "2026-08-31T00:00:00Z") {
  return {
    taskId,
    provider: "local",
    mediaId: `media-${taskId}`,
    title: taskId,
    snapshot: {
      schema: 1,
      task_id: taskId,
      provider: "local",
      state,
      stage: "",
      progress: null,
      engine: { version: "test", commit: "test" },
      requested_capabilities: {},
      effective_capabilities: {},
      error: null,
      last_cursor: 0,
      created_at: updatedAt,
      updated_at: updatedAt,
    },
  };
}

test("refresh does not restore a completed task removed while refresh was in flight", () => {
  const completed = entry("completed", "completed");
  assert.deepEqual(reconcileTaskHistory([], [completed]), []);
});

test("refresh updates tasks that remain in history", () => {
  const running = entry("kept", "running");
  const completed = entry("kept", "completed", "2026-08-31T00:01:00Z");
  assert.deepEqual(reconcileTaskHistory([running], [completed]), [completed]);
});
