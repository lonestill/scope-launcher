const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const { ZipArchive } = require("archiver");
async function writeModJar(file, modId, entries = {}) {
  const archive = new ZipArchive();
  const output = fs.createWriteStream(file);
  const done = new Promise((resolve, reject) => { output.on("close", resolve); output.on("error", reject); archive.on("error", reject); });
  archive.pipe(output);
  archive.append(JSON.stringify({ id: modId, version: "1.0" }), { name: "fabric.mod.json" });
  for (const [name, contents] of Object.entries(entries)) archive.append(contents, { name });
  await archive.finalize();
  await done;
}

const {
  detectCrashAutoFix,
  applyCrashAutoFix,
  inspectJarMetadata,
  checkModCompatibility,
} = require("../electron/services/crash-autofix.cjs");
const { checkInstanceHealth } = require("../electron/services/preflight.cjs");

test("detectCrashAutoFix: detects OutOfMemoryError and proposes memory bump", async () => {
  const instance = {
    id: "inst-1",
    settings: { memory: 4 },
  };
  const logContent = `
[02:00:00] [main/INFO]: Loading Minecraft
[02:00:05] [main/ERROR]: java.lang.OutOfMemoryError: Java heap space
  at java.util.Arrays.copyOf(Arrays.java:3332)
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
    systemTotalRamMb: 16384, // 16 GB system
  });

  assert.ok(fix, "Expected fix to be detected");
  assert.equal(fix.type, "increase-memory");
  assert.equal(fix.payload.currentMemoryGiB, 4);
  assert.equal(fix.payload.targetMemoryGiB, 6);
});

test("detectCrashAutoFix: detects missing Indium when Sodium is present", async () => {
  const instance = {
    id: "inst-fabric",
    loader: "fabric",
    version: "1.20.1",
  };
  const logContent = `
[02:00:00] [main/ERROR]: IndiumException: Sodium has replaced the default block/fluid renderer, but another mod depends on the Fabric Rendering API! Indium is required.
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
  });

  assert.ok(fix);
  assert.equal(fix.type, "install-indium");
  assert.equal(fix.payload.projectId, "indium");
});

test("detectCrashAutoFix: detects UnsupportedClassVersionError (Java 21 requirement)", async () => {
  const instance = {
    id: "inst-2",
    version: "1.20.6",
  };
  const logContent = `
java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this compiler only recognizes class file versions up to 61.0
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
  });

  assert.ok(fix);
  assert.equal(fix.type, "switch-java");
  assert.equal(fix.payload.requiredJavaMajor, 21);
});

test("detectCrashAutoFix: detects bad JVM arguments", async () => {
  const instance = { id: "inst-3" };
  const logContent = `
Unrecognized VM option 'AggressiveOpts'
Error: Could not create the Java Virtual Machine.
Error: A fatal exception has occurred. Program will exit.
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
  });

  assert.ok(fix);
  assert.equal(fix.type, "reset-jvm-args");
});

