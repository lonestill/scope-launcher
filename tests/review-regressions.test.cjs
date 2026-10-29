const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");
const { ZipArchive } = require("archiver");
const { detectCrashAutoFix: detect, applyCrashAutoFix: apply, checkModCompatibility: compatible, inspectJarMetadata } = require("../electron/services/crash-autofix.cjs");
const { extractCrashReport, analyzeMinecraftLog } = require("../electron/services/log-analysis.cjs");
const { satisfiesMinecraftVersion: satisfies } = require("../electron/services/version-range.cjs");

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-regression-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}
async function zip(destination, entries) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const output = fs.createWriteStream(destination);
  const complete = new Promise((resolve, reject) => { output.on("close", resolve); output.on("error", reject); archive.on("error", reject); });
  archive.pipe(output);
  for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
  await archive.finalize();
  await complete;
}
function loadService(relative, overrides) {
  const filename = path.resolve(__dirname, "..", relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (id) => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id),
    module, exports: module.exports, process, console, Buffer, structuredClone,
  }, { filename });
  return module.exports;
}
const base = { id: "instance", loader: "Fabric", version: "1.20.1", settings: { memory: 4 } };

test("world repair preserves other worlds and retains every pre-repair version", async (t) => {
  const root = await fixture(t);
  for (const world of ["broken", "healthy"]) {
    const directory = path.join(root, base.id, "saves", world);
    await fsp.mkdir(directory, { recursive: true });
    await fsp.writeFile(path.join(directory, "level.dat"), `current-${world}`);
    await fsp.writeFile(path.join(directory, "level.dat_old"), `old-${world}`);
  }
  const fix = await detect({ instance: base, logContent: "Failed to read level.dat saves/broken/level.dat" });
  const instance = structuredClone(base);
  await apply({ instance, instancesRoot: root, fixAction: fix });
  const broken = path.join(root, base.id, "saves", "broken");
  assert.equal(await fsp.readFile(path.join(broken, "level.dat"), "utf8"), "old-broken");
  assert.equal(await fsp.readFile(path.join(root, base.id, "saves/healthy/level.dat"), "utf8"), "current-healthy");
  const preserved = (await fsp.readdir(broken)).find((name) => name.startsWith("level.dat.corrupt-"));
  assert.equal(await fsp.readFile(path.join(broken, preserved), "utf8"), "current-broken");
  await assert.rejects(apply({ instance, instancesRoot: root, fixAction: { type: fix.type, payload: { worldName: "../healthy" } } }), /exact world name/);
  assert.equal(await detect({ instance, logContent: "Corrupt level.dat" }), null);
});

test("ZIP repair targets the error context, quarantines damage, and refuses healthy JARs", async (t) => {
  const root = await fixture(t);
  const mods = path.join(root, base.id, "mods");
  await zip(path.join(mods, "healthy.jar"), { "fabric.mod.json": JSON.stringify({ id: "healthy", version: "1.0", depends: { minecraft: ">=1.19" } }) });
  await fsp.writeFile(path.join(mods, "broken.jar"), "broken archive");
  const logContent = "Loading healthy.jar\njava.util.zip.ZipException: zip END header not found\nreading /mods/broken.jar";
  const fix = await detect({ instance: base, instancesRoot: root, logContent });
  assert.equal(fix.payload.fileName, "broken.jar");
  await apply({ instance: structuredClone(base), instancesRoot: root, fixAction: fix });
  assert.equal((await inspectJarMetadata(path.join(mods, "healthy.jar"))).corrupted, false);
  assert.equal((await fsp.readdir(mods)).filter((name) => name.startsWith("broken.jar.quarantine-")).length, 1);
  await assert.rejects(apply({ instance: structuredClone(base), instancesRoot: root, fixAction: { type: fix.type, payload: { fileName: "healthy.jar" } } }), /not corrupted/);
  assert.equal(await detect({ instance: base, logContent: "Loading healthy.jar\nZipException: zip END header not found" }), null);
});

test("compatibility understands bounds, exact patches, alternatives and unknown constraints", () => {
  for (const [range, expected] of [[">=1.19", true], ["1.20.1", true], [">=1.19 <1.20", false], ["[1.19,1.21)", true], ["1.19 || 1.20.1", true], ["1.20.x", true], ["~1.20", null], [">=1.19 unsupported", null]]) assert.equal(satisfies("1.20.1", range), expected, range);
  assert.equal(satisfies("1.20.6", "1.20.1"), false);
  assert.equal(compatible({ loader: "forge" }, { ...base, loader: "Fabric 0.16.10" }).reason, "loader-mismatch");
  assert.equal(compatible({ loader: "fabric", mcVersionRange: ">=1.19" }, base).incompatible, false);
});

