const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { inspectJava } = require("./java.cjs");
const { scanInstanceMods } = require("./mod-metadata.cjs");

const GIB = 1024 ** 3;
const BLOCKING_CODES = new Set([
  "disk-critical",
  "memory-impossible",
  "instance-directory-readonly",
]);

function requiredJavaForMinecraft(version) {
  const [major, minor, patch = 0] = String(version).split(".").map(Number);
  if (major !== 1) return 21;
  if (minor <= 16) return 8;
  if (minor < 20 || (minor === 20 && patch <= 4)) return 17;
  return 21;
}

function compatibleJava(requiredMajor, actualMajor) {
  return (
    actualMajor === requiredMajor ||
    (requiredMajor >= 17 && actualMajor > requiredMajor)
  );
}

async function availableDisk(targetPath) {
  try {
    const stats = await fsp.statfs(targetPath);
    return {
      total: Number(stats.blocks) * Number(stats.bsize),
      free: Number(stats.bavail) * Number(stats.bsize),
    };
  } catch {
    return null;
  }
}

async function readVersionMetadata(sharedRoot, versionId) {
  const metadataPath = path.join(
    sharedRoot,
    "versions",
    versionId,
    `${versionId}.json`,
  );
  try {
    return {
      path: metadataPath,
      value: JSON.parse(await fsp.readFile(metadataPath, "utf8")),
    };
  } catch {
    return { path: metadataPath, value: null };
  }
}

function reportStatus(checks, { requiresInstall, repairNeeded }) {
  if (
    checks.some(
      (check) =>
        check.status === "error" && BLOCKING_CODES.has(check.code),
    )
  ) {
    return "blocked";
  }
  if (repairNeeded) return "repair";
  if (requiresInstall) return "setup";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "healthy";
}

