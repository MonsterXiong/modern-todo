import { describe, expect, it } from "vitest";
import { getMonthPeriod, getWeekPeriod } from "./periods";

describe("periods", () => {
  it("uses Monday through Sunday for week periods", () => {
    expect(getWeekPeriod(new Date("2026-05-07T12:00:00.000Z"))).toEqual({
      type: "week",
      title: "2026-W19",
      periodStart: "2026-05-04",
      periodEnd: "2026-05-10"
    });
  });

  it("uses natural months for month periods", () => {
    expect(getMonthPeriod(new Date("2026-05-07T12:00:00.000Z"))).toEqual({
      type: "month",
      title: "2026-05",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31"
    });
  });
});
