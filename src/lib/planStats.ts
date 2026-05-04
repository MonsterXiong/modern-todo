import type { PlanStats, TaskRecord } from "../types";

export function calculatePlanStats(tasks: TaskRecord[], now = new Date()): PlanStats {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const open = total - completed;
  const today = toDateOnly(now);
  const overdue = tasks.filter((task) => {
    return task.status !== "completed" && task.dueDate !== null && task.dueDate < today;
  }).length;

  return {
    total,
    completed,
    open,
    overdue,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100)
  };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
