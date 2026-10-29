import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Box,
  Check,
  Download,
  Flame,
  Gamepad2,
  Info,
  LoaderCircle,
  PackagePlus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  WandSparkles,
} from "lucide-react";
import { ProjectDetailModal } from "../components/ProjectDetailModal";
import { CurseForgeIcon, ModrinthIcon } from "../components/ProviderIcons";
import { fallbackProjects } from "../data";
import { useSearchFocus } from "../hooks/useSearchFocus";
import { useI18n } from "../i18n";
import type {
  CatalogProject,
  DownloadTask,
  GameInstance,
  MinecraftVersion,
  RouteId,
} from "../types";
import { compactNumber } from "../utils";

interface DiscoverPageProps {
  initialQuery?: string;
  initialProjectType?: "mod" | "modpack";
  downloads: DownloadTask[];
  onInstall: (project: CatalogProject, targetInstanceId?: string) => void;
  onNavigate: (route: RouteId) => void;
  versions: MinecraftVersion[];
  instances?: GameInstance[];
  targetInstanceId?: string | null;
  onSelectTargetInstance?: (id: string | null) => void;
  onBackToInstance?: () => void;
}

type ProjectType = "modpack" | "mod" | "resourcepack" | "shader";

export function DiscoverPage({
  initialQuery = "",
  initialProjectType,
  downloads,
  onInstall,
  onNavigate,
  versions,
  instances = [],
  targetInstanceId = null,
  onSelectTargetInstance,
  onBackToInstance,
}: DiscoverPageProps) {
  const { locale, t } = useI18n();
  const [selectedProject, setSelectedProject] = useState<CatalogProject | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState<"modrinth" | "curseforge">("modrinth");
  const [projectType, setProjectType] = useState<ProjectType>(initialProjectType || (targetInstanceId ? "mod" : "modpack"));
  const [projects, setProjects] = useState<CatalogProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [gameVersion, setGameVersion] = useState("");
  const [loader, setLoader] = useState("");
  const [sort, setSort] = useState<
    "relevance" | "downloads" | "follows" | "newest" | "updated"
  >("downloads");
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [installedModNames, setInstalledModNames] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchFocus(searchRef);

  const targetInstance = useMemo(
    () => (targetInstanceId ? instances.find((item) => item.id === targetInstanceId) || null : null),
    [instances, targetInstanceId],
  );

  const prevTargetIdRef = useRef<string | null>(targetInstanceId);
  useEffect(() => {
    if (targetInstance) {
      if (targetInstance.version) {
        setGameVersion(targetInstance.version);
      }
      const ldr = targetInstance.loader?.toLowerCase();
      if (ldr && ldr !== "vanilla") {
        setLoader(ldr);
      } else {
        setLoader("");
      }
    } else if (prevTargetIdRef.current && !targetInstanceId) {
      setGameVersion("");
      setLoader("");
    }
    prevTargetIdRef.current = targetInstanceId;
  }, [targetInstance, targetInstanceId]);

  useEffect(() => {
    let cancelled = false;
    if (!targetInstanceId) {
      setInstalledModNames(new Set());
      return;
    }
    const kind =
      projectType === "resourcepack"
        ? "resourcepacks"
        : projectType === "shader"
          ? "shaderpacks"
          : "mods";
    window.onyx?.state?.listContent?.(targetInstanceId, kind)
      .then((items) => {
        if (cancelled || !Array.isArray(items)) return;
        const set = new Set<string>();
        for (const item of items) {
          if (item.projectId) set.add(item.projectId.toLowerCase());
          if (item.name) set.add(item.name.toLowerCase());
        }
        setInstalledModNames(set);
      })
      .catch(() => {
        if (!cancelled) setInstalledModNames(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [targetInstanceId, projectType, downloads]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await window.onyx.catalog.search(query, projectType, {
          source,
          version: gameVersion || undefined,
          loader: loader || undefined,
          index: query && sort === "downloads" ? "relevance" : sort,
        });
        if (!cancelled) {
          setProjects(response.hits);
          setTotal(response.total_hits);
          setOffline(false);
        }
      } catch {
        if (!cancelled) {
          setProjects(
            projectType === "modpack"
              ? fallbackProjects
              : fallbackProjects.map((project) => ({
                  ...project,
                  project_type: "mod" as const,
                })),
          );
          setOffline(true);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 360 : 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [gameVersion, loader, projectType, query, sort, source]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const response = await window.onyx.catalog.search(query, projectType, {
        source,
        version: gameVersion || undefined,
        loader: loader || undefined,
        index: query && sort === "downloads" ? "relevance" : sort,
        offset: projects.length,
      });
      setProjects((current) => [
        ...current,
        ...response.hits.filter(
          (project) =>
            !current.some((item) => item.project_id === project.project_id),
        ),
      ]);
      setTotal(response.total_hits);
    } finally {
      setLoadingMore(false);
    }
  };

  const featured = !query.trim() && !gameVersion && !loader ? projects[0] : undefined;
  const list = useMemo(() => projects.slice(featured ? 1 : 0), [featured, projects]);

  const projectDescription = (project: CatalogProject) => {
    if (!project.project_id.endsWith("-fallback")) return project.description;
    if (project.project_id.startsWith("prominence")) return t("discover.fallback.prominence");
    if (project.project_id.startsWith("cobblemon")) return t("discover.fallback.cobblemon");
    if (project.project_id.startsWith("create")) return t("discover.fallback.create");
    return t("discover.fallback.vanilla");
  };

  const installState = (projectId: string) =>
    downloads.find((download) => {
      if (download.projectId !== projectId) return false;
      if (!targetInstanceId) return true;
      return download.targetInstanceId === targetInstanceId || !download.targetInstanceId;
    });

  const isProjectInstalled = (project: CatalogProject) => {
    const task = installState(project.project_id);
    if (task?.status === "done") return true;

    if (targetInstanceId && installedModNames.size > 0) {
      if (installedModNames.has(project.project_id.toLowerCase())) return true;
      if (project.slug && installedModNames.has(project.slug.toLowerCase())) return true;
      const slugLower = (project.slug || project.project_id).toLowerCase();
      for (const name of installedModNames) {
        if (name.includes(slugLower)) return true;
      }
    }
    return false;
  };

  return (
    <motion.div
      className="page discover-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("discover.eyebrow")}</p>
          <h1>{t("discover.title")}</h1>
          <p>{t("discover.subtitle")}</p>
        </div>
        <div className="provider-toggle">
          <button
            type="button"
            className={`provider-chip ${source === "modrinth" ? "is-active provider-chip--modrinth" : ""}`}
            onClick={() => setSource("modrinth")}
            title={t("discover.providerModrinth")}
          >
            <ModrinthIcon size={16} />
            <span>Modrinth</span>
          </button>
          <button
            type="button"
            className={`provider-chip ${source === "curseforge" ? "is-active provider-chip--curseforge" : ""}`}
            data-capture-target="curseforge-toggle"
            onClick={() => setSource("curseforge")}
            title={t("discover.providerCurseforge")}
          >
            <CurseForgeIcon size={16} />
            <span>CurseForge</span>
          </button>
        </div>
      </div>

      {projectType !== "modpack" && instances.length > 0 && (
        <div className="target-instance-bar">
          <div className="target-instance-bar__left">
            <span className="target-instance-bar__label">
              <PackagePlus size={14} />
              {t("discover.targetInstance")}:
            </span>
            <div className="target-instance-bar__select-wrap">
              <select
                value={targetInstanceId || ""}
                onChange={(event) => {
                  const val = event.target.value;
                  if (!val) {
                    setGameVersion("");
                    setLoader("");
                  }
                  onSelectTargetInstance?.(val || null);
                }}
                aria-label={t("discover.targetInstance")}
                className="target-instance-bar__select"
              >
                <option value="">{t("discover.targetAny")}</option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} ({inst.version}
                    {inst.loader && inst.loader.toLowerCase() !== "vanilla"
                      ? ` · ${inst.loader}`
                      : ""}
                    )
                  </option>
                ))}
              </select>
            </div>
            {targetInstance && (
              <span className="target-instance-bar__badge">
                {targetInstance.version}
                {targetInstance.loader && targetInstance.loader.toLowerCase() !== "vanilla"
                  ? ` · ${targetInstance.loader}`
                  : ""}
              </span>
            )}
            {targetInstanceId && (
              <button
                type="button"
                className="target-instance-bar__clear"
                onClick={() => {
                  setGameVersion("");
                  setLoader("");
                  onSelectTargetInstance?.(null);
                }}
                title={t("discover.clearTarget")}
              >
                ×
              </button>
            )}
          </div>
          {targetInstance && onBackToInstance && (
            <button
              type="button"
              className="button button--mini button--glass target-instance-bar__back"
              onClick={onBackToInstance}
            >
              ← {t("discover.backToInstance", { name: targetInstance.name })}
            </button>
          )}
        </div>
      )}

      {projectType === "modpack" && <p className="field-hint">{t("discover.newInstanceHint")}</p>}
      <div className="discover-toolbar">
        <label className="discover-search">
          <Search size={20} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              projectType === "modpack"
                ? t("discover.searchPacks")
                : projectType === "resourcepack"
                  ? t("discover.searchResourcepacks")
                  : projectType === "shader"
                    ? t("discover.searchShaders")
                    : t("discover.searchMods")
            }
          />
          {loading && <LoaderCircle className="spin" size={18} />}
          <kbd>Enter</kbd>
        </label>
        <div className="segmented-control">
          <button
            className={projectType === "modpack" ? "is-active" : ""}
            onClick={() => setProjectType("modpack")}
          >
            <Gamepad2 size={15} /> {t("discover.modpacks")}
          </button>
          <button
            className={projectType === "mod" ? "is-active" : ""}
            onClick={() => setProjectType("mod")}
          >
            <PackagePlus size={15} /> {t("discover.mods")}
          </button>
          <button
            className={projectType === "resourcepack" ? "is-active" : ""}
            onClick={() => setProjectType("resourcepack")}
          >
            <Box size={15} /> {t("discover.resourcepacks")}
          </button>
          <button
            className={projectType === "shader" ? "is-active" : ""}
            onClick={() => setProjectType("shader")}
          >
            <Sparkles size={15} /> {t("discover.shaders")}
          </button>
        </div>
      </div>

      <div className="discover-filters">
        <span>
          <SlidersHorizontal size={14} /> {t("discover.filters")}
        </span>
        <label>
          <small>Minecraft</small>
          <select
            value={gameVersion}
            onChange={(event) => setGameVersion(event.target.value)}
          >
            <option value="">{t("discover.allVersions")}</option>
            {versions.slice(0, 28).map((version) => (
              <option value={version.id} key={version.id}>
                {version.id}
              </option>
            ))}
          </select>
        </label>
        {projectType !== "resourcepack" && (
          <label>
            <small>{t("discover.loader")}</small>
            <select
              value={loader}
              onChange={(event) => setLoader(event.target.value)}
            >
              <option value="">{t("discover.any")}</option>
              <option value="fabric">Fabric</option>
              <option value="neoforge">NeoForge</option>
              <option value="forge">Forge</option>
              <option value="quilt">Quilt</option>
            </select>
          </label>
        )}
        <label>
          <small>{t("discover.sort")}</small>
          <select
            value={sort}
            onChange={(event) =>
              setSort(
                event.target.value as
                  | "relevance"
                  | "downloads"
                  | "follows"
                  | "newest"
                  | "updated",
              )
            }
          >
            {query && <option value="relevance">{t("discover.sort.relevance")}</option>}
            <option value="downloads">{t("discover.sort.downloads")}</option>
            <option value="follows">{t("discover.sort.follows")}</option>
            <option value="updated">{t("discover.sort.updated")}</option>
            <option value="newest">{t("discover.sort.newest")}</option>
          </select>
        </label>
        {(gameVersion || loader) && (
          <button
            className="text-button"
            onClick={() => {
              setGameVersion("");
              setLoader("");
            }}
          >
            {t("discover.reset")}
          </button>
        )}
      </div>

      {offline && (
        <div className="offline-banner">
          <WandSparkles size={16} />
          {t("discover.offline")}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="empty-state">
          <span>
            <Search size={28} />
          </span>
          <h2>{t("discover.empty")}</h2>
          <p>{t("discover.emptyHint")}</p>
        </div>
      )}

      {featured && (
        <section className="catalog-feature">
          <div
            className="catalog-feature__art"
            role="button"
            tabIndex={0}
            aria-label={t("discover.detailsNamed", { name: featured.title })}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedProject(featured); } }}
            style={{ cursor: "pointer" }}
            onClick={() => setSelectedProject(featured)}
          >
            {featured.icon_url ? (
              <img
                src={featured.icon_url}
                alt=""
                decoding="async"
                fetchPriority="high"
              />
            ) : (
              <span>{featured.title.slice(0, 2).toUpperCase()}</span>
            )}
            <div />
          </div>
          <div className="catalog-feature__copy">
            <div className="catalog-feature__top-row" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div className="catalog-feature__label">
                <Flame size={14} />
                {t("discover.trending")}
              </div>
              <span className={`source-tag source-tag--${featured.source || "modrinth"}`}>
                {featured.source === "curseforge" ? (
                  <>
                    <CurseForgeIcon size={12} className="source-tag__icon" />
                    CurseForge
                  </>
                ) : (
                  <>
                    <ModrinthIcon size={12} className="source-tag__icon" />
                    Modrinth
                  </>
                )}
              </span>
            </div>
            <h2
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedProject(featured)}
            >
              {featured.title}
            </h2>
            <p>{projectDescription(featured)}</p>
            <div className="catalog-feature__meta">
              <span>
                <Download size={14} /> {compactNumber(featured.downloads, locale)}
              </span>
              <span>
                <Star size={14} /> {compactNumber(featured.follows, locale)}
              </span>
              <span>{t("discover.by", { author: featured.author })}</span>
            </div>
            <div className="catalog-feature__actions">
              <InstallButton
                task={installState(featured.project_id)}
                isInstalled={isProjectInstalled(featured)}
                onClick={() => onInstall(featured, projectType === "modpack" ? undefined : targetInstanceId || undefined)}
                unavailable={offline}
                targetInstanceName={projectType === "modpack" ? undefined : targetInstance?.name}
              />
              <button
                className="button button--glass"
                data-capture-target="project-details"
                onClick={() => setSelectedProject(featured)}
              >
                <Info size={15} /> {t("discover.details")}
              </button>
            </div>
          </div>
          <div className="catalog-feature__chips">
            {featured.categories.slice(0, 3).map((category) => (
              <span key={category}>{category}</span>
            ))}
          </div>
        </section>
      )}

      {list.length > 0 && (
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>{query ? t("discover.results", { query }) : t("discover.popular")}</h2>
              <p>
                {projectType === "modpack"
                  ? t("discover.packsHint")
                  : projectType === "resourcepack"
                    ? t("discover.resourcepacksHint")
                    : projectType === "shader"
                      ? t("discover.shadersHint")
                      : t("discover.modsHint")}
                {total > 0 && ` · ${t("discover.found", { count: total.toLocaleString("en-US") })}`}
              </p>
            </div>
            <button className="text-button" onClick={() => onNavigate("downloads")}>
              {t("discover.queue")}
            </button>
          </div>

          <div className="catalog-grid">
            {list.map((project, index) => {
              const task = installState(project.project_id);
              const isInstalled = isProjectInstalled(project);
              const isActive =
                task?.status === "downloading" ||
                task?.status === "installing" ||
                task?.status === "queued";
              const isDone = isInstalled || task?.status === "done";
              return (
                <motion.article
                  className="project-card project-card--clickable"
                  key={project.project_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.025, 0.2) }}
                  role="button"
                  tabIndex={0}
                  aria-label={t("discover.detailsNamed", { name: project.title })}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedProject(project); }
                  }}
                  onClick={() => setSelectedProject(project)}
                >
                  <div className="project-card__head">
                    <span
                      className="project-card__icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProject(project);
                      }}
                    >
                      {project.icon_url ? (
                        <img
                          src={project.icon_url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        project.title.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <div>
                      <h3
                        title={project.title}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProject(project);
                        }}
                      >
                        <span style={{ cursor: "pointer" }}>{project.title}</span>
                      </h3>
                      <p>{t("discover.by", { author: project.author })}</p>
                    </div>
                  </div>
                  <p className="project-card__description">
                    {projectDescription(project)}
                  </p>
                  <div className="project-card__tags">
                    <span
                      className={`source-tag source-tag--${project.source || "modrinth"}`}
                    >
                      {project.source === "curseforge" ? (
                        <>
                          <CurseForgeIcon size={12} className="source-tag__icon" />
                          CurseForge
                        </>
                      ) : (
                        <>
                          <ModrinthIcon size={12} className="source-tag__icon" />
                          Modrinth
                        </>
                      )}
                    </span>
                    {project.categories.slice(0, 3).map((category) => (
                      <span key={category}>{category}</span>
                    ))}
                  </div>
                  <div className="project-card__footer">
                    <div>
                      <span>
                        <Download size={13} />
                        {compactNumber(project.downloads, locale)}
                      </span>
                      <span>
                        <Star size={13} />
                        {compactNumber(project.follows, locale)}
                      </span>
                    </div>
                    <button
                      aria-label={isDone ? t("discover.inLibrary") : t("discover.installNamed", { name: project.title })}
                      className={`project-install ${isDone ? "is-done" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInstall(project, projectType === "modpack" ? undefined : targetInstanceId || undefined);
                      }}
                      disabled={
                        offline ||
                        isActive ||
                        isDone
                      }
                      title={
                        isDone
                          ? (targetInstance ? t("discover.installedInTarget") : t("discover.inLibrary"))
                          : targetInstance
                            ? t("discover.addToTarget", { name: targetInstance.name })
                            : undefined
                      }
                    >
                      {isDone ? (
                        <Check size={16} />
                      ) : isActive ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Download size={16} />
                      )}
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
          {!offline && projects.length < total && (
            <button
              className="catalog-load-more"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}
              {t("discover.more")}
            </button>
          )}
        </section>
      )}

      <ProjectDetailModal
        project={selectedProject}
        onClose={() => setSelectedProject(null)}
        onInstall={onInstall}
        downloads={downloads}
        instances={instances}
        targetInstanceId={targetInstanceId}
      />
    </motion.div>
  );
}

function InstallButton({
  task,
  isInstalled,
  onClick,
  unavailable,
  targetInstanceName,
}: {
  task?: DownloadTask;
  isInstalled?: boolean;
  onClick: () => void;
  unavailable?: boolean;
  targetInstanceName?: string;
}) {
  const { t } = useI18n();
  const active =
    task?.status === "downloading" ||
    task?.status === "installing" ||
    task?.status === "queued";
  const done = isInstalled || task?.status === "done";
  return (
    <button
      className="button button--primary"
      onClick={onClick}
      disabled={active || done || unavailable}
    >
      {unavailable ? (
        <>{t("discover.offlineInstall")}</>
      ) : done ? (
        <>
          <Check size={16} /> {targetInstanceName ? t("discover.installedInTarget") : t("discover.inLibrary")}
        </>
      ) : active ? (
        <>
          <LoaderCircle className="spin" size={16} />
          {task.progress}%
        </>
      ) : (
        <>
          <Download size={16} /> {targetInstanceName ? t("discover.addToTarget", { name: targetInstanceName }) : t("discover.install")}
        </>
      )}
    </button>
  );
}
