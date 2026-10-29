const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const StreamZip = require("node-stream-zip");
const crypto = require("node:crypto");
const { currentLaunchLog } = require("./launch-log.cjs");
const { satisfiesMinecraftVersion } = require("./version-range.cjs");

/**
 * @typedef {'increase-memory' | 'switch-java' | 'install-indium' | 'install-missing-dependency' | 'disable-culprit-mod' | 'remove-duplicate-mod' | 'resolve-mod-conflict' | 'reset-corrupted-config' | 'reset-jvm-args' | 'clean-corrupted-file'} AutoFixType
 *
 * @typedef {Object} CrashAutoFix
 * @property {AutoFixType} type
 * @property {string} titleKey
 * @property {string} descKey
 * @property {Record<string, any>} payload
 */

const KNOWN_DEP_SLUGS = {
  "fabric-api": { slug: "fabric-api", name: "Fabric API" },
  "fabric": { slug: "fabric-api", name: "Fabric API" },
  "fabric-language-kotlin": { slug: "fabric-language-kotlin", name: "Fabric Language Kotlin" },
  "cloth-config": { slug: "cloth-config", name: "Cloth Config" },
  "cloth-config2": { slug: "cloth-config", name: "Cloth Config" },
  "cloth_config": { slug: "cloth-config", name: "Cloth Config" },
  "architectury": { slug: "architectury-api", name: "Architectury API" },
  "architectury-api": { slug: "architectury-api", name: "Architectury API" },
  "yet-another-config-lib": { slug: "yacl", name: "Yet Another Config Lib (YACL)" },
  "yet_another_config_lib": { slug: "yacl", name: "Yet Another Config Lib (YACL)" },
  "yet_another_config_lib_v3": { slug: "yacl", name: "Yet Another Config Lib (YACL)" },
  "yacl": { slug: "yacl", name: "Yet Another Config Lib (YACL)" },
  "pehkui": { slug: "pehkui", name: "Pehkui" },
  "geckolib": { slug: "geckolib", name: "GeckoLib" },
  "citresewn": { slug: "cit-resewn", name: "CIT Resewn" },
  "cit-resewn": { slug: "cit-resewn", name: "CIT Resewn" },
  "indium": { slug: "indium", name: "Indium" },
  "iris": { slug: "iris", name: "Iris Shaders" },
  "sodium": { slug: "sodium", name: "Sodium" },
  "ferritecore": { slug: "ferrite-core", name: "FerriteCore" },
  "modmenu": { slug: "modmenu", name: "Mod Menu" },
  "appleskin": { slug: "appleskin", name: "AppleSkin" },
  "kotlinforforge": { slug: "kotlin-for-forge", name: "Kotlin for Forge" },
  "balm": { slug: "balm", name: "Balm" },
  "balm-fabric": { slug: "balm", name: "Balm" },
  "puzzleslib": { slug: "puzzles-lib", name: "Puzzles Lib" },
  "collective": { slug: "collective", name: "Collective" },
  "curios": { slug: "curios", name: "Curios API" },
  "trinkets": { slug: "trinkets", name: "Trinkets" },
  "cardinal-components": { slug: "cardinal-components-api", name: "Cardinal Components API" },
  "cardinal-components-base": { slug: "cardinal-components-api", name: "Cardinal Components API" },
};

/**
 * Inspects a JAR file's internal manifests (fabric.mod.json, quilt.mod.json, mods.toml, mcmod.info)
 * without extracting the entire archive.
 */
