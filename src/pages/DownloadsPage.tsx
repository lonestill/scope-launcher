import { motion } from "framer-motion";
import {
  Check,
  CircleAlert,
  CircleStop,
  DownloadCloud,
  FolderOpen,
  Gauge,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { DownloadTask } from "../types";
import { formatBytes, formatSpeed, formatEta } from "../utils";

interface DownloadsPageProps {
  downloads: DownloadTask[];
  onRetry: (task: DownloadTask) => void;
  onCancel: (task: DownloadTask) => void;
  onClear: () => void;
}

export function DownloadsPage({
  downloads,
  onRetry,
  onCancel,
  onClear,
}: DownloadsPageProps) {
  const { t } = useI18n();
  const active = downloads.filter(
    (task) =>
      task.status === "downloading" ||
      task.status === "installing" ||
      task.status === "queued",
  );
  const completed = downloads.filter(
    (task) =>
      task.status === "done" ||
      task.status === "error" ||
      task.status === "cancelled",
  );

  return (
    <motion.div
      className="page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("downloads.eyebrow")}</p>
          <h1>{t("downloads.title")}</h1>
          <p>
            {active.length
              ? t("downloads.activeTasks", { count: active.length })
              : t("downloads.ready")}
          </p>
        </div>
        <div className="download-speed">
          <Gauge size={16} />
          <div>
            <small>{t("downloads.background")}</small>
            <strong>
              {active.length ? t("downloads.running", { count: active.length }) : t("downloads.noneActive")}
            </strong>
          </div>
        </div>
      </div>

      {active.length > 0 && (
        <section className="download-section">
          <div className="section-heading">
            <div>
              <h2>{t("downloads.now")}</h2>
              <p>{t("downloads.nowHint")}</p>
            </div>
          </div>
          <div className="download-list">
            {active.map((task) => (
              <DownloadRow
                task={task}
                key={task.id}
                onRetry={onRetry}
                onCancel={onCancel}
              />
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="download-section">
          <div className="section-heading">
            <div>
              <h2>{t("downloads.history")}</h2>
              <p>{t("downloads.historyHint")}</p>
            </div>
            <button className="button button--mini" onClick={onClear}>
              <Trash2 size={14} /> {t("downloads.clear")}
            </button>
          </div>
          <div className="download-list">
            {completed.map((task) => (
              <DownloadRow
                task={task}
                key={task.id}
                onRetry={onRetry}
                onCancel={onCancel}
              />
            ))}
          </div>
        </section>
      )}

      {downloads.length === 0 && (
        <div className="downloads-empty">
          <div className="downloads-empty__art">
            <span />
            <i />
            <DownloadCloud size={44} />
          </div>
          <h2>{t("downloads.empty")}</h2>
          <p>{t("downloads.emptyHint")}</p>
        </div>
      )}
    </motion.div>
  );
}

function DownloadRow({
  task,
  onRetry,
  onCancel,
}: {
  task: DownloadTask;
  onRetry: (task: DownloadTask) => void;
  onCancel: (task: DownloadTask) => void;
}) {
  const { locale, t } = useI18n();
  const done = task.status === "done";
  const failed = task.status === "error";
  const cancelled = task.status === "cancelled";
  return (
    <motion.article
      layout
      className={`download-row ${failed ? "download-row--error" : ""} ${cancelled ? "download-row--cancelled" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <span className="download-row__icon">
        {task.iconUrl ? (
          <img src={task.iconUrl} alt="" />
        ) : done ? (
          <PackageCheck size={22} />
        ) : failed || cancelled ? (
          <CircleAlert size={22} />
        ) : (
          <LoaderCircle className="spin" size={22} />
        )}
      </span>
      <div className="download-row__main">
        <div className="download-row__heading">
          <div>
            <h3>{task.name}</h3>
            <p>{failed || cancelled ? task.error : task.subtitle}</p>
          </div>
          <strong>
            {done
              ? t("downloads.status.done")
              : failed
                ? t("downloads.status.error")
                : cancelled
                  ? t("downloads.status.cancelled")
                : task.status === "queued"
                  ? t("downloads.status.queued")
                  : task.status === "installing"
                    ? t("downloads.status.installing", { progress: task.progress })
                    : `${task.progress}%`}
          </strong>
        </div>
        {!done && !failed && !cancelled && (
          <>
            <div className="progress-track">
              <motion.i
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(task.progress, 2)}%` }}
                transition={{ duration: 0.8, ease: "linear" }}
              />
            </div>
            {task.speed ? (
              <div className="download-speed">
                <strong>{formatSpeed(task.speed)}</strong>
                {task.eta ? <small>~ {formatEta(task.eta)}</small> : null}
              </div>
            ) : null}
            <div className="download-row__stats">
              <span>
                {typeof task.total === "number" && task.total > 0 && typeof task.received === "number"
                  ? `${formatBytes(Math.min(task.received, task.total), locale)} / ${formatBytes(task.total, locale)}`
                  : typeof task.received === "number" && task.received > 0
                    ? formatBytes(task.received, locale)
                    : task.status === "installing"
                      ? t("downloads.status.installing", { progress: task.progress })
                      : ""}
              </span>
              <span>{t("downloads.integrity")}</span>
            </div>
          </>
        )}
      </div>
      {done ? (
        <button
          className="toolbar-icon"
          aria-label={t("downloads.openFolder")}
          onClick={() =>
            task.localPath &&
            void window.onyx.system.openPath(
              task.localPath.replace(/[\\/][^\\/]+$/, ""),
            )
          }
        >
          <FolderOpen size={17} />
        </button>
      ) : failed || cancelled ? (
        <button
          className="toolbar-icon"
          aria-label={t("downloads.retry")}
          onClick={() => onRetry(task)}
        >
          <RotateCcw size={17} />
        </button>
      ) : (
        <div className="download-row__controls">
          <span className="download-row__state">
            {task.status === "queued" ? (
              t("downloads.waiting")
            ) : (
              <>
                <Check size={12} /> TLS
              </>
            )}
          </span>
          <button
            className="toolbar-icon toolbar-icon--danger"
            aria-label={t("downloads.cancel")}
            onClick={() => onCancel(task)}
          >
            <CircleStop size={17} />
          </button>
        </div>
      )}
    </motion.article>
  );
}
