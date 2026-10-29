const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function paths(root, journal) {
  const { instanceId, stagingId, previousName } = journal;
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(instanceId) ||
      !/^_update-[a-f0-9-]{36}$/.test(stagingId) ||
      !previousName.startsWith(`${instanceId}.previous-`) ||
      !/^[a-zA-Z0-9_.-]+$/.test(previousName)) throw new Error("Invalid update recovery journal");
  return {
    active: path.join(root, instanceId),
    staging: path.join(root, stagingId),
    previous: path.join(root, previousName),
    journal: path.join(root, `${instanceId}.update.json`),
  };
}
async function exists(file) {
  try { await fsp.access(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function finish(root, journal) {
  const p = paths(root, journal);
  await fsp.rm(p.previous, { recursive: true, force: true });
  await fsp.rm(p.staging, { recursive: true, force: true });
  await fsp.rm(p.journal, { force: true });
}
async function rollback(root, journal) {
  const p = paths(root, journal);
  if (await exists(p.previous)) {
    // Keep both directories intact if any rename fails; startup can retry.
    if (await exists(p.active)) {
      await fsp.rm(p.staging, { recursive: true, force: true });
      await fsp.rename(p.active, p.staging);
    }
    await fsp.rename(p.previous, p.active);
  }
  await fsp.rm(p.staging, { recursive: true, force: true });
  await fsp.rm(p.journal, { force: true });
}
async function promoteInstanceUpdate({ instancesRoot, instanceId, stagingId, nextInstance, signal }) {
  const journal = {
    instanceId, stagingId,
    previousName: `${instanceId}.previous-${crypto.randomUUID()}`,
    sourceVersionId: nextInstance.sourceVersionId,
    resolvedVersionId: nextInstance.resolvedVersionId,
  };
  const p = paths(instancesRoot, journal);
  if (await exists(p.journal)) throw new Error("A previous instance update must be recovered first");
  const temporaryJournal = `${p.journal}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporaryJournal, JSON.stringify(journal), { flag: "wx" });
    await fsp.rename(temporaryJournal, p.journal);
  } finally {
    await fsp.rm(temporaryJournal, { force: true }).catch(() => undefined);
  }
  try {
    signal?.throwIfAborted();
    await fsp.rename(p.active, p.previous);
    await fsp.rename(p.staging, p.active);
  } catch (error) {
    await rollback(instancesRoot, journal);
    throw error;
  }
  return {
    // Metadata must be saved before deleting the old directory.
    finalize: () => finish(instancesRoot, journal),
    rollback: () => rollback(instancesRoot, journal),
  };
}
async function recoverInstanceUpdates({ instancesRoot, instances }) {
  let entries;
  try { entries = await fsp.readdir(instancesRoot); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const name of entries) {
    const match = name.match(/^([a-zA-Z0-9_-]{1,96})\.update\.json$/);
    if (!match) continue;
    const journal = JSON.parse(await fsp.readFile(path.join(instancesRoot, name), "utf8"));
    if (journal.instanceId !== match[1]) throw new Error("Mismatched update recovery journal");
    const p = paths(instancesRoot, journal);
    const saved = instances.find((instance) => instance.id === journal.instanceId);
    if (saved?.sourceVersionId === journal.sourceVersionId &&
        saved?.resolvedVersionId === journal.resolvedVersionId && await exists(p.active)) {
      await finish(instancesRoot, journal);
    } else {
      await rollback(instancesRoot, journal);
    }
  }
}
module.exports = { promoteInstanceUpdate, recoverInstanceUpdates };
