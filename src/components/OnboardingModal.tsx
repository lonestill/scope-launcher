import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  Coffee,
  Cpu,
  Gamepad2,
  HardDrive,
  LoaderCircle,
  PackageOpen,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wifi,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { Profile, SystemDiagnostics } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { formatBytes } from "../utils";

export function OnboardingModal({
  open,
  profile,
  onFinish,
  onAccount,
}: {
  open: boolean;
  profile: Profile;
  onFinish: (memory: number) => Promise<void>;
  onAccount: () => void;
}) {
  const { locale, t } = useI18n();
  const [step, setStep] = useState(0);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [checkState, setCheckState] = useState<"loading" | "error" | "done">("loading");
  const checkRequest = useRef(0);
  const dialogRef = useDialogFocus(open);
  const loadDiagnostics = useCallback(async () => {
    const request = ++checkRequest.current;
    setCheckState("loading");
    setDiagnostics(null);
    try {
      const result = await window.onyx.system.diagnostics();
      if (request !== checkRequest.current) return;
      setDiagnostics(result);
      setCheckState("done");
    } catch {
      if (request === checkRequest.current) setCheckState("error");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    void loadDiagnostics();
    return () => { checkRequest.current += 1; };
  }, [open, loadDiagnostics]);

  const recommendedMemory = useMemo(() => {
    if (!diagnostics) return 2;
    const total = diagnostics.system.totalMemory;
    const gigabytes = total / 1024 ** 3;
    if (gigabytes < 8) return 3;
    if (gigabytes < 12) return 4;
    if (gigabytes < 20) return 6;
    return Math.min(12, Math.max(6, Math.floor(gigabytes / 3)));
  }, [diagnostics]);

  const finish = async () => {
    setBusy(true);
    try {
      await onFinish(recommendedMemory);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="onboarding"
          ref={dialogRef}
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={t("onboarding.dialog")}
        >
          <motion.div
            className="onboarding-card"
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
          >
            <div className="onboarding-brand">
              <span className="brand-mark">
                <i />
                <b />
              </span>
              <strong>SCOPE</strong>
              <div className="onboarding-toolbar">

                <small>{t("onboarding.firstRun")}</small>
              </div>
            </div>

            <div className="onboarding-progress">
              {[0, 1, 2].map((index) => (
                <i
                  className={index <= step ? "is-active" : ""}
                  key={index}
                />
              ))}
            </div>

            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.section
                  className="onboarding-step"
                  key="welcome"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <div className="onboarding-hero">
                    <span>
                      <Rocket size={36} />
                    </span>
                    <i />
                    <b />
                  </div>
                  <p className="eyebrow">{t("onboarding.welcome.eyebrow")}</p>
                  <h1>
                    {t("onboarding.welcome.title")}
                    <br />{t("onboarding.welcome.into")} <em>Scope</em>
                  </h1>
                  <p>{t("onboarding.welcome.description")}</p>
                  <div className="onboarding-features">
                    <span>
                      <PackageOpen size={16} /> {t("onboarding.feature.modrinth")}
                    </span>
                    <span>
                      <ShieldCheck size={16} /> {t("onboarding.feature.hashes")}
                    </span>
                    <span>
                      <Sparkles size={16} /> {t("onboarding.feature.updates")}
                    </span>
                  </div>
                </motion.section>
              )}

              {step === 1 && (
                <motion.section
                  className="onboarding-step"
                  key="system"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <p className="eyebrow">{t("onboarding.system.eyebrow")}</p>
                  <h1>{t("onboarding.system.title")}</h1>
                  <p>{t(diagnostics ? "onboarding.system.description" : "onboarding.system.pendingDescription")}</p>
                  {checkState === "error" ? (
                    <div className="onboarding-checking" role="alert">
                      <AlertTriangle size={22} />
                      <p>{t("onboarding.system.failed")}</p>
                      <button className="button button--secondary" onClick={() => void loadDiagnostics()}>{t("onboarding.system.retry")}</button>
                    </div>
                  ) : !diagnostics ? (
                    <div className="onboarding-checking">
                      <LoaderCircle className="spin" size={22} />
                      {t("onboarding.system.checking")}
                    </div>
                  ) : (
                    <div className="onboarding-system">
                      <SystemRow
                        icon={Cpu}
                        title={t("onboarding.system.memory", { memory: recommendedMemory })}
                        subtitle={t("onboarding.system.memoryDetected", { memory: formatBytes(diagnostics.system.totalMemory, locale) })}
                      />
                      <SystemRow
                        ok={Boolean(diagnostics.java)}
                        icon={Coffee}
                        title={
                          diagnostics.java
                            ? t("onboarding.system.javaFound", { major: diagnostics.java.major })
                            : t("onboarding.system.javaAuto")
                        }
                        subtitle={
                          diagnostics.java?.version ||
                          t("onboarding.system.javaDetail")
                        }
                      />
                      <SystemRow
                        ok={diagnostics.storage.disk.free >= 2 * 1024 ** 3}
                        icon={HardDrive}
                        title={t("onboarding.system.disk", { space: formatBytes(diagnostics.storage.disk.free, locale) })}
                        subtitle={t("onboarding.system.diskDetail")}
                      />
                      <SystemRow
                        ok={diagnostics.endpoints.length > 0 && diagnostics.endpoints.every((item) => item.ok)}
                        icon={Wifi}
                        title={t("onboarding.system.services", { online: diagnostics.endpoints.filter((item) => item.ok).length, total: diagnostics.endpoints.length })}
                        subtitle={t("onboarding.system.serviceNames")}
                      />
                    </div>
                  )}
                </motion.section>
              )}

              {step === 2 && (
                <motion.section
                  className="onboarding-step"
                  key="account"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <div className="onboarding-player">
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="" />
                    ) : (
                      <UserRound size={34} />
                    )}
                  </div>
                  <p className="eyebrow">{t("onboarding.account.eyebrow")}</p>
                  <h1>
                    {profile.kind === "microsoft"
                      ? t("onboarding.account.readyName", { name: profile.name })
                      : t("onboarding.account.title")}
                  </h1>
                  <p>
                    {profile.kind === "microsoft"
                      ? t("onboarding.account.connected")
                      : t("onboarding.account.optional")}
                  </p>
                  {profile.kind !== "microsoft" && (
                    <button
                      className="onboarding-account"
                      onClick={onAccount}
                    >
                      <span>
                        <UserRound size={20} />
                      </span>
                      <div>
                        <strong>{t("onboarding.account.connect")}</strong>
                        <small>{t("onboarding.account.connectHint")}</small>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  )}
                  <div className="onboarding-ready">
                    <Check size={16} /> {t("onboarding.account.ready")}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            <footer className="onboarding-footer">
              <button
                className="button button--ghost"
                disabled={step === 0 || busy}
                onClick={() => setStep((current) => current - 1)}
              >
                <ChevronLeft size={15} /> {t("common.back")}
              </button>
              <span>
                {step + 1} / 3
              </span>
              {step < 2 ? (
                <button
                  className="button button--primary"
                  onClick={() => setStep((current) => current + 1)}
                >
                  {t("common.continue")} <ArrowRight size={15} />
                </button>
              ) : (
                <button
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => void finish()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Gamepad2 size={15} />
                  )}
                  {t("onboarding.open")}
                </button>
              )}
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SystemRow({
  icon: Icon,
  title,
  subtitle,
  ok = true,
}: {
  icon: typeof Cpu;
  title: string;
  subtitle: string;
  ok?: boolean;
}) {
  return (
    <div className="onboarding-system__row">
      <span>
        <Icon size={17} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      {ok ? <Check size={15} aria-label="OK" /> : <AlertTriangle size={15} />}
    </div>
  );
}
