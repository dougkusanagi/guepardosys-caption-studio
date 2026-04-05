import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { cp, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const SRC_TAURI_DIR = path.join(ROOT_DIR, "src-tauri");
const FRONTEND_URL = "http://127.0.0.1:5173/";
const BUILD_DIR = path.join(SRC_TAURI_DIR, ".dev-target");
const RUNS_DIR = path.join(SRC_TAURI_DIR, ".dev-run");
const BUILD_OUTPUT_DIR = path.join(BUILD_DIR, "debug");
const EXE_NAME = process.platform === "win32" ? "studiocut.exe" : "studiocut";
const PDB_NAME = "studiocut.pdb";
const MODELS_DIR = "models";
const WATCH_FILES = [
  path.join(SRC_TAURI_DIR, "build.rs"),
  path.join(SRC_TAURI_DIR, "Cargo.toml"),
  path.join(SRC_TAURI_DIR, "Cargo.lock"),
  path.join(SRC_TAURI_DIR, "tauri.conf.json"),
];
const WATCH_DIRS = [
  path.join(SRC_TAURI_DIR, "icons"),
  path.join(SRC_TAURI_DIR, "src"),
];
const RESTART_DEBOUNCE_MS = 250;
const FRONTEND_TIMEOUT_MS = 60_000;
const RUN_DIRS_TO_KEEP = 3;

let frontendProcess = null;
let appProcess = null;
let ownsFrontend = false;
let shuttingDown = false;
let restartInFlight = false;
let restartRequested = false;
let restartTimer = null;
let watcherClosers = [];
let runCounter = 0;

function log(message) {
  console.log(`[dev] ${message}`);
}

function warn(message) {
  console.error(`[dev] ${message}`);
}

function bunCommand() {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

function cargoCommand() {
  return process.platform === "win32" ? "cargo.exe" : "cargo";
}

function taskkillCommand() {
  return process.platform === "win32" ? "taskkill.exe" : "kill";
}

function createChild(command, args, options = {}) {
  return spawn(command, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      ...options.env,
    },
    ...options,
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn(taskkillCommand(), ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    });
    await waitForExit(killer);
    await Promise.race([waitForExit(child), delay(2_000)]);
    return;
  }

  child.kill("SIGTERM");
  const result = await Promise.race([waitForExit(child), delay(2_000).then(() => null)]);
  if (!result && child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

async function isUrlReady(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForFrontend(url, timeoutMs = FRONTEND_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isUrlReady(url)) {
      return;
    }

    if (frontendProcess && frontendProcess.exitCode !== null) {
      throw new Error("o frontend encerrou antes de responder");
    }

    await delay(400);
  }

  throw new Error(`frontend indisponivel em ${url} apos ${timeoutMs / 1000}s`);
}

async function ensureFrontend() {
  if (await isUrlReady(FRONTEND_URL)) {
    log(`reutilizando frontend existente em ${FRONTEND_URL}`);
    return;
  }

  log("iniciando Vite em background");
  ownsFrontend = true;
  frontendProcess = createChild(bunCommand(), ["run", "dev:frontend"]);
  frontendProcess.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    warn(`frontend encerrou (${code ?? signal ?? "sem status"})`);
    shutdown(code ?? 1);
  });

  await waitForFrontend(FRONTEND_URL);
  log(`frontend pronto em ${FRONTEND_URL}`);
}

async function buildBackend() {
  await mkdir(BUILD_DIR, { recursive: true });

  const child = createChild(cargoCommand(), [
    "build",
    "--no-default-features",
    "--color",
    "always",
    "--manifest-path",
    path.join("src-tauri", "Cargo.toml"),
  ], {
    env: {
      CARGO_TARGET_DIR: BUILD_DIR,
    },
  });

  const { code, signal } = await waitForExit(child);
  if (code !== 0) {
    throw new Error(`cargo build falhou (${code ?? signal ?? "sem status"})`);
  }
}

