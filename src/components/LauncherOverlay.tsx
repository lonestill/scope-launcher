import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleStop,
  Copy,
  Cpu,
  Database,
  FileArchive,
  FileCode,
  Gamepad2,
  Globe,
  HardDrive,
  LoaderCircle,
  Lock,
  MemoryStick,
  Package,
  Play,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import { localizeDiagnosis } from "../diagnostics";
import { isBuiltinPureGame } from "../utils";
import type {
  CrashAutoFix,
  GameInstance,
  InstanceHealthCheck,
  InstanceHealthReport,
  LauncherProgress,
  LogDiagnosis,
} from "../types";

export interface ActiveLaunch {
  instance: GameInstance;
  mode: "installing" | "launching" | "running" | "logs" | "guard";
  progress: LauncherProgress | null;
  logs: string;
  analysis?: LogDiagnosis[];
  health?: InstanceHealthReport;
}

export function LauncherOverlay({
  launch,
  expanded,
  onExpand,
  onHide,
  onStop,
  onPlay,
  onRepair,
  onOpenSettings,
  onOpenContent,
  onDiagnosisAction,
  onCopyReport,
  onExportSupport,
  supportExportBusy,
  onApplyAutoFix,
}: {
  launch: ActiveLaunch | null;
  expanded: boolean;
  onExpand: () => void;
  onHide: () => void;
  onStop: () => void;
  onPlay: () => void;
  onRepair: () => void;
  onOpenSettings: () => void;
  onOpenContent: () => void;
  onDiagnosisAction: (diagnosis: LogDiagnosis) => void;
  onCopyReport: () => void;
  onExportSupport: () => void;
  supportExportBusy: boolean;
  onApplyAutoFix?: (fix: CrashAutoFix) => Promise<void>;
}) {
  const { t } = useI18n();
  const [autoFixBusy, setAutoFixBusy] = useState(false);
  if (!launch) return null;
  const progress =
    launch.progress?.progress ??
    (launch.mode === "running" ||
    launch.mode === "logs" ||
    launch.mode === "guard"
      ? 100
      : 2);
  const message =
    launch.mode === "running"
      ? t("launch.running")
      : launch.mode === "logs"
        ? t("launch.lastLog")
        : launch.mode === "guard"
          ? healthSummary(launch.health, t)
      : launch.progress?.message ||
        (launch.mode === "installing"
          ? t("launch.preparing")
          : t("launch.launching"));
  const diagnosis = launch.analysis?.[0]
    ? localizeDiagnosis(launch.analysis[0], t)
    : undefined;
  const healthAction = launch.health?.repairNeeded
    ? "repair"
    : launch.health?.status === "blocked"
      ? "settings"
      : "play";
  const hasContentIssue = launch.health?.checks.some(
    (check) => check.action === "content" && check.status !== "pass",
  );

  return (
    <>
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="launch-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="launch-panel"
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
            >
              <button className="modal__close" onClick={onHide}>
                <ChevronDown size={18} />
              </button>
              <div className="launch-panel__head">
                <span className={`launch-panel__icon is-${launch.instance.color}`}>
                  {launch.instance.iconUrl ? (
                    <img src={launch.instance.iconUrl} alt="" />
                  ) : (
                    launch.instance.glyph
                  )}
                </span>
                <div>
                  <p>
                    {launch.mode === "running"
                      ? t("launch.playing")
                      : launch.mode === "logs"
                        ? t("launch.diagnostics")
                        : launch.mode === "guard"
                          ? t("guard.eyebrow")
                      : t("launch.preLaunch")}
                  </p>
                  <h2>{isBuiltinPureGame(launch.instance) ? t("home.defaultName") : launch.instance.name}</h2>
                  <span>
                    Minecraft {launch.instance.version} · {launch.instance.loader}
                  </span>
                </div>
              </div>

              <div className="launch-progress-visual">
                {launch.mode === "running" ? (
                  <Gamepad2 size={34} />
                ) : launch.mode === "logs" ? (
                  <ScrollText size={34} />
                ) : launch.mode === "guard" ? (
                  launch.health?.status === "healthy" ? (
                    <ShieldCheck size={34} />
                  ) : (
                    <CircleAlert size={34} />
                  )
                ) : (
                  <LoaderCircle className="spin" size={34} />
                )}
                <strong>{message}</strong>
                {launch.mode !== "running" &&
                  launch.mode !== "logs" &&
                  launch.mode !== "guard" && (
                  <span>{progress}%</span>
                )}
              </div>

              {launch.mode !== "guard" && (
                <div className="launch-progress-track">
                  <motion.i animate={{ width: `${progress}%` }} />
                </div>
              )}

              {launch.mode === "guard" && launch.health ? (
                <div className="guard-report">
                  <div className="guard-report__head">
                    <span>
                      <ShieldCheck size={15} />
                      {t("guard.report")}
                    </span>
                    <small>{t("guard.checkedNow")}</small>
                  </div>
                  <div className="guard-checks">
                    {launch.health.checks.map((check) => (
                      <HealthCheck
                        check={check}
                        key={`${check.code}-${check.path || ""}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="launch-log-preview">
                  <div>
                    <ScrollText size={14} />
                    {t("launch.processLog")}
                  </div>
                  <pre>
                    {launch.logs.trim() || t("launch.waitingLog")}
                  </pre>
                </div>
              )}

              {diagnosis && (
                <div className="launch-diagnosis">
                  <span>
                    <TriangleAlert size={17} />
                  </span>
                  <div>
                    <strong>{diagnosis.title}</strong>
                    <p>{diagnosis.message}</p>
                    {diagnosis.suspects &&
                      diagnosis.suspects.length > 0 && (
                        <div className="diagnosis-suspects">
                          {diagnosis.suspects.slice(0, 6).map((name) => (
                            <span key={name}>{name}</span>
                          ))}
                          {diagnosis.suspects.length > 6 && (
                            <i>+{diagnosis.suspects.length - 6}</i>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              )}

              {launch.instance.lastAutoFix && (
                <div className="launch-diagnosis launch-diagnosis--autofix">
                  <span className="launch-diagnosis__icon-accent">
                    <Zap size={17} fill="currentColor" />
                  </span>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <strong>{t(launch.instance.lastAutoFix.titleKey as TranslationKey)}</strong>
                      <span className="badge badge--accent">{t("crash.autofix.badge")}</span>
                    </div>
                    <p>{t(launch.instance.lastAutoFix.descKey as TranslationKey, launch.instance.lastAutoFix.payload)}</p>
                  </div>
                </div>
              )}

              <div className="launch-panel__footer">
                {launch.mode !== "logs" && (
                  <span>
                    {launch.mode === "guard"
                      ? t("guard.footer")
                      : t("launch.background")}
                  </span>
                )}
                {(launch.mode === "running" ||
                  launch.mode === "installing" ||
                  launch.mode === "launching") && (
                  <button
                    className="button button--danger-quiet"
                    onClick={onStop}
                  >
                    <CircleStop size={15} />{" "}
                    {launch.mode === "running"
                      ? t("launch.stop")
                      : t("launch.cancel")}
                  </button>
                )}
                {launch.mode === "guard" && (
                  <div className="launch-panel__actions">
                    {hasContentIssue && (
                      <button
                        className="button button--secondary"
                        onClick={onOpenContent}
                      >
                        <Package size={15} />
                        {t("guard.openMods")}
                      </button>
                    )}
                    <button
                      className={`button ${
                        healthAction === "settings"
                          ? "button--secondary"
                          : "button--primary"
                      }`}
                      onClick={
                        healthAction === "repair"
                          ? onRepair
                          : healthAction === "settings"
                            ? onOpenSettings
                            : onPlay
                      }
                    >
                      {healthAction === "repair" ? (
                        <Wrench size={15} />
                      ) : healthAction === "settings" ? (
                        <Settings size={15} />
                      ) : (
                        <Play size={15} fill="currentColor" />
                      )}
                      {healthAction === "repair"
                        ? t("guard.repair")
                        : healthAction === "settings"
                          ? t("guard.settings")
                          : t("guard.launch")}
                    </button>
                  </div>
                )}
                {launch.mode === "logs" && (
                  <div className="launch-panel__actions">
                    <button
                      className="button button--secondary"
                      disabled={supportExportBusy}
                      onClick={onExportSupport}
                    >
                      {supportExportBusy ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <FileArchive size={15} />
                      )}
                      {t("diagnosis.exportBundle")}
                    </button>
                    <button
                      className="button button--secondary"
                      onClick={onCopyReport}
                    >
                      <Copy size={15} />
                      {t("diagnosis.copyReport")}
                    </button>
                    {launch.instance.lastAutoFix && onApplyAutoFix && (
                      <button
                        className="button button--primary button--glow"
                        disabled={autoFixBusy}
                        onClick={async () => {
                          setAutoFixBusy(true);
                          try {
                            await onApplyAutoFix(launch.instance.lastAutoFix!);
                          } finally {
                            setAutoFixBusy(false);
                          }
                        }}
                      >
                        {autoFixBusy ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Zap size={15} fill="currentColor" />
                        )}
                        {t("crash.autofix.btn")}
                      </button>
                    )}
                    {diagnosis && (
                      <button
                        className="button button--secondary"
                        onClick={() => onDiagnosisAction(diagnosis)}
                      >
                        <Wrench size={15} />
                        {diagnosisActionLabel(diagnosis.code, t)}
                      </button>
                    )}
                    <button className="button button--primary" onClick={onPlay}>
                      <RotateCcw size={15} />
                      {t("diagnosis.retry")}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!expanded && (
        <motion.button
          className="launch-mini"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={onExpand}
        >
          <span className={`launch-mini__icon is-${launch.instance.color}`}>
            {launch.mode === "running" ? (
              <Gamepad2 size={17} />
            ) : launch.mode === "logs" ? (
              <ScrollText size={17} />
            ) : launch.mode === "guard" ? (
              <ShieldCheck size={17} />
            ) : (
              <LoaderCircle className="spin" size={17} />
            )}
          </span>
          <span>
            <strong>{isBuiltinPureGame(launch.instance) ? t("home.defaultName") : launch.instance.name}</strong>
            <small>{message}</small>
          </span>
          <i>
            {launch.mode === "running"
              ? t("launch.badgePlaying")
              : launch.mode === "logs"
                ? t("launch.badgeLog")
                : launch.mode === "guard"
                  ? t("guard.badge")
                : `${progress}%`}
          </i>
          <X
            size={15}
            onClick={(event) => {
              event.stopPropagation();
              onHide();
            }}
          />
        </motion.button>
      )}
    </>
  );
}

function HealthCheck({ check }: { check: InstanceHealthCheck }) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const icon =
    check.status === "pass" ? (
      <Check size={14} />
    ) : check.status === "error" ? (
      <CircleAlert size={14} />
    ) : (
      <TriangleAlert size={14} />
    );
  const Icon =
    check.code.startsWith("java")
      ? Cpu
      : check.code.startsWith("memory")
        ? MemoryStick
        : check.code.startsWith("disk")
          ? HardDrive
          : check.code.startsWith("mods") || check.code.includes("stray")
            ? Package
            : check.code.includes("directory")
              ? Database
              : check.code.includes("session-lock")
                ? Lock
                : check.code.includes("options")
                  ? SlidersHorizontal
                  : check.code.includes("world") || check.code.includes("level-dat")
                    ? Globe
                    : check.code.includes("metadata") || check.code.includes("client-jar")
                      ? FileCode
                      : ShieldCheck;
  const label = checkLabel(check.code, t);
  let detail = t(
    check.status === "pass"
      ? "guard.check.pass"
      : check.status === "warning"
        ? "guard.check.warning"
        : "guard.check.error",
  );
  if (check.requiredMajor) {
    detail = check.actualMajor
      ? t("guard.java.version", {
          actual: check.actualMajor,
          required: check.requiredMajor,
        })
      : t("guard.java.auto", { required: check.requiredMajor });
  } else if (check.requestedGiB) {
    detail = t("guard.memory.value", {
      requested: check.requestedGiB,
      available: check.availableGiB ?? check.totalGiB ?? "—",
    });
  } else if (typeof check.freeBytes === "number") {
    detail = t("guard.disk.free", {
      free: new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
      }).format(check.freeBytes / 1024 ** 3),
    });
  } else if (check.duplicateCount) {
    detail = t("guard.mods.duplicates", {
      count: check.duplicateCount,
      ids: check.duplicateIds?.join(", ") || "—",
      files: check.duplicateFiles?.join(", ") || "—",
    });
  } else if (typeof check.modCount === "number") {
    detail = t("guard.mods.scanned", { count: check.modCount });
  } else if (check.status !== "pass") {
    if (check.autoFix?.descKey) {
      detail = t(
        check.autoFix.descKey as TranslationKey,
        check.autoFix.payload,
      );
    } else if (check.message) {
      detail = check.message;
    }
  }

  const tooltipText =
    check.message ||
    (check.autoFix?.descKey
      ? t(check.autoFix.descKey as TranslationKey, check.autoFix.payload)
      : undefined) ||
    check.duplicateFiles?.join("\n") ||
    check.path ||
    detail;

  const isInteractive =
    check.status !== "pass" || Boolean(check.path || check.duplicateFiles?.length);

  return (
    <div
      className={`guard-check guard-check--${check.status}${
        isInteractive ? " guard-check--interactive" : ""
      }`}
      onClick={() => isInteractive && setExpanded((val) => !val)}
      title={tooltipText}
    >
      <span className="guard-check__kind">
        <Icon size={15} />
      </span>
      <span>
        <strong>{label}</strong>
        <small
          style={
            expanded
              ? {
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                  lineHeight: 1.4,
                  marginTop: 3,
                }
              : undefined
          }
        >
          {detail}
        </small>
        {expanded && check.path && (
          <code
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 4,
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}
          >
            {check.path}
          </code>
        )}
      </span>
      <i>{icon}</i>
    </div>
  );
}

function checkLabel(
  code: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (code.startsWith("java")) return t("guard.check.java");
  if (code.startsWith("memory")) return t("guard.check.memory");
  if (code.startsWith("disk")) return t("guard.check.disk");
  if (code.startsWith("mods")) return t("guard.check.mods");
  if (code.includes("directory")) return t("guard.check.directory");
  if (code.includes("session-lock")) return t("guard.check.sessionLock");
  if (code.includes("options")) return t("guard.check.options");
  if (code.includes("world") || code.includes("level-dat")) return t("guard.check.worldSave");
  if (code.includes("stray")) return t("guard.check.strayJar");
  if (code.includes("fabric-api")) return t("guard.check.fabricApi");
  if (code.includes("usercache")) return t("guard.check.usercache");
  if (code.includes("server")) return t("guard.check.serverList");
  if (code.includes("optifine")) return t("guard.check.optifine");
  if (code.includes("metadata")) return t("guard.check.versionMetadata");
  if (code.includes("client-jar")) return t("guard.check.clientJar");
  if (code.includes("loader")) return t("guard.check.loader");
  if (code.includes("gc") || code.includes("wayland")) return t("guard.check.jvmArgs");
  return t("guard.check.files");
}

function healthSummary(
  health: InstanceHealthReport | undefined,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (health?.status) {
    case "healthy":
      return t("guard.summary.healthy");
    case "warning":
      return t("guard.summary.warning");
    case "repair":
      return t("guard.summary.repair");
    case "blocked":
      return t("guard.summary.blocked");
    case "setup":
      return t("guard.summary.setup");
    default:
      return t("launch.preflight");
  }
}

function diagnosisActionLabel(
  code: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (code === "missing-dependency" || code === "mixin-conflict") {
    return t("diagnosis.openContent");
  }
  if (code === "authentication") return t("diagnosis.openAccount");
  if (code === "corrupted-file") return t("diagnosis.repairFiles");
  if (code === "recent-mod-changes") {
    return t("diagnosis.disableSuspects");
  }
  return t("diagnosis.openSettings");
}
