import { describe, expect, it } from "vitest";
import { checkForAppUpdate } from "./updateService";

describe("updateService", () => {
  it("returns up-to-date when the updater reports no update", async () => {
    const result = await checkForAppUpdate({ check: async () => null });

    expect(result).toEqual({ status: "up-to-date" });
  });

  it("treats network failures as offline update checks", async () => {
    const result = await checkForAppUpdate({
      check: async () => {
        throw new Error("network unavailable");
      }
    });

    expect(result).toEqual({
      status: "offline",
      message: "无法连接更新服务，离线状态下会跳过更新检查。"
    });
  });

  it("reports updater plugin errors as unavailable instead of offline", async () => {
    const result = await checkForAppUpdate({
      check: async () => {
        throw new Error("Command plugin:updater|check not found");
      }
    });

    expect(result).toEqual({
      status: "unavailable",
      message: "当前安装包未配置更新服务。请使用 GitHub Release 发布的安装包，或在本地构建时注入 updater 配置。"
    });
  });

  it("returns available update metadata without installing immediately", async () => {
    let installed = false;
    const install = async () => undefined;
    const result = await checkForAppUpdate({
      check: async () => ({
        version: "0.1.1",
        date: "2026-05-04T00:00:00Z",
        body: "Bug fixes",
        downloadAndInstall: async () => {
          installed = true;
          await install();
        }
      })
    });

    expect(result).toMatchObject({
      status: "available",
      version: "0.1.1",
      date: "2026-05-04T00:00:00Z",
      notes: "Bug fixes"
    });
    if (result.status === "available") {
      await result.install();
    }
    expect(installed).toBe(true);
  });
});
