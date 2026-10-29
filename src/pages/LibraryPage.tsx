import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArchiveRestore,
  ArrowDownAZ,
  ChevronDown,
  Download,
  Grid2X2,
  List,
  PackageOpen,
  PackagePlus,
  Plus,
  Rocket,
  Search,
  Share2,
  FileCode,
  SlidersHorizontal,
  Users2,
} from "lucide-react";
import { InstanceCard } from "../components/InstanceCard";
import { useSearchFocus } from "../hooks/useSearchFocus";
import { useI18n } from "../i18n";
import type { GameInstance } from "../types";

interface LibraryPageProps {
  instances: GameInstance[];
  onCreate: () => void;
  onMigrate: () => void;
  onPlay: (
    instance: GameInstance,
    options?: { multiClient?: boolean; username?: string },
  ) => void;
  onFavorite: (instance: GameInstance) => void;
  onMenu: (instance: GameInstance) => void;
  onCheck: (instance: GameInstance) => void;
  onOpen: (instance: GameInstance) => void;
  onImport: () => void;
  onImportBackup: () => void;
  onImportSync: () => void;
  onImportLink?: () => void;
  onJoinParty?: () => void;
}

type Filter = "all" | "fabric" | "forge" | "neoforge" | "quilt" | "vanilla" | "favorite";

export function LibraryPage({
  instances,
  onCreate,
  onMigrate,
  onPlay,
  onFavorite,
  onMenu,
  onCheck,
  onOpen,
  onImport,
  onImportBackup,
  onImportSync,
  onImportLink,
  onJoinParty,
}: LibraryPageProps) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [compact, setCompact] = useState(false);
  const [sortAscending, setSortAscending] = useState(true);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchFocus(searchRef);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        importMenuRef.current &&
        !importMenuRef.current.contains(event.target as Node)
      ) {
        setImportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    return instances
      .filter((instance) => {
        if (filter === "favorite") return instance.favorite;
        if (filter === "all") return true;
        if (filter === "forge") {
          return /forge/i.test(instance.loader) && !/neoforge/i.test(instance.loader);
        }
        if (filter === "neoforge") {
          return /neoforge/i.test(instance.loader);
        }
        if (filter === "quilt") {
          return /quilt/i.test(instance.loader);
        }
        return instance.loader.toLowerCase().includes(filter);
      })
      .filter((instance) =>
        `${instance.name} ${instance.version} ${instance.loader}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .sort((left, right) => {
        const result = left.name.localeCompare(right.name, locale);
        return sortAscending ? result : -result;
      });
  }, [filter, instances, query, sortAscending, locale]);

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
          <p className="eyebrow">{t("library.eyebrow")}</p>
          <h1>{t("library.title")}</h1>
          <p>{t("library.count", { count: instances.length })}</p>
        </div>
        <div className="page-heading__actions">
          <div className="dropdown-wrapper" ref={importMenuRef}>
            <button
              className="button button--secondary"
              data-capture-target="import-menu"
              onClick={() => setImportMenuOpen((prev) => !prev)}
            >
              <Download size={15} />
              <span>{t("library.importMenu")}</span>
              <ChevronDown size={14} />
            </button>
            {importMenuOpen && (
              <div className="dropdown-menu dropdown-menu--right">
                <button
                  className="dropdown-item"
                  data-capture-target="migrate-item"
                  onClick={() => {
                    setImportMenuOpen(false);
                    onMigrate();
                  }}
                >
                  <Rocket size={15} />
                  <div>
                    <strong>{t("migration.headerButton")}</strong>
                    <small>CurseForge, Prism, Modrinth, Vanilla</small>
                  </div>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setImportMenuOpen(false);
                    onImport();
                  }}
                >
                  <PackagePlus size={15} />
                  <div>
                    <strong>{t("library.import")}</strong>
                    <small>.mrpack, .zip</small>
                  </div>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setImportMenuOpen(false);
                    onImportBackup();
                  }}
                >
                  <ArchiveRestore size={15} />
                  <div>
                    <strong>{t("library.restore")}</strong>
                    <small>.scopepack · .onyxpack · .zip</small>
                  </div>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setImportMenuOpen(false);
                    onImportLink?.();
                  }}
                >
                  <Share2 size={15} />
                  <div>
                    <strong>{t("library.syncImport")}</strong>
                    <small>Scope Share link</small>
                  </div>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setImportMenuOpen(false);
                    onImportSync();
                  }}
                >
                  <FileCode size={15} />
                  <div>
                    <strong>{t("library.syncImportFile")}</strong>
                    <small>.scopeprofile</small>
                  </div>
                </button>
              </div>
            )}
          </div>

          {onJoinParty && (
            <button
              className="button button--secondary"
              onClick={onJoinParty}
              title={t("library.joinPartyTitle")}
            >
              <Users2 size={16} />
              <span>{t("library.joinParty")}</span>
            </button>
          )}

          <button className="button button--primary" onClick={onCreate}>
            <Plus size={16} />
            <span>{t("library.create")}</span>
          </button>
        </div>
      </div>

      <div className="library-toolbar">
        <label className="input-shell input-shell--search">
          <Search size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("library.search")}
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label={t("library.clear")}>
              ×
            </button>
          )}
        </label>
        <div className="filter-tabs">
          {(
            [
              ["all", t("library.filter.all")],
              ["favorite", t("library.filter.favorite")],
              ["fabric", "Fabric"],
              ["forge", "Forge"],
              ["neoforge", "NeoForge"],
              ["quilt", "Quilt"],
              ["vanilla", "Vanilla"],
            ] as Array<[Filter, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "is-active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="toolbar-icon"
          title={sortAscending ? t("library.sortAsc") : t("library.sortDesc")}
          onClick={() => setSortAscending((value) => !value)}
        >
          <ArrowDownAZ size={17} />
        </button>
        <button
          className="toolbar-icon"
          title={t("library.reset")}
          onClick={() => {
            setFilter("all");
            setQuery("");
          }}
        >
          <SlidersHorizontal size={17} />
        </button>
        <div className="view-toggle">
          <button
            className={!compact ? "is-active" : ""}
            onClick={() => setCompact(false)}
            aria-label={t("library.grid")}
          >
            <Grid2X2 size={15} />
          </button>
          <button
            className={compact ? "is-active" : ""}
            onClick={() => setCompact(true)}
            aria-label={t("library.compact")}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {filtered.length ? (
        <div
          className={`instance-grid ${compact ? "instance-grid--compact" : ""}`}
        >
          {filtered.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              compact={compact}
              onPlay={onPlay}
              onFavorite={onFavorite}
              onMenu={onMenu}
              onCheck={onCheck}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span>
            <PackageOpen size={28} />
          </span>
          <h2>{t("library.empty")}</h2>
          <p>{t("library.emptyHint")}</p>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <button className="button button--secondary" onClick={onCreate}>
              <Plus size={16} /> {t("library.create")}
            </button>
            <button className="button button--secondary" onClick={onMigrate}>
              <Rocket size={16} /> {t("migration.headerButton")}
            </button>
          </div>

          <div className="migration-banner">
            <div className="migration-banner__info">
              <h4>{t("migration.banner.title")}</h4>
              <p>{t("migration.banner.description")}</p>
            </div>
            <button className="button button--primary" onClick={onMigrate}>
              <Rocket size={15} />
              {t("migration.banner.button")}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