async function copyIfExists(source, destination) {
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function copyDirectoryIfExists(source, destination) {
  try {
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function prepareRunDirectory() {
  runCounter += 1;
  const runId = `${Date.now()}-${runCounter}`;
  const runDir = path.join(RUNS_DIR, `run-${runId}`);
  const sourceExe = path.join(BUILD_OUTPUT_DIR, EXE_NAME);

  await mkdir(runDir, { recursive: true });
  await copyFile(sourceExe, path.join(runDir, EXE_NAME));
  await copyIfExists(path.join(BUILD_OUTPUT_DIR, PDB_NAME), path.join(runDir, PDB_NAME));
  await copyDirectoryIfExists(path.join(BUILD_OUTPUT_DIR, MODELS_DIR), path.join(runDir, MODELS_DIR));

  return runDir;
}

async function pruneRunDirectories() {
  await mkdir(RUNS_DIR, { recursive: true });
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const dirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(RUNS_DIR, entry.name);
    const info = await stat(fullPath);
    dirs.push({ fullPath, mtimeMs: info.mtimeMs });
  }

  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const staleDirs = dirs.slice(RUN_DIRS_TO_KEEP);

  for (const dir of staleDirs) {
    try {
      await rm(dir.fullPath, { recursive: true, force: true });
    } catch {
      // Vanguard can keep old copies locked for a while. Best effort cleanup is enough.
    }
  }
}

function launchApp(runDir) {
  const executable = path.join(runDir, EXE_NAME);
  const child = createChild(executable, [], { cwd: ROOT_DIR });
  appProcess = child;

  child.once("exit", (code, signal) => {
    if (appProcess && appProcess.pid !== child.pid) {
      return;
    }

    appProcess = null;

    if (shuttingDown || restartInFlight || restartRequested) {
      return;
    }

    warn(`app encerrou (${code ?? signal ?? "sem status"})`);
  });
}

async function rebuildAndRelaunch(reason) {
  if (shuttingDown) {
    return;
  }

  if (restartInFlight) {
    restartRequested = true;
    return;
  }

  restartInFlight = true;

  try {
    if (reason) {
      log(`rebuild do backend (${reason})`);
    }

    if (appProcess) {
      const currentApp = appProcess;
      appProcess = null;
      await terminateProcess(currentApp);
    }

    await buildBackend();
    if (shuttingDown) {
      return;
    }

    const runDir = await prepareRunDirectory();
    launchApp(runDir);
    await pruneRunDirectories();
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
  } finally {
    restartInFlight = false;

    if (restartRequested && !shuttingDown) {
      restartRequested = false;
      await rebuildAndRelaunch("alteracao pendente");
    }
  }
}

function scheduleRebuild(reason) {
  if (shuttingDown) {
    return;
  }

  if (restartInFlight) {
    restartRequested = true;
    return;
  }

  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    rebuildAndRelaunch(reason);
  }, RESTART_DEBOUNCE_MS);
}

function startBackendWatchers() {
  const closers = [];

  for (const watchedDir of WATCH_DIRS) {
    const watcher = watch(watchedDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) {
        scheduleRebuild(path.basename(watchedDir));
        return;
      }

      scheduleRebuild(String(filename));
    });

    closers.push(() => watcher.close());
  }

  for (const watchedFile of WATCH_FILES) {
    const watcher = watch(watchedFile, () => {
      scheduleRebuild(path.basename(watchedFile));
    });

    closers.push(() => watcher.close());
  }

  watcherClosers = closers;
}

async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearTimeout(restartTimer);

  for (const close of watcherClosers) {
    try {
      close();
    } catch {
      // Ignore watcher close failures during shutdown.
    }
  }

  watcherClosers = [];

  const currentApp = appProcess;
  appProcess = null;
  await terminateProcess(currentApp);

  if (ownsFrontend) {
    const currentFrontend = frontendProcess;
    frontendProcess = null;
    await terminateProcess(currentFrontend);
  }

  process.exit(code);
}

async function runWindowsDevFlow() {
  await ensureFrontend();
  startBackendWatchers();
  await rebuildAndRelaunch("inicial");
}

async function runDefaultTauriDev() {
  const child = createChild(bunCommand(), ["run", "dev:tauri"]);
  const { code, signal } = await waitForExit(child);
  process.exit(code ?? (signal ? 1 : 0));
}

process.on("SIGINT", () => {
  shutdown(0);
});

process.on("SIGTERM", () => {
  shutdown(0);
});

process.on("uncaughtException", async (error) => {
  warn(error instanceof Error ? error.stack ?? error.message : String(error));
  await shutdown(1);
});

process.on("unhandledRejection", async (error) => {
  warn(error instanceof Error ? error.stack ?? error.message : String(error));
  await shutdown(1);
});

if (process.platform !== "win32") {
  await runDefaultTauriDev();
} else {
  await runWindowsDevFlow();
}
