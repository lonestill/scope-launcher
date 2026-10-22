export type RouteId =
  | "home"
  | "library"
  | "discover"
  | "downloads"
  | "instance"
  | "skins"
  | "community"
  | "settings";

export type Accent = "lime" | "violet" | "cyan";
export type Locale = "en" | "ru";
export type InstanceColor = "lime" | "amber" | "violet" | "cyan" | "rose";
export type InstanceStatus =
  | "ready"
  | "update"
  | "setup"
  | "pack-ready"
  | "installing"
  | "running"
  | "error";

export interface Profile {
  name: string;
  kind: "local" | "microsoft" | "offline";
  avatarUrl?: string;
  uuid?: string;
  signedInAt?: string;
  skins?: Array<{ id: string; state: string; url: string; variant?: string }>;
  capes?: Array<{ id: string; state: string; url: string; alias?: string }>;
}

export interface LauncherSettings {
  language: Locale;
  memory: number;
  gameDirectory: string;
  javaPath: string;
  closeOnLaunch: boolean;
  keepLauncherOpen: boolean;
  ghostMode: boolean;
  hardwareAcceleration: boolean;
  showSnapshots: boolean;
  notifications: boolean;
  autoCheckUpdates: boolean;
  reducedMotion: boolean;
  onboardingComplete: boolean;
  accent: Accent;
  windowWidth: number;
  windowHeight: number;
  fullscreen: boolean;
  telemetry?: boolean;
  anonymousClientId?: string;
  discordRpc?: boolean;
  discordRpcShowGame?: boolean;
  discordRpcShowTime?: boolean;
  discordRpcShowServer?: boolean;
  discordRpcShowWorld?: boolean;
  discordRpcHideServerIp?: boolean;
}

export interface DiscordRpcStatus {
  connected: boolean;
  connecting: boolean;
  enabled: boolean;
  user: string | null;
}

export interface GameInstance {
  id: string;
  sourceProjectId?: string;
  name: string;
  version: string;
  loader: string;
  description: string;
  color: InstanceColor;
  glyph: string;
  iconUrl?: string | null;
  favorite: boolean;
  status: InstanceStatus;
  runningCount?: number;
  lastPlayed: string;
  playtimeMinutes: number;
  modCount: number;
  packPath?: string;
  resolvedVersionId?: string;
  javaPath?: string;
  javaMajor?: number;
  installProgress?: number;
  installMessage?: string;
  lastError?: string;
  lastExitCode?: number | null;
  lastLogPath?: string;
  installedAt?: string;
  installProfile?: {
    minecraftVersion: string;
    loader: string;
    loaderVersion?: string | null;
  };
  settings?: {
    memory?: number;
    windowWidth?: number;
    windowHeight?: number;
    fullscreen?: boolean;
    recordFps?: boolean;
    performanceBaselineSessionId?: string;
    javaPath?: string;
    jvmArguments?: string[];
    serverAddress?: string;
    servers?: InstanceServer[];
    selectedServerId?: string;
  };
  updateAvailable?: {
    versionId: string;
    versionNumber: string;
    name: string;
    datePublished: string;
  } | null;
  lastDiagnosis?: LogDiagnosis | null;
  lastAutoFix?: CrashAutoFix | null;
  lastPerformance?: FlightPerformance | null;
  health?: InstanceHealthReport;
}

export interface InstanceServer {
  id: string;
  name: string;
  address: string;
  createdAt?: string;
}

export interface LogDiagnosis {
  code: string;
  severity: "error" | "warning";
  title: string;
  message: string;
  suspects?: string[];
}

export type AutoFixType =
  | "increase-memory"
  | "switch-java"
  | "install-indium"
  | "install-missing-dependency"
  | "disable-culprit-mod"
  | "remove-duplicate-mod"
  | "resolve-mod-conflict"
  | "reset-corrupted-config"
  | "reset-jvm-args"
  | "clean-corrupted-file"
  | "disable-active-shaderpack"
  | "repair-opengl-context"
  | "apply-wayland-fix"
  | "reset-video-options"
  | "disable-active-resourcepacks"
  | "upgrade-loader-version"
  | "switch-arm64-java"
  | "inject-java-module-flags"
  | "install-openjfx"
  | "enable-forge-entity-removal"
  | "quarantine-playerdata"
  | "restore-world-snapshot"
  | "kill-zombie-process"
  | "repair-instance-assets"
  | "cleanup-temp-install-files"
  | "reconcile-modpack-manifest"
  | "disable-environment-mismatched-mod"
  | "restore-corrupted-level-dat"
  | "resolve-mixin-overwrite"
  | "sanitize-options-txt"
  | "install-optifabric"
  | "purge-instance-logs-cache"
  | "install-language-adapter"
  | "suppress-gpu-hooks"
  | "force-switch-64bit-java"
  | "install-qsl-library"
  | "purge-corrupted-natives"
  | "allow-security-manager-flag";

