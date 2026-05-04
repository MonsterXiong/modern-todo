import { describe, expect, it } from "vitest";
import { applyTaskCompletion, buildTaskTree } from "./taskRules";
import type { TaskRecord } from "../types";

const baseTask = (task: Partial<TaskRecord> & Pick<TaskRecord, "id" | "title">): TaskRecord => ({
  id: task.id,
  parentId: task.parentId ?? null,
  title: task.title,
  description: task.description ?? "",
  status: task.status ?? "open",
  priority: task.priority ?? "medium",
  dueDate: task.dueDate ?? null,
  completedAt: task.completedAt ?? null,
  sortOrder: task.sortOrder ?? 0,
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z"
});

describe("taskRules", () => {
  it("builds an unlimited-depth task tree ordered by sort order", () => {
    const tasks = [
      baseTask({ id: "leaf-b", parentId: "child", title: "Leaf B", sortOrder: 2 }),
      baseTask({ id: "root", title: "Root", sortOrder: 0 }),
      baseTask({ id: "child", parentId: "root", title: "Child", sortOrder: 0 }),
      baseTask({ id: "leaf-a", parentId: "child", title: "Leaf A", sortOrder: 1 })
    ];

    const tree = buildTaskTree(tasks);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].children[0].id).toBe("child");
    expect(tree[0].children[0].children.map((task) => task.id)).toEqual(["leaf-a", "leaf-b"]);
  });

  it("completes a parent task and every descendant recursively", () => {
    const tasks = [
      baseTask({ id: "root", title: "Root" }),
      baseTask({ id: "child", parentId: "root", title: "Child" }),
      baseTask({ id: "leaf", parentId: "child", title: "Leaf" })
    ];

    const result = applyTaskCompletion(tasks, "root", true);

    expect(result.every((task) => task.status === "completed")).toBe(true);
    expect(result.every((task) => task.completedAt)).toBe(true);
  });

  it("auto-completes ancestors only when all direct children are complete", () => {
    const tasks = [
      baseTask({ id: "root", title: "Root" }),
      baseTask({ id: "a", parentId: "root", title: "A", status: "completed" }),
      baseTask({ id: "b", parentId: "root", title: "B" })
    ];

    const result = applyTaskCompletion(tasks, "b", true);

    expect(result.find((task) => task.id === "root")?.status).toBe("completed");
    expect(result.find((task) => task.id === "root")?.completedAt).toBeTruthy();
  });

  it("reopening a descendant reopens every ancestor without changing siblings", () => {
    const tasks = [
      baseTask({ id: "root", title: "Root", status: "completed", completedAt: "2026-05-04T01:00:00.000Z" }),
      baseTask({ id: "a", parentId: "root", title: "A", status: "completed", completedAt: "2026-05-04T01:00:00.000Z" }),
      baseTask({ id: "b", parentId: "root", title: "B", status: "completed", completedAt: "2026-05-04T01:00:00.000Z" })
    ];

    const result = applyTaskCompletion(tasks, "a", false);

    expect(result.find((task) => task.id === "a")?.status).toBe("open");
    expect(result.find((task) => task.id === "root")?.status).toBe("open");
    expect(result.find((task) => task.id === "b")?.status).toBe("completed");
  });
});