test("detectCrashAutoFix: detects corrupted jar archive from log", async () => {
  const instance = { id: "inst-4" };
  const logContent = `
java.util.zip.ZipException: zip END header not found
  at java.util.zip.ZipFile$Source.findEND(ZipFile.java:1469)
  reading /mods/broken-mod-1.0.jar
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
  });

  assert.ok(fix);
  assert.equal(fix.type, "clean-corrupted-file");
  assert.equal(fix.payload.fileName, "broken-mod-1.0.jar");
});

test("checkModCompatibility: detects Forge mod in Fabric instance", () => {
  const modMeta = {
    fileName: "forge-only-mod.jar",
    loader: "forge",
    mcVersionRange: "1.20.1",
    corrupted: false,
  };
  const instance = {
    loader: "fabric",
    version: "1.20.1",
  };
  const result = checkModCompatibility(modMeta, instance);
  assert.equal(result.incompatible, true);
  assert.equal(result.reason, "loader-mismatch");
  assert.equal(result.modLoader, "Forge");
  assert.equal(result.instanceLoader, "Fabric");
});

test("checkModCompatibility: detects incompatible Minecraft version", () => {
  const modMeta = {
    fileName: "legacy-mod.jar",
    loader: "fabric",
    mcVersionRange: "1.16.5",
    corrupted: false,
  };
  const instance = {
    loader: "fabric",
    version: "1.20.1",
  };
  const result = checkModCompatibility(modMeta, instance);
  assert.equal(result.incompatible, true);
  assert.equal(result.reason, "version-mismatch");
});

test("applyCrashAutoFix: increases memory and clears error state", async () => {
  const instance = {
    id: "inst-mem",
    settings: { memory: 4 },
    lastAutoFix: { type: "increase-memory" },
    lastDiagnosis: { code: "out-of-memory" },
  };
  const fixAction = {
    type: "increase-memory",
    payload: { targetMemoryGiB: 8 },
  };

  let saved = false;
  const result = await applyCrashAutoFix({
    fixAction,
    instance,
    saveStateFn: async () => {
      saved = true;
    },
  });

  assert.equal(result.success, true);
  assert.equal(instance.settings.memory, 8);
  assert.equal(instance.lastAutoFix, null);
  assert.equal(instance.lastDiagnosis, null);
  assert.equal(saved, true);
});

test("applyCrashAutoFix: disables culprit mod by renaming to .disabled", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-test-"));
  const instId = "inst-culprit";
  const modsDir = path.join(tmpRoot, instId, "mods");
  await fsp.mkdir(modsDir, { recursive: true });

  const jarName = "bad-mod-1.0.jar";
  const jarPath = path.join(modsDir, jarName);
  await fsp.writeFile(jarPath, "dummy-jar-content");

  const instance = {
    id: instId,
    lastAutoFix: { type: "disable-culprit-mod" },
  };
  const fixAction = {
    type: "disable-culprit-mod",
    payload: { modFileName: jarName },
  };

  const result = await applyCrashAutoFix({
    fixAction,
    instance,
    instancesRoot: tmpRoot,
  });

  assert.equal(result.success, true);
  assert.equal(fs.existsSync(jarPath), false);
  assert.equal(fs.existsSync(`${jarPath}.disabled`), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix: detects missing dependency (fabric-api) and applies install", async () => {
  const instance = { id: "inst-dep", loader: "fabric", version: "1.20.1" };
  const logContent = `
[02:00:00] [main/FATAL]: Failed to start the minecraft server
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined:
	 - Install fabric-api, any version.
Mod 'create' (create) 0.5.1 requires {fabric-api @ >=0.85.0}, which is missing!
`;
  const fix = await detectCrashAutoFix({ instance, logContent });
  assert.ok(fix);
  assert.equal(fix.type, "install-missing-dependency");
  assert.equal(fix.payload.depId, "fabric-api");
  assert.equal(fix.payload.projectId, "fabric-api");

  let installedProject = null;
  const result = await applyCrashAutoFix({
    fixAction: fix,
    instance,
    installModFn: async ({ projectId }) => {
      installedProject = projectId;
    },
  });
  assert.equal(result.success, true);
  assert.equal(installedProject, "fabric-api");
});

test("detectCrashAutoFix: detects corrupted config file and resets it to .bak", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-cfg-"));
  const instId = "inst-cfg";
  const cfgDir = path.join(tmpRoot, instId, "config");
  await fsp.mkdir(cfgDir, { recursive: true });

  const brokenCfg = path.join(cfgDir, "broken-mod.json");
  await fsp.writeFile(brokenCfg, "{ invalid json corrupt");

  const instance = { id: instId };
  const logContent = `
[02:00:00] [main/ERROR]: com.google.gson.JsonSyntaxException: com.google.gson.stream.MalformedJsonException: Unterminated object at line 1 column 25 path $
	at com.google.gson.internal.Streams.parse(Streams.java:61)
	at net.minecraft.client.main.Main.main(Main.java:120)
Caused by: java.io.IOException: Error reading config/broken-mod.json
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
    instancesRoot: tmpRoot,
  });

  assert.ok(fix);
  assert.equal(fix.type, "reset-corrupted-config");
  assert.equal(fix.payload.configFile, "config/broken-mod.json");

  const result = await applyCrashAutoFix({
    fixAction: fix,
    instance,
    instancesRoot: tmpRoot,
  });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(brokenCfg), false);
  assert.equal(fs.existsSync(`${brokenCfg}.bak`), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix: detects OptiFine and Sodium conflict and disables OptiFine", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-conflict-"));
  const instId = "inst-conflict";
  const modsDir = path.join(tmpRoot, instId, "mods");
  await fsp.mkdir(modsDir, { recursive: true });

  const optifineJar = "OptiFine_1.20.1_HD_U_I6.jar";
  const sodiumJar = "sodium-fabric-mc1.20.1-0.5.8.jar";
  await fsp.writeFile(path.join(modsDir, optifineJar), "dummy-optifine");
  await fsp.writeFile(path.join(modsDir, sodiumJar), "dummy-sodium");

  const instance = { id: instId };
  const logContent = `
[02:00:00] [main/ERROR]: Mixin apply failed sodium.mixins.core.json:render.WorldRendererMixin -> net.minecraft.class_761: org.spongepowered.asm.mixin.injection.throwables.InjectionError Critical injection failure
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
    instancesRoot: tmpRoot,
  });

  assert.ok(fix);
  assert.equal(fix.type, "resolve-mod-conflict");
  assert.equal(fix.payload.conflictingMod, optifineJar);

  const result = await applyCrashAutoFix({
    fixAction: fix,
    instance,
    instancesRoot: tmpRoot,
  });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(modsDir, optifineJar)), false);
  assert.equal(fs.existsSync(path.join(modsDir, `${optifineJar}.disabled`)), true);
  assert.equal(fs.existsSync(path.join(modsDir, sodiumJar)), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix: detects duplicate mod files and disables the duplicate", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-dup-"));
  const instId = "inst-dup";
  const modsDir = path.join(tmpRoot, instId, "mods");
  await fsp.mkdir(modsDir, { recursive: true });

  const originalJar = "jei-1.20.1-15.2.0.27.jar";
  const duplicateJar = "jei-1.20.1-15.2.0.27 (1).jar";
  await writeModJar(path.join(modsDir, originalJar), "jei");
  await writeModJar(path.join(modsDir, duplicateJar), "jei");

  const instance = { id: instId };
  const logContent = `