test("Forge Minecraft constraint comes from the minecraft dependency, not Forge's own range", async (t) => {
  const root = await fixture(t);
  const jar = path.join(root, "mod.jar");
  await zip(jar, { "META-INF/mods.toml": '[modLoader]\n[[mods]]\nmodId="test"\nversion="1.0"\n[[dependencies.test]]\nmodId="forge"\nversionRange="[47,)"\n[[dependencies.test]]\nmodId="minecraft"\nversionRange="[1.20.1,1.21)"\n' });
  const metadata = await inspectJarMetadata(jar);
  assert.equal(metadata.mcVersionRange, "[1.20.1,1.21)");
  assert.equal(compatible(metadata, { ...base, loader: "Forge 47.2.0" }).incompatible, false);
});

test("historical OOM and unrelated recent reports cannot override this launch", async (t) => {
  const root = await fixture(t);
  const log = "[2026-10-29T00:00:00Z] Scope is launching old\nOutOfMemoryError: Java heap space\n[2026-10-29T00:01:00Z] Scope is launching new\nZipException: zip END header not found broken.jar";
  assert.equal((await detect({ instance: base, logContent: log })).type, "clean-corrupted-file");
  assert.equal(analyzeMinecraftLog(log).some((item) => item.code === "out-of-memory"), false);
  const reports = path.join(root, "crash-reports");
  await fsp.mkdir(reports);
  await fsp.writeFile(path.join(reports, "crash-previous.txt"), "Description: old\njava.lang.OutOfMemoryError: old");
  assert.equal((await extractCrashReport({ instanceDirectory: root })).foundCrashReport, false);
  assert.equal((await extractCrashReport({ instanceDirectory: root, startedAt: Date.now() + 1000 })).foundCrashReport, false);
  assert.equal((await extractCrashReport({ instanceDirectory: root, startedAt: Date.now() - 1000 })).foundCrashReport, true);
});

test("unsupported fixes preserve diagnosis and never report success", async () => {
  for (const type of ["restore-world-snapshot", "reconcile-modpack-manifest", "kill-zombie-process", "install-openjfx", "force-switch-64bit-java", "switch-arm64-java"]) {
    const instance = { ...base, lastDiagnosis: { code: "original" } };
    await assert.rejects(apply({ instance, fixAction: { type, payload: {} } }));
    assert.equal(instance.lastDiagnosis.code, "original");
  }
});

test("loader upgrade rolls back metadata when installation fails and does not clear diagnosis", async () => {
  const instance = { ...structuredClone(base), resolvedVersionId: "fabric-loader-0.15.0-1.20.1", lastDiagnosis: { code: "old-loader" } };
  const before = structuredClone(instance);
  await assert.rejects(apply({ instance, fixAction: { type: "upgrade-loader-version", payload: { requiredVersion: "0.16.10" } }, repairInstanceFn: async () => { throw Error("offline"); } }), /offline/);
  assert.deepEqual(instance, before);
});

test("Java fix resolves the requested runtime and overrides stale global/custom paths", async () => {
  const instance = structuredClone(base);
  const result = await apply({ instance, fixAction: { type: "switch-java", payload: { requiredJavaMajor: 21 } }, resolveJavaFn: async (major) => { assert.equal(major, 21); return "/managed/java21"; } });
  assert.equal(result.success, true);
  assert.equal(instance.settings.javaPath, "/managed/java21");
  assert.equal(instance.javaPath, "/managed/java21");
});

test("player quarantine refuses to change matching UUIDs in multiple worlds", async (t) => {
  const root = await fixture(t);
  const uuid = "4f2277d3-18e4-4fa0-82d2-5a9e3e3b3333";
  for (const world of ["a", "b"]) {
    const directory = path.join(root, base.id, "saves", world, "playerdata");
    await fsp.mkdir(directory, { recursive: true });
    await fsp.writeFile(path.join(directory, `${uuid}.dat`), world);
  }
  await assert.rejects(apply({ instance: structuredClone(base), instancesRoot: root, fixAction: { type: "quarantine-playerdata", payload: { uuid } } }), /affected world/);
  for (const world of ["a", "b"]) assert.equal(await fsp.readFile(path.join(root, base.id, "saves", world, "playerdata", `${uuid}.dat`), "utf8"), world);
});

