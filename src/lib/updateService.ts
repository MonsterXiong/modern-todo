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
    }
  | {
      status: "unavailable";
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

const offlineUpdateMessage = "无法连接更新服务，离线状态下会跳过更新检查。";
const unavailableUpdateMessage =
  "当前安装包未配置更新服务。请使用 GitHub Release 发布的安装包，或在本地构建时注入 updater 配置。";

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
  } catch (error) {
    if (isUpdaterUnavailableError(error)) {
      return {
        status: "unavailable",
        message: unavailableUpdateMessage
      };
    }

    return {
      status: "offline",
      message: offlineUpdateMessage
    };
  }
}

function isUpdaterUnavailableError(error: unknown): boolean {
  const message = errorToMessage(error).toLowerCase();
  const mentionsUpdater = message.includes("plugin:updater") || message.includes("updater");
  const unavailableReason =
    message.includes("not found") ||
    message.includes("not registered") ||
    message.includes("not initialized") ||
    message.includes("not configured") ||
    message.includes("unknown command") ||
    message.includes("permission denied");

  return mentionsUpdater && unavailableReason;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return JSON.stringify(error);
}
