const { currentLaunchLog } = require("./launch-log.cjs");
const RULES = [
  {
    code: "out-of-memory",
    pattern: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i,
    severity: "error",
    title: "Minecraft ran out of memory",
    message:
      "Increase the instance memory by 2–4 GB or disable resource-heavy mods and resource packs.",
  },
  {
    code: "wrong-java",
    pattern:
      /UnsupportedClassVersionError|class file version \d+\.0|only recognizes class file versions/i,
    severity: "error",
    title: "Incompatible Java version",
    message:
      "Reset the custom Java path so Scope can select a compatible version automatically.",
  },
  {
    code: "missing-dependency",
    pattern:
      /ModResolutionException|Incompatible mods? found|(?:requires|depends on) [^\n]+ but (?:it is missing|only [^\n]+ is present)|missing (?:mandatory )?dependencies|Dependency resolution failed/i,
    severity: "error",
    title: "A mod dependency is missing",
    message:
      "Open the instance content and update its mods. The log below identifies the missing dependency.",
  },
  {
    code: "class-not-found",
    pattern: /NoClassDefFoundError|ClassNotFoundException/i,
    severity: "error",
    title: "Class loading failure",
    message:
      "A required Java class could not be loaded by the game runtime.",
  },
  {
    code: "mixin-conflict",
    pattern:
      /MixinApplyError|MixinTransformerError|mixin.+(?:failed|error)|InjectionError/i,
    severity: "error",
    title: "Mod or mixin conflict",
    message:
      "A mod is incompatible with the current game version. Update the mods or temporarily disable the newest ones one at a time.",
  },
  {
    code: "native-crash",
    pattern: /EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected by the Java Runtime/i,
    severity: "warning",
    title: "Driver or native library crash",
    message:
      "Update the graphics driver, disable overlays, and check rendering mods. Your world is not corrupted.",
  },
  {
    code: "disk-full",
    pattern:
      /No space left on device|There is not enough space/i,
    severity: "error",
    title: "The disk is full",
    message:
      "Free some space or use the safe migration option in Settings to move the instances directory.",
  },
  {
    code: "authentication",
    pattern:
      /InvalidCredentialsException|Failed to log in|authentication servers are down/i,
    severity: "warning",
    title: "Authentication problem",
    message:
      "Switch Microsoft accounts or try again after the services recover.",
  },
  {
    code: "corrupted-file",
    pattern:
      /zip END header not found|invalid (?:LOC|CEN) header|zip file is empty|checksum (?:failed|mismatch)|hash mismatch/i,
    severity: "error",
    title: "A game or mod file is corrupted",
    message:
      "Run automatic repair so Scope downloads only the corrupted files again.",
  },
  {
    code: "bad-jvm-arguments",
    pattern:
      /Unrecognized VM option|Could not create the Java Virtual Machine|Invalid maximum heap size/i,
    severity: "error",
    title: "Java rejected the launch arguments",
    message:
      "Reset the custom JVM arguments and check the allocated memory.",
  },
  {
    code: "graphics-init",
    pattern:
      /GLFW error|OpenGL[^\n]*(?:not supported|failed|error)|Failed to create window|Pixel format launch/i,
    severity: "error",
    title: "Minecraft could not initialize graphics",
    message:
      "Update the graphics driver and disable incompatible rendering mods or overlays.",
  },
  {
    code: "permission-denied",
    pattern:
      /AccessDeniedException|Permission denied/i,
    severity: "error",
    title: "Instance files are not accessible",
    message:
      "Check the folder owner and permissions, or move the instances to an accessible directory.",
  },
];

function analyzeMinecraftLog(content = "") {
  const text = currentLaunchLog(content).slice(-500_000);
  return RULES.filter((rule) => rule.pattern.test(text)).map(
    ({ pattern: _pattern, ...diagnosis }) => diagnosis,
  );
}

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

