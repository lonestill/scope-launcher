// Historical logs may contain several launches. Only the final launch is evidence.
function currentLaunchLog(content = "") {
  const text = String(content);
  const markers = [...text.matchAll(/^\[[^\r\n]+\] (?:Scope|Onyx) is launching [^\r\n]+/gm)];
  return markers.length ? text.slice(markers.at(-1).index) : text;
}
module.exports = { currentLaunchLog };
