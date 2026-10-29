const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const rootRequire = require('node:module').createRequire(path.resolve(__dirname, '../package.json'));
const test = require('node:test');
const { ZipArchive } = rootRequire('archiver');
const { detectCrashAutoFix: detect, applyCrashAutoFix: apply, checkModCompatibility: compat } = rootRequire('./electron/services/crash-autofix.cjs');
const { MinecraftService } = rootRequire('./electron/services/minecraft.cjs');
const base = { id: 'instance', loader: 'Fabric', version: '1.20.1', settings: { memory: 4 }, lastDiagnosis: { code: 'original' } };
async function zip(destination, entries) { await fsp.mkdir(path.dirname(destination), { recursive: true }); const archive = new ZipArchive({ zlib: { level: 1 } }), output = fs.createWriteStream(destination); const done = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); }); archive.pipe(output); for (const [name, data] of Object.entries(entries))
    archive.append(data, { name }); await archive.finalize(); await done; }
async function mod(root, name, id = name.replace(/\.jar$/, '')) { await zip(path.join(root, base.id, 'mods', name), { 'fabric.mod.json': JSON.stringify({ id, version: '1.0.0', depends: { minecraft: '>=1.19' } }) }); }
async function write(root, relative, value) { const file = path.join(root, base.id, relative); await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, value); return file; }
async function check(name, fn) {
    await test(name, async (t) => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'scope-detector-audit-'));
        t.after(() => fsp.rm(root, { recursive: true, force: true }));
        await fn(root, t);
    });
}
const cases = [
    ['increase-memory', 'OutOfMemoryError: Java heap space'],
    ['install-indium', 'Indium is required'],
    ['switch-java', 'java.lang.UnsupportedClassVersionError: example.Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this compiler only recognizes class file versions up to 61.0'],
    ['sanitize-jvm-gc-flags', "Unrecognized VM option 'UseConcMarkSweepGC'"],
    ['reset-jvm-args', "Unrecognized VM option 'AggressiveOpts'"],
    ['clean-corrupted-file', 'ZipException: zip END header not found broken.jar', async (r) => write(r, 'mods/broken.jar', 'damaged')],
    ['install-missing-dependency', "Mod 'foo' requires {fabric-api}, which is missing"],
    ['reset-corrupted-config', 'Failed to load config config/foo.json', async (r) => write(r, 'config/foo.json', '{bad')],
    ['resolve-mod-conflict', 'Rendering conflict', async (r) => { await mod(r, 'optifine.jar'); await mod(r, 'sodium.jar'); }],
    ['remove-duplicate-mod', "Duplicate mod ID: 'foo'", async (r) => { await mod(r, 'foo-1.jar', 'foo'); await mod(r, 'foo-2.jar', 'foo'); }],
    ['remove-vanilla-jar-from-mods', 'Modules _1.21.1 and minecraft export package x', async (r) => zip(path.join(r, base.id, 'mods/1.21.1.jar'), { 'example.class': 'data' })],
    ['disable-culprit-mod', 'NoClassDefFoundError', async (r) => mod(r, 'bad.jar'), { crashReport: { suspectedCulprit: 'bad.jar' } }],
    ['disable-active-shaderpack', 'ShaderCompileError'],
    ['disable-early-display', 'Failed to initialize EarlyDisplay: java.lang.IllegalStateException: GLFW error'],
    ['apply-wayland-fix', 'GLX: Failed to create context on Wayland', null, { platform: 'linux' }],
    ['repair-opengl-context', 'GLFW error 65542: The driver does not appear to support OpenGL'],
    ['reset-video-options', 'overrideHeight invalid'],
    ['disable-active-resourcepacks', 'TextureAtlasException'],
    ['upgrade-loader-version', 'requires fabricloader >=0.16.10'],
    ['inject-java-module-flags', 'InaccessibleObjectException: module java.base does not opens java.lang'],
    ['enable-forge-entity-removal', 'Ticking block entity', async (r) => write(r, 'config/forge.cfg', 'B:removeErroringEntities=false\nB:removeErroringTileEntities=false'), { instance: { ...base, loader: 'Forge' } }],
    ['quarantine-playerdata', 'Failed to load player data playerdata/4f2277d3-18e4-4fa0-82d2-5a9e3e3b3333.dat'],
    ['repair-instance-assets', 'Missing asset'],
    ['cleanup-temp-install-files', 'mod.jar.tmp exists'],
    ['restore-corrupted-level-dat', 'Failed to read level.dat saves/MyWorld/level.dat'],
    ['resolve-mixin-overwrite', 'Cannot apply @Overwrite on target foo.mixins.json', async (r) => zip(path.join(r, base.id, 'mods/owner.jar'), { 'fabric.mod.json': JSON.stringify({ id: 'owner', version: '1.0' }), 'foo.mixins.json': '{}' })],
    ['sanitize-options-txt', 'Failed to load options'],
    ['install-optifabric', 'OptiFine is not compatible directly'],
    ['purge-instance-logs-cache', 'No space left on device'],
    ['install-language-adapter', "Language adapter 'kotlin' was not found"],
    ['suppress-gpu-hooks', '# Problematic frame: C [nvoglv64.dll]'],
    ['install-qsl-library', 'Quilt Standard Libraries missing'],
    ['purge-corrupted-natives', 'UnsatisfiedLinkError: Could not load library: lwjgl'],
    ['allow-security-manager-flag', 'UnsupportedOperationException: The Security Manager is deprecated'],
    ['clean-corrupted-usercache', 'Failed to load user cache: com.google.gson.JsonSyntaxException'],
    ['repair-servers-dat', 'Failed to load servers: java.io.EOFException'],
];
(async () => {
    for (const [expected, logContent, setup, extras] of cases)
        await check('positive: ' + expected, async (r) => { if (setup)
            await setup(r); const action = await detect({ instance: structuredClone(base), instancesRoot: r, logContent, systemTotalRamMb: 16384, ...extras }); assert.equal(action?.type, ['repair-opengl-context', 'suppress-gpu-hooks', 'apply-wayland-fix'].includes(expected) ? undefined : expected); return action?.type; });
    await check('native-thread OOM must not increase heap', async () => { const fix = await detect({ instance: base, systemTotalRamMb: 16384, logContent: 'java.lang.OutOfMemoryError: unable to create native thread: possibly out of memory or process/resource limits reached' }); assert.notEqual(fix?.type, 'increase-memory'); });
    await check('native memory allocation failure must not increase heap', async () => { const fix = await detect({ instance: base, systemTotalRamMb: 16384, logContent: 'There is insufficient memory for the Java Runtime Environment to continue. Native memory allocation (malloc) failed to allocate 32744 bytes' }); assert.notEqual(fix?.type, 'increase-memory'); });
    await check('classfile 66 requires Java 22', async () => { const fix = await detect({ instance: base, logContent: 'java.lang.UnsupportedClassVersionError: example.Main has been compiled by a more recent version of the Java Runtime (class file version 66.0), this compiler only recognizes class file versions up to 65.0' }); assert.equal(fix?.payload.requiredJavaMajor, 22); });
    await check('multiline class-version error resolves required version rather than supported version', async () => { const fix = await detect({ instance: base, logContent: 'java.lang.UnsupportedClassVersionError: example.Main has been compiled by a more recent version of the Java Runtime (class file version 67.0),\nthis compiler only recognizes class file versions up to 65.0' }); assert.equal(fix?.payload.requiredJavaMajor, 23); });
    await check('Fabric human-readable missing dependency is detected', async () => { const fix = await detect({ instance: base, logContent: "Mod 'Example' (example) 1.0 requires any version of fabric-api, which is missing!" }); assert.equal(fix?.type, 'install-missing-dependency'); });
    await check('Fabric human-readable loader requirement is detected', async () => { const fix = await detect({ instance: base, logContent: "Mod 'Example' (example) 1.0 requires version 0.16.10 or later of mod 'Fabric Loader' (fabricloader), but only the wrong version is present: 0.15.11!" }); assert.equal(fix?.type, 'upgrade-loader-version'); });
    await check('Java module repair uses arguments accepted by a real JVM', async (_r, t) => { const fix = await detect({ instance: base, logContent: 'InaccessibleObjectException: module java.base does not opens java.lang' }); const instance = structuredClone(base); await apply({ instance, fixAction: fix }); const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'; const baseline = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 5000 }); if (baseline.error?.code === 'ENOENT' || /Unable to locate a Java Runtime/.test(baseline.stderr || '')) {
        t.skip('Java is not installed');
        return;
    } const result = spawnSync(java, [...instance.settings.jvmArguments, '-version'], { encoding: 'utf8', timeout: 5000 }); assert.equal(result.status, 0, (result.stderr || result.error?.message || '').slice(0, 300)); });
    await check('GC repair removes the flag Java reported as unsupported', async () => { const fix = await detect({ instance: base, logContent: "Unrecognized VM option 'UseZGC'" }); const instance = { ...structuredClone(base), javaMajor: 17, settings: { jvmArguments: ['-XX:+UseZGC'] } }; await apply({ instance, fixAction: fix }); assert.ok(!instance.settings.jvmArguments.includes('-XX:+UseZGC')); });
    await check('shader repair changes actual Iris config/iris.properties', async (r) => { await write(r, 'config/iris.properties', 'enableShaders=true\nshaderPack=example.zip\n'); const fix = await detect({ instance: base, logContent: 'ShaderCompileError' }); await apply({ instance: structuredClone(base), instancesRoot: r, fixAction: fix }); assert.match(await fsp.readFile(path.join(r, base.id, 'config/iris.properties'), 'utf8'), /enableShaders=false/); });
    await check('native repair rebuilds the shared directory actually used by buildLaunch', async (r) => {
        const service = new MinecraftService({ sharedRoot: path.join(r, 'shared'), instancesRoot: r });
        service.loadResolvedVersion = async () => ({ inheritsFrom: '1.20.1' });
        const directory = path.join(r, 'shared/natives/1.20.1');
        await fsp.mkdir(directory, { recursive: true });
        await fsp.writeFile(path.join(directory, 'bad.dylib'), 'damaged');
        service.installVanilla = async (id) => { assert.equal(id, '1.20.1'); await fsp.mkdir(directory, { recursive: true }); await fsp.writeFile(path.join(directory, 'good.dylib'), 'good'); };
        const fix = await detect({ instance: base, logContent: 'UnsatisfiedLinkError: Could not load library: lwjgl' });
        await apply({ instance: structuredClone(base), instancesRoot: r, repairNativesFn: () => service.repairNatives(base), fixAction: fix });
        assert.deepEqual(await fsp.readdir(directory), ['good.dylib']);
    });
    await check('unrelated EOF exception does not delete healthy user caches', async (r) => { await write(r, 'usercache.json', '[{"name":"Player"}]'); await write(r, 'realms_persistence.json', '{"token":"keep"}'); const fix = await detect({ instance: base, logContent: 'Failed to parse unrelated config\njava.io.EOFException: End of input at line 1 column 1 path $' }); assert.notEqual(fix?.type, 'clean-corrupted-usercache'); });
    await check('generic NBT world failure does not repair server list', async () => { const fix = await detect({ instance: base, logContent: 'net.minecraft.nbt.ReportedNbtException: Loading NBT data from saves/Survival/region/r.0.0.mca' }); assert.notEqual(fix?.type, 'repair-servers-dat'); });
    await check('server-list ZipException is not swallowed by mod-JAR detection', async () => { const fix = await detect({ instance: base, logContent: 'servers.dat: java.util.zip.ZipException: Not in GZIP format' }); assert.equal(fix?.type, 'repair-servers-dat'); });
    await check('ordinary Iris package name is not a shader failure', async () => { const fix = await detect({ instance: base, logContent: 'java.lang.NullPointerException: unrelated failure\n at net.irisshaders.iris.shaderpack.ShaderPack.getName(ShaderPack.java:50)' }); assert.notEqual(fix?.type, 'disable-active-shaderpack'); });
    await check('65543 WGL error is not automatically a Wayland failure', async () => { const fix = await detect({ instance: base, logContent: 'GLFW error 65543: WGL: Failed to create OpenGL context' }); assert.notEqual(fix?.type, 'apply-wayland-fix'); });
    await check('Fabric known loader label with version still detects OptiFabric requirement', async () => { const fix = await detect({ instance: { ...base, loader: 'Fabric 0.16.10' }, logContent: 'OptiFine is not compatible directly' }); assert.equal(fix?.type, 'install-optifabric'); });
    await check('missing player UUID is not offered as an executable quarantine', async () => { const fix = await detect({ instance: base, logContent: 'Failed to load player data' }); assert.notEqual(fix?.type, 'quarantine-playerdata'); });
    await check('unknown mixin owner is not offered as an executable disable', async () => { const fix = await detect({ instance: base, logContent: 'Cannot apply @Overwrite on target' }); assert.notEqual(fix?.type, 'resolve-mixin-overwrite'); });
    await check('Forge and NeoForge are not automatically compatible', async () => { assert.equal(compat({ loader: 'forge', supportedLoaders: ['forge'] }, { ...base, loader: 'NeoForge', version: '1.21.1' }).incompatible, true); });
    await check('Quilt-only mod is not automatically compatible with Fabric', async () => { assert.equal(compat({ loader: 'quilt', supportedLoaders: ['quilt'] }, base).incompatible, true); });
    await check('healthy accessory is not selected as a duplicate by substring', async (r) => { await mod(r, 'sodium-0.5.jar', 'sodium'); await mod(r, 'sodium-extra-0.5.jar', 'sodium-extra'); const fix = await detect({ instance: base, instancesRoot: r, logContent: "Duplicate mod ID: 'sodium'" }); assert.notEqual(fix?.type, 'remove-duplicate-mod'); });
    await check('NBT parser error does not quarantine player state without player context', async () => { const fix = await detect({ instance: base, logContent: 'Corrupt NBT tag in level.dat' }); assert.notEqual(fix?.type, 'quarantine-playerdata'); });
    await check('config fix refuses valid config mentioned before malformed config', async (r) => { await write(r, 'config/healthy.json', '{}'); await write(r, 'config/broken.json', '{invalid'); const fix = await detect({ instance: base, instancesRoot: r, logContent: 'Loaded config/healthy.json\nFailed to load config/broken.json: JsonSyntaxException' }); assert.equal(fix?.payload.configFile, 'config/broken.json'); });
    await check('missing options file is not reported as repaired', async (r) => { const instance = structuredClone(base); const result = await apply({ instance, instancesRoot: r, fixAction: { type: 'reset-video-options', payload: {} } }); assert.equal(result.success, false); });
    await check('cache repair cannot claim success if there are no files to repair', async (r) => { const result = await apply({ instance: structuredClone(base), instancesRoot: r, fixAction: { type: 'repair-servers-dat', payload: {} } }); assert.equal(result.success, false); });
    await check('failed server backup copy cannot claim success', async (r) => { await write(r, 'servers.dat', 'damaged'); await write(r, 'servers.dat_old', 'backup'); const original = fsp.copyFile; try {
        fsp.copyFile = async () => { throw Object.assign(Error('permission denied'), { code: 'EACCES' }); };
        await assert.rejects(apply({ instance: structuredClone(base), instancesRoot: r, fixAction: { type: 'repair-servers-dat', payload: {} } }), /permission denied/);
    }
    finally {
        fsp.copyFile = original;
    } });
    await check('unknown adapter is not automatically interpreted as Kotlin', async () => { const fix = await detect({ instance: base, logContent: 'LanguageAdapterException: my.custom.Adapter failed during initialization' }); assert.notEqual(fix?.payload.projectId, 'fabric-language-kotlin'); });
    await check('healthy Realms persistence survives usercache-only corruption', async (r) => { await write(r, 'usercache.json', '{invalid'); await write(r, 'realms_persistence.json', '{"valid":true}'); const fix = await detect({ instance: base, logContent: 'Failed to load user cache: com.google.gson.JsonSyntaxException' }); await apply({ instance: structuredClone(base), instancesRoot: r, fixAction: fix }); assert.equal(await fsp.readFile(path.join(r, base.id, 'realms_persistence.json'), 'utf8'), '{"valid":true}'); });
    await check('metaspace limit exhaustion is not automatically treated as heap exhaustion', async () => { const fix = await detect({ instance: { ...base, settings: { memory: 4, jvmArguments: ['-XX:MaxMetaspaceSize=64m'] } }, systemTotalRamMb: 16384, logContent: 'java.lang.OutOfMemoryError: Metaspace' }); assert.notEqual(fix?.type, 'increase-memory'); });
    await check('healthy startup messages do not trigger an automatic fix', async () => { assert.equal(await detect({ instance: base, logContent: '[INFO] Loading Minecraft 1.20.1\n[INFO] Loaded successfully' }), null); });
    await check('disabled actions preserve diagnosis', async () => { for (const type of ['switch-arm64-java', 'install-openjfx', 'restore-world-snapshot', 'kill-zombie-process', 'reconcile-modpack-manifest', 'disable-environment-mismatched-mod', 'force-switch-64bit-java']) {
        const instance = structuredClone(base);
        await assert.rejects(apply({ instance, fixAction: { type, payload: {} } }));
        assert.equal(instance.lastDiagnosis.code, 'original');
    } });
})().catch(e => { console.error(e); process.exitCode = 1; });
