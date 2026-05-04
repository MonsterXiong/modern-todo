import type { PlanType } from "../types";

export interface PeriodDescriptor {
  type: PlanType;
  title: string;
  periodStart: string;
  periodEnd: string;
}

export function getWeekPeriod(date = new Date()): PeriodDescriptor {
  const current = toUtcDateOnly(date);
  const day = current.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(current, mondayOffset);
  const sunday = addDays(monday, 6);

  return {
    type: "week",
    title: `${monday.getUTCFullYear()}-W${String(getIsoWeek(monday)).padStart(2, "0")}`,
    periodStart: formatDate(monday),
    periodEnd: formatDate(sunday)
  };
}

export function getMonthPeriod(date = new Date()): PeriodDescriptor {
  const current = toUtcDateOnly(date);
  const start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const end = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));

  return {
    type: "month",
    title: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
    periodStart: formatDate(start),
    periodEnd: formatDate(end)
  };
}

function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getIsoWeek(date: Date): number {
  const target = new Date(date);
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
