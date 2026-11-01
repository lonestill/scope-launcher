const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const tar = require("tar-stream");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { ZipArchive } = require("archiver");
const {
  applyRules,
  mavenArtifact,
  libraryKey,
  mergeVersion,
  expandArguments,
  parseServerAddress,
  normalizeResolvedVersionId,
} = require("../electron/services/minecraft.cjs");
const {
  safeDestination,
  readZipJson,
  extractZip,
  extractTarGz,
} = require("../electron/services/archive.cjs");
const {
  minecraftOsName,
  adoptiumOsName,
  adoptiumArchitecture,
  azulOsName,
  azulArchitecture,
  javaExecutableNames,
  javaConsoleExecutable,
  defaultDataRoot,
} = require("../electron/services/platform.cjs");
const {
  downloadFile,
  fileMatches,
  readJsonResponse,
} = require("../electron/services/network.cjs");
const {
  comparePackIndexes,
  profileFromDependencies,
  selectPackRelease,
} = require("../electron/services/modpack.cjs");
const {
  MinecraftService,
} = require("../electron/services/minecraft.cjs");
const {
  JavaService,
  inspectJava,
  findSystemJava,
} = require("../electron/services/java.cjs");
const {
  safeChild,
  createInstanceBackup,
  importInstanceBackup,
} = require("../electron/services/maintenance.cjs");
const {
  listModHistory,
  rollbackModUpdate,
  selectVersionFile,
  safeModrinthDownload,
} = require("../electron/services/content.cjs");
const {
  analyzeMinecraftLog,
} = require("../electron/services/log-analysis.cjs");
const {
  checkInstanceHealth,
  requiredJavaForMinecraft,
  reportStatus,
} = require("../electron/services/preflight.cjs");
const {
  PICK_DEFINITIONS,
} = require("../electron/services/picks.cjs");
const {
  disableSuspectMods,
  readModBaseline,
  recentModChanges,
  snapshotMods,
  writeModBaseline,
} = require("../electron/services/guard.cjs");
const {
  startBisect,
  reportBisectResult,
  finishBisect,
  readBisectSession,
} = require("../electron/services/bisect.cjs");
const {
  applyModProfile,
  deleteModProfile,
  listModProfiles,
  saveModProfile,
} = require("../electron/services/mod-profiles.cjs");
const {
  createWorldSnapshot,
  listWorldSnapshots,
  restoreWorldSnapshot,
} = require("../electron/services/world-guard.cjs");
const {
  createSyncProfile,
  validateSyncProfile,
} = require("../electron/services/sync.cjs");
const {
  parseCpuTime,
  downsampleTimeline,
  buildInsights,
  buildRegressionInsights,
  FlightRecorder,
} = require("../electron/services/flight-recorder.cjs");
const {
  detectFpsRecorder,
  parseFpsCsv,
  buildFpsInsights,
} = require("../electron/services/fps-recorder.cjs");
const {
  createSupportBundle,
  sanitizeSupportText,
} = require("../electron/services/support-bundle.cjs");
const {
  analyzeInstanceStorage,
  cleanupInstanceStorage,
} = require("../electron/services/instance-storage.cjs");
const {
  recommendInstanceResources,
  generateOptimizedJvmFlags,
} = require("../electron/services/tuning.cjs");
const {
  decodeVarInt,
  encodeString,
  encodeVarInt,
  motdToText,
  parseStatusResponse,
  resolveMinecraftEndpoint,
} = require("../electron/services/server-status.cjs");
const {
  parseTomlModIds,
  scanInstanceMods,
} = require("../electron/services/mod-metadata.cjs");
const {
  AuthService,
  CLIENT_ID,
  DEFAULT_CLIENT_ID,
  DEVICE_CODE_ENDPOINT,
  TOKEN_ENDPOINT,
  SCOPE,
  MC_LOGIN,
} = require("../electron/services/auth.cjs");
const { calculateSpeed, calculateEta } = require("../electron/services/network.cjs");

const temporaryRoot = path.resolve(__dirname, ".tmp");

async function writeTestJar(filePath, entries) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const zip = new ZipArchive({ zlib: { level: 1 } });
    output.once("close", resolve);
    output.once("error", reject);
    zip.once("error", reject);
    zip.pipe(output);
    for (const [name, content] of Object.entries(entries)) {
      zip.append(content, { name });
    }
    void zip.finalize();
  });
}

test.before(async () => {
  assert.ok(temporaryRoot.startsWith(path.resolve(__dirname)));
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
  await fsp.mkdir(temporaryRoot, { recursive: true });
});

test.after(async () => {
  assert.ok(temporaryRoot.startsWith(path.resolve(__dirname)));
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
});

test("Maven coordinates are converted to the official library path", () => {
  const artifact = mavenArtifact(
    "org.example:demo:1.2.3:natives-windows",
    "https://repo.example/",
  );
  assert.equal(
    artifact.path,
    "org/example/demo/1.2.3/demo-1.2.3-natives-windows.jar",
  );
  assert.equal(
    artifact.url,
    "https://repo.example/org/example/demo/1.2.3/demo-1.2.3-natives-windows.jar",
  );
});

test("mergeVersion deduplicates libraries by Maven coordinate giving child precedence", () => {
  const parent = {
    id: "1.21.4",
    libraries: [
      { name: "org.ow2.asm:asm:9.6" },
      { name: "org.lwjgl:lwjgl:3.3.3" },
      { name: "com.google.guava:guava:32.1.2-jre" },
    ],
  };
  const child = {
    id: "fabric-loader-0.19.5-1.21.4",
    inheritsFrom: "1.21.4",
    libraries: [
      { name: "org.ow2.asm:asm:9.10.1" },
      { name: "net.fabricmc:fabric-loader:0.19.5" },
    ],
  };
  const merged = mergeVersion(parent, child);
  const names = merged.libraries.map((l) => l.name);
  assert.deepEqual(names, [
    "org.ow2.asm:asm:9.10.1",
    "net.fabricmc:fabric-loader:0.19.5",
    "org.lwjgl:lwjgl:3.3.3",
    "com.google.guava:guava:32.1.2-jre",
  ]);
  assert.equal(libraryKey({ name: "org.ow2.asm:asm:9.6" }), "org.ow2.asm:asm");
  assert.equal(
    libraryKey({ name: "org.lwjgl:lwjgl:3.3.3:natives-macos" }),
    "org.lwjgl:lwjgl:natives-macos",
  );
});

test("Mojang rules account for the OS, architecture, and launch flags", () => {
  const windows = { platform: "win32", arch: "x64", version: "10.0" };
  const linux = { platform: "linux", arch: "x64", version: "6.12" };
  assert.equal(
    applyRules([{ action: "allow", os: { name: "windows" } }], {}, windows),
    true,
  );
  assert.equal(
    applyRules([{ action: "allow", os: { name: "windows" } }], {}, linux),
    false,
  );
  assert.equal(
    applyRules([{ action: "allow", os: { name: "linux" } }], {}, linux),
    true,
  );
  assert.equal(
    applyRules([{ action: "allow", os: { arch: "x86_64" } }], {}, linux),
    true,
  );
  assert.deepEqual(
    expandArguments(
      [
        "--always",
        {
          rules: [{ action: "allow", features: { is_demo_user: true } }],
          value: ["--demo", "true"],
        },
      ],
      { is_demo_user: true },
    ),
    ["--always", "--demo", "true"],
  );
});

test("A Modrinth profile selects the loader and Minecraft version", () => {
  assert.deepEqual(
    profileFromDependencies({
      minecraft: "1.21.1",
      "fabric-loader": "0.16.14",
    }),
    {
      minecraftVersion: "1.21.1",
      loader: "fabric",
      loaderVersion: "0.16.14",
    },
  );
  assert.equal(
    selectPackRelease([
      { id: "beta", version_type: "beta", files: [{ filename: "a.mrpack" }] },
      {
        id: "release",
        version_type: "release",
        files: [{ filename: "b.mrpack" }],
      },
    ]).id,
    "release",
  );
});

