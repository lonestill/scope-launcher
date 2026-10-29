import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  Check,
  ChevronDown,
  Layers3,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { loaders } from "../data";
import { useI18n } from "../i18n";
import type {
  InstanceColor,
  MinecraftVersion,
  NewInstanceInput,
} from "../types";

interface CreateInstanceModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: NewInstanceInput) => Promise<void>;
  availableVersions: MinecraftVersion[];
  onRefreshVersions: () => Promise<void>;
}

export function CreateInstanceModal({
  open,
  onClose,
  onCreate,
  availableVersions,
  onRefreshVersions,
}: CreateInstanceModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.21.1");
  const [loader, setLoader] = useState("Vanilla");
  const [color, setColor] = useState<InstanceColor>("lime");
  const [creating, setCreating] = useState(false);
  const [refreshingVersions, setRefreshingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState(false);
  const initializedVersion = useRef(false);
  useEffect(() => {
    if (open && !initializedVersion.current && availableVersions.length) {
      initializedVersion.current = true;
      setVersion((availableVersions.find((item) => item.type === "release") || availableVersions[0]).id);
    }
  }, [open, availableVersions]);
  const refreshVersions = async () => {
    setRefreshingVersions(true);
    setVersionsError(false);
    try { await onRefreshVersions(); } catch { setVersionsError(true); }
    finally { setRefreshingVersions(false); }
  };

  const dialogRef = useDialogFocus(open, creating ? undefined : onClose);
  const versionIds = [...new Set([version, ...availableVersions.map((item) => item.id)])];

  const valid = useMemo(() => name.trim().length >= 2, [name]);

  const submit = async () => {
    if (!valid || creating) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        version,
        loader,
        color,
        description: t("create.description"),
      });
      setName("");
      onClose();
    } finally {
      setCreating(false);
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
            if (event.target === event.currentTarget && !creating) onClose();
          }}
        >
          <motion.div
            className="modal create-modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-instance-title"
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <button className="modal__close" disabled={creating} onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
            <div className="modal__eyebrow">
              <Sparkles size={14} /> {t("create.eyebrow")}
            </div>
            <h2 id="create-instance-title">{t("create.title")}</h2>
            <p className="modal__subtitle">
              {t("create.subtitle")}
            </p>

            <div className={`instance-preview instance-preview--${color}`}>
              <div className="instance-preview__glow" />
              <span>{name.trim().slice(0, 2).toUpperCase() || "NX"}</span>
              <div>
                <strong>{name.trim() || t("create.defaultName")}</strong>
                <small>
                  Minecraft {version} · {loader}
                </small>
              </div>
            </div>

            <label className="field">
              <span>{t("create.name")}</span>
              <div className="field__control">
                <Box size={16} />
                <input
                  aria-describedby="create-name-hint"
                  aria-invalid={name.length > 0 && !valid}
                  disabled={creating}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                  maxLength={48}
                  placeholder={t("create.namePlaceholder")}
                />
                <small>{name.length}/48</small>
              </div>
            </label>

            <p className="field-hint" id="create-name-hint">{t("create.nameHint")}</p>
            <div className="create-presets">
              <span className="create-presets__label">{t("create.quickPresets")}</span>
              <div className="create-presets__list">
                {["Vanilla", "Fabric", "NeoForge"].map((preset) => {
                  const isSelected = loader === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={creating}
                      aria-pressed={isSelected}
                      className={`create-preset-btn ${isSelected ? "is-active" : ""}`}
                      onClick={() => {
                        setLoader(preset);
                      }}
                    >
                      {preset === "Vanilla" ? t("create.modeVanilla") : preset}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="field-hint">{t("create.loaderHint")}</p>
            {(!availableVersions.length || versionsError) && (
              <div className="field-hint" role="status">
                <p>{t("create.versionsFallback")}</p>
                <button className="button button--secondary" disabled={refreshingVersions || creating} onClick={() => void refreshVersions()}>
                  {t(refreshingVersions ? "onboarding.system.checking" : "onboarding.system.retry")}
                </button>
              </div>
            )}
            <div className="field-row">
              <label className="field">
                <span>{t("create.version")}</span>
                <div className="field__control field__control--select">
                  <Layers3 size={16} />
                  <select
                    value={version}
                    disabled={creating}
                    onChange={(event) => setVersion(event.target.value)}
                  >
                    {versionIds.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
              </label>
              <label className="field">
                <span>{t("create.loader")}</span>
                <div className="field__control field__control--select">
                  <Box size={16} />
                  <select
                    value={loader}
                    disabled={creating}
                    onChange={(event) => setLoader(event.target.value)}
                  >
                    {loaders.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
              </label>
            </div>

            <div className="field">
              <span>{t("create.cover")}</span>
              <div className="color-picker">
                {(
                  [
                    ["lime", "#b8f365"],
                    ["cyan", "#58e6dd"],
                    ["violet", "#9d7bff"],
                    ["amber", "#f2b95d"],
                    ["rose", "#fb6f91"],
                  ] as Array<[InstanceColor, string]>
                ).map(([id, value]) => (
                  <button
                    key={id}
                    aria-label={t(`instanceSettings.color.${id}`)}
                    aria-pressed={color === id}
                    disabled={creating}
                    className={color === id ? "is-active" : ""}
                    style={{ "--swatch": value } as React.CSSProperties}
                    onClick={() => setColor(id)}
                  >
                    {color === id && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="modal__footer">
              <button className="button button--ghost" disabled={creating} onClick={onClose}>
                {t("create.cancel")}
              </button>
              <button
                className="button button--primary"
                onClick={() => void submit()}
                disabled={!valid || creating}
              >
                <Plus size={16} />
                {creating ? t("create.creating") : t("create.title")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
