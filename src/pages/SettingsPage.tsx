import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Accessibility,
  Activity,
  Bell,
  Box,
  Check,
  ChevronRight,
  Clock,
  Coffee,
  Cpu,
  Database,
  Download,
  ExternalLink,
  EyeOff,
  FileJson,
  FolderOpen,
  Gauge,
  Globe,
  HardDrive,
  HeartPulse,
  Info,
  Languages,
  Laptop,
  LoaderCircle,
  Palette,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Wifi,
} from "lucide-react";
import type {
  Accent,
  DiscordRpcStatus,
  LauncherSettings,
  Locale,
  Profile,
  SystemDiagnostics,
  UpdateInfo,
  UpdateProgress,
} from "../types";
import { useI18n } from "../i18n";
import { formatBytes, formatSpeed, formatEta } from "../utils";
import { DiscordIcon } from "../components/DiscordIcon";
import packageMetadata from "../../package.json";

interface SettingsPageProps {
  settings: LauncherSettings;
  profile: Profile;
  onUpdate: (settings: Partial<LauncherSettings>) => Promise<void>;
  onAccount: () => void;
  onMoveDirectory: (path: string) => Promise<{
    copied: number;
    oldDirectory: string;
    newDirectory: string;
  }>;
  onNotify: (
    tone: "success" | "warning" | "info",
    title: string,
    message: string,
  ) => void;
}

type SettingsSection =
  | "general"
  | "minecraft"
  | "appearance"
  | "account"
  | "diagnostics";

