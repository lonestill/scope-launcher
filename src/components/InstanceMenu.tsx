import { useDialogFocus } from "../hooks/useDialogFocus";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowUpCircle,
  Copy,
  FolderOpen,
  Package,
  Play,
  Plus,
  ScrollText,
  Settings2,
  Share2,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { GameInstance } from "../types";
import { isBuiltinPureGame } from "../utils";

interface InstanceMenuProps {
  instance: GameInstance | null;
  onClose: () => void;
  onPlay: (
    instance: GameInstance,
    options?: { multiClient?: boolean; username?: string },
  ) => void;
  onDelete: (instance: GameInstance) => void;
  onDuplicate: (instance: GameInstance) => void;
  onOpenFolder: (instance: GameInstance) => void;
  onContent: (instance: GameInstance) => void;
  onLogs: (instance: GameInstance) => void;
  onRepair: (instance: GameInstance) => void;
  onBackup: (instance: GameInstance) => void;
  onShare?: (instance: GameInstance) => void;
  onSettings: (instance: GameInstance) => void;
  onUpdatePack: (instance: GameInstance) => void;
}

export function InstanceMenu({
  instance,
  onClose,
  onPlay,
  onDelete,
  onDuplicate,
  onOpenFolder,
  onContent,
  onLogs,
  onRepair,
  onBackup,
  onShare,
  onSettings,
  onUpdatePack,
}: InstanceMenuProps) {
  const { t, locale } = useI18n();
  const dialogRef = useDialogFocus(Boolean(instance), onClose);

  return (
    <AnimatePresence>
      {instance && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            className="modal instance-menu-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={instance?.name}
          tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
          >
            <button className="modal__close" onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
            <div className="instance-menu-modal__head">
              <span className={`instance-menu-modal__icon is-${instance.color}`}>
                {instance.iconUrl ? (
                  <img src={instance.iconUrl} alt="" />
                ) : (
                  instance.glyph
                )}
              </span>
              <div>
                <h2>{isBuiltinPureGame(instance) ? t("home.defaultName") : instance.name}</h2>
                <p>
                  Minecraft {instance.version} · {instance.loader}
                </p>
              </div>
            </div>
            <div className="instance-actions">
              {instance.updateAvailable && (
                <button
                  className="instance-actions__update"
                  onClick={() => onUpdatePack(instance)}
                >
                  <span>
                    <ArrowUpCircle size={17} />
                  </span>
                  <div>
<strong>{t("menu.update", { version: instance.updateAvailable.versionNumber })}</strong>
                    <small>{t("menu.updateHint")}</small>
                  </div>
                </button>
              )}
              <button onClick={() => onPlay(instance)}>
                <span>
                  <Play size={17} fill="currentColor" />
                </span>
                <div>
                  <strong>{t("menu.launch")}</strong>
                  <small>{t("menu.launchHint")}</small>
                </div>
              </button>
              {instance.status === "running" && (
                <button
                  onClick={() => {
                    onClose();
                    onPlay(instance, { multiClient: true });
                  }}
                >
                  <span>
                    <Plus size={17} />
                  </span>
                  <div>
                    <strong>{t("instancePage.actions.launchAnother")}</strong>
                    <small>
                      {locale === "ru"
                        ? `Запустить еще один процесс (${instance.runningCount || 1} сейчас)`
                        : `Run another process (${instance.runningCount || 1} active)`}
                    </small>
                  </div>
                </button>
              )}
              <button onClick={() => onLogs(instance)}>
                <span>
                  <ScrollText size={17} />
                </span>
                <div>
                  <strong>{t("menu.logs")}</strong>
                  <small>{t("menu.logsHint")}</small>
                </div>
              </button>
              <button onClick={() => onSettings(instance)}>
                <span>
                  <Settings2 size={17} />
                </span>
                <div>
                  <strong>{t("menu.settings")}</strong>
                  <small>{t("menu.settingsHint")}</small>
                </div>
              </button>
              <button onClick={() => onContent(instance)}>
                <span>
                  <Package size={17} />
                </span>
                <div>
                  <strong>{t("menu.content")}</strong>
                  <small>{t("menu.contentHint")}</small>
                </div>
              </button>
              <button onClick={() => onRepair(instance)}>
                <span>
                  <Wrench size={17} />
                </span>
                <div>
                  <strong>{t("menu.repair")}</strong>
                  <small>{t("menu.repairHint")}</small>
                </div>
              </button>
              <button onClick={() => onBackup(instance)}>
                <span>
                  <Archive size={17} />
                </span>
                <div>
                  <strong>{t("menu.backup")}</strong>
                  <small>{t("menu.backupHint")}</small>
                </div>
              </button>
              {onShare && (
                <button
                  onClick={() => {
                    onClose();
                    onShare(instance);
                  }}
                >
                  <span>
                    <Share2 size={17} />
                  </span>
                  <div>
                    <strong>{t("menu.share")}</strong>
                    <small>{t("menu.shareHint")}</small>
                  </div>
                </button>
              )}
              <button onClick={() => onOpenFolder(instance)}>
                <span>
                  <FolderOpen size={17} />
                </span>
                <div>
                  <strong>{t("menu.folder")}</strong>
                  <small>{t("menu.folderHint")}</small>
                </div>
              </button>
              <button onClick={() => onDuplicate(instance)}>
                <span>
                  <Copy size={17} />
                </span>
                <div>
                  <strong>{t("menu.duplicate")}</strong>
                  <small>{t("menu.duplicateHint")}</small>
                </div>
              </button>
              <button
                className="instance-actions__danger"
                onClick={() => onDelete(instance)}
              >
                <span>
                  <Trash2 size={17} />
                </span>
                <div>
                  <strong>{t("menu.delete")}</strong>
                  <small>{t("menu.deleteHint")}</small>
                </div>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
