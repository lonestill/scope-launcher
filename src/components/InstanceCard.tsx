import { motion } from "framer-motion";
import {
  Box,
  CircleAlert,
  Clock3,
  HeartPulse,
  MoreHorizontal,
  Package,
  Play,
  Server,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { GameInstance } from "../types";
import { formatPlaytime, isBuiltinPureGame } from "../utils";

interface InstanceCardProps {
  instance: GameInstance;
  compact?: boolean;
  onPlay: (
    instance: GameInstance,
    options?: { multiClient?: boolean; username?: string },
  ) => void;
  onFavorite?: (instance: GameInstance) => void;
  onMenu?: (instance: GameInstance) => void;
  onCheck?: (instance: GameInstance) => void;
  onOpen?: (instance: GameInstance) => void;
}

export function InstanceCard({
  instance,
  compact = false,
  onPlay,
  onFavorite,
  onMenu,
  onCheck,
  onOpen,
}: InstanceCardProps) {
  const { locale, t } = useI18n();
  const builtIn = instance.id === "vanilla-start";
  const health = instance.health;
  const healthStatus = health?.status ?? "unknown";
  const healthIssues =
    health?.checks.filter((check) => check.status !== "pass").length ?? 0;
  const HealthIcon =
    healthStatus === "healthy"
      ? ShieldCheck
      : healthStatus === "repair"
        ? Wrench
        : healthStatus === "blocked"
          ? CircleAlert
          : HeartPulse;
  const healthLabel = (() => {
    switch (health?.status) {
      case "healthy":
        return t("instance.health.healthy");
      case "warning":
        return t("instance.health.warning");
      case "repair":
        return t("instance.health.repair");
      case "blocked":
        return t("instance.health.blocked");
      case "setup":
        return t("instance.health.setup");
      default:
        return t("instance.health.check");
    }
  })();
  return (
    <motion.article
      layout
      data-capture-target={`instance-${instance.id}`}
      className={`instance-card instance-card--${instance.color} ${
        compact ? "instance-card--compact" : ""
      } ${onOpen ? "is-clickable" : ""}`}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.22 }}
      role={onOpen ? "link" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? t("instance.openNamed", { name: instance.name }) : undefined}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen?.(instance);
        }
      }}
      onClick={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("button")
        ) {
          return;
        }
        onOpen?.(instance);
      }}
    >
      <div className="instance-card__visual">
        <div className="instance-card__glyph">
          {instance.iconUrl ? (
            <img src={instance.iconUrl} alt="" />
          ) : (
            <span>{instance.glyph}</span>
          )}
        </div>
        <div className="instance-card__version">{instance.version}</div>
        {instance.updateAvailable && (
          <span className="instance-card__update">
            <Sparkles size={11} />
            {instance.updateAvailable.versionNumber}
          </span>
        )}
        <button
          className={`icon-button icon-button--glass ${
            instance.favorite ? "is-favorite" : ""
          }`}
          aria-label={t("instance.favorite")}
          onClick={() => onFavorite?.(instance)}
        >
          <Star
            size={15}
            fill={instance.favorite ? "currentColor" : "none"}
          />
        </button>
      </div>

      <div className="instance-card__body">
        <div className="instance-card__heading">
          <div>
            <h3>{isBuiltinPureGame(instance) ? t("home.defaultName") : instance.name}</h3>
            <p>
              {builtIn &&
              (!instance.description ||
                instance.description === "Minecraft without modifications" ||
                instance.description === "Minecraft без модификаций")
                ? t("home.defaultDescription")
                : instance.description}
            </p>
          </div>
          <button
            className="icon-button icon-button--quiet"
            aria-label={t("instance.menu")}
            onClick={() => onMenu?.(instance)}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        <div className="instance-card__meta">
          <span>
            <Box size={13} />
            {instance.loader}
          </span>
          <span>
            <Package size={13} />
            {t("instance.mods", { count: instance.modCount })}
          </span>
          {!compact && (
            <span>
              <Clock3 size={13} />
              {formatPlaytime(instance.playtimeMinutes, locale)}
            </span>
          )}
          {instance.settings?.serverAddress && (
            <span
              className="instance-card__server"
              title={instance.settings.serverAddress}
            >
              <Server size={13} />
              <em>{instance.settings.serverAddress}</em>
            </span>
          )}
        </div>

        <button
          className={`instance-health instance-health--${healthStatus}`}
          onClick={() => onCheck?.(instance)}
          title={t("instance.health.open")}
        >
          <HealthIcon size={13} />
          <span>{healthLabel}</span>
          {healthIssues > 0 && (
            <small>
              {healthIssues}
            </small>
          )}
        </button>

        {instance.status === "installing" && (
          <div className="card-install-progress">
            <i style={{ width: `${instance.installProgress || 2}%` }} />
          </div>
        )}
        <button
          className={`play-button ${
            instance.status === "running" ? "play-button--stop" : ""
          }`}
          onClick={() => onPlay(instance)}
          disabled={instance.status === "installing"}
        >
          <Play size={16} fill="currentColor" />
          {instance.status === "running"
            ? (instance.runningCount && instance.runningCount > 1
                ? `${t("home.action.stop")} (${instance.runningCount})`
                : t("home.action.stop"))
            : instance.status === "installing"
              ? `${instance.installProgress || 0}%`
              : instance.status === "error"
                ? t("instance.retryInstall")
                : instance.status === "update"
                  ? t("instance.update")
                  : instance.status === "setup"
                    ? t("home.action.install")
                    : instance.status === "pack-ready"
                      ? t("instance.install")
                      : t("home.action.play")}
        </button>
      </div>
    </motion.article>
  );
}
