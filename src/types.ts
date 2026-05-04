export type TaskStatus = "open" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type PlanType = "week" | "month";

export interface TaskRecord {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskNode extends TaskRecord {
  children: TaskNode[];
}

export interface PlanRecord {
  id: string;
  type: PlanType;
  title: string;
  periodStart: string;
  periodEnd: string;
  summaryText: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanStats {
  total: number;
  completed: number;
  open: number;
  overdue: number;
  completionRate: number;
}

export interface PlanDetail {
  plan: PlanRecord;
  tasks: TaskRecord[];
  stats: PlanStats;
}

export interface CreateTaskInput {
  parentId?: string | null;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
}

export interface UpdateTaskInput {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
}