export interface CrashAutoFix {
  type: AutoFixType;
  titleKey: string;
  descKey: string;
  payload: {
    currentMemoryGiB?: number;
    targetMemoryGiB?: number;
    requiredJavaMajor?: number;
    projectId?: string;
    modName?: string;
    modFileName?: string;
    fileName?: string;
    depId?: string;
    depName?: string;
    requiredBy?: string;
    modId?: string;
    keepFile?: string;
    disableFile?: string;
    conflictingMod?: string;
    incompatibleWith?: string;
    conflictReason?: string;
    configFile?: string;
    fullPath?: string;
    shaderpack?: string;
    jvmFlag?: string;
    optionsFile?: string;
    loader?: string;
    requiredVersion?: string;
    currentVersion?: string;
    targetArch?: string;
    flagCount?: number;
    requirement?: string;
    uuid?: string;
    worldgenIssue?: boolean;
    lockFile?: string;
    repair?: boolean;
    cleanedCount?: number;
    advisory?: boolean;
    environment?: string;
    mod?: string;
    worldName?: string;
    mixinName?: string;
    adapterName?: string;
    freedMb?: number;
  };
}

export type InstanceHealthStatus =
  | "healthy"
  | "warning"
  | "repair"
  | "blocked"
  | "setup";

export interface InstanceHealthCheck {
  code: string;
  status: "pass" | "warning" | "error";
  action?: "auto" | "repair" | "settings" | "content" | "autofix";
  message?: string;
  autoFix?: CrashAutoFix | null;
  path?: string;
  requiredMajor?: number;
  actualMajor?: number;
  requestedGiB?: number;
  availableGiB?: number;
  totalGiB?: number;
  freeBytes?: number;
  modCount?: number;
  duplicateCount?: number;
  duplicateIds?: string[];
  duplicateFiles?: string[];
}

export interface InstanceHealthReport {
  instanceId: string;
  checkedAt: string;
  status: InstanceHealthStatus;
  canLaunch: boolean;
  blocker: string | null;
  requiresInstall: boolean;
  repairNeeded: boolean;
  checks: InstanceHealthCheck[];
  autoFixes?: CrashAutoFix[];
  hasDoctorWarnings?: boolean;
}

export interface InstanceScreenshot {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface DownloadTask {
  id: string;
  projectId?: string;
  projectType?: "mod" | "modpack";
  targetInstanceId?: string | null;
  instanceId?: string | null;
  name: string;
  subtitle: string;
  iconUrl?: string | null;
  progress: number;
  status:
    | "queued"
    | "downloading"
    | "installing"
    | "done"
    | "error"
    | "cancelled";

