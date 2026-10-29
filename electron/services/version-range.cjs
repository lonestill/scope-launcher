// Deliberately conservative: unsupported constraints are unknown, never incompatible.
function parts(value) {
  value = String(value).split("+", 1)[0];
  return /^\d+(?:\.\d+){0,2}$/.test(value) ? value.split(".").map(Number) : null;
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
function satisfiesMinecraftVersion(version, constraint) {
  const target = parts(String(version));
  if (!target) return null;
  if (Array.isArray(constraint)) {
    const results = constraint.map((item) => satisfiesMinecraftVersion(version, item));
    return results.includes(true) ? true : results.includes(null) ? null : false;
  }
  if (typeof constraint !== "string") return null;
  const value = constraint.trim();
  if (value === "*" || value === "") return true;
  if (value.includes("||")) return satisfiesMinecraftVersion(version, value.split("||"));
  const interval = value.match(/^([\[(])\s*(\d+(?:\.\d+){0,2})?\s*,\s*(\d+(?:\.\d+){0,2})?\s*([\])])$/);
  if (interval) {
    const [, open, lower, upper, close] = interval;
    return (!lower || compare(target, parts(lower)) >= (open === "[" ? 0 : 1)) &&
      (!upper || compare(target, parts(upper)) <= (close === "]" ? 0 : -1));
  }
  const exactInterval = value.match(/^\[(\d+(?:\.\d+){0,2})\]$/);
  if (exactInterval) return compare(target, parts(exactInterval[1])) === 0;
  const tokens = value.replace(/(>=|<=|>|<|=)\s+/g, "$1").split(/\s+/);
  const results = tokens.map((token) => {
    const wildcard = token.match(/^(\d+(?:\.\d+)?)\.(?:x|\*)$/i);
    if (wildcard) return parts(wildcard[1]).every((n, i) => target[i] === n);
    const match = token.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/);
    if (!match) return null;
    const result = compare(target, parts(match[2]));
    switch (match[1]) {
      case ">=": return result >= 0;
      case "<=": return result <= 0;
      case ">": return result > 0;
      case "<": return result < 0;
      default: return result === 0;
    }
  });
  // Do not infer incompatibility from partially understood expressions.
  return results.includes(null) ? null : results.every(Boolean);
}
module.exports = { satisfiesMinecraftVersion };