async function extractCrashReport({ instanceDirectory, logContent = "", exitCode = 1, startedAt = null }) {
  logContent = currentLaunchLog(logContent);
  let crashFilePath = null;

  const markerMatch = logContent.match(/Crash report saved to:\s*(?:#@!@#\s*)?([^\r\n#]+)/i);
  if (markerMatch && markerMatch[1]) {
    const candidate = markerMatch[1].trim();
    if (fs.existsSync(candidate) && instanceDirectory &&
        path.resolve(candidate).startsWith(`${path.resolve(instanceDirectory, "crash-reports")}${path.sep}`) &&
        (!Number.isFinite(startedAt) || (await fsp.stat(candidate)).mtimeMs >= startedAt)) {
      crashFilePath = candidate;
    }
  }

  if (!crashFilePath && instanceDirectory && Number.isFinite(startedAt)) {
    const crashReportsDir = path.join(instanceDirectory, "crash-reports");
    try {
      if (fs.existsSync(crashReportsDir)) {
        const files = await fsp.readdir(crashReportsDir);
        const txtFiles = files.filter((f) => f.endsWith(".txt") && f.startsWith("crash-"));
        if (txtFiles.length > 0) {
          const stats = await Promise.all(
            txtFiles.map(async (f) => ({
              file: path.join(crashReportsDir, f),
              mtime: (await fsp.stat(path.join(crashReportsDir, f))).mtimeMs,
            }))
          );
          stats.sort((a, b) => b.mtime - a.mtime);
          if (stats[0].mtime >= startedAt && stats[0].mtime <= Date.now() + 1000) {
            crashFilePath = stats[0].file;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (crashFilePath) {
    try {
      const raw = await fsp.readFile(crashFilePath, "utf8");
      const lines = raw.split(/\r?\n/);
      
      let description = "";
      let exceptionLine = "";
      const stackLines = [];
      let inStack = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("Description:")) {
          description = line.replace("Description:", "").trim();
          continue;
        }
        if (!exceptionLine && (line.includes("Exception") || line.includes("Error") || line.startsWith("java.") || line.includes("NoClassDefFoundError"))) {
          exceptionLine = line.trim();
          inStack = true;
        }
        if (inStack) {
          if (line.startsWith("-- System Details --") || (line.startsWith("-- Head --") && stackLines.length > 15)) {
            if (line.startsWith("-- System Details --")) break;
          }
          stackLines.push(line);
          if (stackLines.length >= 80) break;
        }
      }

      const fullStack = stackLines.join("\n").trim();
      // A mod list or a JVM argument is not evidence that the mod caused a crash.
      const reportedFiles = [...new Set([...raw.matchAll(/^\s*Mod File:\s*(?:[^\r\n]*[\\/])?([^\\/\r\n]+\.jar)\s*$/gim)]
        .map((match) => match[1].trim()))];
      const suspectedCulprit = reportedFiles.length === 1 ? reportedFiles[0] : null;

      return {
        foundCrashReport: true,
        crashFilePath,
        errorTitle: exceptionLine || description || `Crash (exit code ${exitCode})`,
        stackTrace: fullStack || raw.slice(0, 3000),
        suspectedCulprit,
      };
    } catch {
      // fallback
    }
  }

  const lines = logContent.split(/\r?\n/);
  let lastErrorIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes("Exception:") || l.includes("Error:") || l.includes("[FATAL]") || l.includes("Caused by:")) {
      lastErrorIdx = i;
      break;
    }
  }

  if (lastErrorIdx !== -1) {
    const start = Math.max(0, lastErrorIdx - 5);
    const end = Math.min(lines.length, lastErrorIdx + 60);
    const extractedLines = lines.slice(start, end);
    const titleLine = lines[lastErrorIdx].trim();
    
    let culprit = null;
    const chunk = extractedLines.join("\n");
    if (chunk.includes("onyx-fps-agent") || chunk.includes("OnyxFpsTracker")) {
      culprit = "onyx-fps-agent.jar (Launcher FPS Probe)";
    }

    return {
      foundCrashReport: false,
      errorTitle: titleLine.slice(0, 150) || `Process exited with code ${exitCode}`,
      stackTrace: chunk,
      suspectedCulprit: culprit,
    };
  }

  return {
    foundCrashReport: false,
    errorTitle: `Process exited with code ${exitCode}`,
    stackTrace: logContent.slice(-2500) || `Process exited with code ${exitCode}`,
    suspectedCulprit: null,
  };
}

const { detectCrashAutoFix, applyCrashAutoFix } = require("./crash-autofix.cjs");

module.exports = {
  RULES,
  analyzeMinecraftLog,
  extractCrashReport,
  detectCrashAutoFix,
  applyCrashAutoFix,
};