  createdAt: string;
  received?: number;
  total?: number;
  localPath?: string;
  error?: string;
  speed?: number;
  eta?: number;
}

export interface LauncherState {
  profile: Profile;
  settings: LauncherSettings;
  instances: GameInstance[];
  downloads: DownloadTask[];
  sessions: PlaySession[];
}

export interface PlaySession {
  id: string;
  instanceId: string;
  instanceName: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  exitCode: number | null;
  performance?: FlightPerformance | null;
}

export interface FlightPerformance {
  available: boolean;
  durationMs: number;
  sampleCount: number;
  peakRssBytes: number;
  averageRssBytes: number;
  averageCpuPercent: number;
  peakCpuPercent: number;
  startupMs: number | null;
  worldReadyMs: number | null;
  gcEvents: number;
  maxGcPauseMs: number;
  outOfMemory: boolean;
  recommendedMemoryGiB: number;
  timeline: Array<{
    atSeconds: number;
    rssBytes: number;
    cpuPercent: number;
  }>;
  fps?: FpsPerformance;
  insights: Array<{
    code:
      | "memory-pressure"
      | "memory-overallocated"
      | "slow-startup"
      | "long-gc-pause"
      | "out-of-memory"
      | "early-crash"
      | "stable-session"
      | string;
    severity: "info" | "warning" | "error";
    value: number;
  }>;
}

export interface FpsPerformance {
  requested: boolean;
  available: boolean;
  provider: "mangohud" | "onyx-agent" | null;
  averageFps?: number;
  onePercentLowFps?: number;
  minimumFps?: number;
  frameTimeP99Ms?: number;
  stutterCount?: number;
  sampleCount?: number;
  timeline?: Array<{
    atSeconds: number;
    fps: number;
    frameTimeMs: number;
  }>;
  error: "provider-unavailable" | "no-fps-data" | string | null;
}

export interface FpsRecorderStatus {
  available: boolean;
  provider: "mangohud" | "onyx-agent" | null;
  name: string | null;
  executable: string | null;
  platform: string;
  installHint: string | null;
}

export interface ProjectGalleryItem {
  url: string;
  featured?: boolean;
  title?: string;
  description?: string;
}

export interface ProjectVersionFile {
  id: string | number;
  name: string;
  versionNumber?: string;
  fileName: string;
  fileSize?: number;
  datePublished: string;
  releaseType: "release" | "beta" | "alpha";
  gameVersions: string[];
  loaders: string[];
  downloads?: number;
  downloadUrl?: string | null;
  changelog?: string;
  raw?: unknown;
}

export interface CatalogProject {
  project_id: string;
  project_type: "mod" | "modpack" | "resourcepack" | "shader";
  slug: string;
  author: string;
  title: string;
  description: string;
  body?: string;
  categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url: string | null;
  banner_url?: string | null;
  date_modified: string;
  latest_version: string;
  license: string;
  client_side: string;
  server_side: string;
  source?: "modrinth" | "curseforge";
  curseforgeId?: number;
  gallery?: ProjectGalleryItem[];
  links?: {
    website?: string;
    wiki?: string;
    issues?: string;
    source?: string;
    discord?: string;
  };
}

export interface CatalogResponse {
  hits: CatalogProject[];
  offset: number;
  limit: number;
  total_hits: number;
}

export type OnyxPickMood = "performance" | "adventure" | "rpg" | "cozy";

export interface OnyxPick {
  id: string;
  slug: string;
  mood: OnyxPickMood;
  accent: InstanceColor;
  minimumMemoryGiB: number;
  recommendedMemoryGiB: number;
  reason: string;
  project: CatalogProject;
}

export interface NewInstanceInput {
  name: string;
  version: string;
  loader: string;
  description?: string;
  color?: InstanceColor;
}

export interface DownloadProgress {
  id: string;
  progress: number;
  status: DownloadTask["status"];
  received?: number;
  total?: number;
  error?: string;
  name?: string;
  subtitle?: string;
  iconUrl?: string | null;
  speed?: number;
  eta?: number;
}

export interface PlayResult {
  ok: boolean;
  reason?: string;
  message?: string;
  pid?: number;
  demo?: boolean;
  health?: InstanceHealthReport;
}

export interface MinecraftVersion {
  id: string;
  type: "release" | "snapshot" | string;
  releaseTime: string;
}

export interface InstanceContent {
  name: string;
  path: string;
  enabled: boolean;
  size: number;
  modifiedAt: string;
  kind?: "mods" | "resourcepacks" | "shaderpacks";
  sha1?: string;
  projectId?: string;
  currentVersionId?: string;
  projectVersion?: string;
  update?: {
    versionId: string;
    versionNumber: string;
    fileName: string;
    size: number;
  } | null;
}

export interface ContentUpdateResult {
  updated: boolean;
  reason?: string;
  path?: string;
  backup?: string;
  projectId?: string;
  versionId?: string;
  versionNumber?: string;
  fileName?: string;
  transactionId?: string | null;
}

export interface ContentHistoryEntry {
  id: string;
  createdAt: string;
  previousName: string;
  currentName: string;
  versionNumber: string | null;
  rolledBackAt: string | null;
}

export interface ModBisectSession {
  schema: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  round: number;
  originalCount: number;
  candidates: string[];
  testing: string[];
  status: "testing" | "found";
  culprit: string | null;
}

export interface ModProfileEntry {
  name: string;
  enabled: boolean;
}

export interface ModProfile {
  schema: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  modCount: number;
  enabledCount: number;
  entries: ModProfileEntry[];
  matchesCurrent?: boolean;
  changeCount?: number;
  missingCount?: number;
}

export interface ModProfileApplyResult {
  profile: ModProfile;
  changed: string[];
  missing: string[];
  unchanged: number;
}

export interface WorldSnapshot {
  id: string;
  instanceId: string;
  createdAt: string;
  reason: "manual" | "mod-update" | "pack-update" | "pre-restore" | string;
  worlds: string[];
  sourceBytes: number;
  files: number;
  bytes: number;
}

export interface PackUpdatePreview {
  versionId: string;
  versionNumber: string;
  name: string;
  datePublished: string;
  baselineAvailable: boolean;
  currentProfile: {
    minecraftVersion: string;
    loader: string;
    loaderVersion?: string | null;
  } | null;
  nextProfile: {
    minecraftVersion: string;
    loader: string;
    loaderVersion?: string | null;
  };
  added: Array<{ path: string; size: number; hash: string | null }>;
  changed: Array<{
    path: string;
    size: number;
    hash: string | null;
    previousSize: number;
  }>;
  removed: Array<{ path: string; size: number; hash: string | null }>;
  unchanged: number;
  downloadBytes: number;
}

export interface BackupResult {
  path: string;
  bytes: number;
  sourceBytes: number;
  files: number;
}

export interface InstanceStorageCategory {
  id:
    | "worlds"
    | "mods"
    | "resourcepacks"
    | "shaderpacks"
    | "config"
    | "screenshots"
    | "recordings"
    | "logs"
    | "runtime"
    | "metadata"
    | "other";
  bytes: number;
  files: number;
  directories: number;
}

export interface InstanceStorageReport {
  generatedAt: string;
  totalBytes: number;
  totalFiles: number;
  totalDirectories: number;
  inaccessible: number;
  categories: InstanceStorageCategory[];
  cleanable: {
    bytes: number;
    files: number;
    groups: {
      logs: { bytes: number; files: number };
      crashReports: { bytes: number; files: number };
      partial: { bytes: number; files: number };
    };
  };
}

export interface InstanceStorageCleanupResult {
  removedBytes: number;
  removedFiles: number;
  failed: number;
  report: InstanceStorageReport;
}

export interface SystemDiagnostics {
  generatedAt: string;
  launcher: {
    version: string;
    packaged: boolean;
    electron: string;
    chrome: string;
    node: string;
    processMemory: {
      workingSet: number;
      processes: number;
      byType: Array<{
        type: string;
        bytes: number;
        processes: number;
      }>;
    };
  };
  system: {
    platform: string;
    release: string;
    architecture: string;
    cpu: string;
    cpuThreads: number;
    totalMemory: number;
    freeMemory: number;
  };
  storage: {
    disk: { total: number; free: number };
    instances: { bytes: number; files: number; directories: number };
    data: { bytes: number; files: number; directories: number };
    gameDirectory: string;
    dataDirectory: string;
  };
  java: {
    executable: string;
    major: number;
    version: string;
    source?: "custom" | "system";
  } | null;
  profile: { kind: Profile["kind"]; name: string };
  counts: { instances: number; downloads: number; running: number };
  endpoints: Array<{
    name: string;
    ok: boolean;
    status: number;
    latencyMs: number;
    error?: string;
  }>;
}

export interface InstanceResourceRecommendation {
  memoryGiB: number;
  safeMaximumGiB: number;
  totalMemoryGiB: number;
  javaMajor: number;
  tier: "vanilla" | "light" | "medium" | "heavy" | "extreme";
  modCount: number;
}

export interface MinecraftServerStatus {
  online: boolean;
  address: string;
  resolvedAddress?: string;
  latencyMs?: number;
  version?: string;
  protocol?: number | null;
  playersOnline?: number;
  playersMax?: number;
  motd?: string;
  error?: string;
}

export interface LauncherProgress {
  instanceId: string;
  stage: string;
  progress: number;
  message: string;
  received?: number;
  total?: number;
}

export interface AuthStorageStatus {
  persistent: boolean;
  encrypted: boolean;
  backend: string | null;
}

export interface AuthLogin {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  message?: string;
}

export interface DiscoveredInstance {
  sourceLauncher:
    | "curseforge"
    | "prism"
    | "modrinth"
    | "vanilla"
    | "atlauncher"
    | "multimc"
    | "feather"
    | "custom"
    | string;
  name: string;
  version: string;
  loader: "fabric" | "forge" | "neoforge" | "quilt" | "vanilla" | string;
  loaderVersion: string | null;
  instancePath: string;
  gameDir: string;
  modCount: number;
  worldCount: number;
  hasOptions: boolean;
  hasServers: boolean;
  iconUrl?: string | null;
}

export interface DiscoveredLauncher {
  id: string;
  name: string;
  detected: boolean;
  path: string | null;
  instances: DiscoveredInstance[];
}

export interface MigrationDetectionResult {
  launchers: DiscoveredLauncher[];
  totalInstances: number;
}

export interface MigrationProgress {
  current: number;
  total: number;
  instanceName: string;
  phase: "copying" | "done";
  percent: number;
}

export interface MigrationResult {
  imported: GameInstance[];
  errors: Array<{ name: string; error: string }>;
}

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl: string | null;
  assetName: string | null;
  assetSize: number;
}

