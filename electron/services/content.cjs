const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { inspectModJar } = require("./mod-metadata.cjs");
const { fetchJson, hashFile, downloadFile } = require("./network.cjs");

const MODRINTH_API = "https://api.modrinth.com/v2";

function assertManagedFile(instancesRoot, filePath) {
  const root = path.resolve(instancesRoot);
  const target = path.resolve(filePath);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("The file is outside the instances directory");
  }
  if (!/\.jar(?:\.disabled)?$/i.test(target)) {
    throw new Error("Only JAR mods can be updated");
  }
  return target;
}

function assertManagedInstance(instancesRoot, instanceId) {
  const root = path.resolve(instancesRoot);
  const target = path.resolve(root, String(instanceId));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("The instance is outside the managed directory");
  }
  return target;
}

function safeHistoryName(value) {
  const name = String(value || "");
  if (!name || name !== path.basename(name)) {
    throw new Error("The update history contains an unsafe path");
  }
  return name;
}

function selectVersionFile(version) {
  return (
    version?.files?.find(
      (file) =>
        file.primary &&
        /\.jar$/i.test(file.filename) &&
        !/(?:sources|javadoc|dev)\.jar$/i.test(file.filename),
    ) ||
    version?.files?.find(
      (file) =>
        /\.jar$/i.test(file.filename) &&
        !/(?:sources|javadoc|dev)\.jar$/i.test(file.filename),
    ) ||
    null
  );
}

function metadataPathForFile(filePath) {
  return `${filePath}.meta.json`;
}

function looksLikeDisplayVersion(value) {
  if (typeof value !== "string") return false;
  const version = value.trim();
  if (!version || version.length > 128) return false;
  return /(?:^|[a-z])\d+\.\d+/.test(version) ||
    /(?:^|[-_.])\d+\.[A-Za-z0-9_-]+/.test(version) ||
    /^mc\d+\.\d+.*$/i.test(version) ||
    /^\d+\.\d+(?:\.\d+)?(?:[-_.][A-Za-z0-9]+)*$/i.test(version);
}

function looksLikeOpaqueVersion(value) {
  if (typeof value !== "string") return false;
  const version = value.trim();
  if (!version || version.length > 128) return false;
  return /^v?[A-Za-z0-9_-]{6,}$/.test(version) && !looksLikeDisplayVersion(version);
}

function jarBasenameForVersion(filePath) {
  return path.basename(filePath).replace(/\.jar(?:\.disabled)?$/i, "");
}

function normalizeDisplayVersion(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(/^v+/i, "");
}

function chooseDisplayVersion(preferredValue, inferredValue, fallbackName = "") {
  const jarName = safeNameFromFallback(fallbackName);

  for (const candidate of [preferredValue, inferredValue]) {
    if (looksLikeDisplayVersion(candidate)) {
      return normalizeDisplayVersion(candidate);
    }
  }

  const opaque = [preferredValue, inferredValue].find((candidate) =>
    looksLikeOpaqueVersion(candidate),
  );
  if (opaque && jarName) {
    return jarName;
  }

  const fallback = inferredValue?.trim() || preferredValue?.trim() || "";
  if (fallback && !looksLikeOpaqueVersion(fallback)) {
    return normalizeDisplayVersion(fallback);
  }
  return jarName;
}

function safeNameFromFallback(fallbackName) {
  const name = String(fallbackName || "").trim();
  return name.replace(/\.jar(?:\.disabled)?$/i, "");
}

