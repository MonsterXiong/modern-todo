import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { checkForAppUpdate, type UpdateCheckResult } from "./updateService";

export async function checkRuntimeUpdate(): Promise<UpdateCheckResult> {
  return checkForAppUpdate({
    check: () => check({ timeout: 8000 })
  });
}

export async function installAndRelaunch(install: () => Promise<void>): Promise<void> {
  await install();
  await relaunch();
}
