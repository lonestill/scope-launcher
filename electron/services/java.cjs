const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { fetchJson, downloadFile } = require("./network.cjs");
const { extractArchive, findFile } = require("./archive.cjs");
const {
  adoptiumOsName,
  adoptiumArchitecture,
  azulOsName,
  azulArchitecture,
  javaExecutableNames,
  isJavaExecutableName,
} = require("./platform.cjs");

const execFileAsync = promisify(execFile);

async function inspectJava(executable) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["-version"], {
      windowsHide: true,
      timeout: 10_000,
    });
    const output = `${stderr}\n${stdout}`;
    const match = output.match(/version\s+"([^"]+)"/i);
    if (!match) return null;
    const raw = match[1];
    const major = raw.startsWith("1.")
      ? Number(raw.split(".")[1])
      : Number(raw.split(/[.+_-]/)[0]);
    if (!Number.isFinite(major)) return null;
    return { executable, major, version: raw };
  } catch {
    return null;
  }
}

async function findSystemJava(platform = process.platform) {
  const candidates = javaExecutableNames(platform);
  for (const candidate of candidates) {
    const inspected = await inspectJava(candidate);
    if (inspected) return inspected;
  }
  return null;
}

async function findAdoptiumPackage(requiredMajor, signal) {
  try {
    const architecture = adoptiumArchitecture(process.arch, requiredMajor);
    const operatingSystem = adoptiumOsName();
    const assets = await fetchJson(
      `https://api.adoptium.net/v3/assets/latest/${requiredMajor}/hotspot?architecture=${architecture}&image_type=jre&os=${operatingSystem}&vendor=eclipse`,
      { signal },
    );
    if (!Array.isArray(assets)) return null;
    const selected = assets.find(
      (asset) => asset.binary?.package?.link && asset.binary?.package?.name,
    );
    if (!selected) return null;
    return {
      name: selected.binary.package.name,
      url: selected.binary.package.link,
      sha256: selected.binary.package.checksum,
      size: selected.binary.package.size,
    };
  } catch {
    return null;
  }
}

async function findAzulZuluPackage(requiredMajor, signal) {
  try {
    const os = azulOsName();
    const arch = azulArchitecture(process.arch, requiredMajor);
    const packages = await fetchJson(
      `https://api.azul.com/metadata/v1/zulu/packages/?java_version=${requiredMajor}&os=${os}&arch=${arch}&page_size=5`,
      { signal },
    );
    if (!Array.isArray(packages) || packages.length === 0) return null;
    const selected =
      packages.find((p) => p.name?.includes("-jre") && p.download_url) ||
      packages.find((p) => p.download_url) ||
      packages[0];
    if (!selected?.download_url) return null;
    return {
      name: selected.name,
      url: selected.download_url,
      sha256: selected.sha256_hash || null,
      size: selected.size || null,
    };
  } catch {
    return null;
  }
}

class JavaService {
  constructor(runtimeRoot) {
    this.runtimeRoot = runtimeRoot;
  }

  async resolve(requiredMajor, customPath, onProgress, signal) {
    signal?.throwIfAborted();
    if (customPath) {
      const custom = await inspectJava(customPath);
      if (custom && custom.major === requiredMajor) return custom.executable;
      if (custom && requiredMajor >= 17 && custom.major > requiredMajor) {
        return custom.executable;
      }
    }

    const cachedRoot = path.join(this.runtimeRoot, `java-${requiredMajor}`);
    const cached = await findFile(
      cachedRoot,
      (_file, name) => isJavaExecutableName(name),
      5,
    ).catch(() => null);
    if (cached && (await inspectJava(cached))) return cached;

    const system = await findSystemJava();
    if (system && system.major === requiredMajor) {
      return system.executable;
    }

    return this.install(requiredMajor, onProgress, signal);
  }

  async install(requiredMajor, onProgress, signal) {
    signal?.throwIfAborted();
    onProgress?.({
      stage: "java",
      progress: 1,
      message: `Selecting Java ${requiredMajor}…`,
    });

    const selected =
      (await findAdoptiumPackage(requiredMajor, signal)) ||
      (await findAzulZuluPackage(requiredMajor, signal));
    if (!selected) {
      throw new Error(`No prebuilt Java runtime was found for Java ${requiredMajor}`);
    }

    const runtimeDirectory = path.join(
      this.runtimeRoot,
      `java-${requiredMajor}`,
    );
    const archive = path.join(
      this.runtimeRoot,
      "downloads",
      selected.name,
    );
    await downloadFile({
      url: selected.url,
      destination: archive,
      sha256: selected.sha256,
      size: selected.size,
      signal,
      onProgress: ({ received, total, speed, eta }) => {
        const progress = total ? Math.round((received / total) * 72) : 8;
        onProgress?.({
          stage: "java",
          progress: Math.max(2, progress),
          message: `Downloading Java ${requiredMajor}…`,
          received,
          total,
          speed: speed ?? undefined,
          eta: eta ?? undefined,
        });
      },
    });

    signal?.throwIfAborted();
    await fsp.rm(runtimeDirectory, { recursive: true, force: true });
    await fsp.mkdir(runtimeDirectory, { recursive: true });
    await extractArchive(archive, runtimeDirectory, {
      signal,
      onProgress: ({ extracted, count }) => {
        const extractionProgress = count
          ? Math.round((extracted / Math.max(count, 1)) * 27)
          : Math.min(extracted, 26);
        onProgress?.({
          stage: "java",
          progress: 72 + extractionProgress,
          message: `Extracting Java ${requiredMajor}…`,
        });
      },
    });
    signal?.throwIfAborted();
    const executable = await findFile(
      runtimeDirectory,
      (_file, name) => isJavaExecutableName(name),
      5,
    );
    if (!executable) throw new Error("The Java archive does not contain an executable");
    await fsp.chmod(executable, 0o755).catch(() => undefined);
    onProgress?.({
      stage: "java",
      progress: 100,
      message: `Java ${requiredMajor} is ready`,
    });
    return executable;
  }
}

module.exports = {
  JavaService,
  inspectJava,
  findSystemJava,
};