[02:00:00] [main/FATAL]: Duplicate mods found: jei
net.minecraftforge.fml.loading.EarlyLoadingException: Duplicate mods found: jei
`;
  const fix = await detectCrashAutoFix({
    instance,
    logContent,
    instancesRoot: tmpRoot,
  });

  assert.ok(fix);
  assert.equal(fix.type, "remove-duplicate-mod");
  assert.equal(fix.payload.disableFile, duplicateJar);

  const result = await applyCrashAutoFix({
    fixAction: fix,
    instance,
    instancesRoot: tmpRoot,
  });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(modsDir, duplicateJar)), false);
  assert.equal(fs.existsSync(path.join(modsDir, `${duplicateJar}.disabled`)), true);
  assert.equal(fs.existsSync(path.join(modsDir, originalJar)), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: disable-active-shaderpack", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-shader-"));
  const instId = "inst-shader";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  await fsp.mkdir(path.join(instDir, "config"));
  await fsp.writeFile(path.join(instDir, "config/iris.properties"), "enableShaders=true\nshaderPack=ComplementaryReimagined.zip\n");

  const instance = { id: instId };
  const logContent = "Composite shader error: Program link failed during iris pipeline compile";
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix);
  assert.equal(fix.type, "disable-active-shaderpack");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  const updated = await fsp.readFile(path.join(instDir, "config/iris.properties"), "utf8");
  assert.ok(updated.includes("enableShaders=false"));
  assert.ok(updated.includes("shaderPack=ComplementaryReimagined.zip"));

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: repair-opengl-context", async () => {
  const instance = { id: "inst-gl", settings: { jvmArguments: [] } };
  const logContent = "GLFW error 65542: The driver does not appear to support OpenGL";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.equal(fix, null);
  await assert.rejects(applyCrashAutoFix({ instance, fixAction: { type: "repair-opengl-context", payload: {} } }), /manually/);
});

test("detectCrashAutoFix & apply: apply-wayland-fix", async () => {
  const instance = { id: "inst-wayland", settings: { jvmArguments: [] } };
  const logContent = "GLFW error 65543: GLX: Failed to create context on Wayland";
  const fix = await detectCrashAutoFix({ instance, logContent, platform: "linux" });

  assert.equal(fix, null);
  await assert.rejects(applyCrashAutoFix({ instance, fixAction: { type: "apply-wayland-fix", payload: {} } }), /manually/);
});

test("detectCrashAutoFix & apply: reset-video-options", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-video-"));
  const instId = "inst-video";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  await fsp.writeFile(path.join(instDir, "options.txt"), "fullscreen:true\noverrideWidth:3840\noverrideHeight:2160\nguiScale:4\n");

  const instance = { id: instId };
  const logContent = "org.lwjgl.LWJGLException: X Error of failed request: BadWindow (invalid Window parameter)";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "reset-video-options");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  const updated = await fsp.readFile(path.join(instDir, "options.txt"), "utf8");
  assert.ok(updated.includes("fullscreen:false"));
  assert.ok(updated.includes("overrideWidth:854"));

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: disable-active-resourcepacks", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-rp-"));
  const instId = "inst-rp";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  await fsp.writeFile(path.join(instDir, "options.txt"), "resourcePacks:[\"heavy-512x-pack.zip\"]\n");

  const instance = { id: instId };
  const logContent = "net.minecraft.client.renderer.texture.TextureAtlasException: Stitching texture atlas failed";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "disable-active-resourcepacks");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  const updated = await fsp.readFile(path.join(instDir, "options.txt"), "utf8");
  assert.ok(updated.includes("resourcePacks:[]"));

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: upgrade-loader-version", async () => {
  const instance = { id: "inst-loader", loader: "fabric", loaderVersion: "0.15.11", settings: {} };
  const logContent = "Mod 'sodium' requires fabricloader >=0.16.5, currently 0.15.11";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "upgrade-loader-version");
  assert.equal(fix.payload.requiredVersion, "0.16.5");

  const result = await applyCrashAutoFix({ fixAction: fix, instance,
    repairInstanceFn: async (target) => {
      assert.equal(target.installProfile.loaderVersion, "0.16.5");
      target.resolvedVersionId = "fabric-loader-0.16.5-1.20.1";
    },
  });
  assert.equal(result.success, true);
  assert.equal(instance.loaderVersion, "0.16.5");
});

test("detectCrashAutoFix & apply: inject-java-module-flags", async () => {
  const instance = { id: "inst-flags", settings: { jvmArguments: [] } };
  const logContent = "java.lang.reflect.InaccessibleObjectException: Unable to make protected final java.lang.Class accessible to module";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "inject-java-module-flags");

  const result = await applyCrashAutoFix({ fixAction: fix, instance });
  assert.equal(result.success, true);
  assert.ok(instance.settings.jvmArguments.some((f) => f.includes("--add-opens")));
});

test("detectCrashAutoFix & apply: enable-forge-entity-removal", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-entity-"));
  const instId = "inst-entity";
  const cfgDir = path.join(tmpRoot, instId, "config");
  await fsp.mkdir(cfgDir, { recursive: true });

  await fsp.writeFile(path.join(cfgDir, "forge.cfg"), "general {\nB:removeErroringEntities=false\nB:removeErroringTileEntities=false\n}\n");
  const instance = { id: instId, loader: "forge" };
  const logContent = "java.lang.NullPointerException: Ticking entity at chunk (12, -4)";
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix);
  assert.equal(fix.type, "enable-forge-entity-removal");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  const tomlPath = path.join(cfgDir, "forge.cfg");
  assert.ok(fs.existsSync(tomlPath));
  const content = await fsp.readFile(tomlPath, "utf8");
  assert.ok(content.includes("B:removeErroringEntities=true"));

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: quarantine-playerdata", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-player-"));
  const instId = "inst-player";
  const pdDir = path.join(tmpRoot, instId, "saves", "New World", "playerdata");
  await fsp.mkdir(pdDir, { recursive: true });
  const uuid = "4f2277d3-18e4-4fa0-82d2-5a9e3e3b3333";
  const playerFile = path.join(pdDir, `${uuid}.dat`);
  await fsp.writeFile(playerFile, "corrupted data");

  const instance = { id: instId };
  const logContent = `Failed to load player data: Corrupt NBT tag reading playerdata/${uuid}.dat`;
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "quarantine-playerdata");
  assert.equal(fix.payload.uuid, uuid);

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(playerFile), false);
  assert.equal(fs.existsSync(`${playerFile}.bak`), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix refuses automatic deletion of session locks", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-zombie-"));
  const instId = "inst-zombie";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  const lockFile = path.join(instDir, "session.lock");
  await fsp.writeFile(lockFile, "lock");

  const instance = { id: instId, settings: {} };
  const logContent = "java.nio.file.AccessDeniedException: session.lock is locked by another process";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.equal(fix, null);
  await assert.rejects(applyCrashAutoFix({ fixAction: { type: "kill-zombie-process" }, instance, instancesRoot: tmpRoot }), /automatic lock deletion is disabled/);
  assert.equal(await fsp.readFile(lockFile, "utf8"), "lock");

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: cleanup-temp-install-files", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-temp-"));
  const instId = "inst-temp";
  const modsDir = path.join(tmpRoot, instId, "mods");
  await fsp.mkdir(modsDir, { recursive: true });
  await fsp.writeFile(path.join(modsDir, "stale-mod.jar.tmp"), "temp");
  await fsp.writeFile(path.join(modsDir, "download.scope-download"), "temp");
  await fsp.writeFile(path.join(modsDir, "valid-mod.jar"), "valid");

  const instance = { id: instId };
  const logContent = "Error: mod.jar.tmp exists and is incomplete";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "cleanup-temp-install-files");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(modsDir, "stale-mod.jar.tmp")), false);
  assert.equal(fs.existsSync(path.join(modsDir, "download.scope-download")), false);
  assert.equal(fs.existsSync(path.join(modsDir, "valid-mod.jar")), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: restore-corrupted-level-dat", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-level-"));
  const instId = "inst-lvl";
  const wDir = path.join(tmpRoot, instId, "saves", "SurvivalWorld");
  await fsp.mkdir(wDir, { recursive: true });
  await fsp.writeFile(path.join(wDir, "level.dat"), "");
  await fsp.writeFile(path.join(wDir, "level.dat_old"), "good-nbt-backup");

  const instance = { id: instId };
  const logContent = "Failed to read level.dat: java.io.EOFException reading saves/SurvivalWorld/level.dat";
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix);
  assert.equal(fix.type, "restore-corrupted-level-dat");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  assert.ok((await fsp.readdir(wDir)).some((name) => name.startsWith("level.dat.corrupt-")));
  const restored = await fsp.readFile(path.join(wDir, "level.dat"), "utf8");
  assert.equal(restored, "good-nbt-backup");

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: resolve-mixin-overwrite", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-mixin-"));
  const instId = "inst-mix";
  const modsDir = path.join(tmpRoot, instId, "mods");
  await fsp.mkdir(modsDir, { recursive: true });
  await writeModJar(path.join(modsDir, "badrender-1.0.jar"), "badrender", { "badrender.mixins.json": "{}" });

  const instance = { id: instId };
  const logContent = "org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: Critical injection failure: Cannot apply @Overwrite on target in badrender.mixins.json";
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix);
  assert.equal(fix.type, "resolve-mixin-overwrite");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(modsDir, "badrender-1.0.jar")), false);
  assert.equal(fs.existsSync(path.join(modsDir, "badrender-1.0.jar.disabled")), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: sanitize-options-txt", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-opt-"));
  const instId = "inst-opt";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  await fsp.writeFile(path.join(instDir, "options.txt"), "gamma:NaN\nfov:NaN\n");

  const instance = { id: instId };
  const logContent = "java.lang.NumberFormatException: For input string: \"NaN\" reading options.txt";
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix);
  assert.equal(fix.type, "sanitize-options-txt");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  const updated = await fsp.readFile(path.join(instDir, "options.txt"), "utf8");
  assert.ok(updated.includes("gamma:1.0"));
  assert.ok(updated.includes("fov:70.0"));

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: install-optifabric", async () => {
  const instance = { id: "inst-of", loader: "fabric" };
  const logContent = "OptiFine 1.20.1 loaded but LaunchClassLoader is missing! OptiFine is not compatible directly with Fabric";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "install-optifabric");

  let installed = null;
  const result = await applyCrashAutoFix({
    fixAction: fix,
    instance,
    installModFn: async ({ projectId }) => {
      installed = projectId;
    },
  });
  assert.equal(result.success, true);
  assert.equal(installed, "optifabric");
});

test("detectCrashAutoFix & apply: purge-instance-logs-cache", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-purge-"));
  const instId = "inst-purge";
  const logsDir = path.join(tmpRoot, instId, "logs");
  await fsp.mkdir(logsDir, { recursive: true });
  await fsp.writeFile(path.join(logsDir, "2026-09-01-1.log.gz"), "old-log");
  await fsp.writeFile(path.join(logsDir, "latest.log"), "current-log");

  const instance = { id: instId };
  const logContent = "java.io.IOException: There is not enough space on the disk";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "purge-instance-logs-cache");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(logsDir, "2026-09-01-1.log.gz")), false);
  assert.equal(fs.existsSync(path.join(logsDir, "latest.log")), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: install-language-adapter", async () => {
  const instance = { id: "inst-lang", loader: "fabric" };
  const logContent = "net.fabricmc.loader.api.LanguageAdapterException: Language adapter 'kotlin' was not found";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "install-language-adapter");
  assert.equal(fix.payload.adapterName, "kotlin");

  let installed = null;
  const result = await applyCrashAutoFix({
    fixAction: fix,
    instance,
    installModFn: async ({ projectId }) => {
      installed = projectId;
    },
  });
  assert.equal(result.success, true);
  assert.equal(installed, "fabric-language-kotlin");
});

test("detectCrashAutoFix & apply: suppress-gpu-hooks", async () => {
  const instance = { id: "inst-nv", settings: { jvmArguments: [] } };
  const logContent = "# Problematic frame: C [nvoglv64.dll+0x91834] EXCEPTION_ACCESS_VIOLATION (0xc0000005)";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.equal(fix, null);
  await assert.rejects(applyCrashAutoFix({ instance, fixAction: { type: "suppress-gpu-hooks", payload: {} } }), /manually/);
});

test("detectCrashAutoFix & apply: force-switch-64bit-java", async () => {
  const instance = { id: "inst-32", settings: { javaPath: "/old/32bit/bin/java" } };
  const logContent = "Error: Could not reserve enough space for 3145728KB object heap on 32-Bit Server VM";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.equal(fix, null);

});

test("detectCrashAutoFix & apply: install-qsl-library", async () => {
  const instance = { id: "inst-qsl", loader: "quilt" };
  const logContent = "quilt_loader: Missing dependency: qsl (Quilt Standard Libraries)";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "install-qsl-library");

  let installed = null;
  const result = await applyCrashAutoFix({
    fixAction: fix,
    instance,
    installModFn: async ({ projectId }) => {
      installed = projectId;
    },
  });
  assert.equal(result.success, true);
  assert.equal(installed, "qsl");
});

test("detectCrashAutoFix & apply: purge-corrupted-natives rebuilds shared natives", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-nat-"));
  try {
    const { MinecraftService } = require("../electron/services/minecraft.cjs");
    const service = new MinecraftService({ sharedRoot: path.join(tmpRoot, "shared"), instancesRoot: tmpRoot });
    service.loadResolvedVersion = async () => ({ inheritsFrom: "1.20.1" });
    const directory = path.join(tmpRoot, "shared/natives/1.20.1");
    await fsp.mkdir(directory, { recursive: true });
    await fsp.writeFile(path.join(directory, "damaged.dll"), "old");
    service.installVanilla = async (id) => { assert.equal(id, "1.20.1"); await fsp.mkdir(directory, { recursive: true }); await fsp.writeFile(path.join(directory, "repaired.dll"), "good"); };
    const instance = { id: "inst-nat", version: "1.20.1", resolvedVersionId: "fabric-version" };
    const fix = await detectCrashAutoFix({ instance, logContent: "java.lang.UnsatisfiedLinkError: Could not load library: lwjgl" });
    assert.equal(fix.type, "purge-corrupted-natives");
    const result = await applyCrashAutoFix({ instance, fixAction: fix, repairNativesFn: () => service.repairNatives(instance) });
    assert.equal(result.success, true);
    assert.deepEqual(await fsp.readdir(directory), ["repaired.dll"]);
  } finally { await fsp.rm(tmpRoot, { recursive: true, force: true }); }

});

test("detectCrashAutoFix & apply: allow-security-manager-flag", async () => {
  const instance = { id: "inst-sm", settings: { jvmArguments: [] } };
  const logContent = "java.lang.UnsupportedOperationException: The Security Manager is deprecated and will be removed in a future release";
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix);
  assert.equal(fix.type, "allow-security-manager-flag");

  const result = await applyCrashAutoFix({ fixAction: fix, instance });
  assert.equal(result.success, true);
  assert.ok(instance.settings.jvmArguments.includes("-Djava.security.manager=allow"));
});

test("detectCrashAutoFix: detects NeoForge missing dependency (geckolib) from crash log", async () => {
  const instance = { id: "inst-nf", loader: "neoforge", version: "1.21.1" };
  const logContent = `
