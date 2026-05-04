import { describe, expect, it } from "vitest";
import { calculatePlanStats } from "./planStats";
import type { TaskRecord } from "../types";

const task = (overrides: Partial<TaskRecord> & Pick<TaskRecord, "id" | "title">): TaskRecord => ({
  id: overrides.id,
  parentId: overrides.parentId ?? null,
  title: overrides.title,
  description: "",
  status: overrides.status ?? "open",
  priority: overrides.priority ?? "medium",
  dueDate: overrides.dueDate ?? null,
  completedAt: overrides.completedAt ?? null,
  sortOrder: overrides.sortOrder ?? 0,
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z"
});

describe("planStats", () => {
  it("summarizes completion, open work, overdue work, and completion rate", () => {
    const stats = calculatePlanStats(
      [
        task({ id: "done", title: "Done", status: "completed" }),
        task({ id: "overdue", title: "Overdue", dueDate: "2026-05-01" }),
        task({ id: "future", title: "Future", dueDate: "2026-05-07" }),
        task({ id: "none", title: "No date" })
      ],
      new Date("2026-05-04T12:00:00.000Z")
    );

    expect(stats).toEqual({
      total: 4,
      completed: 1,
      open: 3,
      overdue: 1,
      completionRate: 25
    });
  });

  it("returns zeroed stats for an empty plan", () => {
    expect(calculatePlanStats([], new Date("2026-05-04T12:00:00.000Z"))).toEqual({
      total: 0,
      completed: 0,
      open: 0,
      overdue: 0,
      completionRate: 0
    });
  });
});
