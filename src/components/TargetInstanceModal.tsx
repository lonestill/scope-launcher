import { useDialogFocus } from "../hooks/useDialogFocus";
import { AnimatePresence, motion } from "framer-motion";
import { Box, ChevronRight, PackagePlus, X } from "lucide-react";
import { useI18n } from "../i18n";
import type { CatalogProject, GameInstance } from "../types";
import { isBuiltinPureGame } from "../utils";

export function TargetInstanceModal({
  project,
  instances,
  onClose,
  onSelect,
}: {
  project: CatalogProject | null;
  instances: GameInstance[];
  onClose: () => void;
  onSelect: (instance: GameInstance) => void;
}) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus(Boolean(project), onClose);



  const isGenericContent =
    project?.project_type === "resourcepack" ||
    project?.project_type === "shader";

  const compatible = instances.filter((instance) => {
    if (instance.status !== "ready") return false;
    if (isGenericContent) return true;
    const isVanilla = !instance.loader || instance.loader.toLowerCase() === "vanilla";
    if (project?.project_type === "mod" && isVanilla) return false;
    const versionMatch =
      !project?.versions?.length || project.versions.includes(instance.version);
    const instLoader = instance.loader.toLowerCase();
    const loaderMatch =
      project?.categories?.some((category) => {
        const cat = category.toLowerCase();
        return cat === instLoader || (instLoader === "quilt" && cat === "fabric");
      }) ?? false;
    return versionMatch && loaderMatch;
  });
  const choices =
    compatible.length > 0
      ? compatible
      : instances.filter((instance) => {
          if (instance.status !== "ready") return false;
          if (
            project?.project_type === "mod" &&
            (!instance.loader || instance.loader.toLowerCase() === "vanilla")
          ) {
            return false;
          }
          return true;
        });

  return (
    <AnimatePresence>
      {project && (
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
            className="modal target-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={project?.title}
          tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
          >
            <button className="modal__close" onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
            <div className="modal__eyebrow">
              <PackagePlus size={14} /> {t("target.eyebrow")}
            </div>
            <h2>{t("target.title", { name: project.title })}</h2>
            <p className="modal__subtitle">
              {t("target.subtitle")}
            </p>
            <div className="target-list">
              {choices.map((instance) => (
                <button key={instance.id} onClick={() => onSelect(instance)}>
                  <span className={`target-list__icon is-${instance.color}`}>
                    {instance.iconUrl ? (
                      <img src={instance.iconUrl} alt="" />
                    ) : (
                      instance.glyph
                    )}
                  </span>
                  <div>
                    <strong>{isBuiltinPureGame(instance) ? t("home.defaultName") : instance.name}</strong>
                    <small>
                      Minecraft {instance.version} · {instance.loader}
                    </small>
                  </div>
                  {compatible.some((item) => item.id === instance.id) && (
                    <i>{t("target.compatible")}</i>
                  )}
                  <ChevronRight size={16} />
                </button>
              ))}
              {!choices.length && (
                <div className="content-empty">
                  <Box size={22} />
                  <strong>{t("target.empty")}</strong>
                  <p>{t("target.emptyHint")}</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
