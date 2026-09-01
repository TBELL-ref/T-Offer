import { TOfferSupabase } from "./supabase.js";

const STAGE_LABELS = {
  new: "신규",
  mail_ready: "메일대기",
  mailed: "발송",
  replied: "회신",
  meeting: "미팅",
  won: "성약",
  lost: "드롭"
};

const SOURCE_LABELS = {
  albamon: "알바몬",
  albaheaven: "알바천국",
  saramin: "사람인",
  jobkorea: "잡코리아",
  google: "구글",
  fixture: "fixture"
};

const state = {
  tab: "new",
  companies: [],
  posts: [],
  query: ""
};

function $(sel) {
  return document.querySelector(sel);
}

function stageOf(c) {
  return c.stage || "new";
}

function sourceOf(c) {
  const post = state.posts.find(
    (p) =>
      p.company_id === c.company_id ||
      p.companyId === c.company_id ||
      p.url === c.latest_offer_url
  );
  return post?.source || c.source || "";
}

function matchesTab(c) {
  if (c.is_hidden || c.exclude_reason) return state.tab === "excluded";
  if (state.tab === "excluded") return false;
  if (state.tab === "recommended") return !!c.is_recommended;
  if (state.tab === "mail_ready") return stageOf(c) === "mail_ready" || c.mail_status === "ready";
  if (state.tab === "progress") {
    return ["mailed", "replied", "meeting", "won"].includes(stageOf(c));
  }
  if (state.tab === "new") return stageOf(c) === "new" && !c.is_recommended;
  if (state.tab === "all") return true;
  return true;
}

function matchesQuery(c) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const blob = [c.company_name, c.latest_offer_title, c.domain, c.memo, sourceOf(c)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function escapeHtml(s) {
  return `${s ?? ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { hour12: false });
  } catch {
    return iso;
  }
}

function updateCounts() {
  const buckets = {
    new: 0,
    recommended: 0,
    mail_ready: 0,
    progress: 0,
    all: 0,
    excluded: 0
  };
  for (const c of state.companies) {
    const hidden = !!(c.is_hidden || c.exclude_reason);
    if (hidden) {
      buckets.excluded += 1;
      continue;
    }
    buckets.all += 1;
    if (c.is_recommended) buckets.recommended += 1;
    if (stageOf(c) === "new" && !c.is_recommended) buckets.new += 1;
    if (stageOf(c) === "mail_ready" || c.mail_status === "ready") buckets.mail_ready += 1;
    if (["mailed", "replied", "meeting", "won"].includes(stageOf(c))) buckets.progress += 1;
  }
  for (const [k, v] of Object.entries(buckets)) {
    const el = document.querySelector(`[data-count="${k}"]`);
    if (el) el.textContent = String(v);
  }
}

function renderMeta(data) {
  const n = (data.companies || []).filter((c) => !(c.is_hidden || c.exclude_reason)).length;
  const posts = (data.posts || []).filter((p) => (p.classify_label || "offer") === "offer").length;
  $("#metaLine").textContent = `리드 ${n} · 공고 ${posts} · ${formatTime(data.generatedAt)}`;
}

function renderList() {
  const body = $("#leadBody");
  const empty = $("#empty");
  const rows = state.companies.filter(matchesTab).filter(matchesQuery);
  updateCounts();

  if (!rows.length) {
    body.innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = "표시할 리드가 없습니다.";
    empty.classList.toggle("error", false);
    return;
  }
  empty.classList.add("hidden");

  body.innerHTML = rows
    .map((c) => {
      const grade = (c.lead_grade || "C").toUpperCase();
      const gradeClass =
        grade === "A" ? "badge-a" : grade === "B" ? "badge-b" : "badge-c";
      const stage = STAGE_LABELS[stageOf(c)] || stageOf(c);
      const title = c.latest_offer_title || "(공고 없음)";
      const url = c.latest_offer_url || "";
      const srcKey = sourceOf(c);
      const src = SOURCE_LABELS[srcKey] || srcKey || "—";
      return `<tr>
        <td><span class="badge ${gradeClass}">${escapeHtml(grade)}</span></td>
        <td class="co-name">${escapeHtml(c.company_name || c.company_id)}</td>
        <td>${
          url
            ? `<a class="post-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
            : escapeHtml(title)
        }</td>
        <td><span class="badge badge-src">${escapeHtml(src)}</span></td>
        <td>${escapeHtml(stage)}</td>
        <td>${escapeHtml(c.mail_status || "none")}</td>
        <td class="col-score">${escapeHtml(String(c.priority_score ?? 0))}</td>
      </tr>`;
    })
    .join("");
}

async function load() {
  $("#status").textContent = "불러오는 중…";
  try {
    let data;
    try {
      data = await TOfferSupabase.getDashboard();
    } catch {
      const snap = await TOfferSupabase.getSnapshot();
      data = {
        generatedAt: snap.generatedAt,
        companies: (snap.companies || []).map((c) => ({
          company_id: c.companyId,
          company_name: c.companyName,
          lead_grade: c.leadGrade,
          priority_score: c.priorityScore,
          latest_offer_title: c.latestOfferTitle,
          latest_offer_url: c.latestOfferUrl,
          offer_post_count: c.offerPostCount,
          stage: "new",
          mail_status: "none",
          is_hidden: false,
          is_recommended: false
        })),
        posts: (snap.posts || []).map((p) => ({
          ...p,
          company_id: p.companyId,
          classify_label: "offer"
        }))
      };
    }
    state.companies = data.companies || [];
    state.posts = data.posts || [];
    renderMeta(data);
    renderList();
    $("#status").textContent = "준비됨";
  } catch (err) {
    console.error(err);
    const msg = `${err.message ?? err}`;
    const missingRpc = /get_offer_published_snapshot|PGRST202|schema cache/i.test(msg);
    $("#status").textContent = missingRpc ? "DB RPC 없음" : "로드 실패";
    $("#leadBody").innerHTML = "";
    const empty = $("#empty");
    empty.classList.remove("hidden");
    empty.classList.add("error");
    empty.textContent = missingRpc
      ? "offer RPC가 없습니다. 034_offer_schema.sql 을 실행하세요."
      : msg;
  }
}

function bind() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.tab = btn.getAttribute("data-tab");
      renderList();
    });
  });
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });
  $("#reload").addEventListener("click", () => load());
}

bind();
load();