test("NeoForge automatic selection resolves the exact installed profile", async () => {
  const spawn = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    process.nextTick(() => child.emit("close", 0)); return child;
  };
  const { MinecraftService } = loadService("electron/services/minecraft.cjs", {
    "node:fs/promises": { access: async () => {}, readdir: async () => ["1.21.1", "neoforge-21.1.65", "neoforge-21.1.650"].map((name) => ({ name, isDirectory: () => true })) },
    "node:child_process": { spawn },
    "./network.cjs": { downloadFile: async () => {}, fetchWithRetry: async () => ({ text: async () => "<version>21.1.65</version>" }) },
  });
  const service = Object.create(MinecraftService.prototype); service.sharedRoot = "/mock";
  assert.equal(await service.installForgeLike({ loader: "neoforge", minecraftVersion: "1.21.1", loaderVersion: null }, "/java"), "neoforge-21.1.65");
});

test("CurseForge local import forwards identity and cancellation and preserves real errors", async () => {
  let args;
  const { ModpackService } = loadService("electron/services/modpack.cjs", {
    "./archive.cjs": { readZipJson: async (_p, entry) => { if (entry === "modrinth.index.json") throw Error("missing"); return { manifestType: "minecraftModpack" }; } },
    "./curseforge.cjs": { installCurseForgeModpack: async (options) => { args = options; throw Error("download failed"); } },
  });
  const signal = new AbortController().signal;
  await assert.rejects(new ModpackService({ instancesRoot: "/mock" }).installPack({ packPath: "pack.zip", instanceId: "task-instance", signal }), /download failed/);
  assert.equal(args.instanceId, "task-instance"); assert.equal(args.signal, signal);
});

test("same-name pack releases have separate caches and failed updates preserve the active instance", async (t) => {
  const root = await fixture(t);
  let revision = 1;
  const { ModpackService } = loadService("electron/services/modpack.cjs", {
    "./network.cjs": { fetchJson: async (url) => url.endsWith("/version") ? [{ id: `v${revision}`, version_type: "release", files: [{ filename: "pack.mrpack", url: "mock", hashes: {} }] }] : { title: "Pack" }, downloadFile: async () => {} },
  });
  const service = new ModpackService({ packsRoot: root, instancesRoot: root });
  const oldPath = (await service.downloadProjectPack({ project_id: "p" })).packPath;
  revision = 2;
  assert.notEqual((await service.downloadProjectPack({ project_id: "p" })).packPath, oldPath);
  const packPath = path.join(root, "next.mrpack");
  await zip(oldPath, { "modrinth.index.json": JSON.stringify({ dependencies: { minecraft: "1.20.1" }, files: [{ path: "mods/old.jar" }] }) });
  await zip(packPath, { "modrinth.index.json": JSON.stringify({ dependencies: { minecraft: "1.20.1" }, files: [{ path: "mods/new.jar" }] }) });
  const mods = path.join(root, base.id, "mods"); await fsp.mkdir(mods, { recursive: true }); await fsp.writeFile(path.join(mods, "old.jar"), "old");
  service.downloadProjectPack = async () => ({ packPath, release: { id: "v2" } });
  service.installPack = async ({ instanceId }) => { await fsp.writeFile(path.join(root, instanceId, "mods/new.jar"), "partial"); throw Error("network failure"); };
  await assert.rejects(service.updateProject({ instance: { ...base, sourceProjectId: "p", sourceVersionId: "v1", packPath: oldPath } }), /network failure/);
  assert.deepEqual(await fsp.readdir(mods), ["old.jar"]);
  assert.equal((await fsp.readdir(root)).some((name) => name.startsWith("_update-")), false);
});

test("failed state replacement preserves the old file and later saves recover", async (t) => {
  const root = await fixture(t);
  const statePath = path.join(root, "state.json");
  const { createStateWriter } = require("../electron/services/state-storage.cjs");
  const writeState = createStateWriter();
  await writeState(statePath, { value: "original" });
  const rename = fsp.rename;
  let fail = true;
  t.mock.method(fsp, "rename", async (...args) => {
    if (args[1] === statePath && fail) { fail = false; throw Object.assign(Error("disk unavailable"), { code: "EIO" }); }
    return rename(...args);
  });
  await assert.rejects(writeState(statePath, { value: "failed" }), /disk unavailable/);
  assert.equal(JSON.parse(await fsp.readFile(statePath, "utf8")).value, "original");
  await writeState(statePath, { value: "recovered" });
  assert.equal(JSON.parse(await fsp.readFile(statePath, "utf8")).value, "recovered");
  assert.deepEqual(await fsp.readdir(root), ["state.json"]);
});

