const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
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

const CURSEFORGE_API = "https://api.curseforge.com/v1";
const MINECRAFT_GAME_ID = 432;

// Standard API key issued for open-source launcher usage (same as Prism Launcher)
const DEFAULT_CURSEFORGE_KEY =
  "$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC";

function getApiKey() {
  return process.env.CURSEFORGE_API_KEY || DEFAULT_CURSEFORGE_KEY;
}

const CLASS_IDS = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
};

const MOD_LOADER_TYPES = {
  forge: 1,
  cauldron: 2,
  liteloader: 3,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

function resolveFileUrl(file) {
  if (!file) return null;
  if (file.downloadUrl) return file.downloadUrl;
  if (!file.id || !file.fileName) return null;
  const part1 = Math.floor(file.id / 1000);
  const part2 = file.id % 1000;
  return `https://edge.forgecdn.net/files/${part1}/${part2}/${encodeURIComponent(
    file.fileName,
  )}`;
}

function normalizeCurseForgeProject(mod, defaultType = "mod") {
  let projectType = defaultType;
  if (mod.classId === CLASS_IDS.modpack) projectType = "modpack";
  else if (mod.classId === CLASS_IDS.mod) projectType = "mod";
  else if (mod.classId === CLASS_IDS.resourcepack) projectType = "resourcepack";
  else if (mod.classId === CLASS_IDS.shader) projectType = "shader";

  const loaders = new Set();
  const versions = new Set();

  for (const index of mod.latestFilesIndexes || []) {
    if (index.gameVersion && /^\d+\.\d+/.test(index.gameVersion)) {
      versions.add(index.gameVersion);
    }
    if (index.modLoader === 1) loaders.add("forge");
    else if (index.modLoader === 4) loaders.add("fabric");
    else if (index.modLoader === 5) loaders.add("quilt");
    else if (index.modLoader === 6) loaders.add("neoforge");
  }

  const authors =
    (mod.authors || []).map((a) => a.name).join(", ") || "Unknown";
  const categories = (mod.categories || []).map(
    (c) => c.slug || c.name?.toLowerCase() || "",
  );

  return {
    project_id: String(mod.id),
    project_type: projectType,
    slug: mod.slug,
    author: authors,
    title: mod.name,
    description: mod.summary || "",
    body: mod.description || "",
    categories: [...categories, ...loaders],
    versions: Array.from(versions).slice(0, 12),
    downloads: mod.downloadCount || 0,
    follows: mod.thumbsUpCount || 0,
    icon_url: mod.logo?.thumbnailUrl || mod.logo?.url || null,
    banner_url: mod.screenshots?.[0]?.url || null,
    date_modified: mod.dateModified || mod.dateReleased,
    latest_version: mod.latestFiles?.[0]?.displayName || "",
    license: "CurseForge",
    client_side: "required",
    server_side: "optional",
    source: "curseforge",
    curseforgeId: mod.id,
    gallery: (mod.screenshots || []).map((s) => ({
      url: s.url,
      title: s.title || "",
      description: s.description || "",
      featured: false,
    })),
    links: {
      website: mod.links?.websiteUrl,
      wiki: mod.links?.wikiUrl,
      issues: mod.links?.issuesUrl,
      source: mod.links?.sourceUrl,
    },
  };
}

async function cfFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${CURSEFORGE_API}${endpoint}`;
  return fetchJson(url, {
    ...options,
    headers: {
      "x-api-key": getApiKey(),
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
}

async function searchCurseForge({
  query = "",
  type = "modpack",
  gameVersion = "",
  loader = "",
  index = 0,
  pageSize = 20,
  sortField = 2, // 1 = Featured, 2 = Popularity, 3 = LastUpdated, 4 = Name, 5 = TotalDownloads
  sortOrder = "desc",
}) {
  const params = new URLSearchParams();
  params.set("gameId", String(MINECRAFT_GAME_ID));

  const classId = CLASS_IDS[type] || CLASS_IDS.modpack;
  params.set("classId", String(classId));

  if (query && query.trim()) {
    params.set("searchFilter", query.trim());
  }
  if (gameVersion) {
    params.set("gameVersion", gameVersion);
  }
  if (loader && MOD_LOADER_TYPES[loader.toLowerCase()]) {
    params.set("modLoaderType", String(MOD_LOADER_TYPES[loader.toLowerCase()]));
  }

  params.set("index", String(index));
  params.set("pageSize", String(Math.min(pageSize, 50)));
  params.set("sortField", String(sortField));
  params.set("sortOrder", sortOrder);

  const res = await cfFetch(`/mods/search?${params.toString()}`);
  const hits = (res.data || []).map((m) =>
    normalizeCurseForgeProject(m, type),
  );
  const total = res.pagination?.totalCount ?? hits.length;

  return {
    hits,
    total_hits: total,
    offset: index,
    limit: pageSize,
  };
}

async function getCurseForgeMod(modId) {
  const res = await cfFetch(`/mods/${encodeURIComponent(modId)}`);
  if (!res?.data) {
    throw new Error(`CurseForge mod ${modId} not found`);
  }
  return {
    ...normalizeCurseForgeProject(res.data),
    raw: res.data,
  };
}

async function getCurseForgeDescription(modId) {
  const res = await cfFetch(`/mods/${encodeURIComponent(modId)}/description`);
  return res?.data || "";
}

async function getCurseForgeFiles(modId, options = {}) {
  const params = new URLSearchParams();
  if (options.gameVersion) {
    params.set("gameVersion", options.gameVersion);
  }
  if (options.loader && MOD_LOADER_TYPES[options.loader.toLowerCase()]) {
    params.set(
      "modLoaderType",
      String(MOD_LOADER_TYPES[options.loader.toLowerCase()]),
    );
  }
  params.set("pageSize", String(options.pageSize || 25));
  if (options.index) {
    params.set("index", String(options.index));
  }

  const res = await cfFetch(
    `/mods/${encodeURIComponent(modId)}/files?${params.toString()}`,
  );
  return (res.data || []).map((f) => ({
    id: f.id,
    displayName: f.displayName,
    fileName: f.fileName,
    fileDate: f.fileDate,
    fileLength: f.fileLength,
    releaseType: f.releaseType, // 1 = Release, 2 = Beta, 3 = Alpha
    downloadUrl: resolveFileUrl(f),
    gameVersions: f.gameVersions || [],
  }));
}

async function getCurseForgeFilesBatch(fileIds) {
  if (!fileIds?.length) return [];
  const chunkSize = 50;
  const results = [];

  for (let i = 0; i < fileIds.length; i += chunkSize) {
    const slice = fileIds.slice(i, i + chunkSize);
    const res = await cfFetch("/mods/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileIds: slice }),
    });
    if (Array.isArray(res?.data)) {
      results.push(...res.data);
    }
  }

  return results.map((f) => ({
    id: f.id,
    modId: f.modId,
    displayName: f.displayName,
    fileName: f.fileName,
    downloadUrl: resolveFileUrl(f),
    fileLength: f.fileLength,
    hashes: f.hashes || [],
  }));
}

function parseManifestLoader(manifest) {
  const mcVersion = manifest.minecraft?.version;
  if (!mcVersion) {
    throw new Error("Invalid CurseForge modpack manifest: missing Minecraft version");
  }

  const loaders = manifest.minecraft?.modLoaders || [];
  let loader = "vanilla";
  let loaderVersion = null;

  for (const l of loaders) {
    const id = String(l.id || "").toLowerCase();
    if (id.startsWith("forge-")) {
      loader = "forge";
      loaderVersion = id.replace("forge-", "");
      break;
    } else if (id.startsWith("neoforge-")) {
      loader = "neoforge";
      loaderVersion = id.replace("neoforge-", "");
      break;
    } else if (id.startsWith("fabric-")) {
      loader = "fabric";
      loaderVersion = id.replace("fabric-", "");
      break;
    } else if (id.startsWith("quilt-")) {
      loader = "quilt";
      loaderVersion = id.replace("quilt-", "");
      break;
    }
  }

  return {
    minecraftVersion: mcVersion,
    loader,
    loaderVersion,
  };
}

async function installCurseForgeMod({
  instancesRoot,
  instanceId,
  modId,
  fileId,
  gameVersion,
  loader,
  signal,
  onProgress,
}) {
  const root = path.resolve(instancesRoot);
  const instanceDir = path.resolve(root, String(instanceId));
  if (!instanceDir.startsWith(`${root}${path.sep}`)) {
    throw new Error("Instance is outside the instances directory");
  }

  let file;
  if (fileId) {
    const batch = await getCurseForgeFilesBatch([Number(fileId)]);
    file = batch[0];
  } else {
    const files = await getCurseForgeFiles(modId, {
      gameVersion,
      loader,
      pageSize: 10,
    });
    file = files.find((f) => f.releaseType === 1) || files[0];
  }

  if (!file) {
    throw new Error(`File ${fileId || "compatible"} for mod ${modId} not found`);
  }

  const downloadUrl = resolveFileUrl(file);
  if (!downloadUrl) {
    throw new Error(
      `Could not resolve download URL for ${file.fileName || file.displayName}`,
    );
  }

  const modsDir = path.join(instanceDir, "mods");
  await fsp.mkdir(modsDir, { recursive: true });
  const destination = path.join(modsDir, file.fileName);

  await downloadFile({ url: downloadUrl, destination, signal, onProgress });
  return {
    destination,
    fileName: file.fileName,
    fileId: file.id,
  };
}

async function installCurseForgeModpack({
  instancesRoot,
  instanceId: preferredInstanceId,
  archivePath,
  fileUrl,
  fileId,
  modId,
  packName,
  signal,
  onProgress,
}) {
  let zipPath = archivePath;
  let tempZip = false;

  try {
    if (!instancesRoot || typeof instancesRoot !== "string") {
      throw new Error("Invalid instances directory specified");
    }

    // 1. If no local archive, download the modpack zip
    if (!zipPath) {
      let downloadUrl = fileUrl;
      if (!downloadUrl && fileId) {
        const batch = await getCurseForgeFilesBatch([Number(fileId)]);
        downloadUrl = resolveFileUrl(batch[0]);
      } else if (!downloadUrl && modId) {
        const files = await getCurseForgeFiles(modId, { pageSize: 1 });
        downloadUrl = resolveFileUrl(files[0]);
      }

      if (!downloadUrl) {
        throw new Error("No download URL found for CurseForge modpack");
      }

      onProgress?.({
        stage: "downloading_pack",
        progress: 0.1,
        message: "Downloading CurseForge modpack archive…",
      });

      const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "onyx-cf-"));
      zipPath = path.join(tempDir, "modpack.zip");
      tempZip = true;
      await downloadFile({
        url: downloadUrl,
        destination: zipPath,
        signal,
        onProgress: (p) => {
          onProgress?.({
            stage: "downloading_pack",
            progress: 0.1 + (p.received / (p.total || 1)) * 0.2,
            message: `Downloading modpack (${Math.round((p.received / 1024 / 1024) * 10) / 10} MB)…`,
            received: p.received,
            total: p.total,
            speed: p.speed,
            eta: p.eta,
          });
        },
      });
    }

    // 2. Read manifest.json
    onProgress?.({
      stage: "reading_manifest",
      progress: 0.35,
      message: "Reading modpack manifest…",
    });

    const manifest = await readZipJson(zipPath, "manifest.json");
    const { minecraftVersion, loader, loaderVersion } =
      parseManifestLoader(manifest);

    const safeName = (packName || manifest.name || "CurseForge Modpack")
      .replace(/[<>:"/\\|?*]/g, "_")
      .trim();

    const instanceId =
      preferredInstanceId ||
      `cf-${manifest.name ? manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "pack"}-${Date.now().toString(36)}`;
    const instanceDir = safeDestination(instancesRoot, instanceId);
    await fsp.mkdir(instanceDir, { recursive: true });

    // 3. Resolve mod files in batch
    const requiredFiles = (manifest.files || []).map((f) => f.fileID);
    onProgress?.({
      stage: "resolving_mods",
      progress: 0.4,
      message: `Resolving ${requiredFiles.length} mods from CurseForge…`,
    });

    const resolvedFiles = await getCurseForgeFilesBatch(requiredFiles);
    const modsDir = path.join(instanceDir, "mods");
    await fsp.mkdir(modsDir, { recursive: true });

    const downloadItems = [];
    const missingMods = [];

    for (const rf of resolvedFiles) {
      const url = resolveFileUrl(rf);
      if (url && rf.fileName) {
        downloadItems.push({
          url,
          destination: path.join(modsDir, rf.fileName),
          size: rf.fileLength,
        });
      } else {
        missingMods.push(rf.id);
      }
    }

    // 4. Download all mods concurrently
    onProgress?.({
      stage: "downloading_mods",
      progress: 0.45,
      message: `Downloading ${downloadItems.length} mods…`,
    });

    await downloadMany(downloadItems, {
      concurrency: 10,
      signal,
      onProgress: (p) => {
        const ratio = p.count > 0 ? p.completed / p.count : 0;
        onProgress?.({
          stage: "downloading_mods",
          progress: 0.45 + ratio * 0.45,
          message: `Downloading mods (${p.completed}/${p.count})…`,
          received: p.received,
          total: p.total,
          completed: p.completed,
          count: p.count,
          speed: p.speed,
          eta: p.eta,
        });
      },
    });

    // 5. Extract overrides
    onProgress?.({
      stage: "extracting_overrides",
      progress: 0.92,
      message: "Extracting configuration and pack overrides…",
    });

    const overridesFolder = `${manifest.overrides || "overrides"}/`;
    await extractZip(zipPath, instanceDir, {
      mapPath: (name) => {
        if (name.startsWith(overridesFolder)) {
          return name.slice(overridesFolder.length);
        }
        return null;
      },
    });

    // 6. Write instance.json metadata
    onProgress?.({
      stage: "finishing",
      progress: 0.98,
      message: "Finalizing instance configuration…",
    });

    const instanceMetadata = {
      id: instanceId,
      name: safeName,
      version: minecraftVersion,
      loader,
      loaderVersion,
      iconUrl: null,
      color: "amber",
      installedAt: new Date().toISOString(),
      lastPlayed: null,
      playtimeMinutes: 0,
      status: "ready",
      resolvedVersionId: null,
      glyph: safeName.slice(0, 2).toUpperCase(),
      description: manifest.name || "",
      favorite: false,
      modCount: downloadItems.length,
      source: "curseforge",
      curseforgeProject: {
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
      },
    };

    await fsp.writeFile(
      path.join(instanceDir, "instance.json"),
      JSON.stringify(instanceMetadata, null, 2),
      "utf8",
    );

    return {
      instanceId,
      name: safeName,
      instanceDir,
      metadata: instanceMetadata,
      modCount: downloadItems.length,
      missingModsCount: missingMods.length,
    };
  } finally {
    if (tempZip && zipPath) {
      await fsp.rm(path.dirname(zipPath), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

module.exports = {
  CURSEFORGE_API,
  MINECRAFT_GAME_ID,
  CLASS_IDS,
  MOD_LOADER_TYPES,
  resolveFileUrl,
  normalizeCurseForgeProject,
  searchCurseForge,
  getCurseForgeMod,
  getCurseForgeDescription,
  getCurseForgeFiles,
  getCurseForgeFilesBatch,
  parseManifestLoader,
  installCurseForgeMod,
  installCurseForgeModpack,
};