async function writeModMetadata(filePath, metadata) {
  const outputPath = metadataPathForFile(filePath);
  const inferred = await inspectModJar(filePath).catch(() => null);
  const payload = {
    projectName: metadata?.projectName || inferred?.name || "",
    projectUrl: metadata?.projectUrl || "",
    projectVersion: chooseDisplayVersion(
      inferred?.version,
      metadata?.projectVersion,
      jarBasenameForVersion(filePath),
    ),
    catalogProjectId: metadata?.catalogProjectId
      ? String(metadata.catalogProjectId)
      : "",
    catalogVersionId: metadata?.catalogVersionId
      ? String(metadata.catalogVersionId)
      : "",
    source: metadata?.source || "",
    updatedAt: new Date().toISOString(),
  };
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function readModMetadata(filePath) {
  try {
    const text = await fsp.readFile(metadataPathForFile(filePath), "utf8");
    const parsed = JSON.parse(text);
    const inferred = await inspectModJar(filePath).catch(() => null);
    const version = chooseDisplayVersion(
      inferred?.version,
      typeof parsed?.projectVersion === "string" ? parsed.projectVersion : "",
      jarBasenameForVersion(filePath),
    );
    return {
      projectName:
        typeof parsed?.projectName === "string" && parsed.projectName
          ? parsed.projectName
          : inferred?.name || "",
      modName: inferred?.name || "",
      modVersion: inferred?.version || "",
      projectUrl: typeof parsed?.projectUrl === "string" ? parsed.projectUrl : "",
      projectVersion: version,
      catalogProjectId:
        typeof parsed?.catalogProjectId === "string"
          ? parsed.catalogProjectId
          : undefined,
      catalogVersionId:
        typeof parsed?.catalogVersionId === "string"
          ? parsed.catalogVersionId
          : undefined,
      modIds: Array.isArray(inferred?.ids) ? inferred.ids : [],
      source:
        parsed?.source === "modrinth" || parsed?.source === "curseforge"
          ? parsed.source
          : undefined,
    };
  } catch {
    const inferred = await inspectModJar(filePath).catch(() => null);
    if (!inferred?.name && !inferred?.version) return null;
    return {
      projectName: inferred?.name || "",
      modName: inferred?.name || "",
      modVersion: inferred?.version || "",
      projectUrl: "",
      projectVersion: chooseDisplayVersion(
        inferred?.version,
        "",
        jarBasenameForVersion(filePath),
      ),
      modIds: Array.isArray(inferred?.ids) ? inferred.ids : [],
      source: undefined,
    };
  }
}

async function contentHashes(items, concurrency = 6) {
  let cursor = 0;
  const output = new Array(items.length);
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await hashFile(items[index].path, "sha1");
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, worker),
  );
  return output;
}

async function checkModUpdates({
  items,
  loader,
  minecraftVersion,
}) {
  if (!items.length || !loader || loader === "vanilla") return items;
  const hashes = await contentHashes(items);
  const versions = await fetchJson(`${MODRINTH_API}/version_files/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hashes,
      algorithm: "sha1",
      loaders: [String(loader).toLowerCase()],
      game_versions: [String(minecraftVersion)],
    }),
  });

  return items.map((item, index) => {
    const sha1 = hashes[index];
    const version = versions?.[sha1];
    const candidate = selectVersionFile(version);
    const candidateHash = candidate?.hashes?.sha1;
    return {
      ...item,
      sha1,
      projectId: version?.project_id,
      currentVersionId:
        version?.files?.some((file) => file.hashes?.sha1 === sha1)
          ? version.id
          : undefined,
      projectVersion: version?.version_number,
      update:
        candidate && candidateHash && candidateHash !== sha1
          ? {
              versionId: version.id,
              versionNumber: version.version_number,
              fileName: candidate.filename,
              size: candidate.size,
            }
          : null,
    };
  });
}

async function latestVersionForFile({
  filePath,
  loader,
  minecraftVersion,
}) {
  const sha1 = await hashFile(filePath, "sha1");
  const version = await fetchJson(
    `${MODRINTH_API}/version_file/${sha1}/update?algorithm=sha1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loaders: [String(loader).toLowerCase()],
        game_versions: [String(minecraftVersion)],
      }),
    },
  );
  return { sha1, version, file: selectVersionFile(version) };
}

function safeModrinthDownload(url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["cdn.modrinth.com", "cdn-raw.modrinth.com"].includes(parsed.hostname)
  ) {
    throw new Error("Modrinth returned an unsafe file URL");
  }
  return parsed.toString();
}