export function SettingsPage({
  settings,
  profile,
  onUpdate,
  onAccount,
  onMoveDirectory,
  onNotify,
}: SettingsPageProps) {
  const { locale, setLocale, t } = useI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const [saved, setSaved] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(
    null,
  );
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [rpcStatus, setRpcStatus] = useState<DiscordRpcStatus | null>(null);

  useEffect(() => {
    let unmounted = false;
    window.onyx?.rpc
      ?.getStatus?.()
      .then((status) => {
        if (!unmounted && status) setRpcStatus(status);
      })
      .catch(() => {});

    const unsubscribe = window.onyx?.rpc?.onStatusChange?.((status) => {
      if (!unmounted && status) setRpcStatus(status);
    });

    return () => {
      unmounted = true;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!window.onyx?.updater?.onProgress) return;
    const unsubscribe = window.onyx.updater.onProgress((progress) => {
      setUpdateProgress(progress);
      if (progress.percent !== undefined && progress.percent >= 100) {
        setDownloadingUpdate(false);
        setUpdateReady(true);
      }
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const result = await window.onyx.updater.check();
      setUpdateInfo(result);
      if (!result.updateAvailable) {
        onNotify(
          "info",
          t("settings.appUpdates.title"),
          t("settings.appUpdates.upToDate"),
        );
      } else {
        onNotify(
          "success",
          t("settings.appUpdates.title"),
          t("settings.appUpdates.available", { version: result.latestVersion }),
        );
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to check for updates";
      setUpdateError(msg);
      onNotify("warning", t("settings.appUpdates.title"), msg);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setDownloadingUpdate(true);
    setUpdateError(null);
    setUpdateProgress({
      received: 0,
      total: updateInfo?.assetSize || 0,
      percent: 0,
    });
    try {
      await window.onyx.updater.download();
      setUpdateReady(true);
      setDownloadingUpdate(false);
      onNotify(
        "success",
        t("settings.appUpdates.title"),
        t("settings.appUpdates.ready"),
      );
    } catch (error) {
      setDownloadingUpdate(false);
      const msg =
        error instanceof Error ? error.message : "Failed to download update";
      setUpdateError(msg);
      onNotify("warning", t("settings.appUpdates.title"), msg);
    }
  };

  const handleApplyUpdate = async () => {
    try {
      await window.onyx.updater.install();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to apply update";
      setUpdateError(msg);
      onNotify("warning", t("settings.appUpdates.title"), msg);
    }
  };

  const update = async (patch: Partial<LauncherSettings>) => {
    await onUpdate(patch);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  };

  const changeLanguage = async (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
    await update({ language: next });
  };

  const loadDiagnostics = async () => {
    setDiagnosticsBusy(true);
    try {
      setDiagnostics(await window.onyx.system.diagnostics());
    } catch (error) {
      onNotify(
        "warning",
        t("settings.diagnostics.unavailable"),
        error instanceof Error ? error.message : t("settings.diagnostics.failed"),
      );
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  return (
    <motion.div
      className="page settings-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("settings.eyebrow")}</p>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </div>
        <span className={`saved-indicator ${saved ? "is-visible" : ""}`}>
          <Check size={14} /> {t("common.saved")}
        </span>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {(
            [
              ["general", SlidersHorizontal, t("settings.nav.general"), t("settings.nav.generalHint")],
              ["minecraft", Box, t("settings.nav.minecraft"), t("settings.nav.minecraftHint")],
              ["appearance", Palette, t("settings.nav.appearance"), t("settings.nav.appearanceHint")],
              ["account", UserRound, t("settings.nav.account"), t("settings.nav.accountHint")],
              [
                "diagnostics",
                HeartPulse,
                t("settings.nav.diagnostics"),
                t("settings.nav.diagnosticsHint"),
              ],
            ] as const
          ).map(([id, Icon, title, subtitle]) => (
            <button
              key={id}
              className={section === id ? "is-active" : ""}
              onClick={() => {
                setSection(id);
                if (id === "diagnostics" && !diagnostics) {
                  void loadDiagnostics();
                }
              }}
            >
              <span>
                <Icon size={18} />
              </span>
              <div>
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
          <div className="settings-version">
            <span className="brand-mark brand-mark--small">
              <i />
              <b />
            </span>
            <div>
              <strong>Scope Launcher</strong>
              <small>{packageMetadata.version} · {t("settings.channel")}</small>
            </div>
          </div>
          <a
            href="https://discord.gg/qHZCehveYp"
            target="_blank"
            rel="noreferrer"
            className="settings-discord-link"
          >
            <DiscordIcon size={15} />
            <span>{t("settings.discordNav")}</span>
            <ExternalLink size={12} />
          </a>
        </nav>

        <section className="settings-content">
          {section === "general" && (
            <>
              <SettingsTitle
                icon={Laptop}
                title={t("settings.general.title")}
                subtitle={t("settings.general.subtitle")}
              />

              <SettingsGroup title={t("settings.language")}>
                <div className="language-setting">
                  <span className="setting-row__icon">
                    <Languages size={17} />
                  </span>
                  <div>
                    <strong>{t("settings.language.title")}</strong>
                    <p>{t("settings.language.hint")}</p>
                  </div>
                  <div
                    className="language-toggle"
                    role="radiogroup"
                    aria-label={t("settings.language.title")}
                  >
                    {(
                      [
                        ["en", t("settings.language.english")],
                        ["ru", t("settings.language.russian")],
                      ] as Array<[Locale, string]>
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={locale === id}
                        aria-label={label}
                        lang={id}
                        className={locale === id ? "is-active" : ""}
                        onClick={() => void changeLanguage(id)}
                      >
                        {id.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </SettingsGroup>

              <SettingsGroup title={t("settings.behavior")}>
                <ToggleRow
                  icon={Cpu}
                  title={t("settings.ghostMode")}
                  description={t("settings.ghostModeHint")}
                  checked={settings.ghostMode}
                  onChange={(value) => void update({ ghostMode: value })}
                  hint={t("settings.ghostModeBadge")}
                />
                <ToggleRow
                  icon={Gauge}
                  title={t("settings.keepOpen")}
                  description={t("settings.keepOpenHint")}
                  checked={!settings.closeOnLaunch}
                  onChange={(value) =>
                    void update({
                      keepLauncherOpen: value,
                      closeOnLaunch: !value,
                    })
                  }
                />
                <ToggleRow
                  icon={Bell}
                  title={t("settings.notifications")}
                  description={t("settings.notificationsHint")}
                  checked={settings.notifications}
                  onChange={(value) => void update({ notifications: value })}
                />
                <ToggleRow
                  icon={RefreshCw}
                  title={t("settings.autoUpdates")}
                  description={t("settings.autoUpdatesHint")}
                  checked={settings.autoCheckUpdates}
                  onChange={(value) =>
                    void update({ autoCheckUpdates: value })
                  }
                />
              </SettingsGroup>

              <SettingsGroup title={t("settings.appUpdates.title")}>
                <div className="setting-row">
                  <span className="setting-row__icon">
                    <RefreshCw size={17} className={checkingUpdate ? "spin" : ""} />
                  </span>
                  <div>
                    <strong>Scope Launcher v{packageMetadata.version}</strong>
                    <p>
                      {checkingUpdate
                        ? t("settings.appUpdates.checking")
                        : updateReady
                        ? t("settings.appUpdates.ready")
                        : downloadingUpdate
                        ? t("settings.appUpdates.downloading")
                        : updateInfo?.updateAvailable
                        ? t("settings.appUpdates.available", { version: updateInfo.latestVersion })
                        : updateInfo
                        ? t("settings.appUpdates.upToDate")
                        : t("settings.appUpdates.checkGithub")}
                    </p>
                    {updateError && (
                      <small style={{ color: "var(--danger, #ef4444)" }}>{updateError}</small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="button button--secondary button--mini"
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdate || downloadingUpdate}
                  >
                    {checkingUpdate && <LoaderCircle size={14} className="spin" />}
                    <span>{checkingUpdate ? t("settings.appUpdates.btnChecking") : t("settings.appUpdates.btnCheck")}</span>
                  </button>
                </div>

                {updateInfo?.updateAvailable && (
                  <div style={{ padding: "14px 16px", borderTop: "1px solid var(--line)" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 13, color: "var(--text)" }}>
                          Scope Launcher v{updateInfo.latestVersion}
                        </strong>
                        {updateInfo.publishedAt && (
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--text-soft)",
                              marginLeft: 8,
                            }}
                          >
                            • {t("settings.appUpdates.released", { date: new Date(updateInfo.publishedAt).toLocaleDateString() })}
                          </span>
                        )}
                      </div>

                      <div>
                        {!downloadingUpdate && !updateReady && (
                          <button
                            type="button"
                            className="button button--primary button--mini"
                            onClick={handleDownloadUpdate}
                          >
                            <Download size={14} />
                            <span>{t("settings.appUpdates.btnDownload")}</span>
                          </button>
                        )}
                        {updateReady && (
                          <button
                            type="button"
                            className="button button--primary button--mini"
                            onClick={handleApplyUpdate}
                          >
                            <Check size={14} />
                            <span>{t("settings.appUpdates.btnRestart")}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {updateInfo.releaseNotes && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "10px 12px",
                          background: "var(--surface-raised)",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--line)",
                          fontSize: 12,
                          color: "var(--text-soft)",
                          maxHeight: 140,
                          overflowY: "auto",
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.5,
                        }}
                      >
                        {updateInfo.releaseNotes}
                      </div>
                    )}

                    {downloadingUpdate && (
                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            color: "var(--text-soft)",
                            marginBottom: 6,
                          }}
                        >
                          <span>
                            {updateProgress?.percent ?? 0}% ({formatBytes(updateProgress?.received || 0, locale)} / {formatBytes(updateProgress?.total || updateInfo.assetSize || 0, locale)})
                          </span>
                          <div style={{ display: "flex", gap: 12 }}>
                            {updateProgress?.speed ? (
                              <span>{formatSpeed(updateProgress.speed)}</span>
                            ) : null}
                            {updateProgress?.eta ? (
                              <span>ETA: {formatEta(updateProgress.eta)}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="migration-progress-bar">
                          <div
                            className="migration-progress-bar__fill"
                            style={{
                              width: `${Math.max(0, Math.min(updateProgress?.percent ?? 0, 100))}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SettingsGroup>
              <SettingsGroup title={t("settings.system")}>
                <ToggleRow
                  icon={Cpu}
                  title={t("settings.hardware")}
                  description={t("settings.hardwareHint")}
                  checked={settings.hardwareAcceleration}
                  onChange={(value) =>
                    void update({ hardwareAcceleration: value })
                  }
                  hint={t("settings.restartHint")}
                />
                <ToggleRow
                  icon={Accessibility}
                  title={t("settings.motion")}
                  description={t("settings.motionHint")}
                  checked={settings.reducedMotion}
                  onChange={(value) => void update({ reducedMotion: value })}
                />
                <ToggleRow
                  icon={Activity}
                  title={t("settings.telemetry")}
                  description={t("settings.telemetryHint")}
                  checked={settings.telemetry !== false}
                  onChange={(value) => void update({ telemetry: value })}
                />
              </SettingsGroup>

              <SettingsGroup title={t("settings.discordRpc")}>
                <div className="setting-row">
                  <span className="setting-row__icon">
                    <DiscordIcon size={17} />
                  </span>
                  <div>
                    <strong>{t("settings.discordRpc")}</strong>
                    <p>{t("settings.discordRpcHint")}</p>
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background:
                            settings.discordRpc === false
                              ? "var(--muted, #666)"
                              : rpcStatus?.connected
                                ? "#22c55e"
                                : "#eab308",
                        }}
                      />
                      <small style={{ color: "var(--muted, #888)" }}>
                        {settings.discordRpc === false
                          ? t("settings.discordRpcStatusDisabled")
                          : rpcStatus?.connected
                            ? t("settings.discordRpcStatusConnected", {
                                user: rpcStatus.user || "User",
                              })
                            : rpcStatus?.connecting
                              ? t("settings.discordRpcStatusConnecting")
                              : t("settings.discordRpcStatusDisconnected")}
                      </small>
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={settings.discordRpc !== false}
                    className={`toggle ${settings.discordRpc !== false ? "is-on" : ""}`}
                    onClick={() =>
                      void update({ discordRpc: settings.discordRpc === false })
                    }
                  >
                    <i />
                  </button>
                </div>

                {settings.discordRpc !== false && (
                  <>
                    <ToggleRow
                      icon={Box}
                      title={t("settings.discordRpcShowGame")}
                      description={t("settings.discordRpcShowGameHint")}
                      checked={settings.discordRpcShowGame !== false}
                      onChange={(value) =>
                        void update({ discordRpcShowGame: value })
                      }
                    />
                    <ToggleRow
                      icon={Clock}
                      title={t("settings.discordRpcShowTime")}
                      description={t("settings.discordRpcShowTimeHint")}
                      checked={settings.discordRpcShowTime !== false}
                      onChange={(value) =>
                        void update({ discordRpcShowTime: value })
                      }
                    />
                    <ToggleRow
                      icon={Server}
                      title={t("settings.discordRpcShowServer")}
                      description={t("settings.discordRpcShowServerHint")}
                      checked={settings.discordRpcShowServer !== false}
                      onChange={(value) =>
                        void update({ discordRpcShowServer: value })
                      }
                    />
                    <ToggleRow
                      icon={Globe}
                      title={t("settings.discordRpcShowWorld")}
                      description={t("settings.discordRpcShowWorldHint")}
                      checked={settings.discordRpcShowWorld !== false}
                      onChange={(value) =>
                        void update({ discordRpcShowWorld: value })
                      }
                    />
                    {settings.discordRpcShowServer !== false && (
                      <ToggleRow
                        icon={EyeOff}
                        title={t("settings.discordRpcHideServerIp")}
                        description={t("settings.discordRpcHideServerIpHint")}
                        checked={settings.discordRpcHideServerIp === true}
                        onChange={(value) =>
                          void update({ discordRpcHideServerIp: value })
                        }
                      />
                    )}
                  </>
                )}
              </SettingsGroup>

              <SettingsGroup title={t("settings.community")}>
                <div className="setting-row">
                  <span className="setting-row__icon">
                    <DiscordIcon size={17} />
                  </span>
                  <div>
                    <strong>{t("settings.discordCommunity")}</strong>
                    <p>{t("settings.discordCommunityHint")}</p>
                  </div>
                  <a
                    href="https://discord.gg/qHZCehveYp"
                    target="_blank"
                    rel="noreferrer"
                    className="button button--secondary button--mini"
                    style={{
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>{t("settings.discordJoin")}</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              </SettingsGroup>
            </>
          )}

          {section === "minecraft" && (
            <>
              <SettingsTitle
                icon={Box}
                title="Minecraft"
                subtitle={t("settings.minecraft.subtitle")}
              />
              <SettingsGroup title={t("settings.memory")}>
                <div className="memory-setting">
                  <div className="memory-setting__head">
                    <div>
                      <strong>{t("settings.memory.title")}</strong>
                      <p>{t("settings.memory.hint")}</p>
                    </div>
                    <span>{settings.memory} GB</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="16"
                    step="1"
                    value={settings.memory}
                    onChange={(event) =>
                      void update({ memory: Number(event.target.value) })
                    }
                    style={
                      {
                        "--range-value": `${((settings.memory - 2) / 14) * 100}%`,
                      } as React.CSSProperties
                    }
                  />
                  <div className="memory-setting__scale">
                    <span>2 GB</span>
                    <span>8 GB</span>
                    <span>16 GB</span>
                  </div>
                </div>
              </SettingsGroup>

              <SettingsGroup title={t("settings.paths")}>
                <PathSetting
                  icon={FolderOpen}
                  title={t("settings.instancesFolder")}
                  path={settings.gameDirectory}
                  buttonLabel={t("common.change")}
                  onBrowse={async () => {
                    const selected = await window.onyx.system.chooseDirectory();
                    if (selected) {
                      const result = await onMoveDirectory(selected);
                      onNotify(
                        "success",
                        t("settings.folder.changed"),
                        result.copied
                          ? t("settings.folder.copied", { count: result.copied })
                          : t("settings.folder.future"),
                      );
                    }
                  }}
                  onOpen={() =>
                    void window.onyx.system.openPath(settings.gameDirectory)
                  }
                />
                <PathSetting
                  icon={Coffee}
                  title={t("settings.java")}
                  path={settings.javaPath || t("settings.java.auto")}
                  buttonLabel={t("common.choose")}
                  onBrowse={async () => {
                    const selected = await window.onyx.system.chooseJava();
                    if (selected) await update({ javaPath: selected });
                  }}
                />
              </SettingsGroup>

              <SettingsGroup title={t("settings.versions")}>
                <ToggleRow
                  icon={Info}
                  title={t("settings.snapshots")}
                  description={t("settings.snapshotsHint")}
                  checked={settings.showSnapshots}
                  onChange={(value) => void update({ showSnapshots: value })}
                />
              </SettingsGroup>
            </>
          )}

          {section === "appearance" && (
            <>
              <SettingsTitle
                icon={Palette}
                title={t("settings.nav.appearance")}
                subtitle={t("settings.appearance.subtitle")}
              />
              <SettingsGroup title={t("settings.accent")}>
                <div className="accent-picker">
                  {(
                    [
                      ["lime", t("settings.accent.lime"), "#84cc16"],
                      ["cyan", t("settings.accent.cyan"), "#06b6d4"],
                      ["violet", t("settings.accent.violet"), "#8b5cf6"],
                    ] as Array<[Accent, string, string]>
                  ).map(([id, name, color]) => (
                    <button
                      key={id}
                      className={settings.accent === id ? "is-active" : ""}
                      onClick={() => void update({ accent: id })}
                    >
                      <i style={{ background: color }} />
                      <span>{name}</span>
                      {settings.accent === id && <Check size={15} />}
                    </button>
                  ))}
                </div>
              </SettingsGroup>
              <SettingsGroup title={t("settings.preview")}>
                <div className="theme-preview-card">
                  <div className="theme-preview-card__header">
                    <div className="theme-preview-card__badge">
                      <span className="theme-preview-card__dot" />
                      <span>{settings.accent.toUpperCase()} ACCENT PREVIEW</span>
                    </div>
                    <span className="theme-preview-card__version">1.21.4 · Fabric</span>
                  </div>
                  <div className="theme-preview-card__body">
                    <div>
                      <div className="theme-preview-card__title">Fabulously Optimized</div>
                      <div className="theme-preview-card__meta">64 mods · Sodium · Iris Shaders · Ready</div>
                    </div>
                    <button className="button button--primary button--mini" type="button" tabIndex={-1}>
                      Play Instance
                    </button>
                  </div>
                </div>
              </SettingsGroup>
            </>
          )}

          {section === "diagnostics" && (
            <>
              <SettingsTitle
                icon={HeartPulse}
                title={t("settings.nav.diagnostics")}
                subtitle={t("settings.diagnostics.subtitle")}
              />
              <div className="diagnostics-toolbar">
                <div>
                  <strong>{t("settings.diagnostics.center")}</strong>
<p>{t("settings.diagnostics.description")}</p>
                </div>
                <button
                  className="button button--secondary"
                  disabled={diagnosticsBusy}
                  onClick={() => void loadDiagnostics()}
                >
                  <RefreshCw
                    className={diagnosticsBusy ? "spin" : ""}
                    size={15}
                  />
                  {t("common.check")}
                </button>
              </div>

              {diagnosticsBusy && !diagnostics ? (
                <div className="diagnostics-loading">
                  <RefreshCw className="spin" size={20} />
                  {t("settings.diagnostics.loading")}
                </div>
              ) : diagnostics ? (
                <>
                  <div className="diagnostics-grid">
                    <SystemMetric
                      icon={Cpu}
                      label={t("settings.diagnostics.ram")}
                      value={`${formatBytes(diagnostics.system.totalMemory - diagnostics.system.freeMemory, locale)} / ${formatBytes(diagnostics.system.totalMemory, locale)}`}
                      detail={t("settings.diagnostics.threads", { count: diagnostics.system.cpuThreads, architecture: diagnostics.system.architecture })}
                      progress={
                        diagnostics.system.totalMemory
                          ? ((diagnostics.system.totalMemory -
                              diagnostics.system.freeMemory) /
                              diagnostics.system.totalMemory) *
                            100
                          : 0
                      }
                    />
                    <SystemMetric
                      icon={Gauge}
                      label={t("settings.diagnostics.onyxMemory")}
                      value={formatBytes(
                        diagnostics.launcher.processMemory.workingSet,
                        locale,
                      )}
                      detail={t("settings.diagnostics.processes", {
                        count: diagnostics.launcher.processMemory.processes,
                      })}
                      progress={Math.min(
                        100,
                        (diagnostics.launcher.processMemory.workingSet /
                          (512 * 1024 ** 2)) *
                          100,
                      )}
                      positive={
                        diagnostics.launcher.processMemory.workingSet <
                        300 * 1024 ** 2
                      }
                    />
                    <SystemMetric
                      icon={HardDrive}
                      label={t("settings.diagnostics.disk")}
                      value={formatBytes(diagnostics.storage.disk.free, locale)}
                      detail={t("settings.diagnostics.instancesSize", { size: formatBytes(diagnostics.storage.instances.bytes, locale) })}
                      progress={
                        diagnostics.storage.disk.total
                          ? (diagnostics.storage.disk.free /
                              diagnostics.storage.disk.total) *
                            100
                          : 0
                      }
                      positive
                    />
                    <SystemMetric
                      icon={Coffee}
                      label="Java"
                      value={
                        diagnostics.java
                          ? `Java ${diagnostics.java.major}`
                          : t("settings.diagnostics.notFound")
                      }
                      detail={
                        diagnostics.java?.version ||
                        t("settings.diagnostics.javaAuto")
                      }
                      progress={diagnostics.java ? 100 : 0}
                      positive
                    />
                    <SystemMetric
                      icon={Database}
                      label={t("settings.diagnostics.data")}
                      value={formatBytes(diagnostics.storage.data.bytes, locale)}
                      detail={t("settings.diagnostics.fileCount", { count: diagnostics.storage.data.files.toLocaleString("en-US") })}
                      progress={100}
                    />
                  </div>

                  <SettingsGroup title={t("settings.diagnostics.network")}>
                    <div className="endpoint-list">
                      {diagnostics.endpoints.map((endpoint) => (
                        <div
                          className={`endpoint-row ${endpoint.ok ? "is-online" : "is-offline"}`}
                          key={endpoint.name}
                        >
                          <span>
                            <Wifi size={16} />
                          </span>
                          <div>
                            <strong>{endpoint.name}</strong>
                            <small>
                              {endpoint.ok
                                ? `${t("common.available")} · ${endpoint.latencyMs} ms`
                                : endpoint.error ||
                                  `HTTP ${endpoint.status || "—"}`}
                            </small>
                          </div>
                          <i>{endpoint.ok ? t("settings.diagnostics.online") : t("settings.diagnostics.offline")}</i>
                        </div>
                      ))}
                    </div>
                  </SettingsGroup>

                  <SettingsGroup title={t("settings.maintenance")}>
                    <div className="maintenance-actions">
                      <button
                        onClick={async () => {
                          const file =
                            await window.onyx.system.exportDiagnostics();
                          if (file) {
                            onNotify(
                              "success",
                              t("settings.report.saved"),
                              t("settings.report.savedHint"),
                            );
                          }
                        }}
                      >
                        <span>
                          <FileJson size={17} />
                        </span>
                        <div>
                          <strong>{t("settings.report.export")}</strong>
                          <small>{t("settings.report.safe")}</small>
                        </div>
                      </button>
                      <button
                        onClick={async () => {
                          const result = await window.onyx.system.clearCache();
                          onNotify(
                            "success",
                            t("settings.cache.cleared"),
                            t("settings.cache.result", { bytes: formatBytes(result.bytes, locale), files: result.files }),
                          );
                          await loadDiagnostics();
                        }}
                      >
                        <span>
                          <Trash2 size={17} />
                        </span>
                        <div>
                          <strong>{t("settings.cache.clear")}</strong>
                          <small>{t("settings.cache.safe")}</small>
                        </div>
                      </button>
                    </div>
                  </SettingsGroup>

                  <div className="diagnostics-footnote">
                    <Activity size={16} />
                    <span>
                      {t("settings.report.generated", {
                        time: new Date(diagnostics.generatedAt).toLocaleTimeString(
                          "en-US",
                          { hour: "2-digit", minute: "2-digit" },
                        ),
                      })}
                    </span>
                  </div>
                </>
              ) : null}
            </>
          )}

          {section === "account" && (
            <>
              <SettingsTitle
                icon={UserRound}
                title={t("settings.nav.account")}
                subtitle={t("settings.account.subtitle")}
              />
              <div className="account-panel">
                <div className="account-panel__avatar">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" />
                  ) : (
                    <UserRound size={30} />
                  )}
                  <i />
                </div>
                <div>
                  <h3>
                    {profile.kind === "microsoft"
                      ? profile.name
                      : profile.kind === 'offline'
                        ? profile.name
                        : t('profile.local')}
                  </h3>
                  <p>
                    {profile.kind === "microsoft"
                      ? t('settings.account.connected')
                      : profile.kind === 'offline'
                        ? t('auth.offline.connected')
                        : t('settings.account.local')}
                  </p>
                </div>
                <button className="button button--primary" onClick={onAccount}>
                    {profile.kind === "microsoft"
                      ? t('settings.account.manage')
                      : profile.kind === 'offline'
                        ? t('settings.account.manage')
                        : t('settings.account.connect')}
                </button>
              </div>
              <div className="security-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>{t("settings.account.password")}</strong>
<p>{t("settings.account.security")}</p>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </motion.div>
  );
}

function SystemMetric({
  icon: Icon,
  label,
  value,
  detail,
  progress,
  positive = false,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  detail: string;
  progress: number;
  positive?: boolean;
}) {
  return (
    <article className="system-metric">
      <span>
        <Icon size={17} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
        <i>
          <b
            className={positive ? "is-positive" : ""}
            style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
          />
        </i>
      </div>
    </article>
  );
}

function SettingsTitle({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Laptop;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="settings-title">
      <span>
        <Icon size={21} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-group">
      <p className="settings-group__label">{title}</p>
      <div className="settings-group__panel">{children}</div>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  hint,
}: {
  icon: typeof Cpu;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="setting-row">
      <span className="setting-row__icon">
        <Icon size={17} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {hint && <small>{hint}</small>}
      </div>
      <button
        role="switch"
        aria-label={title}
        aria-checked={checked}
        className={`toggle ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}

function PathSetting({
  icon: Icon,
  title,
  path,
  buttonLabel,
  onBrowse,
  onOpen,
}: {
  icon: typeof FolderOpen;
  title: string;
  path: string;
  buttonLabel: string;
  onBrowse: () => void;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="path-setting">
      <span className="setting-row__icon">
        <Icon size={17} />
      </span>
      <div className="path-setting__main">
        <strong>{title}</strong>
        <div className="path-setting__field">
          <code className="path-setting__path" title={path}>
            {path}
          </code>
          {onOpen && (
            <button
              type="button"
              className="path-setting__open-btn"
              onClick={onOpen}
              title={t("settings.openFolder")}
            >
              <FolderOpen size={12} />
            </button>
          )}
        </div>
      </div>
      <button className="button button--secondary button--mini" onClick={onBrowse}>
        {buttonLabel}
      </button>
    </div>
  );
}
