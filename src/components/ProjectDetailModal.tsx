import { useDialogFocus } from "../hooks/useDialogFocus";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Box,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  Filter,
  Globe,
  HardDrive,
  Info,
  Layers,
  LoaderCircle,
  MessageSquare,
  Package,
  Search,
  Server,
  Shield,
  Star,
  Tag,
  Users,
  X,
} from "lucide-react";
import { CurseForgeIcon, ModrinthIcon } from "./ProviderIcons";
import { ResourcePack3DViewer } from "./ResourcePack3DViewer";
import { useI18n } from "../i18n";
import type {
  CatalogProject,
  DownloadTask,
  GameInstance,
  ProjectGalleryItem,
  ResourcePackInspectResult,
} from "../types";
import { compactNumber, formatBytes } from "../utils";

export interface ProjectDetailModalProps {
  project: CatalogProject | null;
  onClose: () => void;
  onInstall: (project: CatalogProject, targetInstanceId?: string) => void;
  downloads: DownloadTask[];
  instances?: GameInstance[];
  targetInstanceId?: string | null;
}

interface NormalizedVersion {
  id: string | number;
  name: string;
  versionNumber: string;
  fileName: string;
  fileSize?: number;
  datePublished: string;
  releaseType: "release" | "beta" | "alpha";
  gameVersions: string[];
  loaders: string[];
  downloads?: number;
  downloadUrl?: string | null;
  changelog?: string;
}

interface ProjectDetailsRecord {
  body?: string;
  description?: string;
  wiki_url?: string;
  issues_url?: string;
  source_url?: string;
  discord_url?: string;
  license?: string | { name?: string };
  client_side?: string;
  server_side?: string;
  gallery?: ProjectGalleryItem[];
  game_versions?: string[];
  loaders?: string[];
  links?: {
    wiki?: string;
    issues?: string;
    source?: string;
    discord?: string;
    website?: string;
  };
  raw?: {
    screenshots?: Array<{ url: string; title?: string; description?: string }>;
  };
}

interface CurseForgeFileRecord {
  id: number;
  displayName?: string;
  fileName: string;
  fileLength?: number;
  fileDate: string;
  releaseType?: number;
  gameVersions?: string[];
  downloadUrl?: string | null;
}

interface ModrinthFileRecord {
  primary?: boolean;
  filename: string;
  size?: number;
  url?: string;
}

interface ModrinthVersionRecord {
  id: string;
  name?: string;
  version_number?: string;
  version_type?: "release" | "beta" | "alpha";
  files?: ModrinthFileRecord[];
  game_versions?: string[];
  loaders?: string[];
  downloads?: number;
  date_published: string;
  changelog?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function markdownToHtml(md: string): string {
  if (!md) return "";

  // Check if it already looks like HTML
  const hasHtml = /<\/?(p|div|span|h[1-6]|ul|ol|li|table|tr|td|th|br|a|img)\b/i.test(md);
  if (hasHtml && !md.includes("```") && !md.includes("###")) {
    return md;
  }

  let text = md;

  // Code blocks: ```lang ... ```
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);

  // Headings
  text = text.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
  text = text.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  text = text.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  text = text.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Blockquotes
  text = text.replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>");

  // Images: ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');

  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');

  // Bold / Italic
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Strikethrough
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Horizontal rules
  text = text.replace(/^---$/gim, "<hr />");

  // Split lines to handle lists and paragraphs
  const lines = text.split("\n");
  const output: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^[*+-]\s+(.+)/.test(trimmed)) {
      if (!inUl) {
        if (inOl) {
          output.push("</ol>");
          inOl = false;
        }
        output.push("<ul>");
        inUl = true;
      }
      output.push(`<li>${trimmed.replace(/^[*+-]\s+/, "")}</li>`);
      continue;
    }

    if (/^\d+\.\s+(.+)/.test(trimmed)) {
      if (!inOl) {
        if (inUl) {
          output.push("</ul>");
          inUl = false;
        }
        output.push("<ol>");
        inOl = true;
      }
      output.push(`<li>${trimmed.replace(/^\d+\.\s+/, "")}</li>`);
      continue;
    }

    if (inUl) {
      output.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      output.push("</ol>");
      inOl = false;
    }

    if (trimmed.startsWith("<h") || trimmed.startsWith("<pre") || trimmed.startsWith("<blockquote") || trimmed.startsWith("<hr")) {
      output.push(line);
    } else if (trimmed === "") {
      output.push("<br />");
    } else {
      output.push(`<p>${line}</p>`);
    }
  }

  if (inUl) output.push("</ul>");
  if (inOl) output.push("</ol>");

  return output.join("\n");
}

