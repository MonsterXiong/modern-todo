import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  FileText,
  Inbox,
  LayoutList,
  ListPlus,
  Download,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Trash2,
  X
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { calculatePlanStats } from "./lib/planStats";
import { getMonthPeriod, getWeekPeriod } from "./lib/periods";
import { checkRuntimeUpdate, installAndRelaunch } from "./lib/runtimeUpdater";
import { buildTaskTree } from "./lib/taskRules";
import type { UpdateCheckResult } from "./lib/updateService";
import type { PlanDetail, PlanRecord, TaskNode, TaskPriority, TaskRecord } from "./types";

type ViewKey = "all" | "today" | "week" | "month" | "unplanned" | "completed";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutList }> = [
  { key: "all", label: "全部任务", icon: LayoutList },
  { key: "today", label: "今天", icon: Inbox },
  { key: "week", label: "本周", icon: CalendarDays },
  { key: "month", label: "本月", icon: ClipboardList },
  { key: "unplanned", label: "未计划", icon: FileText },
  { key: "completed", label: "已完成", icon: Check }
];

const today = () => new Date().toISOString().slice(0, 10);

export default function App() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [activeView, setActiveView] = useState<ViewKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [newRootTitle, setNewRootTitle] = useState("");
  const [newChildTitle, setNewChildTitle] = useState("");
  const [weekPlan, setWeekPlan] = useState<PlanRecord | null>(null);
  const [monthPlan, setMonthPlan] = useState<PlanRecord | null>(null);
  const [weekDetail, setWeekDetail] = useState<PlanDetail | null>(null);
  const [monthDetail, setMonthDetail] = useState<PlanDetail | null>(null);
  const [editor, setEditor] = useState({
    title: "",
    description: "",
    priority: "medium" as TaskPriority,
    dueDate: ""
  });
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [statusText, setStatusText] = useState("");

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedId) ?? null, [selectedId, tasks]);
  const weekIds = useMemo(() => new Set(weekDetail?.tasks.map((task) => task.id) ?? []), [weekDetail]);
  const monthIds = useMemo(() => new Set(monthDetail?.tasks.map((task) => task.id) ?? []), [monthDetail]);

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = (task: TaskRecord) =>
      normalizedQuery.length === 0 ||
      task.title.toLowerCase().includes(normalizedQuery) ||
      task.description.toLowerCase().includes(normalizedQuery);

    return tasks.filter((task) => {
      if (!matchesQuery(task)) return false;
      if (activeView === "today") return task.dueDate === today();
      if (activeView === "week") return weekIds.has(task.id);
      if (activeView === "month") return monthIds.has(task.id);
      if (activeView === "unplanned") return !weekIds.has(task.id) && !monthIds.has(task.id);
      if (activeView === "completed") return task.status === "completed";
      return true;
    });
  }, [activeView, monthIds, query, tasks, weekIds]);

  const visibleTree = useMemo(() => buildTaskTree(visibleTasks), [visibleTasks]);
  const visibleStats = useMemo(() => calculatePlanStats(visibleTasks), [visibleTasks]);
  const activePlanDetail = activeView === "week" ? weekDetail : activeView === "month" ? monthDetail : null;

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      setEditor({ title: "", description: "", priority: "medium", dueDate: "" });
      return;
    }

    setEditor({
      title: selectedTask.title,
      description: selectedTask.description,
      priority: selectedTask.priority,
      dueDate: selectedTask.dueDate ?? ""
    });
  }, [selectedTask]);

  async function refresh(nextSelectedId = selectedId) {
    const weekPeriod = getWeekPeriod();
    const monthPeriod = getMonthPeriod();
    const [nextTasks, ensuredWeek, ensuredMonth] = await Promise.all([
      api.listTasks(),
      api.ensurePlanPeriod(weekPeriod),
      api.ensurePlanPeriod(monthPeriod)
    ]);
    const [nextWeekDetail, nextMonthDetail] = await Promise.all([
      api.getPlanDetail(ensuredWeek.id),
      api.getPlanDetail(ensuredMonth.id)
    ]);

    setTasks(nextTasks);
    setWeekPlan(ensuredWeek);
    setMonthPlan(ensuredMonth);
    setWeekDetail(nextWeekDetail);
    setMonthDetail(nextMonthDetail);
    setExpandedIds(new Set(nextTasks.filter((task) => nextTasks.some((child) => child.parentId === task.id)).map((task) => task.id)));

    if (nextSelectedId && nextTasks.some((task) => task.id === nextSelectedId)) {
      setSelectedId(nextSelectedId);
    } else {
      setSelectedId(nextTasks[0]?.id ?? null);
    }
  }

  async function createRootTask(event: FormEvent) {
    event.preventDefault();
    if (!newRootTitle.trim()) return;
    const task = await api.createTask({ title: newRootTitle, priority: "medium" });
    setNewRootTitle("");
    await refresh(task.id);
    setStatusText("任务已新增");
  }

  async function createChildTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedTask || !newChildTitle.trim()) return;
    const task = await api.createTask({ parentId: selectedTask.id, title: newChildTitle, priority: "medium" });
    setNewChildTitle("");
    await refresh(task.id);
    setStatusText("子任务已新增");
  }

  async function saveSelectedTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedTask || !editor.title.trim()) return;
    await api.updateTask({
      id: selectedTask.id,
      parentId: selectedTask.parentId,
      title: editor.title,
      description: editor.description,
      priority: editor.priority,
      dueDate: editor.dueDate || null
    });
    await refresh(selectedTask.id);
    setStatusText("任务已保存");
  }

  async function toggleTask(task: TaskRecord) {
    await api.toggleTaskStatus(task.id, task.status !== "completed");
    await refresh(task.id);
  }

  async function deleteSelectedTask() {
    if (!selectedTask) return;
    await api.deleteTask(selectedTask.id);
    await refresh(null);
    setStatusText("任务已删除");
  }

  async function togglePlanMembership(plan: PlanRecord | null, included: boolean) {
    if (!plan || !selectedTask) return;
    if (included) {
      await api.removeTaskFromPlan(plan.id, selectedTask.id);
    } else {
      await api.addTaskToPlan(plan.id, selectedTask.id);
    }
    await refresh(selectedTask.id);
  }

  async function savePlanSummary(planId: string, summaryText: string) {
    await api.updatePlanSummaryText(planId, summaryText);
    await refresh(selectedId);
    setStatusText("总结已保存");
  }

  async function checkUpdates() {
    setCheckingUpdate(true);
    const result = await checkRuntimeUpdate();
    setUpdateResult(result);
    setCheckingUpdate(false);

    if (result.status === "up-to-date") {
      setStatusText("当前已是最新版本");
    } else if (result.status === "offline" || result.status === "unavailable") {
      setStatusText(result.message);
    } else {
      setStatusText(`发现新版本 ${result.version}`);
    }
  }

  async function installUpdate() {
    if (updateResult?.status !== "available") return;
    setInstallingUpdate(true);
    await installAndRelaunch(updateResult.install);
  }

  return (
    <div className="app-frame">
      <WindowTitlebar />
      <div className="app-shell">
        <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>Modern TODO</strong>
            <span>Local SQLite</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="任务视图">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={activeView === item.key ? "nav-item active" : "nav-item"}
                onClick={() => setActiveView(item.key)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-metrics">
          <Metric label="任务" value={tasks.length} />
          <Metric label="完成率" value={`${calculatePlanStats(tasks).completionRate}%`} />
          <Metric label="逾期" value={calculatePlanStats(tasks).overdue} tone="warn" />
        </div>

        <UpdatePanel
          result={updateResult}
          checking={checkingUpdate}
          installing={installingUpdate}
          onCheck={checkUpdates}
          onInstall={installUpdate}
        />
        </aside>

        <main className="workspace">
        <section className="task-pane" aria-label="任务列表">
          <header className="pane-header">
            <div>
              <p className="eyebrow">{navItems.find((item) => item.key === activeView)?.label}</p>
              <h1>{activeView === "week" ? weekPlan?.title : activeView === "month" ? monthPlan?.title : "任务工作台"}</h1>
            </div>
            <div className="stats-strip">
              <Metric label="总数" value={visibleStats.total} />
              <Metric label="完成" value={visibleStats.completed} />
              <Metric label="逾期" value={visibleStats.overdue} tone="warn" />
            </div>
          </header>

          <div className="search-row">
            <div className="search-box">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" />
            </div>
          </div>

          <form className="quick-add" onSubmit={createRootTask}>
            <input
              value={newRootTitle}
              onChange={(event) => setNewRootTitle(event.target.value)}
              placeholder="新增大任务"
            />
            <button type="submit" title="新增大任务" aria-label="新增大任务">
              <Plus size={18} />
            </button>
          </form>

          <div className="task-list">
            {visibleTree.length === 0 ? (
              <div className="empty-state">暂无任务</div>
            ) : (
              visibleTree.map((node) => (
                <TaskTreeRow
                  key={node.id}
                  node={node}
                  level={0}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onSelect={setSelectedId}
                  onToggleExpand={(id) =>
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onToggleTask={toggleTask}
                />
              ))
            )}
          </div>
        </section>

        <section className="detail-pane" aria-label="任务详情">
          {selectedTask ? (
            <>
              <header className="detail-header">
                <div>
                  <p className="eyebrow">详情</p>
                  <h2>{selectedTask.title}</h2>
                </div>
                <button className="icon-danger" onClick={deleteSelectedTask} type="button" title="删除任务" aria-label="删除任务">
                  <Trash2 size={18} />
                </button>
              </header>

              <form className="detail-form" onSubmit={saveSelectedTask}>
                <label>
                  标题
                  <input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} />
                </label>
                <label>
                  描述
                  <textarea
                    value={editor.description}
                    onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                    rows={5}
                  />
                </label>
                <div className="field-grid">
                  <label>
                    优先级
                    <select
                      value={editor.priority}
                      onChange={(event) => setEditor({ ...editor, priority: event.target.value as TaskPriority })}
                    >
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </select>
                  </label>
                  <label>
                    截止日期
                    <input
                      type="date"
                      value={editor.dueDate}
                      onChange={(event) => setEditor({ ...editor, dueDate: event.target.value })}
                    />
                  </label>
                </div>
                <button className="primary-action" type="submit">
                  <Save size={17} />
                  保存
                </button>
              </form>

              <div className="plan-actions">
                <button type="button" onClick={() => togglePlanMembership(weekPlan, weekIds.has(selectedTask.id))}>
                  {weekIds.has(selectedTask.id) ? "移出本周" : "加入本周"}
                </button>
                <button type="button" onClick={() => togglePlanMembership(monthPlan, monthIds.has(selectedTask.id))}>
                  {monthIds.has(selectedTask.id) ? "移出本月" : "加入本月"}
                </button>
              </div>

              <form className="subtask-add" onSubmit={createChildTask}>
                <input
                  value={newChildTitle}
                  onChange={(event) => setNewChildTitle(event.target.value)}
                  placeholder="新增子任务"
                />
                <button type="submit" title="新增子任务" aria-label="新增子任务">
                  <ListPlus size={18} />
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state large">暂无选中任务</div>
          )}

          {activePlanDetail && (
            <PlanSummaryPanel detail={activePlanDetail} onSave={savePlanSummary} />
          )}

          {statusText && <p className="status-line">{statusText}</p>}
        </section>
        </main>
      </div>
    </div>
  );
}

