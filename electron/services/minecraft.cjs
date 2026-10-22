const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const osInfo = require("node:os");
const net = require("node:net");
const { domainToASCII } = require("node:url");
const { spawn } = require("node:child_process");
const { version: ONYX_VERSION } = require("../../package.json");
const {
  fetchJson,
  fetchWithRetry,
  downloadFile,
  downloadMany,
} = require("./network.cjs");
const { extractZip } = require("./archive.cjs");
const {
  minecraftOsName,
  minecraftArchitecture,
  nativeArchitectureToken,
  javaConsoleExecutable,
} = require("./platform.cjs");
const { generateOptimizedJvmFlags } = require("./tuning.cjs");

const VERSION_MANIFEST =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const MOJANG_LIBRARIES = "https://libraries.minecraft.net/";
const RESOURCES = "https://resources.download.minecraft.net";

function parseServerAddress(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (
    value.length > 320 ||
    /\s/.test(value) ||
    value.includes("://") ||
    /[\\/?#@]/.test(value)
  ) {
    throw new Error("Enter the server address without a protocol, path, or spaces");
  }

  let host = "";
  let portText = "";
  if (value.startsWith("[")) {
    const match = value.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
    if (!match) {
      throw new Error("Invalid IPv6 server address");
    }
    host = match[1];
    portText = match[2] || "";
    if (net.isIP(host) !== 6) {
      throw new Error("Invalid IPv6 server address");
    }
  } else {
    const colonCount = (value.match(/:/g) || []).length;
    if (colonCount > 1) {
      host = value;
      if (net.isIP(host) !== 6) {
        throw new Error("Enter IPv6 with a port as [address]:port");
      }
    } else if (colonCount === 1) {
      const separator = value.lastIndexOf(":");
      host = value.slice(0, separator);
      portText = value.slice(separator + 1);
      if (!/^\d{1,5}$/.test(portText)) {
        throw new Error("The server port must be a number from 1 to 65535");
      }
    } else {
      host = value;
    }
  }

  host = host.replace(/\.$/, "");
  if (!host) throw new Error("Enter a server address");

  if (!net.isIP(host)) {
    const asciiHost = domainToASCII(host).toLowerCase();
    const labels = asciiHost.split(".");
    if (
      !asciiHost ||
      asciiHost.length > 253 ||
      labels.some(
        (label) =>
          !label ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
      )
    ) {
      throw new Error("Invalid server domain name");
    }
    host = asciiHost;
  }

  const port = portText ? Number(portText) : 25565;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The server port must be a number from 1 to 65535");
  }
  const bracketedHost = net.isIP(host) === 6 ? `[${host}]` : host;
  return {
    host,
    port,
    address: port === 25565 ? bracketedHost : `${bracketedHost}:${port}`,
  };
}

function normalizeResolvedVersionId(instance) {
  let migrated = false;
  if (
    instance &&
    !instance.resolvedVersionId &&
    typeof instance.versionId === "string" &&
    instance.versionId.trim()
  ) {
    instance.resolvedVersionId = instance.versionId.trim();
    migrated = true;
  }
  if (instance && Object.hasOwn(instance, "versionId")) {
    delete instance.versionId;
  }
  if (
    migrated &&
    ["setup", "pack-ready", "installing"].includes(instance.status)
  ) {
    instance.status = "ready";
  }
  return instance;
}

function applyRules(rules, features = {}, runtime = {}) {
  if (!rules || rules.length === 0) return true;
  const platform = runtime.platform || process.platform;
  const architecture = runtime.arch || process.arch;
  const systemVersion = runtime.version || osInfo.release();
  let allowed = false;
  for (const rule of rules) {
    const os = rule.os || {};
    let matches = true;
    if (os.name && os.name !== minecraftOsName(platform)) matches = false;
    if (os.arch) {
      const current = minecraftArchitecture(architecture);
      if (os.arch !== current && os.arch !== architecture) matches = false;
    }
    if (os.version) {
      try {
        if (!new RegExp(os.version).test(systemVersion)) matches = false;
      } catch {
        matches = false;
      }
    }
    if (rule.features) {
      for (const [feature, expected] of Object.entries(rule.features)) {
        if (Boolean(features[feature]) !== Boolean(expected)) matches = false;
      }
    }
    if (matches) allowed = rule.action === "allow";
  }
  return allowed;
}

