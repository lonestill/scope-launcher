import { useDialogFocus } from "../hooks/useDialogFocus";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Box,
  CheckCircle2,
  CheckSquare,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Rocket,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type {
  DiscoveredInstance,
  DiscoveredLauncher,
  MigrationProgress,
  MigrationResult,
} from "../types";

interface MigrationModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type FilterTab = string;

function getInstanceKey(inst: DiscoveredInstance): string {
  return (
    inst.instancePath ||
    (inst as { sourcePath?: string }).sourcePath ||
    inst.gameDir ||
    inst.name
  );
}

function getInstanceLauncher(inst: DiscoveredInstance): string {
  return (
    inst.sourceLauncher ||
    (inst as { launcher?: string }).launcher ||
    "custom"
  );
}

export function MigrationModal({ open, onClose, onSuccess }: MigrationModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [launchers, setLaunchers] = useState<DiscoveredLauncher[]>([]);
  const [customInstances, setCustomInstances] = useState<DiscoveredInstance[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);


  const dialogRef = useDialogFocus(open, importing ? undefined : onClose);
  // Scan installed launchers when modal opens
  useEffect(() => {
    if (!open) {
      setResult(null);
      setProgress(null);
      setImporting(false);
      return;
    }

    let active = true;
    setLoading(true);
    setResult(null);

    window.onyx.migration
      .detect()
      .then((data: unknown) => {
        if (!active) return;
        const res = data as {
          launchers?: DiscoveredLauncher[];
          instances?: DiscoveredInstance[];
        } | DiscoveredInstance[];

        const defaultLaunchers: DiscoveredLauncher[] = [
          { id: "curseforge", name: "CurseForge", detected: false, path: null, instances: [] },
          { id: "prism", name: "Prism Launcher", detected: false, path: null, instances: [] },
          { id: "modrinth", name: "Modrinth App", detected: false, path: null, instances: [] },
          { id: "vanilla", name: "Vanilla / TLauncher", detected: false, path: null, instances: [] },
          { id: "multimc", name: "MultiMC / PolyMC", detected: false, path: null, instances: [] },
          { id: "atlauncher", name: "ATLauncher", detected: false, path: null, instances: [] },
          { id: "feather", name: "Feather Client", detected: false, path: null, instances: [] },
        ];

        let launcherList: DiscoveredLauncher[];
        if (res && "launchers" in res && Array.isArray(res.launchers)) {
          launcherList = res.launchers;
        } else if (Array.isArray(res)) {
          launcherList = defaultLaunchers;
          for (const item of res) {
            const lKey = getInstanceLauncher(item);
            const found = launcherList.find((l) => l.id === lKey);
            if (found) {
              found.detected = true;
              found.instances.push(item);
            }
          }
        } else {
          launcherList = defaultLaunchers;
        }

        setLaunchers(launcherList);

        // Select all by default
        const allKeys = new Set<string>();
        for (const launcher of launcherList) {
          if (Array.isArray(launcher.instances)) {
            for (const inst of launcher.instances) {
              allKeys.add(getInstanceKey(inst));
            }
          }
        }
        setSelectedKeys(allKeys);
      })
      .catch((err) => {
        console.error("Failed to detect launchers:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = window.onyx.onMigrationProgress((p) => {
      setProgress(p);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importing) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, importing, onClose]);

  // Combine scanned instances and any custom instances
  const allInstances = useMemo(() => {
    const list: DiscoveredInstance[] = [];
    if (Array.isArray(launchers)) {
      for (const launcher of launchers) {
        if (Array.isArray(launcher.instances)) {
          list.push(...launcher.instances);
        }
      }
    }
    if (Array.isArray(customInstances)) {
      list.push(...customInstances);
    }
    return list;
  }, [launchers, customInstances]);

  // Filter instances based on selected tab
  const filteredInstances = useMemo(() => {
    if (activeTab === "all") return allInstances;
    return allInstances.filter((inst) => getInstanceLauncher(inst) === activeTab);
  }, [allInstances, activeTab]);

  const toggleSelect = (key: string) => {
    if (importing) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (importing) return;
    const next = new Set(selectedKeys);
    for (const inst of filteredInstances) {
      next.add(getInstanceKey(inst));
    }
    setSelectedKeys(next);
  };

  const deselectAll = () => {
    if (importing) return;
    const next = new Set(selectedKeys);
    for (const inst of filteredInstances) {
      next.delete(getInstanceKey(inst));
    }
    setSelectedKeys(next);
  };

  const handleBrowseFolder = async () => {
    if (importing) return;
    const res = await window.onyx.migration.browseFolder();
    if (res?.candidate) {
      const candidate = res.candidate;
      setCustomInstances((prev) => {
        const key = getInstanceKey(candidate);
        if (prev.some((item) => getInstanceKey(item) === key)) {
          return prev;
        }
        return [candidate, ...prev];
      });
      setSelectedKeys((prev) => new Set(prev).add(getInstanceKey(candidate)));
    }
  };

  const handleImport = async () => {
    const candidatesToImport = allInstances.filter((inst) =>
      selectedKeys.has(getInstanceKey(inst)),
    );
    if (candidatesToImport.length === 0 || importing) return;

    setImporting(true);
    setProgress({
      current: 0,
      total: candidatesToImport.length,
      instanceName: candidatesToImport[0].name,
      phase: "copying",
      percent: 0,
    });

    try {
      const res = await window.onyx.migration.import(candidatesToImport);
      setResult(res);
      if (res.imported.length > 0) {
        onSuccess();
      }
    } catch (err) {
      console.error("Migration failed:", err);
      setResult({
        imported: [],
        errors: [
          {
            name: "Migration",
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      });
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = useMemo(() => {
    let count = 0;
    for (const inst of allInstances) {
      if (selectedKeys.has(getInstanceKey(inst))) count++;
    }
    return count;
  }, [allInstances, selectedKeys]);

  const getLauncherTabTitle = (id: string, fallbackName: string) => {
    switch (id) {
      case "curseforge":
        return t("migration.tab.curseforge");
      case "prism":
        return t("migration.tab.prism");
      case "modrinth":
        return t("migration.tab.modrinth");
      case "vanilla":
        return t("migration.tab.vanilla");
      case "multimc":
        return t("migration.tab.multimc");
      case "atlauncher":
        return t("migration.tab.atlauncher");
      case "feather":
        return t("migration.tab.feather");
      default:
        return fallbackName || id;
    }
  };

  const visibleTabs = useMemo(() => {
    const detectedWithInstances = launchers.filter(
      (l) => l.detected || (l.instances && l.instances.length > 0),
    );
    if (detectedWithInstances.length > 0) {
      return detectedWithInstances;
    }
    return launchers.slice(0, 4);
  }, [launchers]);

  const launcherBadge = (source: string) => {
    switch (source) {
      case "curseforge":
        return <span className="migration-badge migration-badge--curseforge">CurseForge</span>;
      case "prism":
        return <span className="migration-badge migration-badge--prism">Prism</span>;
      case "modrinth":
        return <span className="migration-badge migration-badge--modrinth">Modrinth</span>;
      case "vanilla":
        return <span className="migration-badge migration-badge--vanilla">Vanilla</span>;
      case "atlauncher":
        return <span className="migration-badge migration-badge--atlauncher">ATLauncher</span>;
      case "multimc":
        return <span className="migration-badge migration-badge--multimc">MultiMC</span>;
      case "feather":
        return <span className="migration-badge migration-badge--feather">Feather</span>;
      default:
        return <span className="migration-badge migration-badge--custom">Custom</span>;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !importing) onClose();
          }}
        >
          <motion.div
            className="modal migration-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("migration.title")}
          tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            {!importing && (
              <button
                className="modal__close"
                onClick={onClose}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            )}

            <div className="modal__eyebrow">
              <Rocket size={14} /> {t("migration.title")}
            </div>
            <h2>{t("migration.title")}</h2>
            <p className="modal__subtitle">{t("migration.subtitle")}</p>

            {/* Success state */}
            {result ? (
              <div className="migration-result">
                <div className="migration-result__header">
                  <CheckCircle2 size={40} className="migration-result__icon" />
                  <h3>{t("migration.successTitle")}</h3>
                  <p>
                    {t("migration.successText", {
                      count: result.imported.length,
                    })}
                  </p>
                </div>

                {result.errors.length > 0 && (
                  <div className="migration-result__errors">
                    <p className="migration-result__error-title">
                      <AlertCircle size={15} />
                      {t("migration.errorsTitle")}
                    </p>
                    <ul>
                      {result.errors.map((err, i) => (
                        <li key={i}>
                          <strong>{err.name}:</strong> {err.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="modal__footer">
                  <button
                    className="button button--primary"
                    onClick={onClose}
                  >
                    {t("migration.backToLibrary")}
                  </button>
                </div>
              </div>
            ) : importing ? (
              /* In-progress state */
              <div className="migration-progress-view">
                <div className="migration-progress-view__info">
                  <LoaderCircle className="spin" size={28} />
                  <div>
                    <h4>{t("migration.importing")}</h4>
                    <p>
                      {progress
                        ? t("migration.progressText", {
                            current: progress.current,
                            total: progress.total,
                            name: progress.instanceName || "...",
                          })
                        : t("migration.importing")}
                    </p>
                  </div>
                </div>
                <div className="migration-progress-bar">
                  <div
                    className="migration-progress-bar__fill"
                    style={{ width: `${progress?.percent ?? 10}%` }}
                  />
                </div>
              </div>
            ) : (
              /* Discovery and Selection State */
              <>
                {/* Launcher filter tabs */}
                <div className="migration-tabs">
                  <button
                    className={activeTab === "all" ? "is-active" : ""}
                    onClick={() => setActiveTab("all")}
                  >
                    {t("migration.tab.all")} ({allInstances.length})
                  </button>
                  {visibleTabs.map((l) => (
                    <button
                      key={l.id}
                      className={activeTab === l.id ? "is-active" : ""}
                      onClick={() => setActiveTab(l.id)}
                    >
                      {getLauncherTabTitle(l.id, l.name)} ({l.instances?.length || 0})
                    </button>
                  ))}
                </div>

                {/* Subtoolbar */}
                <div className="migration-subtoolbar">
                  <div className="migration-subtoolbar__actions">
                    <button
                      className="button button--ghost button--small"
                      onClick={selectAll}
                      disabled={filteredInstances.length === 0}
                    >
                      {t("migration.selectAll")}
                    </button>
                    <button
                      className="button button--ghost button--small"
                      onClick={deselectAll}
                      disabled={selectedCount === 0}
                    >
                      {t("migration.deselectAll")}
                    </button>
                  </div>

                  <button
                    className="button button--secondary button--small"
                    onClick={() => void handleBrowseFolder()}
                  >
                    <FolderOpen size={14} />
                    {t("migration.browseCustom")}
                  </button>
                </div>

                {/* Instance cards list */}
                <div className="migration-list">
                  {loading ? (
                    <div className="migration-loading">
                      <LoaderCircle className="spin" size={24} />
                      <span>{t("migration.detecting")}</span>
                    </div>
                  ) : filteredInstances.length === 0 ? (
                    <div className="migration-empty">
                      <p>{t("migration.notFound")}</p>
                    </div>
                  ) : (
                    filteredInstances.map((inst) => {
                      const key = getInstanceKey(inst);
                      const isSelected = selectedKeys.has(key);
                      return (
                        <div
                          key={key}
                          className={`migration-item ${
                            isSelected ? "is-selected" : ""
                          }`}
                          onClick={() => toggleSelect(key)}
                        >
                          <div className="migration-item__checkbox">
                            {isSelected ? (
                              <CheckSquare size={18} className="icon-checked" />
                            ) : (
                              <Square size={18} className="icon-unchecked" />
                            )}
                          </div>

                          <div className="migration-item__details">
                            <div className="migration-item__title-row">
                              <span className="migration-item__name">
                                {inst.name}
                              </span>
                              {launcherBadge(getInstanceLauncher(inst))}
                            </div>

                            <div className="migration-item__meta-row">
                              <span className="migration-item__meta-tag">
                                <Layers3 size={12} />
                                {inst.version}
                              </span>
                              <span className="migration-item__meta-tag">
                                <Box size={12} />
                                {inst.loader}
                              </span>
                              {inst.modCount > 0 && (
                                <span className="migration-item__meta-tag">
                                  {t("migration.badge.mods", {
                                    count: inst.modCount,
                                  })}
                                </span>
                              )}
                              {inst.worldCount > 0 && (
                                <span className="migration-item__meta-tag">
                                  {t("migration.badge.worlds", {
                                    count: inst.worldCount,
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Safety / Zero-Copy notice */}
                <div className="migration-notice">
                  <Sparkles size={14} />
                  <span>{t("migration.copyOnWriteNotice")}</span>
                </div>

                {/* Footer */}
                <div className="modal__footer">
                  <button className="button button--ghost" onClick={onClose}>
                    {t("common.close")}
                  </button>
                  <button
                    className="button button--primary"
                    onClick={() => void handleImport()}
                    disabled={selectedCount === 0 || importing}
                  >
                    <Rocket size={16} />
                    {t("migration.importButton", { count: selectedCount })}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