test("update recovery restores old files until new metadata is committed", async (t) => {
  const root = await fixture(t);
  const { promoteInstanceUpdate, recoverInstanceUpdates } = require("../electron/services/instance-update.cjs");
  for (const committed of [false, true]) {
    const id = committed ? "committed" : "interrupted";
    const stagingId = `_update-${require("node:crypto").randomUUID()}`;
    for (const [directory, contents] of [[id, "old"], [stagingId, "new"]]) {
      await fsp.mkdir(path.join(root, directory));
      await fsp.writeFile(path.join(root, directory, "mod.jar"), contents);
    }
    const next = { id, sourceVersionId: "v2", resolvedVersionId: "fabric-new" };
    await promoteInstanceUpdate({ instancesRoot: root, instanceId: id, stagingId, nextInstance: next });
    // Simulate a process interruption: no finalize or rollback callback executes.
    await recoverInstanceUpdates({ instancesRoot: root, instances: [committed ? next : { id, sourceVersionId: "v1" }] });
    assert.equal(await fsp.readFile(path.join(root, id, "mod.jar"), "utf8"), committed ? "new" : "old");
  }
  assert.deepEqual((await fsp.readdir(root)).sort(), ["committed", "interrupted"]);
});

// Exercise the real registered Electron handlers without starting a desktop window.
function ipcHarness(overrides = {}) {
  const ts = require("typescript");
  const filename = path.resolve(__dirname, "../electron/main.cjs");
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const registration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "registerIpc");
  const handlers = new Map();
  const context = {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    state: { sessions: [], settings: { gameDirectory: "/instances" }, instances: [{ ...structuredClone(base), status: "ready", resolvedVersionId: "fabric-old" }] },
    crashFixLocks: new Set(), nativeRepairInProgress: false, launchLocks: new Set(), packUpdateLocks: new Set(), installLocks: new Map(), installControllers: new Map(), runningGames: new Map(),
    path, fs, fsp, crypto: require("node:crypto"), structuredClone, console, process, AbortController,
    saveState: async () => {}, send: () => {}, preflightBlockedMessage: () => "blocked",
    instanceUpdate: (instance, patch) => Object.assign(instance, patch),
    ...overrides,
  };
  context.findInstance ||= (id) => context.state.instances.find((instance) => instance.id === id);
  vm.runInNewContext(`${registration.getText(source)}\nregisterIpc();`, context, { filename });
  return { handlers, context };
}

test("duplicate launch requests are rejected while preflight is pending and release the lock on failure", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { handlers, context } = ipcHarness({ preflightInstance: () => gate });
  const launch = handlers.get("launcher:play");
  const first = launch(null, base.id);
  assert.equal((await launch(null, base.id)).reason, "instance-busy");
  release({ canLaunch: false });
  assert.equal((await first).reason, "preflight-blocked");
  assert.equal(context.launchLocks.size, 0);
  context.runningGames.set(base.id, new Map([["session", {}]]));
  assert.equal((await launch(null, base.id)).reason, "already-running");
});

