import { useDialogFocus } from "../hooks/useDialogFocus";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Share2,
  Link2,
  FileCode,
  Copy,
  Check,
  Loader2,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { GameInstance } from "../types";

interface ShareModpackModalProps {
  instance: GameInstance | null;
  onClose: () => void;
  onExportFile: (instance: GameInstance) => Promise<void>;
  onNotify: (tone: "success" | "warning" | "info", title: string, message: string) => void;
}

export function ShareModpackModal({
  instance,
  onClose,
  onExportFile,
  onNotify,
}: ShareModpackModalProps) {
  const { t, locale } = useI18n();
  const dialogRef = useDialogFocus(Boolean(instance), onClose);

  const isRu = locale === "ru";

  const [mode, setMode] = useState<"link" | "file">("link");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<{
    url: string;
    deepLink: string;
    id: string;
    total: number;
    recognized: number;
  } | null>(null);

  if (!instance) return null;

  async function handleGenerateLink() {
    if (!instance) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await window.onyx.state.shareSyncProfile(instance.id);
      setShareResult(result);
      onNotify(
        "success",
        isRu ? "Ссылка создана" : "Link created",
        isRu ? "Ссылка для друга готова к отправке." : "Share link is ready to send.",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      onNotify(
        "warning",
        isRu ? "Ошибка генерации ссылки" : "Failed to create link",
        msg,
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    if (!shareResult) return;
    navigator.clipboard.writeText(shareResult.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  async function handleSaveFile() {
    if (!instance) return;
    await onExportFile(instance);
    onClose();
  }

  return (
    <AnimatePresence>
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
          className="modal create-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={instance?.name}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 10 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        >
          <button
            className="modal__close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>

          <div className="modal__eyebrow">
            <Share2 size={14} />
            <span>{isRu ? "ОБЩИЙ ДОСТУП" : "SHARE MODPACK"}</span>
          </div>

          <h2>{instance.name}</h2>
          <p className="modal__subtitle">
            {isRu
              ? "Поделись сборкой с другом через веб-ссылку или файл профиля."
              : "Share your modpack with friends via web link or profile file."}
          </p>

          <div className={`instance-preview instance-preview--${instance.color || "lime"}`}>
            <div className="instance-preview__glow" />
            <span>{instance.name.trim().slice(0, 2).toUpperCase() || "NX"}</span>
            <div>
              <strong>{instance.name}</strong>
              <small>
                Minecraft {instance.version} · {instance.loader}
              </small>
            </div>
          </div>

          <div className="modal-tabs">
            <button
              type="button"
              className={`modal-tab ${mode === "link" ? "is-active" : ""}`}
              onClick={() => setMode("link")}
            >
              <Link2 size={14} />
              <span>{isRu ? "Ссылка для друга" : "Share Link"}</span>
            </button>
            <button
              type="button"
              className={`modal-tab ${mode === "file" ? "is-active" : ""}`}
              onClick={() => setMode("file")}
            >
              <FileCode size={14} />
              <span>{isRu ? "Экспорт в файл" : "Export to File"}</span>
            </button>
          </div>

          {mode === "link" && (
            <div>
              {!shareResult ? (
                <div>
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: 10,
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid var(--line)",
                      marginBottom: 16,
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        color: "var(--text-soft)",
                        fontSize: "var(--font-caption)",
                        lineHeight: 1.6,
                      }}
                    >
                      {isRu
                        ? "Сборка будет подготовлена и загружена на наш сервер. Друг сможет открыть ссылку в браузере или вставить в лаунчер и сразу скачать её в один клик."
                        : "The modpack profile will be uploaded to our server. Your friend can open the link in their browser or paste it in the launcher to download it instantly."}
                    </p>
                  </div>

                  {error && (
                    <div className="auth-error" style={{ marginBottom: 16 }}>
                      {error}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "rgba(var(--accent-rgb), 0.06)",
                      border: "1px solid rgba(var(--accent-rgb), 0.22)",
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "var(--accent)",
                        fontWeight: 700,
                        fontSize: "var(--font-caption)",
                        marginBottom: 4,
                      }}
                    >
                      <PackageCheck size={16} />
                      <span>{isRu ? "Сборка готова к отправке" : "Pack Ready to Share"}</span>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.4 }}>
                      {isRu
                        ? `Опознано ${shareResult.recognized} из ${shareResult.total} модов для автоматической загрузки.`
                        : `Recognized ${shareResult.recognized} of ${shareResult.total} mods for auto-download.`}
                    </div>
                  </div>

                  <label className="field" style={{ marginTop: 0 }}>
                    <span>{isRu ? "Ссылка для друга" : "Share Link"}</span>
                    <div className="field__control" style={{ paddingRight: 4 }}>
                      <Link2 size={16} />
                      <input
                        readOnly
                        value={shareResult.url}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                        onFocus={(e) => e.target.select()}
                      />
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={handleCopy}
                        style={{ height: 31, padding: "0 12px", fontSize: 12 }}
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copied ? (isRu ? "Скопировано" : "Copied") : (isRu ? "Копировать" : "Copy")}</span>
                      </button>
                    </div>
                  </label>

                  <p
                    style={{
                      marginTop: 10,
                      marginBottom: 0,
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    {isRu
                      ? "Друг сможет вставить ссылку в меню «+ Импорт по ссылке» или просто открыть её в веб-браузере."
                      : "Your friend can paste this link into '+ Import by Link' or open it in a web browser."}
                  </p>
                </div>
              )}
            </div>
          )}

          {mode === "file" && (
            <div>
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--line)",
                  marginBottom: 16,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    color: "var(--text-soft)",
                    fontSize: "var(--font-caption)",
                    lineHeight: 1.6,
                  }}
                >
                  {isRu
                    ? "Экспортирует конфигурацию инстанса и манифест модов в компактный файл .onyxprofile. Его можно передать другу в мессенджере или сохранить как локальный бэкап."
                    : "Exports instance configuration and mod manifest into an .onyxprofile file. You can send it directly or keep it as a lightweight backup."}
                </p>
              </div>
            </div>
          )}

          <div className="modal__footer">
            <button
              type="button"
              className="button button--ghost"
              onClick={onClose}
              disabled={generating}
            >
              {t("common.close")}
            </button>

            {mode === "link" && !shareResult && (
              <button
                type="button"
                className="button button--primary"
                disabled={generating}
                onClick={handleGenerateLink}
              >
                {generating ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>{isRu ? "Создание ссылки..." : "Creating link..."}</span>
                  </>
                ) : (
                  <>
                    <Link2 size={16} />
                    <span>{isRu ? "Сгенерировать ссылку" : "Generate Share Link"}</span>
                  </>
                )}
              </button>
            )}

            {mode === "link" && shareResult && (
              <button
                type="button"
                className="button button--secondary"
                disabled={generating}
                onClick={handleGenerateLink}
              >
                <RefreshCw size={14} className={generating ? "spin" : ""} />
                <span>{isRu ? "Обновить ссылку" : "Refresh Link"}</span>
              </button>
            )}

            {mode === "file" && (
              <button
                type="button"
                className="button button--primary"
                onClick={handleSaveFile}
              >
                <FileCode size={16} />
                <span>{isRu ? "Сохранить файл" : "Save File"}</span>
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
