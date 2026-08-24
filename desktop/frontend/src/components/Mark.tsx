import type { ReactNode } from "react";

export function Mark({ children }: { children: ReactNode }) {
  return <span className="mark">{children}</span>;
}