test("The extractor does not write files outside the instance", () => {
  const root = path.join(temporaryRoot, "instance");
  assert.equal(
    safeDestination(root, "mods/example.jar"),
    path.join(root, "mods", "example.jar"),
  );
  assert.throws(() => safeDestination(root, "../../outside.txt"));
  assert.throws(() => safeChild(root, "../outside"));
});
test("The platform layer selects the correct names and directories", () => {
  assert.equal(minecraftOsName("win32"), "windows");
  assert.equal(minecraftOsName("linux"), "linux");
  assert.equal(minecraftOsName("darwin"), "osx");
  assert.equal(adoptiumOsName("darwin"), "mac");
  assert.deepEqual(javaExecutableNames("win32"), ["javaw.exe", "java.exe"]);
  assert.deepEqual(javaExecutableNames("linux"), ["java"]);
  assert.equal(javaConsoleExecutable("/opt/jdk/bin/java", "linux"), "/opt/jdk/bin/java");
  assert.equal(javaConsoleExecutable("C:\\jdk\\bin\\javaw.exe", "win32"), "C:\\jdk\\bin\\java.exe");
  assert.equal(
    defaultDataRoot({
      platform: "linux",
      env: { XDG_DATA_HOME: "/var/data" },
      home: "/home/player",
      appData: "/unused",
    }),
    path.join("/var/data", "scope-launcher"),
  );
});

test("The Java runtime is extracted from a Linux tar.gz archive", async () => {
  const archivePath = path.join(temporaryRoot, "runtime.tar.gz");
  const destination = path.join(temporaryRoot, "runtime");
  const pack = tar.pack();
  const writing = pipeline(
    pack,
    zlib.createGzip(),
    fs.createWriteStream(archivePath),
  );
  pack.entry(
    { name: "jdk/bin/java", mode: 0o755 },
    Buffer.from("linux-java"),
  );
  pack.finalize();
  await writing;
  await extractTarGz(archivePath, destination);
  assert.equal(
    await fsp.readFile(path.join(destination, "jdk", "bin", "java"), "utf8"),
    "linux-java",
  );
});