export interface UpdateProgress {
  received: number;
  total: number;
  percent?: number;
  speed?: number | null;
  eta?: number | null;
}

export interface ResourcePackBlockPreview {
  id: string;
  name: string;
  transparent?: boolean;
  textures: {
    top: string;
    bottom?: string;
    sides?: string;
    front?: string;
    back?: string;
    left?: string;
    right?: string;
  };
}

export interface ResourcePackItemPreview {
  id: string;
  name: string;
  texture: string;
}

export interface ResourcePackGuiPreview {
  id: string;
  name: string;
  category: "hud" | "container" | "title" | "misc";
  texture: string;
}

export interface ResourcePackInspectResult {
  name: string;
  description?: string;
  packFormat?: number;
  iconDataUrl?: string | null;
  blocks: ResourcePackBlockPreview[];
  items: ResourcePackItemPreview[];
  gui?: ResourcePackGuiPreview[];
  totalTextures: number;
  tempFilePath?: string;
}

export interface OnyxBridge {
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
  };
  state: {
    get(): Promise<LauncherState>;
    updateSettings(
      settings: Partial<LauncherSettings>,
    ): Promise<LauncherSettings>;
    moveGameDirectory(path: string): Promise<{
      settings: LauncherSettings;
      copied: number;
      oldDirectory: string;
      newDirectory: string;
      sourceRetained: boolean;
    }>;
    createInstance(input: NewInstanceInput): Promise<GameInstance>;
    deleteInstance(id: string): Promise<boolean>;
    toggleFavorite(id: string): Promise<GameInstance | null>;
    updateInstance(
      id: string,
      patch: Pick<Partial<GameInstance>, "name" | "description" | "color"> & {
        settings?: GameInstance["settings"];
      },
    ): Promise<GameInstance>;
    duplicateInstance(id: string): Promise<GameInstance>;
    openInstanceFolder(id: string): Promise<string>;
    listScreenshots(id: string): Promise<InstanceScreenshot[]>;
    readScreenshot(id: string, fileName: string): Promise<string>;
    copyScreenshot(id: string, fileName: string): Promise<boolean>;
    showScreenshot(id: string, fileName: string): Promise<boolean>;
    deleteScreenshot(id: string, fileName: string): Promise<boolean>;
    analyzeInstanceStorage(
      id: string,
      force?: boolean,
    ): Promise<InstanceStorageReport>;
    cleanupInstanceStorage(
      id: string,
    ): Promise<InstanceStorageCleanupResult>;
    listContent(
      id: string,
      kind?: "mods" | "resourcepacks" | "shaderpacks",
    ): Promise<InstanceContent[]>;
    checkContentUpdates(id: string): Promise<InstanceContent[]>;
    updateContent(id: string, path: string): Promise<ContentUpdateResult>;
    listContentHistory(id: string): Promise<ContentHistoryEntry[]>;
    listModProfiles(id: string): Promise<ModProfile[]>;
    saveModProfile(
      id: string,
      name: string,
      profileId?: string,
    ): Promise<ModProfile>;
    applyModProfile(
      id: string,
      profileId: string,
    ): Promise<ModProfileApplyResult>;
    deleteModProfile(id: string, profileId: string): Promise<boolean>;
    rollbackContent(
      id: string,
      transactionId: string,
    ): Promise<{
      restored: boolean;
      previousName: string;
      currentName: string;
      rolledBackAt: string;
    }>;
    disableSuspects(
      id: string,
      names: string[],
    ): Promise<{ disabled: string[]; skipped: string[] }>;
    getBisect(id: string): Promise<ModBisectSession | null>;
    startBisect(
      id: string,
      names?: string[],
    ): Promise<ModBisectSession>;
    reportBisect(
      id: string,
      gameStarted: boolean,
    ): Promise<ModBisectSession>;
    cancelBisect(id: string): Promise<{ restored: number }>;
    finishBisect(
      id: string,
      disableCulprit: boolean,
    ): Promise<{ culprit: string; disabled: boolean }>;
    listWorldSnapshots(id: string): Promise<WorldSnapshot[]>;
    createWorldSnapshot(id: string): Promise<WorldSnapshot | null>;
    restoreWorldSnapshot(
      id: string,
      snapshotId: string,
    ): Promise<{
      restored: boolean;
      snapshotId: string;
      worlds: string[];
      safetySnapshot: WorldSnapshot | null;
    }>;
    toggleContent(path: string): Promise<string>;
    deleteContent(path: string): Promise<boolean>;
    repairInstance(id: string): Promise<GameInstance>;
    checkUpdates(): Promise<GameInstance[]>;
    previewPackUpdate(id: string): Promise<PackUpdatePreview | null>;
    updatePack(id: string): Promise<{
      updated: boolean;
      instance: GameInstance;
      backupPath: string;
      obsoleteFiles: number;
      versionNumber: string | null;
    }>;
    backupInstance(id: string): Promise<BackupResult | null>;
    exportPerformanceCsv(id: string): Promise<string | null>;
    importBackup(): Promise<GameInstance | null>;
    exportSyncProfile(
      id: string,
    ): Promise<{ path: string; total: number; recognized: number } | null>;
    shareSyncProfile(
      id: string,
    ): Promise<{
      success: boolean;
      id: string;
      url: string;
      deepLink: string;
      total: number;
      recognized: number;
    }>;
    previewSyncProfile(urlOrId: string): Promise<{
      id: string;
      name: string;
      version: string;
      loader: string;
      modCount: number;
      author?: string | null;
      mods: Array<{ name: string; enabled: boolean; versionId?: string | null }>;
    }>;
    importSyncProfileUrl(urlOrId: string): Promise<{
      instance: GameInstance;
      installed: number;
      skipped: number;
    }>;
    getPendingDeepLink(): Promise<string | null>;
    importSyncProfile(): Promise<{
      instance: GameInstance;
      installed: number;
      skipped: number;
    } | null>;
    getSkinLoaderStatus(id: string): Promise<{
      installed: boolean;
      supported: boolean;
      loader: string;
      version: string;
      jarName: string | null;
    }>;
    installSkinLoader(id: string): Promise<{
      success: boolean;
      fileName: string;
    }>;
  };
  system: {
    chooseDirectory(): Promise<string | null>;
    chooseJava(): Promise<string | null>;
    openPath(path: string): Promise<string>;
    javaStatus(): Promise<{
      executable: string;
      major: number;
      version: string;
      source: "custom" | "system";
    } | null>;
    recommendInstance(
      id: string,
    ): Promise<InstanceResourceRecommendation>;
    fpsRecorderStatus(): Promise<FpsRecorderStatus>;
    serverStatus(address: string): Promise<MinecraftServerStatus>;
    diagnostics(): Promise<SystemDiagnostics>;
    exportDiagnostics(): Promise<string | null>;
    clearCache(): Promise<{ bytes: number; files: number }>;
  };
  auth: {
    start(): Promise<AuthLogin>;
    wait(sessionId: string): Promise<Profile>;
    cancel(sessionId: string): Promise<void>;
    signOut(): Promise<Profile>;
    list(): Promise<{
      activeId: string | null;
      profiles: Profile[];
      storage: AuthStorageStatus;
    }>;
    refreshProfile(accountId: string): Promise<Profile>;
    addOffline(name: string): Promise<Profile>;
    chooseSkin(
      accountId: string,
      variant: "classic" | "slim",
    ): Promise<Profile | null>;
    switch(accountId: string): Promise<Profile>;
    remove(accountId: string): Promise<Profile>;
  };
  minecraft: {
    versions(): Promise<MinecraftVersion[]>;
  };
  catalog: {
    picks(): Promise<OnyxPick[]>;
    search(
      query: string,
      projectType: "modpack" | "mod" | "resourcepack" | "shader",
      options?: {
        version?: string;
        loader?: string;
        index?: "relevance" | "downloads" | "follows" | "newest" | "updated";
        offset?: number;
        source?: "modrinth" | "curseforge";
      },
    ): Promise<CatalogResponse>;
    getProject(
      id: string | number,
      source?: "modrinth" | "curseforge",
    ): Promise<unknown>;
    getVersions(
      id: string | number,
      source?: "modrinth" | "curseforge",
      options?: {
        gameVersion?: string;
        loader?: string;
        pageSize?: number;
      },
    ): Promise<unknown[]>;
    install(
      project: CatalogProject,
      targetInstanceId?: string,
    ): Promise<DownloadTask>;
    importPack(): Promise<DownloadTask | null>;
    cancel(taskId: string): Promise<boolean>;
    clearHistory(): Promise<DownloadTask[]>;
  };
  curseforge: {
    search(
      query: string,
      type?: "modpack" | "mod" | "resourcepack" | "shader",
      options?: {
        gameVersion?: string;
        loader?: string;
        index?: number;
        pageSize?: number;
        sortField?: number;
      },
    ): Promise<CatalogResponse>;
    getMod(modId: string | number): Promise<CatalogProject & { raw: unknown }>;
    getFiles(
      modId: string | number,
      options?: {
        gameVersion?: string;
        loader?: string;
        pageSize?: number;
      },
    ): Promise<
      Array<{
        id: number;
        displayName: string;
        fileName: string;
        fileDate: string;
        fileLength: number;
        releaseType: number;
        downloadUrl: string | null;
        gameVersions: string[];
      }>
    >;
    description(modId: string | number): Promise<string>;
    installMod(
      instanceId: string,
      modId: string | number,
      fileId?: number,
    ): Promise<{ destination: string; fileName: string; fileId: number }>;
    installModpack(options: {
      fileUrl?: string;
      fileId?: number;
      modId?: number;
      packName?: string;
    }): Promise<{ instanceId: string; name: string; metadata: GameInstance }>;
  };
  launcher: {
    preflight(instanceId: string): Promise<InstanceHealthReport>;
    play(
      instanceId: string,
      options?: { username?: string; multiClient?: boolean },
    ): Promise<PlayResult>;
    stop(instanceId: string, sessionId?: string): Promise<boolean>;
    getLog(instanceId: string): Promise<{
      path: string | null;
      content: string;
      analysis: LogDiagnosis[];
    }>;
    exportSupportBundle(instanceId: string): Promise<{
      path: string;
      bytes: number;
      files: number;
    } | null>;
  };
  crash: {
    detectAutoFix(instanceId: string): Promise<CrashAutoFix | null>;
    applyAutoFix(
      instanceId: string,
      fixAction: CrashAutoFix,
    ): Promise<{ success: boolean; action: string; message?: string }>;
  };
  migration: {
    detect(): Promise<MigrationDetectionResult>;
    browseFolder(): Promise<{
      folderPath: string;
      candidate: DiscoveredInstance | null;
    } | null>;
    inspectFolder(folderPath: string): Promise<DiscoveredInstance | null>;
    import(candidates: DiscoveredInstance[]): Promise<MigrationResult>;
  };
  updater: {
    check(): Promise<UpdateInfo>;
    download(): Promise<{ destination: string; size: number } | boolean>;
    install(): Promise<boolean>;
    onProgress(callback: (progress: UpdateProgress) => void): () => void;
    onUpdateAvailable?(callback: (info: UpdateInfo) => void): () => void;
  };
  resourcepack: {
    inspect(filePath: string): Promise<ResourcePackInspectResult>;
    downloadAndInspect(options: {
      url: string;
      projectId?: string;
    }): Promise<ResourcePackInspectResult>;
    cleanupPreview(tempFilePath: string): Promise<void>;
    installPreview(options: {
      tempFilePath: string;
      instanceId: string;
      filename?: string;
    }): Promise<string>;
  };
  rpc: {
    getStatus(): Promise<DiscordRpcStatus>;
    setPage(page: string): Promise<boolean>;
    onStatusChange(callback: (status: DiscordRpcStatus) => void): () => void;
  };
  onDownloadProgress(
    callback: (progress: DownloadProgress) => void,
  ): () => void;
  onWindowMaximized(callback: (maximized: boolean) => void): () => void;
  onInstanceUpdated(callback: (instance: GameInstance) => void): () => void;
  onSessionRecorded(callback: (session: PlaySession) => void): () => void;
  onLauncherProgress(
    callback: (progress: LauncherProgress) => void,
  ): () => void;
  onLauncherLog(
    callback: (log: {
      instanceId: string;
      channel: string;
      text: string;
      logPath: string;
    }) => void,
  ): () => void;
  onAuthStatus(
    callback: (status: { sessionId: string; message: string }) => void,
  ): () => void;
  onAuthChanged(callback: (profile: Profile) => void): () => void;
  onContentUpdateProgress(
    callback: (progress: {
      instanceId: string;
      path: string;
      received?: number;
      total?: number;
      progress: number;
      done?: boolean;
    }) => void,
  ): () => void;
  onMaintenanceProgress(
    callback: (progress: {
      instanceId?: string;
      operation: "backup" | "import" | "move";
      message: string;
      progress: number;
      processed?: number;
      total?: number;
      done?: boolean;
    }) => void,
  ): () => void;
  onMigrationProgress(
    callback: (progress: MigrationProgress) => void,
  ): () => void;
  onDeepLinkPack(
    callback: (data: { url: string; packId: string }) => void,
  ): () => void;
  onDeepLinkParty(
    callback: (data: { code: string; url: string }) => void,
  ): () => void;
  party: {
    create(opts?: { displayName?: string; instanceId?: string; tunnelMode?: "auto" | "e4mc" | "upnp" | "playit" | "local" }): Promise<{
      code: string;
      deepLink: string;
      webLink: string;
      expiresAt: string;
      peerId: string;
    }>;
    join(opts: { code: string; displayName?: string; instanceId?: string }): Promise<PartyRoomState>;
    status(): Promise<{
      inRoom: boolean;
      isHost: boolean;
      peerId: string;
      instanceId?: string | null;
      guestProxyPort?: number | null;
      tunnelMode?: "auto" | "e4mc" | "upnp" | "playit" | "local";
      room: PartyRoomState | null;
    }>;
    getPendingDeepLink?(): Promise<string | null>;
    updateManifest(opts: { instanceId: string }): Promise<PartyManifest>;
    diffManifest(opts: { instanceId: string }): Promise<PartyDiffResult>;
    setReady(opts?: { ready?: boolean }): Promise<{ success: boolean }>;
    close(): Promise<{ success: boolean }>;
    setGuestInstance(opts: { instanceId?: string | null }): Promise<{ success: boolean }>;
    syncMods(opts: {
      instanceId: string;
      mods?: Array<{ fileName: string; sha1?: string | null; modrinthId?: string | null; versionId?: string | null; outdatedFileName?: string }>;
    }): Promise<{ installed: string[]; failed: Array<{ fileName: string; reason: string }> }>;
    checkE4mc(opts: { instanceId: string }): Promise<{ installed: boolean; supported: boolean; loader: string; version: string; jarName: string | null }>;
    installE4mc(opts: { instanceId: string }): Promise<{ installed: boolean; jarName: string; versionNumber?: string }>;
    convertVanillaE4mc(opts: { instanceId: string }): Promise<{ success: boolean; loader: string; loaderVersion: string | null; jarName: string }>;
    setTunnelMode(opts: { mode: "auto" | "e4mc" | "upnp" | "playit" | "local" }): Promise<{ mode: string }>;
    testUpnp(): Promise<{ success: boolean; externalIp?: string; externalPort?: number; isCgnat?: boolean; error?: string }>;
    networkInfo(): Promise<{ lanIp: string; hasVpn: boolean; physicalIp: string | null; virtualIp: string | null }>;
    onRoomUpdate(callback: (state: PartyRoomState | null) => void): () => void;
    onSignal(callback: (signal: PartySignal) => void): () => void;
    onError(callback: (message: string) => void): () => void;
    onLanDetected(callback: (info: { lanPort: number; relayPort: number; hostIp: string; isE4mc?: boolean; tunnelType?: "e4mc" | "upnp" | "playit" | "local" }) => void): () => void;
    onSyncProgress(callback: (progress: { index: number; total: number; modName: string; percent: number; status: string }) => void): () => void;
  };
}

