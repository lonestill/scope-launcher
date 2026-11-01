import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Clipboard,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../locales";
import type { AuthLogin, Profile } from "../types";

interface AuthModalProps {
  open: boolean;
  profile: Profile;
  onClose: () => void;
  onChanged: (profile: Profile) => void;
}

export function AuthModal({
  open,
  profile,
  onClose,
  onChanged,
}: AuthModalProps) {
  const { t } = useI18n();
  const [login, setLogin] = useState<AuthLogin | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [accounts, setAccounts] = useState<Profile[]>([]);
  const [persistentStorage, setPersistentStorage] = useState(true);
  const [adding, setAdding] = useState<"microsoft" | "offline" | null>(null);
  const [offlineName, setOfflineName] = useState("");
  const [skinVariant, setSkinVariant] = useState<"classic" | "slim">("classic");
  const [skinBusy, setSkinBusy] = useState(false);

  const refreshAccounts = async () => {
    const result = await window.onyx.auth.list();
    setAccounts(result.profiles);
    setPersistentStorage(result.storage.persistent);
  };

  const formatError = (raw: unknown, fallbackKey: TranslationKey): string => {
    if (!(raw instanceof Error) && typeof raw !== "string") return t(fallbackKey);
    const message = (raw instanceof Error ? raw.message : raw)
      .replace(/^Error invoking remote method '[^']+':\s*/i, "")
      .replace(/^Error:\s*/i, "")
      .trim();

    if (!message) return t(fallbackKey);

    if (
      message.includes("No Minecraft: Java Edition license was found") ||
      message.includes("No Minecraft: Java Edition license")
    ) {
      return t("auth.error.noLicense");
    }

    if (
      message.includes("A Minecraft profile has not been created yet") ||
      message.includes("Minecraft profile was not found")
    ) {
      return t("auth.error.noProfile");
    }

    return message;
  };

  useEffect(() => {
    return window.onyx.onAuthStatus((event) => {
      if (event.sessionId !== login?.sessionId) return;
      setStatus(
        event.message === "Waiting for Microsoft confirmation…"
          ? t("auth.status.waitMicrosoft")
          : event.message === "Checking the Xbox profile…"
            ? t("auth.status.xbox")
            : event.message,
      );
    });
  }, [login?.sessionId, t]);

  useEffect(() => {
    if (!open) {
      setError("");
      setStatus("");
      setCopied(false);
      setAdding(null);
      setOfflineName("");
      return;
    }
    void refreshAccounts();
  }, [open, onClose]);

  const begin = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await window.onyx.auth.start();
      setLogin(next);
      setStatus(t("auth.status.confirm"));
      void window.onyx.auth
        .wait(next.sessionId)
        .then((nextProfile) => {
          onChanged(nextProfile);
          void refreshAccounts();
          setAdding(null);
          setStatus(t("auth.status.connected"));
          setLogin(null);
        })
        .catch((reason: unknown) => {
          setError(formatError(reason, "auth.error.finish"));
          setLogin(null);
        })
        .finally(() => setBusy(false));
    } catch (reason) {
      setBusy(false);
      setError(formatError(reason, "auth.error.start"));
    }
  };

  const close = () => {
    if (login) void window.onyx.auth.cancel(login.sessionId);
    setLogin(null);
    setBusy(false);
    onClose();
  };

  const signOut = async () => {
    setBusy(true);
    try {
      const local = await window.onyx.auth.signOut();
      onChanged(local);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async (account: Profile) => {
    if (!account.uuid || account.uuid === profile.uuid) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.onyx.auth.switch(account.uuid);
      onChanged(next);
      await refreshAccounts();
    } catch (reason) {
      setError(formatError(reason, "auth.error.switch"));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (account: Profile) => {
    if (!account.uuid) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.onyx.auth.remove(account.uuid);
      onChanged(next);
      await refreshAccounts();
    } catch (reason) {
      setError(formatError(reason, "auth.error.remove"));
    } finally {
      setBusy(false);
    }
  };

  const addOfflineAccount = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await window.onyx.auth.addOffline(offlineName);
      onChanged(next);
      await refreshAccounts();
      setAdding(null);
      setOfflineName("");
    } catch (reason) {
      setError(formatError(reason, "auth.error.start"));
    } finally {
      setBusy(false);
    }
  };

  const changeSkin = async () => {
    setSkinBusy(true);
    setError("");
    try {
      if (!profile.uuid) throw new Error('Select a saved account first');
      const next = await window.onyx.auth.chooseSkin(profile.uuid, skinVariant);
      if (!next) return;
      onChanged(next);
      await refreshAccounts();
    } catch (reason) {
      setError(formatError(reason, "auth.error.finish"));
    } finally {
      setSkinBusy(false);
    }
  };

  const activeSkin =
    profile.skins?.find((skin) => skin.state === "ACTIVE") ||
    profile.skins?.[0];

  const dialogRef = useDialogFocus(open, close);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) close();
          }}
        >
          <motion.div
            className="modal auth-modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("settings.nav.account")}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
          >
            <button className="modal__close" onClick={close} aria-label={t("common.close")}>
              <X size={18} />
            </button>

            {profile.kind !== "local" && !adding && !login ? (
              <div className="auth-connected">
                <span className="auth-connected__avatar">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" />
                  ) : (
                    <UserRound size={30} />
                  )}
                  <i>
                    <Check size={10} />
                  </i>
                </span>
                <p className="modal__eyebrow">
                  {profile.kind === "microsoft" ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <UserRound size={14} />
                  )}
                  {profile.kind === "microsoft"
                    ? t("auth.license")
                    : t("auth.offline")}
                </p>
                <h2>{profile.name}</h2>
                <p>
                  {profile.kind === "microsoft"
                    ? t("auth.connected")
                    : t("auth.offline.connected")}
                </p>
                <div className="auth-skin">
                  {activeSkin ? (
                    <img src={activeSkin.url} alt="" />
                  ) : (
                    <ImagePlus size={22} />
                  )}
                  <div>
                    <strong>{t("auth.skin")}</strong>
                    <label>
                      {t("auth.skin.variant")}
                      <select
                        value={skinVariant}
                        onChange={(event) =>
                          setSkinVariant(
                            event.target.value === "slim" ? "slim" : "classic",
                          )
                        }
                        disabled={busy || skinBusy}
                      >
                        <option value="classic">{t("auth.skin.classic")}</option>
                        <option value="slim">{t("auth.skin.slim")}</option>
                      </select>
                    </label>
                    <button
                      className="button button--secondary"
                      onClick={() => void changeSkin()}
                      disabled={busy || skinBusy}
                    >
                      {skinBusy ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}
                      {t("auth.skin.change")}
                    </button>
                  </div>
                </div>
                {profile.kind === "offline" && (
                  <small className="auth-offline-skin-hint">
                    {t("auth.skin.offlineHint")}
                  </small>
                )}
                {accounts.length > 0 && (
                  <div className="account-switcher">
                    <small>{t("auth.savedAccounts")}</small>
                    {accounts.map((account) => {
                      const active = account.uuid === profile.uuid;
                      return (
                        <div
                          className={`account-switcher__row ${active ? "is-active" : ""}`}
                          key={account.uuid}
                        >
                          <button
                            className="account-switcher__select"
                            disabled={busy || active}
                            onClick={() => void switchAccount(account)}
                          >
                            <span>
                              {account.avatarUrl ? (
                                <img src={account.avatarUrl} alt="" />
                              ) : (
                                <UserRound size={17} />
                              )}
                            </span>
                            <div>
                              <strong>{account.name}</strong>
                              <small>
                                {active ? t("auth.active") : t("auth.ready")}
                              </small>
                            </div>
                            {active && <Check size={15} />}
                          </button>
                          <button
                            className="account-switcher__remove"
                            title={t("auth.remove")}
                            disabled={busy}
                            onClick={() => void removeAccount(account)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {error && <div className="auth-error">{error}</div>}
                <div className="auth-connected__actions">
                  <button
                    className="button button--secondary"
                    onClick={() => {
                      setAdding("microsoft");
                      void begin();
                    }}
                    disabled={busy}
                  >
                    <Plus size={15} /> {t("auth.add")}
                  </button>
                  <button className="button button--secondary" onClick={onClose}>
                    {t("common.done")}
                  </button>
                  <button
                    className="button button--danger-quiet"
                    onClick={() => void signOut()}
                    disabled={busy}
                  >
                    <LogOut size={15} /> {t("auth.signOut")}
                  </button>
                  <button
                    className='button button--secondary'
                    onClick={() => {
                      setAdding('offline');
                      setError('');
                    }}
                    disabled={busy}
                  >
                    <UserPlus size={15} /> {t('auth.offline.add')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="modal__eyebrow">
                  <ShieldCheck size={14} /> {t("auth.secure")}
                </div>
                <h2>{t("auth.connect")}</h2>
                <p className="modal__subtitle">{t("auth.subtitle")}</p>

                {!login && adding === 'offline' ? (
                  <form
                    className='auth-offline-create'
                    onSubmit={(event) => {
                      event.preventDefault();
                      void addOfflineAccount();
                    }}
                  >
                    <span className='auth-offline-create__icon'>
                      <UserPlus size={25} />
                    </span>
                    <h3>{t('auth.offline.create')}</h3>
                    <p>{t('auth.offline.connected')}</p>
                    <label>
                      {t('auth.offline.name')}
                      <input
                        autoFocus
                        value={offlineName}
                        onChange={(event) => setOfflineName(event.target.value)}
                        placeholder='Player_One'
                        minLength={3}
                        maxLength={16}
                        pattern='[A-Za-z0-9_]{3,16}'
                        disabled={busy}
                        required
                      />
                      <small>{t('auth.offline.nameHint')}</small>
                    </label>
                    {error && <div className='auth-error'>{error}</div>}
                    <button
                      className='button button--primary auth-primary'
                      type='submit'
                      disabled={busy}
                    >
                      {busy ? (
                        <LoaderCircle className='spin' size={17} />
                      ) : (
                        <UserPlus size={16} />
                      )}
                      {t('auth.offline.submit')}
                    </button>
                    <button
                      className='button button--ghost auth-cancel-add'
                      type='button'
                      onClick={() => {
                        setAdding(null);
                        setError('');
                      }}
                      disabled={busy}
                    >
                      {t('auth.return')}
                    </button>
                  </form>
                ) : !login ? (
                  <div className="auth-intro">
                    <div className="auth-intro__visual">
                      <span>
                        <UserRound size={28} />
                      </span>
                      <i />
                      <span>
                        <ShieldCheck size={28} />
                      </span>
                    </div>
                    <div className="auth-benefits">
                      <span>
                        <Check size={13} /> {t("auth.benefit.license")}
                      </span>
                      <span>
                        <Check size={13} /> {t("auth.benefit.online")}
                      </span>
                      <span>
                        <Check size={13} /> {t(persistentStorage ? "auth.benefit.storage" : "auth.benefit.storageVolatile")}
                      </span>
                    </div>
                    {error && <div className="auth-error">{error}</div>}
                    <button
                      className="button button--primary auth-primary"
                      onClick={() => void begin()}
                      disabled={busy}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <ExternalLink size={16} />
                      )}
                      {t("auth.signIn")}
                    </button>
                    <button
                      className='button button--secondary auth-offline-button'
                      type='button'
                      onClick={() => {
                        setAdding('offline');
                        setError('');
                      }}
                      disabled={busy}
                    >
                      <UserPlus size={16} /> {t('auth.offline.add')}
                    </button>
                    {adding && (
                      <button
                        className="button button--ghost auth-cancel-add"
                        onClick={() => {
                          setAdding(null);
                          setError("");
                        }}
                      >
                        {t("auth.return")}
                      </button>
                    )}
                    <small className="auth-demo-note">
                      {t("auth.demo")}
                    </small>
                  </div>
                ) : (
                  <div className="device-login">
                    <div className="device-login__pulse">
                      <span />
                      <ShieldCheck size={26} />
                    </div>
                    <p>{t("auth.code")}</p>
                    <button
                      className="device-code"
                      onClick={async () => {
                        await navigator.clipboard.writeText(login.userCode);
                        setCopied(true);
                      }}
                    >
                      {login.userCode}
                      {copied ? <Check size={17} /> : <Clipboard size={17} />}
                    </button>
                    <button
                      className="button button--secondary"
                      onClick={() =>
                        window.open(
                          `${login.verificationUri}?otc=${encodeURIComponent(
                            login.userCode,
                          )}`,
                          "_blank",
                        )
                      }
                    >
                      <ExternalLink size={15} /> {t("auth.openAgain")}
                    </button>
                    <div className="device-login__status">
                      <LoaderCircle className="spin" size={14} />
                      {status}
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