test("failed copying never registers a partially copied instance", async (t) => {
  const root = await fixture(t);
  const { handlers, context } = ipcHarness({
    fsp: { ...fsp, cp: async (_source, destination) => {
      await fsp.mkdir(destination, { recursive: true });
      await fsp.writeFile(path.join(destination, "partial.jar"), "partial");
      throw Object.assign(Error("disk full"), { code: "ENOSPC" });
    } },
  });
  context.state.settings.gameDirectory = root;
  await assert.rejects(handlers.get("instance:duplicate")(null, base.id), /disk full/);
  assert.equal(context.state.instances.length, 1);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("pack update prevents concurrent launch and releases its operation lock after failure", async (t) => {
  const root = await fixture(t);
  let rejectBackup;
  const backup = new Promise((_resolve, reject) => { rejectBackup = reject; });
  const { handlers, context } = ipcHarness({ onyxRoot: () => root, createInstanceBackup: () => backup });
  context.state.instances[0].sourceProjectId = "pack";
  const updating = handlers.get("instance:update-pack")(null, base.id);
  const rejection = assert.rejects(updating, /backup failed/);
  assert.equal((await handlers.get("launcher:play")(null, base.id)).reason, "instance-busy");
  rejectBackup(Error("backup failed"));
  await rejection;
  assert.equal(context.packUpdateLocks.size, 0);
  assert.equal(context.installControllers.size, 0);
  assert.equal(context.state.instances[0].status, "ready");
});

test("process launch errors reject instead of reporting successful game startup", async (t) => {
  const root = await fixture(t);
  const { MinecraftService } = require("../electron/services/minecraft.cjs");
  const service = new MinecraftService({ sharedRoot: root, instancesRoot: root, javaService: { resolve: async () => path.join(root, "missing-java") } });
  service.loadResolvedVersion = async () => ({ id: "1.20.1", mainClass: "example.Main", libraries: [], arguments: { game: [] } });
  await fsp.mkdir(path.join(root, base.id), { recursive: true });
  let spawned = false;
  await assert.rejects(service.buildLaunch({ instance: base, settings: {}, onSpawn: () => { spawned = true; } }), /ENOENT/);
  assert.equal(spawned, false);
});

test("a partial Sync import cannot become playable just because Minecraft is installed", async () => {
  const { handlers, context } = ipcHarness();
  context.state.instances[0].syncImportIncomplete = true;
  assert.equal((await handlers.get("launcher:play")(null, base.id)).reason, "incomplete-import");
  assert.equal(context.launchLocks.size, 0);
});

test("exit diagnostics see the final flushed game output", { timeout: 5000 }, async (t) => {
  const root = await fixture(t);
  const { MinecraftService } = require("../electron/services/minecraft.cjs");
  const service = new MinecraftService({ sharedRoot: root, instancesRoot: root, javaService: { resolve: async () => process.execPath } });
  service.loadResolvedVersion = async () => ({ id: "1.20.1", mainClass: "example.Main", libraries: [], arguments: { game: [] } });
  await fsp.mkdir(path.join(root, base.id), { recursive: true });
  let exited;
  const completion = new Promise((resolve) => { exited = resolve; });
  await service.buildLaunch({ instance: base, settings: {}, launchWrapper: { executable: process.execPath, argsBeforeExecutable: ["-e", "process.stdout.write('final crash evidence\\n')"] }, onExit: exited });
  const { logPath, code } = await completion;
  assert.equal(code, 0);
  const log = await fsp.readFile(logPath, "utf8");
  assert.match(log, /final crash evidence/);
  assert.match(log, /Game exited with code 0/);
});

test("a mod mention in system details does not become a culprit", async (t) => {
  const root = await fixture(t);
  const reports = path.join(root, "crash-reports");
  await fsp.mkdir(reports);
  const crash = path.join(reports, "crash-current.txt");
  await fsp.writeFile(crash, "Description: crash\njava.lang.RuntimeException: failed\n-- System Details --\nMod 'healthy'\nJVM flags: -javaagent:onyx-fps-agent.jar\n");
  assert.equal((await extractCrashReport({ instanceDirectory: root, startedAt: Date.now() - 1000 })).suspectedCulprit, null);
});

test("native rebuild failure restores the previous shared files", async (t) => {
  const root = await fixture(t);
  const { MinecraftService } = require("../electron/services/minecraft.cjs");
  const service = new MinecraftService({ sharedRoot: root, instancesRoot: root });
  service.loadResolvedVersion = async () => ({ inheritsFrom: "1.20.1" });
  const directory = path.join(root, "natives/1.20.1");
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, "original.dylib"), "preserved");
  service.installVanilla = async () => { await fsp.mkdir(directory, { recursive: true }); await fsp.writeFile(path.join(directory, "partial.dylib"), "partial"); throw Error("offline"); };
  const instance = { ...structuredClone(base), lastDiagnosis: { code: "native-crash" } };
  await assert.rejects(apply({ instance, fixAction: { type: "purge-corrupted-natives" }, repairNativesFn: () => service.repairNatives(instance) }), /offline/);
  assert.equal(await fsp.readFile(path.join(directory, "original.dylib"), "utf8"), "preserved");
  assert.deepEqual(await fsp.readdir(directory), ["original.dylib"]);
  assert.equal(instance.lastDiagnosis.code, "native-crash");
});