export interface PartyPeer {
  peerId: string;
  displayName: string | null;
  isHost: boolean;
  joinedAt: string;
  ready: boolean;
}

export interface PartyRoomState {
  success: boolean;
  code: string;
  hostPeerId: string;
  status: 'waiting' | 'hosting' | 'closed';
  peers: PartyPeer[];
  instanceManifest: PartyManifest | null;
  tunnelHost?: string | null;
  tunnelPort?: number | null;
  hostDisplayName?: string | null;
  guestProxyPort?: number | null;
  expiresAt: string;
  updatedAt: string;
}

export interface PartyManifest {
  schema: number;
  loader: string;
  loaderVersion: string | null;
  minecraftVersion: string;
  mods: PartyModEntry[];
  generatedAt: string;
  _tunnel?: { host: string; port: number; setAt: string };
}

export interface PartyModEntry {
  fileName: string;
  sha1: string | null;
  modrinthId: string | null;
  versionId: string | null;
  enabled: boolean;
  clientOnly?: boolean;
}

export interface PartyDiffResult {
  identical: boolean;
  compatible: boolean;
  criticalMissing: PartyModEntry[];
  criticalOutdated: Array<{ local: PartyModEntry; remote: PartyModEntry; clientOnly?: boolean }>;
  missing: PartyModEntry[];
  outdated: Array<{ local: PartyModEntry; remote: PartyModEntry; clientOnly?: boolean }>;
  extra: PartyModEntry[];
  loaderMismatch: boolean;
  hostManifest: PartyManifest | null;
}

export interface PartySignal {
  fromPeerId: string;
  type: 'offer' | 'answer' | 'candidate' | 'tunnel-info' | 'heartbeat';
  payload: unknown;
  createdAt: string;
}

