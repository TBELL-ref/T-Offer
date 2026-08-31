import { TOfferSupabase } from "./supabase.js";

const STAGE_LABELS = {
  new: "신규",
  mail_ready: "메일 대기",
  mailed: "발송 완료",
  replied: "회신",
  meeting: "미팅",
  won: "성약",
  lost: "드롭"
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

function matchesTab(c) {
  if (c.is_hidden) return state.tab === "excluded";
  if (state.tab === "excluded") return false;
  if (state.tab === "recommended") return !!c.is_recommended;
  if (state.tab === "mail_ready") return stageOf(c) === "mail_ready" || c.mail_status === "ready";
  if (state.tab === "progress") {
    return ["mailed", "replied", "meeting", "won"].includes(stageOf(c));
  }
  if (state.tab === "new") {
    return stageOf(c) === "new" && !c.is_recommended;
  }
  if (state.tab === "all") return true;
  return true;
}

function matchesQuery(c) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const blob = [c.company_name, c.latest_offer_title, c.domain, c.memo]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function renderMeta(data) {
  const n = (data.companies || []).filter((c) => !c.is_hidden).length;
  const posts = (data.posts || []).length;
  $("#metaLine").textContent = `활성 리드 ${n} · 공고 ${posts} · 갱신 ${data.generatedAt || "—"}`;
}

function renderList() {
  const list = $("#leadList");
  const rows = state.companies.filter(matchesTab).filter(matchesQuery);
  $("#countLine").textContent = `${rows.length}건`;
  if (!rows.length) {
    list.innerHTML = `<div class="empty">이 탭에 표시할 리드가 없습니다. 마이그레이션·수집 후 새로고침하세요.</div>`;
    return;
  }
  list.innerHTML = rows
    .map((c) => {
      const grade = c.lead_grade || "—";
      const stage = STAGE_LABELS[stageOf(c)] || stageOf(c);
      const title = c.latest_offer_title || "(공고 제목 없음)";
      const url = c.latest_offer_url || "";
      return `<article class="card" data-id="${c.company_id}">
        <div class="card-top">
          <h3>${escapeHtml(c.company_name || c.company_id)}</h3>
          <span class="grade">${escapeHtml(grade)}</span>
        </div>
        <p class="post">${
          url
            ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
            : escapeHtml(title)
        }</p>
        <div class="meta">
          <span>${escapeHtml(stage)}</span>
          <span>메일 ${escapeHtml(c.mail_status || "none")}</span>
          <span>점수 ${escapeHtml(String(c.priority_score ?? 0))}</span>
        </div>
        ${c.memo ? `<p class="memo">${escapeHtml(c.memo)}</p>` : ""}
      </article>`;
    })
    .join("");
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
        posts: snap.posts || []
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
    $("#status").textContent = missingRpc
      ? "DB 미준비 — 034_offer_schema.sql 을 Supabase SQL Editor에서 실행하세요"
      : "로드 실패";
    $("#leadList").innerHTML = missingRpc
      ? `<div class="empty error">
          <strong>offer RPC가 아직 없습니다.</strong><br />
          Supabase → SQL Editor →
          <code>supabase/migrations/034_offer_schema.sql</code>
          전체를 실행한 뒤 새로고침하세요.
        </div>`
      : `<div class="empty error">${escapeHtml(msg)}</div>`;
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
