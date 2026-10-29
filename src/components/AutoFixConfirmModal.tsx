import { useDialogFocus } from "../hooks/useDialogFocus";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Cpu,
  Download,
  FileCode,
  Files,
  FolderSync,
  HardDrive,
  Layers,
  LoaderCircle,
  MemoryStick,
  Monitor,
  MonitorOff,
  Package,
  Palette,
  RefreshCw,
  Shield,
  Split,
  Trash2,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import type { CrashAutoFix, GameInstance } from "../types";

interface AutoFixConfirmModalProps {
  instance: GameInstance | null;
  fixAction: CrashAutoFix | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (instance: GameInstance, fix: CrashAutoFix) => Promise<void>;
}

export function AutoFixConfirmModal({
  instance,
  fixAction,
  busy,
  onClose,
  onConfirm,
}: AutoFixConfirmModalProps) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus(Boolean(fixAction && instance), busy ? undefined : onClose);




  if (!fixAction || !instance) return null;

  const renderIcon = () => {
    switch (fixAction.type) {
      case "increase-memory":
        return <MemoryStick size={20} className="text-accent" />;
      case "switch-java":
      case "switch-arm64-java":
      case "force-switch-64bit-java":
        return <Cpu size={20} className="text-accent" />;
      case "install-indium":
      case "install-missing-dependency":
      case "install-openjfx":
      case "install-optifabric":
      case "install-language-adapter":
      case "install-qsl-library":
        return <Download size={20} className="text-accent" />;
      case "disable-culprit-mod":
      case "disable-environment-mismatched-mod":
        return <Package size={20} className="text-accent" />;
      case "remove-duplicate-mod":
        return <Files size={20} className="text-accent" />;
      case "resolve-mod-conflict":
      case "resolve-mixin-overwrite":
        return <Split size={20} className="text-accent" />;
      case "reset-corrupted-config":
      case "sanitize-options-txt":
        return <FileCode size={20} className="text-accent" />;
      case "clean-corrupted-file":
        return <HardDrive size={20} className="text-accent" />;
      case "disable-active-shaderpack":
        return <Layers size={20} className="text-accent" />;
      case "repair-opengl-context":
        return <Monitor size={20} className="text-accent" />;
      case "apply-wayland-fix":
        return <MonitorOff size={20} className="text-accent" />;
      case "reset-video-options":
        return <Monitor size={20} className="text-accent" />;
      case "disable-active-resourcepacks":
        return <Palette size={20} className="text-accent" />;
      case "upgrade-loader-version":
        return <RefreshCw size={20} className="text-accent" />;
      case "inject-java-module-flags":
      case "suppress-gpu-hooks":
      case "allow-security-manager-flag":
        return <Shield size={20} className="text-accent" />;
      case "enable-forge-entity-removal":
        return <Users size={20} className="text-accent" />;
      case "quarantine-playerdata":
        return <AlertTriangle size={20} className="text-accent" />;
      case "restore-world-snapshot":
      case "restore-corrupted-level-dat":
        return <FolderSync size={20} className="text-accent" />;
      case "kill-zombie-process":
        return <AlertTriangle size={20} className="text-accent" />;
      case "repair-instance-assets":
        return <HardDrive size={20} className="text-accent" />;
      case "cleanup-temp-install-files":
      case "purge-instance-logs-cache":
      case "purge-corrupted-natives":
        return <Trash2 size={20} className="text-accent" />;
      case "reconcile-modpack-manifest":
        return <FolderSync size={20} className="text-accent" />;
      case "reset-jvm-args":
      default:
        return <Wrench size={20} className="text-accent" />;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
      >
        <motion.div
          className="modal autofix-confirm-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("crash.autofix.confirm.title")}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 8 }}
          style={{ maxWidth: 480 }}
        >
          <button
            className="modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>

          <div className="modal__eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Zap size={14} fill="currentColor" /> {t("crash.autofix.badge")}
          </div>

          <h2>{t("crash.autofix.confirm.title")}</h2>
          <p className="modal__subtitle">
            {t("crash.autofix.confirm.desc")}
          </p>

          <div
            className="autofix-preview-card"
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              padding: "14px 16px",
              borderRadius: "var(--radius-md, 8px)",
              background: "var(--color-bg-subtle, rgba(255, 255, 255, 0.04))",
              border: "1px solid var(--color-border, rgba(255, 255, 255, 0.1))",
              margin: "16px 0",
            }}
          >
            <div style={{ marginTop: 2 }}>{renderIcon()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: 2 }}>
                {t("crash.autofix.confirm.actionLabel")}
              </div>
              <strong style={{ display: "block", fontSize: "1rem", marginBottom: 4 }}>
                {t(fixAction.titleKey as TranslationKey)}
              </strong>
              <div style={{ fontSize: "0.9rem", color: "var(--color-text-secondary, #a1a1aa)" }}>
                {t(fixAction.descKey as TranslationKey, fixAction.payload)}
              </div>
            </div>
          </div>

          <div className="modal__actions" style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button
              className="button button--secondary"
              onClick={onClose}
              disabled={busy}
            >
              {t("crash.autofix.confirm.cancel")}
            </button>
            <button
              className="button button--primary button--glow"
              disabled={busy}
              onClick={() => onConfirm(instance, fixAction)}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Zap size={15} fill="currentColor" />
              )}
              {t("crash.autofix.confirm.apply")}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
