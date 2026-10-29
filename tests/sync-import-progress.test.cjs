const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");

const text = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
const source = ts.createSourceFile("main.cjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function findFunction(name) {
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(result, name); return result;
}
function fixture(failMods = false) {
  const state = { instances: [], settings: { gameDirectory: "/test/instances" } };
  const events = []; const reports = [];
  const importProfile = vm.runInNewContext(`(${findFunction("importProfileObject")})`, {
    state, path, Error, crypto: { randomUUID: () => "new-instance" }, structuredClone,
    saveState: async () => {},
    send: (channel, payload) => events.push({ channel, payload }),
    runInstall: async (_instance, onProgress) => onProgress({ progress: 45 }),
    installSyncMods: async ({ onProgress }) => {
      onProgress({ completed: 1, count: 2, received: 5, total: 10, current: "A.jar" });
      if (failMods) throw new Error("Network interrupted");
      return { installed: 2, skipped: 1 };
    },
    preflightInstance: async () => {},
  });
  return { state, events, reports, run: () => importProfile({ instance: { name: "Shared", version: "1.21.1", loader: "Fabric", settings: {} } }, "link", (progress) => reports.push(progress)) };
}

test("shared import reports separate game, mods and checking stages and preserves partial-success counts", async () => {
  const f = fixture(); const result = await f.run();
  assert.deepEqual(f.reports.map((item) => item.stage), ["game", "game", "mods", "mods", "checking"]);
  assert.equal(f.reports.find((item) => item.current === "A.jar").progress, 50);
  assert.equal(result.installed, 2); assert.equal(result.skipped, 1);
  assert.equal(result.instance.status, "ready");
  assert.equal(result.instance.syncImportIncomplete, false);
  assert.equal(f.events.at(-1).channel, "instance:updated");
});

test("shared import failure stays visible on the instance and never reports final checking", async () => {
  const f = fixture(true);
  await assert.rejects(f.run(), /Network interrupted/);
  assert.equal(f.state.instances[0].status, "error");
  assert.equal(f.state.instances[0].syncImportIncomplete, true);
  assert.equal(f.state.instances[0].lastError, "Network interrupted");
  assert.equal(f.reports.some((item) => item.stage === "checking"), false);
});
