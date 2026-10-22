const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  shell,
  nativeTheme,
  Menu,
} = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { version: ONYX_VERSION } = require("../package.json");
const { AuthService } = require("./services/auth.cjs");
const { defaultDataRoot } = require("./services/platform.cjs");
const { JavaService, inspectJava, findSystemJava } = require("./services/java.cjs");
const {
  MinecraftService,
  loaderInfo,
  normalizeResolvedVersionId,
  parseServerAddress,
} = require("./services/minecraft.cjs");
const { ModpackService } = require("./services/modpack.cjs");
const {
  checkModUpdates,
  listModHistory,
  rollbackModUpdate,
  updateMod,
  safeModrinthDownload,
} = require("./services/content.cjs");
const {
  directoryStats,
  createInstanceBackup,
  importInstanceBackup,
  removePartialFiles,
} = require("./services/maintenance.cjs");
const {
  analyzeInstanceStorage,
  cleanupInstanceStorage,
} = require("./services/instance-storage.cjs");
const {
  analyzeMinecraftLog,
  extractCrashReport,
  detectCrashAutoFix,
  applyCrashAutoFix,
} = require("./services/log-analysis.cjs");
const { checkInstanceHealth } = require("./services/preflight.cjs");
const { getOnyxPicks } = require("./services/picks.cjs");
const screenshotsService = require("./services/screenshots.cjs");
const { TelemetryService } = require("./services/telemetry.cjs");
const {
  recommendInstanceResources,
} = require("./services/tuning.cjs");
const { pingMinecraftServer } = require("./services/server-status.cjs");
const {
  snapshotMods,
  readModBaseline,
  writeModBaseline,
  recentModChanges,
  disableSuspectMods,
} = require("./services/guard.cjs");
const {
  readBisectSession,
  startBisect,
  reportBisectResult,
  cancelBisect,
  finishBisect,
} = require("./services/bisect.cjs");
const {
  applyModProfile,
  deleteModProfile,
  listModProfiles,
  saveModProfile,
} = require("./services/mod-profiles.cjs");
const resourcepackService = require("./services/resourcepack.cjs");
const {
  createWorldSnapshot,
  listWorldSnapshots,
  restoreWorldSnapshot,
} = require("./services/world-guard.cjs");
const {
  createSyncProfile,
  validateSyncProfile,
  identifySyncMods,
  installSyncMods,
  uploadShareProfile,
  fetchShareProfile,
  parseShareIdOrUrl,
} = require("./services/sync.cjs");
const {
  FlightRecorder,
  buildRegressionInsights,
} = require("./services/flight-recorder.cjs");
const {
  detectFpsRecorder,
  buildFpsInsights,
  FpsRecorder,
} = require("./services/fps-recorder.cjs");
const {
  createSupportBundle,
} = require("./services/support-bundle.cjs");
const {
  buildPerformanceCsv,
} = require("./services/performance-csv.cjs");
const {
  checkSkinLoaderStatus,
  installCustomSkinLoader,
  syncOfflineSkin,
} = require("./services/offline-skin.cjs");
const {
  fetchJson,
  downloadFile,
  hashFile,
} = require("./services/network.cjs");
const {
  detectAllInstalledInstances,
  inspectCustomDirectory,
  migrateInstanceFiles,
  createOnyxInstanceFromCandidate,
} = require("./services/migration.cjs");
const curseforgeService = require("./services/curseforge.cjs");
const { UpdaterService } = require("./services/updater.cjs");
const { DiscordRpcService } = require("./services/discord-rpc.cjs");
const partySvc = require("./services/party.cjs");

if (process.env.SCOPE_USER_DATA || process.env.ONYX_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.SCOPE_USER_DATA || process.env.ONYX_USER_DATA));
}

// Auto-migration for existing users from Onyx Launcher to Scope Launcher
try {
  const currentUserData = app.getPath("userData");
  const appData = app.getPath("appData");
  const legacyDirs = [
    path.join(appData, "Onyx Launcher"),
    path.join(appData, "onyx-launcher"),
    path.join(os.homedir(), ".config", "onyx-launcher"),
  ];

  for (const legacyDir of legacyDirs) {
    if (!fs.existsSync(legacyDir)) continue;

    fs.mkdirSync(currentUserData, { recursive: true });

    // Copy critical config and session files
    const filesToMigrate = ["state.json", "account.json", "credentials.json"];
    for (const fileName of filesToMigrate) {
      const src = path.join(legacyDir, fileName);
      const dest = path.join(currentUserData, fileName);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.copyFileSync(src, dest);
        } catch {
          // Ignore copy error
        }
      }
    }

    // Copy helper tools if present
    const legacyToolsDir = path.join(legacyDir, "tools");
    const currentToolsDir = path.join(currentUserData, "tools");
    if (fs.existsSync(legacyToolsDir) && !fs.existsSync(currentToolsDir)) {
      try {
        fs.cpSync(legacyToolsDir, currentToolsDir, { recursive: true });
      } catch {
        // Ignore copy error
      }
    }

    break;
  }
} catch {
  // Migration error is non-fatal
}

try {
  const bootstrapState = JSON.parse(
    fs.readFileSync(path.join(app.getPath("userData"), "state.json"), "utf8"),
  );
  if (bootstrapState?.settings?.hardwareAcceleration === false) {
    app.disableHardwareAcceleration();
  }
} catch {
  // First launch or an unreadable state is handled by the normal migration.
}

const DEFAULT_STATE = {
  profile: {
    name: "Player",
    kind: "local",
  },
  settings: {
    language: "en",
    memory: 6,
    gameDirectory: "",
    javaPath: "",
    closeOnLaunch: false,
    keepLauncherOpen: true,
    ghostMode: false,
    hardwareAcceleration: true,
    showSnapshots: false,
    notifications: true,
    autoCheckUpdates: true,
    reducedMotion: false,
    onboardingComplete: false,
    accent: "lime",
    windowWidth: 1280,
    windowHeight: 720,
    fullscreen: false,
    telemetry: true,
    anonymousClientId: "",
    discordRpc: true,
    discordRpcShowGame: true,
    discordRpcShowTime: true,
    discordRpcShowServer: true,
    discordRpcShowWorld: true,
    discordRpcHideServerIp: false,
  },
  instances: [
    {
      id: "vanilla-start",
      name: "Pure Game",
      version: "1.21.1",
      loader: "Vanilla",
      description: "Minecraft without modifications",
      color: "lime",
      glyph: "MC",
      favorite: true,
      status: "setup",
      lastPlayed: "Never played",
      playtimeMinutes: 0,
      modCount: 0,
    },
  ],
  downloads: [],
  sessions: [],
};

let mainWindow;
let ghostModeActive = false;
let statePath;
let state = structuredClone(DEFAULT_STATE);
let authService;
let javaService;
const updaterService = new UpdaterService({ currentVersion: ONYX_VERSION });
const telemetryService = new TelemetryService();
const discordRpcService = new DiscordRpcService({
  clientId: "1548737210139025568",
  version: ONYX_VERSION,
});
const runningGames = new Map();

