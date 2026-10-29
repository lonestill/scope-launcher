import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Archive,
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  Coffee,
  Cpu,
  Bug,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus,
  FileX,
  FolderOpen,
  Gauge,
  GitBranch,
  HardDrive,
  HeartPulse,
  History,
  Image,
  Layers3,
  LoaderCircle,
  MemoryStick,
  MoreHorizontal,
  Package,
  Pin,
  Play,
  Plus,
  ClipboardCopy,
  RefreshCw,
  RotateCcw,
  Search,
  Save,
  Server,
  Share2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Wifi,
  X,
  Users2,
  BookOpen,
  Network,
  Globe,
  Radio,
  Zap,
  HelpCircle,
} from "lucide-react";
import { CreatePartyModal } from "../components/CreatePartyModal";
import { useSearchFocus } from "../hooks/useSearchFocus";
import { useI18n } from "../i18n";
import type {
  ContentHistoryEntry,
  FlightPerformance,
  FpsRecorderStatus,
  GameInstance,
  InstanceContent,
  InstanceHealthStatus,
  InstanceScreenshot,
  InstanceServer,
  InstanceStorageReport,
  Locale,
  MinecraftServerStatus,
  ModBisectSession,
  ModProfile,
  PackUpdatePreview,
  PartyRoomState,
  PlaySession,
  WorldSnapshot,
} from "../types";
import { formatBytes, formatPlaytime, isBuiltinPureGame } from "../utils";
import "./InstancePage.css";

type InstanceTab =
  | "overview"
  | "content"
  | "servers"
  | "screenshots"
  | "diagnostics";
type DiagnosticSubTab =
  | "performance"
  | "bisect"
  | "storage"
  | "snapshots"
  | "activity";
type ContentKind = "mods" | "resourcepacks" | "shaderpacks";

const STORAGE_CATEGORY_LABELS = {
  worlds: "instancePage.storage.category.worlds",
  mods: "instancePage.storage.category.mods",
  resourcepacks: "instancePage.storage.category.resourcepacks",
  shaderpacks: "instancePage.storage.category.shaderpacks",
  config: "instancePage.storage.category.config",
  screenshots: "instancePage.storage.category.screenshots",
  recordings: "instancePage.storage.category.recordings",
  logs: "instancePage.storage.category.logs",
  runtime: "instancePage.storage.category.runtime",
  metadata: "instancePage.storage.category.metadata",
  other: "instancePage.storage.category.other",
} as const;

interface InstancePageProps {
  instance: GameInstance;
  sessions: PlaySession[];
  onBack: () => void;
  onPlay: (
    instance: GameInstance,
    options?: { multiClient?: boolean; username?: string; serverAddress?: string },
  ) => void;
  onCheck: (instance: GameInstance) => void;
  onSettings: (instance: GameInstance) => void;
  onLogs: (instance: GameInstance) => void;
  onOpenFolder: (instance: GameInstance) => void;
  onBackup: (instance: GameInstance) => void;
  onUpdatePack: (instance: GameInstance) => void;
  onExportSync: (instance: GameInstance) => void;
  onDiscover: (instance?: GameInstance) => void;
  onUpdate: (
    instance: GameInstance,
    patch: { settings: GameInstance["settings"] },
  ) => Promise<GameInstance>;
  onChanged: () => void;
  onNotify: (
    tone: "success" | "warning" | "info",
    title: string,
    message: string,
  ) => void;
}

function legacyServers(
  settings: GameInstance["settings"],
  fallbackName: string,
): InstanceServer[] {
  if (settings?.servers?.length) return settings.servers;
  if (!settings?.serverAddress) return [];
  return [
    {
      id: "legacy-main",
      name: fallbackName,
      address: settings.serverAddress,
    },
  ];
}