function isSafeUrl(rawVal: string, isSrc = false): boolean {
  if (!rawVal) return false;
  // eslint-disable-next-line no-control-regex
  const cleaned = rawVal.replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, "");
  const lower = cleaned.toLowerCase();
  if (
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("#") ||
    lower.startsWith("/")
  ) {
    return true;
  }
  if (isSrc && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(cleaned)) {
    return true;
  }
  return false;
}

function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Remove dangerous tags
    const dangerous = doc.querySelectorAll(
      "script, iframe, object, embed, form, input, button, style, link, meta, base, frame, frameset",
    );
    dangerous.forEach((el) => el.remove());

    // Clean attributes
    const all = doc.body.querySelectorAll("*");
    all.forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const attrName = attr.name.toLowerCase();
        if (attrName.startsWith("on") || attrName === "srcdoc" || attrName === "formaction") {
          el.removeAttribute(attr.name);
          continue;
        }
        if (attrName === "href" || attrName === "src") {
          if (!isSafeUrl(attr.value, attrName === "src")) {
            el.removeAttribute(attr.name);
          }
        }
      }
      if (el.tagName.toLowerCase() === "a") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noreferrer noopener");
      }
    });

    return doc.body.innerHTML;
  } catch {
    return "";
  }
}

export function ProjectDetailModal({
  project,
  onClose,
  onInstall,
  downloads,
  instances = [],
  targetInstanceId = null,
}: ProjectDetailModalProps) {
  const { locale, t } = useI18n();
  const dialogRef = useDialogFocus(Boolean(project), onClose);


  const [activeTab, setActiveTab] = useState<"overview" | "versions">("overview");
  const [description, setDescription] = useState<string>("");
  const [loadingDesc, setLoadingDesc] = useState<boolean>(false);
  const [projectDetails, setProjectDetails] = useState<ProjectDetailsRecord | null>(null);

  const [versions, setVersions] = useState<NormalizedVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState<boolean>(false);
  const [versionFilterGame, setVersionFilterGame] = useState<string>("");
  const [versionFilterLoader, setVersionFilterLoader] = useState<string>("");
  const [versionSearch, setVersionSearch] = useState<string>("");

  const [gallery, setGallery] = useState<ProjectGalleryItem[]>([]);
  const [activeGalleryIndex, setActiveGalleryIndex] = useState<number>(0);

  const [installingVersionId, setInstallingVersionId] = useState<string | number | null>(null);
  const [installedVersionIds, setInstalledVersionIds] = useState<Set<string | number>>(new Set());
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(() => {
    if (targetInstanceId && instances.some((i) => i.id === targetInstanceId)) {
      return targetInstanceId;
    }
    const favorite = instances.find((i) => i.favorite && i.status === "ready");
    return favorite?.id || instances[0]?.id || "";
  });

  useEffect(() => {
    if (targetInstanceId && instances.some((i) => i.id === targetInstanceId)) {
      setSelectedInstanceId(targetInstanceId);
    }
  }, [targetInstanceId, instances]);

  const [previewData, setPreviewData] = useState<ResourcePackInspectResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Close on Escape key


  // Reset tab, preview and active index on project change
  useEffect(() => {
    if (!project) return;
    setActiveTab("overview");
    setActiveGalleryIndex(0);
    setVersionFilterGame("");
    setVersionFilterLoader("");
    setVersionSearch("");
    setPreviewData(null);
  }, [project]);

  // Cleanup temporary preview packs on unmount if not installed
  useEffect(() => {
    return () => {
      if (previewData?.tempFilePath) {
        window.onyx?.resourcepack?.cleanupPreview(previewData.tempFilePath).catch(() => {});
      }
    };
  }, [previewData]);

  const handleOpen3DPreview = useCallback(
    async (specificUrl?: string) => {
      if (!project) return;
      setLoadingPreview(true);
      try {
        let targetUrl = specificUrl || null;
        if (!targetUrl) {
          const vWithUrl = versions.find((v) => v.downloadUrl);
          if (vWithUrl?.downloadUrl) {
            targetUrl = vWithUrl.downloadUrl;
          } else {
            const id: string | number =
              project.source === "curseforge"
                ? (project.curseforgeId || project.project_id)
                : project.project_id;
            const res = await window.onyx.catalog.getVersions(id, project.source, {
              pageSize: 10,
            });
            if (project.source === "curseforge") {
              const rawFiles = (res || []) as CurseForgeFileRecord[];
              targetUrl = rawFiles.find((f) => f.downloadUrl)?.downloadUrl || null;
            } else {
              const rawVersions = (res || []) as ModrinthVersionRecord[];
              const v = rawVersions[0];
              const file = v?.files?.find((f) => f.primary) || v?.files?.[0];
              targetUrl = file?.url || null;
            }
          }
        }

        if (!targetUrl) {
          throw new Error("Не удалось найти прямую ссылку на скачивание файла");
        }

        const inspectResult = await window.onyx.resourcepack.downloadAndInspect({
          url: targetUrl,
          projectId: String(project.project_id),
        });
        setPreviewData(inspectResult);
      } catch (err: unknown) {
        console.error("Failed to load 3D preview:", err);
      } finally {
        setLoadingPreview(false);
      }
    },
    [project, versions],
  );

  // Load detailed description & metadata
  useEffect(() => {
    if (!project) return;
    const currentProject: CatalogProject = project;

    let cancelled = false;
    setLoadingDesc(true);

    async function loadDetails() {
      try {
        if (currentProject.source === "curseforge") {
          const modId = currentProject.curseforgeId || currentProject.project_id;
          const [descHtml, modData] = await Promise.all([
            window.onyx.curseforge.description(modId).catch(() => ""),
            window.onyx.catalog.getProject(modId, "curseforge").catch(() => null),
          ]);

          if (cancelled) return;
          setDescription(descHtml || currentProject.description || "");
          const details = modData as ProjectDetailsRecord | null;
          setProjectDetails(details);

          const photos: ProjectGalleryItem[] = [];
          if (details?.gallery?.length) {
            photos.push(...details.gallery);
          } else if (details?.raw?.screenshots?.length) {
            photos.push(
              ...details.raw.screenshots.map((s) => ({
                url: s.url,
                title: s.title || "",
                description: s.description || "",
              })),
            );
          } else if (currentProject.banner_url) {
            photos.push({ url: currentProject.banner_url });
          }
          setGallery(photos);
        } else {
          // Modrinth
          const data = (await window.onyx.catalog.getProject(
            currentProject.project_id,
            "modrinth",
          )) as ProjectDetailsRecord;
          if (cancelled) return;
          setProjectDetails(data);
          setDescription(data?.body || currentProject.description || "");

          const photos: ProjectGalleryItem[] = [];
          if (data?.gallery?.length) {
            photos.push(...data.gallery);
          } else if (currentProject.banner_url) {
            photos.push({ url: currentProject.banner_url });
          }
          setGallery(photos);
        }
      } catch {
        if (!cancelled) {
          setDescription(currentProject.description || "");
        }
      } finally {
        if (!cancelled) setLoadingDesc(false);
      }
    }

    void loadDetails();

    return () => {
      cancelled = true;
    };
  }, [project]);

  // Load versions
  useEffect(() => {
    if (!project) return;
    const currentProject: CatalogProject = project;

    let cancelled = false;
    setLoadingVersions(true);

    async function loadVersions() {
      try {
        const id: string | number = currentProject.source === "curseforge"
          ? (currentProject.curseforgeId || currentProject.project_id)
          : currentProject.project_id;
        const res = await window.onyx.catalog.getVersions(
          id,
          currentProject.source,
          { pageSize: 60 },
        );

        if (cancelled) return;

        if (currentProject.source === "curseforge") {
          const rawFiles = (res || []) as CurseForgeFileRecord[];
          const list: NormalizedVersion[] = rawFiles.map((f) => {
            let relType: "release" | "beta" | "alpha" = "release";
            if (f.releaseType === 2) relType = "beta";
            else if (f.releaseType === 3) relType = "alpha";

            const gv = (f.gameVersions || []).filter((v: string) => /^\d+\.\d+/.test(v));
            const loaders = (f.gameVersions || []).filter((v: string) =>
              /^(fabric|forge|neoforge|quilt)$/i.test(v),
            );

            return {
              id: f.id,
              name: f.displayName || f.fileName,
              versionNumber: f.displayName || "",
              fileName: f.fileName,
              fileSize: f.fileLength,
              datePublished: f.fileDate,
              releaseType: relType,
              gameVersions: gv,
              loaders: loaders,
              downloadUrl: f.downloadUrl,
            };
          });
          setVersions(list);
        } else {
          // Modrinth
          const rawVersions = (res || []) as ModrinthVersionRecord[];
          const list: NormalizedVersion[] = rawVersions.map((v) => {
            const file = v.files?.find((f) => f.primary) || v.files?.[0];
            return {
              id: v.id,
              name: v.name || v.version_number || "",
              versionNumber: v.version_number || "",
              fileName: file?.filename || v.name || "",
              fileSize: file?.size,
              datePublished: v.date_published,
              releaseType: (v.version_type as "release" | "beta" | "alpha") || "release",
              gameVersions: v.game_versions || [],
              loaders: v.loaders || [],
              downloads: v.downloads,
              downloadUrl: file?.url,
              changelog: v.changelog,
            };
          });
          setVersions(list);
        }
      } catch {
        if (!cancelled) setVersions([]);
      } finally {
        if (!cancelled) setLoadingVersions(false);
      }
    }

    void loadVersions();

    return () => {
      cancelled = true;
    };
  }, [project]);

  // Derived available versions and loaders for filter dropdowns
  const availableGameVersions = useMemo(() => {
    const set = new Set<string>();
    for (const v of versions) {
      for (const gv of v.gameVersions) set.add(gv);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }, [versions]);

  const availableLoaders = useMemo(() => {
    const set = new Set<string>();
    for (const v of versions) {
      for (const l of v.loaders) set.add(l.toLowerCase());
    }
    return Array.from(set);
  }, [versions]);

  // Filtered versions list
  const filteredVersions = useMemo(() => {
    return versions.filter((v) => {
      if (versionFilterGame && !v.gameVersions.includes(versionFilterGame)) {
        return false;
      }
      if (versionFilterLoader) {
        const hasLoader = v.loaders.some(
          (l) => l.toLowerCase() === versionFilterLoader.toLowerCase(),
        );
        if (!hasLoader) return false;
      }
      if (versionSearch.trim()) {
        const q = versionSearch.toLowerCase();
        const matches =
          v.name.toLowerCase().includes(q) ||
          v.versionNumber.toLowerCase().includes(q) ||
          v.fileName.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [versions, versionFilterGame, versionFilterLoader, versionSearch]);

  // Rendered & sanitized description HTML
  const sanitizedContent = useMemo(() => {
    if (!description) return "";
    const raw = markdownToHtml(description);
    return sanitizeHtml(raw);
  }, [description]);

  // Handle links inside description to open externally
  const handleDescriptionClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor && anchor.href) {
      e.preventDefault();
      if (/^https?:\/\//i.test(anchor.href)) {
        window.open(anchor.href, "_blank");
      }
    }
  }, []);

  const updatedDateFormatted = useMemo(() => {
    if (!project?.date_modified) return "";
    try {
      return new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(project.date_modified));
    } catch {
      return project.date_modified;
    }
  }, [project, locale]);

  if (!project) return null;

  // External URLs
  const externalUrl =
    project.source === "curseforge"
      ? `https://www.curseforge.com/minecraft/${
          project.project_type === "modpack" ? "modpacks" : "mc-mods"
        }/${project.slug}`
      : `https://modrinth.com/${project.project_type}/${project.slug}`;

  const links = projectDetails?.links || {
    wiki: projectDetails?.wiki_url,
    issues: projectDetails?.issues_url,
    source: projectDetails?.source_url,
    discord: projectDetails?.discord_url,
  };

  const projectLicense =
    typeof projectDetails?.license === "string"
      ? projectDetails.license
      : projectDetails?.license?.name || project.license || "Open Source";

  const clientSide =
    projectDetails?.client_side || project.client_side || "optional";
  const serverSide =
    projectDetails?.server_side || project.server_side || "optional";

  // Active download state for main project
  const currentTask = downloads.find(
    (d) => d.projectId === project.project_id,
  );
  const isInstalling =
    currentTask?.status === "downloading" ||
    currentTask?.status === "installing" ||
    currentTask?.status === "queued";
  const isInstalled = currentTask?.status === "done";

  // Hero banner image
  const bannerImage =
    gallery[0]?.url ||
    project.banner_url ||
    project.icon_url ||
    null;

  // Handler for installing a specific version
  const handleInstallVersion = async (version: NormalizedVersion) => {
    setInstallingVersionId(version.id);
    try {
      if (project.project_type === "modpack") {
        if (project.source === "curseforge") {
          await window.onyx.curseforge.installModpack({
            modId: project.curseforgeId || Number(project.project_id),
            fileId: Number(version.id),
            packName: `${project.title} (${version.name})`,
          });
        } else {
          onInstall(project, selectedInstanceId || targetInstanceId || undefined);
        }
      } else {
        // Mod install
        if (project.source === "curseforge") {
          const targetInstance =
            instances.find((i) => i.id === selectedInstanceId) ||
            instances.find((i) => i.favorite && i.status === "ready") ||
            instances[0];

          if (targetInstance) {
            await window.onyx.curseforge.installMod(
              targetInstance.id,
              project.curseforgeId || project.project_id,
              Number(version.id),
            );
            setInstalledVersionIds((prev) => new Set([...prev, version.id]));
          } else {
            onInstall(project, selectedInstanceId || targetInstanceId || undefined);
          }
        } else {
          onInstall(project, selectedInstanceId || targetInstanceId || undefined);
        }
      }
    } catch {
      // Fallback to regular install flow
      onInstall(project, selectedInstanceId || targetInstanceId || undefined);
    } finally {
      setInstallingVersionId(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop project-detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          className="modal project-detail-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={project?.title}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 10 }}
          transition={{ duration: 0.2 }}
        >
          {/* Hero Banner Header */}
          <div className="project-detail__hero">
            {bannerImage ? (
              <div
                className="project-detail__banner-bg"
                style={{ backgroundImage: `url(${bannerImage})` }}
              />
            ) : (
              <div className="project-detail__banner-gradient" />
            )}
            <div className="project-detail__banner-overlay" />

            {/* Top Bar Controls */}
            <div className="project-detail__topbar">
              <div className="project-detail__badges">
                <span
                  className={`provider-chip is-active provider-chip--${
                    project.source || "modrinth"
                  }`}
                >
                  {project.source === "curseforge" ? (
                    <CurseForgeIcon size={14} />
                  ) : (
                    <ModrinthIcon size={14} />
                  )}
                  <span>{project.source === "curseforge" ? "CurseForge" : "Modrinth"}</span>
                </span>
                <span className="project-detail__type-badge">
                  {project.project_type === "modpack"
                    ? t("projectDetail.modpack")
                    : t("projectDetail.mod")}
                </span>
                {projectLicense && (
                  <span className="project-detail__license-badge" title={projectLicense}>
                    <Shield size={12} />
                    {projectLicense}
                  </span>
                )}
              </div>

              <button
                className="modal__close project-detail__close"
                onClick={onClose}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>

            {/* Hero Main Info Row */}
            <div className="project-detail__hero-content">
              <div className="project-detail__icon-box">
                {project.icon_url ? (
                  <img
                    src={project.icon_url}
                    alt=""
                    className="project-detail__icon-img"
                  />
                ) : (
                  <div className="project-detail__icon-placeholder">
                    {project.title.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="project-detail__title-col">
                <h1 className="project-detail__title">{project.title}</h1>
                <p className="project-detail__author">
                  <Users size={14} />
                  <span>{t("discover.by", { author: project.author })}</span>
                </p>
              </div>

              <div className="project-detail__hero-actions">
                {project.project_type === "resourcepack" && (
                  <button
                    type="button"
                    className="button button--secondary project-detail__preview-btn"
                    onClick={() => void handleOpen3DPreview()}
                    disabled={loadingPreview}
                    title={t("projectDetail.preview3dTooltip")}
                  >
                    {loadingPreview ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Box size={16} />
                    )}
                    <span>
                      {loadingPreview ? t("projectDetail.preview3dLoading") : t("projectDetail.preview3d")}
                    </span>
                  </button>
                )}

                <button
                  className="button button--primary project-detail__install-btn"
                  onClick={() =>
                    onInstall(
                      project,
                      selectedInstanceId || targetInstanceId || undefined,
                    )
                  }
                  disabled={isInstalling || isInstalled}
                >
                  {isInstalled ? (
                    <>
                      <Check size={16} />{" "}
                      {project.project_type !== "modpack" &&
                      instances.find((i) => i.id === selectedInstanceId)
                        ? t("discover.installedInTarget")
                        : t("discover.inLibrary")}
                    </>
                  ) : isInstalling ? (
                    <>
                      <LoaderCircle className="spin" size={16} />
                      {currentTask?.progress || 0}%
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      {project.project_type === "modpack"
                        ? t("projectDetail.installModpack")
                        : instances.find((i) => i.id === selectedInstanceId)
                          ? t("discover.addToTarget", {
                              name: instances.find(
                                (i) => i.id === selectedInstanceId,
                              )!.name,
                            })
                          : t("projectDetail.installMod")}
                    </>
                  )}
                </button>

                <button
                  className="button button--glass project-detail__browser-btn"
                  onClick={() => window.open(externalUrl, "_blank")}
                  title={t("projectDetail.openBrowser")}
                >
                  <ExternalLink size={15} />
                  <span>{t("projectDetail.openBrowser")}</span>
                </button>
              </div>
            </div>

            {/* Quick Stats Bar */}
            <div className="project-detail__stats-row">
              <div className="project-detail__stat">
                <Download size={14} />
                <span>{compactNumber(project.downloads, locale)}</span>
                <small>{t("projectDetail.downloads")}</small>
              </div>
              <div className="project-detail__stat">
                <Star size={14} />
                <span>{compactNumber(project.follows, locale)}</span>
                <small>{t("projectDetail.followers")}</small>
              </div>
              <div className="project-detail__stat">
                <Clock size={14} />
                <span>{updatedDateFormatted}</span>
                <small>{t("projectDetail.updated")}</small>
              </div>
              <div className="project-detail__chips">
                {project.categories.slice(0, 5).map((category) => (
                  <span key={category} className="project-detail__chip">
                    {category}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Tabs Header */}
          <div className="project-detail__tabs">
            <button
              className={`project-detail__tab ${
                activeTab === "overview" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("overview")}
            >
              <FileText size={16} />
              <span>{t("projectDetail.overview")}</span>
            </button>
            <button
              className={`project-detail__tab ${
                activeTab === "versions" ? "is-active" : ""
              }`}
              data-capture-target="versions-tab"
              onClick={() => setActiveTab("versions")}
            >
              <Layers size={16} />
              <span>{t("projectDetail.versions")}</span>
              {versions.length > 0 && (
                <span className="project-detail__tab-count">
                  {versions.length}
                </span>
              )}
            </button>
          </div>

          {/* Modal Scrollable Body */}
          <div className="project-detail__body">
            {activeTab === "overview" && (
              <div className="project-detail__overview-layout">
                {/* Main Content Area */}
                <div className="project-detail__main-content">
                  {/* Screenshot Gallery Carousel */}
                  {gallery.length > 0 && (
                    <div className="project-detail__gallery">
                      <div className="project-detail__gallery-viewer">
                        <img
                          src={gallery[activeGalleryIndex]?.url}
                          alt={
                            gallery[activeGalleryIndex]?.title ||
                            project.title
                          }
                          className="project-detail__gallery-main-img"
                        />
                        {gallery.length > 1 && (
                          <>
                            <button
                              className="gallery-nav-btn gallery-nav-btn--prev"
                              onClick={() =>
                                setActiveGalleryIndex((prev) =>
                                  prev > 0 ? prev - 1 : gallery.length - 1,
                                )
                              }
                              aria-label={t("projectDetail.prevScreenshot")}
                            >
                              <ChevronLeft size={20} />
                            </button>
                            <button
                              className="gallery-nav-btn gallery-nav-btn--next"
                              onClick={() =>
                                setActiveGalleryIndex((prev) =>
                                  prev < gallery.length - 1 ? prev + 1 : 0,
                                )
                              }
                              aria-label={t("projectDetail.nextScreenshot")}
                            >
                              <ChevronRight size={20} />
                            </button>
                          </>
                        )}
                        {(gallery[activeGalleryIndex]?.title ||
                          gallery[activeGalleryIndex]?.description) && (
                          <div className="project-detail__gallery-caption">
                            {gallery[activeGalleryIndex]?.title && (
                              <strong>
                                {gallery[activeGalleryIndex]?.title}
                              </strong>
                            )}
                            {gallery[activeGalleryIndex]?.description && (
                              <span>
                                {gallery[activeGalleryIndex]?.description}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {gallery.length > 1 && (
                        <div className="project-detail__gallery-strip">
                          {gallery.map((item, idx) => (
                            <button
                              key={item.url + idx}
                              className={`gallery-thumb ${
                                idx === activeGalleryIndex ? "is-active" : ""
                              }`}
                              onClick={() => setActiveGalleryIndex(idx)}
                            >
                              <img src={item.url} alt="" loading="lazy" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clean Markdown / HTML Description */}
                  {loadingDesc ? (
                    <div className="project-detail__desc-loading">
                      <LoaderCircle className="spin" size={24} />
                      <p>{t("projectDetail.loading")}</p>
                    </div>
                  ) : (
                    <div
                      className="project-detail__description"
                      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                      onClick={handleDescriptionClick}
                    />
                  )}
                </div>

                {/* Sidebar Metadata */}
                <aside className="project-detail__sidebar">
                  {/* Supported Minecraft Versions */}
                  <div className="sidebar-card">
                    <h4>
                      <Calendar size={15} />
                      {t("projectDetail.supportedVersions")}
                    </h4>
                    <div className="sidebar-chips">
                      {(
                        projectDetails?.game_versions ||
                        project.versions ||
                        []
                      )
                        .slice(0, 16)
                        .map((ver: string) => (
                          <span key={ver} className="sidebar-chip">
                            {ver}
                          </span>
                        ))}
                    </div>
                  </div>

                  {/* Supported Mod Loaders */}
                  <div className="sidebar-card">
                    <h4>
                      <HardDrive size={15} />
                      {t("projectDetail.supportedLoaders")}
                    </h4>
                    <div className="sidebar-chips">
                      {(projectDetails?.loaders || project.categories || [])
                        .filter((c: string) =>
                          /^(fabric|forge|neoforge|quilt)$/i.test(c),
                        )
                        .map((l: string) => (
                          <span
                            key={l}
                            className={`sidebar-chip sidebar-chip--loader sidebar-chip--${l.toLowerCase()}`}
                          >
                            <span className="loader-dot" />
                            {l.charAt(0).toUpperCase() + l.slice(1)}
                          </span>
                        ))}
                    </div>
                  </div>

                  {/* Client & Server Side Requirements */}
                  <div className="sidebar-card">
                    <h4>
                      <Server size={15} />
                      {t("projectDetail.environment")}
                    </h4>
                    <div className="sidebar-env-list">
                      <div className="sidebar-env-item">
                        <span>{t("projectDetail.clientSide")}:</span>
                        <strong className={`env-tag env-tag--${clientSide}`}>
                          {clientSide}
                        </strong>
                      </div>
                      <div className="sidebar-env-item">
                        <span>{t("projectDetail.serverSide")}:</span>
                        <strong className={`env-tag env-tag--${serverSide}`}>
                          {serverSide}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* External Links */}
                  {(links.wiki ||
                    links.source ||
                    links.issues ||
                    links.discord ||
                    links.website) && (
                    <div className="sidebar-card">
                      <h4>
                        <Globe size={15} />
                        {t("projectDetail.links")}
                      </h4>
                      <div className="sidebar-links">
                        {links.wiki && (
                          <a
                            href={links.wiki}
                            target="_blank"
                            rel="noreferrer"
                            className="sidebar-link-btn"
                          >
                            <BookOpen size={14} />
                            <span>{t("projectDetail.wiki")}</span>
                            <ExternalLink size={12} />
                          </a>
                        )}
                        {links.source && (
                          <a
                            href={links.source}
                            target="_blank"
                            rel="noreferrer"
                            className="sidebar-link-btn"
                          >
                            <Code size={14} />
                            <span>{t("projectDetail.source")}</span>
                            <ExternalLink size={12} />
                          </a>
                        )}
                        {links.issues && (
                          <a
                            href={links.issues}
                            target="_blank"
                            rel="noreferrer"
                            className="sidebar-link-btn"
                          >
                            <Tag size={14} />
                            <span>{t("projectDetail.issues")}</span>
                            <ExternalLink size={12} />
                          </a>
                        )}
                        {links.discord && (
                          <a
                            href={links.discord}
                            target="_blank"
                            rel="noreferrer"
                            className="sidebar-link-btn"
                          >
                            <MessageSquare size={14} />
                            <span>{t("projectDetail.discord")}</span>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            )}

            {activeTab === "versions" && (
              <div className="project-detail__versions-tab">
                {/* Filters Row */}
                <div className="versions-toolbar">
                  <div className="versions-toolbar__filters">
                    <label className="versions-filter-label">
                      <Filter size={13} />
                      <select
                        value={versionFilterGame}
                        onChange={(e) => setVersionFilterGame(e.target.value)}
                      >
                        <option value="">{t("projectDetail.allVersions")}</option>
                        {availableGameVersions.map((gv) => (
                          <option key={gv} value={gv}>
                            {gv}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="versions-filter-label">
                      <HardDrive size={13} />
                      <select
                        value={versionFilterLoader}
                        onChange={(e) => setVersionFilterLoader(e.target.value)}
                      >
                        <option value="">{t("projectDetail.anyLoader")}</option>
                        {availableLoaders.map((l) => (
                          <option key={l} value={l}>
                            {l.charAt(0).toUpperCase() + l.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="versions-search-label">
                      <Search size={14} />
                      <input
                        type="text"
                        value={versionSearch}
                        onChange={(e) => setVersionSearch(e.target.value)}
                        placeholder="Filter by name…"
                      />
                    </label>
                  </div>

                  {/* Instance Selector for Mod install */}
                  {project.project_type === "mod" && instances.length > 0 && (
                    <div className="versions-instance-target">
                      <Package size={14} />
                      <span>{t("projectDetail.selectInstance")}:</span>
                      <select
                        value={selectedInstanceId}
                        onChange={(e) => setSelectedInstanceId(e.target.value)}
                      >
                        {instances.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.version} · {i.loader})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Versions List */}
                {loadingVersions ? (
                  <div className="project-detail__desc-loading">
                    <LoaderCircle className="spin" size={24} />
                    <p>{t("projectDetail.loadingVersions")}</p>
                  </div>
                ) : filteredVersions.length === 0 ? (
                  <div className="versions-empty">
                    <Info size={28} />
                    <p>{t("projectDetail.noVersions")}</p>
                  </div>
                ) : (
                  <div className="project-detail__versions-list">
                    {filteredVersions.map((version) => {
                      const isInstallingThis =
                        installingVersionId === version.id;
                      const isInstalledThis =
                        installedVersionIds.has(version.id);

                      return (
                        <article
                          key={String(version.id)}
                          className="version-card"
                        >
                          <div className="version-card__header">
                            <div className="version-card__badge-row">
                              <span
                                className={`badge badge--${version.releaseType}`}
                              >
                                {version.releaseType === "release"
                                  ? t("projectDetail.release")
                                  : version.releaseType === "beta"
                                  ? t("projectDetail.beta")
                                  : t("projectDetail.alpha")}
                              </span>
                              <h3 className="version-card__title">
                                {version.name}
                              </h3>
                              {version.versionNumber &&
                                version.versionNumber !== version.name && (
                                  <span className="version-card__num">
                                    {version.versionNumber}
                                  </span>
                                )}
                            </div>

                            <div className="version-card__actions">
                              {project.project_type === "resourcepack" &&
                                version.downloadUrl && (
                                  <button
                                    type="button"
                                    className="button button--ghost button--sm version-card__preview-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleOpen3DPreview(version.downloadUrl!);
                                    }}
                                    disabled={loadingPreview}
                                    title={t("projectDetail.preview3dVersionTooltip")}
                                  >
                                    <Box size={14} />
                                    <span>3D</span>
                                  </button>
                                )}

                              <button
                                className={`button button--sm version-card__install-btn ${
                                  isInstalledThis ? "button--success" : "button--primary"
                                }`}
                                onClick={() => void handleInstallVersion(version)}
                                disabled={isInstallingThis || isInstalledThis}
                              >
                                {isInstalledThis ? (
                                  <>
                                    <Check size={14} />
                                    <span>{t("projectDetail.inLibrary")}</span>
                                  </>
                                ) : isInstallingThis ? (
                                  <>
                                    <LoaderCircle className="spin" size={14} />
                                    <span>{t("projectDetail.installing")}</span>
                                  </>
                                ) : (
                                  <>
                                    <Download size={14} />
                                    <span>{t("projectDetail.installVersion")}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="version-card__meta">
                            <div className="version-card__tags">
                              {version.gameVersions.length > 0 && (
                                <span className="version-pill version-pill--mc">
                                  {version.gameVersions.slice(0, 3).join(", ")}
                                  {version.gameVersions.length > 3 &&
                                    ` +${version.gameVersions.length - 3}`}
                                </span>
                              )}
                              {version.loaders.map((l) => (
                                <span
                                  key={l}
                                  className={`version-pill version-pill--loader version-pill--${l.toLowerCase()}`}
                                >
                                  {l}
                                </span>
                              ))}
                            </div>

                            <div className="version-card__details">
                              {version.fileSize && (
                                <span>
                                  <FileCode size={13} />
                                  {formatBytes(version.fileSize, locale)}
                                </span>
                              )}
                              {version.datePublished && (
                                <span>
                                  <Calendar size={13} />
                                  {new Intl.DateTimeFormat(locale, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  }).format(new Date(version.datePublished))}
                                </span>
                              )}
                              {typeof version.downloads === "number" && (
                                <span>
                                  <Download size={13} />
                                  {compactNumber(version.downloads, locale)}
                                </span>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      {previewData && (
        <ResourcePack3DViewer
          packData={previewData}
          instances={instances}
          onClose={() => setPreviewData(null)}
        />
      )}
    </AnimatePresence>
  );
}