function offlineUuid(name) {
  const hash = crypto.createHash("md5").update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
const installLocks = new Map();
const installControllers = new Map();
const downloadControllers = new Map();
const instanceStorageCache = new Map();

function getStatePath() {
  return path.join(app.getPath("userData"), "state.json");
}

function onyxRoot() {
  const preferred = defaultDataRoot({
    env: process.env,
    home: app.getPath("home"),
    appData: app.getPath("appData"),
  });
  if (process.platform !== "linux" || process.env.ONYX_DATA_ROOT) {
    return preferred;
  }
  const legacy = path.join(app.getPath("appData"), ".onyx");
  const configuredDirectory = state.settings?.gameDirectory;
  const usesLegacyDirectory =
    typeof configuredDirectory === "string" &&
    (path.resolve(configuredDirectory) === path.resolve(legacy) ||
      path.resolve(configuredDirectory).startsWith(
        `${path.resolve(legacy)}${path.sep}`,
      ));
  if (
    usesLegacyDirectory ||
    (fs.existsSync(legacy) && !fs.existsSync(preferred))
  ) {
    return legacy;
  }
  return preferred;
}

function createServices() {
  const sharedRoot = path.join(onyxRoot(), "shared");
  const minecraftService = new MinecraftService({
    sharedRoot,
    instancesRoot: state.settings.gameDirectory,
    javaService,
  });
  const modpackService = new ModpackService({
    packsRoot: path.join(onyxRoot(), "packs"),
    instancesRoot: state.settings.gameDirectory,
    minecraftService,
  });
  return { minecraftService, modpackService };
}

function effectiveSettings(instance) {
  const overrides = instance?.settings || {};
  const servers = Array.isArray(overrides.servers) ? overrides.servers : [];
  const selectedServer =
    servers.find((server) => server.id === overrides.selectedServerId) ||
    servers[0];
  return {
    ...state.settings,
    ...overrides,
    javaPath: overrides.javaPath || state.settings.javaPath,
    serverAddress: selectedServer?.address || overrides.serverAddress || "",
  };
}

async function preflightInstance(instance, persist = true) {
  const health = await checkInstanceHealth({
    instance,
    settings: effectiveSettings(instance),
    sharedRoot: path.join(onyxRoot(), "shared"),
    instancesRoot: state.settings.gameDirectory,
  });
  instance.health = health;
  instanceUpdate(instance, { health });
  if (persist) await saveState();
  return structuredClone(health);
}

function preflightBlockedMessage(health) {
  if (health.blocker === "disk-critical") {
    return "Not enough disk space for a safe launch";
  }
  if (health.blocker === "memory-impossible") {
    return "The instance is allocated more memory than the system can safely provide";
  }
  if (health.blocker === "instance-directory-readonly") {
    return "The instance folder is not writable";
  }
  return "The instance failed the preflight check";
}

function sanitizeSettingsPatch(input = {}) {
  const output = {};
  const booleans = [
    "closeOnLaunch",
    "keepLauncherOpen",
    "ghostMode",
    "hardwareAcceleration",
    "showSnapshots",
    "notifications",
    "autoCheckUpdates",
    "reducedMotion",
    "onboardingComplete",
    "fullscreen",
    "telemetry",
    "discordRpc",
    "discordRpcShowGame",
    "discordRpcShowTime",
    "discordRpcShowServer",
    "discordRpcShowWorld",
    "discordRpcHideServerIp",
  ];
  for (const key of booleans) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  if (Number.isFinite(input.memory)) {
    output.memory = Math.max(2, Math.min(64, Math.round(input.memory)));
  }
  if (Number.isFinite(input.windowWidth)) {
    output.windowWidth = Math.max(
      640,
      Math.min(7680, Math.round(input.windowWidth)),
    );
  }
  if (Number.isFinite(input.windowHeight)) {
    output.windowHeight = Math.max(
      480,
      Math.min(4320, Math.round(input.windowHeight)),
    );
  }
  if (["lime", "violet", "cyan"].includes(input.accent)) {
    output.accent = input.accent;
  }
  if (input.language === "en" || input.language === "ru") {
    output.language = input.language;
  }
  if (typeof input.javaPath === "string") {
    output.javaPath = input.javaPath.trim().slice(0, 1024);
  }
  return output;
}

async function loadState() {
  statePath = getStatePath();
  try {
    const parsed = JSON.parse(await fsp.readFile(statePath, "utf8"));
    state = {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      profile: {
        ...DEFAULT_STATE.profile,
        ...(parsed.profile || {}),
      },
      settings: {
        ...DEFAULT_STATE.settings,
        ...(parsed.settings || {}),
      },
      instances: Array.isArray(parsed.instances)
        ? parsed.instances
        : structuredClone(DEFAULT_STATE.instances),
      downloads: Array.isArray(parsed.downloads) ? parsed.downloads : [],
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.slice(0, 500)
        : [],
    };
    if (typeof parsed.settings?.onboardingComplete !== "boolean") {
      state.settings.onboardingComplete = true;
    }
  } catch {
    state = structuredClone(DEFAULT_STATE);
  }

  const legacyDefaults = {
    player: "\u0418\u0433\u0440\u043e\u043a",
    pureGame: "\u0427\u0438\u0441\u0442\u0430\u044f \u0438\u0433\u0440\u0430",
    description:
      "Minecraft \u0431\u0435\u0437 \u043c\u043e\u0434\u0438\u0444\u0438\u043a\u0430\u0446\u0438\u0439",
    neverPlayed:
      "\u0415\u0449\u0451 \u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u043a\u0430\u043b\u0441\u044f",
  };
  if (state.settings.language !== "en" && state.settings.language !== "ru") {
    state.settings.language = "en";
  }
  if (state.profile.name === legacyDefaults.player) state.profile.name = "Player";
  if (!state.settings.gameDirectory) {
    state.settings.gameDirectory = path.join(onyxRoot(), "instances");
  }
  if (typeof state.settings.telemetry !== "boolean") {
    state.settings.telemetry = true;
  }
  if (!state.settings.anonymousClientId) {
    state.settings.anonymousClientId = telemetryService.ensureAnonymousId();
  }
  for (const instance of state.instances) {
    if (instance.id === "vanilla-start") {
      if (instance.name === legacyDefaults.pureGame) instance.name = "Pure Game";
      if (instance.description === legacyDefaults.description) {
        instance.description = "Minecraft without modifications";
      }
    }
    if (instance.lastPlayed === legacyDefaults.neverPlayed) {
      instance.lastPlayed = "Never played";
    }
    normalizeResolvedVersionId(instance);
    if (
      instance.status === "running" ||
      instance.status === "installing" ||
      (instance.status === "ready" && !instance.resolvedVersionId)
    ) {
      instance.status = instance.resolvedVersionId ? "ready" : "setup";
    }
  }
  for (const task of state.downloads) {
    if (
      task.status === "queued" ||
      task.status === "downloading" ||
      task.status === "installing"
    ) {
      task.status = "error";
      task.error = "The download was interrupted when the launcher closed";
      if (
        /^[a-f0-9-]{36}$/i.test(task.instanceId || "") &&
        !state.instances.some((instance) => instance.id === task.instanceId)
      ) {
        await fsp
          .rm(
            path.join(state.settings.gameDirectory, task.instanceId),
            { recursive: true, force: true },
          )
          .catch(() => undefined);
      }
    }
  }
  state.downloads = state.downloads.slice(0, 50);
  await saveState();
}

let savePromise = Promise.resolve();

async function saveState() {
  savePromise = savePromise.then(async () => {
    if (!statePath) statePath = getStatePath();
    await fsp.mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await fsp.rm(statePath, { force: true }).catch(() => undefined);
    await fsp.rename(temporaryPath, statePath);
  });
  return savePromise;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function serializeState() {
  return structuredClone({
    ...state,
    instances: state.instances.map((instance) => {
      const launches = runningGames.get(instance.id);
      const isRunning = Boolean(launches && launches.size > 0);
      return {
        ...instance,
        status: isRunning ? "running" : instance.status,
        runningCount: launches?.size || 0,
      };
    }),
  });
}

function setupApplicationMenu() {
  if (process.platform === "darwin") {
    const template = [
      {
        label: app.name || "Scope Launcher",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}

async function createWindow() {
  setupApplicationMenu();
  const capturePath = process.env.ONYX_CAPTURE_PATH;
  const bounds = state.settings.launcherBounds || {};
  const launcherWindow = new BrowserWindow({
    width: bounds.width || 1440,
    height: bounds.height || 900,
    x: capturePath ? -10_000 : bounds.x,
    y: capturePath ? -10_000 : bounds.y,
    minWidth: 1120,
    minHeight: 700,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#090b0d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      spellcheck: false,
      enableWebSQL: false,
    },
  });
  mainWindow = launcherWindow;

  launcherWindow.once("ready-to-show", () => {
    if (state.settings.launcherMaximized) launcherWindow.maximize();
    if (capturePath) launcherWindow.showInactive();
    else launcherWindow.show();
  });
  launcherWindow.on("maximize", () => send("window:maximized", true));
  launcherWindow.on("unmaximize", () => send("window:maximized", false));
  launcherWindow.on("close", () => {
    if (!launcherWindow.isMaximized()) {
      state.settings.launcherBounds = launcherWindow.getBounds();
    }
    state.settings.launcherMaximized = launcherWindow.isMaximized();
    void saveState();
  });
  launcherWindow.on("closed", () => {
    if (mainWindow === launcherWindow) mainWindow = null;
  });
  launcherWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  launcherWindow.webContents.on("will-navigate", (event, url) => {
    const current = launcherWindow.webContents.getURL();
    if (url !== current && !url.startsWith("file:")) event.preventDefault();
  });
  launcherWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  const rendererSession = launcherWindow.webContents.session;
  rendererSession.setPermissionRequestHandler(
    (_webContents, permission, callback) =>
      callback(
        permission === "clipboard-sanitized-write" ||
        permission === "clipboard-read",
      ),
  );
  rendererSession.setPermissionCheckHandler(
    (_webContents, permission) =>
      permission === "clipboard-sanitized-write" ||
      permission === "clipboard-read",
  );

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await launcherWindow.loadURL(devUrl);
  else
    await launcherWindow.loadFile(
      path.join(__dirname, "..", "dist", "index.html"),
    );

  if (capturePath) {
    if (process.env.ONYX_CAPTURE_TARGET) {
      const targets = process.env.ONYX_CAPTURE_TARGET.split(">")
        .map((target) => target.trim())
        .filter(Boolean);
      for (const target of targets) {
        let clicked = false;
        for (let attempt = 0; attempt < 25; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          clicked = await launcherWindow.webContents.executeJavaScript(
            `(() => {
              const target = ${JSON.stringify(target)};
              const elements = [
                ...document.querySelectorAll("button, [data-capture-target], [role='button'], .dropdown-item, .project-detail__tab, .project-card, .catalog-feature")
              ];
              const element = elements.find((item) =>
                [
                  item.getAttribute("data-capture-target"),
                  item.textContent,
                  item.getAttribute("aria-label"),
                  item.title
                ]
                  .filter(Boolean)
                  .some((value) => value.toLowerCase().includes(target.toLowerCase()))
              );
              if (element) {
                element.scrollIntoView({ block: "center", inline: "nearest" });
                element.click();
                return true;
              }
              return false;
            })()`,
          );
          if (clicked) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            break;
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const image = await launcherWindow.capturePage();
    await fsp.writeFile(path.resolve(capturePath), image.toPNG());
    app.quit();
  }
}

function enterGhostMode() {
  const launcherWindow = mainWindow;
  if (
    !state.settings.ghostMode ||
    !launcherWindow ||
    launcherWindow.isDestroyed()
  ) {
    return;
  }
  if (!launcherWindow.isMaximized()) {
    state.settings.launcherBounds = launcherWindow.getBounds();
  }
  state.settings.launcherMaximized = launcherWindow.isMaximized();
  ghostModeActive = true;
  void saveState();
  launcherWindow.destroy();
}

async function restoreLauncherWindow() {
  ghostModeActive = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const taskLastEmits = new Map();
const taskTrailingTimers = new Map();

function taskUpdate(task, patch, force = false) {
  Object.assign(task, patch);
  const now = Date.now();
  const lastEmit = taskLastEmits.get(task.id) || 0;
  const isTerminal = ["done", "error", "cancelled"].includes(patch.status || task.status);

  if (isTerminal) {
    const activeTimer = taskTrailingTimers.get(task.id);
    if (activeTimer) {
      clearTimeout(activeTimer);
      taskTrailingTimers.delete(task.id);
    }
    taskLastEmits.set(task.id, now);
    send("download:progress", structuredClone(task));
    if (
      patch.status === "done" &&
      state.settings.notifications &&
      Notification.isSupported()
    ) {
      new Notification({
        title: "Scope Launcher",
        body: `${task.name}: installation completed`,
        silent: false,
      }).show();
    }
    return;
  }

  if (force || now - lastEmit >= 1000) {
    const activeTimer = taskTrailingTimers.get(task.id);
    if (activeTimer) {
      clearTimeout(activeTimer);
      taskTrailingTimers.delete(task.id);
    }
    taskLastEmits.set(task.id, now);
    send("download:progress", structuredClone(task));
  } else if (!taskTrailingTimers.has(task.id)) {
    const remaining = 1000 - (now - lastEmit);
    const timer = setTimeout(() => {
      taskTrailingTimers.delete(task.id);
      taskLastEmits.set(task.id, Date.now());
      send("download:progress", structuredClone(task));
    }, Math.max(50, remaining));
    taskTrailingTimers.set(task.id, timer);
  }
}

function isDownloadingStage(stage) {
  return [
    "pack",
    "content",
    "minecraft",
    "java",
    "loader",
    "downloading",
    "downloading_pack",
    "downloading_mods",
  ].includes(stage);
}

function createProgressTracker() {
  let lastStage = null;
  let stageBaseReceived = 0;
  let accumulatedTotal = 0;
  let currentStageTotal = 0;

  return (progress) => {
    const stage = progress.stage || "default";
    if (stage !== lastStage) {
      if (currentStageTotal > 0) {
        stageBaseReceived += currentStageTotal;
        accumulatedTotal += currentStageTotal;
      }
      currentStageTotal = 0;
      lastStage = stage;
    }

    if (typeof progress.total === "number" && progress.total > 0) {
      currentStageTotal = Math.max(currentStageTotal, progress.total);
    }

    const hasBytes = typeof progress.received === "number";
    const total = accumulatedTotal + currentStageTotal || undefined;
    const received = hasBytes
      ? Math.min(stageBaseReceived + progress.received, total || Infinity)
      : stageBaseReceived > 0
        ? stageBaseReceived
        : undefined;

    return {
      received,
      total,
      speed: progress.speed,
      eta: progress.eta,
    };
  };
}

function instanceUpdate(instance, patch) {
  Object.assign(instance, patch);
  send("instance:updated", structuredClone(instance));
}

async function runInstall(instance) {
  if (installLocks.has(instance.id)) return installLocks.get(instance.id);
  const controller = new AbortController();
  installControllers.set(instance.id, controller);
  const promise = (async () => {
    const { minecraftService } = createServices();
    instanceUpdate(instance, { status: "installing", installProgress: 0 });
    await saveState();
    try {
      const installed = await minecraftService.installInstance(
        instance,
        effectiveSettings(instance),
        (progress) => {
          instanceUpdate(instance, {
            status: "installing",
            installProgress: progress.progress,
            installMessage: progress.message,
          });
          send("launcher:progress", {
            instanceId: instance.id,
            ...progress,
          });
        },
        controller.signal,
      );
      instanceUpdate(instance, {
        ...installed,
        status: "ready",
        installProgress: 100,
        installMessage: "Done",
        installedAt: new Date().toISOString(),
      });
      await saveState();
      return instance;
    } catch (error) {
      const cancelled =
        controller.signal.aborted || error?.name === "AbortError";
      instanceUpdate(instance, {
        status: cancelled
          ? instance.resolvedVersionId
            ? "ready"
            : "setup"
          : "error",
        installProgress: 0,
        installMessage: cancelled ? "Installation cancelled" : null,
        lastError:
          cancelled
            ? null
            : error instanceof Error
              ? error.message
              : "Installation error",
      });
      await saveState();
      throw error;
    } finally {
      installLocks.delete(instance.id);
      installControllers.delete(instance.id);
    }
  })();
  installLocks.set(instance.id, promise);
  return promise;
}

function selectProjectFile(version, projectType = "mod") {
  if (projectType === "resourcepack" || projectType === "shader") {
    return (
      version?.files?.find(
        (item) => item.primary && /\.(?:zip|jar)$/i.test(item.filename),
      ) ||
      version?.files?.find((item) => /\.(?:zip|jar)$/i.test(item.filename)) ||
      version?.files?.[0] ||
      null
    );
  }
  return (
    version?.files?.find(
      (item) =>
        item.primary &&
        item.filename.endsWith(".jar") &&
        !/(?:sources|javadoc|dev)\.jar$/i.test(item.filename),
    ) ||
    version?.files?.find(
      (item) =>
        item.filename.endsWith(".jar") &&
        !/(?:sources|javadoc|dev)\.jar$/i.test(item.filename),
    ) ||
    null
  );
}

function selectModFile(version) {
  return selectProjectFile(version, "mod");
}

async function dependencyVersion(dependency, profile, signal) {
  if (dependency.version_id) {
    return fetchJson(
      `https://api.modrinth.com/v2/version/${encodeURIComponent(
        dependency.version_id,
      )}`,
      { signal },
    );
  }
  if (!dependency.project_id) return null;
  const facets = [
    `game_versions=${encodeURIComponent(
      JSON.stringify([profile.minecraftVersion]),
    )}`,
    `loaders=${encodeURIComponent(JSON.stringify([profile.loader]))}`,
  ].join("&");
  const versions = await fetchJson(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(
      dependency.project_id,
    )}/version?${facets}`,
    { signal },
  );
  return (
    versions.find((item) => item.version_type === "release") ||
    versions[0] ||
    null
  );
}

async function resolveRequiredModVersions(rootVersion, profile, signal) {
  const resolved = [];
  const queue = [rootVersion];
  const seen = new Set();
  while (queue.length) {
    signal?.throwIfAborted();
    const version = queue.shift();
    if (!version?.id || seen.has(version.id)) continue;
    seen.add(version.id);
    resolved.push(version);
    if (resolved.length > 64) {
      throw new Error("The mod dependency chain is too deep");
    }
    for (const dependency of version.dependencies || []) {
      if (dependency.dependency_type !== "required") continue;
      const next = await dependencyVersion(dependency, profile, signal);
      if (next && !seen.has(next.id)) queue.push(next);
    }
  }
  return resolved;
}

async function installModToInstance(project, targetInstance, task, signal) {
  const profile = loaderInfo(targetInstance);
  if (project.project_type === "mod" && profile.loader === "vanilla") {
    throw new Error(
      "JAR mods require a Fabric, Quilt, Forge, or NeoForge instance",
    );
  }

  const targetFolders = {
    mod: "mods",
    resourcepack: "resourcepacks",
    shader: "shaderpacks",
  };
  const targetDirName = targetFolders[project.project_type] || "mods";
  const targetDirectory = path.join(
    state.settings.gameDirectory,
    targetInstance.id,
    targetDirName,
  );
  await fsp.mkdir(targetDirectory, { recursive: true });

  if (project.source === "curseforge") {
    const modId = project.curseforgeId || project.project_id;
    const files = await curseforgeService.getCurseForgeFiles(modId, {
      gameVersion: profile.minecraftVersion,
      loader: project.project_type === "mod" ? profile.loader : undefined,
      pageSize: 10,
    });
    const chosen = files.find((f) => f.releaseType === 1) || files[0];
    if (!chosen) {
      throw new Error(
        `No compatible CurseForge file found for ${profile.minecraftVersion}`,
      );
    }
    const downloadUrl = curseforgeService.resolveFileUrl(chosen);
    if (!downloadUrl) {
      throw new Error("Could not resolve download URL for selected file");
    }
    const dest = path.join(targetDirectory, chosen.fileName);
    await downloadFile({
      url: downloadUrl,
      destination: dest,
      signal,
      onProgress: (p) => {
        taskUpdate(task, {
          progress: Math.round((p.received / (p.total || 1)) * 100),
          received: p.received,
          total: p.total,
          speed: p.speed,
          eta: p.eta,
        });
      },
    });
    return {
      destination: dest,
      dependencies: 0,
    };
  }
  const loaderFacet =
    project.project_type === "mod" && profile.loader !== "vanilla"
      ? profile.loader.toLowerCase()
      : null;
  const facets = [
    `game_versions=${encodeURIComponent(
      JSON.stringify([profile.minecraftVersion]),
    )}`,
    loaderFacet
      ? `loaders=${encodeURIComponent(JSON.stringify([loaderFacet]))}`
      : "",
  ]
    .filter(Boolean)
    .join("&");
  let versions = await fetchJson(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(
      project.project_id,
    )}/version?${facets}`,
    { signal },
  );
  if ((!versions || versions.length === 0) && project.project_type !== "mod") {
    versions = await fetchJson(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(
        project.project_id,
      )}/version`,
      { signal },
    );
  }
  const version =
    versions?.find((item) => item.version_type === "release") || versions?.[0];
  if (!version) {
    throw new Error(
      `No compatible version is available for ${project.title}`,
    );
  }
  const resolvedVersions =
    project.project_type === "mod"
      ? await resolveRequiredModVersions(version, profile, signal)
      : [version];

  let lastDestination = null;
  const installed = [];
  for (let index = 0; index < resolvedVersions.length; index += 1) {
    const currentVersion = resolvedVersions[index];
    const file = selectProjectFile(currentVersion, project.project_type);
    if (!file) {
      if (currentVersion.id === version.id) {
        throw new Error(
          project.project_type === "mod"
            ? "No JAR file was found in the project version"
            : "No downloadable archive was found in the project version",
        );
      }
      continue;
    }
    const destination = path.join(
      targetDirectory,
      file.filename.replace(/[^a-zA-Z0-9._+()-]/g, "_"),
    );
    lastDestination = destination;
    const result = await downloadFile({
      url: safeModrinthDownload(file.url),
      destination,
      sha1: file.hashes?.sha1,
      sha512: file.hashes?.sha512,
      size: file.size,
      signal,
      onProgress: ({ received, total, speed, eta }) => {
        const fileProgress = total ? received / total : 0.05;
        taskUpdate(task, {
          status: "downloading",
          progress: Math.round(
            ((index + fileProgress) / resolvedVersions.length) * 100,
          ),
          received,
          total,
          speed: speed ?? undefined,
          eta: eta ?? undefined,
          subtitle:
            resolvedVersions.length > 1
              ? `Installing dependency ${index + 1}/${resolvedVersions.length}: ${file.filename}`
              : `Downloading ${file.filename}`,
        });
      },
    });
    installed.push({
      destination,
      version: currentVersion,
      cached: result.cached,
    });
  }
  return {
    destination: installed[0]?.destination,
    version,
    installed,
    dependencies: Math.max(0, installed.length - 1),
  };
}

function findInstance(id) {
  const instance = state.instances.find((item) => item.id === id);
  if (!instance) throw new Error("Instance not found");
  return instance;
}

async function listInstanceContent(id, kind = "mods") {
  const instance = findInstance(id);
  const folders = {
    mods: { directory: "mods", extension: ".jar" },
    resourcepacks: { directory: "resourcepacks", extension: ".zip" },
    shaderpacks: { directory: "shaderpacks", extension: ".zip" },
  };
  const selected = folders[kind] || folders.mods;
  const contentDirectory = path.join(
    state.settings.gameDirectory,
    instance.id,
    selected.directory,
  );
  try {
    const entries = await fsp.readdir(contentDirectory, {
      withFileTypes: true,
    });
    const content = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            (entry.name.toLowerCase().endsWith(selected.extension) ||
              entry.name
                .toLowerCase()
                .endsWith(`${selected.extension}.disabled`)),
        )
        .map(async (entry) => {
          const filePath = path.join(contentDirectory, entry.name);
          const stat = await fsp.stat(filePath);
          return {
            name: entry.name.replace(/\.disabled$/, ""),
            path: filePath,
            enabled: !entry.name.endsWith(".disabled"),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            kind,
          };
        }),
    );
    if (kind === "mods" && instance.modCount !== content.length) {
      instance.modCount = content.length;
      await saveState();
      send("instance:updated", structuredClone(instance));
    }
    return content.sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );
  } catch {
    return [];
  }
}

async function diskSpace(targetPath) {
  try {
    await fsp.mkdir(targetPath, { recursive: true });
    const stats = await fsp.statfs(targetPath);
    return {
      total: Number(stats.blocks) * Number(stats.bsize),
      free: Number(stats.bavail) * Number(stats.bsize),
    };
  } catch {
    return { total: 0, free: 0 };
  }
}

async function endpointHealth(name, url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": `OnyxLauncher/${ONYX_VERSION} diagnostics`,
      },
      signal: AbortSignal.timeout(6_000),
    });
    return {
      name,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

async function buildDiagnostics() {
  const [instances, data, disk, java, endpoints] = await Promise.all([
    directoryStats(state.settings.gameDirectory),
    directoryStats(onyxRoot()),
    diskSpace(state.settings.gameDirectory),
    state.settings.javaPath
      ? inspectJava(state.settings.javaPath)
      : findSystemJava(),
    Promise.all([
      endpointHealth(
        "Mojang",
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
      ),
      endpointHealth(
        "Modrinth",
        "https://api.modrinth.com/v2/tag/game_version",
      ),
      endpointHealth(
        "Microsoft",
        "https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration",
      ),
    ]),
  ]);
  const processMetrics = app.getAppMetrics();
  const processMemoryByType = Object.values(
    processMetrics.reduce((groups, metric) => {
      const type = metric.type || "Unknown";
      const bytes = Number(metric.memory?.workingSetSize || 0) * 1024;
      groups[type] ||= { type, bytes: 0, processes: 0 };
      groups[type].bytes += bytes;
      groups[type].processes += 1;
      return groups;
    }, {}),
  ).sort((left, right) => right.bytes - left.bytes);
  return {
    generatedAt: new Date().toISOString(),
    launcher: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      processMemory: {
        workingSet: processMemoryByType.reduce(
          (total, item) => total + item.bytes,
          0,
        ),
        processes: processMetrics.length,
        byType: processMemoryByType,
      },
    },
    system: {
      platform: process.platform,
      release: os.release(),
      architecture: process.arch,
      cpu: os.cpus()[0]?.model || "Unknown",
      cpuThreads: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
    },
    storage: {
      disk,
      instances,
      data,
      gameDirectory: state.settings.gameDirectory,
      dataDirectory: onyxRoot(),
    },
    java: java || null,
    profile: {
      kind: state.profile.kind,
      name: state.profile.name,
    },
    counts: {
      instances: state.instances.length,
      downloads: state.downloads.length,
      running: Array.from(runningGames.values()).reduce(
        (sum, map) => sum + (map?.size || 0),
        0,
      ),
    },
    endpoints,
  };
}

async function clearInstallerCache() {
  const packsRoot = path.join(onyxRoot(), "packs");
  const before = await directoryStats(packsRoot);
  await fsp.rm(packsRoot, { recursive: true, force: true });
  await fsp.mkdir(packsRoot, { recursive: true });
  const [sharedParts, instanceParts] = await Promise.all([
    removePartialFiles(path.join(onyxRoot(), "shared")),
    removePartialFiles(state.settings.gameDirectory),
  ]);
  return {
    bytes: before.bytes + sharedParts.bytes + instanceParts.bytes,
    files: before.files + sharedParts.files + instanceParts.files,
  };
}

function registerIpc() {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle("state:get", () => serializeState());
  ipcMain.handle("state:update-settings", async (_event, settings) => {
    if (
      typeof settings?.gameDirectory === "string" &&
      settings.gameDirectory !== state.settings.gameDirectory
    ) {
      throw new Error(
        "Change the instances directory using safe data migration",
      );
    }
    const previousRpc = state.settings.discordRpc !== false;
    state.settings = {
      ...state.settings,
      ...sanitizeSettingsPatch(settings),
    };
    const currentRpc = state.settings.discordRpc !== false;
    if (previousRpc && !currentRpc) {
      discordRpcService.disable();
    } else if (!previousRpc && currentRpc) {
      discordRpcService.enable();
      discordRpcService.refreshPresence(state.settings);
    } else if (currentRpc) {
      discordRpcService.refreshPresence(state.settings);
    }
    await saveState();
    return structuredClone(state.settings);
  });
  ipcMain.handle("rpc:status", () => discordRpcService.getStatus());
  ipcMain.handle("rpc:page", (_event, page) => {
    if (discordRpcService.enabled && runningGames.size === 0) {
      discordRpcService.setIdle(page, {
        showTime: state.settings.discordRpcShowTime !== false,
      });
    }
    return true;
  });
  ipcMain.handle("state:move-game-directory", async (_event, targetPath) => {
    if (runningGames.size || installControllers.size) {
      throw new Error("Finish running games and active installations first");
    }
    const sourceRoot = path.resolve(state.settings.gameDirectory);
    const destinationRoot = path.resolve(String(targetPath || ""));
    if (!destinationRoot || destinationRoot === sourceRoot) {
      return {
        settings: structuredClone(state.settings),
        copied: 0,
        oldDirectory: sourceRoot,
        newDirectory: sourceRoot,
        sourceRetained: true,
      };
    }
    if (destinationRoot.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error("The new directory cannot be inside the current directory");
    }
    await fsp.mkdir(destinationRoot, { recursive: true });
    for (const instance of state.instances) {
      const destination = path.join(destinationRoot, instance.id);
      const existing = await fsp.stat(destination).catch(() => null);
      if (existing) {
        throw new Error(
          `The new directory already contains data for instance ${instance.name}`,
        );
      }
    }
    let copied = 0;
    const copiedPaths = [];
    try {
      for (const instance of state.instances) {
        const source = path.join(sourceRoot, instance.id);
        const exists = await fsp.stat(source).catch(() => null);
        if (!exists?.isDirectory()) continue;
        send("maintenance:progress", {
          instanceId: instance.id,
          operation: "move",
          progress: Math.round(
            (copied / Math.max(state.instances.length, 1)) * 100,
          ),
          message: `Moving ${instance.name}…`,
        });
        const destination = path.join(destinationRoot, instance.id);
        copiedPaths.push(destination);
        await fsp.cp(source, destination, {
          recursive: true,
          errorOnExist: true,
        });
        copied += 1;
      }
    } catch (error) {
      await Promise.all(
        copiedPaths.map((destination) =>
          fsp.rm(destination, { recursive: true, force: true }),
        ),
      );
      throw error;
    }
    state.settings.gameDirectory = destinationRoot;
    await saveState();
    send("maintenance:progress", {
      operation: "move",
      progress: 100,
      message: "Instances moved",
      done: true,
    });
    return {
      settings: structuredClone(state.settings),
      copied,
      oldDirectory: sourceRoot,
      newDirectory: destinationRoot,
      sourceRetained: true,
    };
  });
  ipcMain.handle("instance:create", async (_event, input) => {
    const instance = {
      id: crypto.randomUUID(),
      name: String(input.name || "New modpack").slice(0, 48),
      version: String(input.version || "1.21.1"),
      loader: String(input.loader || "Fabric"),
      description: String(input.description || "Custom instance"),
      color: input.color || "lime",
      glyph: String(input.name || "NX").slice(0, 2).toUpperCase(),
      favorite: false,
      status: "setup",
      lastPlayed: "Never played",
      playtimeMinutes: 0,
      modCount: 0,
    };
    state.instances.unshift(instance);
    await saveState();
    return structuredClone(instance);
  });
  ipcMain.handle("instance:delete", async (_event, id) => {
    if (runningGames.has(id)) throw new Error("Stop the game first");
    const instance = state.instances.find((item) => item.id === id);
    if (!instance) return false;
    const directory = path.join(state.settings.gameDirectory, id);
    try {
      await shell.trashItem(directory);
    } catch {
      // The directory may not exist yet.
    }
    state.instances = state.instances.filter((item) => item.id !== id);
    instanceStorageCache.delete(id);
    await saveState();
    return true;
  });
  ipcMain.handle("instance:favorite", async (_event, id) => {
    const instance = state.instances.find((item) => item.id === id);
    if (!instance) return null;
    instance.favorite = !instance.favorite;
    await saveState();
    return structuredClone(instance);
  });
  ipcMain.handle("instance:update", async (_event, id, patch) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Stop the game first");
    if (typeof patch?.name === "string") {
      const name = patch.name.trim().slice(0, 48);
      if (!name) throw new Error("The instance name cannot be empty");
      instance.name = name;
      instance.glyph = name.slice(0, 2).toUpperCase();
    }
    if (typeof patch?.description === "string") {
      instance.description = patch.description.trim().slice(0, 180);
    }
    if (
      typeof patch?.color === "string" &&
      ["lime", "amber", "violet", "cyan", "rose"].includes(patch.color)
    ) {
      instance.color = patch.color;
    }
    if (patch?.settings && typeof patch.settings === "object") {
      const current = instance.settings || {};
      const next = { ...current };
      if (Number.isFinite(patch.settings.memory)) {
        next.memory = Math.max(
          2,
          Math.min(64, Math.round(patch.settings.memory)),
        );
      }
      if (Number.isFinite(patch.settings.windowWidth)) {
        next.windowWidth = Math.max(
          640,
          Math.min(7680, Math.round(patch.settings.windowWidth)),
        );
      }
      if (Number.isFinite(patch.settings.windowHeight)) {
        next.windowHeight = Math.max(
          480,
          Math.min(4320, Math.round(patch.settings.windowHeight)),
        );
      }
      if (typeof patch.settings.fullscreen === "boolean") {
        next.fullscreen = patch.settings.fullscreen;
      }
      if (typeof patch.settings.recordFps === "boolean") {
        next.recordFps = patch.settings.recordFps;
      }
      if (
        typeof patch.settings.performanceBaselineSessionId === "string"
      ) {
        const sessionId = patch.settings.performanceBaselineSessionId
          .trim()
          .slice(0, 80);
        next.performanceBaselineSessionId =
          /^[a-zA-Z0-9_-]{0,80}$/.test(sessionId) ? sessionId : "";
      }
      if (typeof patch.settings.javaPath === "string") {
        next.javaPath = patch.settings.javaPath.trim().slice(0, 1024);
      }
      if (Array.isArray(patch.settings.jvmArguments)) {
        next.jvmArguments = patch.settings.jvmArguments
          .filter((argument) => typeof argument === "string")
          .map((argument) => argument.trim().slice(0, 180))
          .filter(Boolean)
          .slice(0, 24);
      }
      if (typeof patch.settings.serverAddress === "string") {
        const quickJoin = parseServerAddress(patch.settings.serverAddress);
        next.serverAddress = quickJoin?.address || "";
      }
      if (Array.isArray(patch.settings.servers)) {
        const ids = new Set();
        next.servers = patch.settings.servers
          .filter((server) => server && typeof server === "object")
          .map((server) => {
            const quickJoin = parseServerAddress(server.address);
            if (!quickJoin) return null;
            let id =
              typeof server.id === "string" &&
              /^[a-zA-Z0-9_-]{1,64}$/.test(server.id)
                ? server.id
                : crypto.randomUUID();
            while (ids.has(id)) id = crypto.randomUUID();
            ids.add(id);
            const name =
              typeof server.name === "string"
                ? server.name.trim().slice(0, 48)
                : "";
            return {
              id,
              name: name || quickJoin.address,
              address: quickJoin.address,
              createdAt:
                typeof server.createdAt === "string" &&
                !Number.isNaN(Date.parse(server.createdAt))
                  ? server.createdAt
                  : new Date().toISOString(),
            };
          })
          .filter(Boolean)
          .slice(0, 24);
        if (
          typeof patch.settings.selectedServerId !== "string" ||
          !next.servers.some(
            (server) => server.id === patch.settings.selectedServerId,
          )
        ) {
          next.selectedServerId = next.servers[0]?.id || "";
        }
      }
      if (
        typeof patch.settings.selectedServerId === "string" &&
        Array.isArray(next.servers) &&
        next.servers.some(
          (server) => server.id === patch.settings.selectedServerId,
        )
      ) {
        next.selectedServerId = patch.settings.selectedServerId;
      }
      instance.settings = next;
    }
    await saveState();
    send("instance:updated", structuredClone(instance));
    return structuredClone(instance);
  });
  ipcMain.handle("instance:duplicate", async (_event, id) => {
    const source = state.instances.find((item) => item.id === id);
    if (!source) throw new Error("Instance not found");
    const duplicate = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name} — copy`,
      favorite: false,
      status: source.resolvedVersionId ? "ready" : "setup",
      lastPlayed: "Never played",
      playtimeMinutes: 0,
    };
    const sourceDirectory = path.join(state.settings.gameDirectory, id);
    const destination = path.join(
      state.settings.gameDirectory,
      duplicate.id,
    );
    try {
      await fsp.cp(sourceDirectory, destination, {
        recursive: true,
        errorOnExist: true,
      });
    } catch {
      await fsp.mkdir(destination, { recursive: true });
    }
    state.instances.unshift(duplicate);
    await saveState();
    return structuredClone(duplicate);
  });
  ipcMain.handle("instance:open-folder", async (_event, id) => {
    const directory = path.join(state.settings.gameDirectory, id);
    await fsp.mkdir(directory, { recursive: true });
    return shell.openPath(directory);
  });
  ipcMain.handle("instance:screenshots-list", async (_event, id) => {
    findInstance(id);
    return screenshotsService.listScreenshots(state.settings.gameDirectory, id);
  });
  ipcMain.handle("instance:screenshot-read", async (_event, id, fileName) => {
    findInstance(id);
    return screenshotsService.readScreenshotBase64(
      state.settings.gameDirectory,
      id,
      fileName,
    );
  });
  ipcMain.handle("instance:screenshot-copy", async (_event, id, fileName) => {
    findInstance(id);
    return screenshotsService.copyScreenshotToClipboard(
      state.settings.gameDirectory,
      id,
      fileName,
      { clipboard, nativeImage },
    );
  });
  ipcMain.handle("instance:screenshot-show", async (_event, id, fileName) => {
    findInstance(id);
    return screenshotsService.showScreenshotInFolder(
      state.settings.gameDirectory,
      id,
      fileName,
      shell,
    );
  });
  ipcMain.handle("instance:screenshot-delete", async (_event, id, fileName) => {
    findInstance(id);
    return screenshotsService.deleteScreenshot(
      state.settings.gameDirectory,
      id,
      fileName,
      shell,
    );
  });
  ipcMain.handle("instance:storage-analyze", async (_event, id, force) => {
    findInstance(id);
    const cached = instanceStorageCache.get(id);
    if (
      !force &&
      cached &&
      Date.now() - cached.createdAt < 30_000
    ) {
      return structuredClone(cached.report);
    }
    const report = await analyzeInstanceStorage({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
    instanceStorageCache.set(id, {
      createdAt: Date.now(),
      report,
    });
    return report;
  });
  ipcMain.handle("instance:storage-cleanup", async (_event, id) => {
    findInstance(id);
    if (runningGames.has(id) || installControllers.has(id)) {
      throw new Error("Stop the game or installation first");
    }
    const result = await cleanupInstanceStorage({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
    instanceStorageCache.set(id, {
      createdAt: Date.now(),
      report: result.report,
    });
    return result;
  });
  ipcMain.handle("instance:list-content", (_event, id, kind) =>
    listInstanceContent(id, kind),
  );
  ipcMain.handle("instance:check-content-updates", async (_event, id) => {
    const instance = findInstance(id);
    const profile = loaderInfo(instance);
    const items = await listInstanceContent(id);
    return checkModUpdates({
      items,
      loader: profile.loader,
      minecraftVersion: profile.minecraftVersion,
    });
  });
  ipcMain.handle(
    "instance:update-content",
    async (_event, id, filePath) => {
      const instance = findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the game first");
      }
      await createWorldSnapshot({
        instancesRoot: state.settings.gameDirectory,
        worldGuardRoot: path.join(onyxRoot(), "world-guard"),
        instanceId: id,
        reason: "mod-update",
      });
      const profile = loaderInfo(instance);
      const result = await updateMod({
        instancesRoot: state.settings.gameDirectory,
        filePath,
        loader: profile.loader,
        minecraftVersion: profile.minecraftVersion,
        onProgress: ({ received, total }) =>
          send("content:update-progress", {
            instanceId: id,
            path: filePath,
            received,
            total,
            progress: total ? Math.round((received / total) * 100) : 5,
          }),
      });
      if (result.updated) {
        send("content:update-progress", {
          instanceId: id,
          path: filePath,
          progress: 100,
          done: true,
        });
      }
      return result;
    },
  );
  ipcMain.handle("instance:list-content-history", (_event, id) => {
    findInstance(id);
    return listModHistory({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle("instance:mod-profiles-list", (_event, id) => {
    findInstance(id);
    return listModProfiles({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle(
    "instance:mod-profile-save",
    async (_event, id, name, profileId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the game first");
      }
      const bisect = await readBisectSession({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
      });
      if (bisect) {
        throw new Error("Finish or cancel Crash Bisect first");
      }
      return saveModProfile({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        name,
        profileId,
      });
    },
  );
  ipcMain.handle(
    "instance:mod-profile-apply",
    async (_event, id, profileId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the game first");
      }
      const bisect = await readBisectSession({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
      });
      if (bisect) {
        throw new Error("Finish or cancel Crash Bisect first");
      }
      const result = await applyModProfile({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        profileId,
      });
      await listInstanceContent(id, "mods");
      return result;
    },
  );
  ipcMain.handle(
    "instance:mod-profile-delete",
    async (_event, id, profileId) => {
      findInstance(id);
      return deleteModProfile({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        profileId,
      });
    },
  );
  ipcMain.handle(
    "instance:rollback-content",
    async (_event, id, transactionId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the game first");
      }
      return rollbackModUpdate({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        transactionId,
      });
    },
  );
  ipcMain.handle(
    "instance:disable-suspects",
    async (_event, id, names) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the game first");
      }
      return disableSuspectMods({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        names,
      });
    },
  );
  ipcMain.handle("instance:bisect-get", (_event, id) => {
    findInstance(id);
    return readBisectSession({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle("instance:bisect-start", async (_event, id, names) => {
    findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Stop the game first");
    }
    return startBisect({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
      names,
    });
  });
  ipcMain.handle(
    "instance:bisect-report",
    async (_event, id, gameStarted) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the test run first");
      }
      return reportBisectResult({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        gameStarted: Boolean(gameStarted),
      });
    },
  );
  ipcMain.handle("instance:bisect-cancel", async (_event, id) => {
    findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Stop the test run first");
    }
    return cancelBisect({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle(
    "instance:bisect-finish",
    async (_event, id, disableCulprit) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the game first");
      }
      return finishBisect({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        disableCulprit: Boolean(disableCulprit),
      });
    },
  );
  ipcMain.handle("instance:crash-detect-autofix", async (_event, id) => {
    const instance = findInstance(id);
    const instanceDirectory = path.join(state.settings.gameDirectory, id);
    let logContent = "";
    if (instance.lastLogPath && fs.existsSync(instance.lastLogPath)) {
      try {
        logContent = await fsp.readFile(instance.lastLogPath, "utf8");
      } catch {}
    } else {
      const latestLog = path.join(instanceDirectory, "logs", "latest.log");
      if (fs.existsSync(latestLog)) {
        try {
          logContent = await fsp.readFile(latestLog, "utf8");
        } catch {}
      }
    }
    const crashReport = await extractCrashReport({
      instanceDirectory,
      logContent,
      exitCode: instance.lastExitCode || 1,
    });
    const fixAction = await detectCrashAutoFix({
      instance,
      logContent,
      crashReport,
      instancesRoot: state.settings.gameDirectory,
    });
    instance.lastAutoFix = fixAction || null;
    instanceUpdate(instance, { lastAutoFix: instance.lastAutoFix });
    await saveState();
    return fixAction;
  });
  ipcMain.handle("instance:crash-apply-autofix", async (_event, id, fixAction) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Stop the game first");
    }
    const result = await applyCrashAutoFix({
      fixAction,
      instance,
      instancesRoot: state.settings.gameDirectory,
      installModFn: async ({ projectId }) => {
        const project = await fetchJson(
          `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`,
        );
        const task = {
          id: crypto.randomUUID(),
          name: project.title || projectId,
          status: "installing",
        };
        const controller = new AbortController();
        await installModToInstance(project, instance, task, controller.signal);
      },
      repairInstanceFn: async () => {
        await runInstall(instance);
      },
      saveStateFn: async () => {
        await saveState();
      },
    });
    instanceUpdate(instance, {
      lastAutoFix: null,
      lastDiagnosis: null,
      settings: instance.settings,
    });
    await saveState();
    return result;
  });
  ipcMain.handle("instance:world-snapshots", (_event, id) => {
    findInstance(id);
    return listWorldSnapshots({
      worldGuardRoot: path.join(onyxRoot(), "world-guard"),
      instanceId: id,
    });
  });
  ipcMain.handle("instance:world-snapshot-create", async (_event, id) => {
    findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Stop the game first so the snapshot remains consistent");
    }
    return createWorldSnapshot({
      instancesRoot: state.settings.gameDirectory,
      worldGuardRoot: path.join(onyxRoot(), "world-guard"),
      instanceId: id,
      reason: "manual",
      onProgress: (progress) =>
        send("maintenance:progress", {
          instanceId: id,
          kind: "world-snapshot",
          ...progress,
        }),
    });
  });
  ipcMain.handle(
    "instance:world-snapshot-restore",
    async (_event, id, snapshotId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Stop the game first");
      }
      return restoreWorldSnapshot({
        instancesRoot: state.settings.gameDirectory,
        worldGuardRoot: path.join(onyxRoot(), "world-guard"),
        instanceId: id,
        snapshotId,
        onProgress: (progress) =>
          send("maintenance:progress", {
            instanceId: id,
            kind: "world-restore",
            ...progress,
          }),
      });
    },
  );
  ipcMain.handle("instance:toggle-content", async (_event, filePath) => {
    const instancesRoot = path.resolve(state.settings.gameDirectory);
    const source = path.resolve(filePath);
    if (!source.startsWith(`${instancesRoot}${path.sep}`)) {
      throw new Error("The file is outside the instances directory");
    }
    const destination = source.endsWith(".disabled")
      ? source.replace(/\.disabled$/, "")
      : `${source}.disabled`;
    await fsp.rename(source, destination);
    return destination;
  });
  ipcMain.handle("instance:delete-content", async (_event, filePath) => {
    const instancesRoot = path.resolve(state.settings.gameDirectory);
    const target = path.resolve(filePath);
    if (!target.startsWith(`${instancesRoot}${path.sep}`)) {
      throw new Error("The file is outside the instances directory");
    }
    await shell.trashItem(target);
    return true;
  });
  ipcMain.handle("instance:repair", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Stop the game first");
    await runInstall(instance);
    return structuredClone(instance);
  });
  ipcMain.handle("instance:check-updates", async () => {
    const { modpackService } = createServices();
    const candidates = state.instances.filter(
      (instance) => instance.sourceProjectId && !runningGames.has(instance.id),
    );
    await Promise.allSettled(
      candidates.map(async (instance) => {
        const updateAvailable =
          await modpackService.checkProjectUpdate(instance);
        instance.updateAvailable = updateAvailable;
        send("instance:updated", structuredClone(instance));
      }),
    );
    await saveState();
    return candidates.map((instance) => structuredClone(instance));
  });
  ipcMain.handle("instance:update-preview", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Stop the game first");
    }
    const { modpackService } = createServices();
    return modpackService.previewProjectUpdate({
      instance,
      onProgress: ({ received, total }) =>
        send("content:update-progress", {
          instanceId: id,
          path: "pack-preview",
          received,
          total,
          progress: total ? Math.round((received / total) * 100) : 5,
        }),
    });
  });
  ipcMain.handle("instance:update-pack", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Stop the game first");
    if (!instance.sourceProjectId) {
      throw new Error("The instance is not linked to a Modrinth project");
    }
    const originalStatus = instance.resolvedVersionId ? "ready" : "setup";
    const controller = new AbortController();
    installControllers.set(id, controller);
    instanceUpdate(instance, {
      status: "installing",
      installProgress: 1,
      installMessage: "Creating a restore point…",
    });
    await saveState();
    try {
      const backupsRoot = path.join(onyxRoot(), "backups", instance.id);
      const backupPath = path.join(
        backupsRoot,
        `${new Date().toISOString().replace(/[:.]/g, "-")}.onyxpack`,
      );
      await createInstanceBackup({
        instance,
        instancesRoot: state.settings.gameDirectory,
        destination: backupPath,
        onProgress: (progress) =>
          send("launcher:progress", {
            instanceId: id,
            stage: "backup",
            progress: Math.max(1, Math.round(progress.progress * 0.1)),
            message: "Creating a restore point before the update…",
          }),
      });
      const automaticBackups = (
        await fsp.readdir(backupsRoot, { withFileTypes: true })
      )
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".onyxpack"),
        )
        .map((entry) => entry.name)
        .sort()
        .reverse();
      await Promise.all(
        automaticBackups
          .slice(5)
          .map((name) =>
            fsp.rm(path.join(backupsRoot, name), { force: true }),
          ),
      );
      const { modpackService } = createServices();
      const result = await modpackService.updateProject({
        instance,
        settings: effectiveSettings(instance),
        signal: controller.signal,
        onProgress: (progress) => {
          const adjusted = 10 + Math.round((progress.progress || 0) * 0.9);
          instanceUpdate(instance, {
            status: "installing",
            installProgress: adjusted,
            installMessage: progress.message,
          });
          send("launcher:progress", {
            instanceId: id,
            ...progress,
            progress: adjusted,
          });
        },
      });
      Object.assign(instance, result.instance, {
        status: "ready",
        installProgress: 100,
        installMessage: "Modpack updated",
        lastError: null,
      });
      await saveState();
      send("instance:updated", structuredClone(instance));
      return {
        updated: result.updated,
        instance: structuredClone(instance),
        backupPath,
        obsoleteFiles: result.obsoleteFiles || 0,
        versionNumber: result.release?.version_number || null,
      };
    } catch (error) {
      const cancelled =
        controller.signal.aborted || error?.name === "AbortError";
      instanceUpdate(instance, {
        status: originalStatus,
        installProgress: 0,
        installMessage: cancelled ? "Update cancelled" : null,
        lastError:
          cancelled
            ? null
            : error instanceof Error
              ? error.message
              : "Modpack update error",
      });
      await saveState();
      throw error;
    } finally {
      installControllers.delete(id);
    }
  });
  ipcMain.handle("instance:export-performance-csv", async (_event, id) => {
    const instance = findInstance(id);
    const safeName =
      instance.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() ||
      "Scope instance";
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Performance — ${instance.name}`,
      defaultPath: path.join(
        app.getPath("documents"),
        `${safeName}-performance-${date}.csv`,
      ),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const sessions = state.sessions
      .filter((session) => session.instanceId === id)
      .sort(
        (left, right) =>
          new Date(right.endedAt).getTime() -
          new Date(left.endedAt).getTime(),
      );
    await fsp.writeFile(
      result.filePath,
      buildPerformanceCsv(sessions),
      "utf8",
    );
    return result.filePath;
  });
  ipcMain.handle("instance:backup", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Stop the game first");
    const safeName =
      instance.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() ||
      "Scope instance";
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Backup — ${instance.name}`,
      defaultPath: path.join(
        app.getPath("documents"),
        `${safeName}-${date}.scopepack`,
      ),
      filters: [{ name: "Scope backup", extensions: ["scopepack", "onyxpack"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const backup = await createInstanceBackup({
      instance,
      instancesRoot: state.settings.gameDirectory,
      destination: result.filePath,
      onProgress: (progress) =>
        send("maintenance:progress", {
          instanceId: id,
          operation: "backup",
          message: `Creating a backup of ${instance.name}`,
          ...progress,
        }),
    });
    send("maintenance:progress", {
      instanceId: id,
      operation: "backup",
      message: "Backup ready",
      progress: 100,
      done: true,
    });
    return backup;
  });
  ipcMain.handle("instance:import-backup", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Import Scope backup",
      filters: [
        { name: "Scope backup", extensions: ["scopepack", "onyxpack"] },
        { name: "ZIP archive", extensions: ["zip"] },
      ],
    });
    if (result.canceled) return null;
    const backupPath = result.filePaths[0];
    const instance = await importInstanceBackup({
      backupPath,
      instancesRoot: state.settings.gameDirectory,
      onProgress: (progress) =>
        send("maintenance:progress", {
          operation: "import",
          message: `Importing ${path.basename(backupPath)}`,
          ...progress,
        }),
    });
    state.instances.unshift(instance);
    const content = await listInstanceContent(instance.id).catch(() => []);
    instance.modCount = content.length;
    await saveState();
    send("instance:updated", structuredClone(instance));
    send("maintenance:progress", {
      instanceId: instance.id,
      operation: "import",
      message: "Instance imported",
      progress: 100,
      done: true,
    });
    return structuredClone(instance);
  });
  ipcMain.handle("instance:sync-export", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Stop the game first");
    }
    const items = await listInstanceContent(id, "mods");
    const mods = await identifySyncMods(items);
    const profile = createSyncProfile({ instance, mods });
    const safeName =
      instance.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() ||
      "Scope profile";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Scope Sync — ${instance.name}`,
      defaultPath: path.join(
        app.getPath("documents"),
        `${safeName}.scopeprofile`,
      ),
      filters: [
        { name: "Scope Sync profile", extensions: ["scopeprofile", "onyxprofile"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(
      result.filePath,
      JSON.stringify(profile, null, 2),
      "utf8",
    );
    return {
      path: result.filePath,
      total: profile.mods.length,
      recognized: profile.mods.filter((mod) => mod.versionId).length,
    };
  });
  async function importProfileObject(profile, sourceName) {
    const id = crypto.randomUUID();
    const source = profile.instance;
    const instance = {
      id,
      name: source.name,
      version: source.version,
      loader: source.loader,
      description: source.description,
      color: source.color,
      glyph: source.glyph,
      iconUrl: source.iconUrl,
      installProfile: source.installProfile || undefined,
      settings: source.settings,
      favorite: false,
      status: "setup",
      lastPlayed: "Never played",
      playtimeMinutes: 0,
      modCount: 0,
      importedAt: new Date().toISOString(),
      syncSource: sourceName || "Shared modpack",
    };
    state.instances.unshift(instance);
    await saveState();
    try {
      await runInstall(instance);
      const instanceDirectory = path.join(state.settings.gameDirectory, id);
      const installed = await installSyncMods({
        profile,
        instanceDirectory,
        onProgress: ({ completed, count, received, total, current }) =>
          send("launcher:progress", {
            instanceId: id,
            stage: "sync-mods",
            progress: total
              ? Math.round((received / total) * 100)
              : Math.round((completed / Math.max(count, 1)) * 100),
            message: `Scope Sync: ${current}`,
          }),
      });
      instance.modCount = installed.installed;
      instance.status = "ready";
      instance.syncSkippedMods = installed.skipped;
      await preflightInstance(instance, false);
      await saveState();
      send("instance:updated", structuredClone(instance));
      return {
        instance: structuredClone(instance),
        installed: installed.installed,
        skipped: installed.skipped,
      };
    } catch (error) {
      instance.status = instance.resolvedVersionId ? "ready" : "error";
      instance.lastError =
        error instanceof Error ? error.message : "Scope Sync import error";
      await saveState();
      send("instance:updated", structuredClone(instance));
      throw error;
    }
  }

  ipcMain.handle("instance:sync-import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Import Scope Sync profile",
      filters: [
        { name: "Scope Sync profile", extensions: ["scopeprofile", "onyxprofile"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const profilePath = result.filePaths[0];
    const stats = await fsp.stat(profilePath);
    if (stats.size > 5 * 1024 * 1024) {
      throw new Error("The Scope Sync profile is too large");
    }
    const profile = validateSyncProfile(
      JSON.parse(await fsp.readFile(profilePath, "utf8")),
    );
    return importProfileObject(profile, path.basename(profilePath));
  });

  ipcMain.handle("instance:sync-share", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Stop the game first");
    }
    const items = await listInstanceContent(id, "mods");
    const mods = await identifySyncMods(items);
    const profile = createSyncProfile({ instance, mods });
    const shareResult = await uploadShareProfile(profile);
    return {
      ...shareResult,
      total: profile.mods.length,
      recognized: profile.mods.filter((mod) => mod.versionId).length,
    };
  });

  ipcMain.handle("instance:sync-preview-url", async (_event, urlOrId) => {
    const data = await fetchShareProfile(urlOrId);
    return {
      id: data.id,
      name: data.name,
      version: data.version,
      loader: data.loader,
      modCount: data.modCount,
      author: data.author,
      mods: (data.profile?.mods || []).map((mod) => ({
        name: mod.name,
        enabled: mod.enabled !== false,
        versionId: mod.versionId,
      })),
    };
  });

  ipcMain.handle("instance:sync-import-url", async (_event, urlOrId) => {
    const data = await fetchShareProfile(urlOrId);
    const profile = validateSyncProfile(data.profile);
    return importProfileObject(profile, `Link: ${data.id}`);
  });

  ipcMain.handle("instance:get-pending-deep-link", () => {
    const link = pendingDeepLinkUrl;
    pendingDeepLinkUrl = null;
    return link;
  });
  ipcMain.handle("state:get-pending-deep-link", () => {
    const link = pendingDeepLinkUrl;
    pendingDeepLinkUrl = null;
    return link;
  });

  ipcMain.handle("instance:skin-loader-status", async (_event, id) => {
    const instance = findInstance(id);
    return checkSkinLoaderStatus(instance, state.settings.gameDirectory);
  });

  ipcMain.handle("instance:install-skin-loader", async (_event, id) => {
    const instance = findInstance(id);
    if (!instance) throw new Error("Instance not found");
    const result = await installCustomSkinLoader({
      instance,
      instancesRoot: state.settings.gameDirectory,
    });
    send("instance:updated", structuredClone(instance));
    return result;
  });

  ipcMain.handle("system:choose-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Scope game instances directory",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("system:choose-java", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Select the Java executable",
      filters: [{ name: "Java", extensions: ["exe"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("system:open-path", async (_event, targetPath) => {
    if (!targetPath) return "No path provided";
    return shell.openPath(targetPath);
  });
  ipcMain.handle("system:java-status", async () => {
    if (state.settings.javaPath) {
      const custom = await inspectJava(state.settings.javaPath);
      if (custom) return { ...custom, source: "custom" };
    }
    const system = await findSystemJava();
    return system ? { ...system, source: "system" } : null;
  });
  ipcMain.handle("system:recommend-instance", (_event, id) =>
    recommendInstanceResources({ instance: findInstance(id) }),
  );
  ipcMain.handle("system:fps-recorder-status", () => detectFpsRecorder());
  ipcMain.handle("system:server-status", (_event, address) =>
    pingMinecraftServer(address),
  );
  ipcMain.handle("system:diagnostics", () => buildDiagnostics());
  ipcMain.handle("system:export-diagnostics", async () => {
    const diagnostics = await buildDiagnostics();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save Scope diagnostics",
      defaultPath: path.join(
        app.getPath("documents"),
        `scope-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: "JSON report", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(
      result.filePath,
      JSON.stringify(diagnostics, null, 2),
      "utf8",
    );
    return result.filePath;
  });
  ipcMain.handle("system:clear-cache", () => clearInstallerCache());

  ipcMain.handle("resourcepack:inspect", async (_event, filePath) => {
    return resourcepackService.inspectResourcePack(filePath);
  });

  ipcMain.handle("resourcepack:download-and-inspect", async (_event, { url, projectId }) => {
    return resourcepackService.downloadAndInspectResourcePack({ url, projectId });
  });

  ipcMain.handle("resourcepack:cleanup-preview", async (_event, tempFilePath) => {
    return resourcepackService.cleanupPreviewPack(tempFilePath);
  });

  ipcMain.handle("resourcepack:install-preview", async (_event, { tempFilePath, instanceId, filename }) => {
    const instance = state.instances.find((i) => i.id === instanceId);
    if (!instance) throw new Error("Instance not found");
    const instanceDir = path.join(state.settings.gameDirectory, instance.id);
    const destFolder = path.join(instanceDir, "resourcepacks");
    return resourcepackService.installPreviewPack({
      tempFilePath,
      destinationFolder: destFolder,
      filename,
    });
  });

  ipcMain.handle("migration:detect", async () => {
    return detectAllInstalledInstances();
  });

  ipcMain.handle("migration:browse-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Minecraft or Launcher Instance Directory",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const folderPath = result.filePaths[0];
    const candidate = await inspectCustomDirectory(folderPath);
    return { folderPath, candidate };
  });

  ipcMain.handle("migration:inspect-folder", async (_event, folderPath) => {
    if (!folderPath) return null;
    return inspectCustomDirectory(folderPath);
  });

  ipcMain.handle("migration:import", async (_event, candidates) => {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { imported: [], errors: [] };
    }
    const imported = [];
    const errors = [];
    const total = candidates.length;

    for (let i = 0; i < total; i++) {
      const candidate = candidates[i];
      const instanceId = crypto.randomUUID();
      const targetDir = path.join(state.settings.gameDirectory, instanceId);

      send("migration:progress", {
        current: i + 1,
        total,
        instanceName: candidate.name,
        phase: "copying",
        percent: Math.round(((i) / total) * 100),
      });

      try {
        await fsp.mkdir(targetDir, { recursive: true });
        await migrateInstanceFiles(candidate.gameDir, targetDir);

        const instance = createOnyxInstanceFromCandidate(candidate, instanceId);
        state.instances.unshift(instance);
        await saveState();
        send("instance:updated", structuredClone(instance));
        imported.push(instance);
      } catch (err) {
        errors.push({
          name: candidate.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    send("migration:progress", {
      current: total,
      total,
      instanceName: "",
      phase: "done",
      percent: 100,
    });

    return { imported, errors };
  });

  ipcMain.handle("auth:start", async () => {
    const login = await authService.beginLogin();
    await shell.openExternal(
      `${login.verificationUri}?otc=${encodeURIComponent(login.userCode)}`,
    );
    return login;
  });
  ipcMain.handle("auth:wait", async (_event, sessionId) => {
    const profile = await authService.waitForLogin(sessionId, (message) =>
      send("auth:status", { sessionId, message }),
    );
    state.profile = profile;
    await saveState();
    send("auth:changed", profile);
    return profile;
  });
  ipcMain.handle("auth:cancel", (_event, sessionId) =>
    authService.cancelLogin(sessionId),
  );
  ipcMain.handle("auth:list", () => authService.listAccounts());
  ipcMain.handle("auth:profile-refresh", async (_event, accountId) => {
    const profile = await authService.refreshProfile(accountId);
    if (state.profile.uuid === profile.uuid) {
      state.profile = profile;
      await saveState();
      send("auth:changed", profile);
    }
    return profile;
  });
  ipcMain.handle("auth:offline-add", async (_event, name) => {
    const profile = await authService.addOfflineAccount(name);
    state.profile = profile;
    await saveState();
    send("auth:changed", profile);
    return profile;
  });
  ipcMain.handle("auth:skin-select", async (_event, accountId, variant) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select a Minecraft skin",
      properties: ["openFile"],
      filters: [{ name: "PNG skin", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const profile = await authService.setSkinFromFile(
      result.filePaths[0],
      variant,
      accountId,
    );
    if (profile.kind === "offline") {
      await Promise.all(
        state.instances.map((instance) =>
          syncOfflineSkin(
            profile,
            path.join(state.settings.gameDirectory, instance.id),
          ),
        ),
      );
    }
    if (state.profile.uuid === profile.uuid) {
      state.profile = profile;
      await saveState();
      send("auth:changed", profile);
    }
    return profile;
  });
  ipcMain.handle("auth:switch", async (_event, accountId) => {
    const profile = await authService.switchAccount(accountId);
    state.profile = profile;
    await saveState();
    send("auth:changed", profile);
    return profile;
  });
  ipcMain.handle("auth:remove", async (_event, accountId) => {
    const next = await authService.removeAccount(accountId);
    state.profile = next || structuredClone(DEFAULT_STATE.profile);
    await saveState();
    send("auth:changed", state.profile);
    return state.profile;
  });
  ipcMain.handle("auth:sign-out", async () => {
    const next = await authService.signOut();
    state.profile = next || structuredClone(DEFAULT_STATE.profile);
    await saveState();
    send("auth:changed", state.profile);
    return state.profile;
  });

  ipcMain.handle("minecraft:versions", async () => {
    const { minecraftService } = createServices();
    return minecraftService.listVersions(state.settings.showSnapshots);
  });

  ipcMain.handle("catalog:search", async (_event, query, projectType, options = {}) => {
    const allowedTypes = ["mod", "modpack", "resourcepack", "shader"];
    const type = allowedTypes.includes(projectType) ? projectType : "mod";

    if (options.source === "curseforge") {
      return curseforgeService.searchCurseForge({
        query: query || "",
        type: type,
        gameVersion: options.version,
        loader: type === "resourcepack" ? undefined : options.loader,
        index: options.offset || 0,
        pageSize: 24,
        sortField:
          options.index === "downloads"
            ? 2
            : options.index === "updated"
              ? 3
              : options.index === "newest"
                ? 1
                : 2,
      });
    }
    const facets = [[`project_type:${type}`]];
    if (/^[a-zA-Z0-9._+-]{1,32}$/.test(options.version || "")) {
      facets.push([`versions:${options.version}`]);
    }
    if (type !== "resourcepack" && /^[a-zA-Z0-9_-]{1,32}$/.test(options.loader || "")) {
      facets.push([`categories:${options.loader}`]);
    }
    const indexes = new Set([
      "relevance",
      "downloads",
      "follows",
      "newest",
      "updated",
    ]);
    const selectedIndex = indexes.has(options.index)
      ? options.index
      : query
        ? "relevance"
        : "downloads";
    const params = new URLSearchParams({
      query: query || "",
      limit: "24",
      offset: String(
        Math.max(0, Math.min(10_000, Math.round(options.offset || 0))),
      ),
      index: selectedIndex,
      facets: JSON.stringify(facets),
    });
    return fetchJson(`https://api.modrinth.com/v2/search?${params.toString()}`);
  });
  ipcMain.handle("catalog:project", async (_event, id, source = "modrinth") => {
    if (source === "curseforge") {
      return curseforgeService.getCurseForgeMod(id);
    }
    return fetchJson(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`,
    );
  });
  ipcMain.handle(
    "catalog:versions",
    async (_event, id, source = "modrinth", options = {}) => {
      if (source === "curseforge") {
        return curseforgeService.getCurseForgeFiles(id, options);
      }
      const params = new URLSearchParams();
      if (options?.loader) {
        params.set("loaders", JSON.stringify([options.loader.toLowerCase()]));
      }
      if (options?.gameVersion) {
        params.set("game_versions", JSON.stringify([options.gameVersion]));
      }
      const query = params.toString() ? `?${params.toString()}` : "";
      return fetchJson(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version${query}`,
      );
    },
  );
  ipcMain.handle("catalog:picks", () => getOnyxPicks());
  ipcMain.handle(
    "catalog:install",
    async (_event, project, targetInstanceId) => {
      const existing = state.downloads.find(
        (item) =>
          item.projectId === project.project_id &&
          ["queued", "downloading", "installing"].includes(item.status),
      );
      if (existing) return structuredClone(existing);

      const task = {
        id: crypto.randomUUID(),
        projectId: project.project_id,
        projectType: project.project_type,
        name: project.title,
        subtitle: "Preparing installation",
        iconUrl: project.icon_url || null,
        progress: 1,
        status: "queued",
        createdAt: new Date().toISOString(),
        targetInstanceId: targetInstanceId || null,
        instanceId:
          project.project_type === "modpack" ? crypto.randomUUID() : null,
      };
      state.downloads.unshift(task);
      state.downloads = state.downloads.slice(0, 50);
      await saveState();
      taskUpdate(task, {});
      const controller = new AbortController();
      downloadControllers.set(task.id, controller);

      void (async () => {
        try {
          if (["mod", "resourcepack", "shader"].includes(project.project_type)) {
            const target =
              state.instances.find((item) => item.id === targetInstanceId) ||
              state.instances.find(
                (item) => item.favorite && item.status === "ready",
              ) ||
              state.instances.find((item) => item.status === "ready");
            if (!target) {
              throw new Error(
                "Install the game instance before adding content",
              );
            }
            const result = await installModToInstance(
              project,
              target,
              task,
              controller.signal,
            );
            taskUpdate(task, {
              status: "done",
              progress: 100,
              subtitle: result.dependencies
                ? `Installed in “${target.name}” · dependencies: ${result.dependencies}`
                : `Installed in “${target.name}”`,
              localPath: result.destination,
            });
            const contentKind =
              project.project_type === "resourcepack"
                ? "resourcepacks"
                : project.project_type === "shader"
                  ? "shaderpacks"
                  : "mods";
            const content = await listInstanceContent(target.id, contentKind);
            if (project.project_type === "mod") {
              instanceUpdate(target, {
                modCount: content.length,
              });
            }
          } else {
            let instance;
            if (project.source === "curseforge") {
              taskUpdate(task, {
                status: "downloading",
                subtitle: "Downloading CurseForge modpack",
              });
              const tracker = createProgressTracker();
              const res = await curseforgeService.installCurseForgeModpack({
                instancesRoot:
                  state.settings.gameDirectory ||
                  path.join(onyxRoot(), "instances"),
                instanceId: task.instanceId,
                modId: project.curseforgeId || project.project_id,
                packName: project.title,
                signal: controller.signal,
                onProgress: (p) => {
                  const tracked = tracker(p);
                  taskUpdate(task, {
                    status:
                      p.stage && (p.stage.startsWith("downloading") || isDownloadingStage(p.stage))
                        ? "downloading"
                        : "installing",
                    progress: Math.round((p.progress || 0) * 100),
                    subtitle: p.message,
                    received: tracked.received,
                    total: tracked.total,
                    speed: tracked.speed,
                    eta: tracked.eta,
                  });
                },
              });
              instance = res.metadata;
            } else {
              const { modpackService } = createServices();
              taskUpdate(task, {
                status: "downloading",
                subtitle: "Downloading modpack",
              });
              const tracker = createProgressTracker();
              instance = await modpackService.installProject({
                project,
                settings: state.settings,
                instanceId: task.instanceId,
                onProgress: (progress) => {
                  const tracked = tracker(progress);
                  taskUpdate(task, {
                    status: isDownloadingStage(progress.stage)
                      ? "downloading"
                      : "installing",
                    progress: progress.progress,
                    subtitle: progress.message,
                    received: tracked.received,
                    total: tracked.total,
                    speed: tracked.speed,
                    eta: tracked.eta,
                  });
                },
                signal: controller.signal,
              });
            }
            state.instances.unshift(instance);
            taskUpdate(task, {
              status: "done",
              progress: 100,
              subtitle: "The modpack is installed and ready to play",
              localPath: path.join(
                state.settings.gameDirectory,
                instance.id,
              ),
              instanceId: instance.id,
            });
            send("instance:updated", structuredClone(instance));
          }
          await saveState();
        } catch (error) {
          const cancelled =
            controller.signal.aborted || error?.name === "AbortError";
          taskUpdate(task, {
            status: cancelled ? "cancelled" : "error",
            error:
              cancelled
                ? "Installation cancelled by the user"
                : error instanceof Error
                  ? error.message
                  : "Unknown installation error",
          });
          if (project.project_type === "modpack" && task.instanceId) {
            await fsp
              .rm(
                path.join(state.settings.gameDirectory, task.instanceId),
                { recursive: true, force: true },
              )
              .catch(() => undefined);
          }
          await saveState();
        } finally {
          downloadControllers.delete(task.id);
        }
      })();
      return structuredClone(task);
    },
  );
  ipcMain.handle("catalog:import-pack", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Import Modrinth modpack",
      filters: [
        { name: "Modrinth modpack", extensions: ["mrpack"] },
        { name: "ZIP archive", extensions: ["zip"] },
      ],
    });
    if (result.canceled) return null;
    const packPath = result.filePaths[0];
    const task = {
      id: crypto.randomUUID(),
      name: path.basename(packPath),
      subtitle: "Importing local modpack",
      progress: 1,
      status: "installing",
      createdAt: new Date().toISOString(),
      instanceId: crypto.randomUUID(),
    };
    state.downloads.unshift(task);
    await saveState();
    taskUpdate(task, {});
    const controller = new AbortController();
    downloadControllers.set(task.id, controller);
    void (async () => {
      try {
        const { modpackService } = createServices();
        const tracker = createProgressTracker();
        const instance = await modpackService.installPack({
          packPath,
          settings: state.settings,
          instanceId: task.instanceId,
          onProgress: (progress) => {
            const tracked = tracker(progress);
            taskUpdate(task, {
              status: isDownloadingStage(progress.stage)
                ? "downloading"
                : "installing",
              progress: progress.progress,
              subtitle: progress.message,
              received: tracked.received,
              total: tracked.total,
              speed: tracked.speed,
              eta: tracked.eta,
            });
          },
          signal: controller.signal,
        });
        state.instances.unshift(instance);
        taskUpdate(task, {
          status: "done",
          progress: 100,
          subtitle: "Modpack imported",
          instanceId: instance.id,
          localPath: path.join(state.settings.gameDirectory, instance.id),
        });
        send("instance:updated", structuredClone(instance));
        await saveState();
      } catch (error) {
        const cancelled =
          controller.signal.aborted || error?.name === "AbortError";
        taskUpdate(task, {
          status: cancelled ? "cancelled" : "error",
          error:
            cancelled
              ? "Import cancelled by the user"
              : error instanceof Error
                ? error.message
                : "Modpack import error",
        });
        if (task.instanceId) {
          await fsp
            .rm(
              path.join(state.settings.gameDirectory, task.instanceId),
              { recursive: true, force: true },
            )
            .catch(() => undefined);
        }
        await saveState();
      } finally {
        downloadControllers.delete(task.id);
      }
    })();
    return structuredClone(task);
  });
  ipcMain.handle("catalog:cancel", async (_event, taskId) => {
    const controller = downloadControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    const task = state.downloads.find((item) => item.id === taskId);
    if (task) {
      taskUpdate(task, {
        status: "cancelled",
        error: "Operation cancelled by the user",
      });
      await saveState();
    }
    return true;
  });
  ipcMain.handle("catalog:clear-history", async () => {
    state.downloads = state.downloads.filter((task) =>
      ["queued", "downloading", "installing"].includes(task.status),
    );
    await saveState();
    return structuredClone(state.downloads);
  });

  ipcMain.handle("curseforge:search", async (_event, query, type, options) => {
    return curseforgeService.searchCurseForge({
      query,
      type,
      ...options,
    });
  });
  ipcMain.handle("curseforge:mod", async (_event, modId) => {
    return curseforgeService.getCurseForgeMod(modId);
  });
  ipcMain.handle("curseforge:files", async (_event, modId, options) => {
    return curseforgeService.getCurseForgeFiles(modId, options);
  });
  ipcMain.handle("curseforge:description", async (_event, modId) => {
    return curseforgeService.getCurseForgeDescription(modId);
  });
  ipcMain.handle(
    "curseforge:install-mod",
    async (_event, instanceId, modId, fileId) => {
      const targetInstance = state.instances.find((i) => i.id === instanceId);
      if (!targetInstance) throw new Error("Instance not found");

      const profile = loaderInfo(targetInstance);
      if (profile.loader === "vanilla") {
        throw new Error(
          "JAR mods require a Fabric, Quilt, Forge, or NeoForge instance",
        );
      }

      const res = await curseforgeService.installCurseForgeMod({
        instancesRoot: state.settings.gameDirectory,
        instanceId,
        modId,
        fileId,
        gameVersion: profile.minecraftVersion,
        loader: profile.loader,
      });

      const content = await listInstanceContent(targetInstance.id, "mods");
      instanceUpdate(targetInstance, {
        modCount: content.length,
      });
      send("instance:updated", structuredClone(targetInstance));
      await saveState();

      return res;
    },
  );
  ipcMain.handle("curseforge:install-modpack", async (_event, options) => {
    const task = {
      id: crypto.randomUUID(),
      projectId: String(options?.modId || ""),
      projectType: "modpack",
      name: options?.packName || "CurseForge Modpack",
      subtitle: "Preparing installation",
      iconUrl: options?.iconUrl || null,
      progress: 1,
      status: "downloading",
      createdAt: new Date().toISOString(),
      instanceId: crypto.randomUUID(),
    };
    state.downloads.unshift(task);
    state.downloads = state.downloads.slice(0, 50);
    await saveState();
    taskUpdate(task, {});
    const controller = new AbortController();
    downloadControllers.set(task.id, controller);

    try {
      const tracker = createProgressTracker();
      const res = await curseforgeService.installCurseForgeModpack({
        instancesRoot: state.settings.gameDirectory,
        instanceId: task.instanceId,
        ...options,
        signal: controller.signal,
        onProgress: (p) => {
          const tracked = tracker(p);
          taskUpdate(task, {
            status:
              p.stage && (p.stage.startsWith("downloading") || isDownloadingStage(p.stage))
                ? "downloading"
                : "installing",
            progress: Math.round((p.progress || 0) * 100),
            subtitle: p.message,
            received: tracked.received,
            total: tracked.total,
            speed: tracked.speed,
            eta: tracked.eta,
          });
        },
      });
      if (res?.metadata) {
        const existing = state.instances.findIndex((i) => i.id === res.metadata.id);
        if (existing >= 0) {
          state.instances[existing] = res.metadata;
        } else {
          state.instances.unshift(res.metadata);
        }
        send("instance:updated", structuredClone(res.metadata));
        taskUpdate(task, {
          status: "done",
          progress: 100,
          subtitle: "The modpack is installed and ready to play",
          localPath: path.join(state.settings.gameDirectory, res.metadata.id),
          instanceId: res.metadata.id,
        });
        await saveState();
      }
      return res;
    } catch (error) {
      const cancelled =
        controller.signal.aborted || error?.name === "AbortError";
      taskUpdate(task, {
        status: cancelled ? "cancelled" : "error",
        error: cancelled
          ? "Installation cancelled by the user"
          : error instanceof Error
            ? error.message
            : "Unknown installation error",
      });
      await saveState();
      throw error;
    } finally {
      downloadControllers.delete(task.id);
    }
  });

  ipcMain.handle("launcher:preflight", async (_event, instanceId) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) throw new Error("Instance not found");
    return preflightInstance(instance);
  });
  ipcMain.handle("launcher:play", async (_event, instanceId, options = {}) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return { ok: false, reason: "instance-not-found" };
    const existingLaunches = runningGames.get(instanceId);
    const existingCount = existingLaunches?.size || 0;
    try {
      send("launcher:progress", {
        instanceId,
        stage: "preflight",
        progress: 1,
        message: "Checking the instance before launch…",
      });
      const health = await preflightInstance(instance);
      if (!health.canLaunch) {
        const message = preflightBlockedMessage(health);
        instance.lastError = message;
        await saveState();
        return {
          ok: false,
          reason: `preflight-${health.blocker || "blocked"}`,
          message,
          health,
        };
      }
      if (
        health.repairNeeded ||
        !instance.resolvedVersionId ||
        instance.status !== "ready"
      ) {
        await runInstall(instance);
        await preflightInstance(instance);
      }
      const instanceDirectory = path.join(
        state.settings.gameDirectory,
        instance.id,
      );
      const [launchMods, modBaseline] = await Promise.all([
        snapshotMods(instanceDirectory),
        readModBaseline(instanceDirectory),
      ]);
      const changedMods = recentModChanges(modBaseline, launchMods);
      if (changedMods.length && existingCount === 0) {
        send("launcher:progress", {
          instanceId,
          stage: "world-guard",
          progress: 100,
          message: "World Guard is saving worlds before launching with changed mods…",
        });
        await createWorldSnapshot({
          instancesRoot: state.settings.gameDirectory,
          worldGuardRoot: path.join(onyxRoot(), "world-guard"),
          instanceId,
          reason: "mod-change-launch",
        });
      }
      let account = null;
      let demo = true;
      if (options?.username) {
        const customName = String(options.username).trim();
        account = {
          name: customName,
          uuid: offlineUuid(customName).replaceAll("-", ""),
          accessToken: "0",
          userType: "legacy",
          xuid: "",
          clientId: "",
        };
        demo = false;
      } else if (state.profile.kind === "microsoft" || state.profile.kind === "offline") {
        if (state.profile.kind === "microsoft") {
          send("launcher:progress", {
            instanceId,
            stage: "auth",
            progress: 100,
            message: "Refreshing the Microsoft session…",
          });
        }
        account = await authService.getLaunchAccount();
        if (!account) throw new Error("Select a saved account");
        if (state.profile.kind === "offline") {
          await syncOfflineSkin(state.profile, instanceDirectory);
        }
        demo = false;
      }

      if (existingCount > 0) {
        if (state.profile.kind === "offline" || !account || demo) {
          const baseName = account?.name || "Player";
          const altName = `${baseName}_${existingCount + 1}`;
          account = {
            name: altName,
            uuid: offlineUuid(altName).replaceAll("-", ""),
            accessToken: "0",
            userType: "legacy",
            xuid: "",
            clientId: "",
          };
        }
      }

      const { minecraftService } = createServices();
      const startedAt = Date.now();
      const sessionId = crypto.randomUUID();
      const recorder = new FlightRecorder({
        startedAt,
        allocatedMemoryGiB: effectiveSettings(instance).memory,
        sampleIntervalMs: process.platform === "win32" ? 10_000 : 5_000,
      });
      const fpsRecorder = new FpsRecorder({
        enabled: Boolean(instance.settings?.recordFps),
        outputDirectory: path.join(
          instanceDirectory,
          ".onyx",
          "telemetry",
          sessionId,
        ),
      });
      const fpsLaunch = await fpsRecorder.prepare().catch(() => ({
        wrapper: null,
        status: null,
        extraJvmArguments: [],
      }));
      const logFileName =
        existingCount > 0
          ? `scope-client-${existingCount + 1}.log`
          : "scope-latest.log";
      const launch = await minecraftService.buildLaunch({
        instance,
        settings: {
          ...effectiveSettings(instance),
          ...(options?.serverAddress ? { serverAddress: options.serverAddress } : {}),
        },
        account,
        demo,
        logFileName,
        launchWrapper: fpsLaunch.wrapper,
        extraJvmArguments: fpsLaunch.extraJvmArguments,
        onSpawn: (pid) => {
          recorder.attach(pid);
          fpsRecorder.attach(pid);
          void telemetryService.trackGameLaunch({
            distinctId: state.settings.anonymousClientId,
            enabled: state.settings.telemetry !== false,
            instanceId: instance.id,
            minecraftVersion: instance.version,
            loader: instance.loader,
          });
        },
        onLog: (payload) => {
          recorder.ingestLog(payload.text);
          partySvc.ingestGameLog(payload.text);
          discordRpcService.ingestGameLog(instanceId, payload.text, state.settings);
          send("launcher:log", { instanceId, ...payload });
        },
        onExit: async ({ code, logPath }) => {
          const currentMap = runningGames.get(instanceId);
          if (currentMap) {
            currentMap.delete(sessionId);
            if (currentMap.size === 0) {
              runningGames.delete(instanceId);
            }
          }
          const stillRunningCount = runningGames.get(instanceId)?.size || 0;
          if (stillRunningCount > 0) {
            instanceUpdate(instance, {
              status: "running",
              runningCount: stillRunningCount,
            });
            await saveState();
            return;
          }
          discordRpcService.instanceGameStates.delete(instanceId);
          if (state.settings.discordRpc !== false) {
            if (runningGames.size > 0) {
              const remainingId = runningGames.keys().next().value;
              const remainingInstance = state.instances.find(
                (i) => i.id === remainingId,
              );
              if (remainingInstance) {
                discordRpcService.setPlaying(remainingInstance, {
                  showGame: state.settings.discordRpcShowGame !== false,
                  showTime: state.settings.discordRpcShowTime !== false,
                  showServer: state.settings.discordRpcShowServer !== false,
                  showWorld: state.settings.discordRpcShowWorld !== false,
                  hideServerIp: state.settings.discordRpcHideServerIp === true,
                });
              }
            } else {
              discordRpcService.setIdle(discordRpcService.currentPage || "library", {
                showTime: state.settings.discordRpcShowTime !== false,
              });
            }
          }
          const endedAt = Date.now();
          const [performance, fps] = await Promise.all([
            recorder.stop({
              exitCode: code,
              endedAt,
            }),
            fpsRecorder.stop(),
          ]);
          performance.fps = fps;
          const fpsInsights = buildFpsInsights(fps);
          if (fpsInsights.length) {
            performance.insights = [
              ...fpsInsights,
              ...performance.insights.filter(
                (insight) => insight.code !== "stable-session",
              ),
            ].slice(0, 6);
          }
          const pinnedPerformanceBaseline =
            state.sessions.find(
              (session) =>
                session.id ===
                  instance.settings?.performanceBaselineSessionId &&
                session.instanceId === instance.id &&
                session.performance?.available,
            )?.performance || null;
          const previousPerformance =
            state.sessions.find(
              (session) =>
                session.instanceId === instance.id &&
                session.performance?.available,
            )?.performance || null;
          const regressionInsights = buildRegressionInsights(
            performance,
            pinnedPerformanceBaseline || previousPerformance,
          );
          if (regressionInsights.length) {
            performance.insights = [
              ...regressionInsights,
              ...performance.insights.filter(
                (insight) => insight.code !== "stable-session",
              ),
            ].slice(0, 6);
          }
          const logContent = await fsp
            .readFile(logPath, "utf8")
            .catch(() => "");
          const diagnoses = analyzeMinecraftLog(logContent);
          if (code === 0) {
            instance.lastAutoFix = null;
            await writeModBaseline(instanceDirectory, launchMods).catch(
              () => undefined,
            );
          } else {
            const suspects = changedMods;
            const likelyModFailure =
              diagnoses.length === 0 ||
              diagnoses.some((diagnosis) =>
                [
                  "missing-dependency",
                  "mixin-conflict",
                  "native-crash",
                  "graphics-init",
                  "corrupted-file",
                ].includes(diagnosis.code),
              );
            if (suspects.length && likelyModFailure) {
              diagnoses.unshift({
                code: "recent-mod-changes",
                severity: "warning",
                title: "Recently changed mods may be responsible",
                message:
                  "Mods changed after the last successful launch. Scope can temporarily disable them and retry.",
                suspects: suspects.slice(0, 12),
              });
            }

            const crashReport = await extractCrashReport({
              instanceDirectory,
              logContent,
              exitCode: code,
            });

            const topDiag = diagnoses[0];
            const culprit = crashReport.suspectedCulprit || topDiag?.suspects?.[0] || null;
            const errorTitle = crashReport.errorTitle || topDiag?.title || `Minecraft crash (exit code ${code})`;
            const stackTrace = crashReport.stackTrace || (logContent.slice(-2500) || `Process exited with code ${code}`);

            if (crashReport.foundCrashReport) {
              diagnoses.unshift({
                code: "crash-report",
                severity: "error",
                title: crashReport.errorTitle,
                message: crashReport.stackTrace.slice(0, 600),
                suspects: culprit ? [culprit] : [],
              });
            }

            const autoFix = await detectCrashAutoFix({
              instance,
              logContent,
              crashReport,
              instancesRoot: state.settings.gameDirectory,
            });
            instance.lastAutoFix = autoFix || null;
          }
          const minutes = Math.max(
            1,
            Math.round((Date.now() - startedAt) / 60_000),
          );
          const session = {
            id: sessionId,
            instanceId: instance.id,
            instanceName: instance.name,
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
            durationMinutes: minutes,
            exitCode: Number.isFinite(code) ? code : null,
            performance,
          };
          state.sessions.unshift(session);
          state.sessions = state.sessions.slice(0, 500);
          instance.playtimeMinutes =
            Number(instance.playtimeMinutes || 0) + minutes;
          instance.status = "ready";

          if (telemetryService) {
            void telemetryService.trackGameSession({
              distinctId: state?.settings?.anonymousClientId,
              instanceName: instance.name,
              minecraftVersion: instance.version,
              loader: instance.loader,
              durationMinutes: minutes,
              exitCode: Number.isFinite(code) ? code : null,
              avgFps: performance?.averageFps ? Math.round(performance.averageFps) : null,
              modCount: Array.isArray(launchMods) ? launchMods.length : 0,
              enabled: state?.settings?.telemetry !== false,
            }).catch(() => undefined);
          }
          instance.lastExitCode = code;
          instance.lastLogPath = logPath;
          instance.lastDiagnosis = diagnoses[0] || null;
          instance.lastPerformance = performance;
          instanceUpdate(instance, {
            status: "ready",
            runningCount: 0,
            playtimeMinutes: instance.playtimeMinutes,
            lastExitCode: code,
            lastDiagnosis: instance.lastDiagnosis,
            lastAutoFix: instance.lastAutoFix,
            lastPerformance: performance,
          });
          await saveState();
          send("session:recorded", structuredClone(session));
          if (ghostModeActive) {
            await restoreLauncherWindow();
          } else if (
            state.settings.closeOnLaunch &&
            mainWindow?.isVisible() === false
          ) {
            mainWindow.show();
          }
        },
      });
      if (!runningGames.has(instanceId)) {
        runningGames.set(instanceId, new Map());
      }
      runningGames.get(instanceId).set(sessionId, launch);
      const newRunningCount = runningGames.get(instanceId).size;
      if (state.settings.discordRpc !== false) {
        discordRpcService.setPlaying(instance, {
          showGame: state.settings.discordRpcShowGame !== false,
          showTime: state.settings.discordRpcShowTime !== false,
          showServer: state.settings.discordRpcShowServer !== false,
          showWorld: state.settings.discordRpcShowWorld !== false,
          hideServerIp: state.settings.discordRpcHideServerIp === true,
          isNewLaunch: true,
          startTime: Math.floor(Date.now() / 1000),
        });
      }
      instanceUpdate(instance, {
        status: "running",
        runningCount: newRunningCount,
        lastPlayed: "Just now",
        lastLogPath: launch.logPath,
        javaPath: launch.executable,
      });
      await saveState();
      if (state.settings.ghostMode) {
        setTimeout(() => enterGhostMode(), 350);
      } else if (state.settings.closeOnLaunch) {
        mainWindow?.hide();
      }
      return {
        ok: true,
        pid: launch.child.pid,
        demo,
        message: demo
          ? "Game launched in official demo mode"
          : "Game launched",
      };
    } catch (error) {
      instanceUpdate(instance, {
        status: instance.resolvedVersionId ? "ready" : "error",
        lastError:
          error instanceof Error ? error.message : "Game launch error",
      });
      await saveState();
      return {
        ok: false,
        reason: "launch-failed",
        message:
          error instanceof Error ? error.message : "Failed to launch the game",
      };
    }
  });
  ipcMain.handle("launcher:stop", async (_event, instanceId, sessionId = null) => {
    const launches = runningGames.get(instanceId);
    if (launches && launches.size > 0) {
      if (sessionId && launches.has(sessionId)) {
        launches.get(sessionId).child.kill();
        return true;
      }
      for (const launch of launches.values()) {
        try {
          launch.child.kill();
        } catch {}
      }
      return true;
    }
    const installation = installControllers.get(instanceId);
    if (installation) {
      installation.abort();
      return true;
    }
    return false;
  });
  ipcMain.handle("launcher:get-log", async (_event, instanceId) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    const launches = runningGames.get(instanceId);
    let logPath = null;
    if (launches && launches.size > 0) {
      for (const l of launches.values()) {
        logPath = l.logPath;
      }
    }
    if (!logPath) logPath = instance?.lastLogPath;
    if (!logPath) return { path: null, content: "", analysis: [] };
    try {
      const content = await fsp.readFile(logPath, "utf8");
      const analysis = analyzeMinecraftLog(content);
      if (
        instance?.lastDiagnosis?.code === "recent-mod-changes" &&
        !analysis.some(
          (diagnosis) => diagnosis.code === "recent-mod-changes",
        )
      ) {
        analysis.unshift(instance.lastDiagnosis);
      }
      return {
        path: logPath,
        content: content.slice(-120_000),
        analysis,
      };
    } catch {
      return { path: logPath, content: "", analysis: [] };
    }
  });
  ipcMain.handle(
    "launcher:export-support-bundle",
    async (_event, instanceId) => {
      const instance = findInstance(instanceId);
      const safeName =
        String(instance.name || "instance")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 42) || "instance";
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "Save Scope diagnostics bundle",
        defaultPath: path.join(
          app.getPath("documents"),
          `scope-support-${safeName}-${new Date().toISOString().slice(0, 10)}.zip`,
        ),
        filters: [{ name: "ZIP diagnostics bundle", extensions: ["zip"] }],
      });
      if (result.canceled || !result.filePath) return null;

      const launches = runningGames.get(instanceId);
      let logPath = null;
      if (launches && launches.size > 0) {
        for (const l of launches.values()) logPath = l.logPath;
      }
      if (!logPath) logPath = instance.lastLogPath;
      const [diagnostics, logContent] = await Promise.all([
        buildDiagnostics(),
        logPath
          ? fsp.readFile(logPath, "utf8").catch(() => "")
          : Promise.resolve(""),
      ]);
      const analysis = analyzeMinecraftLog(logContent);
      if (
        instance.lastDiagnosis &&
        !analysis.some(
          (diagnosis) => diagnosis.code === instance.lastDiagnosis.code,
        )
      ) {
        analysis.unshift(instance.lastDiagnosis);
      }
      const sessions = state.sessions
        .filter((session) => session.instanceId === instanceId)
        .sort(
          (left, right) =>
            new Date(right.endedAt).getTime() -
            new Date(left.endedAt).getTime(),
        );
      return createSupportBundle({
        destination: result.filePath,
        instance,
        sessions,
        diagnostics,
        logContent,
        analysis,
      });
    },
  );

  ipcMain.handle("updater:check", async () => {
    return updaterService.checkForUpdate(app.getVersion());
  });

  ipcMain.handle("updater:download", async () => {
    return updaterService.downloadUpdate({
      onProgress: (progress) => {
        send("updater:progress", progress);
      },
    });
  });

  ipcMain.handle("updater:install", async () => {
    return updaterService.applyUpdate();
  });
}