async function updateMod({
  instancesRoot,
  filePath,
  loader,
  minecraftVersion,
  onProgress,
}) {
  const source = assertManagedFile(instancesRoot, filePath);
  const savedMetadata = await readModMetadata(source);
  const { sha1, version, file } = await latestVersionForFile({
    filePath: source,
    loader,
    minecraftVersion,
  });
  if (!file || file.hashes?.sha1 === sha1) {
    return { updated: false, reason: "latest" };
  }

  const disabled = source.endsWith(".disabled");
  const modsDirectory = path.dirname(source);
  const safeName = file.filename.replace(/[^a-zA-Z0-9._+()-]/g, "_");
  const finalName = disabled ? `${safeName}.disabled` : safeName;
  const destination = path.join(modsDirectory, finalName);
  const staging = path.join(
    modsDirectory,
    `.onyx-update-${crypto.randomUUID()}.part`,
  );
  await downloadFile({
    url: safeModrinthDownload(file.url),
    destination: staging,
    sha1: file.hashes?.sha1,
    sha512: file.hashes?.sha512,
    size: file.size,
    onProgress,
  });

  const instanceDirectory = path.dirname(modsDirectory);
  const historyDirectory = path.join(
    instanceDirectory,
    ".onyx",
    "history",
    "mods",
  );
  await fsp.mkdir(historyDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const transactionId = `${stamp}-${crypto.randomUUID()}`;
  const backup = path.join(
    historyDirectory,
    `${stamp}-${path.basename(source)}`,
  );
  let replacedBackup = null;

  try {
    await fsp.rename(source, backup);
    if (destination !== source) {
      const existing = await fsp.stat(destination).catch(() => null);
      if (existing?.isFile()) {
        replacedBackup = path.join(
          historyDirectory,
          `${stamp}-replaced-${path.basename(destination)}`,
        );
        await fsp.rename(
          destination,
          replacedBackup,
        );
      }
    }
    await fsp.rename(staging, destination);
    await writeModMetadata(destination, {
      projectName: savedMetadata?.projectName || "",
      projectUrl: savedMetadata?.projectUrl || "",
      projectVersion: version?.version_number || "",
      catalogProjectId: version?.project_id || savedMetadata?.catalogProjectId,
      catalogVersionId: version?.id || savedMetadata?.catalogVersionId,
      source: "modrinth",
    });
  } catch (error) {
    const sourceExists = await fsp.stat(source).catch(() => null);
    const backupExists = await fsp.stat(backup).catch(() => null);
    if (!sourceExists && backupExists) {
      await fsp.rename(backup, source).catch(() => undefined);
    }
    await fsp.rm(staging, { force: true }).catch(() => undefined);
    throw error;
  }

  const transactionsDirectory = path.join(historyDirectory, "transactions");
  const historyRecorded = await (async () => {
    await fsp.mkdir(transactionsDirectory, { recursive: true });
    await fsp.writeFile(
      path.join(transactionsDirectory, `${transactionId}.json`),
      JSON.stringify(
        {
          schema: 1,
          kind: "mod-update",
          id: transactionId,
          createdAt: new Date().toISOString(),
          previousName: path.basename(source),
          currentName: path.basename(destination),
          backupName: path.basename(backup),
          replacedBackupName: replacedBackup
            ? path.basename(replacedBackup)
            : null,
          projectId: version.project_id,
          versionId: version.id,
          versionNumber: version.version_number,
          rolledBackAt: null,
        },
        null,
        2,
      ),
      "utf8",
    );
    return true;
  })().catch(() => false);

  return {
    updated: true,
    path: destination,
    backup,
    projectId: version.project_id,
    versionId: version.id,
    versionNumber: version.version_number,
    fileName: file.filename,
    transactionId: historyRecorded ? transactionId : null,
  };
}

async function listModHistory({ instancesRoot, instanceId }) {
  const instanceDirectory = assertManagedInstance(instancesRoot, instanceId);
  const transactionsDirectory = path.join(
    instanceDirectory,
    ".onyx",
    "history",
    "mods",
    "transactions",
  );
  const entries = await fsp
    .readdir(transactionsDirectory, { withFileTypes: true })
    .catch(() => []);
  const history = await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && /^[\w.-]+\.json$/i.test(entry.name),
      )
      .map(async (entry) => {
        try {
          const value = JSON.parse(
            await fsp.readFile(
              path.join(transactionsDirectory, entry.name),
              "utf8",
            ),
          );
          if (
            value?.schema !== 1 ||
            value?.kind !== "mod-update" ||
            value?.id !== entry.name.replace(/\.json$/i, "")
          ) {
            return null;
          }
          safeHistoryName(value.previousName);
          safeHistoryName(value.currentName);
          safeHistoryName(value.backupName);
          if (value.replacedBackupName) {
            safeHistoryName(value.replacedBackupName);
          }
          return {
            id: value.id,
            createdAt: value.createdAt,
            previousName: value.previousName,
            currentName: value.currentName,
            versionNumber: value.versionNumber || null,
            rolledBackAt: value.rolledBackAt || null,
          };
        } catch {
          return null;
        }
      }),
  );
  return history
    .filter(Boolean)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function rollbackModUpdate({
  instancesRoot,
  instanceId,
  transactionId,
}) {
  if (!/^[\w.-]+$/i.test(String(transactionId))) {
    throw new Error("Invalid history entry ID");
  }
  const instanceDirectory = assertManagedInstance(instancesRoot, instanceId);
  const modsDirectory = path.join(instanceDirectory, "mods");
  const historyDirectory = path.join(
    instanceDirectory,
    ".onyx",
    "history",
    "mods",
  );
  const transactionPath = path.join(
    historyDirectory,
    "transactions",
    `${transactionId}.json`,
  );
  const transaction = JSON.parse(
    await fsp.readFile(transactionPath, "utf8"),
  );
  if (
    transaction?.schema !== 1 ||
    transaction?.kind !== "mod-update" ||
    transaction?.id !== transactionId
  ) {
    throw new Error("The history entry is corrupted");
  }
  if (transaction.rolledBackAt) {
    throw new Error("This update has already been rolled back");
  }

  const previousName = safeHistoryName(transaction.previousName);
  const currentName = safeHistoryName(transaction.currentName);
  const backupName = safeHistoryName(transaction.backupName);
  const replacedBackupName = transaction.replacedBackupName
    ? safeHistoryName(transaction.replacedBackupName)
    : null;
  const previousPath = path.join(modsDirectory, previousName);
  const currentPath = path.join(modsDirectory, currentName);
  const backupPath = path.join(historyDirectory, backupName);
  const replacedBackupPath = replacedBackupName
    ? path.join(historyDirectory, replacedBackupName)
    : null;
  const backupStats = await fsp.stat(backupPath).catch(() => null);
  if (!backupStats?.isFile()) {
    throw new Error("The original file required for rollback was not found");
  }
  if (replacedBackupPath) {
    const replacedStats = await fsp.stat(replacedBackupPath).catch(() => null);
    if (!replacedStats?.isFile()) {
      throw new Error("The replaced file required for rollback was not found");
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackBackupPath = path.join(
    historyDirectory,
    `${stamp}-rollback-${currentName}`,
  );
  const previousConflictPath = path.join(
    historyDirectory,
    `${stamp}-rollback-conflict-${previousName}`,
  );
  const currentStats = await fsp.stat(currentPath).catch(() => null);
  const previousStats =
    previousPath !== currentPath
      ? await fsp.stat(previousPath).catch(() => null)
      : null;
  let currentMoved = false;
  let previousConflictMoved = false;
  let previousRestored = false;
  let replacedRestored = false;
  try {
    if (currentStats?.isFile()) {
      await fsp.rename(currentPath, rollbackBackupPath);
      currentMoved = true;
    }
    if (previousStats?.isFile()) {
      await fsp.rename(previousPath, previousConflictPath);
      previousConflictMoved = true;
    }
    await fsp.rename(backupPath, previousPath);
    previousRestored = true;
    if (replacedBackupPath) {
      await fsp.rename(replacedBackupPath, currentPath);
      replacedRestored = true;
    }
  } catch (error) {
    if (replacedRestored) {
      await fsp.rename(currentPath, replacedBackupPath).catch(() => undefined);
    }
    if (previousRestored) {
      await fsp.rename(previousPath, backupPath).catch(() => undefined);
    }
    if (previousConflictMoved) {
      await fsp
        .rename(previousConflictPath, previousPath)
        .catch(() => undefined);
    }
    if (currentMoved) {
      await fsp
        .rename(rollbackBackupPath, currentPath)
        .catch(() => undefined);
    }
    throw error;
  }

  transaction.rolledBackAt = new Date().toISOString();
  transaction.rollbackBackupName = currentMoved
    ? path.basename(rollbackBackupPath)
    : null;
  await fsp.writeFile(
    transactionPath,
    JSON.stringify(transaction, null, 2),
    "utf8",
  );
  return {
    restored: true,
    previousName,
    currentName,
    rolledBackAt: transaction.rolledBackAt,
  };
}

module.exports = {
  assertManagedFile,
  assertManagedInstance,
  selectVersionFile,
  checkModUpdates,
  latestVersionForFile,
  readModMetadata,
  safeModrinthDownload,
  updateMod,
  listModHistory,
  rollbackModUpdate,
  writeModMetadata,
};