-- Mod loading issue for: ribbits --
Details:
	Mod file: /home/user/.minecraft/mods/Ribbits-1.21.1-NeoForge-4.1.6.jar
	Failure message: Mod ribbits requires geckolib 4.7.5.1 or above
		Currently, geckolib is not installed
`;
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix, "Expected fix to be detected");
  assert.equal(fix.type, "install-missing-dependency");
  assert.equal(fix.payload.depId, "geckolib");
  assert.equal(fix.payload.projectId, "geckolib");
  assert.equal(fix.payload.depName, "GeckoLib");
});

test("detectCrashAutoFix & apply: remove-vanilla-jar-from-mods disables stray 1.21.1.jar", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-vanilla-"));
  const instId = "inst-vanilla";
  const modsDir = path.join(tmpRoot, instId, "mods");
  await fsp.mkdir(modsDir, { recursive: true });
  await fsp.writeFile(path.join(modsDir, "1.21.1.jar"), "dummy-vanilla-jar");

  const instance = { id: instId, loader: "neoforge", version: "1.21.1" };
  const logContent = `
Exception in thread "main" java.lang.module.ResolutionException: Modules _1._21._1 and minecraft export package net.minecraft.server to module create
	at java.base/java.lang.module.Resolver.resolveFail(Unknown Source)
