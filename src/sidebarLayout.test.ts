import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function cssRule(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match?.[1] ?? "";
}

describe("sidebar layout", () => {
  it("keeps the update controls reachable at the bottom of the sidebar", () => {
    const css = readFileSync(resolve(__dirname, "App.css"), "utf8");

    expect(cssRule(css, ".update-panel")).toContain("order: 2");
    expect(cssRule(css, ".update-panel")).not.toContain("margin-top: auto");
    expect(cssRule(css, ".sidebar-metrics")).toContain("order: 3");
    expect(cssRule(css, ".sidebar-metrics")).toContain("margin-top: auto");
    expect(cssRule(css, ".sidebar")).toContain("overflow-y: auto");
  });
});