function UpdatePanel({
  result,
  checking,
  installing,
  onCheck,
  onInstall
}: {
  result: UpdateCheckResult | null;
  checking: boolean;
  installing: boolean;
  onCheck: () => Promise<void>;
  onInstall: () => Promise<void>;
}) {
  return (
    <div className="update-panel">
      <button type="button" onClick={() => void onCheck()} disabled={checking || installing}>
        <RefreshCw size={15} className={checking ? "spin" : undefined} />
        {checking ? "检查中" : "检查更新"}
      </button>
      {result?.status === "available" && (
        <button className="install-update" type="button" onClick={() => void onInstall()} disabled={installing}>
          <Download size={15} />
          {installing ? "安装中" : `安装 ${result.version}`}
        </button>
      )}
      {result?.status === "offline" && <p>{result.message}</p>}
      {result?.status === "unavailable" && <p>{result.message}</p>}
      {result?.status === "up-to-date" && <p>当前已是最新版本</p>}
    </div>
  );
}

function WindowTitlebar() {
  const appWindow = useMemo(() => {
    const tauriWindow = window as Window & typeof globalThis & { __TAURI_INTERNALS__?: unknown };
    return tauriWindow.__TAURI_INTERNALS__ ? getCurrentWindow() : null;
  }, []);

  async function startDrag(event: React.MouseEvent) {
    if (!appWindow || event.button !== 0) return;
    if (event.detail === 2) {
      await appWindow.toggleMaximize();
      return;
    }
    await appWindow.startDragging();
  }

  return (
    <header className="window-titlebar" onMouseDown={startDrag}>
      <div className="window-title">
        <span className="window-dot" />
        <span>Modern TODO</span>
      </div>
      <div className="window-controls" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" title="最小化" aria-label="最小化" onClick={() => void appWindow?.minimize()}>
          <Minus size={15} />
        </button>
        <button type="button" title="最大化" aria-label="最大化" onClick={() => void appWindow?.toggleMaximize()}>
          <Square size={13} />
        </button>
        <button className="close" type="button" title="关闭" aria-label="关闭" onClick={() => void appWindow?.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
}

function TaskTreeRow({
  node,
  level,
  selectedId,
  expandedIds,
  onSelect,
  onToggleExpand,
  onToggleTask
}: {
  node: TaskNode;
  level: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onToggleTask: (task: TaskRecord) => void;
}) {
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={selectedId === node.id ? "task-row selected" : "task-row"}
        style={{ "--level": level } as React.CSSProperties}
        onClick={() => onSelect(node.id)}
      >
        <button
          className="ghost-icon"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleExpand(node.id);
          }}
          title={expanded ? "收起" : "展开"}
          aria-label={expanded ? "收起" : "展开"}
        >
          {hasChildren ? expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <span />}
        </button>
        <button
          className={node.status === "completed" ? "check-button done" : "check-button"}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void onToggleTask(node);
          }}
          title={node.status === "completed" ? "重新打开" : "完成"}
          aria-label={node.status === "completed" ? "重新打开" : "完成"}
        >
          {node.status === "completed" ? <Check size={15} /> : <Circle size={15} />}
        </button>
        <div className="task-main">
          <strong>{node.title}</strong>
          <span>{node.dueDate ?? "无日期"}</span>
        </div>
        <span className={`priority ${node.priority}`}>{priorityLabel(node.priority)}</span>
      </div>
      {expanded &&
        node.children.map((child) => (
          <TaskTreeRow
            key={child.id}
            node={child}
            level={level + 1}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onToggleTask={onToggleTask}
          />
        ))}
    </>
  );
}

function PlanSummaryPanel({
  detail,
  onSave
}: {
  detail: PlanDetail;
  onSave: (planId: string, summaryText: string) => Promise<void>;
}) {
  const [summary, setSummary] = useState(detail.plan.summaryText);

  useEffect(() => {
    setSummary(detail.plan.summaryText);
  }, [detail.plan.summaryText, detail.plan.id]);

  return (
    <div className="summary-panel">
      <div className="summary-head">
        <div>
          <p className="eyebrow">归纳总结</p>
          <h3>{detail.plan.title}</h3>
        </div>
        <div className="summary-rate">{detail.stats.completionRate}%</div>
      </div>
      <div className="summary-grid">
        <Metric label="任务" value={detail.stats.total} />
        <Metric label="未完成" value={detail.stats.open} />
        <Metric label="逾期" value={detail.stats.overdue} tone="warn" />
      </div>
      <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={5} />
      <button className="primary-action" type="button" onClick={() => onSave(detail.plan.id, summary)}>
        <Save size={17} />
        保存总结
      </button>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className={tone === "warn" ? "metric warn" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function priorityLabel(priority: TaskPriority) {
  return priority === "high" ? "高" : priority === "low" ? "低" : "中";
}
