import type { ProviderID, TaskEvent } from "../providers/types.ts";

function value(payload: Record<string, unknown>, key: string): string {
  return String(payload[key] ?? "");
}

function sameProgress(left: TaskEvent, right: TaskEvent): boolean {
  return left.type === "progress"
    && right.type === "progress"
    && value(left.payload, "stage") === value(right.payload, "stage")
    && value(left.payload, "completed") === value(right.payload, "completed")
    && value(left.payload, "total") === value(right.payload, "total")
    && value(left.payload, "unit") === value(right.payload, "unit");
}

/**
 * Cloud workers cross several containers, each of which has useful operator
 * diagnostics.  A task timeline is for users rather than operators: retain
 * lifecycle, handoffs, changed progress and actionable warnings, while hiding
 * diagnostics that remain available in Modal's own logs.
 *
 * Local logs stay unchanged because they are the only diagnostics available
 * for a process running on the user's machine.
 */
export function visibleTaskEvents(events: TaskEvent[], provider: ProviderID): TaskEvent[] {
  if (provider !== "cloud") return events;

  const visible: TaskEvent[] = [];
  for (const event of events) {
    if (event.type === "log") continue;
    // Provider/model routing is deployment telemetry.  It is intentionally
    // absent from the customer-facing cloud task log.
    if (event.type === "warning" && value(event.payload, "code").startsWith("routing-")) continue;

    const previous = visible.at(-1);
    if (previous && sameProgress(previous, event)) {
      // Prefer the newest heartbeat without allowing an unchanged counter to
      // consume one line every ten seconds.
      visible[visible.length - 1] = event;
      continue;
    }
    visible.push(event);
  }
  return visible;
}
