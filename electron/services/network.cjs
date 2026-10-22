const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const { version: ONYX_VERSION } = require("../../package.json");

const USER_AGENT = `OnyxLauncher/${ONYX_VERSION} (${process.platform}; production launcher)`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError() {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}

function preservePartial(signal) {
  return signal?.reason?.preservePartial === true;
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "User-Agent": USER_AGENT,
          ...(options.headers || {}),
        },
      });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`HTTP ${response.status}: ${url}`);
    } catch (error) {
      if (options.signal?.aborted || error?.name === "AbortError") {
        throw abortError();
      }
      lastError = error;
    }
    if (attempt < attempts) await delay(350 * 2 ** (attempt - 1));
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

function endpointName(url) {
  try {
    return new URL(url).host;
  } catch {
    return "server";
  }
}

async function readJsonResponse(response, url) {
  const body = await response.text();
  if (!body.trim() && !response.ok) return {};
  try {
    return JSON.parse(body);
  } catch {
    const contentType = response.headers.get("content-type") || "without Content-Type";
    const error = new Error(
      `${endpointName(url)} returned an unexpected response instead of JSON ` +
        `(${response.status}, ${contentType})`,
    );
    error.code = "INVALID_JSON_RESPONSE";
    throw error;
  }
}

async function fetchJsonResponse(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithRetry(url, options, 1);
      return { response, payload: await readJsonResponse(response, url) };
    } catch (error) {
      if (options.signal?.aborted || error?.name === "AbortError") {
        throw abortError();
      }
      lastError = error;
      if (attempt < attempts) await delay(350 * 2 ** (attempt - 1));
    }
  }
  throw lastError || new Error(`Failed to fetch JSON: ${url}`);
}

async function fetchJson(url, options = {}) {
  const { response, payload } = await fetchJsonResponse(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const message =
      payload?.error_description ||
      payload?.errorMessage ||
      payload?.message ||
      payload?.Message ||
      "";
    throw new Error(
      `The server returned ${response.status}${
        message ? `: ${String(message).slice(0, 180)}` : ""
      }`,
    );
  }
  return payload;
}

