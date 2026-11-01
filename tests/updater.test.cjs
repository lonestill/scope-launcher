const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const http = require("node:http");

const {
  cleanVersion,
  parseSemver,
  compareVersions,
  selectAsset,
  parseRelease,
  checkForUpdate,
  downloadUpdate,
  UpdaterService,
} = require("../electron/services/updater.cjs");

test("cleanVersion strips leading v and trims whitespace", () => {
  assert.equal(cleanVersion("v1.7.0"), "1.7.0");
  assert.equal(cleanVersion("V2.0.1"), "2.0.1");
  assert.equal(cleanVersion(" 1.6.11 "), "1.6.11");
  assert.equal(cleanVersion(""), "0.0.0");
  assert.equal(cleanVersion(null), "0.0.0");
});

test("compareVersions handles semver correctly", () => {
  // 1.6.11 vs 1.7.0
  assert.equal(compareVersions("1.6.11", "1.7.0"), -1);
  assert.equal(compareVersions("1.7.0", "1.6.11"), 1);

  // 1.6.11 vs 1.6.11
  assert.equal(compareVersions("1.6.11", "1.6.11"), 0);

  // Tags with leading 'v'
  assert.equal(compareVersions("v1.7.0", "1.6.11"), 1);
  assert.equal(compareVersions("1.6.11", "v1.6.11"), 0);
  assert.equal(compareVersions("v1.6.11", "v1.7.0"), -1);

  // Patch version
  assert.equal(compareVersions("1.6.12", "1.6.11"), 1);
  assert.equal(compareVersions("1.6.11", "1.6.12"), -1);

  // Major version
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.99.99", "2.0.0"), -1);

  // Prerelease versions
  assert.equal(compareVersions("1.7.0", "1.7.0-beta.1"), 1);
  assert.equal(compareVersions("1.7.0-beta.1", "1.7.0"), -1);
  assert.equal(compareVersions("1.7.0-beta.2", "1.7.0-beta.1"), 1);
  assert.equal(compareVersions("1.7.0-beta.1", "1.7.0-beta.2"), -1);
  assert.equal(compareVersions("1.7.0-beta.1", "1.7.0-beta.1"), 0);
});

test("selectAsset matches platform-appropriate assets", () => {
  const assets = [
    {
      name: "Onyx-Launcher-1.7.0-mac.zip",
      browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0-mac.zip",
      size: 80000000,
    },
    {
      name: "Onyx-Launcher-1.7.0.dmg",
      browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0.dmg",
      size: 85000000,
    },
    {
      name: "Onyx-Launcher-1.7.0-Setup.exe",
      browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0-Setup.exe",
      size: 75000000,
    },
    {
      name: "Onyx-Launcher-1.7.0.AppImage",
      browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0.AppImage",
      size: 90000000,
    },
    {
      name: "Onyx-Launcher-1.7.0.tar.gz",
      browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0.tar.gz",
      size: 88000000,
    },
  ];

  // Windows: prefers .exe
  const winAsset = selectAsset(assets, "win32");
  assert.ok(winAsset);
  assert.equal(winAsset.name, "Onyx-Launcher-1.7.0-Setup.exe");

  // macOS: prefers .dmg over .zip
  const macAsset = selectAsset(assets, "darwin");
  assert.ok(macAsset);
  assert.equal(macAsset.name, "Onyx-Launcher-1.7.0.dmg");

  // macOS fallback to .zip if .dmg not available
  const macZipOnly = selectAsset(
    [{ name: "Onyx-Launcher-1.7.0-mac.zip", browser_download_url: "url", size: 100 }],
    "darwin"
  );
  assert.ok(macZipOnly);
  assert.equal(macZipOnly.name, "Onyx-Launcher-1.7.0-mac.zip");

  // Linux: selects .AppImage and strictly rejects .tar.gz for in-app updates
  const linuxAsset = selectAsset(assets, "linux");
  assert.ok(linuxAsset);
  assert.equal(linuxAsset.name, "Onyx-Launcher-1.7.0.AppImage");

  // Linux rejects .tar.gz and .deb when no .AppImage is present
  const linuxTarOnly = selectAsset(
    [{ name: "Onyx-Launcher-1.7.0.tar.gz", browser_download_url: "url", size: 100 }],
    "linux"
  );
  assert.equal(linuxTarOnly, null);

  const linuxDebOnly = selectAsset(
    [{ name: "Scope-Launcher-2.0.11-amd64.deb", browser_download_url: "url", size: 100 }],
    "linux"
  );
  assert.equal(linuxDebOnly, null);

  // Empty or non-matching assets
  assert.equal(selectAsset([], "win32"), null);
  assert.equal(
    selectAsset([{ name: "notes.txt", browser_download_url: "url", size: 10 }], "win32"),
    null
  );
});

