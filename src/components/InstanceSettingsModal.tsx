import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Check,
  Coffee,
  Gauge,
  Globe2,
  LoaderCircle,
  Monitor,
  Palette,
  Server,
  SlidersHorizontal,
  WandSparkles,
  X,
} from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import type {
  GameInstance,
  FpsRecorderStatus,
  InstanceColor,
  InstanceResourceRecommendation,
  LauncherSettings,
  MinecraftServerStatus,
} from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { isBuiltinPureGame } from "../utils";

const colors: Array<[InstanceColor, TranslationKey]> = [
  ["lime", "instanceSettings.color.lime"],
  ["cyan", "instanceSettings.color.cyan"],
  ["violet", "instanceSettings.color.violet"],
  ["amber", "instanceSettings.color.amber"],
  ["rose", "instanceSettings.color.rose"],
];

type SettingsTab = "general" | "java" | "display" | "advanced";

export function InstanceSettingsModal({
  instance,
  globalSettings,
  onClose,
  onSave,
}: {
  instance: GameInstance | null;
  globalSettings: LauncherSettings;
  onClose: () => void;
  onSave: (
    instance: GameInstance,
    patch: Pick<Partial<GameInstance>, "name" | "description" | "color"> & {
      settings: GameInstance["settings"];
    },
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<InstanceColor>("lime");
  const [memory, setMemory] = useState(6);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [fullscreen, setFullscreen] = useState(false);
  const [javaPath, setJavaPath] = useState("");
  const [jvmArguments, setJvmArguments] = useState("");
  const [recordFps, setRecordFps] = useState(false);
  const [fpsRecorderStatus, setFpsRecorderStatus] =
    useState<FpsRecorderStatus | null>(null);
  const [serverAddress, setServerAddress] = useState("");
  const [serverStatus, setServerStatus] =
    useState<MinecraftServerStatus | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);
  const [recommendation, setRecommendation] =
    useState<InstanceResourceRecommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!instance) return;
    setName(isBuiltinPureGame(instance) ? t("home.defaultName") : instance.name);
    setDescription(
      instance.id === "vanilla-start" &&
        (!instance.description ||
          instance.description === "Minecraft without modifications" ||
          instance.description === "Minecraft без модификаций")
        ? t("home.defaultDescription")
        : instance.description,
    );
    setColor(instance.color);
    setMemory(instance.settings?.memory ?? globalSettings.memory);
    setWidth(instance.settings?.windowWidth ?? globalSettings.windowWidth);
    setHeight(instance.settings?.windowHeight ?? globalSettings.windowHeight);
    setFullscreen(
      instance.settings?.fullscreen ?? globalSettings.fullscreen ?? false,
    );
    setJavaPath(instance.settings?.javaPath ?? "");
    setJvmArguments((instance.settings?.jvmArguments || []).join("\n"));
    setRecordFps(instance.settings?.recordFps ?? false);
    setFpsRecorderStatus(null);
    setServerAddress(instance.settings?.serverAddress ?? "");
    setServerStatus(null);
    setCheckingServer(false);
    setError("");
    setBusy(false);
    setRecommendation(null);
    void window.onyx.system
      .recommendInstance(instance.id)
      .then(setRecommendation)
      .catch(() => undefined);
    void window.onyx.system
      .fpsRecorderStatus()
      .then(setFpsRecorderStatus)
      .catch(() => undefined);
  }, [globalSettings, instance, t]);

  const dialogRef = useDialogFocus(Boolean(instance), busy ? undefined : onClose);

  const save = async () => {
    if (!instance || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSave(instance, {
        name: name.trim(),
        description: description.trim(),
        color,
        settings: {
          memory,
          windowWidth: width,
          windowHeight: height,
          fullscreen,
          recordFps,
          javaPath,
          serverAddress,
          jvmArguments: jvmArguments
            .split(/\r?\n/)
            .map((argument) => argument.trim())
            .filter(Boolean),
        },
      });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("instanceSettings.error.save"),
      );
    } finally {
      setBusy(false);
    }
  };

  const checkServer = async () => {
    if (!serverAddress.trim()) return;
    setCheckingServer(true);
    setServerStatus(null);
    try {
      setServerStatus(await window.onyx.system.serverStatus(serverAddress));
    } catch (reason) {
      setServerStatus({
        online: false,
        address: serverAddress.trim(),
        error:
          reason instanceof Error
            ? reason.message
            : t("instanceSettings.serverUnavailable"),
      });
    } finally {
      setCheckingServer(false);
    }
  };

  return (
    <AnimatePresence>
      {instance && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onClose();
          }}
        >
          <motion.div
            className="modal instance-settings-modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("instanceSettings.eyebrow")}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
          >
            <button className="modal__close" disabled={busy} onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
            <div className="modal__eyebrow">
              <SlidersHorizontal size={14} /> {t("instanceSettings.eyebrow")}
            </div>
            <h2>{isBuiltinPureGame(instance) ? t("home.defaultName") : instance.name}</h2>
            <p className="modal__subtitle">{t("instanceSettings.subtitle")}</p>

            <div className="modal-tabs">
              {(
                [
                  ["general", Palette, t("instanceSettings.tab.general")],
                  ["java", Coffee, t("instanceSettings.tab.java")],
                  ["display", Monitor, t("instanceSettings.tab.display")],
                  ["advanced", SlidersHorizontal, t("instanceSettings.tab.advanced")],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`modal-tab ${activeTab === id ? "is-active" : ""}`}
                  onClick={() => setActiveTab(id)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            <div className="instance-settings-scroll">
              {activeTab === "general" && (
                <>
                  <section className="instance-settings-section">
                    <div className="instance-settings-section__title">
                      <Palette size={15} />
                      <div>
                        <strong>{t("instanceSettings.appearance")}</strong>
                        <small>{t("instanceSettings.appearanceHint")}</small>
                      </div>
                    </div>
                    <label className="instance-setting-field">
                      <span>{t("instanceSettings.name")}</span>
                      <input
                        value={name}
                        maxLength={48}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label className="instance-setting-field">
                      <span>{t("instanceSettings.description")}</span>
                      <input
                        value={description}
                        maxLength={180}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </label>
                    <div className="instance-color-picker">
                      {colors.map(([id, label]) => (
                        <button
                          key={id}
                          className={`is-${id} ${color === id ? "is-active" : ""}`}
                          title={t(label)}
                          onClick={() => setColor(id)}
                        >
                          {color === id && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="instance-settings-section">
                    <div className="instance-settings-section__title">
                      <Server size={15} />
                      <div>
                        <strong>{t("instanceSettings.quickJoin")}</strong>
                        <small>{t("instanceSettings.quickJoinHint")}</small>
                      </div>
                    </div>
                    <label className="instance-setting-field">
                      <span>{t("instanceSettings.serverAddress")}</span>
                      <input
                        value={serverAddress}
                        maxLength={320}
                        spellCheck={false}
                        placeholder="play.example.org:25565"
                        onChange={(event) => {
                          setServerAddress(event.target.value);
                          setServerStatus(null);
                        }}
                      />
                      <small className="instance-setting-field__hint">
                        {serverAddress
                          ? t("instanceSettings.serverEnabled")
                          : t("instanceSettings.serverDisabled")}
                      </small>
                    </label>
                    <div className="server-status-row">
                      <button
                        className="button button--mini"
                        disabled={!serverAddress.trim() || checkingServer}
                        onClick={() => void checkServer()}
                      >
                        {checkingServer ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <Globe2 size={14} />
                        )}
                        {t("instanceSettings.serverCheck")}
                      </button>
                      {serverStatus && (
                        <div
                          className={`server-status-result ${
                            serverStatus.online ? "is-online" : "is-offline"
                          }`}
                        >
                          <i />
                          <div>
                            <strong>
                              {serverStatus.online
                                ? t("instanceSettings.serverOnline", {
                                    latency: serverStatus.latencyMs ?? 0,
                                    online: serverStatus.playersOnline ?? 0,
                                    max: serverStatus.playersMax ?? 0,
                                  })
                                : t("instanceSettings.serverOffline")}
                            </strong>
                            <small>
                              {serverStatus.online
                                ? [serverStatus.version, serverStatus.motd]
                                    .filter(Boolean)
                                    .join(" · ")
                                : serverStatus.error ||
                                  t("instanceSettings.serverUnavailable")}
                            </small>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}

              {activeTab === "java" && (
                <section
                  className="instance-settings-section"
                  data-capture-target="instance-performance-settings"
                >
                  <div className="instance-settings-section__title">
                    <Gauge size={15} />
                    <div>
                      <strong>{t("instanceSettings.performance")}</strong>
                      <small>{t("instanceSettings.performanceHint")}</small>
                    </div>
                  </div>
                  <div className="instance-memory">
                    <div>
                      <span>{t("instanceSettings.memory")}</span>
                      <strong>{memory} GB</strong>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="32"
                      value={memory}
                      onChange={(event) => setMemory(Number(event.target.value))}
                      style={
                        {
                          "--range-value": `${((memory - 2) / 30) * 100}%`,
                        } as React.CSSProperties
                      }
                    />
                    {recommendation && (
                      <div className="instance-autotune">
                        <span>
                          <WandSparkles size={15} />
                        </span>
                        <div>
                          <strong>{t("instanceSettings.autotune")}</strong>
                          <small>
                            {t("instanceSettings.autotuneHint", {
                              memory: recommendation.memoryGiB,
                              java: recommendation.javaMajor,
                              mods: recommendation.modCount,
                              total: recommendation.totalMemoryGiB,
                            })}
                          </small>
                        </div>
                        <button
                          className="button button--mini button--accent"
                          disabled={memory === recommendation.memoryGiB}
                          onClick={() =>
                            setMemory(recommendation.memoryGiB)
                          }
                        >
                          {memory === recommendation.memoryGiB
                            ? t("instanceSettings.autotuneApplied")
                            : t("instanceSettings.autotuneUse")}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="instance-java-row" style={{ marginTop: 14 }}>
                    <span>
                      <Coffee size={15} />
                    </span>
                    <div>
                      <strong>{t("instanceSettings.java")}</strong>
                      <small>{javaPath || t("instanceSettings.javaAuto")}</small>
                    </div>
                    {javaPath && (
                      <button
                        className="button button--mini"
                        onClick={() => setJavaPath("")}
                      >
                        {t("instanceSettings.reset")}
                      </button>
                    )}
                    <button
                      className="button button--mini"
                      onClick={async () => {
                        const selected = await window.onyx.system.chooseJava();
                        if (selected) setJavaPath(selected);
                      }}
                    >
                      {t("instanceSettings.choose")}
                    </button>
                  </div>
                </section>
              )}

              {activeTab === "display" && (
                <section className="instance-settings-section">
                  <div className="instance-settings-section__title">
                    <Monitor size={15} />
                    <div>
                      <strong>{t("instanceSettings.window")}</strong>
                      <small>{t("instanceSettings.windowHint")}</small>
                    </div>
                  </div>
                  <div className="resolution-fields">
                    <label className="instance-setting-field">
                      <span>{t("instanceSettings.width")}</span>
                      <input
                        type="number"
                        min={640}
                        max={7680}
                        value={width}
                        onChange={(event) => setWidth(Number(event.target.value))}
                      />
                    </label>
                    <i>×</i>
                    <label className="instance-setting-field">
                      <span>{t("instanceSettings.height")}</span>
                      <input
                        type="number"
                        min={480}
                        max={4320}
                        value={height}
                        onChange={(event) => setHeight(Number(event.target.value))}
                      />
                    </label>
                    <button
                      role="switch"
                      aria-checked={fullscreen}
                      className={`fullscreen-toggle ${fullscreen ? "is-on" : ""}`}
                      onClick={() => setFullscreen((value) => !value)}
                    >
                      <i />
                      <span>{t("instanceSettings.fullscreen")}</span>
                    </button>
                  </div>
                </section>
              )}

              {activeTab === "advanced" && (
                <section className="instance-settings-section">
                  <div className="instance-settings-section__title">
                    <SlidersHorizontal size={15} />
                    <div>
                      <strong>{t("instanceSettings.tab.advanced")}</strong>
                      <small>{t("instanceSettings.subtitle")}</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={recordFps}
                    data-capture-target="fps-recording-toggle"
                    className={`fps-recording-toggle ${
                      recordFps ? "is-on" : ""
                    }`}
                    onClick={() => setRecordFps((value) => !value)}
                  >
                    <span>
                      <Activity size={16} />
                    </span>
                    <div>
                      <strong>{t("instanceSettings.fpsRecording")}</strong>
                      <small>
                        {!fpsRecorderStatus
                          ? t("instanceSettings.fpsChecking")
                          : fpsRecorderStatus.available
                            ? t("instanceSettings.fpsReady", {
                                provider: fpsRecorderStatus.name || "FPS",
                              })
                            : t("instanceSettings.fpsUnavailable", {
                                provider:
                                  fpsRecorderStatus.platform === "linux"
                                    ? "MangoHud"
                                    : "Onyx Probe",
                              })}
                      </small>
                      {fpsRecorderStatus &&
                        !fpsRecorderStatus.available &&
                        fpsRecorderStatus.installHint && (
                          <em>{fpsRecorderStatus.installHint}</em>
                        )}
                    </div>
                    <i aria-hidden="true">
                      <b />
                    </i>
                  </button>
                  <label className="instance-setting-field" style={{ marginTop: 14 }}>
                    <span>{t("instanceSettings.jvm")}</span>
                    <textarea
                      value={jvmArguments}
                      rows={4}
                      spellCheck={false}
                      placeholder={"-XX:+UseStringDeduplication\n-Dexample=true"}
                      onChange={(event) => setJvmArguments(event.target.value)}
                    />
                  </label>
                </section>
              )}
            </div>

            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button
                className="button button--secondary"
                onClick={onClose}
                disabled={busy}
              >
                {t("instanceSettings.cancel")}
              </button>
              <button
                className="button button--primary"
                onClick={() => void save()}
                disabled={busy || !name.trim()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {t("instanceSettings.save")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
