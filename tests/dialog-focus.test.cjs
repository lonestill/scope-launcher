const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise the real hook against a minimal DOM. Native Electron checks cover
// browser focus/visibility; these tests cover nesting, cleanup and key handling.
function fixture() {
  const listeners = new Map();
  const document = {
    activeElement: null,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  };
  class Element {
    constructor(name, tabIndex = -1) { this.name = name; this.tabIndex = tabIndex; this.children = []; this.inert = false; this.isConnected = true; }
    append(child) { this.children.push(child); child.parentElement = this; return child; }
    contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
    closest() { return this.inert ? this : this.parentElement?.closest() || null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    querySelectorAll() { return this.children.flatMap((child) => [child, ...child.querySelectorAll()]).filter((child) => child.tabIndex >= 0); }
    querySelector() { return this.querySelectorAll().find((element) => element.name === "input") || null; }
    focus() { if (!this.closest()) { document.activeElement = this; for (const fn of listeners.get("focusin") || []) fn({ target: this }); } }
  }
  document.body = new Element("body");
  const root = document.body.append(new Element("root"));
  const page = root.append(new Element("page"));
  const trigger = page.append(new Element("trigger", 0));
  trigger.focus();
  let effects = [];
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(require.resolve("../src/hooks/useDialogFocus.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, document, HTMLElement: Element, Node: Element,
    require: () => ({ useRef: (value) => ({ current: value }), useLayoutEffect: (fn) => effects.push(fn) }),
  });
  function mount(onClose) {
    const dialog = root.append(new Element("dialog"));
    const first = dialog.append(new Element("input", 0));
    const disabled = dialog.append(new Element("hidden", 0)); disabled.hidden = true;
    const last = dialog.append(new Element("last", 0));
    effects = [];
    const ref = module.exports.useDialogFocus(true, onClose);
    ref.current = dialog;
    const cleanups = effects.map((fn) => fn()).filter(Boolean);
    return { dialog, first, last, unmount: () => { cleanups.reverse().forEach((fn) => fn()); dialog.isConnected = false; root.children = root.children.filter((child) => child !== dialog); } };
  }
  function key(key, shiftKey = false) {
    const event = { key, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const fn of [...(listeners.get("keydown") || [])]) { fn(event); if (event.stopped) break; }
    return event;
  }
  return { document, page, trigger, mount, key };
}

test("dialog wraps Tab in both directions, hides background and restores trigger", () => {
  const f = fixture(); const modal = f.mount(() => {});
  assert.equal(f.page.inert, true);
  assert.equal(f.document.activeElement, modal.first);
  assert.equal(f.key("Tab", true).prevented, true);
  assert.equal(f.document.activeElement, modal.last);
  f.key("Tab"); assert.equal(f.document.activeElement, modal.first);
  modal.unmount();
  assert.equal(f.page.inert, false);
  assert.equal(f.document.activeElement, f.trigger);
});

test("only the top dialog handles Escape and background stays locked until all dialogs close", () => {
  const f = fixture(); let closed = "";
  const outer = f.mount(() => { closed += "outer"; });
  const inner = f.mount(() => { closed += "inner"; });
  assert.equal(f.key("Escape").stopped, true);
  assert.equal(closed, "inner");
  inner.unmount();
  assert.equal(f.page.inert, true);
  assert.equal(outer.dialog.inert, false);
  assert.equal(f.document.activeElement, outer.first);
  f.key("Escape"); assert.equal(closed, "innerouter");
  outer.unmount(); assert.equal(f.page.inert, false);
});

test("a busy dialog consumes Escape without closing an underlying screen", () => {
  const f = fixture(); const modal = f.mount(undefined);
  assert.equal(f.key("Escape").stopped, true);
  assert.equal(f.page.inert, true);
  modal.unmount();
});

test("dialog cleanup preserves an existing inert state", () => {
  const f = fixture(); f.page.inert = true;
  const modal = f.mount(() => {});
  modal.unmount(); assert.equal(f.page.inert, true);
});