test("no-op file repair preserves diagnosis and does not request persistence", async (t) => {
  const root = await fixture(t);
  const instance = { ...structuredClone(base), lastDiagnosis: { code: "graphics" }, lastAutoFix: { type: "reset-video-options" } };
  const before = structuredClone(instance);
  let saved = 0;
  const result = await apply({ instance, instancesRoot: root, fixAction: instance.lastAutoFix, saveStateFn: async () => { saved++; } });
  assert.equal(result.success, false);
  assert.deepEqual(instance, before);
  assert.equal(saved, 0);
});

test("option repair preserves original contents before replacement", async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, base.id);
  await fsp.mkdir(directory);
  const original = "gamma:NaN\nfov:NaN\ncustom:preserve\n";
  await fsp.writeFile(path.join(directory, "options.txt"), original);
  await apply({ instance: structuredClone(base), instancesRoot: root, fixAction: { type: "sanitize-options-txt" } });
  const backup = (await fsp.readdir(directory)).find((name) => name.startsWith("options.txt.backup-"));
  assert.equal(await fsp.readFile(path.join(directory, backup), "utf8"), original);
  assert.match(await fsp.readFile(path.join(directory, "options.txt"), "utf8"), /custom:preserve/);
});

test("a valid JSON config is not reset merely because a parse error mentions it", async (t) => {
  const root = await fixture(t);
  await fsp.mkdir(path.join(root, base.id, "config"), { recursive: true });
  await fsp.writeFile(path.join(root, base.id, "config/healthy.json"), "{}");
  assert.equal(await detect({ instance: base, instancesRoot: root, logContent: "Failed to load config/healthy.json: JsonSyntaxException" }), null);
});

test("mixin resource ownership selects its real JAR and refuses filename lookalikes", async (t) => {
  const root = await fixture(t);
  const mods = path.join(root, base.id, "mods");
  await zip(path.join(mods, "foo-helper.jar"), { "fabric.mod.json": JSON.stringify({ id: "helper" }) });
  await zip(path.join(mods, "actual-owner.jar"), { "fabric.mod.json": JSON.stringify({ id: "owner" }), "foo.mixins.json": "{}" });
  const fix = await detect({ instance: base, instancesRoot: root, logContent: "Cannot apply @Overwrite on target in foo.mixins.json" });
  assert.equal(fix.payload.modFileName, "actual-owner.jar");
  await apply({ instance: structuredClone(base), instancesRoot: root, fixAction: fix });
  assert.equal((await fsp.readdir(mods)).includes("foo-helper.jar"), true);
  assert.equal((await fsp.readdir(mods)).includes("actual-owner.jar.disabled"), true);
});

test("Forge entity handling requires a loader-specific config with existing supported fields", async (t) => {
  const root = await fixture(t);
  assert.equal(await detect({ instance: base, instancesRoot: root, logContent: "Ticking block entity" }), null);
  assert.equal(await detect({ instance: { ...base, loader: "Forge" }, instancesRoot: root, logContent: "Ticking block entity" }), null);
});

test("a successful cached no-change action cannot clear diagnosis in the real IPC handler", async (t) => {
  const root = await fixture(t);
  const fix = { type: "reset-video-options", payload: {} };
  const { handlers, context } = ipcHarness({
    extractCrashReport: async () => ({}), detectCrashAutoFix: async () => fix,
    effectiveSettings: () => ({}), applyCrashAutoFix: apply,
  });
  context.state.settings.gameDirectory = root;
  context.state.instances[0].lastDiagnosis = { code: "graphics" };
  context.state.instances[0].lastAutoFix = fix;
  const result = await handlers.get("instance:crash-apply-autofix")(null, base.id, fix);
  assert.equal(result.success, false);
  assert.equal(context.state.instances[0].lastDiagnosis.code, "graphics");
  assert.equal(context.crashFixLocks.size, 0);
});

test("a missing JAR cannot be offered as a corrupted installed mod", async (t) => {
  const root = await fixture(t);
  await fsp.mkdir(path.join(root, base.id, "mods"), { recursive: true });
  assert.equal(await detect({ instance: base, instancesRoot: root, logContent: "ZipException: zip END header not found /libraries/missing.jar" }), null);
});

test("access failure is not evidence of archive corruption", async () => {
  const { inspectJarMetadata: inspect } = loadService("electron/services/crash-autofix.cjs", {
    "node-stream-zip": { async: class { constructor() { throw Object.assign(Error("permission denied"), { code: "EACCES" }); } } },
  });
  const metadata = await inspect("/mods/healthy.jar");
  assert.equal(metadata.corrupted, false);
  assert.equal(metadata.unreadable, true);
});