async function inspectJarMetadata(jarPath) {
  let zip;
  try {
    zip = new StreamZip.async({ file: jarPath });
    const entries = await zip.entries();
    let modId = null;
    let name = null;
    let version = null;
    let loader = null;
    let mcVersionRange = null;

    if (entries["fabric.mod.json"]) {
      loader = "fabric";
      try {
        const data = await zip.entryData("fabric.mod.json");
        const json = JSON.parse(data.toString("utf8"));
        modId = json.id;
        name = json.name || json.id;
        version = json.version || null;
        mcVersionRange = json.depends?.minecraft || null;
      } catch {}
    } else if (entries["quilt.mod.json"]) {
      loader = "quilt";
      try {
        const data = await zip.entryData("quilt.mod.json");
        const json = JSON.parse(data.toString("utf8"));
        modId = json.quilt_loader?.id;
        name = json.quilt_loader?.metadata?.name || modId;
        version = json.quilt_loader?.version || null;
        const mcDep = json.quilt_loader?.depends?.find(
          (d) => d.id === "minecraft" || (typeof d === "string" && d === "minecraft"),
        );
        mcVersionRange = mcDep ? (mcDep.versions || mcDep) : null;
      } catch {}
    } else if (entries["META-INF/neoforge.mods.toml"]) {
      loader = "neoforge";
      try {
        const data = await zip.entryData("META-INF/neoforge.mods.toml");
        const tomlText = data.toString("utf8");
        const modIdMatch = tomlText.match(/modId\s*=\s*["']([^"']+)["']/);
        modId = modIdMatch ? modIdMatch[1] : null;
        const minecraftDependency = tomlText.split(/(?=^\s*\[\[dependencies\.)/m).find((section) => /^\s*\[\[dependencies\./m.test(section) && /modId\s*=\s*["']minecraft["']/.test(section));
        const verMatch = minecraftDependency?.match(/versionRange\s*=\s*["']([^"']+)["']/);
        mcVersionRange = verMatch ? verMatch[1] : null;
        const versionMatch = tomlText.match(/version\s*=\s*["']([^"']+)["']/);
        version = versionMatch ? versionMatch[1] : null;
      } catch {}
    } else if (entries["META-INF/mods.toml"]) {
      loader = "forge";
      try {
        const data = await zip.entryData("META-INF/mods.toml");
        const tomlText = data.toString("utf8");
        const modIdMatch = tomlText.match(/modId\s*=\s*["']([^"']+)["']/);
        modId = modIdMatch ? modIdMatch[1] : null;
        const minecraftDependency = tomlText.split(/(?=^\s*\[\[dependencies\.)/m).find((section) => /^\s*\[\[dependencies\./m.test(section) && /modId\s*=\s*["']minecraft["']/.test(section));
        const verMatch = minecraftDependency?.match(/versionRange\s*=\s*["']([^"']+)["']/);
        mcVersionRange = verMatch ? verMatch[1] : null;
        const versionMatch = tomlText.match(/version\s*=\s*["']([^"']+)["']/);
        version = versionMatch ? versionMatch[1] : null;
      } catch {}
    } else if (entries["mcmod.info"]) {
      loader = "forge";
      try {
        const data = await zip.entryData("mcmod.info");
        const json = JSON.parse(data.toString("utf8"));
        const info = Array.isArray(json) ? json[0] : (json.modList?.[0] || json);
        modId = info.modid;
        name = info.name;
        version = info.version || null;
        mcVersionRange = info.mcversion;
      } catch {}
    }

    return {
      fileName: path.basename(jarPath),
      jarPath,
      modId,
      name,
      version,
      loader,
      mcVersionRange,
      mixinConfigs: Object.keys(entries).filter((name) => /mixins?\.json$/i.test(name)),
      supportedLoaders: [
        entries["fabric.mod.json"] && "fabric",
        entries["quilt.mod.json"] && "quilt",
        entries["META-INF/mods.toml"] && "forge",
        entries["META-INF/neoforge.mods.toml"] && "neoforge",
      ].filter(Boolean),
      corrupted: false,
    };
  } catch (err) {
    if (["ENOENT", "EACCES", "EPERM", "EISDIR"].includes(err.code)) return { fileName: path.basename(jarPath), jarPath, corrupted: false, unreadable: true, error: err.message };
    return {
      fileName: path.basename(jarPath),
      jarPath,
      corrupted: true,
      error: err.message,
    };
  } finally {
    if (zip) {
      await zip.close().catch(() => {});
    }
  }
}

/**
 * Checks whether an inspected mod is compatible with the target instance loader & Minecraft version.
 */
function checkModCompatibility(modMeta, instance) {
  if (modMeta.corrupted) {
    return {
      incompatible: true,
      reason: "corrupted",
    };
  }

  const instLoader = String(instance.installProfile?.loader || instance.loader || "").trim().split(/\s+/)[0].toLowerCase();
  const instVersion = instance.version || instance.installProfile?.minecraftVersion || "";

  const supported = modMeta.supportedLoaders?.length ? modMeta.supportedLoaders : [modMeta.loader].filter(Boolean);
  const compatibleLoader = supported.includes(instLoader) ||
    (instLoader === "quilt" && supported.includes("fabric")) ||
    (instLoader === "neoforge" && instVersion === "1.20.1" && supported.includes("forge"));
  if (supported.length && instLoader && !compatibleLoader) {
    return { incompatible: true, reason: "loader-mismatch", modLoader: ({ fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" })[modMeta.loader] || modMeta.loader, instanceLoader: ({ fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" })[instLoader] || instLoader };
  }
  // Unsupported constraints are inconclusive and must never disable a mod.
  if (modMeta.mcVersionRange && instVersion &&
      !(supported.length > 1 && modMeta.loader !== instLoader) &&
      satisfiesMinecraftVersion(instVersion, modMeta.mcVersionRange) === false) {
    return {
      incompatible: true,
      reason: "version-mismatch",
      modVersion: String(modMeta.mcVersionRange),
      instanceVersion: instVersion,
    };
  }

  return { incompatible: false };
}

function parseFabricRequirement(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/requires (any version|version ([0-9.]+)( or later)?) of (.+?), (which is missing|but only the wrong version)/i);
    if (!match) continue;
    const id = match[4].match(/\(([a-z0-9_.-]+)\)\s*$/i)?.[1] || match[4].match(/^(?:mod )?['"]?([a-z0-9_.-]+)['"]?$/i)?.[1];
    if (!id) continue;
    return { id: id.toLowerCase(), missing: /which is missing/i.test(match[5]), range: match[2] ? `${match[3] ? ">=" : "="}${match[2]}` : null };
  }
  return null;
}

/**
 * Inspects Minecraft crash logs, crash reports, instance metadata, and installed mods
 * to formulate an actionable 1-click fix proposal.
 */
async function detectCrashAutoFix({
  instance = {},
  logContent = "",
  crashReport = null,
  instancesRoot = null,
  systemTotalRamMb = null,
  platform = process.platform,
}) {
  const text = currentLaunchLog(logContent).slice(-500_000);
  const crashText = crashReport ? `${crashReport.errorTitle || ""}\n${crashReport.stackTrace || ""}` : "";
  const combined = `${text}\n${crashText}`;

  // 1. Out of Memory Error (OOM)
  if (
    /OutOfMemoryError:\s*(?:Java heap space|GC overhead limit exceeded)|Java heap space|GC overhead limit exceeded/i.test(combined)
  ) {
    const currentMemory = Number(instance.settings?.memory) || 4;
    const totalRamMb = systemTotalRamMb || Math.floor(os.totalmem() / (1024 * 1024));
    const totalSystemGb = Math.floor(totalRamMb / 1024);
    const maxSafeGb = Math.max(0, totalSystemGb - 2);

    let targetGb = currentMemory + 2;
    if (currentMemory < 6 && maxSafeGb >= 6) {
      targetGb = 6;
    } else if (targetGb > maxSafeGb) {
      targetGb = maxSafeGb;
    }

    if (targetGb > currentMemory) {
      return {
        type: "increase-memory",
        titleKey: "crash.autofix.increaseMemory.title",
        descKey: "crash.autofix.increaseMemory.desc",
        payload: {
          currentMemoryGiB: currentMemory,
          targetMemoryGiB: targetGb,
        },
      };
    }
  }

  // 2. Missing Indium for Sodium / Fabric rendering crash
  if (
    /IndiumException|requires indium|Indium is required|Sodium has replaced the default block\/fluid renderer|requires: \{indium/i.test(combined)
  ) {
    return {
      type: "install-indium",
      titleKey: "crash.autofix.installIndium.title",
      descKey: "crash.autofix.installIndium.desc",
      payload: {
        projectId: "indium",
        modName: "Indium",
      },
    };
  }

  // 3. Java Version Mismatch (UnsupportedClassVersionError)
  const javaVersionMatch = combined.match(/UnsupportedClassVersionError[\s\S]*?compiled[\s\S]*?class file version (\d+)\.\d+/i);
  if (javaVersionMatch) {
    const requiredMajor = Number(javaVersionMatch[1]) - 44;
    if (requiredMajor >= 8 && requiredMajor <= 99) {
      return { type: "switch-java", titleKey: "crash.autofix.switchJava.title", descKey: "crash.autofix.switchJava.desc", payload: { requiredJavaMajor: requiredMajor } };
    }
  }
  // Check for MC 1.20.5+ running on older Java (requires Java 21)
  const mcVersion = instance.version || instance.installProfile?.minecraftVersion || "";
  const isMc21Required = /^1\.(?:20\.[5-9]|2[1-9])/.test(mcVersion);
  if (isMc21Required && /class file version 65\.0|Java 21 is required/i.test(combined)) {
    return {
      type: "switch-java",
      titleKey: "crash.autofix.switchJava.title",
      descKey: "crash.autofix.switchJava.desc",
      payload: {
        requiredJavaMajor: 21,
      },
    };
  }

  // 4a. Obsolete or Incompatible JVM GC Flags (sanitize instead of full reset)
  if (
    /Unrecognized VM option '(?:UseConcMarkSweepGC|CMSIncrementalMode|CMSIncrementalPacing|UseParNewGC|UseZGC|UseShenandoahGC)'|Option UseConcMarkSweepGC was removed in version 14\.0/i.test(
      combined,
    )
  ) {
    return {
      type: "sanitize-jvm-gc-flags",
      titleKey: "crash.autofix.sanitizeGcFlags.title",
      descKey: "crash.autofix.sanitizeGcFlags.desc",
      payload: { rejectedFlag: combined.match(/Unrecognized VM option ['"]([A-Za-z0-9]+)['"]/i)?.[1] || "UseConcMarkSweepGC" },
    };
  }

  // 4b. Bad JVM Arguments
  if (
    /Unrecognized VM option|Could not create the Java Virtual Machine|Invalid maximum heap size|Improperly specified VM option/i.test(combined)
  ) {
    return {
      type: "reset-jvm-args",
      titleKey: "crash.autofix.resetJvmArgs.title",
      descKey: "crash.autofix.resetJvmArgs.desc",
      payload: {},
    };
  }

  if (/servers\.dat[^\r\n]*(?:EOFException|ZipException|corrupt|failed|invalid)|Failed to load servers\s*:/i.test(combined)) {
    return { type: "repair-servers-dat", titleKey: "crash.autofix.repairServersDat.title", descKey: "crash.autofix.repairServersDat.desc", payload: {} };
  }
  const cacheError = /JsonSyntaxException|MalformedJsonException|JsonParseException|EOFException|Failed to load user cache/i.test(combined);
  if (cacheError && /usercache\.json|UserCache\.load|Failed to load user cache|realms_persistence\.json/i.test(combined)) {
    const cacheFile = /realms_persistence\.json/i.test(combined) && !/usercache\.json|UserCache\.load|Failed to load user cache/i.test(combined)
      ? "realms_persistence.json" : "usercache.json";
    return { type: "clean-corrupted-usercache", titleKey: "crash.autofix.cleanUsercache.title", descKey: "crash.autofix.cleanUsercache.desc", payload: { cacheFile } };
  }

  // 5. Corrupted Archive or ZIP Header detected in log
  if (
    /zip END header not found|invalid (?:LOC|CEN) header|zip file is empty|ZipException/i.test(combined)
  ) {
    const errorLines = combined.split(/\r?\n/);
    const errorIndex = errorLines.findIndex((line) => /zip END header not found|invalid (?:LOC|CEN) header|zip file is empty|ZipException/i.test(line));
    const context = errorLines.slice(errorIndex, errorIndex + 8).join("\n");
    const candidates = [...new Set([...context.matchAll(/(?:^|[\s/\\:])([a-zA-Z0-9_\-+.]+\.jar)\b/g)].map((match) => match[1]))];
    if (candidates.length !== 1) return null;
    const fileName = candidates[0];
    if (instancesRoot && instance.id) {
      const target = await optionalFile(instancesRoot, instance.id, path.join("mods", fileName));
      if (!target) return null;
      const meta = await inspectJarMetadata(target);
      if (!meta.corrupted) return null;
    }
    return {
      type: "clean-corrupted-file",
      titleKey: "crash.autofix.cleanCorruptFile.title",
      descKey: "crash.autofix.cleanCorruptFile.desc",
      payload: {
        fileName,
      },
    };
  }

  const fabricRequirement = parseFabricRequirement(combined);
  if (fabricRequirement && ["fabricloader", "quilt_loader", "neoforge", "forge"].includes(fabricRequirement.id)) {
    const minimum = fabricRequirement.range?.match(/^(?:>=|=)([0-9]+(?:\.[0-9]+)+)$/)?.[1];
    if (minimum) return { type: "upgrade-loader-version", titleKey: "crash.autofix.upgradeLoader.title", descKey: "crash.autofix.upgradeLoader.desc", payload: { loader: instance.loader, requiredVersion: minimum, currentVersion: instance.loaderVersion || "unknown" } };
  }
  // 6. Missing Mod Dependency (Fabric API, Kotlin, Cloth Config, Architectury, etc.)
  const missingDepMatch =
    (fabricRequirement?.missing ? [null, fabricRequirement.id] : null) ||
    combined.match(/(?:Mod\s+'[^']+'\s+)?requires\s*\{([a-z0-9_\-+.]+)(?:\s*@\s*[^}]+)?\},\s*which is missing/i) ||
    combined.match(/requires\s*\{([a-z0-9_\-+.]+)(?:\s*@\s*[^}]+)?\},\s*which is missing/i) ||
    combined.match(/Mod\s+'[^']+'\s+requires\s+([a-z0-9_\-+.]+),\s+which is missing/i) ||
    combined.match(/Unmet dependency:\s*mod\s+'[^']+'\s+requires\s+([a-z0-9_\-+.]+)/i) ||
    combined.match(/A potential solution has been determined:\s*(?:\n|\r\n)\s*-\s*Install\s+([a-z0-9_\-+.]+)/i) ||
    combined.match(/Missing or unsupported mandatory dependencies:\s*(?:[\s\S]*?)\s*Mod ID:\s*'([a-z0-9_\-+.]+)'/i) ||
    combined.match(/Mod\s+[a-zA-Z0-9_\-+.]+\s+requires\s+([a-z0-9_\-+.]+)(?:\s+[0-9.]+)?\s+or above[\s\S]*?Currently,?\s*(?:\1\s+)?is not installed/i) ||
    combined.match(/requires\s+([a-z0-9_\-+.]+)(?:\s+[0-9.]+)?\s+or above[\s\S]*?Currently,?\s*(?:\1\s+)?is not installed/i) ||
    combined.match(/Failure message:\s*Mod\s+[a-zA-Z0-9_\-+.]+\s+requires\s+([a-z0-9_\-+.]+)/i);

  if (missingDepMatch) {
    const rawDepId = (missingDepMatch[1] || missingDepMatch[2] || "").trim().toLowerCase();
    if (rawDepId && !["minecraft", "java", "forge", "fabricloader", "quilt_loader", "neoforge"].includes(rawDepId)) {
      let known = KNOWN_DEP_SLUGS[rawDepId];
      if (!known && (rawDepId.startsWith("fabric-") || rawDepId === "fabric-api-base")) {
        known = { slug: "fabric-api", name: "Fabric API" };
      }
      const projectId = known ? known.slug : rawDepId;
      const depName = known ? known.name : rawDepId;

      return {
        type: "install-missing-dependency",
        titleKey: "crash.autofix.installMissingDep.title",
        descKey: "crash.autofix.installMissingDep.desc",
        payload: {
          depId: rawDepId,
          projectId,
          depName,
          ...(fabricRequirement?.range ? { versionRange: fabricRequirement.range } : {}),
        },
      };
    }
  }

  // 7. Corrupted Config File (MalformedJsonException / ParsingException / ConfigException)
  const isConfigCrash =
    /JsonSyntaxException|MalformedJsonException|ParsingException|ConfigException|Failed to load config|Error parsing config/i.test(
      combined,
    );

  if (isConfigCrash && instancesRoot && instance.id) {
    const instanceDir = path.join(instancesRoot, instance.id);
    const lines = combined.split(/\r?\n/);
    const contexts = lines.flatMap((line, index) => /JsonSyntaxException|MalformedJsonException|ParsingException|ConfigException|Failed to load config|Error parsing config/i.test(line)
      ? [lines.slice(index, index + 5).join("\n")] : []);
    const paths = [...new Set(contexts.flatMap((context) => [...context.matchAll(/config[\\/]([^\r\n'"\s]+\.(?:json5?|toml|ya?ml|cfg|ini))/gi)].map((match) => match[1])))];
    const configPathMatch = paths.length === 1 ? [null, paths[0]] : null;

    if (configPathMatch && configPathMatch[1]) {
      const relConfig = configPathMatch[1].replaceAll("\\", "/").replace(/^\/+/, "");
      if (relConfig.split("/").includes("..")) return null;
      const candidatePaths = [
        path.join(instanceDir, "config", relConfig),
      ];

      for (const cand of candidatePaths) {
        if (fs.existsSync(cand)) {
          if (cand.endsWith(".json")) {
            try { JSON.parse(await fsp.readFile(cand, "utf8")); return null; }
            catch (error) { if (!(error instanceof SyntaxError)) throw error; }
          }
          const relDisplay = path.relative(instanceDir, cand).replace(/\\/g, "/");
          return {
            type: "reset-corrupted-config",
            titleKey: "crash.autofix.resetConfig.title",
            descKey: "crash.autofix.resetConfig.desc",
            payload: {
              configFile: relDisplay,
              fullPath: cand,
            },
          };
        }
      }
    }
  }

  // 8. Mutually Exclusive Mod Conflicts (OptiFine + Sodium/Iris, Phosphor + Starlight)
  if (instancesRoot && instance.id) {
    const modsDir = path.join(instancesRoot, instance.id, "mods");
    if (fs.existsSync(modsDir)) {
      try {
        const files = await fsp.readdir(modsDir);
        const activeJars = files.filter((f) => f.endsWith(".jar") && !f.endsWith(".disabled"));

        const optifineJar = activeJars.find((f) => /optifine|optifabric/i.test(f));
        const sodiumJar = activeJars.find((f) => /sodium|iris|rubidium|embeddium/i.test(f));

        if (optifineJar && sodiumJar) {
          return {
            type: "resolve-mod-conflict",
            titleKey: "crash.autofix.resolveConflict.title",
            descKey: "crash.autofix.resolveConflict.desc",
            payload: {
              conflictingMod: optifineJar,
              incompatibleWith: sodiumJar,
              conflictReason: "rendering-pipeline",
            },
          };
        }

        const phosphorJar = activeJars.find((f) => /phosphor/i.test(f));
        const starlightJar = activeJars.find((f) => /starlight/i.test(f));
        if (phosphorJar && starlightJar) {
          return {
            type: "resolve-mod-conflict",
            titleKey: "crash.autofix.resolveConflict.title",
            descKey: "crash.autofix.resolveConflict.desc",
            payload: {
              conflictingMod: phosphorJar,
              incompatibleWith: starlightJar,
              conflictReason: "light-engine",
            },
          };
        }
      } catch {}
    }
  }

  // 9. Duplicate Mods from log
  const duplicateMatch =
    combined.match(/DuplicateModsFoundException:.*?\[([^\]]+)\]/i) ||
    combined.match(/Duplicate mods found:?\s*([a-zA-Z0-9_\-+.]+)/i) ||
    combined.match(/Duplicate mod ID:?\s*'([a-z0-9_\-+.]+)'/i);

  if (duplicateMatch && instancesRoot && instance.id) {
    const modsDir = path.join(instancesRoot, instance.id, "mods");
    if (fs.existsSync(modsDir)) {
      try {
        const files = await fsp.readdir(modsDir);
        const activeJars = files.filter((f) => f.endsWith(".jar") && !f.endsWith(".disabled"));
        const rawName = duplicateMatch[1].trim();
        const inspected = await Promise.all(activeJars.map(async (file) => ({ file, metadata: await inspectJarMetadata(path.join(modsDir, file)) })));
        const matches = inspected.filter(({ metadata }) => metadata.modId === rawName).map(({ file }) => file);
        if (matches.length >= 2) {
          const copyFile = matches.find((f) => /\(\d+\)|_copy|-copy/i.test(f));
          const disableFile = copyFile || matches[1];
          const keepFile = matches.find((f) => f !== disableFile) || matches[0];

          return {
            type: "remove-duplicate-mod",
            titleKey: "crash.autofix.removeDuplicateMod.title",
            descKey: "crash.autofix.removeDuplicateMod.desc",
            payload: {
              modId: rawName,
              keepFile,
              disableFile,
            },
          };
        }
      } catch {}
    }
  }

  // 9.5. Stray Vanilla Game JAR in mods folder (causes JPMS ResolutionException failTwoSuppliers on NeoForge/Forge)
  const isSplitPackageCrash =
    /ResolutionException:\s*Modules\s+(_[0-9_.]+|[a-zA-Z0-9_.]+)\s+and\s+minecraft\s+export package/i.test(combined) ||
    /Modules\s+(_[0-9_.]+|[a-zA-Z0-9_.]+)\s+and\s+minecraft\s+export package/i.test(combined);

  if ((isSplitPackageCrash || (instancesRoot && instance.id)) && instancesRoot && instance.id) {
    const modsDir = path.join(instancesRoot, instance.id, "mods");
    if (fs.existsSync(modsDir)) {
      try {
        const files = await fsp.readdir(modsDir);
        const strayVanillaJar = files.find(
          (f) =>
            f.endsWith(".jar") &&
            !f.endsWith(".disabled") &&
            (/^\d+\.\d+(\.\d+)?\.jar$/i.test(f) ||
             /^(?:minecraft-)?(?:client-|server-)?\d+\.\d+(?:\.\d+)?(?:-client|-server)?\.jar$/i.test(f) ||
             /^client\.jar$/i.test(f) ||
             /^server\.jar$/i.test(f))
        );

        if (strayVanillaJar || isSplitPackageCrash) {
          const splitMatch = combined.match(/Modules\s+(_[0-9_.]+|[a-zA-Z0-9_.]+)\s+and\s+minecraft\s+export package/i);
          let targetFile = strayVanillaJar;
          if (!targetFile && splitMatch && splitMatch[1]) {
            const rawModName = splitMatch[1].replace(/^_/, "").replace(/\._/g, ".");
            targetFile = files.find((f) => f.toLowerCase().includes(rawModName.toLowerCase())) || `${rawModName}.jar`;
          }

          if (targetFile) {
            return {
              type: "remove-vanilla-jar-from-mods",
              titleKey: "crash.autofix.removeVanillaJar.title",
              descKey: "crash.autofix.removeVanillaJar.desc",
              payload: {
                fileName: targetFile,
              },
            };
          }
        }
      } catch {}
    }
  }

  // 10. Deep JAR inspection in instance mods folder (unpacking manifests to check version & loader & duplicates)
  if (instancesRoot && instance.id) {
    const modsDir = path.join(instancesRoot, instance.id, "mods");
    if (fs.existsSync(modsDir)) {
      try {
        const files = await fsp.readdir(modsDir);
        const jarFiles = files.filter(
          (f) => f.endsWith(".jar") && !f.endsWith(".disabled")
        );

        const seenModIds = new Map();

        for (const file of jarFiles) {
          const fullPath = path.join(modsDir, file);
          const meta = await inspectJarMetadata(fullPath);

          if (meta.corrupted) {
            return {
              type: "clean-corrupted-file",
              titleKey: "crash.autofix.cleanCorruptFile.title",
              descKey: "crash.autofix.cleanCorruptFile.desc",
              payload: {
                fileName: file,
              },
            };
          }

          // Check duplicate mod IDs inside mods folder
          if (meta.modId && meta.modId !== "minecraft") {
            if (seenModIds.has(meta.modId)) {
              const prevFile = seenModIds.get(meta.modId);
              const isCopy = /\(\d+\)|_copy|-copy/i.test(file);
              const disableFile = isCopy ? file : prevFile;
              const keepFile = disableFile === file ? prevFile : file;

              return {
                type: "remove-duplicate-mod",
                titleKey: "crash.autofix.removeDuplicateMod.title",
                descKey: "crash.autofix.removeDuplicateMod.desc",
                payload: {
                  modId: meta.modId,
                  keepFile,
                  disableFile,
                },
              };
            }
            seenModIds.set(meta.modId, file);
          }

          const compat = checkModCompatibility(meta, instance);
          if (compat.incompatible) {
            if (compat.reason === "loader-mismatch") {
              return {
                type: "disable-culprit-mod",
                titleKey: "crash.autofix.incompatibleLoader.title",
                descKey: "crash.autofix.incompatibleLoader.desc",
                payload: {
                  mod: file,
                  modFileName: file,
                  modLoader: compat.modLoader,
                  instanceLoader: compat.instanceLoader,
                },
              };
            }
            if (compat.reason === "version-mismatch") {
              return {
                type: "disable-culprit-mod",
                titleKey: "crash.autofix.incompatibleVersion.title",
                descKey: "crash.autofix.incompatibleVersion.desc",
                payload: {
                  mod: file,
                  modFileName: file,
                  modVersion: compat.modVersion,
                  instanceVersion: compat.instanceVersion,
                },
              };
            }
          }
        }
      } catch {}
    }
  }

  // 11. Culprit Mod from crash report
  if (crashReport && crashReport.suspectedCulprit) {
    const culprit = crashReport.suspectedCulprit;
    if (!culprit.includes("onyx-fps-agent") && culprit.endsWith(".jar") && path.basename(culprit) === culprit) {
      const finalName = culprit.endsWith(".jar") ? culprit : `${culprit}.jar`;
      return {
        type: "disable-culprit-mod",
        titleKey: "crash.autofix.disableMod.title",
        descKey: "crash.autofix.disableMod.desc",
        payload: {
          mod: finalName,
          modFileName: finalName,
        },
      };
    }
  }

  // 12. disable-active-shaderpack
  if (/Program link failed|Composite shader error|Failed to link program|ShaderCompileError|shader compilation (?:failed|error)/i.test(combined)) {
    return {
      type: "disable-active-shaderpack",
      titleKey: "crash.autofix.disableShaderpack.title",
      descKey: "crash.autofix.disableShaderpack.desc",
      payload: { shaderpack: "active" },
    };
  }

  // 12b. disable-early-display (Forge/NeoForge early splash display freeze on Wayland / hybrid graphics)
  if (
    /Failed to initialize EarlyDisplay: java\.lang\.IllegalStateException: GLFW error|net\.minecraftforge\.fml\.earlydisplay\.DisplayWindow|neoforge\.earlydisplay|fml\.earlydisplay/i.test(
      combined,
    )
  ) {
    return {
      type: "disable-early-display",
      titleKey: "crash.autofix.disableEarlyDisplay.title",
      descKey: "crash.autofix.disableEarlyDisplay.desc",
      payload: {},
    };
  }

  // 13. apply-wayland-fix (check before generic OpenGL so Wayland GLX context crashes are correctly routed)
  if (platform === "linux" && /wayland/i.test(combined) && /GLFW|GLX|context/i.test(combined)) {
    return null;
  }

  // 14. repair-opengl-context
  if (/GLFW error 65542|The driver does not appear to support OpenGL|Pixel format not accelerated|GLX: Failed to create context|WGL:.+OpenGL/i.test(combined)) {
    return null;
  }

  // 15. reset-video-options
  if (/Display\.create|BadWindow|X Error of failed request.*BadWindow|Failed to find window|display initialization|overrideWidth|overrideHeight.*invalid/i.test(combined)) {
    return {
      type: "reset-video-options",
      titleKey: "crash.autofix.resetVideo.title",
      descKey: "crash.autofix.resetVideo.desc",
      payload: { optionsFile: "options.txt" },
    };
  }

  // 16. disable-active-resourcepacks
  if (/TextureAtlasException|Stitching.*atlas|OutOfMemoryError.*(?:texture|atlas|stitch)|ResourcePack.*overflow/i.test(combined)) {
    return {
      type: "disable-active-resourcepacks",
      titleKey: "crash.autofix.disableResourcepacks.title",
      descKey: "crash.autofix.disableResourcepacks.desc",
      payload: { optionsFile: "options.txt" },
    };
  }

  // 17. upgrade-loader-version
  const loaderMatch = combined.match(/requires fabricloader >=([0-9.]+)|requires neoforge >=([0-9.]+)|requires quilt_loader >=([0-9.]+)|Mod requires loader version/i);
  if (loaderMatch) {
    const requiredVersion = loaderMatch[1] || loaderMatch[2] || loaderMatch[3];
    if (!requiredVersion) return null;
    return {
      type: "upgrade-loader-version",
      titleKey: "crash.autofix.upgradeLoader.title",
      descKey: "crash.autofix.upgradeLoader.desc",
      payload: {
        loader: instance.loader,
        requiredVersion,
        currentVersion: instance.loaderVersion || "unknown",
      },
    };
  }

  // 18. switch-arm64-java
  if (process.platform === "darwin" && /UnsatisfiedLinkError.*incompatible architecture.*(?:have x86_64.*need arm64|have \(x86_64\))/i.test(combined)) {
    return null;
  }

  // 19. inject-java-module-flags
  if (/InaccessibleObjectException|Unable to make.*accessible|module java\.base does not.*opens|--add-opens.*required/i.test(combined)) {
    return {
      type: "inject-java-module-flags",
      titleKey: "crash.autofix.injectModuleFlags.title",
      descKey: "crash.autofix.injectModuleFlags.desc",
      payload: { flagCount: 4 },
    };
  }

  // 20. install-openjfx
  if (/NoClassDefFoundError.*javafx|ClassNotFoundException.*javafx|Missing JavaFX|javafx.*not found/i.test(combined)) {
    return null;
  }

  // 21. enable-forge-entity-removal
  if (/NullPointerException.*Ticking entity|Ticking block entity|ConcurrentModificationException.*entity|Erroring entity/i.test(combined)) {
    const loader = String(instance.installProfile?.loader || instance.loader || "").split(/\s+/)[0].toLowerCase();
    if (!["forge", "neoforge"].includes(loader) || !instancesRoot || !instance.id) return null;
    const world = combined.match(/saves[\\/]([^\\/\r\n]+)[\\/]/)?.[1];
    const candidates = ["config/forge.cfg", ...(world && ![".", ".."].includes(world) ? [`saves/${world}/serverconfig/${loader}-server.toml`] : [])];
    for (const configFile of candidates) {
      const target = await optionalFile(instancesRoot, instance.id, configFile);
      if (!target) continue;
      const content = await fsp.readFile(target, "utf8");
      if (!/removeErroringEntities/.test(content) || !/removeErroringTileEntities/.test(content)) continue;
      if (!/removeErroring(?:Tile)?Entities\s*=\s*false/i.test(content)) continue;
      return { type: "enable-forge-entity-removal", titleKey: "crash.autofix.entityRemoval.title", descKey: "crash.autofix.entityRemoval.desc", payload: { loader, configFile } };
    }
    return null;
  }

  // 22. quarantine-playerdata
  if (/Failed to load player data|playerdata[\\/].*?\.dat.*?(?:corrupt|invalid|ClassCastException)/i.test(combined)) {
    const uuidMatch = combined.match(/playerdata[\\/]([a-f0-9-]+)\.dat/i) || combined.match(/UUID\s+([a-f0-9-]+)/i);
    if (!uuidMatch || !/^[a-f0-9-]{32,36}$/i.test(uuidMatch[1])) return null;
    return {
      type: "quarantine-playerdata",
      titleKey: "crash.autofix.quarantinePlayer.title",
      descKey: "crash.autofix.quarantinePlayer.desc",
      payload: { uuid: uuidMatch ? uuidMatch[1] : null },
    };
  }

  // 23. restore-world-snapshot
  if (/Already decorating|cascading worldgen|chunk generation crash|CrashedException.*worldgen|StackOverflowError.*(?:generate|decorator)/i.test(combined)) {
    return null;
  }

  // 24. kill-zombie-process
  if (/FileAlreadyExistsException|AccessDeniedException.*session\.lock|AccessDeniedException.*latest\.log|EBUSY.*session\.lock|locked by another process/i.test(combined)) {
    return null;
  }

  // 25. repair-instance-assets
  if (/FileNotFoundException.*assets[\\/]|hash mismatch.*client\.jar|Missing asset|assets[\\/].*index.*not found|libraries[\\/].*not found/i.test(combined)) {
    return {
      type: "repair-instance-assets",
      titleKey: "crash.autofix.repairAssets.title",
      descKey: "crash.autofix.repairAssets.desc",
      payload: { repair: true },
    };
  }

  // 26. cleanup-temp-install-files
  if (/\.jar\.tmp|\.(?:scope-download|part|download).*?(?:exists|found|incomplete|stale)/i.test(combined)) {
    return {
      type: "cleanup-temp-install-files",
      titleKey: "crash.autofix.cleanupTemp.title",
      descKey: "crash.autofix.cleanupTemp.desc",
      payload: { cleanedCount: 1 },
    };
  }

  // 27. reconcile-modpack-manifest
  if (/modpack.*?incompatib|untracked mod|rogue mod|modpack update.*?conflict|modpack.*?version mismatch/i.test(combined)) {
    return null;
  }

  // 28. disable-environment-mismatched-mod
  if (/NoClassDefFoundError.*?net\/minecraft\/client\/Minecraft|Attempted to load class.*?net\/minecraft\/client.*?on a dedicated server|DedicatedServer.*?environment mismatch/i.test(combined)) {
    return null;
  }

  // 29. restore-corrupted-level-dat
  if (/Failed to read level\.dat|EOFException.*level\.dat|CompressedStreamTools.*level\.dat|Corrupt level\.dat/i.test(combined)) {
    const worldMatch = combined.match(/saves[\\/]([^\\/\r\n]+)[\\/]level\.dat/i);
    if (!worldMatch) return null;
    return {
      type: "restore-corrupted-level-dat",
      titleKey: "crash.autofix.restoreLevelDat.title",
      descKey: "crash.autofix.restoreLevelDat.desc",
      payload: { worldName: worldMatch ? worldMatch[1].trim() : null },
    };
  }

  // 30. resolve-mixin-overwrite
  if (/MixinTransformerError.*Critical injection failure|Cannot apply @Overwrite on target|failed injection check.*mixins?\.json/i.test(combined)) {
    const mixinMatch = combined.match(/([a-zA-Z0-9_\-+.]+)\.mixins?\.json/i);
    if (!mixinMatch || !instancesRoot || !instance.id) return null;
    const owner = await findMixinOwner(instancesRoot, instance.id, mixinMatch[1]);
    if (!owner) return null;
    return {
      type: "resolve-mixin-overwrite",
      titleKey: "crash.autofix.mixinOverwrite.title",
      descKey: "crash.autofix.mixinOverwrite.desc",
      payload: { mixinName: mixinMatch[1], modFileName: owner },
    };
  }

  // 31. sanitize-options-txt
  if (/NumberFormatException.*For input string: "NaN"|NumberFormatException.*options\.txt|Unknown key code.*options\.txt|Failed to load options/i.test(combined)) {
    return {
      type: "sanitize-options-txt",
      titleKey: "crash.autofix.sanitizeOptions.title",
      descKey: "crash.autofix.sanitizeOptions.desc",
      payload: { optionsFile: "options.txt" },
    };
  }

  // 32. install-optifabric (Fabric + OptiFine without OptiFabric)
  const isFabric = String(instance.installProfile?.loader || instance.loader || "").split(/\s+/)[0].toLowerCase() === "fabric";
  const hasOptifine = /optifine/i.test(combined);
  const lacksOptifabric = !/optifabric/i.test(combined);
  if (isFabric && hasOptifine && lacksOptifabric && (/LaunchClassLoader|OptiFine is not compatible directly/i.test(combined) || combined.includes("OptiFine"))) {
    return {
      type: "install-optifabric",
      titleKey: "crash.autofix.installOptifabric.title",
      descKey: "crash.autofix.installOptifabric.desc",
      payload: { projectId: "optifabric", depName: "OptiFabric" },
    };
  }

  // 33. purge-instance-logs-cache
  if (/No space left on device|There is not enough space on the disk|Disk full/i.test(combined)) {
    return {
      type: "purge-instance-logs-cache",
      titleKey: "crash.autofix.purgeLogsCache.title",
      descKey: "crash.autofix.purgeLogsCache.desc",
      payload: {},
    };
  }

  // 34. install-language-adapter
  const adapterMatch = combined.match(/Language adapter '([a-zA-Z0-9_\-]+)' was not found/i);
  if (adapterMatch) {
    const rawAdapter = adapterMatch[1]?.toLowerCase();
    if (!rawAdapter || !["kotlin", "fabric-language-kotlin"].includes(rawAdapter)) return null;
    const projectId = "fabric-language-kotlin";
    return {
      type: "install-language-adapter",
      titleKey: "crash.autofix.installLangAdapter.title",
      descKey: "crash.autofix.installLangAdapter.desc",
      payload: { adapterName: rawAdapter, projectId },
    };
  }

  // 35. suppress-gpu-hooks
  if (/# Problematic frame:.*(?:nvoglv64\.dll|atig6pxx\.dll|d3d11\.dll|RTSSHooks64\.dll|DiscordHook64\.dll)/i.test(combined) || /EXCEPTION_ACCESS_VIOLATION.*(?:nvoglv64|RTSSHooks)/i.test(combined)) {
    return null;
  }

  // 36. force-switch-64bit-java
  if (/Could not reserve enough space for \d+KB object heap|32-Bit Server VM|32-bit Java|x86 JRE/i.test(combined)) {
    return null;
  }

  // 37. install-qsl-library
  if (/Missing required library:\s*QSL|quilt_loader:\s*Missing dependency:\s*qsl|requires\s+qsl\s+library|Quilt Standard Libraries.*missing/i.test(combined)) {
    return {
      type: "install-qsl-library",
      titleKey: "crash.autofix.installQsl.title",
      descKey: "crash.autofix.installQsl.desc",
      payload: { projectId: "qsl", depName: "Quilted Fabric API" },
    };
  }

  // 38. purge-corrupted-natives
  if (/UnsatisfiedLinkError: Could not load library: lwjgl|no lwjgl.*in java\.library\.path|corrupted native/i.test(combined)) {
    return {
      type: "purge-corrupted-natives",
      titleKey: "crash.autofix.purgeNatives.title",
      descKey: "crash.autofix.purgeNatives.desc",
      payload: {},
    };
  }

  // 39. allow-security-manager-flag
  if (/UnsupportedOperationException: The Security Manager is deprecated|getSecurityManager is not allowed to be called/i.test(combined)) {
    return {
      type: "allow-security-manager-flag",
      titleKey: "crash.autofix.allowSecurityManager.title",
      descKey: "crash.autofix.allowSecurityManager.desc",
      payload: { jvmFlag: "-Djava.security.manager=allow" },
    };
  }


  return null;
}

/**
 * Applies the proposed 1-click fix to the instance.
 */
async function scopedFile(instancesRoot, instanceId, relative) {
  if (!instancesRoot || !/^[a-zA-Z0-9_-]{1,96}$/.test(String(instanceId))) throw new Error("Invalid instance path");
  const root = await fsp.realpath(path.join(instancesRoot, instanceId));
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Fix target is outside the instance");
  const actual = await fsp.realpath(target);
  if (!actual.startsWith(`${root}${path.sep}`)) throw new Error("Fix target is outside the instance");
  if (!(await fsp.stat(actual)).isFile()) throw new Error("Fix target is not a file");
  return actual;
}

async function findMixinOwner(instancesRoot, instanceId, name) {
  const mods = path.join(instancesRoot, instanceId, "mods");
  let files;
  try { files = await fsp.readdir(mods); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const owners = [];
  for (const file of files.filter((item) => item.endsWith(".jar"))) {
    const metadata = await inspectJarMetadata(path.join(mods, file));
    if (metadata.mixinConfigs?.some((resource) => [`${name}.mixins.json`, `${name}.mixin.json`].includes(resource.replaceAll("\\", "/").split("/").at(-1)))) owners.push(file);
  }
  return owners.length === 1 ? owners[0] : null;
}

async function disableMod(instancesRoot, instanceId, fileName) {
  if (typeof fileName !== "string" || path.basename(fileName) !== fileName || !fileName.endsWith(".jar")) throw new Error("An exact mod JAR is required");
  const source = await scopedFile(instancesRoot, instanceId, path.join("mods", fileName));
  const destination = `${source}.disabled`;
  await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  await fsp.unlink(source);
}

async function quarantineFile(instancesRoot, instanceId, relative) {
  const source = await scopedFile(instancesRoot, instanceId, relative);
  const destination = `${source}.quarantine-${crypto.randomUUID()}`;
  await fsp.rename(source, destination);
  return destination;
}

function unchanged(action, message = "No matching change was needed; the diagnosis was preserved") {
  return { success: false, action, message };
}

async function optionalFile(instancesRoot, instanceId, relative) {
  try { return await scopedFile(instancesRoot, instanceId, relative); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function replaceWithBackup(target, contents) {
  const backup = `${target}.backup-${crypto.randomUUID()}`;
  const temporary = `${target}.fix-${crypto.randomUUID()}`;
  await fsp.copyFile(target, backup, fs.constants.COPYFILE_EXCL);
  try {
    await fsp.writeFile(temporary, contents, { flag: "wx" });
    await fsp.rename(temporary, target);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

async function editTextFile(instancesRoot, instanceId, relative, transform) {
  const target = await optionalFile(instancesRoot, instanceId, relative);
  if (!target) return false;
  const before = await fsp.readFile(target, "utf8");
  const after = transform(before);
  if (before === after) return false;
  await replaceWithBackup(target, after);
  return true;
}

async function applyCrashAutoFix(options) {
  if (!options.instance) throw new Error("Invalid fix action or instance");
  const before = structuredClone(options.instance);
  let saveRequested = false;
  try {
    const result = await applyCrashAutoFixAction({ ...options, saveStateFn: async () => { saveRequested = true; } });
    if (!result.success) {
      for (const key of Object.keys(options.instance)) delete options.instance[key];
      Object.assign(options.instance, before);
    }
    if (result.success && saveRequested && options.saveStateFn) await options.saveStateFn();
    return result;
  } catch (error) {
    for (const key of Object.keys(options.instance)) delete options.instance[key];
    Object.assign(options.instance, before);
    if (saveRequested && options.saveStateFn) await options.saveStateFn();
    throw error;
  }
}

async function applyCrashAutoFixAction({
  fixAction,
  instance,
  instancesRoot,
  installModFn = null,
  repairInstanceFn = null,
  saveStateFn = null,
  resolveJavaFn = null,
  repairNativesFn = null,
}) {
  if (!fixAction || !fixAction.type || !instance) {
    throw new Error("Invalid fix action or instance");
  }

  switch (fixAction.type) {
    case "increase-memory": {
      instance.settings = instance.settings || {};
      instance.settings.memory = fixAction.payload.targetMemoryGiB;
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "increase-memory",
        message: `Allocated ${fixAction.payload.targetMemoryGiB} GB RAM`,
      };
    }

    case "switch-java": {
      if (!resolveJavaFn) throw new Error("Java runtime resolver is unavailable");
      const major = Number(fixAction.payload?.requiredJavaMajor);
      if (!Number.isInteger(major) || major < 8 || major > 99) throw new Error("Invalid Java version");
      const executable = await resolveJavaFn(major);
      if (!executable) throw new Error("No compatible Java runtime found");
      instance.settings = instance.settings || {};
      instance.settings.javaPath = executable;
      instance.javaPath = executable;
      instance.javaMajor = major;
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "switch-java",
        message: `Switched to Java ${fixAction.payload.requiredJavaMajor}`,
      };
    }

    case "reset-jvm-args": {
      instance.settings = instance.settings || {};
      instance.settings.jvmArguments = [];
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "reset-jvm-args",
        message: "Reset custom JVM arguments to defaults",
      };
    }

    case "disable-culprit-mod": {
      const modName = fixAction.payload?.modFileName || fixAction.payload?.mod;
      if (!modName) throw new Error("Culprit mod file name missing");

      const modsDir = path.join(instancesRoot, instance.id, "mods");
      let disabledFile = null;
      if (fs.existsSync(modsDir)) {
        const files = await fsp.readdir(modsDir);
        const target = files.find((f) => f === modName && f.endsWith(".jar"));

        if (target) {
          await disableMod(instancesRoot, instance.id, target);
          disabledFile = target;
        }
      }

      if (!disabledFile) throw new Error("The exact culprit mod was not found; select it manually");
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "disable-culprit-mod",
        message: disabledFile ? `Disabled ${disabledFile}` : `Mod ${modName} was disabled or removed`,
      };
    }

    case "clean-corrupted-file": {
      const fileName = fixAction.payload?.fileName;
      if (!fileName || path.basename(fileName) !== fileName || !fileName.endsWith(".jar")) throw new Error("An exact mod JAR is required");
      const target = await scopedFile(instancesRoot, instance.id, path.join("mods", fileName));
      if (!(await inspectJarMetadata(target)).corrupted) throw new Error("The selected mod archive is not corrupted");
      await quarantineFile(instancesRoot, instance.id, path.join("mods", fileName));
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "clean-corrupted-file",
        message: "Quarantined the corrupted mod; reinstall it before launching",
      };
    }

    case "install-indium": {
      if (!installModFn) throw new Error("Mod installer is unavailable");
      {
        await installModFn({
          instance,
          projectId: fixAction.payload?.projectId || "indium",
        });
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "install-indium",
        message: "Installed Indium for Sodium compatibility",
      };
    }

    case "install-missing-dependency": {
      if (!installModFn) throw new Error("Mod installer is unavailable");
      {
        await installModFn({
          instance,
          projectId: fixAction.payload?.projectId || fixAction.payload?.depId,
          versionRange: fixAction.payload?.versionRange,
        });
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "install-missing-dependency",
        message: `Installed missing dependency ${fixAction.payload?.depName || fixAction.payload?.depId}`,
      };
    }

    case "remove-duplicate-mod": {
      const disableFile = fixAction.payload?.disableFile;
      if (!disableFile) throw new Error("Duplicate mod file name missing");

      await disableMod(instancesRoot, instance.id, disableFile);

      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "remove-duplicate-mod",
        message: `Disabled duplicate mod ${disableFile}`,
      };
    }

    case "resolve-mod-conflict": {
      const conflictingMod = fixAction.payload?.conflictingMod;
      if (!conflictingMod) throw new Error("Conflicting mod file name missing");

      await disableMod(instancesRoot, instance.id, conflictingMod);

      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "resolve-mod-conflict",
        message: `Disabled conflicting mod ${conflictingMod}`,
      };
    }

    case "reset-corrupted-config": {
      const relative = fixAction.payload?.configFile;
      if (typeof relative !== "string" || !relative.replaceAll("\\", "/").startsWith("config/")) throw new Error("An exact instance config file is required");
      const fullPath = await scopedFile(instancesRoot, instance.id, relative);
      await fsp.copyFile(fullPath, `${fullPath}.backup-${crypto.randomUUID()}`, fs.constants.COPYFILE_EXCL);
      const backupPath = fs.existsSync(`${fullPath}.bak`) ? `${fullPath}.bak-${crypto.randomUUID()}` : `${fullPath}.bak`;
      await fsp.rename(fullPath, backupPath);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "reset-corrupted-config",
        message: `Reset damaged config file ${fixAction.payload?.configFile || ""}`,
      };
    }

    case "disable-active-shaderpack": {
      const irisChanged = await editTextFile(instancesRoot, instance.id, "config/iris.properties", (content) =>
        /^enableShaders\s*=/m.test(content)
          ? content.replace(/^enableShaders\s*=.*$/m, "enableShaders=false")
          : `${content}\nenableShaders=false\n`);
      const optifineChanged = await editTextFile(instancesRoot, instance.id, "optionsshaders.txt", (content) =>
        /^shaderPack\s*=/m.test(content) ? content.replace(/^shaderPack\s*=.*$/m, "shaderPack=OFF") : content);
      if (!irisChanged && !optifineChanged) return unchanged(fixAction.type);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "disable-active-shaderpack",
        message: "Disabled active shaderpack",
      };
    }

    case "repair-opengl-context": {
      throw new Error("Review the graphics driver and overlay configuration manually; no automatic driver change was applied");
    }

    case "apply-wayland-fix": {
      throw new Error("Review the graphics driver and overlay configuration manually; no automatic driver change was applied");
    }

    case "reset-video-options": {
      if (!await editTextFile(instancesRoot, instance.id, "options.txt", (content) => content.replace(/^fullscreen:.*$/m, "fullscreen:false").replace(/^overrideWidth:.*$/m, "overrideWidth:854").replace(/^overrideHeight:.*$/m, "overrideHeight:480").replace(/^guiScale:.*$/m, "guiScale:0"))) return unchanged(fixAction.type);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "reset-video-options",
        message: "Reset video options",
      };
    }

    case "disable-active-resourcepacks": {
      if (!await editTextFile(instancesRoot, instance.id, "options.txt", (content) => content.replace(/^resourcePacks:.*$/m, "resourcePacks:[]"))) return unchanged(fixAction.type);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "disable-active-resourcepacks",
        message: "Disabled active resource packs",
      };
    }

    case "upgrade-loader-version": {
      if (!repairInstanceFn) throw new Error("Loader installer is unavailable");
      const version = fixAction.payload?.requiredVersion;
      if (typeof version !== "string" || !/^[0-9]+(?:\.[0-9]+)+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("An exact loader version is required");
      const previous = structuredClone(instance);
      const loader = String(instance.installProfile?.loader || instance.loader || "").split(/\s+/)[0].toLowerCase();
      if (!["fabric", "quilt", "forge", "neoforge"].includes(loader)) throw new Error("Unsupported loader");
      instance.loaderVersion = version;
      instance.installProfile = { minecraftVersion: instance.version, loader, loaderVersion: version };
      instance.resolvedVersionId = null;
      try {
        await repairInstanceFn(instance);
        if (!instance.resolvedVersionId || !instance.resolvedVersionId.includes(version)) throw new Error("Loader installation was not verified");
      } catch (error) {
        for (const key of Object.keys(instance)) delete instance[key];
        Object.assign(instance, previous);
        if (saveStateFn) await saveStateFn();
        throw error;
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "upgrade-loader-version",
        message: `Installed loader ${version}`,
      };
    }

    case "switch-arm64-java": {
      throw new Error("This runtime change requires manual Java configuration; no automatic change was applied");
    }

    case "inject-java-module-flags": {
      instance.settings = instance.settings || {};
      instance.settings.jvmArguments = instance.settings.jvmArguments || [];
      const flags = [
        "--add-opens=java.base/java.lang=ALL-UNNAMED",
        "--add-opens=java.base/java.io=ALL-UNNAMED",
        "--add-opens=java.base/java.nio=ALL-UNNAMED",
        "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
      ];
      const beforeArgs = instance.settings.jvmArguments;
      const existing = beforeArgs.map((flag) => flag.replace(/^--add-opens\s+/, "--add-opens="));
      const next = [...new Set([...flags, ...existing])].slice(0, 24);
      if (JSON.stringify(next) === JSON.stringify(beforeArgs)) return unchanged(fixAction.type);
      instance.settings.jvmArguments = next;
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "inject-java-module-flags",
        message: "Injected Java module open flags",
      };
    }

    case "install-openjfx": {
      throw new Error("This runtime change requires manual Java configuration; no automatic change was applied");
    }

    case "enable-forge-entity-removal": {
      const relative = fixAction.payload?.configFile;
      if (typeof relative !== "string" || !/^(?:config\/forge\.cfg|saves\/[^/]+\/serverconfig\/(?:forge|neoforge)-server\.toml)$/.test(relative)) throw new Error("An exact supported Forge config is required");
      const changed = await editTextFile(instancesRoot, instance.id, relative, (content) =>
        content.replace(/^(\s*(?:B:)?removeErroring(?:Tile)?Entities\s*=\s*)false\s*$/gmi, "$1true"));
      if (!changed) return unchanged(fixAction.type);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "enable-forge-entity-removal",
        message: "Enabled automatic removal of erroring entities",
      };
    }

    case "quarantine-playerdata": {
      const uuid = fixAction.payload?.uuid;
      if (typeof uuid !== "string" || !/^[a-f0-9-]{32,36}$/i.test(uuid)) throw new Error("An exact player UUID is required");
      const savesDir = path.join(instancesRoot, instance.id, "saves");
      const worldName = fixAction.payload?.worldName;
      const worlds = await fsp.readdir(savesDir);
      const candidates = [];
      for (const world of worlds) {
        if (worldName && world !== worldName) continue;
        const relative = path.join("saves", world, "playerdata", `${uuid}.dat`);
        try { candidates.push(await scopedFile(instancesRoot, instance.id, relative)); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      if (candidates.length !== 1) throw new Error("Select the affected world before quarantining player data");
      const target = candidates[0];
      await fsp.copyFile(target, `${target}.backup-${crypto.randomUUID()}`, fs.constants.COPYFILE_EXCL);
      await fsp.rename(target, `${target}.bak`);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "quarantine-playerdata",
        message: `Quarantined player data for ${uuid}`,
      };
    }

    case "remove-vanilla-jar-from-mods": {
      const fileName = fixAction.payload?.fileName;
      const modsDir = path.join(instancesRoot, instance.id, "mods");
      let removed = false;
      if (fileName && fs.existsSync(path.join(modsDir, fileName))) {
        await disableMod(instancesRoot, instance.id, fileName);
        removed = true;
      } else if (fs.existsSync(modsDir)) {
        const files = await fsp.readdir(modsDir).catch(() => []);
        for (const f of files) {
          if (
            f.endsWith(".jar") &&
            !f.endsWith(".disabled") &&
            (/^\d+\.\d+(\.\d+)?\.jar$/i.test(f) ||
             /^(?:minecraft-)?(?:client-|server-)?\d+\.\d+.*\.jar$/i.test(f) ||
             /^client\.jar$/i.test(f) ||
             /^server\.jar$/i.test(f))
          ) {
            await disableMod(instancesRoot, instance.id, f);
            removed = true;
          }
        }
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: removed,
        action: "remove-vanilla-jar-from-mods",
        message: removed
          ? `Disabled stray vanilla game JAR ${fileName || ""} from mods directory`
          : "No stray game JAR found to disable",
      };
    }

    case "restore-world-snapshot": {
      throw new Error("Select a specific world snapshot in diagnostics to restore it");
    }

    case "kill-zombie-process": {
      throw new Error("Close the process holding the world lock; automatic lock deletion is disabled");
    }

    case "repair-instance-assets": {
      if (repairInstanceFn) {
        await repairInstanceFn(instance);
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "repair-instance-assets",
        message: "Triggered integrity repair of game assets",
      };
    }

    case "cleanup-temp-install-files": {
      const modsDir = path.join(instancesRoot, instance.id, "mods");
      let count = 0;
      if (fs.existsSync(modsDir)) {
        const files = await fsp.readdir(modsDir).catch(() => []);
        for (const f of files) {
          if (/\.(?:tmp|part|scope-download|download)$/i.test(f) || /\.jar\.tmp$/i.test(f)) {
            await fsp.unlink(await scopedFile(instancesRoot, instance.id, path.join("mods", f)));
            count++;
          }
        }
      }
      if (!count) return unchanged(fixAction.type);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "cleanup-temp-install-files",
        message: `Removed ${count} temporary installation files`,
      };
    }

    case "reconcile-modpack-manifest": {
      throw new Error("Review the modpack update preview before reconciling files");
    }

    case "disable-environment-mismatched-mod": {
      throw new Error("Identify the exact incompatible mod in diagnostics before disabling it");
    }

    case "restore-corrupted-level-dat": {
      const worldName = fixAction.payload?.worldName;
      if (typeof worldName !== "string" || !worldName.trim() || worldName === "." || worldName === ".." || /[\\/]/.test(worldName)) throw new Error("An exact world name is required");
      const relative = path.join("saves", worldName, "level.dat");
      const backup = await scopedFile(instancesRoot, instance.id, `${relative}_old`);
      if (!(await fsp.stat(backup)).size) throw new Error("The world backup is empty");
      const target = await scopedFile(instancesRoot, instance.id, relative);
      const preserved = `${target}.corrupt-${crypto.randomUUID()}`;
      await fsp.copyFile(target, preserved, fs.constants.COPYFILE_EXCL);
      const temporary = `${target}.restore-${crypto.randomUUID()}`;
      try {
        await fsp.copyFile(backup, temporary, fs.constants.COPYFILE_EXCL);
        await fsp.rename(temporary, target);
      } finally {
        await fsp.rm(temporary, { force: true });
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "restore-corrupted-level-dat",
        message: `Restored level.dat for ${worldName} from level.dat_old`,
      };
    }

    case "resolve-mixin-overwrite": {
      const mixinName = fixAction.payload?.mixinName;
      const target = fixAction.payload?.modFileName;
      if (!mixinName || !target || await findMixinOwner(instancesRoot, instance.id, mixinName) !== target) throw new Error("The exact mod for this mixin could not be identified");
      await disableMod(instancesRoot, instance.id, target);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "resolve-mixin-overwrite",
        message: `Disabled conflicting mod ${target}`,
      };
    }

    case "sanitize-options-txt": {
      if (!await editTextFile(instancesRoot, instance.id, "options.txt", (content) => content.replace(/^gamma:.*NaN.*$/m, "gamma:1.0").replace(/^fov:.*NaN.*$/m, "fov:70.0").replace(/^gamma:\s*$/m, "gamma:1.0"))) return unchanged(fixAction.type);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "sanitize-options-txt",
        message: "Sanitized invalid values in options.txt",
      };
    }

    case "install-optifabric": {
      if (!installModFn) throw new Error("Mod installer is unavailable");
      {
        await installModFn({
          instance,
          projectId: "optifabric",
        });
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "install-optifabric",
        message: "Installed OptiFabric companion mod",
      };
    }

    case "purge-instance-logs-cache": {
      const logsDir = path.join(instancesRoot, instance.id, "logs");
      let count = 0;
      if (fs.existsSync(logsDir)) {
        const files = await fsp.readdir(logsDir).catch(() => []);
        for (const f of files) {
          if (f.endsWith(".log.gz") || f.endsWith(".tmp")) {
            await fsp.unlink(await scopedFile(instancesRoot, instance.id, path.join("logs", f)));
            count++;
          }
        }
      }
      if (!count) return unchanged(fixAction.type);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "purge-instance-logs-cache",
        message: `Purged ${count} archived log files to free disk space`,
      };
    }

    case "install-language-adapter": {
      if (!installModFn) throw new Error("Mod installer is unavailable");
      {
        await installModFn({
          instance,
          projectId: fixAction.payload?.projectId || "fabric-language-kotlin",
        });
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "install-language-adapter",
        message: `Installed language adapter ${fixAction.payload?.adapterName || ""}`,
      };
    }

    case "suppress-gpu-hooks": {
      throw new Error("Review the graphics driver and overlay configuration manually; no automatic driver change was applied");
    }

    case "force-switch-64bit-java": {
      throw new Error("This runtime change requires manual Java configuration; no automatic change was applied");
    }

    case "install-qsl-library": {
      if (!installModFn) throw new Error("Mod installer is unavailable");
      {
        await installModFn({
          instance,
          projectId: "qsl",
        });
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "install-qsl-library",
        message: "Installed Quilted Fabric API (QSL)",
      };
    }

    case "purge-corrupted-natives": {
      if (!repairNativesFn) throw new Error("Native library repair is unavailable");
      await repairNativesFn(instance);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "purge-corrupted-natives",
        message: "Rebuilt native libraries for the resolved game version",
      };
    }

    case "allow-security-manager-flag": {
      instance.settings = instance.settings || {};
      instance.settings.jvmArguments = instance.settings.jvmArguments || [];
      const flag = "-Djava.security.manager=allow";
      if (!instance.settings.jvmArguments.includes(flag)) {
        instance.settings.jvmArguments.push(flag);
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "allow-security-manager-flag",
        message: "Allowed SecurityManager via JVM argument",
      };
    }

    case "clean-corrupted-usercache": {
      const relative = fixAction.payload?.cacheFile;
      if (!["usercache.json", "realms_persistence.json"].includes(relative)) throw new Error("An exact cache file is required");
      const target = await optionalFile(instancesRoot, instance.id, relative);
      if (!target) return unchanged(fixAction.type);
      const contents = await fsp.readFile(target, "utf8");
      let valid = false;
      try {
        const parsed = JSON.parse(contents);
        valid = relative === "usercache.json" ? Array.isArray(parsed) : Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
      } catch { /* Malformed JSON is the evidence for quarantining this cache. */ }
      if (valid) return unchanged(fixAction.type, "The selected cache is valid; it was preserved");
      await quarantineFile(instancesRoot, instance.id, relative);
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "clean-corrupted-usercache",
        message: `Quarantined ${relative}; other caches were preserved`,
      };
    }

    case "sanitize-jvm-gc-flags": {
      instance.settings = instance.settings || {};
      let args = Array.isArray(instance.settings.jvmArguments)
        ? [...instance.settings.jvmArguments]
        : [];
      const rejected = fixAction.payload?.rejectedFlag;
      const knownGcOptions = new Set(["UseConcMarkSweepGC", "CMSIncrementalMode", "CMSIncrementalPacing", "UseParNewGC", "UseZGC", "UseShenandoahGC"]);
      const major = instance.javaMajor || (/^1\.(?:[1-9]|1[0-6])(?:\.|$)/.test(instance.version || "") ? 8 : 17);
      const beforeArgs = [...args];
      args = args.filter((argument) => {
        const name = argument.match(/^-XX:[+-]([A-Za-z0-9]+)$/)?.[1];
        if (name && name === rejected && knownGcOptions.has(name)) return false;
        if (major >= 14 && ["UseConcMarkSweepGC", "CMSIncrementalMode", "CMSIncrementalPacing", "UseParNewGC"].includes(name)) return false;
        if (major < 11 && ["UseZGC", "UseShenandoahGC"].includes(name)) return false;
        return true;
      });
      if (JSON.stringify(args) === JSON.stringify(beforeArgs)) return unchanged(fixAction.type);
      if (!args.some((argument) => /^-XX:\+Use[A-Za-z0-9]+GC$/.test(argument))) args.push("-XX:+UseG1GC");
      instance.settings.jvmArguments = args;
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "sanitize-jvm-gc-flags",
        message: "Sanitized incompatible JVM garbage collection flags",
      };
    }

    case "disable-early-display": {
      instance.settings = instance.settings || {};
      instance.settings.jvmArguments = instance.settings.jvmArguments || [];
      const flags = ["-Dfml.earlydisplay=false", "-Dneoforge.earlydisplay=false"];
      for (const f of flags) {
        if (!instance.settings.jvmArguments.includes(f)) {
          instance.settings.jvmArguments.push(f);
        }
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return {
        success: true,
        action: "disable-early-display",
        message: "Disabled Forge/NeoForge early display window",
      };
    }

    case "repair-servers-dat": {
      const target = await optionalFile(instancesRoot, instance.id, "servers.dat");
      if (!target) return unchanged(fixAction.type);
      const backup = await optionalFile(instancesRoot, instance.id, "servers.dat_old");
      let restored = false;
      if (backup && (await fsp.stat(backup)).size > 0) {
        const temporary = `${target}.fix-${crypto.randomUUID()}`;
        await fsp.copyFile(target, `${target}.backup-${crypto.randomUUID()}`, fs.constants.COPYFILE_EXCL);
        try {
          await fsp.copyFile(backup, temporary, fs.constants.COPYFILE_EXCL);
          await fsp.rename(temporary, target);
          restored = true;
        } finally {
          await fsp.rm(temporary, { force: true });
        }
      } else {
        await quarantineFile(instancesRoot, instance.id, "servers.dat");
      }
      instance.lastAutoFix = null;
      instance.lastDiagnosis = null;
      if (saveStateFn) await saveStateFn();
      return { success: true, action: fixAction.type, message: restored ? "Restored servers.dat from its backup" : "Quarantined servers.dat for clean regeneration" };
    }

    default:
      throw new Error(`Unsupported fix action type: ${fixAction.type}`);
  }
}

module.exports = {
  detectCrashAutoFix,
  applyCrashAutoFix,
  inspectJarMetadata,
  checkModCompatibility,
};
