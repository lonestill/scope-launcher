const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function createStateWriter() {
  let pending = Promise.resolve();
  return (statePath, state) => {
    const contents = JSON.stringify(state, null, 2);
    const operation = pending.catch(() => undefined).then(async () => {
      await fsp.mkdir(path.dirname(statePath), { recursive: true });
      const temporary = `${statePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fsp.writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
        // Replacement keeps the last good file intact until the new one is ready.
        await fsp.rename(temporary, statePath);
      } finally {
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
      }
    });
    pending = operation;
    return operation;
  };
}
module.exports = { createStateWriter };