async function checkInstanceHealth({
  instance,
  settings = {},
  sharedRoot,
  instancesRoot,
  inspectJavaFn = inspectJava,
  scanModsFn = scanInstanceMods,
  totalMemory = os.totalmem(),
}) {
  const checks = [];
  const instanceDirectory = path.join(instancesRoot, instance.id);
  const instanceStats = await fsp.stat(instanceDirectory).catch(() => null);
  const targetLoaderVersion =
    instance.loaderVersion || instance.installProfile?.loaderVersion;
  const requiresInstall =
    !instance.resolvedVersionId ||
    (targetLoaderVersion &&
      !instance.resolvedVersionId.includes(targetLoaderVersion)) ||
    ["setup", "pack-ready", "error"].includes(instance.status);
  let repairNeeded = false;
  if (
    targetLoaderVersion &&
    instance.resolvedVersionId &&
    !instance.resolvedVersionId.includes(targetLoaderVersion)
  ) {
    repairNeeded = true;
    checks.push({
      code: "loader-version-mismatch",
      status: "warning",
      action: "repair",
      message: `Loader version mismatch: expected ${targetLoaderVersion}, got ${instance.resolvedVersionId}`,
    });
  }

  if (instanceStats?.isDirectory()) {
    try {
      await fsp.access(
        instanceDirectory,
        fs.constants.R_OK | fs.constants.W_OK,
      );
      checks.push({ code: "instance-directory", status: "pass" });
    } catch {
      checks.push({
        code: "instance-directory-readonly",
        status: "error",
        path: instanceDirectory,
      });
    }
  } else if (requiresInstall) {
    checks.push({ code: "instance-directory-pending", status: "pass" });
  } else {
    repairNeeded = true;
    checks.push({
      code: "instance-directory-missing",
      status: "error",
      path: instanceDirectory,
      action: "repair",
    });
  }

  if (instance.resolvedVersionId) {
    const metadata = await readVersionMetadata(
      sharedRoot,
      instance.resolvedVersionId,
    );
    if (!metadata.value) {
      repairNeeded = true;
      checks.push({
        code: "version-metadata-missing",
        status: "error",
        path: metadata.path,
        action: "repair",
      });
    } else {
      checks.push({ code: "version-metadata", status: "pass" });
      const jarId =
        metadata.value.jar ||
        metadata.value.inheritsFrom ||
        instance.resolvedVersionId;
      const clientJar = path.join(
        sharedRoot,
        "versions",
        jarId,
        `${jarId}.jar`,
      );
      const clientStats = await fsp.stat(clientJar).catch(() => null);
      if (!clientStats?.isFile() || clientStats.size === 0) {
        repairNeeded = true;
        checks.push({
          code: "client-jar-missing",
          status: "error",
          path: clientJar,
          action: "repair",
        });
      } else {
        checks.push({ code: "client-jar", status: "pass" });
      }
    }
  } else {
    checks.push({ code: "installation-required", status: "pass" });
  }

  if (instanceStats?.isDirectory()) {
    try {
      const modScan = await scanModsFn(instanceDirectory);
      if (modScan.duplicates.length > 0) {
        checks.push({
          code: "mods-duplicate-ids",
          status: "warning",
          action: "content",
          duplicateCount: modScan.duplicates.length,
          duplicateIds: modScan.duplicates.map((item) => item.id).slice(0, 8),
          duplicateFiles: [
            ...new Set(modScan.duplicates.flatMap((item) => item.files)),
          ].slice(0, 12),
        });
      } else if (modScan.scannedCount > 0) {
        checks.push({
          code: "mods-metadata",
          status: "pass",
          modCount: modScan.scannedCount,
        });
      }
    } catch {
      checks.push({
        code: "mods-scan-unavailable",
        status: "warning",
      });
    }

    // Pre-Flight Doctor: Session lock check
    const rootLock = path.join(instanceDirectory, "session.lock");
    if (fs.existsSync(rootLock)) {
      checks.push({
        code: "orphan-session-lock",
        status: "warning",
        path: rootLock,
        action: "auto",
        message: "A session.lock file is present and may indicate a running or zombie game process",
        autoFix: {
          type: "kill-zombie-process",
          titleKey: "crash.autofix.zombieProcess.title",
          descKey: "crash.autofix.zombieProcess.desc",
          payload: { lockFile: "session.lock" },
        },
      });
    }

    // Pre-Flight Doctor: OptiFine on Fabric without OptiFabric
    const isFabric = String(instance.loader || "").toLowerCase().includes("fabric");
    const modsDir = path.join(instanceDirectory, "mods");
    if (isFabric && fs.existsSync(modsDir)) {
      try {
        const modFiles = await fsp.readdir(modsDir);
        const hasOptifine = modFiles.some((f) => /optifine/i.test(f) && !f.endsWith(".disabled"));
        const hasOptifabric = modFiles.some((f) => /optifabric/i.test(f) && !f.endsWith(".disabled"));
        if (hasOptifine && !hasOptifabric) {
          checks.push({
            code: "optifine-fabric-unsupported",
            status: "error",
            action: "auto",
            message: "OptiFine is installed on Fabric without the required OptiFabric companion mod",
            autoFix: {
              type: "install-optifabric",
              titleKey: "crash.autofix.installOptifabric.title",
              descKey: "crash.autofix.installOptifabric.desc",
              payload: { projectId: "optifabric" },
            },
          });
        }
      } catch {}
    }

    // Pre-Flight Doctor: Corrupted options.txt (NaN in floats)
    const optionsPath = path.join(instanceDirectory, "options.txt");
    if (fs.existsSync(optionsPath)) {
      try {
        const optContent = await fsp.readFile(optionsPath, "utf8");
        if (/gamma:.*NaN|fov:.*NaN/i.test(optContent)) {
          checks.push({
            code: "options-corrupted-values",
            status: "warning",
            path: optionsPath,
            action: "auto",
            message: "options.txt contains corrupted NaN values that will crash window creation",
            autoFix: {
              type: "sanitize-options-txt",
              titleKey: "crash.autofix.sanitizeOptions.title",
              descKey: "crash.autofix.sanitizeOptions.desc",
              payload: { optionsFile: "options.txt" },
            },
          });
        }
      } catch {}
    }

    // Pre-Flight Doctor: Corrupted level.dat with level.dat_old recovery
    const savesDir = path.join(instanceDirectory, "saves");
    if (fs.existsSync(savesDir)) {
      try {
        const worlds = await fsp.readdir(savesDir);
        for (const w of worlds) {
          const lvlDat = path.join(savesDir, w, "level.dat");
          const lvlOld = path.join(savesDir, w, "level.dat_old");
          if (fs.existsSync(lvlDat) && fs.existsSync(lvlOld)) {
            const st = await fsp.stat(lvlDat).catch(() => null);
            if (st && st.size === 0) {
              checks.push({
                code: "corrupted-world-level-dat",
                status: "warning",
                path: lvlDat,
                action: "auto",
                message: `World '${w}' has a truncated 0-byte level.dat with a recoverable backup`,
                autoFix: {
                  type: "restore-corrupted-level-dat",
                  titleKey: "crash.autofix.restoreLevelDat.title",
                  descKey: "crash.autofix.restoreLevelDat.desc",
                  payload: { worldName: w },
                },
              });
            }
          }
        }
      } catch {}
    }

    // Pre-Flight Doctor: Stray vanilla game JAR in mods directory
    if (fs.existsSync(modsDir)) {
      try {
        const modFiles = await fsp.readdir(modsDir);
        const strayGameJar = modFiles.find(
          (f) =>
            f.endsWith(".jar") &&
            !f.endsWith(".disabled") &&
            (/^\d+\.\d+(\.\d+)?\.jar$/i.test(f) ||
             /^(?:minecraft-)?(?:client-|server-)?\d+\.\d+(?:\.\d+)?(?:-client|-server)?\.jar$/i.test(f) ||
             /^client\.jar$/i.test(f) ||
             /^server\.jar$/i.test(f))
        );
        if (strayGameJar) {
          checks.push({
            code: "stray-vanilla-jar-in-mods",
            status: "warning",
            path: path.join(modsDir, strayGameJar),
            action: "auto",
            message: `Stray Minecraft game JAR "${strayGameJar}" detected in mods folder (causes JPMS ResolutionException)`,
            autoFix: {
              type: "remove-vanilla-jar-from-mods",
              titleKey: "crash.autofix.removeVanillaJar.title",
              descKey: "crash.autofix.removeVanillaJar.desc",
              payload: { fileName: strayGameJar },
            },
          });
        }

        // Pre-Flight Doctor: Missing Fabric API companion mod on Fabric
        if (instance.loader === "fabric") {
          const activeJars = modFiles.filter((f) => f.endsWith(".jar") && !f.endsWith(".disabled"));
          const hasFabricApi = activeJars.some((f) => /fabric[-_]api/i.test(f));
          if (!hasFabricApi && activeJars.length > 0) {
            checks.push({
              code: "missing-fabric-api",
              status: "warning",
              action: "auto",
              message: "Fabric API is not installed, but other Fabric mods are present",
              autoFix: {
                type: "install-missing-dependency",
                titleKey: "crash.autofix.installMissingDep.title",
                descKey: "crash.autofix.installMissingDep.desc",
                payload: {
                  depId: "fabric-api",
                  projectId: "fabric-api",
                  depName: "Fabric API",
                },
              },
            });
          }
        }
      } catch {}
    }

    // Pre-Flight Doctor: Corrupted or 0-byte usercache.json
    const usercacheFile = path.join(instanceDirectory, "usercache.json");
    if (fs.existsSync(usercacheFile)) {
      let isCorrupt = false;
      try {
        const st = await fsp.stat(usercacheFile);
        if (st.size === 0) {
          isCorrupt = true;
        } else {
          const raw = await fsp.readFile(usercacheFile, "utf8");
          JSON.parse(raw);
        }
      } catch {
        isCorrupt = true;
      }
      if (isCorrupt) {
        checks.push({
          code: "corrupted-usercache",
          status: "warning",
          path: usercacheFile,
          action: "auto",
          message: "usercache.json is corrupted or truncated (causes JsonSyntaxException during startup)",
          autoFix: {
            type: "clean-corrupted-usercache",
            titleKey: "crash.autofix.cleanUsercache.title",
            descKey: "crash.autofix.cleanUsercache.desc",
            payload: {},
          },
        });
      }
    }

    // Pre-Flight Doctor: Corrupted or 0-byte servers.dat
    const serversDat = path.join(instanceDirectory, "servers.dat");
    if (fs.existsSync(serversDat)) {
      let isCorrupt = false;
      try {
        const st = await fsp.stat(serversDat);
        if (st.size === 0) {
          isCorrupt = true;
        } else if (st.size >= 2) {
          const fd = await fsp.open(serversDat, "r");
          const buf = Buffer.alloc(2);
          await fd.read(buf, 0, 2, 0);
          await fd.close();
          if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
            isCorrupt = true;
          }
        }
      } catch {
        isCorrupt = true;
      }
      if (isCorrupt) {
        checks.push({
          code: "corrupted-servers-dat",
          status: "warning",
          path: serversDat,
          action: "auto",
          message: "servers.dat is corrupted or 0-byte (crashes Minecraft NBT loader)",
          autoFix: {
            type: "repair-servers-dat",
            titleKey: "crash.autofix.repairServersDat.title",
            descKey: "crash.autofix.repairServersDat.desc",
            payload: {},
          },
        });
      }
    }
  }

  const requiredJava =
    instance.javaMajor || requiredJavaForMinecraft(instance.version);

  // Pre-Flight Doctor: Obsolete CMS GC on modern Java or modern GC on Java 8
  const jvmArgs = (instance.settings?.jvmArguments || []).join(" ");
  if (requiredJava >= 14 && /-XX:\+(?:UseConcMarkSweepGC|CMSIncrementalMode|CMSIncrementalPacing|UseParNewGC)/i.test(jvmArgs)) {
    checks.push({
      code: "obsolete-cms-gc",
      status: "warning",
      action: "auto",
      message: "Obsolete CMS GC arguments detected on Java 14+ (crashes with 'Unrecognized VM option')",
      autoFix: {
        type: "sanitize-jvm-gc-flags",
        titleKey: "crash.autofix.sanitizeGcFlags.title",
        descKey: "crash.autofix.sanitizeGcFlags.desc",
        payload: {},
      },
    });
  } else if (requiredJava <= 8 && /-XX:\+(?:UseZGC|UseShenandoahGC)/i.test(jvmArgs)) {
    checks.push({
      code: "incompatible-zgc-java8",
      status: "warning",
      action: "auto",
      message: "Modern GC flags (ZGC/Shenandoah) are incompatible with Java 8",
      autoFix: {
        type: "sanitize-jvm-gc-flags",
        titleKey: "crash.autofix.sanitizeGcFlags.title",
        descKey: "crash.autofix.sanitizeGcFlags.desc",
        payload: {},
      },
    });
  }

  // Pre-Flight Doctor: Linux Wayland GLFW early display freeze on Forge/NeoForge
  if (process.platform === "linux" && ["forge", "neoforge"].includes(instance.loader)) {
    const isWayland = Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland");
    if (isWayland && !jvmArgs.includes("fml.earlydisplay=false")) {
      checks.push({
        code: "wayland-early-display",
        status: "warning",
        action: "auto",
        message: "Forge/NeoForge early display window often freezes or crashes under Linux Wayland",
        autoFix: {
          type: "disable-early-display",
          titleKey: "crash.autofix.disableEarlyDisplay.title",
          descKey: "crash.autofix.disableEarlyDisplay.desc",
          payload: {},
        },
      });
    }
  }

  const preferredJava = settings.javaPath || instance.javaPath || "";
  if (preferredJava) {
    const java = await inspectJavaFn(preferredJava);
    if (!java) {
      checks.push({
        code: "java-stale",
        status: "warning",
        path: preferredJava,
        requiredMajor: requiredJava,
        action: "auto",
      });
    } else if (!compatibleJava(requiredJava, java.major)) {
      checks.push({
        code: "java-incompatible",
        status: "warning",
        path: preferredJava,
        requiredMajor: requiredJava,
        actualMajor: java.major,
        action: settings.javaPath ? "settings" : "auto",
      });
    } else {
      checks.push({
        code: "java",
        status: "pass",
        path: java.executable,
        requiredMajor: requiredJava,
        actualMajor: java.major,
      });
    }
  } else {
    checks.push({
      code: "java-auto",
      status: "pass",
      requiredMajor: requiredJava,
      action: "auto",
    });
  }

  const requestedMemory = Math.max(2, Number(settings.memory) || 2);
  const totalGiB = totalMemory / GIB;
  const safeMaximum = Math.max(2, Math.floor(totalGiB - 2));
  if (requestedMemory > safeMaximum) {
    checks.push({
      code: "memory-impossible",
      status: "error",
      requestedGiB: requestedMemory,
      availableGiB: safeMaximum,
      action: "settings",
    });
  } else if (requestedMemory > totalGiB * 0.75) {
    checks.push({
      code: "memory-high",
      status: "warning",
      requestedGiB: requestedMemory,
      totalGiB: Math.floor(totalGiB),
      action: "settings",
    });
  } else {
    checks.push({
      code: "memory",
      status: "pass",
      requestedGiB: requestedMemory,
      totalGiB: Math.floor(totalGiB),
    });
  }

  const disk = await availableDisk(instancesRoot);
  if (!disk) {
    checks.push({ code: "disk-unknown", status: "warning" });
  } else if (disk.free < 512 * 1024 ** 2) {
    checks.push({
      code: "disk-critical",
      status: "error",
      freeBytes: disk.free,
      action: "settings",
    });
  } else if (disk.free < 2 * GIB) {
    checks.push({
      code: "disk-low",
      status: "warning",
      freeBytes: disk.free,
      action: "settings",
    });
  } else {
    checks.push({
      code: "disk",
      status: "pass",
      freeBytes: disk.free,
    });
  }

  const status = reportStatus(checks, { requiresInstall, repairNeeded });
  const autoFixes = checks.filter((check) => check.autoFix).map((check) => check.autoFix);
  return {
    instanceId: instance.id,
    checkedAt: new Date().toISOString(),
    status,
    canLaunch: status !== "blocked",
    blocker:
      checks.find(
        (check) =>
          check.status === "error" && BLOCKING_CODES.has(check.code),
      )?.code || null,
    requiresInstall,
    repairNeeded,
    checks,
    autoFixes,
    hasDoctorWarnings: autoFixes.length > 0,
  };
}

module.exports = {
  GIB,
  requiredJavaForMinecraft,
  compatibleJava,
  availableDisk,
  readVersionMetadata,
  reportStatus,
  checkInstanceHealth,
};