`;
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix, "Expected stray vanilla jar fix to be detected");
  assert.equal(fix.type, "remove-vanilla-jar-from-mods");
  assert.equal(fix.payload.fileName, "1.21.1.jar");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(modsDir, "1.21.1.jar")), false);
  assert.equal(fs.existsSync(path.join(modsDir, "1.21.1.jar.disabled")), true);

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: clean-corrupted-usercache removes 0-byte or malformed usercache", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-uc-"));
  const instId = "inst-usercache";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  await fsp.writeFile(path.join(instDir, "usercache.json"), "{broken json");
  await fsp.writeFile(path.join(instDir, "realms_persistence.json"), "{corrupt realms");

  const instance = { id: instId };
  const logContent = `
com.google.gson.JsonSyntaxException: java.io.EOFException: End of input at line 1 column 1 path $
  at net.minecraft.util.UserCache.load(UserCache.java:123)
`;
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix, "Expected usercache fix to be detected");
  assert.equal(fix.type, "clean-corrupted-usercache");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(instDir, "usercache.json")), false);
  assert.equal(await fsp.readFile(path.join(instDir, "realms_persistence.json"), "utf8"), "{corrupt realms");

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix & apply: sanitize-jvm-gc-flags strips obsolete CMS GC on Java 17/21 and adds G1GC", async () => {
  const instance = {
    id: "inst-cms",
    version: "1.20.1",
    javaMajor: 17,
    settings: {
      jvmArguments: [
        "-Xms2G",
        "-XX:+UseConcMarkSweepGC",
        "-XX:+CMSIncrementalMode",
        "-Dcustom=1",
      ],
    },
  };
  const logContent = `
