export type UpdateCheckResult =
  | { status: "up-to-date" }
  | {
      status: "available";
      version: string;
      date?: string;
      notes?: string;
      install: () => Promise<void>;
    }
  | {
      status: "offline";
      message: string;
    };

export interface UpdateChecker {
  check: () => Promise<AvailableUpdate | null>;
}

export interface AvailableUpdate {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

export async function checkForAppUpdate(checker: UpdateChecker): Promise<UpdateCheckResult> {
  try {
    const update = await checker.check();

    if (!update) {
      return { status: "up-to-date" };
    }

    return {
      status: "available",
      version: update.version,
      date: update.date,
      notes: update.body,
      install: update.downloadAndInstall.bind(update)
    };
  } catch {
    return {
      status: "offline",
      message: "无法连接更新服务，离线状态下会跳过更新检查。"
    };
  }
}