async function hashFile(filePath, algorithm = "sha1") {
  const hash = crypto.createHash(algorithm);
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function fileMatches(filePath, expected = {}) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return false;
    if (expected.size && stat.size !== Number(expected.size)) return false;
    if (expected.sha512) {
      return (await hashFile(filePath, "sha512")) === expected.sha512;
    }
    if (expected.sha256) {
      return (await hashFile(filePath, "sha256")) === expected.sha256;
    }
    if (expected.sha1) {
      return (await hashFile(filePath, "sha1")) === expected.sha1;
    }
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function downloadFile(optionsOrUrl, maybeDestination, maybeOptions = {}) {
  const options =
    typeof optionsOrUrl === "string"
      ? {
          url: optionsOrUrl,
          destination: maybeDestination,
          ...(maybeOptions || {}),
        }
      : optionsOrUrl || {};

  const {
    url,
    destination,
    sha1,
    sha256,
    sha512,
    size,
    onProgress,
    signal,
  } = options;

  if (!destination || typeof destination !== "string") {
    throw new TypeError(
      `The "destination" path argument must be a non-empty string. Received ${
        destination === undefined ? "undefined" : typeof destination
      }`,
    );
  }

  if (signal?.aborted) throw abortError();
  if (await fileMatches(destination, { sha1, sha256, sha512, size })) {
    onProgress?.({ received: Number(size) || 0, total: Number(size) || 0, cached: true });
    return { destination, cached: true };
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  const verified = Boolean(sha1 || sha256 || sha512);
  if (!verified) {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
  }

  const expected = { sha1, sha256, sha512, size };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal?.aborted) {
      if (!preservePartial(signal)) {
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
      }
      throw abortError();
    }
    let offset = verified
      ? Number((await fsp.stat(temporary).catch(() => null))?.size || 0)
      : 0;
    if (size && offset > Number(size)) {
      await fsp.rm(temporary, { force: true }).catch(() => undefined);
      offset = 0;
    }

    try {
      const response = await fetchWithRetry(
        url,
        {
          redirect: "follow",
          signal,
          headers: {
            Accept: "*/*",
            ...(offset ? { Range: `bytes=${offset}-` } : {}),
          },
        },
        1,
      );

      if (response.status === 416 && offset) {
        if (await fileMatches(temporary, expected)) {
          await fsp.rm(destination, { force: true }).catch(() => undefined);
          await fsp.rename(temporary, destination);
          onProgress?.({
            received: offset,
            total: Number(size) || offset,
            cached: false,
          });
          return { destination, cached: false, resumed: true };
        }
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
        throw new Error("The server refused to resume the download");
      }
      if (!response.ok || !response.body) {
        throw new Error(
          `Failed to download the file (${response.status}): ${url}`,
        );
      }

      const contentRange = response.headers.get("content-range") || "";
      const rangeMatch = /^bytes\s+(\d+)-\d+\/(\d+|\*)$/i.exec(
        contentRange,
      );
      const resumed =
        offset > 0 &&
        response.status === 206 &&
        Number(rangeMatch?.[1]) === offset;
      if (offset && !resumed) {
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
        offset = 0;
      }
      const responseLength = Number(
        response.headers.get("content-length") || 0,
      );
      const total =
        Number(rangeMatch?.[2] === "*" ? 0 : rangeMatch?.[2]) ||
        Number(size) ||
        (resumed ? offset + responseLength : responseLength);
      let received = resumed ? offset : 0;
      let lastReport = 0;
      onProgress?.({ received, total, cached: false, resumed });
      let speedSamples = [];
      let lastSpeedCheck = Date.now();
      let lastSpeedBytes = resumed ? offset : 0;
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          const now = Date.now();
          if (now - lastReport > 100 || (total && received >= total)) {
            lastReport = now;
            const elapsed = (now - lastSpeedCheck) / 1000;
            const result = calculateSpeed(speedSamples, received, lastSpeedBytes, elapsed);
            lastSpeedCheck = now;
            lastSpeedBytes = received;
            if (result) speedSamples = result.samples;
            const safeSpeed = result?.speed ?? null;
            const eta = calculateEta(total, received, safeSpeed);
            onProgress?.({ received, total, cached: false, resumed, speed: safeSpeed, eta });
          }
          callback(null, chunk);
        },
      });

      await pipeline(
        Readable.fromWeb(response.body),
        counter,
        fs.createWriteStream(temporary, {
          flags: resumed ? "a" : "w",
        }),
        ...(signal ? [{ signal }] : []),
      );
      onProgress?.({
        received,
        total: total || received,
        cached: false,
        resumed,
      });

      if (!(await fileMatches(temporary, expected))) {
        const error = new Error("The downloaded file checksum does not match");
        error.code = "INTEGRITY_MISMATCH";
        throw error;
      }
      await fsp.rm(destination, { force: true }).catch(() => undefined);
      await fsp.rename(temporary, destination);
      return { destination, cached: false, resumed };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        if (!preservePartial(signal)) {
          await fsp.rm(temporary, { force: true }).catch(() => undefined);
        }
        throw abortError();
      }
      lastError = error;
      if (error?.code === "INTEGRITY_MISMATCH") {
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
      }
      if (attempt < 3) {
        await delay(350 * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError || new Error(`Failed to download the file: ${url}`);
}

function calculateSpeed(samples, received, lastBytes, elapsed) {
  if (elapsed <= 0) return null;
  const bytesPerSec = (received - lastBytes) / elapsed;
  const next = [...samples, bytesPerSec].slice(-5);
  const smoothed = next.reduce((a, b) => a + b) / next.length;
  return { samples: next, speed: smoothed };
}

function calculateEta(total, received, speed) {
  if (!total || !speed || speed <= 0) return null;
  const remaining = total - received;
  return remaining / speed;
}

async function downloadMany(items, options = {}) {
  const concurrency = Math.max(1, Math.min(options.concurrency || 8, 16));
  const knownTotalBytes = items.reduce((sum, item) => {
    const s = Number(item.size);
    return sum + (Number.isFinite(s) && s > 0 ? s : 0);
  }, 0);
  const inFlight = new Map();
  let completedBytes = 0;
  let completed = 0;
  let cursor = 0;
  let lastReportTime = 0;

  let lastSpeedBytes = 0;
  let lastSpeedTime = Date.now();
  let speedSamples = [];
  let currentSpeed = 0;

  const emitProgress = (item, force = false) => {
    const now = Date.now();
    const isFinished = completed >= items.length;
    if (!force && !isFinished && now - lastReportTime < 1000) {
      return;
    }
    lastReportTime = now;

    let inFlightSum = 0;
    for (const b of inFlight.values()) {
      inFlightSum += b;
    }

    const rawReceived = completedBytes + inFlightSum;
    const total = knownTotalBytes > 0 ? Math.max(knownTotalBytes, rawReceived) : rawReceived;
    const received = Math.min(rawReceived, total);

    const elapsed = (now - lastSpeedTime) / 1000;
    if (elapsed >= 0.5) {
      const bytesDelta = received - lastSpeedBytes;
      const instantSpeed = bytesDelta > 0 && elapsed > 0 ? bytesDelta / elapsed : 0;
      speedSamples = [...speedSamples, instantSpeed].slice(-5);
      currentSpeed = speedSamples.length > 0
        ? Math.round(speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length)
        : 0;
      lastSpeedBytes = received;
      lastSpeedTime = now;
    }

    const eta =
      currentSpeed > 0 && total > received ? (total - received) / currentSpeed : null;

    options.onProgress?.({
      completed,
      count: items.length,
      received,
      total,
      speed: currentSpeed > 0 ? currentSpeed : undefined,
      eta: eta ?? undefined,
      current: item ? path.basename(item.destination) : "",
    });
  };

  const report = (item, progress) => {
    const rec = Number(progress?.received) || 0;
    inFlight.set(item.destination, rec);
    emitProgress(item);
  };

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      await downloadFile({
        ...item,
        signal: options.signal,
        onProgress: (progress) => report(item, progress),
      });
      const finalItemBytes = inFlight.get(item.destination) || Number(item.size) || 0;
      inFlight.delete(item.destination);
      completedBytes += finalItemBytes;
      completed += 1;
      emitProgress(item, completed >= items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, worker),
  );
  emitProgress(null, true);
}

module.exports = {
  USER_AGENT,
  delay,
  fetchWithRetry,
  readJsonResponse,
  fetchJsonResponse,
  fetchJson,
  hashFile,
  fileMatches,
  downloadFile,
  downloadMany,
  abortError,
  preservePartial,
  calculateSpeed,
  calculateEta
};