Unrecognized VM option 'UseConcMarkSweepGC'
Error: Could not create the Java Virtual Machine.
`;
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix, "Expected GC sanitization fix to be detected");
  assert.equal(fix.type, "sanitize-jvm-gc-flags");

  const result = await applyCrashAutoFix({ fixAction: fix, instance });
  assert.equal(result.success, true);
  assert.ok(!instance.settings.jvmArguments.includes("-XX:+UseConcMarkSweepGC"));
  assert.ok(!instance.settings.jvmArguments.includes("-XX:+CMSIncrementalMode"));
  assert.ok(instance.settings.jvmArguments.includes("-XX:+UseG1GC"));
  assert.ok(instance.settings.jvmArguments.includes("-Xms2G"));
  assert.ok(instance.settings.jvmArguments.includes("-Dcustom=1"));
});

test("detectCrashAutoFix & apply: disable-early-display injects fml.earlydisplay=false", async () => {
  const instance = {
    id: "inst-earlydisplay",
    loader: "forge",
    version: "1.20.1",
    settings: { jvmArguments: ["-Xmx4G"] },
  };
  const logContent = `
Failed to initialize EarlyDisplay: java.lang.IllegalStateException: GLFW error 65543: GLX: Failed to create context on Wayland
  at net.minecraftforge.fml.earlydisplay.DisplayWindow.<init>(DisplayWindow.java:80)
