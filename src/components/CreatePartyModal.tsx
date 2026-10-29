import { useDialogFocus } from "../hooks/useDialogFocus";
import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Globe,
  Network,
  Radio,
  Wifi,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Zap,
  Download,
  BookOpen,
  Users2,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { GameInstance } from "../types";

export type PartyMethod = "e4mc" | "upnp" | "playit" | "local";

export interface CreatePartyModalProps {
  open: boolean;
  instance: GameInstance;
  initialMode?: "auto" | "e4mc" | "upnp" | "playit" | "local";
  onClose: () => void;
  onConfirmCreate: (mode: PartyMethod) => Promise<void>;
  e4mcStatus: {
    installed: boolean;
    supported: boolean;
    loader: string;
    version: string;
    jarName: string | null;
  } | null;
  onInstallE4mc: () => Promise<void>;
  onConvertVanillaE4mc: () => Promise<void>;
  installingE4mc: boolean;
  convertingVanilla: boolean;
  testingUpnp: boolean;
  onTestUpnp: () => Promise<unknown>;
  upnpTestResult?: {
    success: boolean;
    isCgnat?: boolean;
    externalIp?: string;
    externalPort?: number;
    error?: string;
  } | null;
  partyCreating: boolean;
  isExistingRoom?: boolean;
}

