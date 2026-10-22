const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  fetchJson,
  downloadFile,
  downloadMany,
} = require("./network.cjs");
const {
  readZipJson,
  extractZip,
  safeDestination,
} = require("./archive.cjs");

function profileFromDependencies(dependencies = {}) {
  if (!dependencies.minecraft) {
    throw new Error("The modpack does not specify a Minecraft version");
  }
  const candidates = [
    ["fabric", dependencies["fabric-loader"]],
    ["quilt", dependencies["quilt-loader"]],
    ["neoforge", dependencies.neoforge],
    ["forge", dependencies.forge],
  ];
  const selected = candidates.find(([, version]) => Boolean(version));
  return {
    minecraftVersion: dependencies.minecraft,
    loader: selected?.[0] || "vanilla",
    loaderVersion: selected?.[1] || null,
  };
}

function selectPackRelease(versions = []) {
  return (
    versions.find(
      (version) =>
        version.version_type === "release" &&
        version.files.some((file) => file.filename.endsWith(".mrpack")),
    ) ||
    versions.find((version) =>
      version.files.some((file) => file.filename.endsWith(".mrpack")),
    ) ||
    null
  );
}

function clientPackFiles(index) {
  return new Map(
    (index?.files || [])
      .filter(
        (file) =>
          file?.path &&
          file.env?.client !== "unsupported",
      )
      .map((file) => {
        const normalizedPath = file.path.replaceAll("\\", "/");
        return [
          normalizedPath,
          {
            path: normalizedPath,
            size: Number(file.fileSize || 0),
            hash: file.hashes?.sha512 || file.hashes?.sha1 || null,
          },
        ];
      }),
  );
}

function comparePackIndexes(previousIndex, nextIndex) {
  const previous = clientPackFiles(previousIndex);
  const next = clientPackFiles(nextIndex);
  const added = [];
  const changed = [];
  const removed = [];
  let unchanged = 0;
  for (const [filePath, file] of next) {
    const known = previous.get(filePath);
    if (!known) {
      added.push(file);
    } else if (
      known.hash !== file.hash ||
      known.size !== file.size
    ) {
      changed.push({ ...file, previousSize: known.size });
    } else {
      unchanged += 1;
    }
  }
  for (const [filePath, file] of previous) {
    if (!next.has(filePath)) removed.push(file);
  }
  const byPath = (left, right) => left.path.localeCompare(right.path);
  added.sort(byPath);
  changed.sort(byPath);
  removed.sort(byPath);
  return {
    added,
    changed,
    removed,
    unchanged,
    downloadBytes: [...added, ...changed].reduce(
      (sum, file) => sum + file.size,
      0,
    ),
  };
}

class ModpackService {
  constructor({ packsRoot, instancesRoot, minecraftService }) {
    this.packsRoot = packsRoot;
    this.instancesRoot = instancesRoot;
    this.minecraftService = minecraftService;
  }

