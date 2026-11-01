const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { safeStorage } = require("electron");
const {
  fetchJson,
  fetchJsonResponse,
  delay,
} = require("./network.cjs");

const DEFAULT_CLIENT_ID = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";
const CLIENT_ID = (
  process.env.ONYX_MICROSOFT_CLIENT_ID || DEFAULT_CLIENT_ID
).trim();
const DEVICE_CODE_ENDPOINT =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE = "XboxLive.SignIn XboxLive.offline_access";
const STORE_VERSION = 4;
const XBOX_AUTH = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN = "https://api.minecraftservices.com/launcher/login";
const MC_ENTITLEMENTS =
  "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE = "https://api.minecraftservices.com/minecraft/profile";
const MC_SKINS = "https://api.minecraftservices.com/minecraft/profile/skins";
const MAX_SKIN_BYTES = 1024 * 1024;

function offlineUuid(name) {
  const bytes = crypto.createHash("md5").update(`OfflinePlayer:${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeOfflineName(value) {
  const name = String(value || "").trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error(
      "An offline account name must contain 3–16 Latin letters, digits, or underscores",
    );
  }
  return name;
}

function normalizeSkinVariant(value) {
  return value === "slim" ? "slim" : "classic";
}

function validateSkin(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_SKIN_BYTES) {
    throw new Error("The skin must be a PNG file no larger than 1 MB");
  }
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Select a valid PNG skin file");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== 64 || ![32, 64].includes(height)) {
    throw new Error("The skin must be 64×32 or 64×64 pixels");
  }
}

function localSkin(buffer, variant) {
  validateSkin(buffer);
  return {
    id: crypto.randomUUID(),
    state: "ACTIVE",
    url: `data:image/png;base64,${buffer.toString("base64")}`,
    variant: normalizeSkinVariant(variant),
  };
}

function normalizedLocalSkin(value) {
  if (!value || typeof value.url !== "string") return null;
  if (!value.url.startsWith("data:image/png;base64,")) return null;
  if (value.url.length > Math.ceil(MAX_SKIN_BYTES * 1.4)) return null;
  return {
    id: typeof value.id === "string" ? value.id.slice(0, 80) : crypto.randomUUID(),
    state: "ACTIVE",
    url: value.url,
    variant: normalizeSkinVariant(value.variant),
  };
}

class AuthService {
  constructor(userDataPath) {
    this.accountPath = path.join(userDataPath, "account.json");
    this.sessions = new Map();
    this.cachedMinecraft = null;
    this.cachedAccountId = null;
    this.volatileStore = null;
  }

  encryptionAvailable() {
    try {
      if (!safeStorage?.isEncryptionAvailable?.()) return false;
      const backend = safeStorage?.getSelectedStorageBackend?.();
      return backend !== "basic_text";
    } catch {
      return false;
    }
  }

  storageStatus() {
    let backend = null;
    try {
      backend = safeStorage?.getSelectedStorageBackend?.() || null;
    } catch {
      backend = null;
    }
    const persistent = this.encryptionAvailable();
    return { persistent, encrypted: persistent, backend };
  }

  async beginLogin() {
    const { response, payload } = await fetchJsonResponse(DEVICE_CODE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPE,
      }),
    });
    if (!response.ok || !payload.device_code) {
      throw new Error(
        payload.error_description ||
          "Microsoft did not provide an authorization code",
      );
    }
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      ...payload,
      createdAt: Date.now(),
      cancelled: false,
    });
    return {
      sessionId,
      userCode: payload.user_code,
      verificationUri:
        payload.verification_uri || "https://microsoft.com/link",
      expiresIn: payload.expires_in,
      message: payload.message,
    };
  }

  cancelLogin(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.cancelled = true;
  }

  async waitForLogin(sessionId, onStatus) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("The authorization session was not found");
    const deadline = session.createdAt + session.expires_in * 1000;
    let interval = Math.max(3, session.interval || 5);

    try {
      while (Date.now() < deadline) {
        if (session.cancelled) throw new Error("Authorization cancelled");
        await delay(interval * 1000);
        onStatus?.("Waiting for Microsoft confirmation…");
        const { response, payload } = await fetchJsonResponse(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            device_code: session.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        if (response.ok && payload.access_token) {
          onStatus?.("Checking the Xbox profile…");
          const account = await this.exchangeMicrosoftToken(payload);
          await this.saveAccount({
            profile: account.profile,
            refreshToken: payload.refresh_token,
            oauthClientId: CLIENT_ID,
            signedInAt: new Date().toISOString(),
          });
          this.cachedMinecraft = account.launchAccount;
          this.cachedAccountId = account.profile.uuid;
          return account.profile;
        }
        if (payload.error === "authorization_pending") continue;
        if (payload.error === "slow_down") {
          interval += 5;
          continue;
        }
        if (payload.error === "authorization_declined") {
          throw new Error("Sign-in was declined in the Microsoft window");
        }
        if (payload.error === "expired_token") {
          throw new Error("The sign-in code expired; start authorization again");
        }
        throw new Error(
          payload.error_description || "Microsoft did not complete authorization",
        );
      }
      throw new Error("Authorization timed out");
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async fetchJson(url, options) {
    return fetchJson(url, options);
  }

  async exchangeMicrosoftToken(msToken) {
    const xbox = await this.postJson(XBOX_AUTH, {
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msToken.access_token}`,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    });

    const xsts = await this.postJson(XSTS_AUTH, {
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [xbox.Token],
      },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    });

    const userHash = xsts.DisplayClaims?.xui?.[0]?.uhs;
    if (!userHash || !xsts.Token) {
      throw new Error("Xbox did not return profile data");
    }

    const minecraft = await this.postJson(
      MC_LOGIN,
      this.minecraftLoginPayload(userHash, xsts.Token),
      { xboxContract: false },
    );
    if (!minecraft.access_token) {
      throw new Error("Minecraft Services did not return an access token");
    }
    const headers = {
      Authorization: `Bearer ${minecraft.access_token}`,
    };
    const [entitlementsRes, profileRes] = await Promise.allSettled([
      this.fetchJson(MC_ENTITLEMENTS, { headers }),
      this.fetchJson(MC_PROFILE, { headers }),
    ]);

    const entitlements =
      entitlementsRes.status === "fulfilled" ? entitlementsRes.value : null;
    const profile =
      profileRes.status === "fulfilled" ? profileRes.value : null;
    const profileError =
      profileRes.status === "rejected" ? profileRes.reason : null;
    const entitlementsError =
      entitlementsRes.status === "rejected" ? entitlementsRes.reason : null;

    const is404 = (err) =>
      Boolean(
        err &&
          (String(err.message || "").includes("404") ||
            err.code === 404 ||
            err.status === 404),
      );

    const hasLicense =
      Array.isArray(entitlements?.items) && entitlements.items.length > 0;

    if (!hasLicense) {
      if (
        is404(profileError) ||
        is404(entitlementsError) ||
        (entitlements && !hasLicense)
      ) {
        throw new Error(
          "No Minecraft: Java Edition license was found on this account. Use \"Add offline\" to play without a license.",
        );
      }
      if (entitlementsError) {
        throw entitlementsError;
      }
      throw new Error(
        "No Minecraft: Java Edition license was found on this account. Use \"Add offline\" to play without a license.",
      );
    }

    if (is404(profileError) || !profile?.id || !profile?.name) {
      throw new Error(
        "A Minecraft profile has not been created yet. Open minecraft.net/profile to set your Java Edition username.",
      );
    }

    if (profileError) {
      throw profileError;
    }

    return {
      profile: {
        name: profile.name,
        uuid: profile.id,
        kind: "microsoft",
        skins: profile.skins || [],
        capes: profile.capes || [],
        avatarUrl: `https://mc-heads.net/avatar/${profile.id}/64`,
      },
      launchAccount: {
        accessToken: minecraft.access_token,
        expiresAt: Date.now() + Number(minecraft.expires_in || 86_400) * 1000,
        uuid: profile.id,
        name: profile.name,
        userType: "msa",
        xuid: minecraft.username || "",
        clientId: CLIENT_ID,
      },
    };
  }

  minecraftLoginPayload(userHash, xstsToken) {
    return {
      xtoken: `XBL3.0 x=${userHash};${xstsToken}`,
      platform: "PC_LAUNCHER",
    };
  }

  async postJson(url, body, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (options.xboxContract !== false) {
      headers["x-xbl-contract-version"] = "1";
    }
    const { response, payload } = await fetchJsonResponse(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const code = payload.XErr;
      const known = {
        2148916233: "The Microsoft account does not have an Xbox profile",
        2148916235: "Xbox Live is unavailable in the account region",
        2148916238:
          "A child account requires adult approval in Microsoft Family",
      };
      const statusMessage =
        response.status === 401
          ? "Xbox rejected the Microsoft token (401). Remove the account from Scope and sign in again"
          : `Xbox authorization error (${response.status})`;
      throw new Error(
        known[code] ||
          payload.Message ||
          payload.errorMessage ||
          statusMessage,
      );
    }
    return payload;
  }

  async refreshMicrosoft(refreshToken) {
    const { response, payload } = await fetchJsonResponse(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPE,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_description ||
          "The Microsoft session expired; sign in again",
      );
    }
    return payload;
  }

  async getLaunchAccount(accountId = null) {
    const stored = await this.loadAccount(accountId);
    if (stored?.profile?.kind === "offline") {
      return {
        name: stored.profile.name,
        uuid: stored.profile.uuid.replaceAll("-", ""),
        accessToken: "0",
        userType: "legacy",
        xuid: "",
        clientId: "",
      };
    }
    const storedAccountId = stored?.profile?.uuid;
    if (
      this.cachedMinecraft &&
      this.cachedAccountId === storedAccountId &&
      this.cachedMinecraft.expiresAt > Date.now() + 120_000
    ) {
      return this.cachedMinecraft;
    }
    if (!stored?.refreshToken) return null;
    if (!this.sameClientId(stored.oauthClientId, CLIENT_ID)) {
      throw new Error(
        "The account uses a legacy Microsoft OAuth format. Add it again to update sign-in",
      );
    }
    const refreshed = await this.refreshMicrosoft(stored.refreshToken);
    const account = await this.exchangeMicrosoftToken(refreshed);
    await this.saveAccount({
      profile: account.profile,
      refreshToken: refreshed.refresh_token || stored.refreshToken,
      oauthClientId: CLIENT_ID,
      signedInAt: stored.signedInAt,
    }, { activate: false });
    this.cachedMinecraft = account.launchAccount;
    this.cachedAccountId = account.profile.uuid;
    return account.launchAccount;
  }

  async getProfile() {
    const stored = await this.loadAccount();
    return stored?.profile || null;
  }

  async refreshProfile(accountId = null) {
    const stored = await this.loadAccount(accountId);
    if (!stored?.profile?.uuid) {
      throw new Error("Select a saved account first");
    }
    if (stored.profile.kind !== "microsoft") return stored.profile;

    const launchAccount = await this.getLaunchAccount(stored.profile.uuid);
    if (!launchAccount?.accessToken) {
      throw new Error("Failed to refresh the Microsoft session");
    }

    let remote;
    try {
      remote = await this.fetchJson(MC_PROFILE, {
        headers: { Authorization: `Bearer ${launchAccount.accessToken}` },
      });
    } catch (error) {
      if (
        String(error?.message || "").includes("404") ||
        error?.status === 404
      ) {
        throw new Error(
          "A Minecraft profile was not found on this account. Make sure your account owns Minecraft and has a profile set up on minecraft.net",
        );
      }
      throw error;
    }
    if (!remote?.id || !remote?.name) {
      throw new Error("Minecraft Services did not return a player profile");
    }

    const profile = {
      ...stored.profile,
      name: remote.name,
      uuid: remote.id,
      kind: "microsoft",
      skins: Array.isArray(remote.skins) ? remote.skins : [],
      capes: Array.isArray(remote.capes) ? remote.capes : [],
      avatarUrl: `https://mc-heads.net/avatar/${remote.id}/64?skin=${Date.now()}`,
    };
    await this.replaceProfile(profile);
    return profile;
  }

  async addOfflineAccount(name) {
    const normalizedName = normalizeOfflineName(name);
    const profile = {
      name: normalizedName,
      uuid: offlineUuid(normalizedName),
      kind: "offline",
      signedInAt: new Date().toISOString(),
      skins: [],
    };
    await this.saveAccount({ profile, signedInAt: profile.signedInAt });
    return profile;
  }

  async setSkinFromFile(filePath, variant, accountId = null) {
    const fileInfo = await fsp.stat(filePath);
    if (!fileInfo.isFile() || fileInfo.size > MAX_SKIN_BYTES) {
      throw new Error('The skin must be a PNG file no larger than 1 MB');
    }
    const buffer = await fsp.readFile(filePath);
    validateSkin(buffer);
    const stored = await this.loadAccount(accountId);
    if (!stored?.profile?.uuid) {
      throw new Error("Select a saved account first");
    }
    if (stored.profile.kind === "offline") {
      const profile = {
        ...stored.profile,
        skins: [localSkin(buffer, variant)],
      };
      await this.replaceProfile(profile);
      return profile;
    }
    if (stored.profile.kind !== "microsoft") {
      throw new Error("Skins are available only for Microsoft and offline accounts");
    }

    const launchAccount = await this.getLaunchAccount(stored.profile.uuid);
    const form = new FormData();
    form.set("variant", normalizeSkinVariant(variant));
    form.set(
      "file",
      new Blob([buffer], { type: "image/png" }),
      path.basename(filePath) || "skin.png",
    );
    const response = await fetch(MC_SKINS, {
      method: "POST",
      headers: { Authorization: `Bearer ${launchAccount.accessToken}` },
      body: form,
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // Minecraft Services occasionally responds without a JSON error body.
    }
    if (!response.ok) {
      throw new Error(
        payload.errorMessage ||
          payload.error ||
          `Minecraft Services could not apply the skin (${response.status})`,
      );
    }
    const current = await this.loadAccount(stored.profile.uuid);
    const profile = {
      ...current.profile,
      name: payload.name || current.profile.name,
      skins: Array.isArray(payload.skins) ? payload.skins : current.profile.skins || [],
      avatarUrl: `https://mc-heads.net/avatar/${current.profile.uuid}/64?skin=${Date.now()}`,
    };
    await this.replaceProfile(profile);
    return profile;
  }

  async saveAccount(account, { activate = true } = {}) {
    await fsp.mkdir(path.dirname(this.accountPath), { recursive: true });
    const store = await this.loadStore();
    const accountId = account.profile.uuid;
    const offline = account.profile.kind === "offline";
    const nextAccount = {
      profile: account.profile,
      signedInAt: account.signedInAt,
      ...(offline
        ? {}
        : {
            refreshToken: account.refreshToken,
            oauthClientId: account.oauthClientId || CLIENT_ID,
          }),
    };
    const existingIndex = store.accounts.findIndex(
      (item) => item.profile.uuid === accountId,
    );
    if (existingIndex >= 0) store.accounts[existingIndex] = nextAccount;
    else store.accounts.push(nextAccount);
    if (activate) store.activeId = accountId;
    await this.saveStore(store);
  }

  async replaceProfile(profile) {
    const store = await this.loadStore();
    const accountIndex = store.accounts.findIndex(
      (account) => account.profile.uuid === profile.uuid,
    );
    if (accountIndex < 0) throw new Error("Saved account not found");
    store.accounts[accountIndex] = {
      ...store.accounts[accountIndex],
      profile,
    };
    await this.saveStore(store);
  }

  protectToken(refreshToken) {
    if (!this.encryptionAvailable()) {
      throw new Error("Secure system storage is unavailable");
    }
    return {
      encrypted: true,
      value: safeStorage.encryptString(refreshToken).toString("base64"),
    };
  }

  unprotectToken(token) {
    if (!token?.value) return null;
    return token.encrypted
      ? safeStorage.decryptString(Buffer.from(token.value, "base64"))
      : Buffer.from(token.value, "base64").toString("utf8");
  }

  sameClientId(left, right) {
    return (
      typeof left === "string" &&
      typeof right === "string" &&
      left.trim().toLowerCase() === right.trim().toLowerCase()
    );
  }

  async saveStore(store) {
    const encryptionAvailable = this.encryptionAvailable();
    const persistentAccounts = encryptionAvailable
      ? store.accounts
      : store.accounts.filter((account) => account.profile?.kind === "offline");
    if (!encryptionAvailable) {
      this.volatileStore = structuredClone({
        version: STORE_VERSION,
        activeId: store.activeId || null,
        accounts: store.accounts,
      });
      if (!persistentAccounts.length) {
        await fsp.rm(this.accountPath, { force: true }).catch(() => undefined);
        return;
      }
    }
    if (encryptionAvailable) this.volatileStore = null;
    const serialized = {
      version: STORE_VERSION,
      activeId: store.activeId || null,
      accounts: persistentAccounts.map((account) =>
        account.profile?.kind === "offline"
          ? {
              profile: account.profile,
              signedInAt: account.signedInAt,
            }
          : {
              profile: account.profile,
              refreshToken: this.protectToken(account.refreshToken),
              oauthClientId: account.oauthClientId || null,
              signedInAt: account.signedInAt,
            },
      ),
    };
    const temporary = `${this.accountPath}.tmp`;
    await fsp.writeFile(
      temporary,
      JSON.stringify(serialized, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    await fsp.rm(this.accountPath, { force: true }).catch(() => undefined);
    await fsp.rename(temporary, this.accountPath);
  }

  async loadStore() {
    if (this.volatileStore) return structuredClone(this.volatileStore);
    try {
      const parsed = JSON.parse(await fsp.readFile(this.accountPath, "utf8"));
      const rawAccounts =
        (parsed.version === 2 || parsed.version === 3 || parsed.version === STORE_VERSION) &&
        Array.isArray(parsed.accounts)
          ? parsed.accounts
          : parsed.profile
            ? [parsed]
            : [];
      const accounts = [];
      for (const account of rawAccounts) {
        try {
          if (account.profile?.kind === "offline") {
            const name = normalizeOfflineName(account.profile.name);
            const skins = Array.isArray(account.profile.skins)
              ? account.profile.skins
                  .map(normalizedLocalSkin)
                  .filter(Boolean)
                  .slice(0, 1)
              : [];
            accounts.push({
              profile: {
                name,
                uuid: offlineUuid(name),
                kind: "offline",
                signedInAt: account.signedInAt,
                skins,
              },
              signedInAt: account.signedInAt,
            });
            continue;
          }
          const refreshToken = this.unprotectToken(account.refreshToken);
          if (account.profile?.uuid && refreshToken) {
            accounts.push({
              ...account,
              refreshToken,
              oauthClientId: account.oauthClientId || null,
            });
          }
        } catch {
          // A damaged token does not invalidate the other saved accounts.
        }
      }
      const activeId =
        accounts.find((item) => item.profile.uuid === parsed.activeId)?.profile
          .uuid ||
        accounts[0]?.profile.uuid ||
        null;
      const store = { version: STORE_VERSION, activeId, accounts };
      const containsPlaintext = rawAccounts.some(
        (account) => account.refreshToken?.encrypted === false,
      );
      if (containsPlaintext && accounts.length) {
        if (this.encryptionAvailable()) await this.saveStore(store);
        else {
          this.volatileStore = structuredClone(store);
          await fsp.rm(this.accountPath, { force: true }).catch(() => undefined);
        }
      }
      return store;
    } catch {
      return { version: STORE_VERSION, activeId: null, accounts: [] };
    }
  }

  async loadAccount(accountId = null) {
    const store = await this.loadStore();
    return (
      store.accounts.find(
        (account) => account.profile.uuid === (accountId || store.activeId),
      ) || null
    );
  }

  async listAccounts() {
    const store = await this.loadStore();
    return {
      activeId: store.activeId,
      storage: this.storageStatus(),
      profiles: store.accounts.map((account) => ({
        ...account.profile,
        signedInAt: account.signedInAt,
      })),
    };
  }

  async switchAccount(accountId) {
    const store = await this.loadStore();
    const account = store.accounts.find(
      (item) => item.profile.uuid === accountId,
    );
    if (!account) throw new Error("Saved account not found");
    store.activeId = accountId;
    await this.saveStore(store);
    this.cachedMinecraft = null;
    this.cachedAccountId = null;
    return account.profile;
  }

  async removeAccount(accountId) {
    const store = await this.loadStore();
    store.accounts = store.accounts.filter(
      (account) => account.profile.uuid !== accountId,
    );
    if (store.activeId === accountId) {
      store.activeId = store.accounts[0]?.profile.uuid || null;
    }
    this.cachedMinecraft = null;
    this.cachedAccountId = null;
    if (store.accounts.length) await this.saveStore(store);
    else {
      this.volatileStore = {
        version: STORE_VERSION,
        activeId: null,
        accounts: [],
      };
      await fsp.rm(this.accountPath, { force: true });
    }
    return (
      store.accounts.find(
        (account) => account.profile.uuid === store.activeId,
      )?.profile || null
    );
  }

  async signOut() {
    const active = await this.loadAccount();
    if (!active) return null;
    return this.removeAccount(active.profile.uuid);
  }
}

module.exports = {
  AuthService,
  CLIENT_ID,
  DEFAULT_CLIENT_ID,
  DEVICE_CODE_ENDPOINT,
  TOKEN_ENDPOINT,
  SCOPE,
  MC_LOGIN,
};
