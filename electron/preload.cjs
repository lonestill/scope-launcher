const { contextBridge, ipcRenderer } = require("electron");

const api = {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  },
  state: {
    get: () => ipcRenderer.invoke("state:get"),
    updateSettings: (settings) =>
      ipcRenderer.invoke("state:update-settings", settings),
    moveGameDirectory: (path) =>
      ipcRenderer.invoke("state:move-game-directory", path),
    createInstance: (instance) =>
      ipcRenderer.invoke("instance:create", instance),
    deleteInstance: (id) => ipcRenderer.invoke("instance:delete", id),
    toggleFavorite: (id) => ipcRenderer.invoke("instance:favorite", id),
    updateInstance: (id, patch) =>
      ipcRenderer.invoke("instance:update", id, patch),
    duplicateInstance: (id) => ipcRenderer.invoke("instance:duplicate", id),
    openInstanceFolder: (id) =>
      ipcRenderer.invoke("instance:open-folder", id),
    listScreenshots: (id) =>
      ipcRenderer.invoke("instance:screenshots-list", id),
    readScreenshot: (id, fileName) =>
      ipcRenderer.invoke("instance:screenshot-read", id, fileName),
    copyScreenshot: (id, fileName) =>
      ipcRenderer.invoke("instance:screenshot-copy", id, fileName),
    showScreenshot: (id, fileName) =>
      ipcRenderer.invoke("instance:screenshot-show", id, fileName),
    deleteScreenshot: (id, fileName) =>
      ipcRenderer.invoke("instance:screenshot-delete", id, fileName),
    analyzeInstanceStorage: (id, force) =>
      ipcRenderer.invoke("instance:storage-analyze", id, force),
    cleanupInstanceStorage: (id) =>
      ipcRenderer.invoke("instance:storage-cleanup", id),
    listContent: (id, kind) =>
      ipcRenderer.invoke("instance:list-content", id, kind),
    checkContentUpdates: (id) =>
      ipcRenderer.invoke("instance:check-content-updates", id),
    updateContent: (id, path) =>
      ipcRenderer.invoke("instance:update-content", id, path),
    listContentHistory: (id) =>
      ipcRenderer.invoke("instance:list-content-history", id),
    listModProfiles: (id) =>
      ipcRenderer.invoke("instance:mod-profiles-list", id),
    saveModProfile: (id, name, profileId) =>
      ipcRenderer.invoke("instance:mod-profile-save", id, name, profileId),
    applyModProfile: (id, profileId) =>
      ipcRenderer.invoke("instance:mod-profile-apply", id, profileId),
    deleteModProfile: (id, profileId) =>
      ipcRenderer.invoke("instance:mod-profile-delete", id, profileId),
    rollbackContent: (id, transactionId) =>
      ipcRenderer.invoke("instance:rollback-content", id, transactionId),
    disableSuspects: (id, names) =>
      ipcRenderer.invoke("instance:disable-suspects", id, names),
    getBisect: (id) => ipcRenderer.invoke("instance:bisect-get", id),
    startBisect: (id, names) =>
      ipcRenderer.invoke("instance:bisect-start", id, names),
    reportBisect: (id, gameStarted) =>
      ipcRenderer.invoke("instance:bisect-report", id, gameStarted),
    cancelBisect: (id) => ipcRenderer.invoke("instance:bisect-cancel", id),
    finishBisect: (id, disableCulprit) =>
      ipcRenderer.invoke("instance:bisect-finish", id, disableCulprit),
    listWorldSnapshots: (id) =>
      ipcRenderer.invoke("instance:world-snapshots", id),
    createWorldSnapshot: (id) =>
      ipcRenderer.invoke("instance:world-snapshot-create", id),
    restoreWorldSnapshot: (id, snapshotId) =>
      ipcRenderer.invoke("instance:world-snapshot-restore", id, snapshotId),
    toggleContent: (path) =>
      ipcRenderer.invoke("instance:toggle-content", path),
    deleteContent: (path) =>
      ipcRenderer.invoke("instance:delete-content", path),
    repairInstance: (id) => ipcRenderer.invoke("instance:repair", id),
    checkUpdates: () => ipcRenderer.invoke("instance:check-updates"),
    previewPackUpdate: (id) =>
      ipcRenderer.invoke("instance:update-preview", id),
    updatePack: (id) => ipcRenderer.invoke("instance:update-pack", id),
    backupInstance: (id) => ipcRenderer.invoke("instance:backup", id),
    exportPerformanceCsv: (id) =>
      ipcRenderer.invoke("instance:export-performance-csv", id),
    importBackup: () => ipcRenderer.invoke("instance:import-backup"),
    exportSyncProfile: (id) =>
      ipcRenderer.invoke("instance:sync-export", id),
    shareSyncProfile: (id) =>
      ipcRenderer.invoke("instance:sync-share", id),
    previewSyncProfile: (urlOrId) =>
      ipcRenderer.invoke("instance:sync-preview-url", urlOrId),
    importSyncProfileUrl: (urlOrId, requestId) =>
      ipcRenderer.invoke("instance:sync-import-url", urlOrId, requestId),
    getPendingDeepLink: () =>
      ipcRenderer.invoke("instance:get-pending-deep-link"),
    importSyncProfile: () => ipcRenderer.invoke("instance:sync-import"),
    getSkinLoaderStatus: (id) =>
      ipcRenderer.invoke("instance:skin-loader-status", id),
    installSkinLoader: (id) =>
      ipcRenderer.invoke("instance:install-skin-loader", id),
  },
  system: {
    chooseDirectory: () => ipcRenderer.invoke("system:choose-directory"),
    chooseJava: () => ipcRenderer.invoke("system:choose-java"),
    openPath: (path) => ipcRenderer.invoke("system:open-path", path),
    javaStatus: () => ipcRenderer.invoke("system:java-status"),
    recommendInstance: (id) =>
      ipcRenderer.invoke("system:recommend-instance", id),
    fpsRecorderStatus: () =>
      ipcRenderer.invoke("system:fps-recorder-status"),
    serverStatus: (address) =>
      ipcRenderer.invoke("system:server-status", address),
    diagnostics: () => ipcRenderer.invoke("system:diagnostics"),
    exportDiagnostics: () => ipcRenderer.invoke("system:export-diagnostics"),
    clearCache: () => ipcRenderer.invoke("system:clear-cache"),
  },
  auth: {
    start: () => ipcRenderer.invoke("auth:start"),
    wait: (sessionId) => ipcRenderer.invoke("auth:wait", sessionId),
    cancel: (sessionId) => ipcRenderer.invoke("auth:cancel", sessionId),
    signOut: () => ipcRenderer.invoke("auth:sign-out"),
    list: () => ipcRenderer.invoke("auth:list"),
    refreshProfile: (accountId) =>
      ipcRenderer.invoke("auth:profile-refresh", accountId),
    addOffline: (name) => ipcRenderer.invoke("auth:offline-add", name),
    chooseSkin: (accountId, variant) =>
      ipcRenderer.invoke("auth:skin-select", accountId, variant),
    switch: (accountId) => ipcRenderer.invoke("auth:switch", accountId),
    remove: (accountId) => ipcRenderer.invoke("auth:remove", accountId),
  },
  minecraft: {
    versions: () => ipcRenderer.invoke("minecraft:versions"),
  },
  catalog: {
    picks: () => ipcRenderer.invoke("catalog:picks"),
    search: (query, projectType, options) =>
      ipcRenderer.invoke("catalog:search", query, projectType, options),
    getProject: (id, source) =>
      ipcRenderer.invoke("catalog:project", id, source),
    getVersions: (id, source, options) =>
      ipcRenderer.invoke("catalog:versions", id, source, options),
    install: (project, targetInstanceId) =>
      ipcRenderer.invoke("catalog:install", project, targetInstanceId),
    importPack: () => ipcRenderer.invoke("catalog:import-pack"),
    cancel: (taskId) => ipcRenderer.invoke("catalog:cancel", taskId),
    clearHistory: () => ipcRenderer.invoke("catalog:clear-history"),
  },
  curseforge: {
    search: (query, type, options) =>
      ipcRenderer.invoke("curseforge:search", query, type, options),
    getMod: (modId) => ipcRenderer.invoke("curseforge:mod", modId),
    getFiles: (modId, options) =>
      ipcRenderer.invoke("curseforge:files", modId, options),
    description: (modId) => ipcRenderer.invoke("curseforge:description", modId),
    installMod: (instanceId, modId, fileId) =>
      ipcRenderer.invoke("curseforge:install-mod", instanceId, modId, fileId),
    installModpack: (options) =>
      ipcRenderer.invoke("curseforge:install-modpack", options),
  },
  launcher: {
    preflight: (instanceId) =>
      ipcRenderer.invoke("launcher:preflight", instanceId),
    play: (instanceId, options) =>
      ipcRenderer.invoke("launcher:play", instanceId, options),
    stop: (instanceId, sessionId) =>
      ipcRenderer.invoke("launcher:stop", instanceId, sessionId),
    getLog: (instanceId) => ipcRenderer.invoke("launcher:get-log", instanceId),
    exportSupportBundle: (instanceId) =>
      ipcRenderer.invoke("launcher:export-support-bundle", instanceId),
  },
  crash: {
    detectAutoFix: (instanceId) =>
      ipcRenderer.invoke("instance:crash-detect-autofix", instanceId),
    applyAutoFix: (instanceId, fixAction) =>
      ipcRenderer.invoke("instance:crash-apply-autofix", instanceId, fixAction),
  },
  migration: {
    detect: () => ipcRenderer.invoke("migration:detect"),
    browseFolder: () => ipcRenderer.invoke("migration:browse-folder"),
    inspectFolder: (folderPath) =>
      ipcRenderer.invoke("migration:inspect-folder", folderPath),
    import: (candidates) => ipcRenderer.invoke("migration:import", candidates),
  },
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("updater:progress", listener);
      return () => ipcRenderer.removeListener("updater:progress", listener);
    },
    onUpdateAvailable: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("updater:available", listener);
      return () => ipcRenderer.removeListener("updater:available", listener);
    },
  },
  resourcepack: {
    inspect: (filePath) => ipcRenderer.invoke("resourcepack:inspect", filePath),
    downloadAndInspect: (options) =>
      ipcRenderer.invoke("resourcepack:download-and-inspect", options),
    cleanupPreview: (tempFilePath) =>
      ipcRenderer.invoke("resourcepack:cleanup-preview", tempFilePath),
    installPreview: (options) =>
      ipcRenderer.invoke("resourcepack:install-preview", options),
  },
  rpc: {
    getStatus: () => ipcRenderer.invoke("rpc:status"),
    setPage: (page) => ipcRenderer.invoke("rpc:page", page),
    onStatusChange: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("rpc:status-changed", listener);
      return () => ipcRenderer.removeListener("rpc:status-changed", listener);
    },
  },
  onDownloadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.removeListener("download:progress", listener);
  },
  onWindowMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
  onInstanceUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("instance:updated", listener);
    return () => ipcRenderer.removeListener("instance:updated", listener);
  },
  onSessionRecorded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("session:recorded", listener);
    return () => ipcRenderer.removeListener("session:recorded", listener);
  },
  onSyncImportProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("sync-import:progress", listener);
    return () => ipcRenderer.removeListener("sync-import:progress", listener);
  },
  onLauncherProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher:progress", listener);
    return () => ipcRenderer.removeListener("launcher:progress", listener);
  },
  onLauncherLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher:log", listener);
    return () => ipcRenderer.removeListener("launcher:log", listener);
  },
  onAuthStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("auth:status", listener);
    return () => ipcRenderer.removeListener("auth:status", listener);
  },
  onAuthChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("auth:changed", listener);
    return () => ipcRenderer.removeListener("auth:changed", listener);
  },
  onContentUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("content:update-progress", listener);
    return () =>
      ipcRenderer.removeListener("content:update-progress", listener);
  },
  onMaintenanceProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("maintenance:progress", listener);
    return () => ipcRenderer.removeListener("maintenance:progress", listener);
  },
  onMigrationProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("migration:progress", listener);
    return () => ipcRenderer.removeListener("migration:progress", listener);
  },
  onDeepLinkPack: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("deep-link:pack", listener);
    return () => ipcRenderer.removeListener("deep-link:pack", listener);
  },
  onDeepLinkParty: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("deep-link:party", listener);
    return () => ipcRenderer.removeListener("deep-link:party", listener);
  },
  party: {
    create: (opts) => ipcRenderer.invoke("party:create", opts),
    join: (opts) => ipcRenderer.invoke("party:join", opts),
    status: () => ipcRenderer.invoke("party:status"),
    getPendingDeepLink: () => ipcRenderer.invoke("state:get-pending-deep-link"),
    updateManifest: (opts) => ipcRenderer.invoke("party:update-manifest", opts),
    diffManifest: (opts) => ipcRenderer.invoke("party:diff-manifest", opts),
    setReady: (opts) => ipcRenderer.invoke("party:set-ready", opts),
    close: () => ipcRenderer.invoke("party:close"),
    setGuestInstance: (opts) => ipcRenderer.invoke("party:set-guest-instance", opts),
    syncMods: (opts) => ipcRenderer.invoke("party:sync-mods", opts),
    checkE4mc: (opts) => ipcRenderer.invoke("party:check-e4mc", opts),
    installE4mc: (opts) => ipcRenderer.invoke("party:install-e4mc", opts),
    convertVanillaE4mc: (opts) => ipcRenderer.invoke("party:convert-vanilla-e4mc", opts),
    setTunnelMode: (opts) => ipcRenderer.invoke("party:set-tunnel-mode", opts),
    testUpnp: () => ipcRenderer.invoke("party:test-upnp"),
    networkInfo: () => ipcRenderer.invoke("party:network-info"),
    onRoomUpdate: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("party:room-update", listener);
      return () => ipcRenderer.removeListener("party:room-update", listener);
    },
    onSignal: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("party:signal", listener);
      return () => ipcRenderer.removeListener("party:signal", listener);
    },
    onError: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("party:error", listener);
      return () => ipcRenderer.removeListener("party:error", listener);
    },
    onLanDetected: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("party:lan-detected", listener);
      return () => ipcRenderer.removeListener("party:lan-detected", listener);
    },
    onSyncProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("party:sync-progress", listener);
      return () => ipcRenderer.removeListener("party:sync-progress", listener);
    },
  },
};

contextBridge.exposeInMainWorld("scope", api);
contextBridge.exposeInMainWorld("onyx", api);