export function InstancePage({
  instance,
  sessions,
  onBack,
  onPlay,
  onCheck,
  onSettings,
  onLogs,
  onOpenFolder,
  onBackup,
  onUpdatePack,
  onExportSync,
  onDiscover,
  onUpdate,
  onChanged,
  onNotify,
}: InstancePageProps) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<InstanceTab>("overview");
  const [diagnosticTab, setDiagnosticTab] =
    useState<DiagnosticSubTab>("performance");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [servers, setServers] = useState<InstanceServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [serverName, setServerName] = useState("");
  const [serverAddress, setServerAddress] = useState("");
  const [serverBusy, setServerBusy] = useState(false);
  const [serverStatuses, setServerStatuses] = useState<
    Record<string, MinecraftServerStatus>
  >({});
  const [checkingServer, setCheckingServer] = useState<string | null>(null);
  const [contentKind, setContentKind] = useState<ContentKind>("mods");
  const [content, setContent] = useState<InstanceContent[]>([]);
  const [contentQuery, setContentQuery] = useState("");
  const [contentBusy, setContentBusy] = useState(false);
  const [contentAction, setContentAction] = useState<string | null>(null);
  const [contentHistory, setContentHistory] = useState<ContentHistoryEntry[]>(
    [],
  );
  const [bisect, setBisect] = useState<ModBisectSession | null>(null);
  const [bisectBusy, setBisectBusy] = useState(false);
  const [modProfiles, setModProfiles] = useState<ModProfile[]>([]);
  const [modProfileName, setModProfileName] = useState("");
  const [modProfileBusy, setModProfileBusy] = useState<string | null>(null);
  const [deleteModProfileId, setDeleteModProfileId] = useState<string | null>(
    null,
  );
  const [worldSnapshots, setWorldSnapshots] = useState<WorldSnapshot[]>([]);
  const [storageReport, setStorageReport] =
    useState<InstanceStorageReport | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageCleanupConfirm, setStorageCleanupConfirm] = useState(false);
  const [worldBusy, setWorldBusy] = useState(false);
  const [restoreSnapshotId, setRestoreSnapshotId] = useState<string | null>(
    null,
  );
  const [updatePreview, setUpdatePreview] =
    useState<PackUpdatePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [fpsRecorderStatus, setFpsRecorderStatus] =
    useState<FpsRecorderStatus | null>(null);
  const [fpsSettingBusy, setFpsSettingBusy] = useState(false);
  const [selectedPerformanceSessionId, setSelectedPerformanceSessionId] =
    useState<string | null>(null);
  const contentRequestRef = useRef(0);
  const contentSearchRef = useRef<HTMLInputElement>(null);
  useSearchFocus(contentSearchRef);

  const [screenshots, setScreenshots] = useState<InstanceScreenshot[]>([]);
  const [loadingScreenshots, setLoadingScreenshots] = useState(false);
  const [activeScreenshot, setActiveScreenshot] =
    useState<InstanceScreenshot | null>(null);
  const [activeScreenshotData, setActiveScreenshotData] = useState<
    string | null
  >(null);
  const [copiedScreenshot, setCopiedScreenshot] = useState(false);

  // ── Party state ──────────────────────────────────────────────────────────────
  const [partyRoom, setPartyRoom] = useState<PartyRoomState | null>(null);
  const [partyInstanceId, setPartyInstanceId] = useState<string | null>(null);
  const [partyLanInfo, setPartyLanInfo] = useState<{
    lanPort: number;
    relayPort: number;
    hostIp: string;
    isE4mc?: boolean;
    tunnelType?: "e4mc" | "upnp" | "playit" | "local";
  } | null>(null);
  const [partyCreating, setPartyCreating] = useState(false);
  const [partyCopied, setPartyCopied] = useState(false);
  const [partyGuideOpen, setPartyGuideOpen] = useState(true);
  const [isPartyHost, setIsPartyHost] = useState(false);
  const [guestProxyPort, setGuestProxyPort] = useState<number | null>(null);
  const [partyTunnelMode, setPartyTunnelMode] = useState<"auto" | "e4mc" | "upnp" | "playit" | "local">("auto");
  const [e4mcStatus, setE4mcStatus] = useState<{
    installed: boolean;
    supported: boolean;
    loader: string;
    version: string;
    jarName: string | null;
  } | null>(null);
  const [installingE4mc, setInstallingE4mc] = useState(false);
  const [convertingVanilla, setConvertingVanilla] = useState(false);
  const [testingUpnp, setTestingUpnp] = useState(false);
  const [isCreatePartyModalOpen, setIsCreatePartyModalOpen] = useState(false);
  const [upnpTestResult, setUpnpTestResult] = useState<{
    success: boolean;
    isCgnat?: boolean;
    externalIp?: string;
    externalPort?: number;
    error?: string;
  } | null>(null);

  const refreshE4mcStatus = useCallback(async () => {
    if (!instance?.id) return;
    try {
      const res = await window.onyx.party.checkE4mc({ instanceId: instance.id });
      setE4mcStatus(res);
    } catch {
      setE4mcStatus(null);
    }
  }, [instance?.id]);

  useEffect(() => {
    void refreshE4mcStatus();
  }, [refreshE4mcStatus]);

  const handleInstallE4mc = useCallback(async () => {
    if (!instance?.id) return;
    setInstallingE4mc(true);
    try {
      const res = await window.onyx.party.installE4mc({ instanceId: instance.id });
      if (res.installed) {
        onNotify("success", t("party.installSuccess"), res.jarName);
        await refreshE4mcStatus();
        onChanged();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify("warning", t("common.error"), msg);
    } finally {
      setInstallingE4mc(false);
    }
  }, [instance?.id, onNotify, t, refreshE4mcStatus, onChanged]);

  const handleConvertVanillaE4mc = useCallback(async () => {
    if (!instance?.id) return;
    setConvertingVanilla(true);
    try {
      const res = await window.onyx.party.convertVanillaE4mc({ instanceId: instance.id });
      if (res.success) {
        onNotify("success", t("party.convertSuccess"), `Fabric + ${res.jarName}`);
        await refreshE4mcStatus();
        onChanged();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify("warning", t("common.error"), msg);
    } finally {
      setConvertingVanilla(false);
    }
  }, [instance?.id, onNotify, t, refreshE4mcStatus, onChanged]);

  const handleSetTunnelMode = useCallback(async (mode: "auto" | "e4mc" | "upnp" | "playit" | "local") => {
    setPartyTunnelMode(mode);
    try {
      await window.onyx.party.setTunnelMode({ mode });
    } catch { /**/ }
  }, []);

  const handleTestUpnp = useCallback(async () => {
    setTestingUpnp(true);
    try {
      const res = await window.onyx.party.testUpnp();
      setUpnpTestResult(res);
      if (res.success) {
        if (res.isCgnat) {
          onNotify("warning", "UPnP (CGNAT)", t("party.testUpnp.cgnat"));
        } else {
          onNotify("success", "UPnP OK", t("party.testUpnp.success", { ip: res.externalIp || "", port: res.externalPort || 25565 }));
        }
      } else {
        onNotify("warning", "UPnP", t("party.testUpnp.failed", { error: res.error || "no response" }));
      }
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const fail = { success: false, error: msg };
      setUpnpTestResult(fail);
      onNotify("warning", "UPnP", msg);
      return fail;
    } finally {
      setTestingUpnp(false);
    }
  }, [onNotify, t]);

  // Subscribe to room updates once on mount
  useEffect(() => {
    const unsubUpdate = window.onyx.party.onRoomUpdate((state) => {
      setPartyRoom(state);
      if (state && typeof state.guestProxyPort === "number") {
        setGuestProxyPort(state.guestProxyPort);
      }
    });
    const unsubLan = window.onyx.party.onLanDetected?.((info) => {
      setPartyLanInfo(info);
    });
    // Restore state if already in a room (persisted across restarts or navigation)
    void window.onyx.party.status().then((s) => {
      if (s.tunnelMode) setPartyTunnelMode(s.tunnelMode);
      if (s.inRoom && s.room) {
        setPartyRoom(s.room);
        if (s.instanceId) setPartyInstanceId(s.instanceId);
        setIsPartyHost(Boolean(s.isHost));
        if (s.guestProxyPort) setGuestProxyPort(s.guestProxyPort);
      }
    }).catch(() => undefined);
    return () => {
      unsubUpdate();
      unsubLan?.();
    };
  }, []);

  const handleConfirmPartyCreate = useCallback(async (mode: "auto" | "e4mc" | "upnp" | "playit" | "local") => {
    setPartyCreating(true);
    try {
      await handleSetTunnelMode(mode);
      await window.onyx.party.create({ instanceId: instance.id, tunnelMode: mode });
      setPartyInstanceId(instance.id);
      setIsCreatePartyModalOpen(false);
    } catch {
      onNotify("warning", t("party.error.create"), "");
    } finally {
      setPartyCreating(false);
    }
  }, [instance.id, handleSetTunnelMode, onNotify, t]);

  const handlePartyCreate = useCallback(async () => {
    setIsCreatePartyModalOpen(true);
  }, []);

  const handlePartyClose = useCallback(async () => {
    await window.onyx.party.close().catch(() => undefined);
    setPartyRoom(null);
    setPartyInstanceId(null);
    setPartyLanInfo(null);
  }, []);

  const handlePartyCopyCode = useCallback(() => {
    if (!partyRoom) return;
    const text = partyRoom.code;
    void navigator.clipboard.writeText(text).then(() => {
      setPartyCopied(true);
      onNotify("success", t("party.copiedCode", { code: partyRoom.code }), "");
      setTimeout(() => setPartyCopied(false), 2000);
    });
  }, [partyRoom, onNotify, t]);

  const handlePartyCopyInvite = useCallback(() => {
    if (!partyRoom) return;
    const webUrl = `https://scope-hub.vercel.app/party/${partyRoom.code}`;
    const text = `${t("party.section.code")}: ${partyRoom.code} | scope://party/${partyRoom.code} (${webUrl})`;
    void navigator.clipboard.writeText(text).then(() => {
      onNotify("success", t("party.copyInviteSuccess"), "");
    });
  }, [partyRoom, onNotify, t]);

  // TTL countdown for party room display
  const [partyTimeLeft, setPartyTimeLeft] = useState("");
  useEffect(() => {
    if (!partyRoom) { setPartyTimeLeft(""); return; }
    const update = () => {
      const ms = new Date(partyRoom.expiresAt).getTime() - Date.now();
      if (ms <= 0) { setPartyTimeLeft(""); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setPartyTimeLeft(h > 0 ? t("party.timeLeftHours", { h, m }) : t("party.timeLeftMinutes", { m }));
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [partyRoom, t]);

  const isRoomForThisInstance = Boolean(partyRoom && (!partyInstanceId || partyInstanceId === instance.id));
  const isGuestJoinReady = Boolean(
    isRoomForThisInstance &&
      !isPartyHost &&
      partyRoom &&
      (partyRoom.status === "hosting" || guestProxyPort),
  );

  const handleHeroPlay = useCallback(() => {
    if (isGuestJoinReady && guestProxyPort) {
      onPlay(instance, { serverAddress: `127.0.0.1:${guestProxyPort}` });
    } else {
      onPlay(instance);
    }
  }, [isGuestJoinReady, guestProxyPort, onPlay, instance]);

  const loadScreenshots = useCallback(async () => {
    try {
      setLoadingScreenshots(true);
      const list = await window.onyx.state.listScreenshots(instance.id);
      setScreenshots(list);
    } catch {
      setScreenshots([]);
    } finally {
      setLoadingScreenshots(false);
    }
  }, [instance.id]);

  useEffect(() => {
    void window.onyx.state
      .listScreenshots(instance.id)
      .then(setScreenshots)
      .catch(() => undefined);
  }, [instance.id]);

  useEffect(() => {
    if (tab === "screenshots") {
      void loadScreenshots();
    }
  }, [tab, loadScreenshots]);

  useEffect(() => {
    if (!activeScreenshot) {
      setActiveScreenshotData(null);
      setCopiedScreenshot(false);
      return;
    }
    let cancelled = false;
    window.onyx.state
      .readScreenshot(instance.id, activeScreenshot.name)
      .then((data: string) => {
        if (!cancelled) setActiveScreenshotData(data);
      })
      .catch(() => {
        if (!cancelled) setActiveScreenshotData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeScreenshot, instance.id]);

  useEffect(() => {
    if (!activeScreenshot) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActiveScreenshot(null);
      } else if (e.key === "ArrowLeft") {
        const idx = screenshots.findIndex(
          (s) => s.name === activeScreenshot?.name,
        );
        if (idx > 0) setActiveScreenshot(screenshots[idx - 1]);
      } else if (e.key === "ArrowRight") {
        const idx = screenshots.findIndex(
          (s) => s.name === activeScreenshot?.name,
        );
        if (idx >= 0 && idx < screenshots.length - 1) {
          setActiveScreenshot(screenshots[idx + 1]);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeScreenshot, screenshots]);

  const handleCopyScreenshot = useCallback(
    async (item: InstanceScreenshot) => {
      try {
        await window.onyx.state.copyScreenshot(instance.id, item.name);
        setCopiedScreenshot(true);
        onNotify?.("success", t("instancePage.screenshots.copied"), item.name);
        setTimeout(() => setCopiedScreenshot(false), 2000);
      } catch {
        onNotify?.("warning", "Copy failed", "Could not copy to clipboard");
      }
    },
    [instance.id, onNotify, t],
  );

  const handleShowScreenshot = useCallback(
    async (item: InstanceScreenshot) => {
      try {
        await window.onyx.state.showScreenshot(instance.id, item.name);
      } catch {
        onNotify?.("warning", "Open failed", "Could not open folder");
      }
    },
    [instance.id, onNotify],
  );

  const handleDeleteScreenshot = useCallback(
    async (item: InstanceScreenshot) => {
      try {
        await window.onyx.state.deleteScreenshot(instance.id, item.name);
        setScreenshots((prev) => prev.filter((s) => s.name !== item.name));
        if (activeScreenshot?.name === item.name) {
          setActiveScreenshot(null);
        }
        onNotify?.("info", t("instancePage.screenshots.deleted"), item.name);
      } catch {
        onNotify?.("warning", "Delete failed", "Could not delete screenshot");
      }
    },
    [activeScreenshot?.name, instance.id, onNotify, t],
  );

  const handleExportPerformanceCsv = useCallback(async () => {
    try {
      const path = await window.onyx.state.exportPerformanceCsv(instance.id);
      if (path) {
        onNotify(
          "success",
          t("instancePage.performance.exported"),
          t("instancePage.performance.exportedHint", { path }),
        );
      }
    } catch {
      onNotify(
        "warning",
        t("instancePage.performance.exportFailed"),
        "",
      );
    }
  }, [instance.id, onNotify, t]);

  useEffect(() => {
    const nextServers = legacyServers(
      instance.settings,
      t("instancePage.server.defaultName"),
    );
    setServers(nextServers);
    setSelectedServerId(
      instance.settings?.selectedServerId &&
        nextServers.some(
          (server) => server.id === instance.settings?.selectedServerId,
        )
        ? instance.settings.selectedServerId
        : nextServers[0]?.id || "",
    );
  }, [instance.id, instance.settings, t]);

  useEffect(() => {
    contentRequestRef.current += 1;
    setServerStatuses({});
    setTab("overview");
    setRestoreSnapshotId(null);
    setUpdatePreview(null);
    setStorageReport(null);
    setStorageCleanupConfirm(false);
    setFpsRecorderStatus(null);
    setSelectedPerformanceSessionId(null);
    setModProfiles([]);
    setModProfileName("");
    setDeleteModProfileId(null);
    void window.onyx.state
      .listWorldSnapshots(instance.id)
      .then(setWorldSnapshots)
      .catch(() => setWorldSnapshots([]));
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".content")
        ?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [instance.id]);

  const instanceSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.instanceId === instance.id)
        .sort(
          (left, right) =>
            new Date(right.endedAt).getTime() -
            new Date(left.endedAt).getTime(),
        ),
    [instance.id, sessions],
  );
  const selectedServer =
    servers.find((server) => server.id === selectedServerId) || servers[0];
  const latestSession = instanceSessions[0];
  const successfulSessions = instanceSessions.filter(
    (session) => session.exitCode === 0,
  ).length;
  const recordedSessions = instanceSessions.filter(
    (session) => session.performance?.available,
  );
  const selectedPerformanceSession =
    (selectedPerformanceSessionId &&
      recordedSessions.find(
        (session) => session.id === selectedPerformanceSessionId,
      )) ||
    null;
  const currentPerformanceSession =
    selectedPerformanceSession || recordedSessions[0] || null;
  const latestPerformance =
    currentPerformanceSession?.performance ||
    (instance.lastPerformance?.available
      ? instance.lastPerformance
      : null);
  const pinnedBaselineSession =
    recordedSessions.find(
      (session) =>
        session.id ===
        instance.settings?.performanceBaselineSessionId,
    ) || null;
  const automaticBaselineSession =
    recordedSessions.find(
      (session) => session.id !== currentPerformanceSession?.id,
    ) || null;
  const baselineSession =
    pinnedBaselineSession?.id !== currentPerformanceSession?.id
      ? pinnedBaselineSession || automaticBaselineSession
      : automaticBaselineSession;
  const baselineIsPinned =
    Boolean(pinnedBaselineSession) &&
    pinnedBaselineSession?.id === baselineSession?.id;
  const comparisonReady = Boolean(
    currentPerformanceSession?.performance &&
      baselineSession?.performance &&
      currentPerformanceSession.id !== baselineSession.id,
  );
  const healthIssues =
    instance.health?.checks.filter((check) => check.status !== "pass") || [];

  const loadContent = useCallback(
    async (checkUpdates = false) => {
      const requestId = ++contentRequestRef.current;
      setContentBusy(true);
      try {
        const items =
          checkUpdates && contentKind === "mods"
            ? await window.onyx.state.checkContentUpdates(instance.id)
            : await window.onyx.state.listContent(
                instance.id,
                contentKind,
              );
        if (requestId !== contentRequestRef.current) return;
        setContent(items);
        if (contentKind === "mods") {
          const [history, activeBisect, profiles] = await Promise.all([
            window.onyx.state.listContentHistory(instance.id),
            window.onyx.state.getBisect(instance.id),
            window.onyx.state.listModProfiles(instance.id),
          ]);
          if (requestId !== contentRequestRef.current) return;
          setContentHistory(history);
          setBisect(activeBisect);
          setModProfiles(profiles);
        } else {
          setContentHistory([]);
          setBisect(null);
          setModProfiles([]);
        }
      } catch (error) {
        onNotify(
          "warning",
          t("instancePage.content.loadFailed"),
          error instanceof Error
            ? error.message
            : t("instancePage.content.loadFailedHint"),
        );
      } finally {
        if (requestId === contentRequestRef.current) {
          setContentBusy(false);
        }
      }
    },
    [contentKind, instance.id, onNotify, t],
  );

  const loadStorage = useCallback(async (force = false) => {
    setStorageBusy(true);
    try {
      setStorageReport(
        await window.onyx.state.analyzeInstanceStorage(instance.id, force),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.storage.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.storage.failedHint"),
      );
    } finally {
      setStorageBusy(false);
    }
  }, [instance.id, onNotify, t]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [moreMenuOpen]);

  useEffect(() => {
    if (tab === "content") void loadContent(false);
  }, [loadContent, tab]);

  useEffect(() => {
    if (tab === "diagnostics" && diagnosticTab === "storage") void loadStorage();
  }, [diagnosticTab, loadStorage, tab]);

  useEffect(() => {
    if (
      tab !== "diagnostics" ||
      diagnosticTab !== "performance" ||
      fpsRecorderStatus
    )
      return;
    void window.onyx.system
      .fpsRecorderStatus()
      .then(setFpsRecorderStatus)
      .catch(() => undefined);
  }, [diagnosticTab, fpsRecorderStatus, tab]);

  const persistServers = async (
    nextServers: InstanceServer[],
    nextSelectedId: string,
  ) => {
    const selected =
      nextServers.find((server) => server.id === nextSelectedId) ||
      nextServers[0];
    const updated = await onUpdate(instance, {
      settings: {
        ...instance.settings,
        servers: nextServers,
        selectedServerId: selected?.id || "",
        serverAddress: selected?.address || "",
      },
    });
    const saved = updated.settings?.servers || [];
    setServers(saved);
    setSelectedServerId(updated.settings?.selectedServerId || saved[0]?.id || "");
    return updated;
  };

  const addServer = async () => {
    if (!serverAddress.trim()) return;
    setServerBusy(true);
    try {
      const server: InstanceServer = {
        id: `server-${Date.now().toString(36)}`,
        name: serverName.trim() || serverAddress.trim(),
        address: serverAddress.trim(),
        createdAt: new Date().toISOString(),
      };
      await persistServers(
        [...servers, server],
        selectedServerId || server.id,
      );
      setServerName("");
      setServerAddress("");
      onNotify(
        "success",
        t("instancePage.server.added"),
        t("instancePage.server.addedHint", { name: server.name }),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.server.invalid"),
        error instanceof Error
          ? error.message
          : t("instancePage.server.invalidHint"),
      );
    } finally {
      setServerBusy(false);
    }
  };

  const selectServer = async (id: string) => {
    setServerBusy(true);
    try {
      await persistServers(servers, id);
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.server.invalid"),
        error instanceof Error
          ? error.message
          : t("instancePage.server.invalidHint"),
      );
    } finally {
      setServerBusy(false);
    }
  };

  const removeServer = async (id: string) => {
    setServerBusy(true);
    try {
      const next = servers.filter((server) => server.id !== id);
      const nextSelected =
        selectedServerId === id ? next[0]?.id || "" : selectedServerId;
      await persistServers(next, nextSelected);
      setServerStatuses((current) => {
        const copy = { ...current };
        delete copy[id];
        return copy;
      });
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.server.invalid"),
        error instanceof Error
          ? error.message
          : t("instancePage.server.invalidHint"),
      );
    } finally {
      setServerBusy(false);
    }
  };

  const checkServer = async (server: InstanceServer) => {
    setCheckingServer(server.id);
    try {
      const status = await window.onyx.system.serverStatus(server.address);
      setServerStatuses((current) => ({
        ...current,
        [server.id]: status,
      }));
    } catch (error) {
      setServerStatuses((current) => ({
        ...current,
        [server.id]: {
          online: false,
          address: server.address,
          error:
            error instanceof Error
              ? error.message
              : t("instancePage.server.unavailable"),
        },
      }));
    } finally {
      setCheckingServer(null);
    }
  };

  const launchServer = async (server: InstanceServer) => {
    setServerBusy(true);
    try {
      const updated =
        selectedServerId === server.id
          ? instance
          : await persistServers(servers, server.id);
      onPlay(updated);
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.server.invalid"),
        error instanceof Error
          ? error.message
          : t("instancePage.server.invalidHint"),
      );
    } finally {
      setServerBusy(false);
    }
  };

  const toggleContent = async (item: InstanceContent) => {
    setContentAction(item.path);
    try {
      await window.onyx.state.toggleContent(item.path);
      await loadContent(false);
      onChanged();
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.content.loadFailed"),
        error instanceof Error
          ? error.message
          : t("instancePage.content.loadFailedHint"),
      );
    } finally {
      setContentAction(null);
    }
  };

  const deleteContent = async (item: InstanceContent) => {
    setContentAction(item.path);
    try {
      await window.onyx.state.deleteContent(item.path);
      await loadContent(false);
      onChanged();
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.content.loadFailed"),
        error instanceof Error
          ? error.message
          : t("instancePage.content.loadFailedHint"),
      );
    } finally {
      setContentAction(null);
    }
  };

  const updateContent = async (item: InstanceContent) => {
    setContentAction(item.path);
    try {
      const result = await window.onyx.state.updateContent(
        instance.id,
        item.path,
      );
      await loadContent(true);
      onChanged();
      onNotify(
        result.updated ? "success" : "info",
        result.updated
          ? t("instancePage.content.updated")
          : t("instancePage.content.current"),
        item.name,
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.content.updateFailed"),
        error instanceof Error
          ? error.message
          : t("instancePage.content.updateFailedHint"),
      );
    } finally {
      setContentAction(null);
    }
  };

  const rollbackContent = async (entry: ContentHistoryEntry) => {
    setContentAction(entry.id);
    try {
      await window.onyx.state.rollbackContent(instance.id, entry.id);
      await loadContent(false);
      onChanged();
      onNotify(
        "success",
        t("instancePage.content.restored"),
        entry.previousName,
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.content.loadFailed"),
        error instanceof Error
          ? error.message
          : t("instancePage.content.loadFailedHint"),
      );
    } finally {
      setContentAction(null);
    }
  };

  const saveCurrentModProfile = async (profile?: ModProfile) => {
    const name = profile?.name || modProfileName.trim();
    if (!name) return;
    const actionId = profile?.id || "new";
    setModProfileBusy(actionId);
    try {
      const saved = await window.onyx.state.saveModProfile(
        instance.id,
        name,
        profile?.id,
      );
      setModProfileName("");
      setDeleteModProfileId(null);
      await loadContent(false);
      onNotify(
        "success",
        profile
          ? t("instancePage.profiles.updated")
          : t("instancePage.profiles.saved"),
        t("instancePage.profiles.savedHint", {
          name: saved.name,
          enabled: saved.enabledCount,
          total: saved.modCount,
        }),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.profiles.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.profiles.failedHint"),
      );
    } finally {
      setModProfileBusy(null);
    }
  };

  const applySavedModProfile = async (profile: ModProfile) => {
    setModProfileBusy(profile.id);
    try {
      const result = await window.onyx.state.applyModProfile(
        instance.id,
        profile.id,
      );
      await loadContent(false);
      onChanged();
      onNotify(
        "success",
        t("instancePage.profiles.applied"),
        t("instancePage.profiles.appliedHint", {
          name: profile.name,
          changed: result.changed.length,
          missing: result.missing.length,
        }),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.profiles.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.profiles.failedHint"),
      );
    } finally {
      setModProfileBusy(null);
    }
  };

  const removeSavedModProfile = async (profile: ModProfile) => {
    if (deleteModProfileId !== profile.id) {
      setDeleteModProfileId(profile.id);
      return;
    }
    setModProfileBusy(profile.id);
    try {
      await window.onyx.state.deleteModProfile(instance.id, profile.id);
      setDeleteModProfileId(null);
      await loadContent(false);
      onNotify(
        "info",
        t("instancePage.profiles.deleted"),
        profile.name,
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.profiles.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.profiles.failedHint"),
      );
    } finally {
      setModProfileBusy(null);
    }
  };

  const runBisectAction = async (
    action: () => Promise<ModBisectSession | null>,
  ) => {
    setBisectBusy(true);
    try {
      const next = await action();
      setBisect(next);
      await loadContent(false);
      onChanged();
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.bisect.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.bisect.failedHint"),
      );
    } finally {
      setBisectBusy(false);
    }
  };

  const startBisectFlow = () =>
    runBisectAction(() => window.onyx.state.startBisect(instance.id));

  const reportBisectFlow = (gameStarted: boolean) =>
    runBisectAction(() =>
      window.onyx.state.reportBisect(instance.id, gameStarted),
    );

  const cancelBisectFlow = () =>
    runBisectAction(async () => {
      await window.onyx.state.cancelBisect(instance.id);
      return null;
    });

  const finishBisectFlow = (disableCulprit: boolean) =>
    runBisectAction(async () => {
      const result = await window.onyx.state.finishBisect(
        instance.id,
        disableCulprit,
      );
      onNotify(
        "success",
        disableCulprit
          ? t("instancePage.bisect.disabled")
          : t("instancePage.bisect.finished"),
        result.culprit,
      );
      return null;
    });

  const refreshWorldSnapshots = async () => {
    setWorldSnapshots(
      await window.onyx.state.listWorldSnapshots(instance.id),
    );
  };

  const createWorldSnapshot = async () => {
    setWorldBusy(true);
    try {
      const snapshot = await window.onyx.state.createWorldSnapshot(
        instance.id,
      );
      await refreshWorldSnapshots();
      onNotify(
        snapshot ? "success" : "info",
        snapshot
          ? t("instancePage.worlds.created")
          : t("instancePage.worlds.empty"),
        snapshot
          ? t("instancePage.worlds.createdHint", {
              count: snapshot.worlds.length,
            })
          : t("instancePage.worlds.emptyHint"),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.worlds.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.worlds.failedHint"),
      );
    } finally {
      setWorldBusy(false);
    }
  };

  const restoreWorldSnapshot = async (snapshot: WorldSnapshot) => {
    if (restoreSnapshotId !== snapshot.id) {
      setRestoreSnapshotId(snapshot.id);
      return;
    }
    setWorldBusy(true);
    try {
      await window.onyx.state.restoreWorldSnapshot(instance.id, snapshot.id);
      await refreshWorldSnapshots();
      setRestoreSnapshotId(null);
      onNotify(
        "success",
        t("instancePage.worlds.restored"),
        t("instancePage.worlds.restoredHint", {
          count: snapshot.worlds.length,
        }),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.worlds.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.worlds.failedHint"),
      );
    } finally {
      setWorldBusy(false);
    }
  };

  const loadUpdatePreview = async () => {
    setPreviewBusy(true);
    try {
      setUpdatePreview(
        await window.onyx.state.previewPackUpdate(instance.id),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.preview.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.preview.failedHint"),
      );
    } finally {
      setPreviewBusy(false);
    }
  };

  const setPerformanceBaseline = async (sessionId: string) => {
    setBaselineBusy(true);
    const clearing =
      instance.settings?.performanceBaselineSessionId === sessionId;
    try {
      await onUpdate(instance, {
        settings: {
          ...instance.settings,
          performanceBaselineSessionId: clearing ? "" : sessionId,
        },
      });
      onNotify(
        "success",
        clearing
          ? t("instancePage.performance.baselineCleared")
          : t("instancePage.performance.baselineSaved"),
        clearing
          ? t("instancePage.performance.baselineClearedHint")
          : t("instancePage.performance.baselineSavedHint"),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.performance.baselineFailed"),
        error instanceof Error
          ? error.message
          : t("instancePage.performance.baselineFailedHint"),
      );
    } finally {
      setBaselineBusy(false);
    }
  };

  const cleanupStorage = async () => {
    if (!storageCleanupConfirm) {
      setStorageCleanupConfirm(true);
      return;
    }
    setStorageBusy(true);
    try {
      const result = await window.onyx.state.cleanupInstanceStorage(
        instance.id,
      );
      setStorageReport(result.report);
      setStorageCleanupConfirm(false);
      onNotify(
        result.removedFiles > 0 ? "success" : "info",
        result.removedFiles > 0
          ? t("instancePage.storage.cleaned")
          : t("instancePage.storage.nothing"),
        result.removedFiles > 0
          ? t("instancePage.storage.cleanedHint", {
              files: result.removedFiles,
              size: formatBytes(result.removedBytes, locale),
            })
          : t("instancePage.storage.nothingHint"),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.storage.failed"),
        error instanceof Error
          ? error.message
          : t("instancePage.storage.failedHint"),
      );
    } finally {
      setStorageBusy(false);
    }
  };

  const toggleFpsRecording = async () => {
    const enabled = !instance.settings?.recordFps;
    setFpsSettingBusy(true);
    try {
      await onUpdate(instance, {
        settings: {
          ...instance.settings,
          recordFps: enabled,
        },
      });
      onNotify(
        "success",
        enabled
          ? t("instancePage.performance.fpsEnabled")
          : t("instancePage.performance.fpsDisabled"),
        enabled
          ? t("instancePage.performance.fpsEnabledHint")
          : t("instancePage.performance.fpsDisabledHint"),
      );
    } catch (error) {
      onNotify(
        "warning",
        t("instancePage.performance.fpsSettingFailed"),
        error instanceof Error
          ? error.message
          : t("instancePage.performance.fpsSettingFailedHint"),
      );
    } finally {
      setFpsSettingBusy(false);
    }
  };

  const copyPerformanceReport = async () => {
    if (
      !currentPerformanceSession?.performance ||
      !baselineSession?.performance
    ) {
      return;
    }
    const current = currentPerformanceSession.performance;
    const baseline = baselineSession.performance;
    const line = (
      label: string,
      currentValue: number | undefined,
      baselineValue: number | undefined,
      unit: string,
    ) => {
      const delta = metricDelta(currentValue, baselineValue);
      return `${label}: ${formatReportNumber(
        currentValue,
        locale,
      )}${unit} (${formatDelta(delta)})`;
    };
    const report = [
      `Scope Performance · ${displayName}`,
      `${t("instancePage.performance.reportCurrent")}: ${formatSessionDate(
        currentPerformanceSession,
        locale,
      )}`,
      `${t("instancePage.performance.reportBaseline")}: ${formatSessionDate(
        baselineSession,
        locale,
      )}`,
      "",
      line(
        t("instancePage.performance.averageFps"),
        current.fps?.averageFps,
        baseline.fps?.averageFps,
        " FPS",
      ),
      line(
        t("instancePage.performance.onePercentLow"),
        current.fps?.onePercentLowFps,
        baseline.fps?.onePercentLowFps,
        " FPS",
      ),
      line(
        t("instancePage.performance.peakRam"),
        current.peakRssBytes / 1024 ** 3,
        baseline.peakRssBytes / 1024 ** 3,
        " GB",
      ),
      line(
        t("instancePage.performance.startup"),
        current.startupMs == null
          ? undefined
          : current.startupMs / 1_000,
        baseline.startupMs == null
          ? undefined
          : baseline.startupMs / 1_000,
        " s",
      ),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      onNotify(
        "success",
        t("instancePage.performance.reportCopied"),
        t("instancePage.performance.reportCopiedHint"),
      );
    } catch {
      onNotify(
        "warning",
        t("instancePage.performance.reportFailed"),
        t("instancePage.performance.reportFailedHint"),
      );
    }
  };

  const filteredContent = content.filter((item) =>
    item.name.toLowerCase().includes(contentQuery.trim().toLowerCase()),
  );
  const updates = content.filter((item) => item.update).length;
  const displayName =
    isBuiltinPureGame(instance)
      ? t("home.defaultName")
      : instance.name;

  return (
    <motion.div
      className={`page instance-page instance-page--${instance.color}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      <button className="instance-page__back" onClick={onBack}>
        <ArrowLeft size={15} />
        {t("instancePage.back")}
      </button>

      <section className={`instance-hero ${moreMenuOpen ? "is-menu-open" : ""}`}>
        <div className="instance-hero__grid" />
        <div className="instance-hero__identity">
          <span className="instance-hero__icon">
            {instance.iconUrl ? (
              <img src={instance.iconUrl} alt="" />
            ) : (
              instance.glyph
            )}
          </span>
          <div>
            <p>{t("instancePage.eyebrow")}</p>
            <h1>{displayName}</h1>
            <span>
              Minecraft {instance.version} · {instance.loader}
            </span>
            <small>{instance.description}</small>
          </div>
        </div>
        <div className="instance-hero__actions">
          <button
            className="button button--secondary"
            title={t("instancePage.actions.settings")}
            onClick={() => onSettings(instance)}
          >
            <Settings2 size={16} />
            {t("instancePage.actions.settings")}
          </button>
          <button
            className="button button--secondary"
            title={t("instancePage.actions.folder")}
            onClick={() => onOpenFolder(instance)}
          >
            <FolderOpen size={16} />
            {t("instancePage.actions.folder")}
          </button>
          {isRoomForThisInstance && partyRoom ? (
            <button
              className="button button--secondary party-btn party-btn--active"
              title={t("party.button.close")}
              onClick={() => void handlePartyClose()}
            >
              <Users2 size={16} />
              <span className="party-btn__code">{partyRoom.code}</span>
              <span className="party-btn__peers">{partyRoom.peers.length}</span>
            </button>
          ) : (
            <button
              className="button button--secondary party-btn"
              disabled={partyCreating || instance.status === "installing"}
              onClick={() => void handlePartyCreate()}
            >
              {partyCreating ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Users2 size={16} />
              )}
              {partyCreating ? t("party.creating") : t("party.button.create")}
            </button>
          )}
          <div className="dropdown-wrapper" ref={moreMenuRef}>
            <button
              className={`button button--secondary ${
                moreMenuOpen ? "is-active" : ""
              }`}
              onClick={() => setMoreMenuOpen(!moreMenuOpen)}
              title={t("instancePage.actions.more")}
            >
              <MoreHorizontal size={16} />
            </button>
            {moreMenuOpen && (
              <div className="dropdown-menu dropdown-menu--right">
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onCheck(instance);
                  }}
                >
                  <ShieldCheck size={15} />
                  <span>{t("instancePage.guard")}</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onLogs(instance);
                  }}
                >
                  <History size={15} />
                  <span>{t("instancePage.actions.logs")}</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onBackup(instance);
                  }}
                >
                  <Archive size={15} />
                  <span>{t("instancePage.actions.backup")}</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onExportSync(instance);
                  }}
                >
                  <Share2 size={15} />
                  <span>{t("instancePage.actions.sync")}</span>
                </button>
                {instance.status === "running" && (
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onPlay(instance, { multiClient: true });
                    }}
                  >
                    <Plus size={15} />
                    <span>{t("instancePage.actions.launchAnother")}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          {instance.status === "running" && (
            <button
              type="button"
              className="instance-hero__play-more"
              title={t("instancePage.actions.launchAnother")}
              onClick={() => onPlay(instance, { multiClient: true })}
            >
              <Plus size={15} />
              <span>{t("instancePage.actions.addClient")}</span>
              {Boolean(instance.runningCount && instance.runningCount > 1) && (
                <span className="instance-hero__count-badge">{instance.runningCount}x</span>
              )}
            </button>
          )}
          <button
            className={`button button--primary instance-hero__play ${isGuestJoinReady ? "button--party-join" : ""}`}
            disabled={instance.status === "installing"}
            onClick={handleHeroPlay}
          >
            {instance.status === "installing" ? (
              <LoaderCircle className="spin" size={16} />
            ) : isGuestJoinReady ? (
              <Users2 size={16} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            {instance.status === "running"
              ? (instance.runningCount && instance.runningCount > 1
                  ? `${t("home.action.stop")} (${instance.runningCount})`
                  : t("home.action.stop"))
              : isGuestJoinReady
                ? t("party.button.joinHost")
                : t("home.action.play")}
          </button>
        </div>
      </section>

      <nav className="instance-page-tabs">
        {(
          [
            ["overview", Gauge, t("instancePage.tab.overview")],
            ["content", Package, t("instancePage.tab.content")],
            ["servers", Server, t("instancePage.tab.servers")],
            ["screenshots", Camera, t("instancePage.tab.screenshots")],
            ["diagnostics", Activity, t("instancePage.tab.diagnostics")],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            className={tab === id ? "is-active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
            {id === "content" && instance.modCount > 0 && (
              <small>{instance.modCount}</small>
            )}
            {id === "screenshots" && screenshots.length > 0 && (
              <small>{screenshots.length}</small>
            )}
            {id === "servers" && servers.length > 0 && (
              <small>{servers.length}</small>
            )}

          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="instance-overview">
          <div className="instance-overview__main">
            {isRoomForThisInstance && partyRoom && (
              <section className="instance-section party-card">
                <div className="instance-section__head">
                  <div>
                    <p>{t("party.section.title")}</p>
                    <h2>
                      {partyRoom.status === "hosting"
                        ? t("party.status.hosting")
                        : t("party.status.waiting")}
                    </h2>
                  </div>
                  <div className="party-card__head-actions">
                    <button
                      className={`button button--mini button--secondary ${partyGuideOpen ? "is-active" : ""}`}
                      onClick={() => setPartyGuideOpen((prev) => !prev)}
                    >
                      <BookOpen size={14} />
                      {t("party.guide.toggle")}
                    </button>
                    <button
                      className="button button--mini button--secondary"
                      onClick={handlePartyCopyCode}
                      title={t("party.section.code")}
                    >
                      {partyCopied ? <Check size={14} /> : <ClipboardCopy size={14} />}
                      {partyCopied ? t("party.section.copied") : t("party.section.copy")}
                    </button>
                    <button
                      className="button button--mini button--secondary"
                      onClick={handlePartyCopyInvite}
                      title={t("party.copyInvite")}
                    >
                      <Share2 size={14} />
                      {t("party.copyInvite")}
                    </button>
                    <button
                      className="button button--mini button--danger-quiet"
                      onClick={() => void handlePartyClose()}
                    >
                      <Trash2 size={14} />
                      {t("party.button.close")}
                    </button>
                  </div>
                </div>

                <div className="party-card__body">
                  <div className="party-card__code-box" onClick={handlePartyCopyCode}>
                    <div className="party-card__code-left">
                      <span className="party-card__code-label">{t("party.section.code")}</span>
                      <span className="party-card__code-val">{partyRoom.code}</span>
                    </div>
                    <span className="party-card__code-link">scope://party/{partyRoom.code}</span>
                  </div>

                  <div className="party-card__network-box">
                    <div className="party-card__network-status">
                      <span className={`party-card__network-dot ${partyLanInfo || partyRoom.tunnelHost ? "is-live" : ""}`} />
                      <div className="party-card__network-info">
                        <span className="party-card__network-text">
                          {partyLanInfo?.tunnelType === "e4mc" || partyLanInfo?.isE4mc
                            ? t("party.lan.e4mcReady", { domain: partyLanInfo.hostIp })
                            : partyLanInfo?.tunnelType === "upnp"
                              ? `${t("party.tunnel.upnp")}: ${partyLanInfo.hostIp}:${partyLanInfo.relayPort}`
                              : partyLanInfo?.tunnelType === "playit"
                                ? `${t("party.tunnel.playit")}: ${partyLanInfo.hostIp}:${partyLanInfo.relayPort}`
                                : partyLanInfo?.tunnelType === "local"
                                  ? `${t("party.tunnel.local")}: ${partyLanInfo.hostIp}:${partyLanInfo.relayPort}`
                                  : partyRoom.tunnelHost
                                    ? partyRoom.tunnelHost.includes("e4mc.link")
                                      ? t("party.lan.e4mcReady", { domain: partyRoom.tunnelHost })
                                      : `${partyRoom.tunnelHost}:${partyRoom.tunnelPort}`
                                    : t("party.lan.waiting")}
                        </span>
                        {partyLanInfo?.tunnelType && (
                          <span className={`party-tunnel-tag party-tunnel-tag--${partyLanInfo.tunnelType}`}>
                            {partyLanInfo.tunnelType === "e4mc" && <Globe size={11} />}
                            {partyLanInfo.tunnelType === "upnp" && <Network size={11} />}
                            {partyLanInfo.tunnelType === "playit" && <Radio size={11} />}
                            {partyLanInfo.tunnelType === "local" && <Users2 size={11} />}
                            <span>{t(`party.tunnel.${partyLanInfo.tunnelType}`)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isPartyHost && (
                    <div className="party-tunnel-config">
                      <div className="party-tunnel-config__head">
                        <span className="party-tunnel-config__label">{t("party.tunnelMode.label")}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            type="button"
                            className="button button--mini button--secondary"
                            onClick={() => setIsCreatePartyModalOpen(true)}
                            title={t("party.button.changeMethod")}
                          >
                            <HelpCircle size={12} />
                            <span>{t("party.button.changeMethod")}</span>
                          </button>
                          {partyTunnelMode === "upnp" && (
                            <button
                              type="button"
                              className="button button--mini button--secondary"
                              onClick={() => void handleTestUpnp()}
                              disabled={testingUpnp}
                            >
                              {testingUpnp ? <LoaderCircle className="spin" size={12} /> : <Network size={12} />}
                              <span>{t("party.testUpnp.btn")}</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="party-tunnel-tabs">
                        {(
                          [
                            ["auto", t("party.tunnelMode.auto"), t("party.tunnelMode.autoTooltip")],
                            ["e4mc", t("party.tunnelMode.e4mc"), t("party.tunnelMode.e4mcTooltip")],
                            ["upnp", t("party.tunnelMode.upnp"), t("party.tunnelMode.upnpTooltip")],
                            ["playit", t("party.tunnelMode.playit"), t("party.tunnelMode.playitTooltip")],
                            ["local", t("party.tunnelMode.local"), t("party.tunnelMode.localTooltip")],
                          ] as const
                        ).map(([mode, label, tip]) => (
                          <button
                            key={mode}
                            type="button"
                            title={tip}
                            className={`party-tunnel-tab ${partyTunnelMode === mode ? "is-active" : ""}`}
                            onClick={() => void handleSetTunnelMode(mode)}
                          >
                            {mode === "auto" && <Sparkles size={12} />}
                            {mode === "e4mc" && <Globe size={12} />}
                            {mode === "upnp" && <Network size={12} />}
                            {mode === "playit" && <Radio size={12} />}
                            {mode === "local" && <Wifi size={12} />}
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(partyLanInfo?.tunnelType === "local" || (!partyLanInfo && partyTunnelMode === "local")) && isPartyHost && (
                    <div className="party-helper-banner party-helper-banner--local">
                      <div className="party-helper-banner__icon">
                        <Wifi size={16} />
                      </div>
                      <div className="party-helper-banner__content">
                        <strong>{t("party.localWarning.title")}</strong>
                        <p>{t("party.localWarning.desc", { ip: partyLanInfo?.hostIp || "192.168.x.x" })}</p>
                      </div>
                    </div>
                  )}

                  {(!instance.loader || instance.loader.toLowerCase() === "vanilla") && isPartyHost && (
                    <div className="party-helper-banner">
                      <div className="party-helper-banner__icon">
                        <Zap size={16} />
                      </div>
                      <div className="party-helper-banner__content">
                        <strong>{t("party.vanillaFix.title")}</strong>
                        <p>{t("party.vanillaFix.desc")}</p>
                      </div>
                      <button
                        type="button"
                        className="button button--mini button--accent"
                        onClick={() => void handleConvertVanillaE4mc()}
                        disabled={convertingVanilla}
                      >
                        {convertingVanilla ? <LoaderCircle className="spin" size={13} /> : <Zap size={13} />}
                        <span>{t("party.vanillaFix.action")}</span>
                      </button>
                    </div>
                  )}

                  {Boolean(instance.loader && instance.loader.toLowerCase() !== "vanilla") &&
                    isPartyHost &&
                    e4mcStatus &&
                    !e4mcStatus.installed &&
                    e4mcStatus.supported && (
                      <div className="party-helper-banner">
                        <div className="party-helper-banner__icon">
                          <Download size={16} />
                        </div>
                        <div className="party-helper-banner__content">
                          <strong>{t("party.e4mcInstall.title")}</strong>
                          <p>{t("party.e4mcInstall.desc")}</p>
                        </div>
                        <button
                          type="button"
                          className="button button--mini button--accent"
                          onClick={() => void handleInstallE4mc()}
                          disabled={installingE4mc}
                        >
                          {installingE4mc ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}
                          <span>{t("party.e4mcInstall.action")}</span>
                        </button>
                      </div>
                    )}

                  {partyGuideOpen && (
                    <div className="party-guide">
                      <div className="party-guide__header">
                        <BookOpen size={14} className="party-guide__icon" />
                        <span>{t("party.guide.title")}</span>
                      </div>
                      <div className="party-guide__steps">
                        <div className="party-guide__step">
                          <span className="party-guide__step-num">1</span>
                          <div className="party-guide__step-content">
                            <strong>{t("party.guide.step1.title")}</strong>
                            <p>{t("party.guide.step1.desc")}</p>
                          </div>
                        </div>
                        <div className="party-guide__step">
                          <span className="party-guide__step-num">2</span>
                          <div className="party-guide__step-content">
                            <strong>{t("party.guide.step2.title")}</strong>
                            <p>{t("party.guide.step2.desc")}</p>
                          </div>
                        </div>
                        <div className="party-guide__step">
                          <span className="party-guide__step-num">3</span>
                          <div className="party-guide__step-content">
                            <strong>{t("party.guide.step3.title")}</strong>
                            <p>{t("party.guide.step3.desc")}</p>
                          </div>
                        </div>
                        <div className="party-guide__step">
                          <span className="party-guide__step-num">4</span>
                          <div className="party-guide__step-content">
                            <strong>{t("party.guide.step4.title")}</strong>
                            <p>{t("party.guide.step4.desc")}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {partyTimeLeft && (
                    <div className="party-card__meta">
                      <Clock3 size={13} />
                      <span>{t("party.section.expires")}: <strong>{partyTimeLeft}</strong></span>
                    </div>
                  )}

                  <div className="party-card__peers">
                    <div className="party-card__peers-header">
                      <span>{t("party.section.peers")} ({partyRoom.peers.length})</span>
                    </div>
                    <div className="party-card__peers-list">
                      {partyRoom.peers.map((peer) => (
                        <div key={peer.peerId} className="party-card__peer">
                          <span className={`party-card__peer-dot ${peer.ready ? "is-ready" : ""}`} />
                          <span className="party-card__peer-name">
                            {peer.displayName || peer.peerId.slice(0, 10)}
                            {peer.isHost && <span className="party-badge">{t("party.section.host")}</span>}
                          </span>
                          <span className="party-card__peer-status">
                            {peer.ready ? t("party.section.ready") : t("party.section.waiting")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
            {instance.updateAvailable && (
              <section className="instance-section instance-update-preview">
                <div className="instance-section__head">
                  <div>
                    <p>{t("instancePage.preview.eyebrow")}</p>
                    <h2>
                      {t("instancePage.preview.title", {
                        version: instance.updateAvailable.versionNumber,
                      })}
                    </h2>
                  </div>
                  <div className="instance-update-preview__head-actions">
                    <button
                      className="button button--mini"
                      disabled={previewBusy}
                      onClick={() => void loadUpdatePreview()}
                    >
                      {previewBusy ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Search size={14} />
                      )}
                      {updatePreview
                        ? t("instancePage.preview.refresh")
                        : t("instancePage.preview.inspect")}
                    </button>
                    <button
                      className="button button--mini button--accent"
                      disabled={instance.status === "running"}
                      onClick={() => onUpdatePack(instance)}
                    >
                      <Download size={14} />
                      {t("instancePage.preview.install")}
                    </button>
                  </div>
                </div>
                {updatePreview ? (
                  <>
                    <div className="instance-update-preview__stats">
                      <PreviewStat
                        tone="added"
                        value={updatePreview.added.length}
                        label={t("instancePage.preview.added")}
                      />
                      <PreviewStat
                        tone="changed"
                        value={updatePreview.changed.length}
                        label={t("instancePage.preview.changed")}
                      />
                      <PreviewStat
                        tone="removed"
                        value={updatePreview.removed.length}
                        label={t("instancePage.preview.removed")}
                      />
                      <PreviewStat
                        tone="download"
                        value={formatBytes(
                          updatePreview.downloadBytes,
                          locale,
                        )}
                        label={t("instancePage.preview.download")}
                      />
                    </div>
                    {updatePreview.currentProfile &&
                      (updatePreview.currentProfile.minecraftVersion !==
                        updatePreview.nextProfile.minecraftVersion ||
                        updatePreview.currentProfile.loader !==
                          updatePreview.nextProfile.loader ||
                        updatePreview.currentProfile.loaderVersion !==
                          updatePreview.nextProfile.loaderVersion) && (
                        <div className="instance-update-preview__runtime">
                          <CircleAlert size={14} />
                          {t("instancePage.preview.runtime", {
                            current: `${updatePreview.currentProfile.minecraftVersion} / ${updatePreview.currentProfile.loader}`,
                            next: `${updatePreview.nextProfile.minecraftVersion} / ${updatePreview.nextProfile.loader}`,
                          })}
                        </div>
                      )}
                    {!updatePreview.baselineAvailable && (
                      <div className="instance-update-preview__runtime">
                        <CircleAlert size={14} />
                        {t("instancePage.preview.noBaseline")}
                      </div>
                    )}
                    <div className="instance-update-preview__files">
                      {[
                        ...updatePreview.added.map((file) => ({
                          ...file,
                          change: "added" as const,
                        })),
                        ...updatePreview.changed.map((file) => ({
                          ...file,
                          change: "changed" as const,
                        })),
                        ...updatePreview.removed.map((file) => ({
                          ...file,
                          change: "removed" as const,
                        })),
                      ]
                        .slice(0, 8)
                        .map((file) => (
                          <div key={`${file.change}-${file.path}`}>
                            <span className={`is-${file.change}`}>
                              {file.change === "added" ? (
                                <FilePlus size={13} />
                              ) : file.change === "removed" ? (
                                <FileX size={13} />
                              ) : (
                                <RefreshCw size={13} />
                              )}
                            </span>
                            <strong>{file.path}</strong>
                            <small>{formatBytes(file.size, locale)}</small>
                          </div>
                        ))}
                    </div>
                    {updatePreview.added.length +
                      updatePreview.changed.length +
                      updatePreview.removed.length >
                      8 && (
                      <small className="instance-update-preview__more">
                        {t("instancePage.preview.more", {
                          count:
                            updatePreview.added.length +
                            updatePreview.changed.length +
                            updatePreview.removed.length -
                            8,
                        })}
                      </small>
                    )}
                  </>
                ) : (
                  <p className="instance-update-preview__intro">
                    {t("instancePage.preview.description")}
                  </p>
                )}
              </section>
            )}
            <section className="instance-section">
              <div className="instance-section__head">
                <div>
                  <p>{t("instancePage.status.eyebrow")}</p>
                  <h2>{t("instancePage.status.title")}</h2>
                </div>
                <button
                  className="button button--mini"
                  onClick={() => onCheck(instance)}
                >
                  <RefreshCw size={14} />
                  {t("instancePage.status.check")}
                </button>
              </div>
              <div className="instance-health-summary">
                <span
                  className={`is-${instance.health?.status || "unknown"}`}
                >
                  {instance.health?.status === "healthy" ? (
                    <ShieldCheck size={21} />
                  ) : instance.health?.status ? (
                    <CircleAlert size={21} />
                  ) : (
                    <HeartPulse size={21} />
                  )}
                </span>
                <div>
                  <strong>
                    {healthLabel(instance.health?.status, t)}
                  </strong>
                  <small>
                    {healthIssues.length
                      ? t("instancePage.health.issues", {
                          count: healthIssues.length,
                        })
                      : t("instancePage.health.ready")}
                  </small>
                </div>
              </div>
              <div className="instance-stat-grid">
                <Stat
                  icon={Clock3}
                  label={t("instancePage.stat.playtime")}
                  value={formatPlaytime(instance.playtimeMinutes, locale)}
                />
                <Stat
                  icon={Package}
                  label={t("instancePage.stat.mods")}
                  value={String(instance.modCount)}
                />
                <Stat
                  icon={Coffee}
                  label={t("instancePage.stat.java")}
                  value={instance.javaMajor ? `Java ${instance.javaMajor}` : t("instancePage.auto")}
                />
                <Stat
                  icon={Gauge}
                  label={t("instancePage.stat.memory")}
                  value={`${instance.settings?.memory || "—"} GB`}
                />
              </div>
            </section>

            <section className="instance-section">
              <div className="instance-section__head">
                <div>
                  <p>{t("instancePage.activity.eyebrow")}</p>
                  <h2>{t("instancePage.activity.recent")}</h2>
                </div>
                <button
                  className="button button--mini"
                  onClick={() => {
                    setTab("diagnostics");
                    setDiagnosticTab("activity");
                  }}
                >
                  {t("instancePage.showAll")}
                </button>
              </div>
              {instanceSessions.length ? (
                <div className="instance-session-list">
                  {instanceSessions.slice(0, 4).map((session) => (
                    <SessionRow
                      key={session.id}
                      locale={locale}
                      session={session}
                      t={t}
                    />
                  ))}
                </div>
              ) : (
                <EmptyLine text={t("instancePage.activity.empty")} />
              )}
            </section>

            {screenshots.length > 0 && (
              <section className="instance-section instance-screenshots-preview">
                <div className="instance-section__head">
                  <div>
                    <p>{t("instancePage.tab.screenshots")}</p>
                    <h2>{t("instancePage.tab.screenshots")}</h2>
                  </div>
                  <button
                    className="button button--mini"
                    onClick={() => setTab("screenshots")}
                  >
                    <Camera size={14} />
                    {t("instancePage.showAll")}
                  </button>
                </div>
                <div className="instance-screenshots-preview__grid">
                  {screenshots.slice(0, 3).map((s) => (
                    <div
                      key={s.name}
                      className="instance-screenshots-preview__thumb"
                      onClick={() => {
                        setActiveScreenshot(s);
                        setTab("screenshots");
                      }}
                    >
                      <ScreenshotPreviewThumb
                        instanceId={instance.id}
                        name={s.name}
                      />
                      <span>{s.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="instance-overview__side">

            <section className="instance-section instance-server-spotlight">
              <div className="instance-section__head">
                <div>
                  <p>{t("instancePage.server.eyebrow")}</p>
                  <h2>{t("instancePage.server.quickJoin")}</h2>
                </div>
              </div>
              {selectedServer ? (
                <>
                  <div className="instance-server-spotlight__name">
                    <span>
                      <Server size={17} />
                    </span>
                    <div>
                      <strong>{selectedServer.name}</strong>
                      <small>{selectedServer.address}</small>
                    </div>
                  </div>
                  <ServerStatusLine
                    status={serverStatuses[selectedServer.id]}
                    checking={checkingServer === selectedServer.id}
                    t={t}
                  />
                  <div className="instance-server-spotlight__actions">
                    <button
                      className="button button--mini"
                      onClick={() => void checkServer(selectedServer)}
                    >
                      <Wifi size={14} />
                      {t("instancePage.server.check")}
                    </button>
                    <button
                      className="button button--mini button--accent"
                      onClick={() => void launchServer(selectedServer)}
                    >
                      <Play size={14} fill="currentColor" />
                      {t("instancePage.server.join")}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="instance-add-server-cta"
                  onClick={() => setTab("servers")}
                >
                  <Plus size={17} />
                  <span>
                    <strong>{t("instancePage.server.addFirst")}</strong>
                    <small>{t("instancePage.server.addFirstHint")}</small>
                  </span>
                </button>
              )}
            </section>

            <section className="instance-section instance-session-score">
              <div>
                <strong>{instanceSessions.length}</strong>
                <span>{t("instancePage.sessions.total")}</span>
              </div>
              <div>
                <strong>{successfulSessions}</strong>
                <span>{t("instancePage.sessions.successful")}</span>
              </div>
              <small>
                {latestSession
                  ? t("instancePage.sessions.latest", {
                      date: new Intl.DateTimeFormat(locale, {
                        day: "numeric",
                        month: "short",
                      }).format(new Date(latestSession.endedAt)),
                    })
                  : t("instancePage.sessions.none")}
              </small>
            </section>
          </aside>
        </div>
      )}

      {tab === "servers" && (
        <div className="instance-servers-layout">
          <section className="instance-section">
            <div className="instance-section__head">
              <div>
                <p>{t("instancePage.server.eyebrow")}</p>
                <h2>{t("instancePage.server.list")}</h2>
              </div>
              <small>{t("instancePage.server.count", { count: servers.length })}</small>
            </div>
            {servers.length ? (
              <div className="instance-server-list">
                {servers.map((server) => {
                  const status = serverStatuses[server.id];
                  const selected = server.id === selectedServerId;
                  return (
                    <article
                      className={`instance-server-row ${
                        selected ? "is-selected" : ""
                      }`}
                      key={server.id}
                    >
                      <span className="instance-server-row__icon">
                        <Server size={18} />
                        <i className={status?.online ? "is-online" : ""} />
                      </span>
                      <div className="instance-server-row__copy">
                        <strong>
                          {server.name}
                          {selected && (
                            <em>{t("instancePage.server.quickBadge")}</em>
                          )}
                        </strong>
                        <small>{server.address}</small>
                        <ServerStatusLine
                          status={status}
                          checking={checkingServer === server.id}
                          t={t}
                        />
                      </div>
                      <div className="instance-server-row__actions">
                        {!selected && (
                          <button
                            className="button button--mini"
                            disabled={serverBusy}
                            onClick={() => void selectServer(server.id)}
                          >
                            <Check size={14} />
                            {t("instancePage.server.makeQuick")}
                          </button>
                        )}
                        <button
                          className="button button--mini"
                          disabled={checkingServer === server.id}
                          onClick={() => void checkServer(server)}
                        >
                          {checkingServer === server.id ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Wifi size={14} />
                          )}
                          {t("instancePage.server.check")}
                        </button>
                        <button
                          className="button button--mini button--accent"
                          disabled={serverBusy}
                          onClick={() => void launchServer(server)}
                        >
                          <Play size={14} fill="currentColor" />
                          {t("instancePage.server.join")}
                        </button>
                        <button
                          className="icon-button icon-button--quiet"
                          aria-label={t("content.delete")}
                          disabled={serverBusy}
                          onClick={() => void removeServer(server.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyLine text={t("instancePage.server.empty")} />
            )}
          </section>

          <aside className="instance-section instance-server-form">
            <div className="instance-section__head">
              <div>
                <p>{t("instancePage.server.newEyebrow")}</p>
                <h2>{t("instancePage.server.new")}</h2>
              </div>
            </div>
            <label>
              <span>{t("instancePage.server.name")}</span>
              <input
                value={serverName}
                maxLength={48}
                placeholder={t("instancePage.server.namePlaceholder")}
                onChange={(event) => setServerName(event.target.value)}
              />
            </label>
            <label>
              <span>{t("instancePage.server.address")}</span>
              <input
                value={serverAddress}
                maxLength={320}
                spellCheck={false}
                placeholder="play.example.org:25565"
                onChange={(event) => setServerAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addServer();
                }}
              />
            </label>
            <p>{t("instancePage.server.formHint")}</p>
            <button
              className="button button--primary"
              disabled={!serverAddress.trim() || serverBusy}
              onClick={() => void addServer()}
            >
              {serverBusy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Plus size={15} />
              )}
              {t("instancePage.server.add")}
            </button>
          </aside>
        </div>
      )}

      {tab === "content" && (
        <section className="instance-section instance-content-section">
          <div className="instance-section__head">
            <div>
              <p>{t("instancePage.content.eyebrow")}</p>
              <h2>{t("instancePage.content.title")}</h2>
            </div>
            <div className="instance-content-head-actions">
              {contentKind === "mods" && (
                <>
                  <button
                    className={`button button--mini ${
                      profilesOpen ? "button--secondary is-active" : "button--secondary"
                    }`}
                    onClick={() => setProfilesOpen(!profilesOpen)}
                    title={t("instancePage.profiles.toggle")}
                  >
                    <Layers3 size={14} />
                    {t("instancePage.profiles.toggle")}
                    {modProfiles.length > 0 && <small>{modProfiles.length}</small>}
                  </button>
                  <button
                    className="button button--mini"
                    disabled={contentBusy}
                    onClick={() => void loadContent(true)}
                  >
                    <RefreshCw size={14} />
                    {t("instancePage.content.check")}
                    {updates > 0 && <i>{updates}</i>}
                  </button>
                </>
              )}
              <button
                className="button button--mini"
                onClick={() => onOpenFolder(instance)}
                title={t("instancePage.actions.folder")}
              >
                <FolderOpen size={14} />
                {t("instancePage.actions.folder")}
              </button>
              <button
                className="button button--mini button--accent"
                onClick={() => onDiscover(instance)}
              >
                <Plus size={14} />
                {t("instancePage.content.add")}
              </button>
            </div>
          </div>
          <div className="instance-content-toolbar">
            <div className="instance-content-tabs">
              {(
                [
                  ["mods", Package, t("content.mods")],
                  ["resourcepacks", Image, t("content.resources")],
                  ["shaderpacks", Sparkles, t("content.shaders")],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  className={contentKind === id ? "is-active" : ""}
                  key={id}
                  onClick={() => {
                    setContentKind(id);
                    setContentQuery("");
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            <label className="input-shell input-shell--search">
              <Search size={15} />
              <input
                ref={contentSearchRef}
                value={contentQuery}
                placeholder={t("instancePage.content.search")}
                onChange={(event) => setContentQuery(event.target.value)}
              />
            </label>
          </div>
          {contentKind === "mods" && profilesOpen && (
            <section className="instance-mod-profiles">
              <div className="instance-mod-profiles__head">
                <span>
                  <Layers3 size={18} />
                </span>
                <div>
                  <strong>{t("instancePage.profiles.title")}</strong>
                  <p>{t("instancePage.profiles.description")}</p>
                </div>
                <small>
                  {t("instancePage.profiles.count", {
                    count: modProfiles.length,
                  })}
                </small>
              </div>
              <form
                className="instance-mod-profiles__create"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveCurrentModProfile();
                }}
              >
                <label className="input-shell">
                  <Layers3 size={14} />
                  <input
                    value={modProfileName}
                    maxLength={48}
                    placeholder={t("instancePage.profiles.placeholder")}
                    onChange={(event) =>
                      setModProfileName(event.target.value)
                    }
                  />
                </label>
                <button
                  className="button button--mini button--accent"
                  type="submit"
                  disabled={
                    !modProfileName.trim() ||
                    Boolean(modProfileBusy) ||
                    Boolean(bisect) ||
                    contentBusy ||
                    instance.status === "running"
                  }
                >
                  {modProfileBusy === "new" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {t("instancePage.profiles.save")}
                </button>
              </form>
              {modProfiles.length > 0 && (
                <div className="instance-mod-profiles__list">
                  {modProfiles.map((profile) => (
                    <article
                      className={`instance-mod-profile ${
                        profile.matchesCurrent ? "is-active" : ""
                      }`}
                      key={profile.id}
                    >
                      <div className="instance-mod-profile__copy">
                        <strong>
                          {profile.name}
                          {profile.matchesCurrent && (
                            <em>{t("instancePage.profiles.active")}</em>
                          )}
                        </strong>
                        <small>
                          {t("instancePage.profiles.mods", {
                            enabled: profile.enabledCount,
                            total: profile.modCount,
                          })}
                          {!profile.matchesCurrent &&
                            Boolean(
                              profile.changeCount || profile.missingCount,
                            ) && (
                              <>
                                {" · "}
                                {t("instancePage.profiles.difference", {
                                  changed: profile.changeCount || 0,
                                  missing: profile.missingCount || 0,
                                })}
                              </>
                            )}
                          {" · "}
                          {new Intl.DateTimeFormat(locale, {
                            day: "2-digit",
                            month: "short",
                          }).format(new Date(profile.updatedAt))}
                        </small>
                      </div>
                      <div className="instance-mod-profile__actions">
                        <button
                          className="button button--mini button--accent"
                          disabled={
                            Boolean(modProfileBusy) ||
                            Boolean(bisect) ||
                            instance.status === "running" ||
                            profile.matchesCurrent
                          }
                          onClick={() =>
                            void applySavedModProfile(profile)
                          }
                        >
                          {modProfileBusy === profile.id ? (
                            <LoaderCircle className="spin" size={13} />
                          ) : (
                            <Check size={13} />
                          )}
                          {profile.matchesCurrent
                            ? t("instancePage.profiles.active")
                            : t("instancePage.profiles.apply")}
                        </button>
                        <button
                          className="icon-button icon-button--quiet"
                          aria-label={t("instancePage.profiles.refresh")}
                          title={t("instancePage.profiles.refresh")}
                          disabled={
                            Boolean(modProfileBusy) ||
                            Boolean(bisect) ||
                            instance.status === "running"
                          }
                          onClick={() =>
                            void saveCurrentModProfile(profile)
                          }
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          className={`icon-button icon-button--quiet ${
                            deleteModProfileId === profile.id
                              ? "is-danger"
                              : ""
                          }`}
                          aria-label={
                            deleteModProfileId === profile.id
                              ? t("instancePage.profiles.confirmDelete")
                              : t("instancePage.profiles.delete")
                          }
                          title={
                            deleteModProfileId === profile.id
                              ? t("instancePage.profiles.confirmDelete")
                              : t("instancePage.profiles.delete")
                          }
                          disabled={Boolean(modProfileBusy)}
                          onClick={() =>
                            void removeSavedModProfile(profile)
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {contentBusy ? (
            <div className="instance-page-loading">
              <LoaderCircle className="spin" size={18} />
              {t("instancePage.content.loading")}
            </div>
          ) : filteredContent.length ? (
            <div className="instance-content-list">
              {filteredContent.map((item) => (
                <article
                  className={`instance-content-row ${
                    item.enabled ? "" : "is-disabled"
                  }`}
                  key={item.path}
                >
                  <span>
                    {contentKind === "mods" ? (
                      <Package size={17} />
                    ) : contentKind === "resourcepacks" ? (
                      <Image size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {formatBytes(item.size, locale)} ·{" "}
                      {item.enabled
                        ? t("content.enabled")
                        : t("content.disabled")}
                    </small>
                  </div>
                  {item.update && (
                    <em>
                      {t("instancePage.content.updateTo", {
                        version: item.update.versionNumber,
                      })}
                    </em>
                  )}
                  <div className="instance-content-row__actions">
                    {item.update && (
                      <button
                        className="button button--mini button--accent"
                        disabled={contentAction === item.path}
                        onClick={() => void updateContent(item)}
                      >
                          <RefreshCw size={13} />
                        {t("instancePage.content.updateAction")}
                      </button>
                    )}
                    <button
                      className="button button--mini"
                      disabled={contentAction === item.path}
                      onClick={() => void toggleContent(item)}
                    >
                      {item.enabled
                        ? t("content.disable")
                        : t("content.enable")}
                    </button>
                    <button
                      className="icon-button icon-button--quiet"
                      aria-label={t("content.delete")}
                      disabled={contentAction === item.path}
                      onClick={() => void deleteContent(item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyLine text={t("instancePage.content.empty")} />
          )}

          {contentKind === "mods" && contentHistory.length > 0 && (
            <div className="instance-inline-history">
              <div className="instance-section__head">
                <div>
                  <p>{t("instancePage.content.historyEyebrow")}</p>
                  <h2>{t("instancePage.content.history")}</h2>
                </div>
              </div>
              {contentHistory.slice(0, 5).map((entry) => (
                <div className="instance-inline-history__row" key={entry.id}>
                  <span>
                    <History size={15} />
                  </span>
                  <div>
                    <strong>{entry.previousName}</strong>
                    <small>
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(entry.createdAt))}
                    </small>
                  </div>
                  <button
                    className="button button--mini"
                    disabled={
                      Boolean(entry.rolledBackAt) ||
                      contentAction === entry.id
                    }
                    onClick={() => void rollbackContent(entry)}
                  >
                    <RotateCcw size={13} />
                    {entry.rolledBackAt
                      ? t("instancePage.content.restored")
                      : t("content.history.rollback")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "screenshots" && (
        <section className="instance-section instance-screenshots-section">
          <div className="instance-section__head">
            <div>
              <p>{t("instancePage.tab.screenshots").toUpperCase()}</p>
              <h2>{t("instancePage.tab.screenshots")}</h2>
            </div>
            <div className="instance-section__actions">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void loadScreenshots()}
                disabled={loadingScreenshots}
              >
                <RefreshCw
                  size={14}
                  className={loadingScreenshots ? "is-spinning" : ""}
                />
                {t("instancePage.screenshots.refresh")}
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() =>
                  void window.onyx.state.openInstanceFolder(instance.id)
                }
              >
                <FolderOpen size={14} />
                {t("instancePage.screenshots.openFolder")}
              </button>
            </div>
          </div>

          {loadingScreenshots && screenshots.length === 0 ? (
            <div className="instance-screenshots-empty">
              <LoaderCircle size={28} className="spin" />
            </div>
          ) : screenshots.length === 0 ? (
            <div className="instance-screenshots-empty">
              <Camera size={40} />
              <strong>{t("instancePage.screenshots.empty.title")}</strong>
              <p>{t("instancePage.screenshots.empty.description")}</p>
            </div>
          ) : (
            <div className="instance-screenshots-grid">
              {screenshots.map((s) => (
                <ScreenshotCard
                  key={s.name}
                  screenshot={s}
                  instanceId={instance.id}
                  onSelect={() => setActiveScreenshot(s)}
                  onCopy={() => void handleCopyScreenshot(s)}
                  onShow={() => void handleShowScreenshot(s)}
                  onDelete={() => void handleDeleteScreenshot(s)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "diagnostics" && (
        <div className="instance-diagnostics-layout">
          <div className="instance-diagnostics-nav">
            <button
              className={diagnosticTab === "performance" ? "is-active" : ""}
              onClick={() => setDiagnosticTab("performance")}
            >
              <Activity size={14} />
              {t("instancePage.diagnostics.sub.performance")}
            </button>
            <button
              className={diagnosticTab === "bisect" ? "is-active" : ""}
              onClick={() => setDiagnosticTab("bisect")}
            >
              <Bug size={14} />
              {t("instancePage.diagnostics.sub.bisect")}
              {bisect && <small className="badge-pulse">Active</small>}
            </button>
            <button
              className={diagnosticTab === "storage" ? "is-active" : ""}
              onClick={() => {
                setDiagnosticTab("storage");
                void loadStorage();
              }}
            >
              <HardDrive size={14} />
              {t("instancePage.diagnostics.sub.storage")}
            </button>
            <button
              className={diagnosticTab === "snapshots" ? "is-active" : ""}
              onClick={() => setDiagnosticTab("snapshots")}
            >
              <Archive size={14} />
              {t("instancePage.diagnostics.sub.snapshots")}
              {worldSnapshots.length > 0 && (
                <small>{worldSnapshots.length}</small>
              )}
            </button>
            <button
              className={diagnosticTab === "activity" ? "is-active" : ""}
              onClick={() => setDiagnosticTab("activity")}
            >
              <History size={14} />
              {t("instancePage.diagnostics.sub.activity")}
              {instanceSessions.length > 0 && (
                <small>{instanceSessions.length}</small>
              )}
            </button>
          </div>

          {diagnosticTab === "performance" && (
            <div className="instance-performance-layout">
          <section
            className={`instance-section instance-performance-capture ${
              instance.settings?.recordFps ? "is-enabled" : ""
            }`}
            data-capture-target="fps-recording-control"
          >
            <span className="instance-performance-capture__icon">
              <Activity size={18} />
            </span>
            <div className="instance-performance-capture__copy">
              <strong>
                {t("instancePage.performance.fpsControl")}
                <em>
                  {instance.settings?.recordFps
                    ? t("instancePage.performance.fpsOn")
                    : t("instancePage.performance.fpsOff")}
                </em>
              </strong>
              <small>
                {!fpsRecorderStatus
                  ? t("instanceSettings.fpsChecking")
                  : fpsRecorderStatus.available
                    ? t("instanceSettings.fpsReady", {
                        provider: fpsRecorderStatus.name || "FPS",
                      })
                    : t("instanceSettings.fpsUnavailable", {
                        provider:
                          fpsRecorderStatus.platform === "linux"
                            ? "MangoHud"
                            : "Scope Probe",
                      })}
              </small>
              {fpsRecorderStatus &&
                !fpsRecorderStatus.available &&
                fpsRecorderStatus.installHint && (
                  <p>{fpsRecorderStatus.installHint}</p>
                )}
            </div>
            <button
              className={`button button--mini ${
                instance.settings?.recordFps
                  ? "button--accent"
                  : ""
              }`}
              role="switch"
              aria-checked={Boolean(instance.settings?.recordFps)}
              disabled={
                fpsSettingBusy || instance.status === "running"
              }
              onClick={() => void toggleFpsRecording()}
            >
              {fpsSettingBusy ? (
                <LoaderCircle className="spin" size={14} />
              ) : instance.settings?.recordFps ? (
                <Check size={14} />
              ) : (
                <Activity size={14} />
              )}
              {instance.settings?.recordFps
                ? t("instancePage.performance.disableFps")
                : t("instancePage.performance.enableFps")}
            </button>
          </section>
          {latestPerformance?.available ? (
            <>
              <section className="instance-section instance-performance-hero">
                <div className="instance-section__head">
                  <div>
                    <p>{t("instancePage.performance.eyebrow")}</p>
                    <h2>
                      {selectedPerformanceSession
                        ? t("instancePage.performance.selectedTitle")
                        : t("instancePage.performance.title")}
                    </h2>
                  </div>
                  <div className="instance-performance-head-actions">
                    <button
                      className="button button--mini"
                      onClick={handleExportPerformanceCsv}
                    >
                      <Download size={13} />
                      {t("instancePage.performance.exportCsv")}
                    </button>
                    {selectedPerformanceSession && (
                      <button
                        className="button button--mini"
                        onClick={() =>
                          setSelectedPerformanceSessionId(null)
                        }
                      >
                        <RotateCcw size={13} />
                        {t("instancePage.performance.showLatest")}
                      </button>
                    )}
                    <span className="instance-performance-live">
                      <Activity size={13} />
                      {currentPerformanceSession
                        ? formatSessionDate(
                            currentPerformanceSession,
                            locale,
                          )
                        : t("instancePage.performance.recorded")}
                    </span>
                  </div>
                </div>
                <div
                  className={`instance-performance-stats ${
                    latestPerformance.fps?.available ? "has-fps" : ""
                  }`}
                >
                  <PerformanceMetric
                    icon={MemoryStick}
                    label={t("instancePage.performance.peakRam")}
                    value={formatBytes(
                      latestPerformance.peakRssBytes,
                      locale,
                    )}
                    hint={t("instancePage.performance.averageRam", {
                      value: formatBytes(
                        latestPerformance.averageRssBytes,
                        locale,
                      ),
                    })}
                  />
                  <PerformanceMetric
                    icon={Cpu}
                    label={t("instancePage.performance.averageCpu")}
                    value={`${latestPerformance.averageCpuPercent.toFixed(
                      1,
                    )}%`}
                    hint={t("instancePage.performance.peakCpu", {
                      value: latestPerformance.peakCpuPercent.toFixed(1),
                    })}
                  />
                  <PerformanceMetric
                    icon={Timer}
                    label={t("instancePage.performance.startup")}
                    value={
                      latestPerformance.startupMs == null
                        ? "—"
                        : formatDurationMs(latestPerformance.startupMs)
                    }
                    hint={
                      latestPerformance.worldReadyMs == null
                        ? t("instancePage.performance.noWorldTime")
                        : t("instancePage.performance.worldReady", {
                            value: formatDurationMs(
                              latestPerformance.worldReadyMs,
                            ),
                          })
                    }
                  />
                  <PerformanceMetric
                    icon={Gauge}
                    label={t("instancePage.performance.recommended")}
                    value={`${latestPerformance.recommendedMemoryGiB} GB`}
                    hint={t("instancePage.performance.gc", {
                      count: latestPerformance.gcEvents,
                      pause: latestPerformance.maxGcPauseMs.toFixed(0),
                    })}
                  />
                  {latestPerformance.fps?.available && (
                    <>
                      <PerformanceMetric
                        icon={Activity}
                        label={t(
                          "instancePage.performance.averageFps",
                        )}
                        value={`${Math.round(
                          latestPerformance.fps.averageFps || 0,
                        )} FPS`}
                        hint={t(
                          "instancePage.performance.fpsProvider",
                          {
                            provider:
                              latestPerformance.fps.provider ===
                              "mangohud"
                                ? "MangoHud"
                                : "Scope Probe",
                          },
                        )}
                      />
                      <PerformanceMetric
                        icon={Gauge}
                        label={t(
                          "instancePage.performance.onePercentLow",
                        )}
                        value={`${Math.round(
                          latestPerformance.fps.onePercentLowFps || 0,
                        )} FPS`}
                        hint={t(
                          "instancePage.performance.frameTimeP99",
                          {
                            value: (
                              latestPerformance.fps.frameTimeP99Ms || 0
                            ).toFixed(1),
                          },
                        )}
                      />
                    </>
                  )}
                </div>
                <PerformanceChart
                  performance={latestPerformance}
                  allocatedMemoryGiB={
                    instance.settings?.memory || 6
                  }
                  locale={locale}
                  t={t}
                />
                {latestPerformance.fps?.available && (
                  <FpsChart fps={latestPerformance.fps} t={t} />
                )}
                {latestPerformance.fps?.requested &&
                  !latestPerformance.fps.available && (
                    <div className="instance-fps-unavailable">
                      <span>
                        <CircleAlert size={16} />
                      </span>
                      <div>
                        <strong>
                          {t(
                            "instancePage.performance.fpsUnavailable",
                          )}
                        </strong>
                        <small>
                          {latestPerformance.fps.error ===
                          "provider-unavailable"
                            ? t(
                                "instancePage.performance.fpsProviderMissing",
                              )
                            : t(
                                "instancePage.performance.fpsNoData",
                              )}
                        </small>
                      </div>
                      <button
                        className="button button--mini"
                        onClick={() => onSettings(instance)}
                      >
                        <Settings2 size={13} />
                        {t("instancePage.quick.settings")}
                      </button>
                    </div>
                  )}
              </section>

              <aside className="instance-section instance-performance-insights">
                <div className="instance-section__head">
                  <div>
                    <p>{t("instancePage.performance.analysisEyebrow")}</p>
                    <h2>{t("instancePage.performance.analysis")}</h2>
                  </div>
                </div>
                <div className="instance-insight-list">
                  {latestPerformance.insights.map((insight) => (
                    <article
                      className={`is-${insight.severity}`}
                      key={insight.code}
                    >
                      <span>
                        {insight.severity === "error" ? (
                          <CircleAlert size={16} />
                        ) : insight.severity === "warning" ? (
                          <Gauge size={16} />
                        ) : (
                          <ShieldCheck size={16} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {performanceInsightTitle(insight.code, t)}
                        </strong>
                        <p>
                          {performanceInsightText(
                            insight.code,
                            insight.value,
                            locale,
                            t,
                          )}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </aside>

              {baselineSession?.performance && (
                <section
                  className="instance-section instance-performance-comparison"
                  data-capture-target="performance-comparison"
                >
                  <div className="instance-section__head">
                    <div>
                      <p>
                        {t(
                          "instancePage.performance.comparisonEyebrow",
                        )}
                      </p>
                      <h2>
                        {t("instancePage.performance.comparison")}
                      </h2>
                    </div>
                    <div className="instance-comparison-actions">
                      <span>
                        <Pin size={12} />
                        {baselineIsPinned
                          ? t(
                              "instancePage.performance.baselinePinned",
                            )
                          : selectedPerformanceSession
                            ? t(
                                "instancePage.performance.comparisonSession",
                              )
                          : t(
                              "instancePage.performance.previousBaseline",
                            )}
                      </span>
                      {comparisonReady && (
                        <button
                          className="button button--mini"
                          onClick={() => void copyPerformanceReport()}
                        >
                          <ClipboardCopy size={13} />
                          {t(
                            "instancePage.performance.copyReport",
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  {comparisonReady &&
                  currentPerformanceSession?.performance ? (
                    <div className="instance-comparison-grid">
                      <ComparisonMetric
                        label={t(
                          "instancePage.performance.averageFps",
                        )}
                        current={
                          currentPerformanceSession.performance.fps
                            ?.averageFps
                        }
                        baseline={
                          baselineSession.performance.fps?.averageFps
                        }
                        format={(value) =>
                          `${Math.round(value)} FPS`
                        }
                        better="higher"
                        t={t}
                      />
                      <ComparisonMetric
                        label={t(
                          "instancePage.performance.onePercentLow",
                        )}
                        current={
                          currentPerformanceSession.performance.fps
                            ?.onePercentLowFps
                        }
                        baseline={
                          baselineSession.performance.fps
                            ?.onePercentLowFps
                        }
                        format={(value) =>
                          `${Math.round(value)} FPS`
                        }
                        better="higher"
                        t={t}
                      />
                      <ComparisonMetric
                        label={t(
                          "instancePage.performance.peakRam",
                        )}
                        current={
                          currentPerformanceSession.performance
                            .peakRssBytes
                        }
                        baseline={
                          baselineSession.performance.peakRssBytes
                        }
                        format={(value) =>
                          formatBytes(value, locale)
                        }
                        better="lower"
                        t={t}
                      />
                      <ComparisonMetric
                        label={t(
                          "instancePage.performance.startup",
                        )}
                        current={
                          currentPerformanceSession.performance
                            .startupMs ?? undefined
                        }
                        baseline={
                          baselineSession.performance.startupMs ??
                          undefined
                        }
                        format={formatDurationMs}
                        better="lower"
                        t={t}
                      />
                    </div>
                  ) : (
                    <div className="instance-comparison-pending">
                      <Activity size={18} />
                      <div>
                        <strong>
                          {t(
                            "instancePage.performance.baselineAwaiting",
                          )}
                        </strong>
                        <small>
                          {t(
                            "instancePage.performance.baselineAwaitingHint",
                          )}
                        </small>
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="instance-section instance-performance-history">
                <div className="instance-section__head">
                  <div>
                    <p>{t("instancePage.performance.historyEyebrow")}</p>
                    <h2>{t("instancePage.performance.history")}</h2>
                  </div>
                  <small>
                    {t("instancePage.performance.sessions", {
                      count: recordedSessions.length,
                    })}
                  </small>
                </div>
                <div className="instance-performance-session-list">
                  {recordedSessions.slice(0, 8).map((session) => (
                    <div
                      className={
                        currentPerformanceSession?.id === session.id
                          ? "is-selected"
                          : ""
                      }
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      data-capture-target={`performance-session-${session.id}`}
                      aria-pressed={
                        currentPerformanceSession?.id === session.id
                      }
                      title={t(
                        "instancePage.performance.inspectSession",
                      )}
                      onClick={() =>
                        setSelectedPerformanceSessionId(
                          session.id === recordedSessions[0]?.id
                            ? null
                            : session.id,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (
                          event.key !== "Enter" &&
                          event.key !== " "
                        ) {
                          return;
                        }
                        event.preventDefault();
                        setSelectedPerformanceSessionId(
                          session.id === recordedSessions[0]?.id
                            ? null
                            : session.id,
                        );
                      }}
                    >
                      <span
                        className={
                          session.exitCode === 0
                            ? "is-success"
                            : "is-error"
                        }
                      >
                        {session.exitCode === 0 ? (
                          <Check size={14} />
                        ) : (
                          <CircleAlert size={14} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(session.endedAt))}
                        </strong>
                        <small>
                          {formatPlaytime(
                            session.durationMinutes,
                            locale,
                          )}
                        </small>
                      </div>
                      <em>
                        {formatBytes(
                          session.performance?.peakRssBytes || 0,
                          locale,
                        )}
                      </em>
                      <em>
                        {(
                          session.performance?.averageCpuPercent || 0
                        ).toFixed(1)}
                        % CPU
                      </em>
                      <em>
                        {session.performance?.fps?.available
                          ? `${Math.round(
                              session.performance.fps.averageFps || 0,
                            )} FPS`
                          : "—"}
                      </em>
                      <em>
                        {session.performance?.startupMs == null
                          ? "—"
                          : formatDurationMs(
                              session.performance.startupMs,
                            )}
                      </em>
                      <button
                        className={`instance-baseline-button ${
                          pinnedBaselineSession?.id === session.id
                            ? "is-active"
                            : ""
                        }`}
                        disabled={baselineBusy}
                        title={
                          pinnedBaselineSession?.id === session.id
                            ? t(
                                "instancePage.performance.unpinBaseline",
                              )
                            : t(
                                "instancePage.performance.pinBaseline",
                              )
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          void setPerformanceBaseline(session.id);
                        }}
                      >
                        <Pin size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className="instance-section instance-performance-empty">
              <span>
                <Activity size={26} />
              </span>
              <h2>{t("instancePage.performance.empty")}</h2>
              <p>{t("instancePage.performance.emptyHint")}</p>
              <button
                className="button button--primary"
                onClick={() => onPlay(instance)}
              >
                <Play size={15} fill="currentColor" />
                {t("instancePage.performance.firstLaunch")}
              </button>
            </section>
          )}
            </div>
          )}

          {diagnosticTab === "bisect" && (
            <section
              className={`instance-section instance-bisect ${
                bisect ? "is-active" : ""
              }`}
            >
              <span className="instance-bisect__icon">
                <GitBranch size={19} />
              </span>
              {!bisect ? (
                <>
                  <div className="instance-bisect__copy">
                    <strong>{t("instancePage.bisect.title")}</strong>
                    <p>{t("instancePage.bisect.description")}</p>
                  </div>
                  <button
                    className="button button--mini"
                    disabled={
                      bisectBusy ||
                      instance.status === "running" ||
                      content.filter((item) => item.enabled).length < 2
                    }
                    onClick={() => void startBisectFlow()}
                  >
                    {bisectBusy ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Bug size={14} />
                    )}
                    {t("instancePage.bisect.start")}
                  </button>
                </>
              ) : bisect.status === "found" ? (
                <>
                  <div className="instance-bisect__copy">
                    <small>{t("instancePage.bisect.foundEyebrow")}</small>
                    <strong>{bisect.culprit}</strong>
                    <p>{t("instancePage.bisect.foundHint")}</p>
                  </div>
                  <div className="instance-bisect__actions">
                    <button
                      className="button button--mini button--accent"
                      disabled={bisectBusy}
                      onClick={() => void finishBisectFlow(true)}
                    >
                      <Bug size={14} />
                      {t("instancePage.bisect.disable")}
                    </button>
                    <button
                      className="button button--mini"
                      disabled={bisectBusy}
                      onClick={() => void finishBisectFlow(false)}
                    >
                      {t("instancePage.bisect.keep")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="instance-bisect__copy">
                    <small>
                      {t("instancePage.bisect.round", {
                        round: bisect.round,
                        count: bisect.candidates.length,
                      })}
                    </small>
                    <strong>
                      {t("instancePage.bisect.testing", {
                        count: bisect.testing.length,
                      })}
                    </strong>
                    <p>{t("instancePage.bisect.testingHint")}</p>
                  </div>
                  <div className="instance-bisect__actions">
                    <button
                      className="button button--mini button--accent"
                      disabled={bisectBusy || instance.status === "running"}
                      onClick={() => onPlay(instance)}
                    >
                      <Play size={13} fill="currentColor" />
                      {t("instancePage.bisect.testLaunch")}
                    </button>
                    <button
                      className="button button--mini"
                      disabled={bisectBusy || instance.status === "running"}
                      onClick={() => void reportBisectFlow(true)}
                    >
                      <Check size={13} />
                      {t("instancePage.bisect.started")}
                    </button>
                    <button
                      className="button button--mini"
                      disabled={bisectBusy || instance.status === "running"}
                      onClick={() => void reportBisectFlow(false)}
                    >
                      <CircleAlert size={13} />
                      {t("instancePage.bisect.crashed")}
                    </button>
                    <button
                      className="icon-button icon-button--quiet"
                      aria-label={t("instancePage.bisect.cancel")}
                      disabled={bisectBusy || instance.status === "running"}
                      onClick={() => void cancelBisectFlow()}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {diagnosticTab === "storage" && (
            <section className="instance-section instance-storage">
              <div className="instance-section__head">
                <div>
                  <p>{t("instancePage.storage.eyebrow")}</p>
                  <h2>{t("instancePage.storage.title")}</h2>
                </div>
                <button
                  className="icon-button icon-button--quiet"
                  aria-label={t("instancePage.storage.refresh")}
                  title={t("instancePage.storage.refresh")}
                  disabled={storageBusy}
                  onClick={() => void loadStorage(true)}
                >
                  <RefreshCw
                    className={storageBusy ? "spin" : ""}
                    size={14}
                  />
                </button>
              </div>
              {storageBusy && !storageReport ? (
                <div className="instance-storage__loading">
                  <LoaderCircle className="spin" size={16} />
                  {t("instancePage.storage.loading")}
                </div>
              ) : storageReport ? (
                <>
                  <div className="instance-storage__total">
                    <span>
                      <HardDrive size={18} />
                    </span>
                    <div>
                      <strong>
                        {formatBytes(storageReport.totalBytes, locale)}
                      </strong>
                      <small>
                        {t("instancePage.storage.files", {
                          files: storageReport.totalFiles,
                          folders: storageReport.totalDirectories,
                        })}
                      </small>
                    </div>
                  </div>
                  {storageReport.totalBytes > 0 && (
                    <div
                      className="instance-storage__bar"
                      aria-label={t("instancePage.storage.breakdown")}
                    >
                      {storageReport.categories
                        .filter((category) => category.bytes > 0)
                        .map((category) => (
                          <span
                            className={`is-${category.id}`}
                            key={category.id}
                            title={`${t(
                              STORAGE_CATEGORY_LABELS[category.id],
                            )}: ${formatBytes(category.bytes, locale)}`}
                            style={{
                              width: `${
                                (category.bytes /
                                  storageReport.totalBytes) *
                                100
                              }%`,
                            }}
                          />
                        ))}
                    </div>
                  )}
                  <div className="instance-storage__categories">
                    {storageReport.categories
                      .slice()
                      .sort((left, right) => right.bytes - left.bytes)
                      .slice(0, 6)
                      .map((category) => (
                        <div key={category.id}>
                          <i className={`is-${category.id}`} />
                          <span>
                            {t(STORAGE_CATEGORY_LABELS[category.id])}
                          </span>
                          <strong>
                            {formatBytes(category.bytes, locale)}
                          </strong>
                        </div>
                      ))}
                  </div>
                  <div
                    className={`instance-storage__cleanup ${
                      storageReport.cleanable.files > 0
                        ? "has-files"
                        : ""
                    }`}
                  >
                    <div>
                      <strong>
                        {storageReport.cleanable.files > 0
                          ? t("instancePage.storage.cleanable", {
                              size: formatBytes(
                                storageReport.cleanable.bytes,
                                locale,
                              ),
                            })
                          : t("instancePage.storage.clean")}
                      </strong>
                      <small>
                        {storageReport.cleanable.files > 0
                          ? t("instancePage.storage.cleanableHint", {
                              files: storageReport.cleanable.files,
                            })
                          : t("instancePage.storage.cleanHint")}
                      </small>
                    </div>
                    {storageReport.cleanable.files > 0 && (
                      <button
                        className={`button button--mini ${
                          storageCleanupConfirm ? "button--danger" : ""
                        }`}
                        disabled={
                          storageBusy || instance.status === "running"
                        }
                        onClick={() => void cleanupStorage()}
                      >
                        {storageBusy ? (
                          <LoaderCircle className="spin" size={13} />
                        ) : (
                          <Trash2 size={13} />
                        )}
                        {storageCleanupConfirm
                          ? t("instancePage.storage.confirm")
                          : t("instancePage.storage.cleanup")}
                      </button>
                    )}
                  </div>
                  {storageReport.inaccessible > 0 && (
                    <small className="instance-storage__warning">
                      <CircleAlert size={12} />
                      {t("instancePage.storage.inaccessible", {
                        count: storageReport.inaccessible,
                      })}
                    </small>
                  )}
                </>
              ) : null}
            </section>
          )}

          {diagnosticTab === "snapshots" && (
            <section className="instance-section instance-world-guard">
              <div className="instance-section__head">
                <div>
                  <p>{t("instancePage.worlds.eyebrow")}</p>
                  <h2>{t("instancePage.worlds.title")}</h2>
                </div>
                <button
                  className="button button--mini"
                  disabled={worldBusy || instance.status === "running"}
                  onClick={() => void createWorldSnapshot()}
                >
                  {worldBusy ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Archive size={14} />
                  )}
                  {t("instancePage.worlds.create")}
                </button>
              </div>
              <p className="instance-world-guard__hint">
                <ShieldCheck size={15} />
                {t("instancePage.worlds.hint")}
              </p>
              {worldSnapshots.length ? (
                <div className="instance-world-list">
                  {worldSnapshots.slice(0, 8).map((snapshot) => (
                    <div className="instance-world-row" key={snapshot.id}>
                      <span>
                        <Archive size={15} />
                      </span>
                      <div>
                        <strong>
                          {worldReason(snapshot.reason, t)}
                        </strong>
                        <small>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(snapshot.createdAt))}
                          {" · "}
                          {t("instancePage.worlds.count", {
                            count: snapshot.worlds.length,
                          })}
                          {" · "}
                          {formatBytes(snapshot.bytes, locale)}
                        </small>
                      </div>
                      <button
                        className={`button button--mini ${
                          restoreSnapshotId === snapshot.id
                            ? "button--danger"
                            : ""
                        }`}
                        disabled={
                          worldBusy || instance.status === "running"
                        }
                        onClick={() =>
                          void restoreWorldSnapshot(snapshot)
                        }
                      >
                        <RotateCcw size={13} />
                        {restoreSnapshotId === snapshot.id
                          ? t("instancePage.worlds.confirm")
                          : t("instancePage.worlds.restore")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyLine text={t("instancePage.worlds.noSnapshots")} />
              )}
            </section>
          )}

          {diagnosticTab === "activity" && (
            <section className="instance-section instance-activity-section">
              <div className="instance-section__head">
                <div>
                  <p>{t("instancePage.activity.eyebrow")}</p>
                  <h2>{t("instancePage.activity.title")}</h2>
                </div>
                <small>
                  {t("instancePage.sessions.count", {
                    count: instanceSessions.length,
                  })}
                </small>
              </div>
              {instanceSessions.length ? (
                <div className="instance-session-list instance-session-list--full">
                  {instanceSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      locale={locale}
                      session={session}
                      t={t}
                    />
                  ))}
                </div>
              ) : (
                <EmptyLine text={t("instancePage.activity.empty")} />
              )}
            </section>
          )}
        </div>
      )}

      {activeScreenshot && (
        <div
          className="screenshot-lightbox-overlay"
          onClick={() => setActiveScreenshot(null)}
        >
          <div
            className="screenshot-lightbox"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="screenshot-lightbox__header">
              <div className="screenshot-lightbox__meta">
                <span className="screenshot-lightbox__title">
                  {activeScreenshot.name}
                </span>
                <span className="screenshot-lightbox__sub">
                  {new Date(activeScreenshot.createdAt).toLocaleString(
                    locale,
                  )}{" "}
                  • {formatBytes(activeScreenshot.size)}
                </span>
              </div>
              <div className="screenshot-lightbox__controls">
                <button
                  type="button"
                  className={`button button--small ${
                    copiedScreenshot ? "button--primary" : "button--ghost"
                  }`}
                  onClick={() => void handleCopyScreenshot(activeScreenshot)}
                  title={t("instancePage.screenshots.copy")}
                >
                  {copiedScreenshot ? (
                    <Check size={14} />
                  ) : (
                    <ClipboardCopy size={14} />
                  )}
                  {copiedScreenshot
                    ? t("instancePage.screenshots.copied")
                    : t("instancePage.screenshots.copy")}
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => void handleShowScreenshot(activeScreenshot)}
                  title={t("instancePage.screenshots.showInFolder")}
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  type="button"
                  className="button button--danger-ghost button--small"
                  onClick={() => void handleDeleteScreenshot(activeScreenshot)}
                  title={t("instancePage.screenshots.delete")}
                >
                  <Trash2 size={14} />
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => setActiveScreenshot(null)}
                  title={t("instancePage.screenshots.close")}
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="screenshot-lightbox__body">
              {screenshots.length > 1 && (
                <button
                  type="button"
                  className="screenshot-lightbox__nav screenshot-lightbox__nav--prev"
                  disabled={
                    screenshots.findIndex(
                      (s) => s.name === activeScreenshot.name,
                    ) <= 0
                  }
                  onClick={() => {
                    const idx = screenshots.findIndex(
                      (s) => s.name === activeScreenshot.name,
                    );
                    if (idx > 0) setActiveScreenshot(screenshots[idx - 1]);
                  }}
                  title={t("instancePage.screenshots.prev")}
                >
                  <ChevronLeft size={24} />
                </button>
              )}

              <div className="screenshot-lightbox__viewport">
                {activeScreenshotData ? (
                  <img
                    src={activeScreenshotData}
                    alt={activeScreenshot.name}
                  />
                ) : (
                  <div className="screenshot-lightbox__loading">
                    <LoaderCircle size={32} className="spin" />
                  </div>
                )}
              </div>

              {screenshots.length > 1 && (
                <button
                  type="button"
                  className="screenshot-lightbox__nav screenshot-lightbox__nav--next"
                  disabled={
                    screenshots.findIndex(
                      (s) => s.name === activeScreenshot.name,
                    ) >=
                    screenshots.length - 1
                  }
                  onClick={() => {
                    const idx = screenshots.findIndex(
                      (s) => s.name === activeScreenshot.name,
                    );
                    if (idx >= 0 && idx < screenshots.length - 1) {
                      setActiveScreenshot(screenshots[idx + 1]);
                    }
                  }}
                  title={t("instancePage.screenshots.next")}
                >
                  <ChevronRight size={24} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <CreatePartyModal
        open={isCreatePartyModalOpen}
        instance={instance}
        initialMode={partyTunnelMode}
        onClose={() => setIsCreatePartyModalOpen(false)}
        onConfirmCreate={async (mode) => {
          await handleConfirmPartyCreate(mode);
        }}
        e4mcStatus={e4mcStatus}
        onInstallE4mc={handleInstallE4mc}
        onConvertVanillaE4mc={handleConvertVanillaE4mc}
        installingE4mc={installingE4mc}
        convertingVanilla={convertingVanilla}
        testingUpnp={testingUpnp}
        onTestUpnp={handleTestUpnp}
        upnpTestResult={upnpTestResult}
        partyCreating={partyCreating}
        isExistingRoom={Boolean(isRoomForThisInstance && partyRoom)}
      />
    </motion.div>
  );
}

function ScreenshotCard({
  screenshot,
  instanceId,
  onSelect,
  onCopy,
  onShow,
  onDelete,
}: {
  screenshot: InstanceScreenshot;
  instanceId: string;
  onSelect: () => void;
  onCopy: () => void;
  onShow: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.onyx.state
      .readScreenshot(instanceId, screenshot.name)
      .then((data: string) => {
        if (!cancelled) setThumb(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [instanceId, screenshot.name]);

  return (
    <div className="screenshot-card" onClick={onSelect}>
      <div className="screenshot-card__thumb">
        {thumb ? (
          <img src={thumb} alt={screenshot.name} loading="lazy" />
        ) : (
          <div className="screenshot-card__skeleton">
            <LoaderCircle size={18} className="spin" />
          </div>
        )}
        <div className="screenshot-card__overlay">
          <button
            type="button"
            className="screenshot-card__action"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            title={t("instancePage.screenshots.copy")}
          >
            <ClipboardCopy size={13} />
          </button>
          <button
            type="button"
            className="screenshot-card__action"
            onClick={(e) => {
              e.stopPropagation();
              onShow();
            }}
            title={t("instancePage.screenshots.showInFolder")}
          >
            <FolderOpen size={13} />
          </button>
          <button
            type="button"
            className="screenshot-card__action screenshot-card__action--danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title={t("instancePage.screenshots.delete")}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="screenshot-card__info">
        <span className="screenshot-card__name" title={screenshot.name}>
          {screenshot.name}
        </span>
        <span className="screenshot-card__date">
          {formatBytes(screenshot.size)}
        </span>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="instance-stat">
      <span>
        <Icon size={16} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function PreviewStat({
  tone,
  value,
  label,
}: {
  tone: "added" | "changed" | "removed" | "download";
  value: string | number;
  label: string;
}) {
  return (
    <div className={`instance-preview-stat is-${tone}`}>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function PerformanceMetric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="instance-performance-metric">
      <span>
        <Icon size={17} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{hint}</em>
      </div>
    </div>
  );
}

function ComparisonMetric({
  label,
  current,
  baseline,
  format,
  better,
  t,
}: {
  label: string;
  current?: number;
  baseline?: number;
  format: (value: number) => string;
  better: "higher" | "lower";
  t: ReturnType<typeof useI18n>["t"];
}) {
  const delta = metricDelta(current, baseline);
  const score =
    delta == null ? 0 : better === "higher" ? delta : -delta;
  const tone =
    delta == null || Math.abs(delta) < 1
      ? "neutral"
      : score > 0
        ? "better"
        : "worse";
  return (
    <article className={`instance-comparison-metric is-${tone}`}>
      <small>{label}</small>
      <div>
        <strong>
          {current == null || !Number.isFinite(current)
            ? "—"
            : format(current)}
        </strong>
        <span>{formatDelta(delta)}</span>
      </div>
      <em>
        {t("instancePage.performance.baselineValue", {
          value:
            baseline == null || !Number.isFinite(baseline)
              ? "—"
              : format(baseline),
        })}
      </em>
    </article>
  );
}

function PerformanceChart({
  performance,
  allocatedMemoryGiB,
  locale,
  t,
}: {
  performance: FlightPerformance;
  allocatedMemoryGiB: number;
  locale: Locale;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const values = performance.timeline;
  if (values.length < 2) {
    return (
      <div className="instance-performance-chart is-empty">
        {t("instancePage.performance.chartPending")}
      </div>
    );
  }
  const width = 700;
  const height = 180;
  const paddingX = 18;
  const paddingY = 16;
  const maxSeconds = Math.max(
    1,
    values[values.length - 1]?.atSeconds || 1,
  );
  const memoryCeiling = Math.max(
    allocatedMemoryGiB * 1024 ** 3,
    performance.peakRssBytes,
    1,
  );
  const cpuCeiling = Math.max(
    100,
    ...values.map((sample) => sample.cpuPercent),
  );
  const point = (index: number, normalized: number) => {
    const x =
      paddingX +
      (index / Math.max(values.length - 1, 1)) *
        (width - paddingX * 2);
    const y =
      height -
      paddingY -
      Math.max(0, Math.min(1, normalized)) *
        (height - paddingY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const memoryPoints = values
    .map((sample, index) =>
      point(index, sample.rssBytes / memoryCeiling),
    )
    .join(" ");
  const cpuPoints = values
    .map((sample, index) =>
      point(index, sample.cpuPercent / cpuCeiling),
    )
    .join(" ");

  return (
    <div className="instance-performance-chart">
      <div className="instance-performance-chart__head">
        <strong>{t("instancePage.performance.timeline")}</strong>
        <div>
          <span className="is-memory">
            <i />
            {t("instancePage.performance.ram")}
          </span>
          <span className="is-cpu">
            <i />
            CPU
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("instancePage.performance.timeline")}
      >
        {[0.25, 0.5, 0.75].map((value) => (
          <line
            className="grid"
            key={value}
            x1={paddingX}
            x2={width - paddingX}
            y1={height - paddingY - value * (height - paddingY * 2)}
            y2={height - paddingY - value * (height - paddingY * 2)}
          />
        ))}
        <polyline className="memory" points={memoryPoints} />
        <polyline className="cpu" points={cpuPoints} />
      </svg>
      <div className="instance-performance-chart__axis">
        <span>0:00</span>
        <span>
          {formatBytes(memoryCeiling, locale)}{" "}
          {t("instancePage.performance.scale")}
        </span>
        <span>{formatDurationMs(maxSeconds * 1_000)}</span>
      </div>
    </div>
  );
}

function FpsChart({
  fps,
  t,
}: {
  fps: NonNullable<FlightPerformance["fps"]>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const values = fps.timeline || [];
  if (values.length < 2) return null;
  const width = 700;
  const height = 150;
  const paddingX = 18;
  const paddingY = 16;
  const maxSeconds = Math.max(
    1,
    values[values.length - 1]?.atSeconds || 1,
  );
  const fpsCeiling = Math.max(
    30,
    Math.ceil(Math.max(...values.map((sample) => sample.fps)) / 30) * 30,
  );
  const points = values
    .map((sample, index) => {
      const x =
        paddingX +
        (index / Math.max(values.length - 1, 1)) *
          (width - paddingX * 2);
      const y =
        height -
        paddingY -
        Math.max(0, Math.min(1, sample.fps / fpsCeiling)) *
          (height - paddingY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="instance-performance-chart instance-fps-chart">
      <div className="instance-performance-chart__head">
        <strong>{t("instancePage.performance.fpsTimeline")}</strong>
        <div>
          <span className="is-fps">
            <i />
            FPS
          </span>
          <span>
            {t("instancePage.performance.stutters", {
              count: fps.stutterCount || 0,
            })}
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("instancePage.performance.fpsTimeline")}
      >
        {[0.25, 0.5, 0.75].map((value) => (
          <line
            className="grid"
            key={value}
            x1={paddingX}
            x2={width - paddingX}
            y1={height - paddingY - value * (height - paddingY * 2)}
            y2={height - paddingY - value * (height - paddingY * 2)}
          />
        ))}
        <polyline className="fps" points={points} />
      </svg>
      <div className="instance-performance-chart__axis">
        <span>0:00</span>
        <span>{fpsCeiling} FPS</span>
        <span>{formatDurationMs(maxSeconds * 1_000)}</span>
      </div>
    </div>
  );
}

function formatDurationMs(value: number) {
  const totalSeconds = Math.max(0, Math.round(value / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function metricDelta(current?: number, baseline?: number) {
  if (
    current == null ||
    baseline == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    baseline === 0
  ) {
    return null;
  }
  return ((current - baseline) / baseline) * 100;
}

function formatDelta(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function formatReportNumber(value: number | undefined, locale: Locale) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSessionDate(session: PlaySession, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(session.endedAt));
}

function performanceInsightTitle(
  code: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (code) {
    case "memory-pressure":
      return t("instancePage.performance.insight.memoryPressure");
    case "memory-overallocated":
      return t("instancePage.performance.insight.memoryOverallocated");
    case "slow-startup":
      return t("instancePage.performance.insight.slowStartup");
    case "long-gc-pause":
      return t("instancePage.performance.insight.longGc");
    case "out-of-memory":
      return t("instancePage.performance.insight.oom");
    case "early-crash":
      return t("instancePage.performance.insight.earlyCrash");
    case "low-fps":
      return t("instancePage.performance.insight.lowFps");
    case "fps-instability":
      return t("instancePage.performance.insight.fpsInstability");
    case "frame-stutters":
      return t("instancePage.performance.insight.frameStutters");
    case "fps-regression":
      return t("instancePage.performance.insight.fpsRegression");
    case "startup-regression":
      return t("instancePage.performance.insight.startupRegression");
    case "memory-regression":
      return t("instancePage.performance.insight.memoryRegression");
    default:
      return t("instancePage.performance.insight.stable");
  }
}

function performanceInsightText(
  code: string,
  value: number,
  locale: Locale,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (code) {
    case "memory-pressure":
      return t("instancePage.performance.insight.memoryPressureText", {
        value: formatBytes(value, locale),
      });
    case "memory-overallocated":
      return t(
        "instancePage.performance.insight.memoryOverallocatedText",
        { value },
      );
    case "slow-startup":
      return t("instancePage.performance.insight.slowStartupText", {
        value: formatDurationMs(value),
      });
    case "long-gc-pause":
      return t("instancePage.performance.insight.longGcText", {
        value: Math.round(value),
      });
    case "out-of-memory":
      return t("instancePage.performance.insight.oomText");
    case "early-crash":
      return t("instancePage.performance.insight.earlyCrashText", {
        value: formatDurationMs(value),
      });
    case "low-fps":
      return t("instancePage.performance.insight.lowFpsText", {
        value: Math.round(value),
      });
    case "fps-instability":
      return t(
        "instancePage.performance.insight.fpsInstabilityText",
        { value: Math.round(value) },
      );
    case "frame-stutters":
      return t("instancePage.performance.insight.frameStuttersText", {
        value: Math.round(value),
      });
    case "fps-regression":
      return t("instancePage.performance.insight.fpsRegressionText", {
        value: formatReportNumber(value, locale),
      });
    case "startup-regression":
      return t(
        "instancePage.performance.insight.startupRegressionText",
        { value: formatReportNumber(value, locale) },
      );
    case "memory-regression":
      return t(
        "instancePage.performance.insight.memoryRegressionText",
        { value: formatReportNumber(value, locale) },
      );
    default:
      return t("instancePage.performance.insight.stableText", {
        value: formatBytes(value, locale),
      });
  }
}


function EmptyLine({ text }: { text: string }) {
  return <div className="instance-empty-line">{text}</div>;
}

function healthLabel(
  status: InstanceHealthStatus | undefined,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (status) {
    case "healthy":
      return t("instancePage.health.healthy");
    case "warning":
      return t("instancePage.health.warning");
    case "repair":
      return t("instancePage.health.repair");
    case "blocked":
      return t("instancePage.health.blocked");
    case "setup":
      return t("instancePage.health.setup");
    default:
      return t("instancePage.health.unknown");
  }
}

function worldReason(
  reason: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (reason === "manual") return t("instancePage.worlds.reason.manual");
  if (reason === "mod-update")
    return t("instancePage.worlds.reason.modUpdate");
  if (reason === "mod-change-launch")
    return t("instancePage.worlds.reason.modLaunch");
  if (reason === "pre-restore")
    return t("instancePage.worlds.reason.restore");
  return t("instancePage.worlds.reason.auto");
}

function SessionRow({
  session,
  locale,
  t,
}: {
  session: PlaySession;
  locale: Locale;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const success = session.exitCode === 0;
  return (
    <article className="instance-session-row">
      <span className={success ? "is-success" : "is-error"}>
        {success ? <Check size={15} /> : <CircleAlert size={15} />}
      </span>
      <div>
        <strong>
          {success
            ? t("instancePage.session.success")
            : t("instancePage.session.failed", {
                code: session.exitCode ?? "—",
              })}
        </strong>
        <small>
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(session.endedAt))}
        </small>
      </div>
      <em>{formatPlaytime(session.durationMinutes, locale)}</em>
    </article>
  );
}

function ServerStatusLine({
  status,
  checking,
  t,
}: {
  status?: MinecraftServerStatus;
  checking: boolean;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (checking) {
    return (
      <span className="instance-server-status">
        <LoaderCircle className="spin" size={12} />
        {t("instancePage.server.checking")}
      </span>
    );
  }
  if (!status) {
    return (
      <span className="instance-server-status">
        <i />
        {t("instancePage.server.notChecked")}
      </span>
    );
  }
  return (
    <span
      className={`instance-server-status ${
        status.online ? "is-online" : "is-offline"
      }`}
      title={status.error || status.motd}
    >
      <i />
      {status.online
        ? t("instancePage.server.online", {
            latency: status.latencyMs ?? 0,
            online: status.playersOnline ?? 0,
            max: status.playersMax ?? 0,
          })
        : status.error || t("instancePage.server.unavailable")}
    </span>
  );
}

function ScreenshotPreviewThumb({
  instanceId,
  name,
}: {
  instanceId: string;
  name: string;
}) {
  const [data, setData] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.onyx.state
      .readScreenshot(instanceId, name)
      .then((d: string) => {
        if (!cancelled) setData(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [instanceId, name]);

  return data ? (
    <img src={data} alt={name} loading="lazy" />
  ) : (
    <div className="screenshot-preview-skeleton" />
  );
}