function mavenArtifact(name, baseUrl = MOJANG_LIBRARIES) {
  const [coordinate, extensionPart] = name.split("@");
  const extension = extensionPart || "jar";
  const parts = coordinate.split(":");
  if (parts.length < 3) throw new Error(`Invalid Maven coordinate: ${name}`);
  const [group, artifact, version, classifier] = parts;
  const filename = `${artifact}-${version}${
    classifier ? `-${classifier}` : ""
  }.${extension}`;
  const relativePath = `${group.replaceAll(".", "/")}/${artifact}/${version}/${filename}`;
  return {
    path: relativePath,
    url: `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${relativePath}`,
  };
}

function libraryArtifact(library) {
  const artifact = library.downloads?.artifact;
  if (artifact?.path && artifact?.url) return artifact;
  return mavenArtifact(library.name, library.url || MOJANG_LIBRARIES);
}

function classifierArtifact(library, classifierName) {
  const classifier = library.downloads?.classifiers?.[classifierName];
  if (classifier?.path && classifier?.url) return classifier;
  const parts = library.name.split(":");
  if (parts.length < 3) return null;
  return mavenArtifact(
    `${parts[0]}:${parts[1]}:${parts[2]}:${classifierName}`,
    library.url || MOJANG_LIBRARIES,
  );
}

function expandArguments(entries = [], features = {}) {
  const values = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      values.push(entry);
      continue;
    }
    if (!applyRules(entry.rules, features)) continue;
    if (Array.isArray(entry.value)) values.push(...entry.value);
    else if (entry.value != null) values.push(entry.value);
  }
  return values;
}

function replaceVariables(value, variables) {
  return String(value).replace(/\$\{([^}]+)\}/g, (_match, key) =>
    variables[key] == null ? "" : String(variables[key]),
  );
}

function libraryKey(library) {
  const name = typeof library === "string" ? library : library?.name;
  if (!name || typeof name !== "string") return "";
  const [coordinate] = name.split("@");
  const parts = coordinate.split(":");
  if (parts.length < 3) return coordinate;
  const [group, artifact] = parts;
  const classifier = parts.slice(3).join(":");
  return classifier ? `${group}:${artifact}:${classifier}` : `${group}:${artifact}`;
}

function mergeVersion(parent, child) {
  const childKeys = new Set((child.libraries || []).map(libraryKey));
  const parentFiltered = (parent.libraries || []).filter(
    (lib) => !childKeys.has(libraryKey(lib)),
  );
  const jvmArgs = [
    ...(parent.arguments?.jvm || []),
    ...(child.arguments?.jvm || []),
  ];
  const gameArgs = [
    ...(parent.arguments?.game || []),
    ...(child.arguments?.game || []),
  ];
  const merged = {
    ...parent,
    ...child,
    id: child.id,
    jar: child.jar || parent.jar || parent.id,
    libraries: [...(child.libraries || []), ...parentFiltered],
    minecraftArguments:
      child.minecraftArguments || parent.minecraftArguments || "",
  };
  if (jvmArgs.length > 0 || gameArgs.length > 0) {
    merged.arguments = {
      ...(parent.arguments || {}),
      ...(child.arguments || {}),
      ...(jvmArgs.length > 0 ? { jvm: jvmArgs } : {}),
      ...(gameArgs.length > 0 ? { game: gameArgs } : {}),
    };
  } else {
    delete merged.arguments;
  }
  return merged;
}

function loaderInfo(instance) {
  const raw = String(instance.loader || "Vanilla").trim();
  const [name, ...versionParts] = raw.split(/\s+/);
  const explicitVersion =
    instance.loaderVersion ||
    (instance.installProfile?.loaderVersion !== undefined
      ? instance.installProfile.loaderVersion
      : null) ||
    versionParts.join(" ") ||
    null;
  if (instance.installProfile && !instance.loaderVersion) {
    return instance.installProfile;
  }
  return {
    minecraftVersion:
      instance.version || instance.installProfile?.minecraftVersion,
    loader: name.toLowerCase(),
    loaderVersion: explicitVersion,
  };
}