  async downloadProjectPack(project, onProgress, signal) {
    signal?.throwIfAborted();
    const versions = await fetchJson(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(
        project.project_id,
      )}/version`,
      { signal },
    );
    const release = selectPackRelease(versions);
    if (!release) throw new Error("The project does not provide an installable .mrpack file");
    const file =
      release.files.find(
        (item) => item.primary && item.filename.endsWith(".mrpack"),
      ) ||
      release.files.find((item) => item.filename.endsWith(".mrpack"));
    const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const destination = path.join(
      this.packsRoot,
      project.project_id,
      safeName,
    );
    await downloadFile({
      url: file.url,
      destination,
      sha1: file.hashes?.sha1,
      sha512: file.hashes?.sha512,
      size: file.size,
      signal,
      onProgress: ({ received, total, speed, eta }) =>
        onProgress?.({
          stage: "pack",
          progress: total ? Math.round((received / total) * 10) : 4,
          message: `Downloading package ${project.title}…`,
          received,
          total,
          speed: speed ?? undefined,
          eta: eta ?? undefined,
        }),
    });
    return { packPath: destination, release };
  }

  async installPack({
    packPath,
    project,
    settings,
    instanceId = crypto.randomUUID(),
    onProgress,
    signal,
  }) {
    signal?.throwIfAborted();
    onProgress?.({
      stage: "pack",
      progress: 11,
      message: "Reading the modpack manifest…",
    });

    let index;
    try {
      index = await readZipJson(packPath, "modrinth.index.json");
    } catch {
      try {
        const manifest = await readZipJson(packPath, "manifest.json");
        if (manifest.manifestType === "minecraftModpack" || manifest.files) {
          const curseforgeService = require("./curseforge.cjs");
          const result = await curseforgeService.installCurseForgeModpack({
            instancesRoot: this.instancesRoot,
            archivePath: packPath,
            packName: manifest.name,
            onProgress: (p) => {
              onProgress?.({
                stage: p.stage,
                progress: Math.round(p.progress * 100),
                message: p.message,
                speed: p.speed,
                eta: p.eta,
              });
            },
          });
          return result.metadata;
        }
      } catch {
        // Fall through to error below
      }
      throw new Error(
        "Unsupported modpack format: neither modrinth.index.json nor manifest.json found",
      );
    }

    if (index.formatVersion !== 1) {
      throw new Error(
        `Modrinth format version ${index.formatVersion} is not supported`,
      );
    }
    const profile = profileFromDependencies(index.dependencies);
    const gameDirectory = path.join(this.instancesRoot, instanceId);
    await fsp.mkdir(gameDirectory, { recursive: true });

    await extractZip(packPath, gameDirectory, {
      mapPath: (entryName) => {
        const normalized = entryName.replaceAll("\\", "/");
        const prefixes = ["overrides/", "client-overrides/"];
        const prefix = prefixes.find((item) => normalized.startsWith(item));
        if (!prefix) return null;
        const relative = normalized.slice(prefix.length);
        return relative || null;
      },
      onProgress: ({ extracted, count, current }) =>
        onProgress?.({
          stage: "overrides",
          progress: 11 + Math.round((extracted / Math.max(count, 1)) * 9),
          message:
            count > 1
              ? `Extracting configuration (${extracted}/${count})…`
              : `Extracting configuration: ${current}`,
        }),
    });
    signal?.throwIfAborted();

    const files = (index.files || [])
      .filter((file) => file.env?.client !== "unsupported")
      .map((file) => ({
        url: file.downloads?.[0],
        destination: safeDestination(gameDirectory, file.path),
        sha1: file.hashes?.sha1,
        sha512: file.hashes?.sha512,
        size: file.fileSize,
      }))
      .filter((file) => Boolean(file.url));
    await downloadMany(files, {
      concurrency: 10,
      signal,
      onProgress: ({
        completed,
        count,
        received,
        total,
        speed,
        eta,
        current,
      }) => {
        const byFiles = completed / Math.max(count, 1);
        const byBytes = total ? received / total : byFiles;
        onProgress?.({
          stage: "content",
          progress: 20 + Math.round(Math.max(byFiles, byBytes) * 44),
          message:
            count > 1
              ? `Downloading mods (${completed}/${count})…`
              : `Downloading mod: ${current}`,
          completed,
          count,
          received,
          total,
          speed: speed ?? undefined,
          eta: eta ?? undefined,
        });
      },
    });

    const initialInstance = {
      id: instanceId,
      sourceProjectId: project?.project_id,
      sourceVersionId: project?.versionId,
      name: index.name || project?.title || path.basename(packPath, ".mrpack"),
      version: profile.minecraftVersion,
      loader:
        profile.loader === "vanilla"
          ? "Vanilla"
          : `${profile.loader[0].toUpperCase()}${profile.loader.slice(1)} ${
              profile.loaderVersion || ""
            }`.trim(),
      description:
        index.summary || project?.description || "Modrinth modpack",
      color: "cyan",
      glyph: (index.name || project?.title || "MR").slice(0, 2).toUpperCase(),
      iconUrl: project?.icon_url || null,
      favorite: false,
      status: "installing",
      lastPlayed: "Never played",
      playtimeMinutes: 0,
      modCount: files.filter((file) =>
        file.destination.toLowerCase().endsWith(".jar"),
      ).length,
      packPath,
      installProfile: profile,
    };

    const installed = await this.minecraftService.installInstance(
      initialInstance,
      settings,
      (event) =>
        onProgress?.({
          ...event,
          progress: 64 + Math.round((event.progress / 100) * 36),
        }),
      signal,
    );

    return {
      ...initialInstance,
      ...installed,
      status: "ready",
      installedAt: new Date().toISOString(),
      packVersion: index.versionId,
    };
  }

  async installProject({
    project,
    settings,
    instanceId,
    onProgress,
    signal,
  }) {
    const { packPath, release } = await this.downloadProjectPack(
      project,
      onProgress,
      signal,
    );
    return this.installPack({
      packPath,
      settings,
      project: {
        ...project,
        versionId: release.id,
      },
      instanceId,
      onProgress,
      signal,
    });
  }

  async checkProjectUpdate(instance) {
    if (!instance.sourceProjectId) return null;
    const versions = await fetchJson(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(
        instance.sourceProjectId,
      )}/version`,
    );
    const release = selectPackRelease(versions);
    if (!release || release.id === instance.sourceVersionId) return null;
    return {
      versionId: release.id,
      versionNumber: release.version_number,
      name: release.name,
      datePublished: release.date_published,
    };
  }

  async previewProjectUpdate({ instance, onProgress, signal }) {
    if (!instance.sourceProjectId) {
      throw new Error("The instance is not linked to a Modrinth project");
    }
    const { packPath, release } = await this.downloadProjectPack(
      {
        project_id: instance.sourceProjectId,
        title: instance.name,
      },
      onProgress,
      signal,
    );
    if (release.id === instance.sourceVersionId) return null;
    let previousIndex = null;
    try {
      if (instance.packPath) {
        previousIndex = await readZipJson(
          instance.packPath,
          "modrinth.index.json",
        );
      }
    } catch {
      // A cleared old pack cache means the preview cannot classify removals.
    }
    const nextIndex = await readZipJson(packPath, "modrinth.index.json");
    const changes = comparePackIndexes(previousIndex, nextIndex);
    const nextProfile = profileFromDependencies(nextIndex.dependencies);
    const currentProfile = previousIndex
      ? profileFromDependencies(previousIndex.dependencies)
      : instance.installProfile || null;
    return {
      versionId: release.id,
      versionNumber: release.version_number,
      name: release.name,
      datePublished: release.date_published,
      baselineAvailable: Boolean(previousIndex),
      currentProfile,
      nextProfile,
      ...changes,
    };
  }

  async updateProject({ instance, settings, onProgress, signal }) {
    if (!instance.sourceProjectId) {
      throw new Error("The instance is not linked to a Modrinth project");
    }
    const project = await fetchJson(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(
        instance.sourceProjectId,
      )}`,
      { signal },
    );
    const { packPath, release } = await this.downloadProjectPack(
      {
        project_id: instance.sourceProjectId,
        title: project.title || instance.name,
      },
      onProgress,
      signal,
    );
    if (release.id === instance.sourceVersionId) {
      return { instance, updated: false };
    }

    let oldIndex = null;
    try {
      if (instance.packPath) {
        oldIndex = await readZipJson(instance.packPath, "modrinth.index.json");
      }
    } catch {
      // The old pack cache may have been cleared.
    }
    const nextIndex = await readZipJson(packPath, "modrinth.index.json");
    const nextPaths = new Set(
      (nextIndex.files || [])
        .filter((file) => file.env?.client !== "unsupported")
        .map((file) => file.path.replaceAll("\\", "/")),
    );
    const obsolete = (oldIndex?.files || [])
      .filter((file) => file.env?.client !== "unsupported")
      .map((file) => file.path.replaceAll("\\", "/"))
      .filter((filePath) => !nextPaths.has(filePath));
    const instanceDirectory = path.join(this.instancesRoot, instance.id);
    const historyRoot = path.join(
      instanceDirectory,
      ".onyx",
      "history",
      `pack-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    for (const relative of obsolete) {
      const source = safeDestination(instanceDirectory, relative);
      const stat = await fsp.stat(source).catch(() => null);
      if (!stat?.isFile()) continue;
      const destination = safeDestination(historyRoot, relative);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.rename(source, destination);
    }

    const installed = await this.installPack({
      packPath,
      project: {
        ...project,
        project_id: instance.sourceProjectId,
        versionId: release.id,
      },
      settings,
      instanceId: instance.id,
      onProgress,
      signal,
    });
    return {
      updated: true,
      instance: {
        ...instance,
        ...installed,
        id: instance.id,
        favorite: instance.favorite,
        playtimeMinutes: instance.playtimeMinutes,
        lastPlayed: instance.lastPlayed,
        settings: instance.settings,
        sourceProjectId: instance.sourceProjectId,
        sourceVersionId: release.id,
        packVersion: nextIndex.versionId,
        updateAvailable: null,
      },
      release,
      obsoleteFiles: obsolete.length,
    };
  }
}

module.exports = {
  ModpackService,
  profileFromDependencies,
  selectPackRelease,
  comparePackIndexes,
};
