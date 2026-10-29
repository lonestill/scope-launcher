import { useDialogFocus } from "../hooks/useDialogFocus";
import { useState, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Users2,
  ArrowRight,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Box,
  ChevronDown,
  Download,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { GameInstance, PartyDiffResult, PartyRoomState } from "../types";

interface JoinPartyModalProps {
  open: boolean;
  initialCode?: string | null;
  instances: GameInstance[];
  onClose: () => void;
  onJoinSuccess: (instance: GameInstance, room: PartyRoomState) => void;
  onNotify: (tone: "success" | "warning" | "info", title: string, message: string) => void;
}

function extractRoomCode(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (trimmed.includes("/pack/") || trimmed.startsWith("pk_")) return "";

  const urlMatch =
    trimmed.match(/(?:scope|onyx):\/\/party\/([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/\/party\/([a-zA-Z0-9_-]+)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();

  const codeMatch = trimmed.match(/\b([A-Za-z0-9]{3})[- ]([A-Za-z0-9]{3})\b/);
  if (codeMatch) return `${codeMatch[1]}-${codeMatch[2]}`.toUpperCase();

  const clean = trimmed
    .replace(/^(?:код|code|party|комната)[\s:]+/i, "")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[^a-zA-Z0-9_-].*$/, "");
  if (clean.length >= 6 && clean.length <= 8 && clean !== "PACK") {
    return clean.toUpperCase();
  }
  return "";
}

export function JoinPartyModal({
  open,
  initialCode,
  instances,
  onClose,
  onJoinSuccess,
  onNotify,
}: JoinPartyModalProps) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus(open, onClose);


  const [inputVal, setInputVal] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<PartyRoomState | null>(null);
  const [diff, setDiff] = useState<PartyDiffResult | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; modName: string; percent: number } | null>(null);

  useEffect(() => {
    if (instances.length > 0 && !selectedInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedInstanceId) || null,
    [instances, selectedInstanceId]
  );

  // Keep room state updated (e.g. when guestProxyPort or peers change)
  useEffect(() => {
    const unsub = window.onyx.party.onRoomUpdate((updated) => {
      if (updated && (!room || updated.code === room.code)) {
        setRoom(updated);
      }
    });
    return unsub;
  }, [room]);

  // Synchronize servers.dat injection and recalculate diff whenever selected instance changes
  useEffect(() => {
    if (room && selectedInstanceId) {
      void window.onyx.party.setGuestInstance({ instanceId: selectedInstanceId });
      void window.onyx.party.diffManifest({ instanceId: selectedInstanceId })
        .then(setDiff)
        .catch(() => setDiff(null));
    }
  }, [room, selectedInstanceId]);

  const handleJoin = useCallback(async (targetCode?: string) => {
    const raw = typeof targetCode === "string" ? targetCode : inputVal;
    const code = extractRoomCode(raw);
    if (!code) {
      setError(t("party.joinModal.error.enterCode"));
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const roomData = await window.onyx.party.join({
        code,
        instanceId: selectedInstanceId || undefined,
      });
      setRoom(roomData);

      // Try auto-selecting matching local instance if host manifest provides version info
      let targetInstanceId = selectedInstanceId;
      if (roomData.instanceManifest) {
        const hostVer = roomData.instanceManifest.minecraftVersion;
        const hostLoader = (roomData.instanceManifest.loader || "").toLowerCase();
        const matching = instances.find(
          (i) => i.version === hostVer && i.loader.toLowerCase().includes(hostLoader)
        );
        if (matching) {
          targetInstanceId = matching.id;
          setSelectedInstanceId(matching.id);
        }
      }

      if (targetInstanceId) {
        void window.onyx.party.setGuestInstance({ instanceId: targetInstanceId });
        const diffData = await window.onyx.party.diffManifest({ instanceId: targetInstanceId }).catch(() => null);
        setDiff(diffData);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("party.joinModal.error.failed"));
      setRoom(null);
      setDiff(null);
    } finally {
      setJoining(false);
    }
  }, [inputVal, selectedInstanceId, instances, t]);

  useEffect(() => {
    if (initialCode) {
      const code = extractRoomCode(initialCode);
      setInputVal(code);
      if (code) {
        void handleJoin(code);
      }
    } else {
      setInputVal("");
      setRoom(null);
      setDiff(null);
      setError(null);
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [initialCode, open, handleJoin]);

  const handleSyncMods = useCallback(async () => {
    if (!selectedInstance || !diff) return;
    const modsToSync = [
      ...diff.missing,
      ...diff.outdated.map((o) => ({
        ...o.remote,
        outdatedFileName: o.local.fileName,
      })),
    ];
    if (modsToSync.length === 0) return;

    setSyncing(true);
    try {
      const unsub = window.onyx.party.onSyncProgress((p) => {
        setSyncProgress({
          current: p.index + 1,
          total: p.total,
          modName: p.modName,
          percent: p.percent,
        });
      });
      const res = await window.onyx.party.syncMods({
        instanceId: selectedInstance.id,
        mods: modsToSync,
      });
      unsub();

      if (res.installed.length > 0) {
        onNotify(
          "success",
          t("party.joinModal.syncSuccessTitle"),
          t("party.joinModal.syncSuccessDesc", { count: res.installed.length }),
        );
      }
      if (res.failed.length > 0) {
        onNotify(
          "warning",
          t("party.joinModal.syncPartialTitle"),
          t("party.joinModal.syncPartialDesc", { count: res.failed.length }),
        );
      }

      // Re-calculate diff
      const newDiff = await window.onyx.party.diffManifest({ instanceId: selectedInstance.id });
      setDiff(newDiff);
    } catch (err) {
      onNotify(
        "warning",
        t("party.joinModal.syncError"),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [selectedInstance, diff, onNotify, t]);

  const handleLaunch = async () => {
    if (!selectedInstance || !room) return;
    let effectiveRoom = room;
    if (!effectiveRoom.guestProxyPort) {
      const status = await window.onyx.party.status().catch(() => null);
      if (status?.guestProxyPort) {
        effectiveRoom = {
          ...effectiveRoom,
          guestProxyPort: status.guestProxyPort,
        };
      }
    }
    onJoinSuccess(selectedInstance, effectiveRoom);
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="modal-backdrop" onClick={onClose}>
        <motion.div
          className="modal modal--medium party-join-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("party.joinModal.title")}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.97, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 10 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        >
          <button className="modal__close" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>

          <div className="modal__eyebrow">
            <Users2 size={14} />
            <span>{t("party.joinModal.badge")}</span>
          </div>

          <h2>{t("party.joinModal.title")}</h2>
          <p className="modal__subtitle">
            {t("party.joinModal.subtitle")}
          </p>

          <label className="field" style={{ marginTop: 0, marginBottom: 16 }}>
            <span>{t("party.joinModal.inputLabel")}</span>
            <div className="field__control" style={{ paddingRight: 4 }}>
              <Users2 size={16} />
              <input
                autoFocus
                placeholder={t("party.joinModal.inputPlaceholder")}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !joining) void handleJoin();
                }}
                style={{ fontFamily: "var(--font-mono)", fontSize: 13, textTransform: "uppercase" }}
              />
              <button
                type="button"
                className="button button--secondary"
                disabled={joining || !inputVal.trim()}
                onClick={() => void handleJoin()}
                style={{ height: 31, padding: "0 14px", fontSize: 12 }}
              >
                {joining ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <>
                    <span>{t("party.joinModal.connect")}</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </label>

          {instances.length > 0 && (
            <label className="field" style={{ marginBottom: 16 }}>
              <span>{t("party.joinModal.instanceLabel")}</span>
              <div className="field__control field__control--select">
                <Box size={16} />
                <select
                  value={selectedInstanceId}
                  onChange={(e) => setSelectedInstanceId(e.target.value)}
                >
                  {instances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({inst.version} · {inst.loader})
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} className="field__chevron" />
              </div>
            </label>
          )}

          {error && (
            <div className="auth-error" style={{ marginBottom: 16 }}>
              <AlertCircle size={15} style={{ marginRight: 6, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {room && (
            <div className="party-join-result" style={{ marginBottom: 16 }}>
              <div className="instance-preview instance-preview--lime" style={{ marginBottom: 12 }}>
                <div className="instance-preview__glow" />
                <span>{room.code.slice(0, 3)}</span>
                <div>
                  <strong>{t("party.joinModal.roomName", { code: room.code })}</strong>
                  <small>
                    {t("party.joinModal.statusLabel")}
                    {room.status === "hosting" ? t("party.joinModal.statusHosting") : t("party.joinModal.statusWaiting")} ·{" "}
                    {t("party.joinModal.players", { count: room.peers.length })}
                  </small>
                </div>
              </div>

              {diff && (
                <div
                  className={`party-diff-box ${diff.identical ? "is-identical" : "is-mismatch"}`}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "8px",
                    border: diff.identical || diff.compatible
                      ? "1px solid rgba(163, 230, 53, 0.3)"
                      : "1px solid rgba(239, 68, 68, 0.3)",
                    background: diff.identical || diff.compatible
                      ? "rgba(163, 230, 53, 0.05)"
                      : "rgba(239, 68, 68, 0.05)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    fontSize: "12px",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {diff.identical || diff.compatible ? (
                      <CheckCircle2 size={16} color="#a3e635" style={{ flexShrink: 0 }} />
                    ) : (
                      <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0 }} />
                    )}
                    <span style={{ fontWeight: 600 }}>
                      {diff.identical
                        ? t("party.joinModal.diffIdentical")
                        : diff.compatible
                          ? t("party.joinModal.diffCompatible")
                          : diff.loaderMismatch
                            ? t("party.joinModal.diffLoaderMismatch")
                            : t("party.joinModal.diffModMismatch", {
                                count: (diff.criticalMissing || diff.missing).length,
                              })}
                    </span>
                  </div>

                  {diff.hostManifest && selectedInstance && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "8px",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        background: "rgba(0, 0, 0, 0.25)",
                        fontSize: "11px",
                      }}
                    >
                      <div>
                        <span style={{ color: "var(--text-soft)", display: "block" }}>{t("party.joinModal.hostSpecs")}</span>
                        <strong style={{ color: "#a3e635" }}>
                          {diff.hostManifest.minecraftVersion} ({diff.hostManifest.loader})
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-soft)", display: "block" }}>{t("party.joinModal.yourSpecs")}</span>
                        <strong style={{ color: diff.loaderMismatch ? "#ef4444" : "#a3e635" }}>
                          {selectedInstance.version} ({selectedInstance.loader})
                        </strong>
                      </div>
                    </div>
                  )}

                  {diff.loaderMismatch && (
                    <span style={{ color: "var(--text-soft)", fontSize: "11px", lineHeight: "1.4" }}>
                      {t("party.joinModal.loaderMismatchHint")}
                    </span>
                  )}

                  {!diff.loaderMismatch && (diff.missing.length > 0 || diff.outdated.length > 0) && (
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => void handleSyncMods()}
                        disabled={syncing}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 8,
                          width: "100%",
                          padding: "8px 14px",
                          background: "rgba(163, 230, 53, 0.15)",
                          borderColor: "rgba(163, 230, 53, 0.4)",
                          color: "#a3e635",
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        {syncing ? (
                          <>
                            <Loader2 size={14} className="spin" />
                            <span>
                              {t("party.joinModal.syncing")}{" "}
                              {syncProgress
                                ? `${syncProgress.percent}% (${syncProgress.current}/${syncProgress.total} · ${syncProgress.modName})`
                                : ""}
                            </span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>
                              {t("party.joinModal.syncButton", {
                                count: diff.missing.length + diff.outdated.length,
                              })}
                            </span>
                          </>
                        )}
                      </button>
                      {syncProgress && (
                        <div
                          style={{
                            width: "100%",
                            height: 4,
                            background: "rgba(255, 255, 255, 0.1)",
                            borderRadius: 2,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${syncProgress.percent}%`,
                              height: "100%",
                              background: "#a3e635",
                              transition: "width 0.2s",
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {room.guestProxyPort ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: "var(--text-soft)",
                        fontSize: "11px",
                        marginTop: 2,
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <CheckCircle2 size={13} color="#a3e635" />
                        <span>
                          {t("party.joinModal.directConnect", { port: room.guestProxyPort })}
                        </span>
                      </div>
                      {room.tunnelHost && (
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: "rgba(255, 255, 255, 0.06)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            color: "#d4d4d8",
                            fontFamily: "var(--font-mono, monospace)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {room.tunnelHost.includes("e4mc.link")
                            ? "e4mc"
                            : room.tunnelHost.includes("ply.gg")
                              ? "Playit.gg"
                              : "UPnP / LAN"}
                        </span>
                      )}
                    </div>
                  ) : room.tunnelHost && room.tunnelPort ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        color: "var(--text-soft)",
                        fontSize: "11px",
                        marginTop: 2,
                      }}
                    >
                      <Loader2 size={13} className="spin" color="#a3e635" />
                      <span>
                        {t("party.joinModal.settingUpTunnel")}
                      </span>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        color: "var(--text-soft)",
                        fontSize: "11px",
                        marginTop: 2,
                      }}
                    >
                      <AlertCircle size={13} color="#eab308" />
                      <span>
                        {t("party.joinModal.waitingHostWorld")}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button type="button" className="button button--secondary" onClick={onClose}>
              {t("common.close")}
            </button>
            {room && (
              <button
                type="button"
                className="button button--primary"
                onClick={handleLaunch}
                disabled={!selectedInstance}
              >
                <Play size={15} fill="currentColor" />
                <span>{t("party.joinModal.launch")}</span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