function offlineUuid(name) {
  const bytes = crypto.createHash("md5").update(`OfflinePlayer:${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function compareSemanticVersions(left, right) {
  const parse = (value) =>
    String(value)
      .split(/[.+-]/)
      .map((part) => Number(part))
      .filter(Number.isFinite);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

class MinecraftService {
  constructor({ sharedRoot, instancesRoot, javaService }) {
    this.sharedRoot = sharedRoot;
    this.instancesRoot = instancesRoot;
    this.javaService = javaService;
    this.manifest = null;
  }

  instanceDirectory(instanceId) {
    return path.join(this.instancesRoot, instanceId);
  }

  async getManifest(force = false) {
    if (this.manifest && !force) return this.manifest;
    const cachePath = path.join(this.sharedRoot, "cache", "version_manifest.json");
    try {
      const stat = await fsp.stat(cachePath);
      if (!force && Date.now() - stat.mtimeMs < 15 * 60_000) {
        this.manifest = JSON.parse(await fsp.readFile(cachePath, "utf8"));
        return this.manifest;
      }
    } catch {
      // Cache miss.
    }
    this.manifest = await fetchJson(VERSION_MANIFEST);
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, JSON.stringify(this.manifest), "utf8");
    return this.manifest;
  }

  async listVersions(includeSnapshots = false) {
    const manifest = await this.getManifest();
    return manifest.versions
      .filter((version) => includeSnapshots || version.type === "release")
      .slice(0, 80)
      .map(({ id, type, releaseTime }) => ({ id, type, releaseTime }));
  }

  async getVanillaVersion(versionId, onProgress, signal) {
    signal?.throwIfAborted();
    const versionDirectory = path.join(
      this.sharedRoot,
      "versions",
      versionId,
    );
    const jsonPath = path.join(versionDirectory, `${versionId}.json`);
    try {
      return JSON.parse(await fsp.readFile(jsonPath, "utf8"));
    } catch {
      const manifest = await this.getManifest();
      const entry = manifest.versions.find((version) => version.id === versionId);
      if (!entry) throw new Error(`Minecraft version ${versionId} was not found`);
      onProgress?.({
        stage: "metadata",
        progress: 2,
        message: `Fetching Minecraft ${versionId}…`,
      });
      const version = await fetchJson(entry.url, { signal });
      await fsp.mkdir(versionDirectory, { recursive: true });
      await fsp.writeFile(jsonPath, JSON.stringify(version, null, 2), "utf8");
      return version;
    }
  }

  async installVanilla(versionId, onProgress, signal) {
    signal?.throwIfAborted();
    const version = await this.getVanillaVersion(versionId, onProgress, signal);
    const downloads = [];
    const versionDirectory = path.join(
      this.sharedRoot,
      "versions",
      versionId,
    );
    if (version.downloads?.client) {
      downloads.push({
        url: version.downloads.client.url,
        destination: path.join(versionDirectory, `${versionId}.jar`),
        sha1: version.downloads.client.sha1,
        size: version.downloads.client.size,
      });
    }

    for (const library of version.libraries || []) {
      if (!applyRules(library.rules)) continue;
      if (library.downloads?.artifact || !library.natives) {
        const artifact = libraryArtifact(library);
        if (artifact?.url && artifact?.path) {
          downloads.push({
            url: artifact.url,
            destination: path.join(
              this.sharedRoot,
              "libraries",
              artifact.path,
            ),
            sha1: artifact.sha1,
            size: artifact.size,
          });
        }
      }
      const nativeTemplate = library.natives?.[minecraftOsName()];
      if (nativeTemplate) {
        const classifierName = nativeTemplate.replace(
          "${arch}",
          nativeArchitectureToken(),
        );
        const classifier = classifierArtifact(library, classifierName);
        if (classifier) {
          downloads.push({
            url: classifier.url,
            destination: path.join(
              this.sharedRoot,
              "libraries",
              classifier.path,
            ),
            sha1: classifier.sha1,
            size: classifier.size,
            native: true,
            excludes: library.extract?.exclude || [],
          });
        }
      }
    }

    if (version.assetIndex?.url) {
      const indexPath = path.join(
        this.sharedRoot,
        "assets",
        "indexes",
        `${version.assetIndex.id}.json`,
      );
      await downloadFile({
        url: version.assetIndex.url,
        destination: indexPath,
        sha1: version.assetIndex.sha1,
        size: version.assetIndex.size,
        signal,
      });
      const index = JSON.parse(await fsp.readFile(indexPath, "utf8"));
      for (const object of Object.values(index.objects || {})) {
        downloads.push({
          url: `${RESOURCES}/${object.hash.slice(0, 2)}/${object.hash}`,
          destination: path.join(
            this.sharedRoot,
            "assets",
            "objects",
            object.hash.slice(0, 2),
            object.hash,
          ),
          sha1: object.hash,
          size: object.size,
        });
      }
    }

    if (version.logging?.client?.file?.url) {
      const logging = version.logging.client.file;
      downloads.push({
        url: logging.url,
        destination: path.join(
          this.sharedRoot,
          "assets",
          "log_configs",
          logging.id,
        ),
        sha1: logging.sha1,
        size: logging.size,
      });
    }

    let highestProgress = 4;
    await downloadMany(downloads, {
      concurrency: 10,
      signal,
      onProgress: ({ completed, count, received, total, speed, eta, current }) => {
        const fileProgress = count ? completed / count : 1;
        const byteProgress = total && total > 0 ? received / total : fileProgress;
        const ratio = total && total > 0 ? Math.min(1, Math.max(0, byteProgress)) : fileProgress;
        const computed = 4 + Math.round(ratio * 76);
        highestProgress = Math.min(80, Math.max(highestProgress, computed));
        onProgress?.({
          stage: "minecraft",
          progress: highestProgress,
          message:
            count > 1
              ? `Downloading Minecraft assets (${completed}/${count})…`
              : `Installing Minecraft ${versionId}`,
          completed,
          count,
          received,
          total,
          speed: speed ?? undefined,
          eta: eta ?? undefined,
        });
      },
    });

    const nativesDirectory = path.join(
      this.sharedRoot,
      "natives",
      versionId,
    );
    signal?.throwIfAborted();
    await fsp.rm(nativesDirectory, { recursive: true, force: true });
    await fsp.mkdir(nativesDirectory, { recursive: true });
    const nativeFiles = downloads.filter((item) => item.native);
    for (let index = 0; index < nativeFiles.length; index += 1) {
      signal?.throwIfAborted();
      const native = nativeFiles[index];
      await extractZip(native.destination, nativesDirectory, {
        mapPath: (entryName) => {
          const normalized = entryName.replaceAll("\\", "/");
          if (
            normalized.endsWith("/") ||
            normalized.startsWith("META-INF/") ||
            native.excludes?.some((prefix) => normalized.startsWith(prefix))
          ) {
            return null;
          }
          return normalized;
        },
      });
      onProgress?.({
        stage: "natives",
        progress: 80 + Math.round(((index + 1) / nativeFiles.length) * 8),
        message: "Preparing native libraries…",
      });
    }

    onProgress?.({
      stage: "minecraft",
      progress: 88,
      message: `Minecraft ${versionId} installed`,
    });
    return version;
  }

  async installLoader(profile, javaPath, onProgress, signal) {
    signal?.throwIfAborted();
    const loader = String(profile.loader || "vanilla").toLowerCase();
    if (loader === "vanilla") {
      return profile.minecraftVersion;
    }
    if (loader === "fabric") {
      return this.installFabric(profile, onProgress, signal);
    }
    if (loader === "quilt") {
      return this.installQuilt(profile, onProgress, signal);
    }
    if (loader === "forge" || loader === "neoforge") {
      return this.installForgeLike(profile, javaPath, onProgress, signal);
    }
    throw new Error(`Loader ${profile.loader} is not supported yet`);
  }

  async installFabric(profile, onProgress, signal) {
    signal?.throwIfAborted();
    let loaderVersion = profile.loaderVersion;
    if (loaderVersion) {
      const match = String(loaderVersion).trim().match(/^(?:fabric-|quilt-)?(?:loader-)?([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:\+[0-9A-Za-z._-]+)?)(?:-[0-9.]+)?$/i);
      if (match) {
        loaderVersion = match[1];
      }
    }
    let version = null;
    if (loaderVersion) {
      try {
        version = await fetchJson(
          `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(
            profile.minecraftVersion,
          )}/${encodeURIComponent(loaderVersion)}/profile/json`,
          { signal },
        );
      } catch {
        version = null;
      }
    }
    if (!version) {
      const loaders = await fetchJson(
        `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(
          profile.minecraftVersion,
        )}`,
        { signal },
      );
      loaderVersion =
        loaders.find((entry) => entry.loader?.stable)?.loader?.version ||
        loaders[0]?.loader?.version;
      if (!loaderVersion) throw new Error("Fabric Loader was not found for this version");
      version = await fetchJson(
        `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(
          profile.minecraftVersion,
        )}/${encodeURIComponent(loaderVersion)}/profile/json`,
        { signal },
      );
    }
    await this.saveCustomVersion(version);
    await this.installProfileLibraries(version, onProgress, signal);
    return version.id;
  }

  async installQuilt(profile, onProgress, signal) {
    signal?.throwIfAborted();
    let loaderVersion = profile.loaderVersion;
    if (loaderVersion) {
      const match = String(loaderVersion).trim().match(/^(?:fabric-|quilt-)?(?:loader-)?([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:\+[0-9A-Za-z._-]+)?)(?:-[0-9.]+)?$/i);
      if (match) {
        loaderVersion = match[1];
      }
    }
    let version = null;
    if (loaderVersion) {
      try {
        version = await fetchJson(
          `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(
            profile.minecraftVersion,
          )}/${encodeURIComponent(loaderVersion)}/profile/json`,
          { signal },
        );
      } catch {
        version = null;
      }
    }
    if (!version) {
      const loaders = await fetchJson(
        `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(
          profile.minecraftVersion,
        )}`,
        { signal },
      );
      loaderVersion = loaders
        .map((entry) => entry.loader?.version)
        .filter((v) => v && !v.includes("-"))
        .sort(compareSemanticVersions)
        .at(-1);
      if (!loaderVersion) throw new Error("Quilt Loader was not found for this version");
      version = await fetchJson(
        `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(
          profile.minecraftVersion,
        )}/${encodeURIComponent(loaderVersion)}/profile/json`,
        { signal },
      );
    }
    await this.saveCustomVersion(version);
    await this.installProfileLibraries(version, onProgress, signal);
    return version.id;
  }

  async installProfileLibraries(version, onProgress, signal) {
    const items = [];
    for (const library of version.libraries || []) {
      if (!applyRules(library.rules)) continue;
      const artifact = libraryArtifact(library);
      items.push({
        url: artifact.url,
        destination: path.join(this.sharedRoot, "libraries", artifact.path),
        sha1: artifact.sha1,
        size: artifact.size,
      });
    }
    await downloadMany(items, {
      concurrency: 8,
      signal,
      onProgress: ({ completed, count, received, total, speed, eta, current }) =>
        onProgress?.({
          stage: "loader",
          progress: 88 + Math.round((completed / Math.max(count, 1)) * 10),
          message:
            count > 1
              ? `Downloading loader libraries (${completed}/${count})…`
              : `Installing loader: ${current}`,
          completed,
          count,
          received,
          total,
          speed: speed ?? undefined,
          eta: eta ?? undefined,
        }),
    });
  }

  async saveCustomVersion(version) {
    const directory = path.join(this.sharedRoot, "versions", version.id);
    await fsp.mkdir(directory, { recursive: true });
    await fsp.writeFile(
      path.join(directory, `${version.id}.json`),
      JSON.stringify(version, null, 2),
      "utf8",
    );
  }

  async installForgeLike(profile, javaPath, onProgress, signal) {
    signal?.throwIfAborted();
    const loader = profile.loader.toLowerCase();
    let loaderVersion = profile.loaderVersion;
    if (!loaderVersion && loader === "forge") {
      const promotions = await fetchJson(
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
        { signal },
      );
      loaderVersion =
        promotions.promos?.[`${profile.minecraftVersion}-recommended`] ||
        promotions.promos?.[`${profile.minecraftVersion}-latest`];
    }
    if (!loaderVersion && loader === "neoforge") {
      const response = await fetchWithRetry(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
        { signal },
      );
      const xml = await response.text();
      const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(
        (match) => match[1],
      );
      const parts = profile.minecraftVersion.split(".");
      const prefix =
        parts[0] === "1"
          ? `${parts[1]}.${parts[2] || "0"}.`
          : `${parts[0]}.${parts[1] || "0"}.`;
      loaderVersion = versions.reverse().find((version) => version.startsWith(prefix));
    }
    if (!loaderVersion) {
      throw new Error(
        `Failed to find ${loader} for Minecraft ${profile.minecraftVersion}`,
      );
    }

    const coordinate =
      loader === "forge"
        ? `${profile.minecraftVersion}-${loaderVersion}`
        : loaderVersion;
    const base =
      loader === "forge"
        ? "https://maven.minecraftforge.net/net/minecraftforge/forge"
        : "https://maven.neoforged.net/releases/net/neoforged/neoforge";
    const artifact = loader === "forge" ? "forge" : "neoforge";
    const installer = path.join(
      this.sharedRoot,
      "installers",
      `${artifact}-${coordinate}-installer.jar`,
    );
    await downloadFile({
      url: `${base}/${coordinate}/${artifact}-${coordinate}-installer.jar`,
      destination: installer,
      signal,
      onProgress: ({ received, total, speed, eta }) =>
        onProgress?.({
          stage: "loader",
          progress: 88 + (total ? Math.round((received / total) * 4) : 1),
          message: `Downloading installer for ${loader}…`,
          received,
          total,
          speed: speed ?? undefined,
          eta: eta ?? undefined,
        }),
    });

    const launcherProfilesPath = path.join(this.sharedRoot, "launcher_profiles.json");
    try {
      await fsp.access(launcherProfilesPath);
    } catch {
      await fsp.mkdir(this.sharedRoot, { recursive: true });
      await fsp.writeFile(
        launcherProfilesPath,
        JSON.stringify({ profiles: {} }, null, 2),
        "utf8",
      );
    }

    await new Promise((resolve, reject) => {
      const executable = javaConsoleExecutable(javaPath);
      let aborted = false;
      const child = spawn(
        executable,
        ["-jar", installer, "--installClient", this.sharedRoot],
        {
          cwd: this.sharedRoot,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        onProgress?.({
          stage: "loader",
          progress: 94,
          message: `Installing ${loader}…`,
        });
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      const abort = () => {
        aborted = true;
        child.kill();
      };
      signal?.addEventListener("abort", abort, { once: true });
      child.on("error", reject);
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (aborted) {
          const error = new Error("Operation cancelled");
          error.name = "AbortError";
          reject(error);
        } else if (code === 0) resolve();
        else
          reject(
            new Error(
              `The ${loader} installer exited with code ${code}: ${output.slice(
                -500,
              )}`,
            ),
          );
      });
    });

    const versionRoot = path.join(this.sharedRoot, "versions");
    const directories = await fsp.readdir(versionRoot, { withFileTypes: true });
    const targetMatch = profile.loaderVersion
      ? directories
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .find((name) => name.includes(profile.loaderVersion))
      : null;
    const match =
      targetMatch ||
      directories
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter(
          (name) =>
            name.includes(profile.minecraftVersion) &&
            name.toLowerCase().includes(loader) &&
            (loader !== "forge" || !name.toLowerCase().includes("neoforge")),
        )
        .sort()
        .at(-1);
    if (!match) throw new Error(`The ${loader} profile did not appear after installation`);
    return match;
  }

  async installInstance(instance, settings, onProgress, signal) {
    signal?.throwIfAborted();
    const profile = loaderInfo(instance);
    await fsp.mkdir(this.instanceDirectory(instance.id), { recursive: true });
    const vanilla = await this.installVanilla(
      profile.minecraftVersion,
      onProgress,
      signal,
    );
    const requiredJava = vanilla.javaVersion?.majorVersion || this.javaForVersion(
      profile.minecraftVersion,
    );
    const javaPath = await this.javaService.resolve(
      requiredJava,
      settings.javaPath,
      (event) => {
        const adjusted =
          event.stage === "java"
            ? { ...event, progress: 88 + Math.round(event.progress * 0.08) }
            : event;
        onProgress?.(adjusted);
      },
      signal,
    );
    const versionId = await this.installLoader(
      profile,
      javaPath,
      onProgress,
      signal,
    );
    onProgress?.({
      stage: "ready",
      progress: 100,
      message: "Instance is ready",
    });
    return {
      resolvedVersionId: versionId,
      javaPath,
      javaMajor: requiredJava,
      installProfile: {
        ...profile,
        loaderVersion:
          profile.loaderVersion ||
          this.loaderVersionFromId(profile.loader, versionId),
      },
    };
  }

  loaderVersionFromId(loader, versionId) {
    if (!loader || loader === "vanilla") return null;
    const lower = String(loader).toLowerCase();
    if (lower === "fabric" || lower === "quilt") {
      const match = String(versionId).match(/(?:fabric|quilt)-loader-([0-9A-Za-z.+_-]+?)(?:-[0-9.]+)?$/i);
      if (match) return match[1];
    }
    const marker = `${loader}-`;
    const index = versionId.toLowerCase().lastIndexOf(marker);
    return index >= 0 ? versionId.slice(index + marker.length) : null;
  }

  javaForVersion(version) {
    const [major, minor] = String(version).split(".").map(Number);
    if (major === 1 && minor <= 16) return 8;
    if (major === 1 && minor <= 20) return 17;
    return 21;
  }

  async resolveJavaForLaunch(requiredMajor, settings, instance) {
    const preferredPath = settings.javaPath || instance.javaPath || "";
    return this.javaService.resolve(requiredMajor, preferredPath);
  }

  async loadResolvedVersion(versionId) {
    const seen = new Set();
    const load = async (id) => {
      if (seen.has(id)) throw new Error(`Cyclic version inheritance for ${id}`);
      seen.add(id);
      const jsonPath = path.join(
        this.sharedRoot,
        "versions",
        id,
        `${id}.json`,
      );
      const current = JSON.parse(await fsp.readFile(jsonPath, "utf8"));
      if (!current.inheritsFrom) return current;
      const parent = await load(current.inheritsFrom);
      return mergeVersion(parent, current);
    };
    return load(versionId);
  }

  async buildLaunch({
    instance,
    settings,
    account,
    demo,
    launchWrapper,
    extraJvmArguments = [],
    logFileName = "scope-latest.log",
    onLog,
    onSpawn,
    onExit,
  }) {
    const versionId = instance.resolvedVersionId || instance.version;
    const version = await this.loadResolvedVersion(versionId);
    const requiredJava =
      version.javaVersion?.majorVersion ||
      this.javaForVersion(instance.version);
    const gameDirectory = this.instanceDirectory(instance.id);
    const nativesDirectory = path.join(
      this.sharedRoot,
      "natives",
      version.inheritsFrom || version.jar || instance.version,
    );
    const libraries = [];
    const seenPaths = new Set();
    const seenKeys = new Set();
    for (const library of version.libraries || []) {
      if (!applyRules(library.rules)) continue;
      if (library.natives && !library.downloads?.artifact) continue;
      const key = libraryKey(library);
      if (key && seenKeys.has(key)) continue;
      try {
        const artifact = libraryArtifact(library);
        const filePath = path.join(this.sharedRoot, "libraries", artifact.path);
        if (seenPaths.has(filePath)) continue;
        if (fs.existsSync(filePath)) {
          if (key) seenKeys.add(key);
          seenPaths.add(filePath);
          libraries.push(filePath);
        }
      } catch {
        // Ignore native-only or malformed optional library.
      }
    }
    const jarId = version.jar || version.inheritsFrom || version.id;
    const clientJar = path.join(
      this.sharedRoot,
      "versions",
      jarId,
      `${jarId}.jar`,
    );
    if (!seenPaths.has(clientJar)) {
      seenPaths.add(clientJar);
      libraries.push(clientJar);
    }
    if (Array.isArray(extraJvmArguments)) {
      for (const arg of extraJvmArguments) {
        if (typeof arg === "string" && arg.startsWith("-javaagent:")) {
          const jarPart = arg.slice("-javaagent:".length).split("=")[0];
          if (jarPart && !seenPaths.has(jarPart) && fs.existsSync(jarPart)) {
            seenPaths.add(jarPart);
            libraries.push(jarPart);
          }
        }
      }
    }
    const classpath = libraries.join(path.delimiter);

    const localName = account?.name || "Player";
    const localUuid = offlineUuid(localName);
    const launchAccount = account || {
      name: localName,
      uuid: localUuid.replaceAll("-", ""),
      accessToken: "0",
      userType: "legacy",
      xuid: "",
      clientId: "",
    };
    const features = {
      is_demo_user: Boolean(demo),
      has_custom_resolution: true,
      has_quick_plays_support: false,
      is_quick_play_singleplayer: false,
      is_quick_play_multiplayer: false,
      is_quick_play_realms: false,
    };
    const variables = {
      natives_directory: nativesDirectory,
      launcher_name: "scope-launcher",
      launcher_version: ONYX_VERSION,
      classpath,
      classpath_separator: path.delimiter,
      library_directory: path.join(this.sharedRoot, "libraries"),
      auth_player_name: launchAccount.name,
      version_name: versionId,
      game_directory: gameDirectory,
      assets_root: path.join(this.sharedRoot, "assets"),
      assets_index_name: version.assetIndex?.id || version.assets || "legacy",
      auth_uuid: launchAccount.uuid.replaceAll("-", ""),
      auth_access_token: launchAccount.accessToken,
      clientid: launchAccount.clientId || "",
      auth_xuid: launchAccount.xuid || "",
      user_type: launchAccount.userType || "msa",
      version_type: version.type || "release",
      user_properties: "{}",
      resolution_width: settings.windowWidth || 1280,
      resolution_height: settings.windowHeight || 720,
      quickPlayPath: "",
      quickPlaySingleplayer: "",
      quickPlayMultiplayer: "",
      quickPlayRealms: "",
    };

    let jvmArguments = expandArguments(version.arguments?.jvm, features).map(
      (argument) => replaceVariables(argument, variables),
    );
    if (jvmArguments.length === 0) {
      jvmArguments = [
        `-Djava.library.path=${nativesDirectory}`,
        "-cp",
        classpath,
      ];
    }
    const hasCustomGc = (settings.jvmArguments || []).some((arg) => typeof arg === "string" && /-XX:\+Use.*GC/i.test(arg));
    const optimizedGc = hasCustomGc
      ? []
      : generateOptimizedJvmFlags({
          memoryGiB: settings.memory || 6,
          javaMajor: settings.javaMajor || 17,
        });

    jvmArguments.unshift(
      `-Xms${Math.min(2, settings.memory || 6)}G`,
      `-Xmx${settings.memory || 6}G`,
      ...optimizedGc,
      "-Dfile.encoding=UTF-8",
      "-Djava.net.preferIPv4Stack=true",
    );
    if (version.logging?.client?.argument && version.logging?.client?.file?.id) {
      jvmArguments.push(
        replaceVariables(version.logging.client.argument, {
          path: path.join(
            this.sharedRoot,
            "assets",
            "log_configs",
            version.logging.client.file.id,
          ),
        }),
      );
    }
    if (Array.isArray(settings.jvmArguments)) {
      jvmArguments.push(
        ...settings.jvmArguments
          .filter((argument) => typeof argument === "string")
          .map((argument) => argument.trim())
          .filter(Boolean)
          .slice(0, 24),
      );
    }
    if (Array.isArray(extraJvmArguments)) {
      const isJava8 = (settings.javaMajor || requiredJava || 17) <= 8;
      jvmArguments.push(
        ...extraJvmArguments
          .filter((argument) => typeof argument === "string")
          .map((argument) => argument.trim())
          .filter((argument) => {
            if (!argument) return false;
            if (isJava8 && (argument.startsWith("--add-reads") || argument.startsWith("--add-opens") || argument.startsWith("--add-modules"))) {
              return false;
            }
            return true;
          }),
      );
    }

    let gameArguments;
    if (version.arguments?.game?.length) {
      gameArguments = expandArguments(version.arguments.game, features).map(
        (argument) => replaceVariables(argument, variables),
      );
    } else {
      gameArguments = String(version.minecraftArguments || "")
        .match(/(?:[^\s"]+|"[^"]*")+/g)
        ?.map((argument) =>
          replaceVariables(argument.replace(/^"|"$/g, ""), variables),
        ) || [];
      if (demo) gameArguments.push("--demo");
    }
    if (settings.fullscreen && !gameArguments.includes("--fullscreen")) {
      gameArguments.push("--fullscreen");
    }
    const quickJoin = parseServerAddress(settings.serverAddress);
    if (quickJoin && !gameArguments.includes("--server")) {
      gameArguments.push(
        "--server",
        quickJoin.host,
        "--port",
        String(quickJoin.port),
      );
    }

    await fsp.mkdir(path.join(gameDirectory, "logs"), { recursive: true });
    const logPath = path.join(gameDirectory, "logs", logFileName || "scope-latest.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    logStream.write(
      `\n[${new Date().toISOString()}] Scope is launching ${versionId}\n`,
    );
    const javaPath = await this.resolveJavaForLaunch(
      requiredJava,
      settings,
      instance,
    );
    const executable = javaConsoleExecutable(javaPath);
    const args = [...jvmArguments, version.mainClass, ...gameArguments];
    const spawnExecutable = launchWrapper?.executable || executable;
    const spawnArgs = launchWrapper
      ? [
          ...(launchWrapper.argsBeforeExecutable || []),
          executable,
          ...args,
        ]
      : args;
    const child = spawn(spawnExecutable, spawnArgs, {
      cwd: gameDirectory,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(launchWrapper?.env || {}) },
    });
    onSpawn?.(child.pid);
    const handle = (channel) => (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      onLog?.({ channel, text, logPath });
    };
    child.stdout.on("data", handle("stdout"));
    child.stderr.on("data", handle("stderr"));
    child.on("error", (error) => handle("error")(`${error.message}\n`));
    child.on("close", (code) => {
      logStream.end(
        `\n[${new Date().toISOString()}] Game exited with code ${code}\n`,
      );
      onExit?.({ code, logPath });
    });
    return {
      child,
      logPath,
      args,
      executable,
      spawnExecutable,
      spawnArgs,
    };
  }
}

module.exports = {
  MinecraftService,
  applyRules,
  mavenArtifact,
  libraryKey,
  mergeVersion,
  expandArguments,
  replaceVariables,
  loaderInfo,
  compareSemanticVersions,
  parseServerAddress,
  normalizeResolvedVersionId,
};
