import { useState, useEffect } from "react";
import { Star, MessageSquarePlus, ExternalLink, Inbox, Loader2 } from "lucide-react";
import packageJson from "../../package.json";
import { useI18n } from "../i18n";
import type { LauncherSettings } from "../types";

const ONYX_HUB_API = "https://onyx-launcher-hub.vercel.app/api/v1";

interface CommunityReview {
  id: string;
  type: "review" | "bug" | "feature";
  rating?: number;
  title: string;
  comment: string;
  contact?: string;
  status: string;
  admin_notes?: string;
  launcher_version?: string;
  upvotes?: number;
  tags?: string[];
  created_at: string;
}

export function CommunityPage({
  settings: _settings,
  onNotify,
}: {
  settings?: LauncherSettings;
  onNotify?: (tone: "success" | "warning" | "info", title: string, message: string) => void;
}) {
  const { locale } = useI18n();
  const isRu = locale === "ru";

  const [reviews, setReviews] = useState<CommunityReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "review" | "feature" | "bug">("all");
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [formType, setFormType] = useState<"review" | "feature" | "bug">("review");
  const [formRating, setFormRating] = useState(5);
  const [formTitle, setFormTitle] = useState("");
  const [formComment, setFormComment] = useState("");
  const [formContact, setFormContact] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${ONYX_HUB_API}/feedback`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setReviews(json.data);
      }
    } catch (err) {
      console.error("Failed to load community feedback", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formComment.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${ONYX_HUB_API}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formType,
          rating: formType === "review" ? formRating : undefined,
          title: formTitle.trim(),
          comment: formComment.trim(),
          contact: formContact.trim() || undefined,
          launcher_version: packageJson.version,
          os: navigator.userAgent.includes("Mac") ? "macOS" : "Windows",
          arch: "arm64",
          tags: [formType === "review" ? "Review" : formType === "bug" ? "Bug" : "Suggestion"],
        }),
      });

      if (res.ok) {
        onNotify?.("success", isRu ? "Отзыв отправлен" : "Feedback sent", isRu ? "Спасибо! Ваш отзыв опубликован." : "Thank you! Your feedback is live.");
        setModalOpen(false);
        setFormTitle("");
        setFormComment("");
        setFormContact("");
        fetchReviews();
      }
    } catch {
      onNotify?.("warning", isRu ? "Ошибка отправки" : "Submission failed", isRu ? "Не удалось связаться с сервером." : "Could not reach Scope Hub.");
    } finally {
      setSubmitting(false);
    }
  };

  const reviewsWithRating = reviews.filter((r) => r.rating);
  const avgRating = reviewsWithRating.length > 0
    ? (reviewsWithRating.reduce((acc, r) => acc + (r.rating || 0), 0) / reviewsWithRating.length).toFixed(1)
    : "—";

  const filtered = reviews.filter((r) => (activeTab === "all" ? true : r.type === activeTab));

  return (
    <div className="page-stack" style={{ padding: "28px 36px", maxWidth: 960, margin: "0 auto", overflowY: "auto", height: "100%" }}>
      {/* Clean Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 18, borderBottom: "1px solid var(--line)" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "0 0 6px 0" }}>
            {isRu ? "Сообщество и отзывы" : "Community & Feedback"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-soft)", margin: 0 }}>
            {isRu ? "Оставляйте отзывы о лаунчере, предлагайте новые идеи и сообщайте о багах." : "Share impressions, suggest features, and report issues directly to developers."}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="button button--primary"
            onClick={() => setModalOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12, cursor: "pointer" }}
          >
            <MessageSquarePlus size={15} />
            <span>{isRu ? "Написать" : "Leave Feedback"}</span>
          </button>

          <a
            href="https://onyx-launcher-hub.vercel.app/reviews"
            target="_blank"
            rel="noreferrer"
            className="button button--ghost"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: 12, textDecoration: "none", color: "var(--text-soft)" }}
          >
            <span>{isRu ? "Веб-версия" : "Web Hub"}</span>
            <ExternalLink size={13} />
          </a>
        </div>
      </div>

      {/* Rating & Counter summary (only if reviews exist) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 18px", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: reviewsWithRating.length > 0 ? "#f59e0b" : "var(--text-soft)" }}>
              {avgRating}
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              {[1, 2, 3, 4, 5].map((s) => {
                const filled = reviewsWithRating.length > 0 && s <= Math.round(Number(avgRating));
                return (
                  <Star
                    key={s}
                    size={14}
                    fill={filled ? "#f59e0b" : "none"}
                    color={filled ? "#f59e0b" : "var(--line-strong, #374151)"}
                    opacity={filled ? 1 : 0.4}
                  />
                );
              })}
            </div>
            <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
              ({reviewsWithRating.length} {isRu ? "оценок" : "ratings"})
            </span>
          </div>

          <span style={{ width: 1, height: 16, background: "var(--line)" }} />

          <div style={{ fontSize: 12, color: "var(--text-soft)" }}>
            {isRu ? "Всего записей: " : "Total entries: "}
            <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>{reviews.length}</strong>
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "review", "feature", "bug"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "5px 10px",
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                background: activeTab === tab ? "var(--surface-hover)" : "transparent",
                color: activeTab === tab ? "var(--text)" : "var(--text-soft)",
                border: activeTab === tab ? "1px solid var(--line-strong)" : "1px solid transparent",
              }}
            >
              {tab === "all" ? (isRu ? "Все" : "All") : tab === "review" ? (isRu ? "Отзывы" : "Reviews") : tab === "feature" ? (isRu ? "Идеи" : "Ideas") : (isRu ? "Баги" : "Bugs")}
            </button>
          ))}
        </div>
      </div>

      {/* Feed list */}
      {loading ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          <Loader2 size={24} className="spin" style={{ margin: "0 auto 8px" }} />
          <p style={{ fontSize: 13 }}>{isRu ? "Загрузка..." : "Loading..."}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--line)", borderRadius: 8, padding: 36, textAlign: "center" }}>
          <Inbox size={28} style={{ color: "var(--text-muted)", margin: "0 auto 8px" }} />
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>
            {isRu ? "В этой категории пока ничего нет" : "No entries in this category yet"}
          </h3>
          <p style={{ fontSize: 12, color: "var(--text-soft)", margin: 0 }}>
            {isRu ? "Нажмите «Написать», чтобы оставить первое сообщение." : "Click «Leave Feedback» to submit the first entry."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((item) => {
            const isReview = item.type === "review";
            const isBug = item.type === "bug";
            const typeLabel = isReview ? (isRu ? "Отзыв" : "Review") : isBug ? (isRu ? "Баг" : "Bug") : (isRu ? "Идея" : "Idea");
            const typeColor = isReview ? "#10b981" : isBug ? "#f87171" : "#38bdf8";

            return (
              <div key={item.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.04)", color: typeColor, border: `1px solid ${typeColor}33` }}>
                      {typeLabel}
                    </span>
                    {item.rating && (
                      <div style={{ display: "flex", gap: 2 }}>
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} size={11} fill={i < item.rating! ? "#f59e0b" : "none"} color={i < item.rating! ? "#f59e0b" : "#4b5563"} />
                        ))}
                      </div>
                    )}
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>{item.title}</h4>
                  </div>

                  {item.type !== "review" && (
                    <div>
                      {item.type === "feature" ? (
                        item.status === "resolved" ? (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
                            {isRu ? "Добавлено" : "Added"}
                          </span>
                        ) : item.status === "in_progress" ? (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(168, 85, 247, 0.15)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.3)" }}>
                            {isRu ? "В разработке" : "In Progress"}
                          </span>
                        ) : item.status === "archived" ? (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(255, 255, 255, 0.05)", color: "var(--text-muted)" }}>
                            {isRu ? "Отклонено" : "Declined"}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.3)" }}>
                            {isRu ? "На рассмотрении" : "Under Review"}
                          </span>
                        )
                      ) : (
                        item.status === "resolved" ? (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
                            {isRu ? "Пофикшено" : "Resolved"}
                          </span>
                        ) : item.status === "in_progress" ? (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
                            {isRu ? "В работе" : "Fixing"}
                          </span>
                        ) : item.status === "archived" ? (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(255, 255, 255, 0.05)", color: "var(--text-muted)" }}>
                            {isRu ? "Отклонено" : "Closed"}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: "rgba(239, 68, 68, 0.15)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                            {isRu ? "Новый" : "New"}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>

                <p style={{ fontSize: 12, color: "var(--text-soft)", margin: "6px 0 10px", lineHeight: 1.5, whiteSpace: "pre-line" }}>
                  {item.comment}
                </p>

                {item.admin_notes && (
                  <div
                    style={{
                      margin: "8px 0 10px",
                      padding: "10px 12px",
                      background: "rgba(168, 85, 247, 0.08)",
                      border: "1px solid rgba(168, 85, 247, 0.25)",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          color: "#c084fc",
                          letterSpacing: "0.05em",
                          fontFamily: "monospace",
                        }}
                      >
                        {isRu ? "Ответ разработчика" : "Developer Response"}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-line" }}>
                      {item.admin_notes}
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-muted)", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <span>{item.contact ? item.contact : (isRu ? "Анонимный игрок" : "Anonymous")} • v{item.launcher_version || "2.0.4"}</span>
                  <span>{new Date(item.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Submission Modal */}
      {modalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 12, padding: 24, width: "100%", maxWidth: 460 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px", color: "var(--text)" }}>
              {isRu ? "Отправить отзыв в Scope Hub" : "Submit Feedback to Scope Hub"}
            </h3>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 6, background: "var(--surface-soft)", padding: 4, borderRadius: 6 }}>
                {(["review", "feature", "bug"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFormType(t)}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "none",
                      background: formType === t ? "var(--surface-hover)" : "transparent",
                      color: formType === t ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    {t === "review" ? (isRu ? "Отзыв" : "Review") : t === "feature" ? (isRu ? "Идея" : "Idea") : (isRu ? "Баг" : "Bug")}
                  </button>
                ))}
              </div>

              {formType === "review" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--surface-soft)", borderRadius: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--text)" }}>{isRu ? "Оценка лаунчера:" : "Your rating:"}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button key={s} type="button" onClick={() => setFormRating(s)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                        <Star size={16} fill={s <= formRating ? "#f59e0b" : "none"} color={s <= formRating ? "#f59e0b" : "#4b5563"} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                  {isRu ? "Заголовок" : "Title"}
                </label>
                <input
                  type="text"
                  required
                  placeholder={isRu ? "Коротко о сути" : "Summary"}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, background: "var(--surface-soft)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                  {isRu ? "Описание" : "Description"}
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder={isRu ? "Подробный фидбек, что улучшить..." : "Details, impressions, ideas..."}
                  value={formComment}
                  onChange={(e) => setFormComment(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, background: "var(--surface-soft)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 12, resize: "none", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                  {isRu ? "Контакт (Telegram, Discord, необязательно)" : "Contact (Discord, Telegram, optional)"}
                </label>
                <input
                  type="text"
                  placeholder="@tag"
                  value={formContact}
                  onChange={(e) => setFormContact(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, background: "var(--surface-soft)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="button button--ghost"
                  style={{ padding: "8px 14px", fontSize: 12, cursor: "pointer" }}
                >
                  {isRu ? "Отмена" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="button button--primary"
                  style={{ padding: "8px 16px", fontSize: 12, cursor: "pointer" }}
                >
                  {submitting ? (isRu ? "Отправка..." : "Sending...") : (isRu ? "Отправить" : "Submit")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