export function CreatePartyModal({
  open,
  instance,
  initialMode = "e4mc",
  onClose,
  onConfirmCreate,
  e4mcStatus,
  onInstallE4mc,
  onConvertVanillaE4mc,
  installingE4mc,
  convertingVanilla,
  testingUpnp,
  onTestUpnp,
  upnpTestResult,
  partyCreating,
  isExistingRoom = false,
}: CreatePartyModalProps) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus(open, partyCreating ? undefined : onClose);


  const [selectedMode, setSelectedMode] = useState<PartyMethod>(() => {
    if (initialMode === "auto" || !initialMode) return "e4mc";
    return initialMode;
  });

  useEffect(() => {
    if (open) {
      if (initialMode && initialMode !== "auto") {
        setSelectedMode(initialMode);
      } else {
        setSelectedMode("e4mc");
      }
    }
  }, [open, initialMode]);

  // Handle escape key


  const isVanilla = !instance.loader || instance.loader.toLowerCase() === "vanilla";

  const handleSelect = useCallback((mode: PartyMethod) => {
    setSelectedMode(mode);
  }, []);

  const handleSubmit = useCallback(async () => {
    await onConfirmCreate(selectedMode);
  }, [onConfirmCreate, selectedMode]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="modal-backdrop" onClick={() => !partyCreating && onClose()}>
        <motion.div
          className="modal party-create-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("party.createModal.title")}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
        >
          <button
            className="modal__close"
            onClick={onClose}
            disabled={partyCreating}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>

          <div className="modal__eyebrow">
            <Users2 size={14} />
            <span>{t("party.createModal.badge")}</span>
          </div>

          <h2>{t("party.createModal.title")}</h2>
          <p className="modal__subtitle">{t("party.createModal.subtitle")}</p>

          <div className="party-create-modal__body">
            {/* Method Cards */}
            <div className="party-methods-group">
              <span className="party-methods-group__label">
                {t("party.createModal.methodLabel")}
              </span>

              {/* 1. e4mc Card */}
              <div
                className={`party-method-card ${
                  selectedMode === "e4mc" ? "is-selected" : ""
                }`}
                onClick={() => handleSelect("e4mc")}
              >
                <div className="party-method-card__header">
                  <div className="party-method-card__icon party-method-card__icon--e4mc">
                    <Globe size={18} />
                  </div>
                  <div className="party-method-card__info">
                    <div className="party-method-card__title-row">
                      <strong className="party-method-card__title">
                        {t("party.createModal.e4mc.title")}
                      </strong>
                      <span className="party-badge party-badge--recommended">
                        <Sparkles size={11} />
                        {t("party.createModal.e4mc.badge")}
                      </span>
                    </div>
                    <p className="party-method-card__desc">
                      {t("party.createModal.e4mc.desc")}
                    </p>
                  </div>
                </div>

                {selectedMode === "e4mc" && (
                  <div className="party-method-card__details">
                    <div className="party-method-card__how">
                      <ShieldCheck size={14} className="party-method-card__how-icon" />
                      <span>{t("party.createModal.e4mc.detail")}</span>
                    </div>

                    {isVanilla ? (
                      <div className="party-card-alert party-card-alert--warning">
                        <Zap size={16} className="party-card-alert__icon" />
                        <div className="party-card-alert__content">
                          <span>{t("party.createModal.e4mc.vanillaNotice")}</span>
                          <button
                            type="button"
                            className="button button--mini button--accent"
                            disabled={convertingVanilla}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onConvertVanillaE4mc();
                            }}
                          >
                            {convertingVanilla ? (
                              <Loader2 size={13} className="spin" />
                            ) : (
                              <Zap size={13} />
                            )}
                            <span>{t("party.createModal.e4mc.convertBtn")}</span>
                          </button>
                        </div>
                      </div>
                    ) : e4mcStatus?.installed ? (
                      <div className="party-card-alert party-card-alert--success">
                        <CheckCircle2 size={16} className="party-card-alert__icon" />
                        <span>{t("party.createModal.e4mc.statusReady")}</span>
                      </div>
                    ) : (
                      <div className="party-card-alert party-card-alert--action">
                        <Download size={16} className="party-card-alert__icon" />
                        <div className="party-card-alert__content">
                          <span>{t("party.createModal.e4mc.statusNotInstalled")}</span>
                          <button
                            type="button"
                            className="button button--mini button--accent"
                            disabled={installingE4mc}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onInstallE4mc();
                            }}
                          >
                            {installingE4mc ? (
                              <Loader2 size={13} className="spin" />
                            ) : (
                              <Download size={13} />
                            )}
                            <span>{t("party.createModal.e4mc.installBtn")}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 2. UPnP Card */}
              <div
                className={`party-method-card ${
                  selectedMode === "upnp" ? "is-selected" : ""
                }`}
                onClick={() => handleSelect("upnp")}
              >
                <div className="party-method-card__header">
                  <div className="party-method-card__icon party-method-card__icon--upnp">
                    <Network size={18} />
                  </div>
                  <div className="party-method-card__info">
                    <div className="party-method-card__title-row">
                      <strong className="party-method-card__title">
                        {t("party.createModal.upnp.title")}
                      </strong>
                      <span className="party-badge party-badge--upnp">
                        {t("party.createModal.upnp.badge")}
                      </span>
                    </div>
                    <p className="party-method-card__desc">
                      {t("party.createModal.upnp.desc")}
                    </p>
                  </div>
                </div>

                {selectedMode === "upnp" && (
                  <div className="party-method-card__details">
                    <div className="party-method-card__how">
                      <Network size={14} className="party-method-card__how-icon" />
                      <span>{t("party.createModal.upnp.detail")}</span>
                    </div>

                    <div className="party-upnp-test-block">
                      <button
                        type="button"
                        className="button button--mini button--secondary"
                        disabled={testingUpnp}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onTestUpnp();
                        }}
                      >
                        {testingUpnp ? (
                          <Loader2 size={13} className="spin" />
                        ) : (
                          <Network size={13} />
                        )}
                        <span>
                          {testingUpnp
                            ? t("party.createModal.upnp.testing")
                            : t("party.createModal.upnp.testBtn")}
                        </span>
                      </button>

                      {upnpTestResult && (
                        <div
                          className={`party-card-alert ${
                            upnpTestResult.success
                              ? upnpTestResult.isCgnat
                                ? "party-card-alert--warning"
                                : "party-card-alert--success"
                              : "party-card-alert--error"
                          }`}
                        >
                          {upnpTestResult.success ? (
                            upnpTestResult.isCgnat ? (
                              <AlertTriangle size={15} className="party-card-alert__icon" />
                            ) : (
                              <CheckCircle2 size={15} className="party-card-alert__icon" />
                            )
                          ) : (
                            <XCircle size={15} className="party-card-alert__icon" />
                          )}
                          <span>
                            {upnpTestResult.success
                              ? upnpTestResult.isCgnat
                                ? t("party.createModal.upnp.testedCgnat")
                                : t("party.createModal.upnp.testedSuccess", {
                                    ip: upnpTestResult.externalIp || "",
                                    port: upnpTestResult.externalPort || 25565,
                                  })
                              : t("party.createModal.upnp.testedFailed", {
                                  error: upnpTestResult.error || "no response",
                                })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Playit.gg Card */}
              <div
                className={`party-method-card ${
                  selectedMode === "playit" ? "is-selected" : ""
                }`}
                onClick={() => handleSelect("playit")}
              >
                <div className="party-method-card__header">
                  <div className="party-method-card__icon party-method-card__icon--playit">
                    <Radio size={18} />
                  </div>
                  <div className="party-method-card__info">
                    <div className="party-method-card__title-row">
                      <strong className="party-method-card__title">
                        {t("party.createModal.playit.title")}
                      </strong>
                      <span className="party-badge party-badge--playit">
                        {t("party.createModal.playit.badge")}
                      </span>
                    </div>
                    <p className="party-method-card__desc">
                      {t("party.createModal.playit.desc")}
                    </p>
                  </div>
                </div>

                {selectedMode === "playit" && (
                  <div className="party-method-card__details">
                    <div className="party-method-card__how">
                      <Radio size={14} className="party-method-card__how-icon" />
                      <span>{t("party.createModal.playit.detail")}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Local Card */}
              <div
                className={`party-method-card ${
                  selectedMode === "local" ? "is-selected" : ""
                }`}
                onClick={() => handleSelect("local")}
              >
                <div className="party-method-card__header">
                  <div className="party-method-card__icon party-method-card__icon--local">
                    <Wifi size={18} />
                  </div>
                  <div className="party-method-card__info">
                    <div className="party-method-card__title-row">
                      <strong className="party-method-card__title">
                        {t("party.createModal.local.title")}
                      </strong>
                      <span className="party-badge party-badge--local">
                        {t("party.createModal.local.badge")}
                      </span>
                    </div>
                    <p className="party-method-card__desc">
                      {t("party.createModal.local.desc")}
                    </p>
                  </div>
                </div>

                {selectedMode === "local" && (
                  <div className="party-method-card__details">
                    <div className="party-method-card__how">
                      <Wifi size={14} className="party-method-card__how-icon" />
                      <span>{t("party.createModal.local.detail")}</span>
                    </div>
                    <div className="party-card-alert party-card-alert--warning">
                      <AlertTriangle size={16} className="party-card-alert__icon" />
                      <span>{t("party.createModal.local.warning")}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step-by-step Timeline */}
            <div className="party-timeline">
              <div className="party-timeline__header">
                <BookOpen size={15} />
                <span>{t("party.createModal.timelineTitle")}</span>
              </div>
              <div className="party-timeline__steps">
                <div className="party-timeline__step">
                  <span className="party-timeline__num">1</span>
                  <div className="party-timeline__content">
                    <strong>{t("party.createModal.step1.title")}</strong>
                    <p>{t("party.createModal.step1.desc")}</p>
                  </div>
                </div>

                <div className="party-timeline__step">
                  <span className="party-timeline__num">2</span>
                  <div className="party-timeline__content">
                    <strong>{t("party.createModal.step2.title")}</strong>
                    <p>{t("party.createModal.step2.desc")}</p>
                  </div>
                </div>

                <div className="party-timeline__step">
                  <span className="party-timeline__num">3</span>
                  <div className="party-timeline__content">
                    <strong>{t("party.createModal.step3.title")}</strong>
                    <p>{t("party.createModal.step3.desc")}</p>
                  </div>
                </div>

                <div className="party-timeline__step">
                  <span className="party-timeline__num">4</span>
                  <div className="party-timeline__content">
                    <strong>{t("party.createModal.step4.title")}</strong>
                    <p>{t("party.createModal.step4.desc")}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="modal-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={onClose}
              disabled={partyCreating}
            >
              {t("party.createModal.cancel")}
            </button>
            <button
              type="button"
              className="button button--party-join"
              disabled={partyCreating || instance.status === "installing"}
              onClick={() => void handleSubmit()}
            >
              {partyCreating ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              <span>
                {partyCreating
                  ? t("party.creating")
                  : isExistingRoom
                    ? t("party.createModal.submitWithMode", {
                        mode:
                          selectedMode === "e4mc"
                            ? "e4mc"
                            : selectedMode === "upnp"
                              ? "UPnP"
                              : selectedMode === "playit"
                                ? "Playit.gg"
                                : "LAN",
                      })
                    : t("party.createModal.submitWithMode", {
                        mode:
                          selectedMode === "e4mc"
                            ? "e4mc"
                            : selectedMode === "upnp"
                              ? "UPnP"
                              : selectedMode === "playit"
                                ? "Playit.gg"
                                : "LAN",
                      })}
              </span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
