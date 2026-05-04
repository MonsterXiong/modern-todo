import type { TaskNode, TaskRecord } from "../types";

export function buildTaskTree(tasks: TaskRecord[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>();

  for (const task of tasks) {
    nodes.set(task.id, { ...task, children: [] });
  }

  const roots: TaskNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: TaskNode[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    for (const item of items) {
      sortNodes(item.children);
    }
  };

  sortNodes(roots);
  return roots;
}

export function applyTaskCompletion(tasks: TaskRecord[], taskId: string, completed: boolean): TaskRecord[] {
  const now = new Date().toISOString();
  const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]));
  const childMap = buildChildMap(tasks);
  const target = taskMap.get(taskId);

  if (!target) {
    return tasks.map((task) => ({ ...task }));
  }

  if (completed) {
    for (const id of collectDescendantIds(taskId, childMap, true)) {
      const task = taskMap.get(id);
      if (task) {
        task.status = "completed";
        task.completedAt = task.completedAt ?? now;
        task.updatedAt = now;
      }
    }
    syncAncestors(taskId, taskMap, childMap, now);
  } else {
    target.status = "open";
    target.completedAt = null;
    target.updatedAt = now;

    for (const id of collectAncestorIds(taskId, taskMap)) {
      const task = taskMap.get(id);
      if (task) {
        task.status = "open";
        task.completedAt = null;
        task.updatedAt = now;
      }
    }
  }

  return tasks.map((task) => taskMap.get(task.id) ?? task);
}

function buildChildMap(tasks: TaskRecord[]): Map<string, string[]> {
  const childMap = new Map<string, string[]>();

  for (const task of tasks) {
    if (!task.parentId) continue;
    const siblings = childMap.get(task.parentId) ?? [];
    siblings.push(task.id);
    childMap.set(task.parentId, siblings);
  }

  return childMap;
}

function collectDescendantIds(taskId: string, childMap: Map<string, string[]>, includeSelf: boolean): string[] {
  const ids = includeSelf ? [taskId] : [];
  const children = childMap.get(taskId) ?? [];

  for (const childId of children) {
    ids.push(...collectDescendantIds(childId, childMap, true));
  }

  return ids;
}

function collectAncestorIds(taskId: string, taskMap: Map<string, TaskRecord>): string[] {
  const ancestors: string[] = [];
  let current = taskMap.get(taskId);

  while (current?.parentId) {
    ancestors.push(current.parentId);
    current = taskMap.get(current.parentId);
  }

  return ancestors;
}

function syncAncestors(
  taskId: string,
  taskMap: Map<string, TaskRecord>,
  childMap: Map<string, string[]>,
  now: string
) {
  for (const ancestorId of collectAncestorIds(taskId, taskMap)) {
    const childIds = childMap.get(ancestorId) ?? [];
    const allChildrenComplete =
      childIds.length > 0 && childIds.every((childId) => taskMap.get(childId)?.status === "completed");
    const ancestor = taskMap.get(ancestorId);

    if (!ancestor) continue;
    ancestor.status = allChildrenComplete ? "completed" : "open";
    ancestor.completedAt = allChildrenComplete ? ancestor.completedAt ?? now : null;
    ancestor.updatedAt = now;
  }
}