`;
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix, "Expected early display fix to be detected");
  assert.equal(fix.type, "disable-early-display");

  const result = await applyCrashAutoFix({ fixAction: fix, instance });
  assert.equal(result.success, true);
  assert.ok(instance.settings.jvmArguments.includes("-Dfml.earlydisplay=false"));
  assert.ok(instance.settings.jvmArguments.includes("-Dneoforge.earlydisplay=false"));
});

test("detectCrashAutoFix & apply: repair-servers-dat restores from servers.dat_old", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-fix-servers-"));
  const instId = "inst-servers";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  await fsp.writeFile(path.join(instDir, "servers.dat"), "");
  await fsp.writeFile(path.join(instDir, "servers.dat_old"), "valid-servers-backup-data");

  const instance = { id: instId };
  const logContent = `
net.minecraft.nbt.ReportedNbtException: Loading NBT data
  at net.minecraft.nbt.NbtIo.readCompressed(NbtIo.java:70)
Failed to load servers: java.io.EOFException
`;
  const fix = await detectCrashAutoFix({ instance, logContent, instancesRoot: tmpRoot });

  assert.ok(fix, "Expected servers.dat repair fix to be detected");
  assert.equal(fix.type, "repair-servers-dat");

  const result = await applyCrashAutoFix({ fixAction: fix, instance, instancesRoot: tmpRoot });
  assert.equal(result.success, true);
  const restoredContent = await fsp.readFile(path.join(instDir, "servers.dat"), "utf8");
  assert.equal(restoredContent, "valid-servers-backup-data");

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test("detectCrashAutoFix: maps fabric virtual submodules (fabric-lifecycle-events-v1) to fabric-api", async () => {
  const instance = { id: "inst-fabric-sub", loader: "fabric", version: "1.20.1" };
  const logContent = `