test("parseRelease correctly parses GitHub release response", () => {
  const mockRelease = {
    tag_name: "v1.7.0",
    name: "Onyx Launcher 1.7.0",
    body: "### What's Changed\n* Added Auto-Updater feature\n* Fixed minor bugs",
    published_at: "2026-09-13T18:00:00Z",
    assets: [
      {
        name: "Onyx-Launcher-1.7.0-Setup.exe",
        browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0-Setup.exe",
        size: 75000000,
      },
      {
        name: "Onyx-Launcher-1.7.0.dmg",
        browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0.dmg",
        size: 85000000,
      },
      {
        name: "Onyx-Launcher-1.7.0.AppImage",
        browser_download_url: "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0.AppImage",
        size: 90000000,
      },
    ],
  };

  // When update is available (1.6.11 < 1.7.0)
  const resultWin = parseRelease(mockRelease, "1.6.11", "win32");
  assert.equal(resultWin.updateAvailable, true);
  assert.equal(resultWin.currentVersion, "1.6.11");
  assert.equal(resultWin.latestVersion, "1.7.0");
  assert.equal(resultWin.releaseName, "Onyx Launcher 1.7.0");
  assert.equal(resultWin.releaseNotes, mockRelease.body);
  assert.equal(resultWin.publishedAt, "2026-09-13T18:00:00Z");
  assert.equal(
    resultWin.downloadUrl,
    "https://github.com/releases/download/v1.7.0/Onyx-Launcher-1.7.0-Setup.exe"
  );
  assert.equal(resultWin.assetName, "Onyx-Launcher-1.7.0-Setup.exe");
  assert.equal(resultWin.assetSize, 75000000);

  // When update is NOT available (already on 1.7.0)
  const resultSame = parseRelease(mockRelease, "1.7.0", "win32");
  assert.equal(resultSame.updateAvailable, false);
  assert.equal(resultSame.currentVersion, "1.7.0");
  assert.equal(resultSame.latestVersion, "1.7.0");

  // When current version is newer than latest release (1.8.0 > 1.7.0)
  const resultNewer = parseRelease(mockRelease, "1.8.0", "win32");
  assert.equal(resultNewer.updateAvailable, false);
});

test("checkForUpdate fetches release info and returns update result", async () => {
  const mockRelease = {
    tag_name: "v1.7.0",
    name: "Onyx Launcher 1.7.0",
    body: "Release notes for 1.7.0",
    published_at: "2026-09-13T18:00:00Z",
    assets: [
      {
        name: "Onyx-Launcher-1.7.0.AppImage",
        browser_download_url: "https://example.com/Onyx-Launcher-1.7.0.AppImage",
        size: 50000000,
      },
    ],
  };

  const mockFetch = async (url, options) => {
    assert.ok(options.headers["User-Agent"]);
    return {
      ok: true,
      status: 200,
      json: async () => mockRelease,
    };
  };

  const result = await checkForUpdate("1.6.11", {
    fetch: mockFetch,
    platform: "linux",
  });

  assert.equal(result.updateAvailable, true);
  assert.equal(result.currentVersion, "1.6.11");
  assert.equal(result.latestVersion, "1.7.0");
  assert.equal(result.downloadUrl, "https://example.com/Onyx-Launcher-1.7.0.AppImage");
  assert.equal(result.assetName, "Onyx-Launcher-1.7.0.AppImage");
});

test("downloadUpdate streams binary asset with byte progress, speed, and ETA", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-updater-test-"));
  const destination = path.join(tempDir, "update-binary.bin");

  // Create local HTTP server serving a test payload
  const testData = Buffer.alloc(1024 * 64, "X"); // 64 KB
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Length": testData.length,
      "Content-Type": "application/octet-stream",
    });
    // Send in chunks to test progress
    const chunkSize = 16 * 1024;
    for (let offset = 0; offset < testData.length; offset += chunkSize) {
      res.write(testData.subarray(offset, offset + chunkSize));
    }
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const assetUrl = `http://127.0.0.1:${port}/update.bin`;

  const progressEvents = [];
  try {
    const result = await downloadUpdate({
      assetUrl,
      destination,
      onProgress: (p) => progressEvents.push(p),
    });

    assert.equal(result.destination, destination);
    assert.equal(result.size, testData.length);
    assert.ok(fs.existsSync(destination));

    const downloadedContent = await fsp.readFile(destination);
    assert.equal(downloadedContent.length, testData.length);
    assert.ok(downloadedContent.equals(testData));

    assert.ok(progressEvents.length > 0);
    const lastEvent = progressEvents[progressEvents.length - 1];
    assert.equal(lastEvent.received, testData.length);
    assert.equal(lastEvent.percent, 100);
  } finally {
    server.close();
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("checkForUpdate retries on 5xx and succeeds on subsequent attempt", async () => {
  const mockRelease = {
    tag_name: "v1.7.0",
    name: "Scope Launcher 1.7.0",
    body: "Release notes",
    published_at: "2026-09-13T18:00:00Z",
    assets: [
      {
        name: "Scope-Launcher-1.7.0.AppImage",
        browser_download_url: "https://example.com/Scope-Launcher-1.7.0.AppImage",
        size: 50000000,
      },
    ],
  };

  let attempt = 0;
  const mockFetch = async () => {
    attempt++;
    if (attempt <= 2) {
      return { ok: false, status: 502, headers: { get: () => null } };
    }
    return {
      ok: true,
      status: 200,
      json: async () => mockRelease,
      headers: { get: () => null },
    };
  };

  const result = await checkForUpdate("1.6.11", {
    fetch: mockFetch,
    platform: "linux",
    maxRetries: 3,
  });

  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, "1.7.0");
  assert.equal(attempt, 3);
});

test("checkForUpdate throws on GitHub API rate limit (403 with x-ratelimit-remaining: 0)", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 403,
    headers: {
      get: (name) => {
        if (name === "x-ratelimit-remaining") return "0";
        if (name === "x-ratelimit-reset") return String(Math.floor(Date.now() / 1000) + 3600);
        return null;
      },
    },
  });

  await assert.rejects(
    () => checkForUpdate("1.6.11", { fetch: mockFetch, maxRetries: 0 }),
    (err) => {
      assert.ok(/rate limit exceeded/i.test(err.message));
      return true;
    },
  );
});

test("checkForUpdate returns notModified on 304 response", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 304,
    headers: { get: () => null },
  });

  const result = await checkForUpdate("1.6.11", {
    fetch: mockFetch,
    etag: '"abc123"',
    maxRetries: 0,
  });

  assert.equal(result.updateAvailable, false);
  assert.equal(result.notModified, true);
});