let pendingDeepLinkUrl = null;

function handleDeepLinkUrl(url) {
  if (!url || typeof url !== "string") return;
  const trimmed = url.trim();

  // 1. Pack link check FIRST!
  const isPack =
    trimmed.includes("/pack/") ||
    trimmed.startsWith("scope://pack/") ||
    trimmed.startsWith("onyx://pack/") ||
    trimmed.startsWith("pk_");

  if (isPack) {
    const packId = parseShareIdOrUrl(trimmed);
    if (packId) {
      if (!mainWindow || !mainWindow.webContents) {
        pendingDeepLinkUrl = url;
        return;
      }
      void restoreLauncherWindow();
      send("deep-link:pack", { url, packId });
      return;
    }
  }

  // 2. Party room check: MUST have party/ in scheme/path or match 3-3 code format
  const partyMatch =
    trimmed.match(/^(?:scope|onyx):\/\/party\/([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/\/party\/([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/\b([A-Za-z0-9]{3})[- ]([A-Za-z0-9]{3})\b/);

  if (partyMatch) {
    const code = (partyMatch[2] ? `${partyMatch[1]}-${partyMatch[2]}` : partyMatch[1]).toUpperCase();
    if (code !== "PACK") {
      if (!mainWindow || !mainWindow.webContents) {
        pendingDeepLinkUrl = url;
        return;
      }
      void restoreLauncherWindow();
      send("deep-link:party", { url, code });
      return;
    }
  }

  // 3. Fallback pack ID lookup
  const packId = parseShareIdOrUrl(trimmed);
  if (packId) {
    if (!mainWindow || !mainWindow.webContents) {
      pendingDeepLinkUrl = url;
      return;
    }
    void restoreLauncherWindow();
    send("deep-link:pack", { url, packId });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    void restoreLauncherWindow();
    const deepUrl = (commandLine || []).find(
      (arg) =>
        typeof arg === "string" &&
        (arg.startsWith("scope://") ||
          arg.startsWith("onyx://") ||
          arg.includes("/party/") ||
          arg.includes("/pack/") ||
          /\b[A-Za-z0-9]{3}[- ][A-Za-z0-9]{3}\b/.test(arg)),
    );
    if (deepUrl) {
      handleDeepLinkUrl(deepUrl);
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("app.scope.launcher");
    nativeTheme.themeSource = "dark";

    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("scope", process.execPath, [
          path.resolve(process.argv[1]),
        ]);
        app.setAsDefaultProtocolClient("onyx", process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient("scope");
      app.setAsDefaultProtocolClient("onyx");
    }

    const startupDeepLink = process.argv.find(
      (arg) => typeof arg === "string" && (arg.startsWith("scope://") || arg.startsWith("onyx://")),
    );
    if (startupDeepLink) {
      pendingDeepLinkUrl = startupDeepLink;
    }

    await loadState();
    authService = new AuthService(app.getPath("userData"));
    javaService = new JavaService(path.join(onyxRoot(), "runtimes"));
    const storedProfile = await authService.getProfile();
    if (storedProfile) {
      state.profile = storedProfile;
      await saveState();
    } else if (state.profile.kind === "microsoft" && !process.env.ONYX_CAPTURE_PATH) {
      state.profile = structuredClone(DEFAULT_STATE.profile);
      await saveState();
    }
    registerIpc();
    await createWindow();

    updaterService.downloadDirectory = path.join(app.getPath("temp"), "scope-updates");
    updaterService.currentVersion = app.getVersion();

    if (state.settings.autoCheckUpdates) {
      setTimeout(async () => {
        try {
          const update = await updaterService.checkForUpdate(app.getVersion());
          if (update && update.updateAvailable) {
            if (state.settings.notifications && Notification.isSupported()) {
              new Notification({
                title: "Scope Launcher Update",
                body: `Version ${update.latestVersion} is available to install.`,
                silent: false,
              }).show();
            }
            send("updater:available", update);
          }
        } catch {
          // background update check failed silently
        }
      }, 3000);
    }

    void telemetryService.trackAppLaunch({
      distinctId: state.settings.anonymousClientId,
      enabled: state.settings.telemetry !== false,
      version: app.getVersion(),
      os: process.platform,
      arch: process.arch,
      locale: typeof app.getLocale === "function" ? app.getLocale() : undefined,
      isPackaged: app.isPackaged,
    });

    discordRpcService.on("connected", () => {
      send("rpc:status-changed", discordRpcService.getStatus());
    });
    discordRpcService.on("disconnected", () => {
      send("rpc:status-changed", discordRpcService.getStatus());
    });

    if (state.settings.discordRpc !== false) {
      discordRpcService.enable();
      discordRpcService.setIdle("library", {
        showTime: state.settings.discordRpcShowTime !== false,
      });
    }

    partySvc.initStorage(onyxRoot());
    partySvc.restoreSavedSession().then((restored) => {
      if (restored) {
        console.log(`[party] Restored active room ${restored.code} (isHost: ${restored.isHost})`);
        wirePartySession();
        mainWindow?.webContents?.send("party:room-update", partySvc.getRoomState());
      }
    }).catch((err) => {
      console.warn("[party] Could not restore room session:", err.message);
    });

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await restoreLauncherWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (!ghostModeActive && process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  ghostModeActive = false;
  discordRpcService.disconnect();
  const reason = { preservePartial: true };
  for (const controller of installControllers.values()) {
    controller.abort(reason);
  }
  for (const controller of downloadControllers.values()) {
    controller.abort(reason);
  }
});

async function writeCrashLog(kind, reason) {
  const error =
    reason instanceof Error ? reason : new Error(String(reason ?? "Unknown error"));
  const logPath = path.join(app.getPath("userData"), "onyx-crash.log");
  const stack = error.stack || error.message || String(error);
  await fsp
    .appendFile(
      logPath,
      `[${new Date().toISOString()}] ${kind}\n${stack}\n\n`,
      "utf8",
    )
    .catch(() => undefined);
}

process.on("uncaughtException", async (error) => {
  await writeCrashLog("uncaughtException", error);
});

process.on("unhandledRejection", async (reason) => {
  await writeCrashLog("unhandledRejection", reason);
});

// ─── Party IPC Handlers (v2.0.0) ─────────────────────────────────────────────

/**
 * party:create
 * Creates a new party room on the Hub (host mode).
 * input: { displayName?, instanceId? }
 * returns: { code, deepLink, webLink, expiresAt, peerId }
 */
ipcMain.handle("party:create", async (_event, { displayName, instanceId, tunnelMode } = {}) => {
  let manifest = null;
  if (instanceId) {
    const instance = state.instances.find((i) => i.id === instanceId);
    if (instance) {
      const instanceDir = path.join(
        state.settings.gameDirectory || path.join(onyxRoot(), "instances"),
        instance.id,
        "mods"
      );
      // Build a lightweight manifest (mod files in mods/) for sync detection
      const mods = [];
      try {
        const { listInstanceContent } = require("./main.cjs"); // noop — inline below
        const files = await fsp.readdir(instanceDir).catch(() => []);
        for (const file of files) {
          if (/\.jar(?:\.disabled)?$/i.test(file)) {
            mods.push({ fileName: file, path: path.join(instanceDir, file) });
          }
        }
      } catch { /**/ }
      manifest = await partySvc.buildManifest(instance, mods).catch(() => null);
    }
  }

  const result = await partySvc.createRoom({
    displayName,
    instanceId,
    instanceManifest: manifest,
    tunnelMode,
  });

  wirePartySession();

  return { ...result, peerId: partySvc.activePeerId };
});

function wirePartySession() {
  partySvc.startSession({
    onRoomUpdate: async (roomState) => {
      if (!partySvc.isHost && roomState?.tunnelHost && roomState?.tunnelPort) {
        await partySvc.ensureGuestProxyAndBeacon(roomState.tunnelHost, roomState.tunnelPort);
      }
      const updated = partySvc.getRoomState() || roomState;
      mainWindow?.webContents?.send("party:room-update", updated);
    },
    onSignal: (signal) => {
      mainWindow?.webContents?.send("party:signal", signal);
    },
    onError: (err) => {
      mainWindow?.webContents?.send("party:error", err?.message || String(err));
    },
    onLanDetected: (info) => {
      mainWindow?.webContents?.send("party:lan-detected", info);
    },
  });
}

/**
 * party:join
 * Join an existing room as a guest.
 * input: { code, displayName?, instanceId? }
 * returns: initial roomState
 */
ipcMain.handle("party:join", async (_event, { code, displayName, instanceId } = {}) => {
  let instanceDirectory = null;
  if (instanceId) {
    instanceDirectory = path.join(
      state.settings.gameDirectory || path.join(onyxRoot(), "instances"),
      instanceId
    );
  }
  const roomState = await partySvc.joinRoom({
    code: String(code).toUpperCase(),
    displayName,
    instanceId,
    instanceDirectory,
  });

  wirePartySession();

  return partySvc.getRoomState() || roomState;
});

/**
 * party:set-guest-instance
 * Updates selected guest instance and synchronizes servers.dat injection.
 */
ipcMain.handle("party:set-guest-instance", async (_event, { instanceId } = {}) => {
  const instanceDirectory = instanceId
    ? path.join(state.settings.gameDirectory || path.join(onyxRoot(), "instances"), instanceId)
    : null;
  partySvc.setGuestInstance(instanceId, instanceDirectory);
  return { success: true };
});

/**
 * party:sync-mods
 * 1-click automatic download of missing/outdated mods from host manifest.
 */
ipcMain.handle("party:sync-mods", async (_event, { instanceId, mods = [] } = {}) => {
  const instance = state.instances.find((i) => i.id === instanceId);
  if (!instance) throw new Error("Instance not found");

  const instanceDirectory = path.join(
    state.settings.gameDirectory || path.join(onyxRoot(), "instances"),
    instance.id
  );

  const result = await partySvc.syncMods({
    instanceDirectory,
    mods,
    onProgress: (p) => {
      mainWindow?.webContents?.send("party:sync-progress", p);
    },
  });

  return result;
});

/**
 * party:check-e4mc
 * Check if e4mc VPN/CGNAT bypass mod is installed.
 */
ipcMain.handle("party:check-e4mc", async (_event, { instanceId } = {}) => {
  const instance = state.instances.find((i) => i.id === instanceId);
  if (!instance) throw new Error("Instance not found");
  const instancesRoot = state.settings.gameDirectory || path.join(onyxRoot(), "instances");
  return partySvc.checkE4mcStatus(instance, instancesRoot);
});

/**
 * party:install-e4mc
 * 1-click installer for e4mc mod.
 */
ipcMain.handle("party:install-e4mc", async (_event, { instanceId } = {}) => {
  const instance = state.instances.find((i) => i.id === instanceId);
  if (!instance) throw new Error("Instance not found");
  const instancesRoot = state.settings.gameDirectory || path.join(onyxRoot(), "instances");
  return partySvc.installE4mc({ instance, instancesRoot });
});

/**
 * party:convert-vanilla-e4mc
 * 1-click converter from Vanilla to Fabric with e4mc mod.
 */
ipcMain.handle("party:convert-vanilla-e4mc", async (_event, { instanceId } = {}) => {
  const instance = state.instances.find((i) => i.id === instanceId);
  if (!instance) throw new Error("Instance not found");
  const instancesRoot = state.settings.gameDirectory || path.join(onyxRoot(), "instances");
  const result = await partySvc.convertVanillaToFabricAndInstallE4mc({ instance, instancesRoot });
  await saveState();
  send("instance:updated", structuredClone(instance));
  return result;
});

/**
 * party:set-tunnel-mode
 * Select preferred tunnel mode: "auto" | "e4mc" | "upnp" | "playit" | "local"
 */
ipcMain.handle("party:set-tunnel-mode", async (_event, { mode } = {}) => {
  partySvc.setTunnelMode(mode);
  return { mode: partySvc.tunnelMode };
});

/**
 * party:test-upnp
 * Test UPnP IGD discovery and external IP retrieval on host network.
 */
ipcMain.handle("party:test-upnp", async () => {
  const info = partySvc.getNetworkInfo();
  return partySvc.setupUpnpTunnel({
    internalPort: 25565,
    localIp: info.lanIp,
  });
});

/**
 * party:network-info
 * Returns system network info including physical LAN IP and VPN active status.
 */
ipcMain.handle("party:network-info", () => {
  return partySvc.getNetworkInfo();
});

/**
 * party:status
 * Returns current cached room state and local party metadata.
 */
ipcMain.handle("party:status", () => {
  return {
    inRoom: partySvc.isInRoom,
    isHost: partySvc.isHost,
    peerId: partySvc.activePeerId,
    instanceId: partySvc.activeInstanceId,
    guestProxyPort: partySvc.guestProxyPort,
    tunnelMode: partySvc.tunnelMode,
    room: partySvc.getRoomState(),
  };
});

/**
 * party:update-manifest
 * Host pushes an updated instance manifest to the room.
 * input: { instanceId }
 */
ipcMain.handle("party:update-manifest", async (_event, { instanceId } = {}) => {
  const instance = state.instances.find((i) => i.id === instanceId);
  if (!instance) throw new Error("Instance not found");

  const instanceDir = path.join(
    state.settings.gameDirectory || path.join(onyxRoot(), "instances"),
    instance.id,
    "mods"
  );
  const mods = [];
  try {
    const files = await fsp.readdir(instanceDir).catch(() => []);
    for (const file of files) {
      if (/\.jar(?:\.disabled)?$/i.test(file)) {
        mods.push({ fileName: file, path: path.join(instanceDir, file) });
      }
    }
  } catch { /**/ }

  const manifest = await partySvc.buildManifest(instance, mods);
  await partySvc.updateRoomManifest(manifest);
  return manifest;
});

/**
 * party:diff-manifest
 * Diff local instance against host manifest from room state.
 * input: { instanceId }
 * returns: { identical, missing, outdated, extra, loaderMismatch, hostManifest }
 */
ipcMain.handle("party:diff-manifest", async (_event, { instanceId } = {}) => {
  if (!partySvc.isInRoom) throw new Error("Not in a room");

  const roomState = partySvc.getRoomState();
  const hostManifest = roomState?.instanceManifest;
  if (!hostManifest) return { identical: true, missing: [], outdated: [], extra: [], loaderMismatch: false, hostManifest: null };

  const instance = state.instances.find((i) => i.id === instanceId);
  if (!instance) throw new Error("Instance not found");

  const instanceDir = path.join(
    state.settings.gameDirectory || path.join(onyxRoot(), "instances"),
    instance.id,
    "mods"
  );

  const localMods = [];
  try {
    const { hashFile } = require("./services/network.cjs");
    const files = await fsp.readdir(instanceDir).catch(() => []);
    for (const file of files) {
      if (/\.jar(?:\.disabled)?$/i.test(file)) {
        const sha1 = await hashFile(path.join(instanceDir, file), "sha1").catch(() => null);
        localMods.push({ fileName: file, sha1, enabled: !file.endsWith(".disabled") });
      }
    }
  } catch { /**/ }

  const diff = partySvc.diffManifest(localMods, hostManifest);
  const loaderMismatch =
    hostManifest.loader !== instance.loader ||
    hostManifest.minecraftVersion !== instance.version;

  return { ...diff, loaderMismatch, hostManifest };
});

/**
 * party:set-ready
 * Mark current peer as ready (sync complete).
 * input: { ready? }
 */
ipcMain.handle("party:set-ready", async (_event, { ready = true } = {}) => {
  await partySvc.setReady(ready);
  return { success: true };
});

/**
 * party:close
 * Leave room (or close if host).
 */
ipcMain.handle("party:close", async () => {
  await partySvc.leaveRoom(partySvc.isHost);
  mainWindow?.webContents?.send("party:room-update", null);
  return { success: true };
});