Mod 'trinkets' (trinkets) requires {fabric-lifecycle-events-v1 @ >=2.2.4}, which is missing!
	A potential solution has been determined:
		 - Install fabric-lifecycle-events-v1
`;
  const fix = await detectCrashAutoFix({ instance, logContent });

  assert.ok(fix, "Expected missing dependency fix");
  assert.equal(fix.type, "install-missing-dependency");
  assert.equal(fix.payload.depId, "fabric-lifecycle-events-v1");
  assert.equal(fix.payload.projectId, "fabric-api");
  assert.equal(fix.payload.depName, "Fabric API");
});

test("preflight: detects corrupted usercache and servers.dat", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-preflight-"));
  const instId = "inst-pf";
  const instDir = path.join(tmpRoot, instId);
  await fsp.mkdir(instDir, { recursive: true });
  await fsp.writeFile(path.join(instDir, "usercache.json"), "");
  await fsp.writeFile(path.join(instDir, "servers.dat"), "not-a-gzip-file");

  const instance = {
    id: instId,
    name: "Preflight Test",
    version: "1.20.1",
    loader: "fabric",
    resolvedVersionId: "1.20.1-fabric",
    status: "ready",
    settings: {
      jvmArguments: ["-XX:+UseConcMarkSweepGC"],
    },
  };

  const health = await checkInstanceHealth({
    instance,
    sharedRoot: tmpRoot,
    instancesRoot: tmpRoot,
    inspectJavaFn: async () => ({ executable: "java", major: 17, version: "17.0.1" }),
    scanModsFn: async () => [],
  });

  const codes = health.checks.map((c) => c.code);
  assert.ok(codes.includes("corrupted-usercache"), "Should detect corrupted usercache");
  assert.ok(codes.includes("corrupted-servers-dat"), "Should detect corrupted servers.dat");
  assert.ok(codes.includes("obsolete-cms-gc"), "Should detect obsolete CMS GC on Java 17");

  await fsp.rm(tmpRoot, { recursive: true, force: true });
});


