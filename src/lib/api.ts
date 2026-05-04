import { invoke } from "@tauri-apps/api/core";
import { calculatePlanStats } from "./planStats";
import { getMonthPeriod, getWeekPeriod, type PeriodDescriptor } from "./periods";
import { applyTaskCompletion } from "./taskRules";
import type {
  CreateTaskInput,
  PlanDetail,
  PlanRecord,
  TaskRecord,
  TaskStatus,
  UpdateTaskInput
} from "../types";

const isTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface TodoApi {
  listTasks(): Promise<TaskRecord[]>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  updateTask(input: UpdateTaskInput): Promise<TaskRecord>;
  deleteTask(id: string): Promise<void>;
  toggleTaskStatus(id: string, completed: boolean): Promise<TaskRecord[]>;
  ensurePlanPeriod(period: PeriodDescriptor): Promise<PlanRecord>;
  addTaskToPlan(planId: string, taskId: string): Promise<void>;
  removeTaskFromPlan(planId: string, taskId: string): Promise<void>;
  getPlanDetail(planId: string): Promise<PlanDetail>;
  updatePlanSummaryText(planId: string, summaryText: string): Promise<PlanRecord>;
}

export const api: TodoApi = isTauriRuntime() ? createTauriApi() : createMockApi();

function createTauriApi(): TodoApi {
  return {
    listTasks: () => invoke<TaskRecord[]>("list_tasks"),
    createTask: (input) => invoke<TaskRecord>("create_task", { input }),
    updateTask: (input) => invoke<TaskRecord>("update_task", { input }),
    deleteTask: (id) => invoke<void>("delete_task", { id }),
    toggleTaskStatus: (id, completed) => invoke<TaskRecord[]>("toggle_task_status", { id, completed }),
    ensurePlanPeriod: (input) => invoke<PlanRecord>("ensure_plan_period", { input }),
    addTaskToPlan: (planId, taskId) => invoke<void>("add_task_to_plan", { planId, taskId }),
    removeTaskFromPlan: (planId, taskId) => invoke<void>("remove_task_from_plan", { planId, taskId }),
    getPlanDetail: (planId) => invoke<PlanDetail>("get_plan_detail", { planId }),
    updatePlanSummaryText: (planId, summaryText) =>
      invoke<PlanRecord>("update_plan_summary_text", { planId, summaryText })
  };
}

function createMockApi(): TodoApi {
  let tasks = seedTasks();
  let plans: PlanRecord[] = [];
  let planTasks: Array<{ planId: string; taskId: string }> = [];

  const api: TodoApi = {
    async listTasks() {
      return clone(tasks);
    },
    async createTask(input) {
      const now = new Date().toISOString();
      const task: TaskRecord = {
        id: crypto.randomUUID(),
        parentId: input.parentId ?? null,
        title: input.title.trim(),
        description: input.description ?? "",
        status: "open",
        priority: input.priority ?? "medium",
        dueDate: input.dueDate ?? null,
        completedAt: null,
        sortOrder: tasks.filter((item) => item.parentId === (input.parentId ?? null)).length,
        createdAt: now,
        updatedAt: now
      };
      tasks = [...tasks, task];
      return clone(task);
    },
    async updateTask(input) {
      const now = new Date().toISOString();
      tasks = tasks.map((task) => (task.id === input.id ? { ...task, ...input, updatedAt: now } : task));
      return clone(tasks.find((task) => task.id === input.id)!);
    },
    async deleteTask(id) {
      const ids = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of tasks) {
          if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
            ids.add(task.id);
            changed = true;
          }
        }
      }
      tasks = tasks.filter((task) => !ids.has(task.id));
      planTasks = planTasks.filter((link) => !ids.has(link.taskId));
    },
    async toggleTaskStatus(id, completed) {
      tasks = applyTaskCompletion(tasks, id, completed);
      return clone(tasks);
    },
    async ensurePlanPeriod(period) {
      const existing = plans.find((plan) => plan.type === period.type && plan.periodStart === period.periodStart);
      if (existing) return clone(existing);

      const now = new Date().toISOString();
      const plan: PlanRecord = {
        id: crypto.randomUUID(),
        type: period.type,
        title: period.title,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        summaryText: "",
        createdAt: now,
        updatedAt: now
      };
      plans = [...plans, plan];
      seedPlanLinks(plan, tasks, planTasks);
      return clone(plan);
    },
    async addTaskToPlan(planId, taskId) {
      if (!planTasks.some((link) => link.planId === planId && link.taskId === taskId)) {
        planTasks = [...planTasks, { planId, taskId }];
      }
    },
    async removeTaskFromPlan(planId, taskId) {
      planTasks = planTasks.filter((link) => link.planId !== planId || link.taskId !== taskId);
    },
    async getPlanDetail(planId) {
      const plan = plans.find((item) => item.id === planId);
      if (!plan) throw new Error("Plan not found");

      const taskIds = new Set(planTasks.filter((link) => link.planId === planId).map((link) => link.taskId));
      const linkedTasks = tasks.filter((task) => taskIds.has(task.id));
      return {
        plan: clone(plan),
        tasks: clone(linkedTasks),
        stats: calculatePlanStats(linkedTasks)
      };
    },
    async updatePlanSummaryText(planId, summaryText) {
      const now = new Date().toISOString();
      plans = plans.map((plan) => (plan.id === planId ? { ...plan, summaryText, updatedAt: now } : plan));
      return clone(plans.find((plan) => plan.id === planId)!);
    }
  };

  void api.ensurePlanPeriod(getWeekPeriod());
  void api.ensurePlanPeriod(getMonthPeriod());
  return api;
}

function seedPlanLinks(
  plan: PlanRecord,
  tasks: TaskRecord[],
  planTasks: Array<{ planId: string; taskId: string }>
) {
  const rootTasks = tasks.filter((task) => task.parentId === null);
  const selected = plan.type === "week" ? rootTasks.slice(0, 3) : rootTasks.slice(1, 4);
  for (const task of selected) {
    planTasks.push({ planId: plan.id, taskId: task.id });
  }
}

function seedTasks(): TaskRecord[] {
  const now = new Date().toISOString();
  return [
    createSeedTask("task-product", null, "完成 TODO 应用 MVP", "high", today(), "open", 0, now),
    createSeedTask("task-schema", "task-product", "设计 SQLite 数据结构", "high", today(), "completed", 0, now),
    createSeedTask("task-ui", "task-product", "实现列表与详情面板", "medium", addDate(1), "open", 1, now),
    createSeedTask("task-week", null, "整理本周重点", "medium", addDate(2), "open", 1, now),
    createSeedTask("task-review", "task-week", "复盘未完成任务", "medium", addDate(2), "open", 0, now),
    createSeedTask("task-month", null, "规划五月目标", "high", addDate(10), "open", 2, now),
    createSeedTask("task-archive", null, "归档历史笔记", "low", addDate(-2), "open", 3, now)
  ];
}

function createSeedTask(
  id: string,
  parentId: string | null,
  title: string,
  priority: TaskRecord["priority"],
  dueDate: string | null,
  status: TaskStatus,
  sortOrder: number,
  timestamp: string
): TaskRecord {
  return {
    id,
    parentId,
    title,
    description: "",
    status,
    priority,
    dueDate,
    completedAt: status === "completed" ? timestamp : null,
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