test("An invalid authorization response produces a clear error instead of SyntaxError", async () => {
  const endpoint = "https://login.live.com/oauth20_token.srf";
  await assert.rejects(
    readJsonResponse(
      new Response("<!doctype html><title>Gateway</title>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
      endpoint,
    ),
    /login\.live\.com returned an unexpected response instead of JSON \(502, text\/html\)/,
  );
  assert.deepEqual(
    await readJsonResponse(
      new Response('{"access_token":"example"}', {
        headers: { "content-type": "application/json" },
      }),
      endpoint,
    ),
    { access_token: "example" },
  );
  assert.deepEqual(
    await readJsonResponse(
      new Response(null, {
        status: 401,
      }),
      "https://user.auth.xboxlive.com/user/authenticate",
    ),
    {},
  );
});

test("Microsoft OAuth uses the current Prism consumer flow", () => {
  assert.equal(
    DEFAULT_CLIENT_ID,
    "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb",
  );
  assert.equal(
    CLIENT_ID,
    (process.env.ONYX_MICROSOFT_CLIENT_ID || DEFAULT_CLIENT_ID).trim(),
  );
  assert.equal(
    DEVICE_CODE_ENDPOINT,
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
  );
  assert.equal(
    TOKEN_ENDPOINT,
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  );
  assert.equal(SCOPE, "XboxLive.SignIn XboxLive.offline_access");
  assert.equal(MC_LOGIN, "https://api.minecraftservices.com/launcher/login");

  const service = new AuthService(temporaryRoot);
  assert.deepEqual(service.minecraftLoginPayload("user-hash", "xsts-token"), {
    xtoken: "XBL3.0 x=user-hash;xsts-token",
    platform: "PC_LAUNCHER",
  });
});

test("exchangeMicrosoftToken throws clean error on missing Java license when profile returns 404", async () => {
  const service = new AuthService(temporaryRoot);
  service.postJson = async (url) => {
    if (url.includes("user.auth.xboxlive.com")) return { Token: "mock-xbl-token" };
    if (url.includes("xsts.auth.xboxlive.com")) {
      return {
        Token: "mock-xsts-token",
        DisplayClaims: { xui: [{ uhs: "mock-uhs" }] },
      };
    }
    if (url.includes("launcher/login")) return { access_token: "mock-mc-token" };
    throw new Error(`Unexpected postJson URL: ${url}`);
  };
  service.fetchJson = async (url) => {
    if (url.includes("entitlements/mcstore")) return { items: [] };
    if (url.includes("minecraft/profile")) {
      const err = new Error("The server returned 404: Not Found");
      err.status = 404;
      throw err;
    }
    throw new Error(`Unexpected fetchJson URL: ${url}`);
  };

  await assert.rejects(
    service.exchangeMicrosoftToken({ access_token: "mock-ms-token" }),
    /No Minecraft: Java Edition license was found on this account/,
  );
});

test("exchangeMicrosoftToken throws clean error when license exists but profile is 404", async () => {
  const service = new AuthService(temporaryRoot);
  service.postJson = async (url) => {
    if (url.includes("user.auth.xboxlive.com")) return { Token: "mock-xbl-token" };
    if (url.includes("xsts.auth.xboxlive.com")) {
      return {
        Token: "mock-xsts-token",
        DisplayClaims: { xui: [{ uhs: "mock-uhs" }] },
      };
    }
    if (url.includes("launcher/login")) return { access_token: "mock-mc-token" };
    throw new Error(`Unexpected postJson URL: ${url}`);
  };
  service.fetchJson = async (url) => {
    if (url.includes("entitlements/mcstore")) {
      return { items: [{ name: "game_minecraft" }] };
    }
    if (url.includes("minecraft/profile")) {
      const err = new Error("The server returned 404: Not Found");
      err.status = 404;
      throw err;
    }
    throw new Error(`Unexpected fetchJson URL: ${url}`);
  };

  await assert.rejects(
    service.exchangeMicrosoftToken({ access_token: "mock-ms-token" }),
    /A Minecraft profile has not been created yet/,
  );
});

test("Without a system keyring, the refresh token remains in memory only", async () => {
  const authRoot = path.join(temporaryRoot, "volatile-auth");
  const service = new AuthService(authRoot);
  if (service.encryptionAvailable()) return;
  await service.saveAccount({
    profile: { uuid: "volatile-user", name: "Player", kind: "microsoft" },
    refreshToken: "must-not-reach-disk",
    oauthClientId: CLIENT_ID,
    signedInAt: new Date().toISOString(),
  });
  const accounts = await service.listAccounts();
  assert.equal(accounts.storage.persistent, false);
  assert.equal(accounts.profiles[0].uuid, "volatile-user");
  await assert.rejects(fsp.stat(path.join(authRoot, "account.json")));
});

test('An offline account gets a UUID, launches without a token, and stores a skin', async () => {
  const authRoot = path.join(temporaryRoot, 'offline-auth');
  const skinPath = path.join(authRoot, 'skin.png');
  const service = new AuthService(authRoot);
  service.encryptionAvailable = () => false;

  const profile = await service.addOfflineAccount('Player_One');
  assert.equal(profile.kind, 'offline');
  assert.equal(profile.uuid, '0e0c6371-8599-3a43-a117-30cb7e62c579');
  assert.deepEqual(await service.getLaunchAccount(), {
    name: 'Player_One',
    uuid: '0e0c637185993a43a11730cb7e62c579',
    accessToken: '0',
    userType: 'legacy',
    xuid: '',
    clientId: '',
  });

  const skin = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(skin, 0);
  skin.write('IHDR', 12, 'ascii');
  skin.writeUInt32BE(64, 16);
  skin.writeUInt32BE(64, 20);
  await fsp.writeFile(skinPath, skin);

  const withSkin = await service.setSkinFromFile(skinPath, 'slim');
  assert.equal(withSkin.skins[0].variant, 'slim');
  assert.match(withSkin.skins[0].url, /^data:image\/png;base64,/);

  const second = await service.addOfflineAccount('Player_Two');
  await service.switchAccount(profile.uuid);
  const secondWithSkin = await service.setSkinFromFile(
    skinPath,
    'classic',
    second.uuid,
  );
  assert.equal(secondWithSkin.skins[0].variant, 'classic');
  assert.equal((await service.getProfile()).uuid, profile.uuid);
  await assert.rejects(service.addOfflineAccount('two words'));

  const restarted = new AuthService(authRoot);
  restarted.encryptionAvailable = () => false;
  assert.equal((await restarted.getProfile()).name, 'Player_One');
});

test("Refresh tokens from a different OAuth client require signing in again", async () => {
  const service = new AuthService(temporaryRoot);
  assert.equal(service.sameClientId(CLIENT_ID.toUpperCase(), CLIENT_ID), true);
  assert.equal(service.sameClientId("00000000402b5328", CLIENT_ID), false);
  assert.equal(service.sameClientId(null, CLIENT_ID), false);

  service.loadAccount = async () => ({
    profile: { uuid: "legacy-account" },
    refreshToken: "legacy-refresh-token",
    oauthClientId: null,
  });
  await assert.rejects(
    service.getLaunchAccount(),
    /The account uses a legacy Microsoft OAuth format/,
  );
});

test("Update file selection excludes development artifacts and third-party CDNs", () => {
  const file = selectVersionFile({
    files: [
      {
        filename: "example-sources.jar",
        primary: true,
        url: "https://cdn.modrinth.com/sources.jar",
      },
      {
        filename: "example.jar",
        primary: false,
        url: "https://cdn.modrinth.com/example.jar",
      },
    ],
  });
  assert.equal(file.filename, "example.jar");
  assert.equal(
    safeModrinthDownload("https://cdn.modrinth.com/data/project/file.jar"),
    "https://cdn.modrinth.com/data/project/file.jar",
  );
  assert.throws(() =>
    safeModrinthDownload("https://example.invalid/payload.jar"),
  );
});

test("Log analysis turns common crashes into actionable guidance", () => {
  const diagnoses = analyzeMinecraftLog(`
    java.lang.OutOfMemoryError: Java heap space
    org.spongepowered.asm.mixin.transformer.throwables.MixinApplyError
  `);
  assert.deepEqual(
    diagnoses.map((item) => item.code),
    ["out-of-memory", "mixin-conflict"],
  );
  assert.deepEqual(
    analyzeMinecraftLog(`
      java.util.zip.ZipException: zip END header not found
      Unrecognized VM option 'UseConcMarkSweepGC'
      GLFW error 65542: WGL: The driver does not appear to support OpenGL
      java.nio.file.AccessDeniedException: /games/instance/options.txt
    `).map((item) => item.code),
    [
      "corrupted-file",
      "bad-jvm-arguments",
      "graphics-init",
      "permission-denied",
    ],
  );
  assert.equal(analyzeMinecraftLog("Game started normally").length, 0);
});

test("Mod history rolls back an update and preserves the current file", async () => {
  const instancesRoot = path.join(temporaryRoot, "history-instances");
  const instanceId = "history-instance";
  const instanceRoot = path.join(instancesRoot, instanceId);
  const modsRoot = path.join(instanceRoot, "mods");
  const historyRoot = path.join(
    instanceRoot,
    ".onyx",
    "history",
    "mods",
  );
  const transactionsRoot = path.join(historyRoot, "transactions");
  const transactionId = "2026-07-29T12-00-00-000Z-test";
  await fsp.mkdir(modsRoot, { recursive: true });
  await fsp.mkdir(transactionsRoot, { recursive: true });
  await fsp.writeFile(path.join(modsRoot, "demo-new.jar"), "new");
  await fsp.writeFile(path.join(historyRoot, "demo-old.jar"), "old");
  await fsp.writeFile(
    path.join(transactionsRoot, `${transactionId}.json`),
    JSON.stringify({
      schema: 1,
      kind: "mod-update",
      id: transactionId,
      createdAt: "2026-07-29T12:00:00.000Z",
      previousName: "demo-old.jar",
      currentName: "demo-new.jar",
      backupName: "demo-old.jar",
      replacedBackupName: null,
      versionNumber: "2.0.0",
      rolledBackAt: null,
    }),
  );

  const before = await listModHistory({ instancesRoot, instanceId });
  assert.equal(before.length, 1);
  assert.equal(before[0].versionNumber, "2.0.0");

  const result = await rollbackModUpdate({
    instancesRoot,
    instanceId,
    transactionId,
  });
  assert.equal(result.restored, true);
  assert.equal(
    await fsp.readFile(path.join(modsRoot, "demo-old.jar"), "utf8"),
    "old",
  );
  assert.equal(
    await fsp.stat(path.join(modsRoot, "demo-new.jar")).catch(() => null),
    null,
  );
  const historyFiles = await fsp.readdir(historyRoot);
  assert.ok(
    historyFiles.some((name) => name.endsWith("-rollback-demo-new.jar")),
  );
  const after = await listModHistory({ instancesRoot, instanceId });
  assert.ok(after[0].rolledBackAt);
  await assert.rejects(() =>
    rollbackModUpdate({ instancesRoot, instanceId, transactionId }),
  );
});

test("Guard finds mods added since the last successful launch and disables them", async () => {
  const instancesRoot = path.join(temporaryRoot, "guard-instances");
  const instanceId = "guard-instance";
  const instanceRoot = path.join(instancesRoot, instanceId);
  const modsRoot = path.join(instanceRoot, "mods");
  await fsp.mkdir(modsRoot, { recursive: true });
  await fsp.writeFile(path.join(modsRoot, "stable.jar"), "stable");
  const first = await snapshotMods(instanceRoot);
  await writeModBaseline(instanceRoot, first);
  const baseline = await readModBaseline(instanceRoot);
  assert.equal(baseline.mods.length, 1);

  await fsp.writeFile(path.join(modsRoot, "new-renderer.jar"), "new");
  const second = await snapshotMods(instanceRoot);
  assert.deepEqual(recentModChanges(baseline, second), [
    "new-renderer.jar",
  ]);

  const disabled = await disableSuspectMods({
    instancesRoot,
    instanceId,
    names: ["new-renderer.jar"],
  });
  assert.deepEqual(disabled.disabled, ["new-renderer.jar"]);
  assert.equal(
    await fsp.readFile(
      path.join(modsRoot, "new-renderer.jar.disabled"),
      "utf8",
    ),
    "new",
  );
  await assert.rejects(() =>
    disableSuspectMods({
      instancesRoot,
      instanceId,
      names: ["../outside.jar"],
    }),
  );
});

test("AutoTune accounts for the mod count without consuming all memory", () => {
  assert.equal(requiredJavaForMinecraft("1.16.5"), 8);
  assert.equal(requiredJavaForMinecraft("1.20.1"), 17);
  assert.equal(requiredJavaForMinecraft("1.20.4"), 17);
  assert.equal(requiredJavaForMinecraft("1.20.5"), 21);
  assert.equal(requiredJavaForMinecraft("26.1"), 21);
  const heavy = recommendInstanceResources({
    instance: {
      version: "1.21.1",
      loader: "Fabric 0.16",
      modCount: 180,
    },
    totalMemory: 16 * 1024 ** 3,
  });
  assert.equal(heavy.memoryGiB, 8);
  assert.equal(heavy.javaMajor, 21);
  assert.equal(heavy.safeMaximumGiB, 13);
  const constrained = recommendInstanceResources({
    instance: {
      version: "1.20.1",
      loader: "Forge",
      modCount: 260,
    },
    totalMemory: 8 * 1024 ** 3,
  });
  assert.equal(constrained.memoryGiB, 4);
  assert.equal(constrained.javaMajor, 17);
  assert.ok(constrained.memoryGiB <= constrained.safeMaximumGiB);
});

test("Smart Hardware GC AutoTune selects Generational ZGC for Java 21+ and tuned G1GC for Java 17", () => {
  const zgcFlags = generateOptimizedJvmFlags({
    memoryGiB: 6,
    javaMajor: 21,
    cpuCores: 8,
  });
  assert.ok(zgcFlags.includes("-XX:+UseZGC"));
  assert.ok(zgcFlags.includes("-XX:+ZGenerational"));
  assert.ok(zgcFlags.includes("-XX:+UseStringDeduplication"));

  const g1Flags = generateOptimizedJvmFlags({
    memoryGiB: 4,
    javaMajor: 17,
    cpuCores: 8,
  });
  assert.ok(g1Flags.includes("-XX:+UseG1GC"));
  assert.ok(g1Flags.includes("-XX:MaxGCPauseMillis=30"));
  assert.ok(g1Flags.includes("-XX:ParallelGCThreads=8"));
  assert.ok(g1Flags.includes("-XX:ConcGCThreads=2"));

  const lowRamZgc = generateOptimizedJvmFlags({
    memoryGiB: 2,
    javaMajor: 21,
  });
  assert.ok(lowRamZgc.includes("-XX:+UseG1GC")); // Under 4GB falls back to G1GC
});

test("Pre-Flight Doctor detects orphan session.lock and OptiFine without OptiFabric", async () => {
  const root = path.join(temporaryRoot, "preflight-doctor");
  const instanceRoot = path.join(root, "instances");
  const instId = "doctor-test";
  const instDir = path.join(instanceRoot, instId);
  const modsDir = path.join(instDir, "mods");
  await fsp.mkdir(modsDir, { recursive: true });
  await fsp.writeFile(path.join(instDir, "session.lock"), "lock");
  await fsp.writeFile(path.join(modsDir, "OptiFine_1.20.1_HD_U_I6.jar"), "optifine");
  await fsp.writeFile(path.join(instDir, "options.txt"), "gamma:NaN\nfov:70.0\n");

  const report = await checkInstanceHealth({
    instance: {
      id: instId,
      version: "1.20.1",
      loader: "fabric",
      status: "ready",
      resolvedVersionId: "fabric-loader-0.15.11-1.20.1",
    },
    settings: { memory: 4 },
    sharedRoot: path.join(root, "shared"),
    instancesRoot: instanceRoot,
  });

  assert.equal(report.hasDoctorWarnings, true);
  assert.ok(report.autoFixes.length >= 3);
  assert.ok(report.checks.some((c) => c.code === "orphan-session-lock"));
  assert.ok(report.checks.some((c) => c.code === "optifine-fabric-unsupported"));
  assert.ok(report.checks.some((c) => c.code === "options-corrupted-values"));
});

test("An Onyx backup transfers worlds, settings, and metadata", async () => {
  const sourceRoot = path.join(temporaryRoot, "backup-source");
  const restoreRoot = path.join(temporaryRoot, "backup-restore");
  const sourceDirectory = path.join(sourceRoot, "test-instance");
  await fsp.mkdir(path.join(sourceDirectory, "worlds", "My World"), {
    recursive: true,
  });
  await fsp.mkdir(path.join(sourceDirectory, "mods"), { recursive: true });
  await fsp.writeFile(
    path.join(sourceDirectory, "worlds", "My World", "level.dat"),
    "world-data",
  );
  await fsp.writeFile(
    path.join(sourceDirectory, "mods", "example.jar"),
    "mod-data",
  );
  const archivePath = path.join(temporaryRoot, "test-backup.onyxpack");
  const backup = await createInstanceBackup({
    instance: {
      id: "test-instance",
      name: "Test World",
      version: "1.21.1",
      loader: "Fabric",
      description: "Test fixture",
      color: "cyan",
      glyph: "TW",
      installProfile: {
        minecraftVersion: "1.21.1",
        loader: "fabric",
      },
    },
    instancesRoot: sourceRoot,
    destination: archivePath,
  });
  assert.ok(backup.bytes > 0);
  assert.equal(backup.files, 2);

  const imported = await importInstanceBackup({
    backupPath: archivePath,
    instancesRoot: restoreRoot,
    instanceId: "restored-instance",
  });
  assert.equal(imported.name, "Test World");
  assert.equal(imported.status, "setup");
  assert.equal(
    await fsp.readFile(
      path.join(
        restoreRoot,
        "restored-instance",
        "worlds",
        "My World",
        "level.dat",
      ),
      "utf8",
    ),
    "world-data",
  );
});

test(
  "The downloader verifies SHA-256 and reuses a valid file",
  { timeout: 15_000 },
  async () => {
    const payload = Buffer.from("onyx-download-integrity");
    const checksum = crypto.createHash("sha256").update(payload).digest("hex");
    const server = http.createServer((_request, response) => {
      response.setHeader("Content-Length", payload.length);
      response.end(payload);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const destination = path.join(temporaryRoot, "download", "asset.bin");
      const first = await downloadFile({
        url: `http://127.0.0.1:${address.port}/asset`,
        destination,
        sha256: checksum,
        size: payload.length,
      });
      assert.equal(first.cached, false);
      assert.equal(
        await fileMatches(destination, {
          sha256: checksum,
          size: payload.length,
        }),
        true,
      );
      const second = await downloadFile({
        url: `http://127.0.0.1:${address.port}/asset`,
        destination,
        sha256: checksum,
        size: payload.length,
      });
      assert.equal(second.cached, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "Cancelling a download stops the stream and deletes the temporary file",
  { timeout: 15_000 },
  async () => {
    const chunk = Buffer.alloc(64 * 1024, 7);
    const server = http.createServer((_request, response) => {
      response.setHeader("Content-Length", chunk.length * 64);
      let sent = 0;
      const timer = setInterval(() => {
        if (sent >= 64 || response.destroyed) {
          clearInterval(timer);
          response.end();
          return;
        }
        response.write(chunk);
        sent += 1;
      }, 10);
      response.on("close", () => clearInterval(timer));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const destination = path.join(temporaryRoot, "cancel", "large.bin");
      const controller = new AbortController();
      await assert.rejects(
        downloadFile({
          url: `http://127.0.0.1:${address.port}/large`,
          destination,
          signal: controller.signal,
          onProgress: ({ received }) => {
            if (received > 0) controller.abort();
          },
        }),
        (error) => error.name === "AbortError",
      );
      await assert.rejects(fsp.stat(destination));
      await assert.rejects(fsp.stat(`${destination}.part`));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "The downloader resumes a verified file from the saved offset",
  { timeout: 15_000 },
  async () => {
    const payload = Buffer.from(
      "onyx-resumable-download-payload-with-enough-bytes",
    );
    const checksum = crypto.createHash("sha256").update(payload).digest("hex");
    const partialSize = 17;
    let requestedRange = "";
    const server = http.createServer((request, response) => {
      requestedRange = request.headers.range || "";
      const offset = Number(
        /^bytes=(\d+)-$/.exec(requestedRange)?.[1] || 0,
      );
      response.statusCode = offset ? 206 : 200;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader(
        "Content-Range",
        `bytes ${offset}-${payload.length - 1}/${payload.length}`,
      );
      response.setHeader("Content-Length", payload.length - offset);
      response.end(payload.subarray(offset));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const destination = path.join(
        temporaryRoot,
        "resume",
        "asset.bin",
      );
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(
        `${destination}.part`,
        payload.subarray(0, partialSize),
      );
      const result = await downloadFile({
        url: `http://127.0.0.1:${address.port}/asset`,
        destination,
        sha256: checksum,
        size: payload.length,
      });
      assert.equal(requestedRange, `bytes=${partialSize}-`);
      assert.equal(result.resumed, true);
      assert.deepEqual(await fsp.readFile(destination), payload);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "Closing the launcher preserves a partially downloaded verified file",
  { timeout: 15_000 },
  async () => {
    const chunk = Buffer.alloc(32 * 1024, 4);
    const server = http.createServer((_request, response) => {
      response.setHeader("Content-Length", chunk.length * 32);
      const timer = setInterval(() => response.write(chunk), 8);
      response.on("close", () => clearInterval(timer));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const destination = path.join(
        temporaryRoot,
        "preserve",
        "large.bin",
      );
      const controller = new AbortController();
      let abortScheduled = false;
      await assert.rejects(
        downloadFile({
          url: `http://127.0.0.1:${address.port}/large`,
          destination,
          sha256: "0".repeat(64),
          signal: controller.signal,
          onProgress: ({ received }) => {
            if (received >= chunk.length * 2 && !abortScheduled) {
              abortScheduled = true;
              setTimeout(
                () => controller.abort({ preservePartial: true }),
                15,
              );
            }
          },
        }),
        (error) => error.name === "AbortError",
      );
      const partial = await fsp.stat(`${destination}.part`);
      assert.ok(partial.size > 0);
      await assert.rejects(fsp.stat(destination));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "Official Mojang and Fabric metadata is parsed",
  { timeout: 45_000 },
  async () => {
    const javaService = new JavaService(path.join(temporaryRoot, "runtimes"));
    const service = new MinecraftService({
      sharedRoot: path.join(temporaryRoot, "shared"),
      instancesRoot: path.join(temporaryRoot, "instances"),
      javaService,
    });
    const versions = await service.listVersions(false);
    assert.ok(versions.length > 10);
    assert.ok(versions.every((version) => version.type === "release"));
    const vanilla = await service.getVanillaVersion("1.21.1");
    assert.equal(vanilla.id, "1.21.1");
    assert.ok(vanilla.downloads.client.url.startsWith("https://"));
    const fabricId = await service.installFabric({
      minecraftVersion: "1.21.1",
      loader: "fabric",
      loaderVersion: null,
    });
    assert.match(fabricId, /fabric-loader/);
    const profilePath = path.join(
      temporaryRoot,
      "shared",
      "versions",
      fabricId,
      `${fabricId}.json`,
    );
    const profile = JSON.parse(await fsp.readFile(profilePath, "utf8"));
    assert.equal(profile.inheritsFrom, "1.21.1");
  },
);

test("An installed Java runtime is detected and reports its major version", async (context) => {
  const java = await findSystemJava();
  if (!java) {
    context.skip("Java is not available in the test system PATH");
    return;
  }
  assert.ok(java.major >= 17);
  assert.ok(await inspectJava(java.executable));
});

test("Launch revalidates the saved Java path", async () => {
  const calls = [];
  const service = new MinecraftService({
    sharedRoot: path.join(temporaryRoot, "java-selection-shared"),
    instancesRoot: path.join(temporaryRoot, "java-selection-instances"),
    javaService: {
      async resolve(requiredMajor, preferredPath) {
        calls.push({ requiredMajor, preferredPath });
        return "/opt/onyx/java-21/bin/java";
      },
    },
  });
  const resolved = await service.resolveJavaForLaunch(
    21,
    { javaPath: "" },
    { javaPath: "/old/windows/runtime/bin/java.exe" },
  );
  assert.equal(resolved, "/opt/onyx/java-21/bin/java");
  assert.deepEqual(calls, [
    {
      requiredMajor: 21,
      preferredPath: "/old/windows/runtime/bin/java.exe",
    },
  ]);
});

test("Relaunching Vanilla preserves resolvedVersionId and does not require reinstallation", async () => {
  const service = new MinecraftService({
    sharedRoot: path.join(temporaryRoot, "vanilla-reuse-shared"),
    instancesRoot: path.join(temporaryRoot, "vanilla-reuse-instances"),
    javaService: {
      async resolve() {
        return "/opt/onyx/java-21/bin/java";
      },
    },
  });
  service.installVanilla = async () => ({
    javaVersion: { majorVersion: 21 },
  });
  service.installLoader = async () => "1.21.1";
  const installed = await service.installInstance(
    {
      id: "plain-1-21-1",
      version: "1.21.1",
      loader: "Vanilla",
    },
    { javaPath: "" },
  );
  assert.equal(installed.resolvedVersionId, "1.21.1");
  assert.equal(installed.versionId, undefined);

  const legacy = { versionId: "1.21.1", status: "setup" };
  normalizeResolvedVersionId(legacy);
  assert.equal(legacy.resolvedVersionId, "1.21.1");
  assert.equal(legacy.versionId, undefined);
  assert.equal(legacy.status, "ready");
});

test("buildLaunch resolves requiredJava without TDZ and respects extraJvmArguments", async () => {
  const service = new MinecraftService({
    sharedRoot: path.join(temporaryRoot, "launch-shared"),
    instancesRoot: path.join(temporaryRoot, "launch-instances"),
    javaService: {
      async resolve() {
        return process.execPath;
      },
    },
  });
  service.loadResolvedVersion = async (id) => ({
    id,
    mainClass: "net.minecraft.client.main.Main",
    arguments: { game: [] },
    libraries: [],
    javaVersion: { majorVersion: 8 },
  });
  service.resolveJavaForLaunch = async () => process.execPath;

  const launch = await service.buildLaunch({
    instance: { id: "inst-8", version: "1.12.2" },
    settings: { javaMajor: 8 },
    account: { name: "Player", uuid: "000", token: "tok" },
    launchWrapper: { executable: process.execPath, argsBeforeExecutable: ["-e", "process.exit(0)"] },
    extraJvmArguments: ["-javaagent:test.jar", "--add-opens=java.base/java.lang=ALL-UNNAMED"],
  });

  assert.ok(launch.args.includes("-javaagent:test.jar"));
  assert.ok(!launch.args.includes("--add-opens=java.base/java.lang=ALL-UNNAMED"));
  launch.child.kill();
});

test("Preflight blocks only unsafe conditions and flags repairs", () => {
  assert.equal(
    reportStatus(
      [{ code: "disk-critical", status: "error" }],
      { requiresInstall: false, repairNeeded: false },
    ),
    "blocked",
  );
  assert.equal(
    reportStatus(
      [{ code: "client-jar-missing", status: "error" }],
      { requiresInstall: false, repairNeeded: true },
    ),
    "repair",
  );
  assert.equal(
    reportStatus(
      [{ code: "java-stale", status: "warning" }],
      { requiresInstall: false, repairNeeded: false },
    ),
    "warning",
  );
});

test("Preflight recognizes a stale Java path without blocking launch", async () => {
  const root = path.join(temporaryRoot, "preflight");
  const instanceRoot = path.join(root, "instances");
  await fsp.mkdir(instanceRoot, { recursive: true });
  const report = await checkInstanceHealth({
    instance: {
      id: "fresh-instance",
      version: "1.21.1",
      status: "setup",
      javaPath: "/old/windows/java.exe",
    },
    settings: { memory: 4, javaPath: "" },
    sharedRoot: path.join(root, "shared"),
    instancesRoot: instanceRoot,
    inspectJavaFn: async () => null,
    totalMemory: 16 * 1024 ** 3,
  });
  assert.equal(report.status, "setup");
  assert.equal(report.canLaunch, true);
  assert.equal(
    report.checks.find((check) => check.code === "java-stale")?.action,
    "auto",
  );
});

test("Onyx Picks contains unique installable Modrinth slugs", () => {
  assert.equal(PICK_DEFINITIONS.length, 5);
  assert.equal(
    new Set(PICK_DEFINITIONS.map((pick) => pick.slug)).size,
    PICK_DEFINITIONS.length,
  );
  assert.ok(
    PICK_DEFINITIONS.every(
      (pick) =>
        /^[a-z0-9-]+$/.test(pick.slug) &&
        pick.minimumMemoryGiB <= pick.recommendedMemoryGiB,
    ),
  );
});

test("Quick Join parses domains, ports, and IPv6 unambiguously", () => {
  assert.deepEqual(parseServerAddress("play.example.org:25566"), {
    host: "play.example.org",
    port: 25566,
    address: "play.example.org:25566",
  });
  assert.deepEqual(parseServerAddress("[2001:db8::1]:25570"), {
    host: "2001:db8::1",
    port: 25570,
    address: "[2001:db8::1]:25570",
  });
  assert.deepEqual(parseServerAddress("localhost"), {
    host: "localhost",
    port: 25565,
    address: "localhost",
  });
  assert.equal(parseServerAddress("   "), null);
  assert.throws(() => parseServerAddress("https://example.org"));
  assert.throws(() => parseServerAddress("example.org:70000"));
  assert.throws(() => parseServerAddress("bad host"));
});

test("The Minecraft status protocol parses a fragmented JSON response", () => {
  const payload = {
    version: { name: "1.21.1", protocol: 767 },
    players: { online: 12, max: 50 },
    description: {
      text: "Onyx ",
      extra: [{ text: "Server", color: "green" }],
    },
  };
  const json = encodeString(JSON.stringify(payload));
  const body = Buffer.concat([encodeVarInt(0), json]);
  const response = Buffer.concat([encodeVarInt(body.length), body]);

  assert.equal(parseStatusResponse(response.subarray(0, 2)), null);
  assert.deepEqual(parseStatusResponse(response), payload);
  assert.deepEqual(decodeVarInt(encodeVarInt(767)), {
    value: 767,
    size: 2,
  });
  assert.equal(motdToText(payload.description), "Onyx Server");
});

test("The server check handles Minecraft DNS SRV and explicit ports", async () => {
  const address = parseServerAddress("play.example.org");
  const srv = await resolveMinecraftEndpoint(address, "play.example.org", {
    resolveSrvFn: async (name) => {
      assert.equal(name, "_minecraft._tcp.play.example.org");
      return [
        {
          name: "node.example.org.",
          port: 25570,
          priority: 0,
          weight: 10,
        },
      ];
    },
  });
  assert.deepEqual(srv, {
    host: "node.example.org",
    port: 25570,
    viaSrv: true,
  });

  const explicit = await resolveMinecraftEndpoint(
    parseServerAddress("play.example.org:25566"),
    "play.example.org:25566",
    {
      resolveSrvFn: async () => {
        throw new Error("SRV should not be queried");
      },
    },
  );
  assert.deepEqual(explicit, {
    host: "play.example.org",
    port: 25566,
    viaSrv: false,
  });
});

test("Guard finds duplicate internal IDs across mod JARs", async () => {
  const instanceDirectory = path.join(temporaryRoot, "duplicate-mods");
  const modsDirectory = path.join(instanceDirectory, "mods");
  await writeTestJar(path.join(modsDirectory, "first.jar"), {
    "fabric.mod.json": JSON.stringify({
      schemaVersion: 1,
      id: "example_mod",
      name: "Example One",
      version: "1.0.0",
    }),
  });
  await writeTestJar(path.join(modsDirectory, "second.jar"), {
    "fabric.mod.json": JSON.stringify({
      schemaVersion: 1,
      id: "example_mod",
      name: "Example Two",
      version: "2.0.0",
    }),
  });
  await writeTestJar(path.join(modsDirectory, "forge.jar"), {
    "META-INF/mods.toml": `
      [[mods]]
      modId="unique_forge_mod"
      version="1.0.0"
    `,
  });

  const scan = await scanInstanceMods(instanceDirectory);
  assert.equal(scan.scannedCount, 3);
  assert.equal(scan.recognizedCount, 3);
  assert.deepEqual(scan.duplicates, [
    {
      id: "example_mod",
      files: ["first.jar", "second.jar"],
    },
  ]);
  assert.deepEqual(
    parseTomlModIds('modId="one"\nmodId = "two"\nmodId="one"'),
    ["one", "two"],
  );

  const cachedScan = await scanInstanceMods(instanceDirectory);
  assert.deepEqual(cachedScan.duplicates, scan.duplicates);
});

test("Crash Bisect narrows candidates and restores temporary changes", async () => {
  const instancesRoot = path.join(temporaryRoot, "bisect-instances");
  const instanceId = "bisect-instance";
  const modsRoot = path.join(instancesRoot, instanceId, "mods");
  await fsp.mkdir(modsRoot, { recursive: true });
  for (const name of ["alpha.jar", "beta.jar", "gamma.jar", "omega.jar"]) {
    await fsp.writeFile(path.join(modsRoot, name), name);
  }

  const first = await startBisect({ instancesRoot, instanceId });
  assert.equal(first.status, "testing");
  assert.deepEqual(first.testing, ["alpha.jar", "beta.jar"]);
  assert.ok(await fsp.stat(path.join(modsRoot, "alpha.jar.disabled")));

  const second = await reportBisectResult({
    instancesRoot,
    instanceId,
    gameStarted: false,
  });
  assert.deepEqual(second.candidates, ["gamma.jar", "omega.jar"]);
  assert.deepEqual(second.testing, ["gamma.jar"]);
  assert.ok(await fsp.stat(path.join(modsRoot, "alpha.jar")));

  const found = await reportBisectResult({
    instancesRoot,
    instanceId,
    gameStarted: true,
  });
  assert.equal(found.status, "found");
  assert.equal(found.culprit, "gamma.jar");
  assert.ok(await fsp.stat(path.join(modsRoot, "gamma.jar")));

  const result = await finishBisect({
    instancesRoot,
    instanceId,
    disableCulprit: true,
  });
  assert.deepEqual(result, { culprit: "gamma.jar", disabled: true });
  assert.ok(await fsp.stat(path.join(modsRoot, "gamma.jar.disabled")));
  assert.equal(
    await readBisectSession({ instancesRoot, instanceId }),
    null,
  );
});

test("World Guard snapshots and restores saves with a safety snapshot", async () => {
  const instancesRoot = path.join(temporaryRoot, "world-guard-instances");
  const worldGuardRoot = path.join(temporaryRoot, "world-guard-storage");
  const instanceId = "world-instance";
  const worldRoot = path.join(
    instancesRoot,
    instanceId,
    "saves",
    "Test World",
  );
  const levelPath = path.join(worldRoot, "level.dat");
  await fsp.mkdir(worldRoot, { recursive: true });
  await fsp.writeFile(levelPath, "before");

  const snapshot = await createWorldSnapshot({
    instancesRoot,
    worldGuardRoot,
    instanceId,
    reason: "manual",
  });
  assert.deepEqual(snapshot.worlds, ["Test World"]);
  assert.equal((await listWorldSnapshots({ worldGuardRoot, instanceId })).length, 1);

  await fsp.writeFile(levelPath, "after");
  const restored = await restoreWorldSnapshot({
    instancesRoot,
    worldGuardRoot,
    instanceId,
    snapshotId: snapshot.id,
  });
  assert.equal(restored.restored, true);
  assert.equal(await fsp.readFile(levelPath, "utf8"), "before");
  const snapshots = await listWorldSnapshots({ worldGuardRoot, instanceId });
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].reason, "pre-restore");
});

test("Update Preview classifies added, changed, and removed pack files", () => {
  const previous = {
    files: [
      { path: "mods/keep.jar", fileSize: 10, hashes: { sha1: "same" } },
      { path: "mods/change.jar", fileSize: 20, hashes: { sha1: "old" } },
      { path: "mods/remove.jar", fileSize: 30, hashes: { sha1: "gone" } },
    ],
  };
  const next = {
    files: [
      { path: "mods/keep.jar", fileSize: 10, hashes: { sha1: "same" } },
      { path: "mods/change.jar", fileSize: 24, hashes: { sha1: "new" } },
      { path: "mods/add.jar", fileSize: 40, hashes: { sha1: "added" } },
      {
        path: "server-only.jar",
        fileSize: 99,
        hashes: { sha1: "server" },
        env: { client: "unsupported" },
      },
    ],
  };
  const preview = comparePackIndexes(previous, next);
  assert.deepEqual(preview.added.map((file) => file.path), ["mods/add.jar"]);
  assert.deepEqual(preview.changed.map((file) => file.path), [
    "mods/change.jar",
  ]);
  assert.deepEqual(preview.removed.map((file) => file.path), [
    "mods/remove.jar",
  ]);
  assert.equal(preview.unchanged, 1);
  assert.equal(preview.downloadBytes, 64);
});

test("Onyx Sync keeps reproducible settings but excludes local secrets", () => {
  const profile = createSyncProfile({
    instance: {
      name: "Co-op",
      version: "1.21.1",
      loader: "Fabric 0.16.10",
      description: "Friends",
      color: "cyan",
      glyph: "CO",
      installProfile: {
        minecraftVersion: "1.21.1",
        loader: "fabric",
        loaderVersion: "0.16.10",
      },
      settings: {
        memory: 8,
        recordFps: true,
        javaPath: "C:\\private\\java.exe",
        servers: [{ id: "main", name: "Main", address: "play.example.org" }],
        selectedServerId: "main",
      },
    },
    mods: [
      {
        name: "sodium.jar",
        enabled: true,
        sha1: "a".repeat(40),
        projectId: "sodium",
        versionId: "exact-version",
      },
    ],
  });
  assert.equal(profile.instance.settings.javaPath, undefined);
  assert.equal(profile.instance.settings.recordFps, true);
  assert.equal(profile.instance.settings.servers[0].address, "play.example.org");
  assert.equal(profile.mods[0].versionId, "exact-version");

  const validated = validateSyncProfile(profile);
  assert.equal(validated.instance.installProfile.loader, "fabric");
  assert.equal(validated.instance.settings.recordFps, true);
  assert.equal(validated.mods.length, 1);
  assert.throws(() => validateSyncProfile({ schema: 99 }));
});

test("Flight Recorder summarizes process samples and JVM log signals", async () => {
  let now = 1_000;
  const samples = [
    { rssBytes: 2 * 1024 ** 3, cpuTimeMs: 0 },
    { rssBytes: 5.5 * 1024 ** 3, cpuTimeMs: 2_500 },
    { rssBytes: 4 * 1024 ** 3, cpuTimeMs: 3_000 },
  ];
  let cursor = 0;
  const recorder = new FlightRecorder({
    startedAt: 1_000,
    allocatedMemoryGiB: 6,
    now: () => now,
    sampleProvider: async () =>
      samples[Math.min(cursor++, samples.length - 1)],
  });
  recorder.pid = 42;
  await recorder.sample();
  now = 6_000;
  await recorder.sample();
  now = 12_000;
  recorder.ingestLog(
    "Backend library: LWJGL version\nGC(3) Pause Young 800.0ms",
  );
  const summary = await recorder.stop({ exitCode: 0, endedAt: now });

  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.peakRssBytes, 5.5 * 1024 ** 3);
  assert.equal(summary.startupMs, 11_000);
  assert.equal(summary.gcEvents, 1);
  assert.equal(summary.maxGcPauseMs, 800);
  assert.ok(
    summary.insights.some((insight) => insight.code === "memory-pressure"),
  );
  assert.ok(
    summary.insights.some((insight) => insight.code === "long-gc-pause"),
  );
});

test("Flight Recorder utility functions keep timelines bounded", () => {
  assert.equal(parseCpuTime("1-02:03:04"), 93_784_000);
  const timeline = Array.from({ length: 200 }, (_, index) => ({
    atSeconds: index,
    rssBytes: index,
    cpuPercent: index / 2,
  }));
  const compact = downsampleTimeline(timeline, 60);
  assert.equal(compact.length, 60);
  assert.deepEqual(compact[0], timeline[0]);
  assert.deepEqual(compact.at(-1), timeline.at(-1));
  const insights = buildInsights(
    {
      peakRssBytes: 2 * 1024 ** 3,
      recommendedMemoryGiB: 3,
      startupMs: 20_000,
      maxGcPauseMs: 0,
      outOfMemory: false,
      durationMs: 120_000,
      sampleCount: 20,
    },
    8,
    0,
  );
  assert.equal(insights[0].code, "memory-overallocated");
});

test("Flight Recorder flags meaningful regressions and ignores normal variance", () => {
  const baseline = {
    available: true,
    peakRssBytes: 2 * 1024 ** 3,
    startupMs: 20_000,
    fps: { available: true, averageFps: 100 },
  };
  const regressions = buildRegressionInsights(
    {
      available: true,
      peakRssBytes: 2.6 * 1024 ** 3,
      startupMs: 27_000,
      fps: { available: true, averageFps: 78 },
    },
    baseline,
  );
  assert.deepEqual(
    regressions.map((insight) => insight.code),
    ["fps-regression", "startup-regression", "memory-regression"],
  );
  assert.deepEqual(
    buildRegressionInsights(
      {
        available: true,
        peakRssBytes: 2.1 * 1024 ** 3,
        startupMs: 22_000,
        fps: { available: true, averageFps: 94 },
      },
      baseline,
    ),
    [],
  );
});

test("FPS Recorder parses MangoHud FPS and frametime samples", () => {
  const summary = parseFpsCsv(
    [
      "fps,frametime,cpu_load,gpu_load",
      "60,16.7,30,40",
      "58,17.2,31,41",
      "30,33.3,35,45",
      "62,16.1,28,39",
    ].join("\n"),
    { provider: "mangohud", sampleIntervalMs: 500 },
  );
  assert.equal(summary.provider, "mangohud");
  assert.equal(summary.sampleCount, 4);
  assert.equal(Math.round(summary.averageFps), 53);
  assert.equal(summary.onePercentLowFps, 30);
  assert.equal(summary.timeline[1].atSeconds, 0.5);
});

test("FPS Recorder derives FPS from frame intervals and presentation times", () => {
  const summary = parseFpsCsv(
    [
      "TimeInSeconds,MsBetweenPresents,FPS",
      "0.000,16.67,60.0",
      "0.017,20.00,50.0",
      "0.037,10.00,100.0",
    ].join("\n"),
    { provider: "onyx-agent" },
  );
  assert.equal(summary.provider, "onyx-agent");
  assert.equal(summary.sampleCount, 3);
  assert.equal(Math.round(summary.averageFps), 70);
  assert.ok(summary.timeline[2].atSeconds > 0.03);
});

test("FPS Recorder reports low and unstable sessions without false stable state", () => {
  const insights = buildFpsInsights({
    available: true,
    averageFps: 40,
    onePercentLowFps: 15,
    stutterCount: 4,
    sampleCount: 100,
  });
  assert.deepEqual(
    insights.map((insight) => insight.code),
    ["low-fps", "fps-instability", "frame-stutters"],
  );
});

test("FPS provider detection selects Scope Probe on Windows", async () => {
  const status = await detectFpsRecorder({
    platform: "win32",
    env: {},
  });
  assert.equal(status.available, true);
  assert.equal(status.provider, "onyx-agent");
  assert.equal(status.name, "Scope Probe");
});

test("FPS provider detection falls back to Scope Probe when native hook is missing", async () => {
  const status = await detectFpsRecorder({
    platform: "darwin",
    env: {},
  });
  assert.equal(status.available, true);
  assert.equal(status.provider, "onyx-agent");
  assert.equal(status.name, "Scope Probe");
});

test("Mod profiles save and apply mod states without touching new mods", async () => {
  const instancesRoot = path.join(temporaryRoot, "profile-instances");
  const instanceId = "profile-demo";
  const modsDirectory = path.join(instancesRoot, instanceId, "mods");
  await fsp.mkdir(modsDirectory, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(modsDirectory, "alpha.jar"), "alpha"),
    fsp.writeFile(path.join(modsDirectory, "beta.jar.disabled"), "beta"),
    fsp.writeFile(path.join(modsDirectory, "gamma.jar"), "gamma"),
  ]);

  const profile = await saveModProfile({
    instancesRoot,
    instanceId,
    name: "  FPS   preset  ",
    now: () => new Date("2026-07-29T10:00:00.000Z"),
    idFactory: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(profile.name, "FPS preset");
  assert.equal(profile.modCount, 3);
  assert.equal(profile.enabledCount, 2);
  const initialProfiles = await listModProfiles({
    instancesRoot,
    instanceId,
  });
  assert.equal(initialProfiles[0].matchesCurrent, true);
  assert.equal(initialProfiles[0].changeCount, 0);

  await fsp.rename(
    path.join(modsDirectory, "alpha.jar"),
    path.join(modsDirectory, "alpha.jar.disabled"),
  );
  await fsp.rename(
    path.join(modsDirectory, "beta.jar.disabled"),
    path.join(modsDirectory, "beta.jar"),
  );
  await fsp.rm(path.join(modsDirectory, "gamma.jar"));
  await fsp.writeFile(path.join(modsDirectory, "new-mod.jar.disabled"), "new");

  const result = await applyModProfile({
    instancesRoot,
    instanceId,
    profileId: profile.id,
  });
  assert.deepEqual(result.changed, ["alpha.jar", "beta.jar"]);
  assert.deepEqual(result.missing, ["gamma.jar"]);
  assert.equal(await fsp.readFile(path.join(modsDirectory, "alpha.jar"), "utf8"), "alpha");
  assert.equal(
    await fsp.readFile(path.join(modsDirectory, "beta.jar.disabled"), "utf8"),
    "beta",
  );
  assert.equal(
    await fsp.readFile(path.join(modsDirectory, "new-mod.jar.disabled"), "utf8"),
    "new",
  );

  const appliedProfiles = await listModProfiles({
    instancesRoot,
    instanceId,
  });
  assert.equal(appliedProfiles.length, 1);
  assert.equal(appliedProfiles[0].matchesCurrent, false);
  assert.equal(appliedProfiles[0].missingCount, 1);
  assert.equal(
    await deleteModProfile({
      instancesRoot,
      instanceId,
      profileId: profile.id,
    }),
    true,
  );
  assert.deepEqual(
    await listModProfiles({ instancesRoot, instanceId }),
    [],
  );
});

test("Mod profile application rolls back partial file changes", async () => {
  const instancesRoot = path.join(temporaryRoot, "profile-rollback-instances");
  const instanceId = "rollback-demo";
  const modsDirectory = path.join(instancesRoot, instanceId, "mods");
  await fsp.mkdir(modsDirectory, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(modsDirectory, "one.jar"), "one"),
    fsp.writeFile(path.join(modsDirectory, "two.jar"), "two"),
  ]);
  const profile = await saveModProfile({
    instancesRoot,
    instanceId,
    name: "Both",
  });
  await Promise.all([
    fsp.rename(
      path.join(modsDirectory, "one.jar"),
      path.join(modsDirectory, "one.jar.disabled"),
    ),
    fsp.rename(
      path.join(modsDirectory, "two.jar"),
      path.join(modsDirectory, "two.jar.disabled"),
    ),
  ]);

  let renameCalls = 0;
  await assert.rejects(
    applyModProfile({
      instancesRoot,
      instanceId,
      profileId: profile.id,
      renameFile: async (source, destination) => {
        renameCalls += 1;
        if (renameCalls === 2) throw new Error("simulated rename failure");
        await fsp.rename(source, destination);
      },
    }),
    /changes were rolled back/,
  );
  assert.equal(
    await fsp.readFile(path.join(modsDirectory, "one.jar.disabled"), "utf8"),
    "one",
  );
  assert.equal(
    await fsp.readFile(path.join(modsDirectory, "two.jar.disabled"), "utf8"),
    "two",
  );
});

test("Support bundle redacts secrets, personal paths, email, and IP", async () => {
  const sanitized = sanitizeSupportText(
    [
      "--username Steve --uuid abc --accessToken super-secret",
      "Bearer header.payload.signature",
      "C:\\Users\\Alice\\AppData\\Roaming\\.minecraft",
      "/home/alice/.minecraft",
      "mail alice@example.org server 192.168.1.44",
      '{"refresh_token":"also-secret"}',
    ].join("\n"),
  );
  assert.doesNotMatch(sanitized, /super-secret|also-secret|Alice|alice@example|192\.168/);
  assert.match(sanitized, /<redacted>/);
  assert.match(sanitized, /C:\\Users\\<user>/);
  assert.match(sanitized, /\/home\/<user>/);
  assert.match(sanitized, /<email>/);
  assert.match(sanitized, /<ip>/);
});

test("Support bundle contains only share-safe instance metadata and log tail", async () => {
  const destination = path.join(temporaryRoot, "onyx-support-test.zip");
  const result = await createSupportBundle({
    destination,
    instance: {
      id: "support-demo",
      name: "QA Pack",
      version: "1.21.1",
      loader: "Fabric",
      status: "error",
      modCount: 12,
      lastExitCode: 1,
      settings: {
        memory: 6,
        javaPath: "C:\\Users\\Alice\\java.exe",
        servers: [{ name: "Private", address: "private.example.org" }],
        jvmArguments: ["-Dwork=/home/alice/game"],
      },
    },
    sessions: [
      {
        id: "session-1",
        startedAt: "2026-07-29T10:00:00.000Z",
        endedAt: "2026-07-29T10:01:00.000Z",
        durationMinutes: 1,
        exitCode: 1,
      },
    ],
    diagnostics: {
      generatedAt: "2026-07-29T10:02:00.000Z",
      launcher: { version: "1.6.0" },
      system: { platform: "linux" },
      storage: { gameDirectory: "/home/alice/.local/share/onyx" },
      profile: { kind: "microsoft", name: "Alice" },
      counts: { instances: 1 },
      endpoints: [],
    },
    logContent:
      "User alice@example.org from 10.0.0.4\n--accessToken secret-value",
    analysis: [],
    now: () => new Date("2026-07-29T10:03:00.000Z"),
  });
  assert.equal(result.files, 3);
  assert.ok(result.bytes > 0);

  const manifest = await readZipJson(destination, "onyx-support.json");
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.privacy.accountTokensIncluded, false);
  assert.equal(manifest.instance.settings.memory, 6);
  assert.equal(manifest.instance.settings.servers, undefined);
  assert.deepEqual(manifest.diagnostics.profile, { kind: "microsoft" });
  assert.match(manifest.diagnostics.storage.gameDirectory, /\/home\/<user>/);

  const extracted = path.join(temporaryRoot, "support-extracted");
  await extractZip(destination, extracted);
  const log = await fsp.readFile(
    path.join(extracted, "latest-launch.log.txt"),
    "utf8",
  );
  assert.doesNotMatch(log, /alice@example|10\.0\.0\.4|secret-value/);
});

test("Instance storage analyzer classifies data and cleans only safe stale files", async () => {
  const instancesRoot = path.join(temporaryRoot, "storage-instances");
  const instanceId = "storage-demo";
  const instanceRoot = path.join(instancesRoot, instanceId);
  const now = new Date("2026-07-29T12:00:00.000Z");
  const oldBase = now.getTime() - 10 * 24 * 60 * 60 * 1000;
  const writeFixture = async (relative, content, mtimeMs = now.getTime()) => {
    const destination = path.join(instanceRoot, relative);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, content);
    const modified = new Date(mtimeMs);
    await fsp.utimes(destination, modified, modified);
    return destination;
  };

  const worldFile = await writeFixture("saves/Test World/level.dat", "world-data");
  const modFile = await writeFixture("mods/sodium.jar", "mod-data");
  await writeFixture("config/sodium-options.json", "config-data");
  await writeFixture("resourcepacks/faithful.zip", "resource-data");
  await writeFixture("screenshots/shot.png", "image-data");
  await writeFixture(
    "mods/interrupted.jar.part",
    "partial-data",
    now.getTime() - 2 * 60 * 60 * 1000,
  );

  for (let index = 0; index < 5; index += 1) {
    await writeFixture(
      `logs/old-${index}.log`,
      `old-log-${index}`,
      oldBase + index * 60_000,
    );
  }
  const recentLog = await writeFixture(
    "logs/latest.log",
    "latest-log",
    now.getTime() - 60_000,
  );
  for (let index = 0; index < 4; index += 1) {
    await writeFixture(
      `crash-reports/crash-${index}.txt`,
      `crash-${index}`,
      oldBase + index * 60_000,
    );
  }
  for (let index = 0; index < 3; index += 1) {
    await writeFixture(
      `hs_err_pid${index}.log`,
      `native-${index}`,
      oldBase + index * 60_000,
    );
  }

  const report = await analyzeInstanceStorage({
    instancesRoot,
    instanceId,
    now: () => now,
  });
  assert.ok(report.totalBytes > 0);
  assert.equal(
    report.categories.find((category) => category.id === "worlds").files,
    1,
  );
  assert.equal(
    report.categories.find((category) => category.id === "mods").files,
    2,
  );
  assert.deepEqual(report.cleanable.groups, {
    logs: { bytes: 27, files: 3 },
    crashReports: { bytes: 15, files: 2 },
    partial: { bytes: 12, files: 1 },
  });
  assert.equal(report.cleanable.files, 6);

  const cleaned = await cleanupInstanceStorage({
    instancesRoot,
    instanceId,
    now: () => now,
  });
  assert.equal(cleaned.removedFiles, 6);
  assert.equal(cleaned.failed, 0);
  assert.equal(cleaned.report.cleanable.files, 0);
  assert.equal(await fsp.readFile(worldFile, "utf8"), "world-data");
  assert.equal(await fsp.readFile(modFile, "utf8"), "mod-data");
  assert.equal(await fsp.readFile(recentLog, "utf8"), "latest-log");
  assert.equal((await fsp.readdir(path.join(instanceRoot, "logs"))).length, 3);
  assert.equal(
    (await fsp.readdir(path.join(instanceRoot, "crash-reports"))).length,
    3,
  );
});

test("Speed is averaged over recent samples", () => {
  const result = calculateSpeed([], 1000, 0, 1);
  assert.equal(result.speed, 1000);
  assert.deepEqual(result.samples, [1000]);

  const result2 = calculateSpeed([500, 500, 500, 500], 1000, 0, 1);
  assert.equal(result2.speed, 600);
  assert.equal(result2.samples.length, 5);
});

test("Old samples are dropped after 5", () => {
  const result = calculateSpeed([1, 2, 3, 4, 5], 1000, 0, 1);
  assert.equal(result.samples.length, 5);
  assert.equal(result.samples[0], 2);
});

test("ETA is calculated from remaining bytes and speed", () => {
  assert.equal(calculateEta(1000, 500, 100), 5);
  assert.equal(calculateEta(1000, 0, 250), 4);
});

test("ETA returns null when data unavailable", () => {
  assert.equal(calculateEta(0, 0, 100), null);
  assert.equal(calculateEta(1000, 0, 0), null);
  assert.equal(calculateEta(null, 0, 100), null);
});

test("Speed returns null on zero elapsed time", () => {
  assert.equal(calculateSpeed([], 1000, 0, 0), null);
});

test("Speed and ETA handle stall and zero bytes gracefully", () => {
  const result = calculateSpeed([], 0, 0, 1);
  assert.equal(result.speed, 0);
  assert.equal(calculateEta(1000, 0, 0), null);
  assert.equal(calculateEta(1000, 0, -5), null);
});

test("Azul Zulu and Adoptium platform helpers map OS and architectures correctly", () => {
  assert.equal(azulOsName("darwin"), "macos");
  assert.equal(azulOsName("win32"), "windows");
  assert.equal(azulOsName("linux"), "linux");

  assert.equal(azulArchitecture("arm64", 21), "arm64");
  assert.equal(azulArchitecture("ia32", 21), "x86");
  assert.equal(azulArchitecture("x64", 21), "x64");
  if (process.platform === "darwin") {
    assert.equal(azulArchitecture("arm64", 8), "x64");
    assert.equal(adoptiumArchitecture("arm64", 8), "x64");
  }
});

test("checkInstanceHealth: Pre-Flight Doctor detects stray vanilla game JAR in mods directory", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-preflight-vanilla-"));
  const instId = "inst-preflight-vanilla";
  const instDir = path.join(tmpRoot, "instances", instId);
  const modsDir = path.join(instDir, "mods");
  await fsp.mkdir(modsDir, { recursive: true });
  await fsp.writeFile(path.join(modsDir, "1.21.1.jar"), "dummy-content");

  const instance = {
    id: instId,
    version: "1.21.1",
    loader: "neoforge",
  };

  const report = await checkInstanceHealth({
    instance,
    sharedRoot: path.join(tmpRoot, "shared"),
    instancesRoot: path.join(tmpRoot, "instances"),
    totalMemory: 16 * 1024 * 1024 * 1024,
  });

  const strayCheck = report.checks.find((c) => c.code === "stray-vanilla-jar-in-mods");
  assert.ok(strayCheck, "Expected stray-vanilla-jar-in-mods check to be present");
  assert.equal(strayCheck.status, "warning");
  assert.ok(strayCheck.autoFix);
  assert.equal(strayCheck.autoFix.type, "remove-vanilla-jar-from-mods");
  assert.equal(strayCheck.autoFix.payload.fileName, "1.21.1.jar");
  assert.equal(report.hasDoctorWarnings, true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});


