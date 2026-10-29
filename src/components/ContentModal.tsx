import { useDialogFocus } from "../hooks/useDialogFocus";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpCircle,
  CheckCircle2,
  FolderOpen,
  History,
  Image,
  LoaderCircle,
  Package,
  Power,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type {
  ContentHistoryEntry,
  GameInstance,
  InstanceContent,
} from "../types";
import { formatBytes, isBuiltinPureGame } from "../utils";

export function ContentModal({
  instance,
  onClose,
  onChanged,
  onNotify,
}: {
  instance: GameInstance | null;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (
    tone: "success" | "warning" | "info",
    title: string,
    message: string,
  ) => void;
}) {
  const { locale, t } = useI18n();
  const dialogRef = useDialogFocus(Boolean(instance), onClose);

  const [items, setItems] = useState<InstanceContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [updateError, setUpdateError] = useState("");
  const [history, setHistory] = useState<ContentHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [kind, setKind] = useState<
    "mods" | "resourcepacks" | "shaderpacks"
  >("mods");

  const loadHistory = useCallback(async () => {
    if (!instance) return;
    setHistory(await window.onyx.state.listContentHistory(instance.id));
  }, [instance]);

  const load = useCallback(async (checkUpdates = true) => {
    if (!instance) return;
    setLoading(true);
    setUpdateError("");
    try {
      const localItems = await window.onyx.state.listContent(instance.id, kind);
      setItems(localItems);
      if (
        kind === "mods" &&
        checkUpdates &&
        localItems.length &&
        !/vanilla/i.test(instance.loader)
      ) {
        setChecking(true);
        try {
          setItems(await window.onyx.state.checkContentUpdates(instance.id));
        } catch (error) {
          setUpdateError(
            error instanceof Error
              ? error.message
              : t("content.error.checkUpdates"),
          );
        } finally {
          setChecking(false);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [instance, kind, t]);

  useEffect(() => {
    setKind("mods");
    setHistoryOpen(false);
    setHistory([]);
    if (instance) void loadHistory();
  }, [instance, loadHistory]);

  useEffect(() => {
    void load();
  }, [load]);



  useEffect(() => {
    return window.onyx.onContentUpdateProgress((event) => {
      if (!instance || event.instanceId !== instance.id) return;
      setProgress((current) => ({
        ...current,
        [event.path]: event.progress,
      }));
    });
  }, [instance]);

  const updateOne = async (item: InstanceContent, quiet = false) => {
    if (!instance) return false;
    setUpdating((current) => new Set(current).add(item.path));
    setUpdateError("");
    try {
      const result = await window.onyx.state.updateContent(
        instance.id,
        item.path,
      );
      if (result.updated) await loadHistory();
      if (!quiet) {
        onNotify(
          result.updated ? "success" : "info",
          result.updated ? t("content.mod.updated") : t("content.mod.current"),
          result.updated
            ? t("content.mod.result", { name: item.name, version: result.versionNumber || t("content.latestVersion") })
            : t("content.mod.noUpdate", { name: item.name }),
        );
      }
      return result.updated;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("content.error.update");
      setUpdateError(message);
      if (!quiet) onNotify("warning", t("content.updateStopped"), message);
      return false;
    } finally {
      setUpdating((current) => {
        const next = new Set(current);
        next.delete(item.path);
        return next;
      });
      setProgress((current) => {
        const next = { ...current };
        delete next[item.path];
        return next;
      });
    }
  };

  const availableUpdates = items.filter((item) => item.update);
  const updateAll = async () => {
    let updatedCount = 0;
    for (const item of availableUpdates) {
      if (await updateOne(item, true)) updatedCount += 1;
    }
    await load();
    onChanged();
    onNotify(
      "success",
      t("content.updateComplete"),
      t("content.updateCount", { count: updatedCount }),
    );
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
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            className="modal content-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("content.title")}
          tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
          >
            <button className="modal__close" onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
            <div className="modal__eyebrow">
              <Package size={14} /> {t("content.eyebrow")}
            </div>
            <h2>{t("content.title", { name: isBuiltinPureGame(instance) ? t("home.defaultName") : instance.name })}</h2>
            <p className="modal__subtitle">{t("content.subtitle")}</p>

            <div className="content-tabs">
              {(
                [
                  ["mods", Package, t("content.mods")],
                  ["resourcepacks", Image, t("content.resources")],
                  ["shaderpacks", Sparkles, t("content.shaders")],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  className={kind === id ? "is-active" : ""}
                  key={id}
                  onClick={() => {
                    setKind(id);
                    setHistoryOpen(false);
                  }}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            <div className="content-toolbar">
              <span>
                {historyOpen
                  ? t("content.history.count", { count: history.length })
                  : t("content.files", { count: items.length })}
                {checking && (
                  <small>
                    <LoaderCircle className="spin" size={12} /> {t("content.checking")}
                  </small>
                )}
                {!checking && availableUpdates.length > 0 && (
                  <small className="has-updates">
                    {t("content.updates", { count: availableUpdates.length })}
                  </small>
                )}
              </span>
              <div>
                {kind === "mods" && (
                  <>
                    <button
                      className={`button button--mini ${
                        historyOpen ? "button--accent" : ""
                      }`}
                      disabled={updating.size > 0 || rollingBack !== null}
                      onClick={() => {
                        setHistoryOpen((value) => !value);
                        void loadHistory();
                      }}
                    >
                      <History size={14} />
                      {t("content.history")}
                      {history.length > 0 && <i>{history.length}</i>}
                    </button>
                    {!historyOpen && (
                      <button
                        className="button button--mini"
                        disabled={checking || updating.size > 0}
                        onClick={() => void load()}
                      >
                        <RefreshCw
                          className={checking ? "spin" : ""}
                          size={14}
                        />
                        {t("content.check")}
                      </button>
                    )}
                    {!historyOpen && availableUpdates.length > 1 && (
                      <button
                        className="button button--mini button--accent"
                        disabled={updating.size > 0}
                        onClick={() => void updateAll()}
                      >
                        <ArrowUpCircle size={14} /> {t("content.updateAll")}
                      </button>
                    )}
                  </>
                )}
                <button
                  className="button button--mini"
                  onClick={() =>
                    void window.onyx.state.openInstanceFolder(instance.id)
                  }
                >
                  <FolderOpen size={14} /> {t("content.folder")}
                </button>
              </div>
            </div>

            {updateError && (
              <div className="content-update-error">{updateError}</div>
            )}

            <div className="content-list">
              {historyOpen ? (
                history.length ? (
                  history.map((entry) => (
                    <div
                      className={`content-row content-history-row ${
                        entry.rolledBackAt ? "is-disabled" : ""
                      }`}
                      key={entry.id}
                    >
                      <span>
                        <History size={17} />
                      </span>
                      <div>
                        <strong>{entry.previousName}</strong>
                        <small>
                          {t("content.history.updatedTo", {
                            name: entry.currentName,
                          })}
                          {entry.versionNumber &&
                            ` · ${entry.versionNumber}`}
                          {" · "}
                          {new Date(entry.createdAt).toLocaleString(
                            "en-US",
                            {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </small>
                      </div>
                      {entry.rolledBackAt ? (
                        <span className="content-current">
                          <CheckCircle2 size={14} />
                          {t("content.history.restored")}
                        </span>
                      ) : (
                        <button
                          className="content-update-button"
                          disabled={rollingBack !== null}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                t("content.history.confirm", {
                                  name: entry.previousName,
                                }),
                              )
                            ) {
                              return;
                            }
                            setRollingBack(entry.id);
                            try {
                              await window.onyx.state.rollbackContent(
                                instance.id,
                                entry.id,
                              );
                              await Promise.all([
                                load(false),
                                loadHistory(),
                              ]);
                              onChanged();
                              onNotify(
                                "success",
                                t("content.history.done"),
                                t("content.history.doneMessage", {
                                  name: entry.previousName,
                                }),
                              );
                            } catch (error) {
                              onNotify(
                                "warning",
                                t("content.history.failed"),
                                error instanceof Error
                                  ? error.message
                                  : t("content.history.failedMessage"),
                              );
                            } finally {
                              setRollingBack(null);
                            }
                          }}
                        >
                          {rollingBack === entry.id ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                          {t("content.history.rollback")}
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="content-empty">
                    <History size={22} />
                    <strong>{t("content.history.empty")}</strong>
                    <p>{t("content.history.emptyHint")}</p>
                  </div>
                )
              ) : loading ? (
                <div className="content-empty">
                  <LoaderCircle className="spin" size={20} /> {t("content.loading")}
                </div>
              ) : items.length ? (
                items.map((item) => (
                  <div
                    className={`content-row ${item.enabled ? "" : "is-disabled"}`}
                    key={item.path}
                  >
                    <span>
                      {kind === "mods" ? (
                        <Package size={17} />
                      ) : kind === "resourcepacks" ? (
                        <Image size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {formatBytes(item.size, locale)} ·{" "}
                        {item.enabled ? t("content.enabled") : t("content.disabled")}
                        {item.projectVersion && ` · ${item.projectVersion}`}
                      </small>
                      {updating.has(item.path) && (
                        <div className="content-row__progress">
                          <i
                            style={{
                              width: `${Math.max(progress[item.path] || 4, 4)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {item.update ? (
                      <button
                        className="content-update-button"
                        disabled={updating.size > 0}
                        title={t("content.updateTo", { version: item.update.versionNumber })}
                        onClick={async () => {
                          if (await updateOne(item)) {
                            await load();
                            onChanged();
                          }
                        }}
                      >
                        {updating.has(item.path) ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <ArrowUpCircle size={14} />
                        )}
                        {item.update.versionNumber}
                      </button>
                    ) : item.projectVersion ? (
                      <span className="content-current" title={t("content.currentVersion")}>
                        <CheckCircle2 size={14} />
                      </span>
                    ) : null}
                    <button
                      className="toolbar-icon"
                      title={item.enabled ? t("content.disable") : t("content.enable")}
                      disabled={updating.size > 0}
                      onClick={async () => {
                        await window.onyx.state.toggleContent(item.path);
                        await load();
                        onChanged();
                      }}
                    >
                      <Power size={15} />
                    </button>
                    <button
                      className="toolbar-icon toolbar-icon--danger"
                      title={t("content.delete")}
                      disabled={updating.size > 0}
                      onClick={async () => {
                        await window.onyx.state.deleteContent(item.path);
                        await load();
                        onChanged();
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="content-empty">
                  <Package size={22} />
                  <strong>
                    {kind === "mods"
                      ? t("content.empty.mods")
                      : kind === "resourcepacks"
                        ? t("content.empty.resources")
                        : t("content.empty.shaders")}
                  </strong>
                  <p>
                    {kind === "mods"
                      ? t("content.empty.modsHint")
                      : t("content.empty.packHint")}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
