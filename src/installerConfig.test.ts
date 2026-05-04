import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("installer config", () => {
  it("builds the NSIS installer with Simplified Chinese as the default language", () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, "../src-tauri/tauri.conf.json"), "utf8"));

    expect(config.bundle?.windows?.nsis?.languages).toEqual(["SimpChinese"]);
    expect(config.bundle?.windows?.nsis?.displayLanguageSelector).toBe(false);
  });
});
