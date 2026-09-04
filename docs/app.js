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

const PROGRESS_STAGES = new Set(["mail_ready", "mailed", "replied", "meeting", "won"]);

const SOURCE_LABELS = {
  albamon: "알바몬",
  albaheaven: "알바천국",
  saramin: "사람인",
  jobkorea: "잡코리아",
  google: "구글",
  wanted: "원티드",
  remember: "리멤버",
  incruit: "인크루트",
  linkedin: "링크드인",
  fixture: "fixture"
};

const PAGE_SIZE = 50;
const ALBA_LS_KEY = "toffer-alba-tags-v1";

const state = {
  view: "companies",
  tab: "new",
  empFilter: "alba",
  postFilter: "open",
  page: 1,
  /** Active list for current emp tab */
  companies: [],
  /** Offer leads only */
  offerCompanies: [],
  /** T-Client universe (전체) */
  allCompanies: [],
  posts: [],
  clientRows: [],
  clientPosts: null,
  edits: {},
  offerMgmt: {},
  albaTags: new Set(),
  albaDenied: new Set(),
  /** Precomputed company_ids with alba offer posts */
  albaPostCompanyIds: new Set(),
  query: "",
  userEmail: "",
  busyId: "",
  detailId: "",
  /** null | summary | contacts | profile | crm */
  detailEdit: null,
  passwordSetup: false,
  generatedAt: ""
};

function loadAlbaTagState() {
  try {
    const raw = JSON.parse(localStorage.getItem(ALBA_LS_KEY) || "{}");
    state.albaTags = new Set(raw.tagged || []);
    state.albaDenied = new Set(raw.denied || []);
  } catch {
    state.albaTags = new Set();
    state.albaDenied = new Set();
  }
}

function persistAlbaTagState() {
  localStorage.setItem(
    ALBA_LS_KEY,
    JSON.stringify({ tagged: [...state.albaTags], denied: [...state.albaDenied] })
  );
}

function $(sel) {
  return document.querySelector(sel);
}

function stageOf(c) {
  return c.stage || "new";
}

function isExcluded(c) {
  return !!(c.is_hidden || c.exclude_reason);
}

function poolOf(c) {
  if (isExcluded(c)) return "hidden";
  if (c.is_recommended) return "recommended";
  return "normal";
}

function isProgress(c) {
  if (PROGRESS_STAGES.has(stageOf(c))) return true;
  return c.mail_status === "ready";
}

function displayName(c) {
  const edit = state.edits[c.company_id];
  return edit?.companyNameKo || c.company_name || c.company_id || "—";
}

function companyName(id) {
  const c =
    state.companies.find((x) => x.company_id === id || x.companyId === id) ||
    state.offerCompanies.find((x) => x.company_id === id) ||
    state.allCompanies.find((x) => x.company_id === id);
  if (c) return displayName(c);
  const edit = state.edits[id];
  return edit?.companyNameKo || id || "—";
}

function findCompany(id) {
  return (
    state.companies.find((x) => x.company_id === id) ||
    state.offerCompanies.find((x) => x.company_id === id) ||
    state.allCompanies.find((x) => x.company_id === id) ||
    null
  );
}

function syncCompanyEverywhere(companyId, mutator) {
  for (const list of [state.companies, state.offerCompanies, state.allCompanies]) {
    const c = list.find((x) => x.company_id === companyId);
    if (c) mutator(c);
  }
}

function normalizeContactEntry(raw = {}) {
  return {
    name: `${raw.name ?? ""}`.trim(),
    email: `${raw.email ?? ""}`.trim(),
    phone: `${raw.phone ?? ""}`.trim()
  };
}

function hasContactData(c) {
  return Boolean(c?.name || c?.email || c?.phone);
}

function contactOf(c) {
  const list = contactsOf(c);
  return list[0] || { name: "", email: "", phone: "" };
}

function contactsOf(c) {
  const edit = state.edits[c.company_id]?.contact || {};
  if (Array.isArray(edit.contacts) && edit.contacts.length) {
    return edit.contacts.map(normalizeContactEntry).filter(hasContactData);
  }
  const single = normalizeContactEntry({
    name: edit.name || c.contact_name || "",
    email: edit.email || c.contact_email || "",
    phone: edit.phone || c.contact_phone || ""
  });
  if (hasContactData(single)) return [single];
  const fromRow = Array.isArray(c.contact?.contacts) ? c.contact.contacts : null;
  if (fromRow?.length) return fromRow.map(normalizeContactEntry).filter(hasContactData);
  const rowSingle = normalizeContactEntry(c.contact || {});
  return hasContactData(rowSingle) ? [rowSingle] : [];
}

function buildContactPatch(contacts) {
  const list = contacts.map(normalizeContactEntry).filter(hasContactData);
  const primary = list[0] ?? { name: "", email: "", phone: "" };
  return { ...primary, contacts: list };
}

function profileOf(c) {
  const edit = state.edits[c.company_id]?.profile || {};
  const base = c.profile || {};
  return { ...base, ...edit };
}

function postStatusOf(p) {
  const s = `${p.status || p.postStatus || "open"}`.toLowerCase();
  if (s === "closed" || s === "expired" || s === "ended") return "closed";
  if (/^closed:/i.test(p.raw_snippet || p.rawSnippet || "")) return "closed";
  return "open";
}

function isClosedPost(p) {
  return postStatusOf(p) === "closed";
}

function offerPosts() {
  return (state.posts || []).filter((p) => (p.classify_label || p.classifyLabel || "offer") === "offer");
}

/** Same rule as Offer classifier isAlbaBoardSource + explicit 알바/아르바이트 labels. */
function isAlbaPost(p) {
  const src = `${p.source || ""}`.toLowerCase();
  const url = `${p.url || ""}`;
  if (src === "albamon" || src === "albaheaven") return true;
  if (src === "google" && /albamon\.com|alba\.co\.kr/i.test(url)) return true;
  const emp = `${p.employment_type || p.employmentType || ""}`;
  if (/알바|아르바이트/i.test(emp)) return true;
  const title = `${p.title || ""}`;
  if (/알바|아르바이트/i.test(title)) return true;
  return false;
}

function matchesEmpFilter(p) {
  // 전체 = Offer board 전체 (T-Client 전체와 같이 필터 없이)
  if (state.empFilter === "all") return true;
  // 알바 = 수집기에서 알바 채널/알바로 잡은 공고만
  return isAlbaPost(p);
}

function matchesPostFilter(p) {
  if (state.empFilter === "alba") {
    if ((p.classify_label || p.classifyLabel) === "client") return false;
    if (!isAlbaPost(p)) return false;
  }
  if (state.postFilter === "all") return true;
  return postStatusOf(p) === state.postFilter;
}

function listViewPosts() {
  if (state.empFilter === "all") {
    if (!state.clientPosts) state.clientPosts = flattenClientPosts(state.clientRows);
    return state.clientPosts;
  }
  return offerPosts().filter(isAlbaPost);
}

function companyHasVisiblePost(c) {
  if (isExcluded(c) && state.tab === "excluded") return true;
  if (state.empFilter === "all") return true;
  return isInAlbaPool(c);
}

function rebuildAlbaPostIndex() {
  const ids = new Set();
  for (const p of offerPosts()) {
    if (!isAlbaPost(p)) continue;
    const id = p.company_id || p.companyId;
    if (id) ids.add(id);
  }
  state.albaPostCompanyIds = ids;
}

function hasAlbaPost(c) {
  const id = c.company_id || c.companyId;
  return state.albaPostCompanyIds.has(id);
}

function isInAlbaPool(c) {
  const id = c.company_id || c.companyId;
  if (!id) return false;
  if (state.albaDenied.has(id)) return false;
  if (state.albaTags.has(id) || c.is_alba) return true;
  return state.albaPostCompanyIds.has(id);
}

function rebuildActiveCompanies() {
  if (state.empFilter === "alba") {
    const byId = new Map();
    for (const c of state.offerCompanies) {
      if (isInAlbaPool(c)) byId.set(c.company_id, c);
    }
    for (const c of state.allCompanies) {
      if (isInAlbaPool(c) && !byId.has(c.company_id)) byId.set(c.company_id, c);
    }
    state.companies = [...byId.values()];
  } else {
    state.companies = state.allCompanies.slice();
  }
  state.page = 1;
}

function filteredCompanyRows() {
  return state.companies.filter(matchesTab).filter(matchesQueryCompany).filter(companyHasVisiblePost);
}

function pagedSlice(rows) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * PAGE_SIZE;
  return { rows: rows.slice(start, start + PAGE_SIZE), total, pages };
}

function renderPager(total, pages) {
  const pager = $("#pager");
  if (!pager) return;
  if (total <= PAGE_SIZE) {
    pager.classList.add("hidden");
    return;
  }
  pager.classList.remove("hidden");
  $("#pagerInfo").textContent = `${state.page} / ${pages} · ${total}건`;
  $("#pagerPrev").disabled = state.page <= 1;
  $("#pagerNext").disabled = state.page >= pages;
}

function mapClientRow(row, offerMap) {
  const id = row.companyId || row.company_id;
  const offer = offerMap.get(id) || {};
  const mgmt = state.offerMgmt[id] || {};
  const posts = Array.isArray(row.posts) ? row.posts : [];
  const first = posts[0] || {};
  // Keep only a slim first-post hint — full Client post arrays cause UI jank.
  return {
    company_id: id,
    company_name: row.companyNameKo || row.companyName || offer.company_name || id,
    domain: row.domain || offer.domain || "",
    homepage: row.profile?.homepage || offer.homepage || "",
    company_tier: row.companyTier || offer.company_tier || "",
    profile: row.profile || {},
    contact: row.contact || {},
    contact_name: row.contact?.name || offer.contact_name || "",
    contact_phone: row.contact?.phone || offer.contact_phone || "",
    contact_email: row.contact?.email || row.email || offer.contact_email || "",
    lead_grade: row.leadGrade || offer.lead_grade || "C",
    priority_score: row.priorityScore ?? offer.priority_score ?? 0,
    score_reason: row.scoreReason || offer.score_reason || "",
    latest_offer_title: offer.latest_offer_title || first.title || "",
    latest_offer_url: offer.latest_offer_url || first.url || "",
    offer_post_count: offer.offer_post_count || 0,
    is_recommended: offer.is_recommended ?? mgmt.isRecommended ?? false,
    is_hidden: offer.is_hidden ?? mgmt.isHidden ?? !!(row.excluded || row.excludeReason),
    is_alba: offer.is_alba ?? mgmt.isAlba ?? false,
    stage: offer.stage || mgmt.stage || "new",
    status: offer.status || mgmt.status || "active",
    mail_status: offer.mail_status || mgmt.mailStatus || "none",
    mailed_at: offer.mailed_at || mgmt.mailedAt || null,
    memo: offer.memo || mgmt.memo || "",
    recommend_score: offer.recommend_score ?? mgmt.recommendScore ?? 0,
    closed_reason: offer.closed_reason || mgmt.closedReason || "",
    exclude_reason: row.excludeReason || offer.exclude_reason || "",
    remark: row.remark || "",
    _pool: "client",
    _clientPosts: first.title
      ? [{ title: first.title, url: first.url, source: first.source, status: first.status || "open" }]
      : []
  };
}

function flattenClientPosts(rows) {
  const out = [];
  for (const row of rows || []) {
    const id = row.companyId || row.company_id;
    // Only first post per company for 전체 공고 view (avoids 10k+ DOM rows)
    const p = (row.posts || [])[0];
    if (!p) continue;
    out.push({
      company_id: id,
      title: p.title,
      url: p.url,
      source: p.source,
      status: p.status || "open",
      classify_label: "client",
      collected_at: p.collectedAt || p.collected_at || "",
      employment_type: "",
      part_time_score: 0
    });
  }
  return out;
}

function sourceOfCompany(c) {
  const post = state.posts.find(
    (p) =>
      p.company_id === c.company_id ||
      p.companyId === c.company_id ||
      p.url === c.latest_offer_url ||
      p.url === c.latestOfferUrl
  );
  return post?.source || c.source || "";
}

function postsForCompany(c) {
  const id = c.company_id || c.companyId;
  const offer = offerPosts().filter((p) => (p.company_id || p.companyId) === id);
  if (offer.length) return offer;
  if (Array.isArray(c._clientPosts) && c._clientPosts.length) {
    return c._clientPosts.map((p) => ({
      ...p,
      company_id: id,
      classify_label: "client",
      collected_at: p.collectedAt || p.collected_at || ""
    }));
  }
  return state.clientPosts.filter((p) => p.company_id === id);
}

function latestPostForCompany(c) {
  const id = c.company_id || c.companyId;
  const url = c.latest_offer_url || c.latestOfferUrl || "";
  const byUrl = state.posts.find((p) => p.url === url) || state.clientPosts.find((p) => p.url === url);
  if (byUrl) return byUrl;
  const list = postsForCompany(c);
  const open = list.find((p) => !isClosedPost(p));
  return open || list[0] || null;
}

function matchesTab(c) {
  if (isExcluded(c)) return state.tab === "excluded";
  if (state.tab === "excluded") return false;
  if (state.tab === "recommended") return !!c.is_recommended && !isProgress(c);
  if (state.tab === "progress") return isProgress(c);
  if (state.tab === "new") return stageOf(c) === "new" && !c.is_recommended && !isProgress(c);
  if (state.tab === "all") return true;
  return true;
}

function matchesQueryCompany(c) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const contact = contactOf(c);
  const blob = [
    displayName(c),
    c.latest_offer_title,
    c.domain,
    c.memo,
    contact.email,
    contact.name,
    sourceOfCompany(c)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function matchesQueryPost(p) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const co = companyName(p.company_id || p.companyId);
  const blob = [co, p.title, p.source, p.url, postStatusOf(p)].filter(Boolean).join(" ").toLowerCase();
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
    return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  } catch {
    return `${iso}`;
  }
}

function statusBadge(st) {
  if (st === "closed") return `<span class="badge badge-closed">마감</span>`;
  return `<span class="badge badge-open">모집</span>`;
}

function requireLogin() {
  if (state.userEmail) return true;
  $("#status").textContent = "로그인 후 가능합니다. 우측 「관리」에서 로그인하세요.";
  openAdminPopover();
  return false;
}

function setAdminStatus(msg, show = true) {
  const el = $("#adminStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("hidden", !show || !msg);
  el.setAttribute("aria-hidden", show && msg ? "false" : "true");
}

function setAdminUi({ passwordSetup = state.passwordSetup } = {}) {
  state.passwordSetup = passwordSetup;
  const unlocked = !!state.userEmail;
  const badge = $("#adminBadge");
  if (badge) {
    badge.textContent = unlocked ? state.userEmail : "비로그인";
    badge.classList.toggle("is-guest", !unlocked);
    badge.classList.toggle("is-user", unlocked);
    badge.title = unlocked ? state.userEmail : "로그인 계정";
  }
  $("#adminLoginForm")?.classList.toggle("hidden", unlocked || passwordSetup);
  $("#adminPasswordSetupForm")?.classList.toggle("hidden", !passwordSetup);
  $("#adminTools")?.classList.toggle("hidden", !unlocked || passwordSetup);
  if (unlocked) {
    const toolsEmail = $("#adminToolsEmail");
    if (toolsEmail) toolsEmail.textContent = state.userEmail;
    fillMailTemplateForm();
  }
}

function openAdminPopover() {
  const pop = $("#adminPopover");
  const btn = $("#adminUnlockBtn");
  if (!pop || !btn) return;
  pop.classList.remove("hidden");
  pop.setAttribute("aria-hidden", "false");
  btn.setAttribute("aria-expanded", "true");
}

function closeAdminPopover() {
  const pop = $("#adminPopover");
  const btn = $("#adminUnlockBtn");
  if (!pop || !btn) return;
  pop.classList.add("hidden");
  pop.setAttribute("aria-hidden", "true");
  btn.setAttribute("aria-expanded", "false");
}

function toggleAdminPopover() {
  const pop = $("#adminPopover");
  if (!pop) return;
  if (pop.classList.contains("hidden")) openAdminPopover();
  else closeAdminPopover();
}

function applyLocalPatch(c, patch) {
  if (!c) return;
  if (patch.stage != null) c.stage = patch.stage;
  if (patch.mailStatus != null) c.mail_status = patch.mailStatus;
  if (patch.isRecommended != null) c.is_recommended = patch.isRecommended;
  if (patch.isHidden != null) c.is_hidden = patch.isHidden;
  if (patch.isAlba != null) c.is_alba = patch.isAlba;
  if (patch.memo != null) c.memo = patch.memo;
  if (patch.recommendScore != null) c.recommend_score = patch.recommendScore;
  if (patch.closedReason != null) c.closed_reason = patch.closedReason;
  if (patch.mailedAt != null) c.mailed_at = patch.mailedAt;
  if (patch.status != null) c.status = patch.status;
}

function applyRpcOut(c, out) {
  if (!c || !out) return;
  if (out.stage != null) c.stage = out.stage;
  if (out.mailStatus != null) c.mail_status = out.mailStatus;
  if (out.isRecommended != null) c.is_recommended = out.isRecommended;
  if (out.isHidden != null) c.is_hidden = out.isHidden;
  if (out.isAlba != null) c.is_alba = out.isAlba;
  if (out.memo != null) c.memo = out.memo;
  if (out.recommendScore != null) c.recommend_score = out.recommendScore;
  if (out.closedReason != null) c.closed_reason = out.closedReason;
  if (out.mailedAt != null) c.mailed_at = out.mailedAt;
  if (out.status != null) c.status = out.status;
}

async function patchCompany(companyId, patch) {
  if (!requireLogin()) return null;
  state.busyId = companyId;
  $("#status").textContent = "저장 중…";
  try {
    const out = await TOfferSupabase.upsertSalesManagement(companyId, patch);
    syncCompanyEverywhere(companyId, (c) => {
      if (out) applyRpcOut(c, out);
      else applyLocalPatch(c, patch);
    });
    // Ensure offer pool has this company after first CRM write from 전체 tab
    if (!state.offerCompanies.some((x) => x.company_id === companyId)) {
      const c = findCompany(companyId);
      if (c) state.offerCompanies.push({ ...c });
    }
    rebuildActiveCompanies();
    renderList();
    if (state.detailId === companyId) paintDetail();
    $("#status").textContent = "저장됨";
    return out;
  } catch (err) {
    console.error(err);
    $("#status").textContent = err.message || "저장 실패";
    throw err;
  } finally {
    state.busyId = "";
  }
}

async function saveCompanyEdit(companyId, patch) {
  if (!requireLogin()) return null;
  $("#status").textContent = "회사 정보 저장 중…";
  const out = await TOfferSupabase.upsertCompanyEdit(companyId, patch);
  const prev = state.edits[companyId] || {};
  const nextContact = patch.contact
    ? {
        ...(prev.contact || {}),
        ...patch.contact,
        ...(out?.contact || {}),
        contacts: patch.contact.contacts ?? out?.contact?.contacts ?? prev.contact?.contacts
      }
    : { ...(prev.contact || {}), ...(out?.contact || {}) };
  state.edits[companyId] = {
    ...prev,
    ...(out || {}),
    companyNameKo: patch.companyNameKo ?? out?.companyNameKo ?? prev.companyNameKo,
    domain: patch.domain ?? out?.domain ?? prev.domain,
    companyTier: patch.companyTier ?? out?.companyTier ?? prev.companyTier,
    notes: patch.notes ?? out?.notes ?? prev.notes,
    excludeReason: patch.excludeReason ?? out?.excludeReason ?? prev.excludeReason,
    contact: nextContact,
    profile: {
      ...(prev.profile || {}),
      ...(patch.profile || {}),
      ...(out?.profile || {})
    }
  };
  syncCompanyEverywhere(companyId, (row) => {
    if (patch.companyNameKo) row.company_name = patch.companyNameKo;
    if (patch.domain) row.domain = patch.domain;
    if (patch.companyTier != null) row.company_tier = patch.companyTier;
    if (patch.profile) row.profile = { ...(row.profile || {}), ...patch.profile };
    if (patch.profile?.homepage) row.homepage = patch.profile.homepage;
    if (patch.contact) {
      row.contact = nextContact;
      row.contact_name = nextContact.name || "";
      row.contact_email = nextContact.email || "";
      row.contact_phone = nextContact.phone || "";
    }
    if (patch.excludeReason != null) row.exclude_reason = patch.excludeReason;
  });
  renderList();
  if (state.detailId === companyId) paintDetail();
  $("#status").textContent = "회사 정보 저장됨";
  return out;
}

function sectionHead(title, sectionKey, locked) {
  const editing = state.detailEdit === sectionKey;
  if (locked) {
    return `<div class="detail-section-head"><h3 class="detail-block-title">${escapeHtml(title)}</h3></div>`;
  }
  if (editing) {
    return `<div class="detail-section-head">
      <h3 class="detail-block-title">${escapeHtml(title)}</h3>
      <div class="detail-section-actions">
        <button type="button" class="btn-primary btn-sm" data-section-save="${sectionKey}">저장</button>
        <button type="button" class="btn-ghost btn-sm" data-section-cancel="${sectionKey}">취소</button>
      </div>
    </div>`;
  }
  return `<div class="detail-section-head">
    <h3 class="detail-block-title">${escapeHtml(title)}</h3>
    <button type="button" class="btn-ghost btn-sm" data-section-edit="${sectionKey}">편집</button>
  </div>`;
}

function kvRow(label, valueHtml) {
  return `<div class="detail-kv-row"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
}

function fieldRow(label, inputHtml) {
  return `<div class="detail-field"><label>${escapeHtml(label)}</label>${inputHtml}</div>`;
}

function tierOptions(selected) {
  const opts = [
    ["", "미지정"],
    ["startup", "스타트업·미확인"],
    ["mid", "중견"],
    ["enterprise", "대기업"]
  ];
  return opts
    .map(
      ([v, l]) =>
        `<option value="${escapeAttr(v)}" ${selected === v ? "selected" : ""}>${escapeHtml(l)}</option>`
    )
    .join("");
}

function renderSummarySection(c, edit, locked) {
  const editing = state.detailEdit === "summary";
  const name = displayName(c);
  const tier = edit.companyTier || c.company_tier || "";
  const excludeReason = edit.excludeReason ?? c.exclude_reason ?? "";
  const notes = edit.notes || "";
  const memo = c.memo || "";
  const revenue = edit.profile?.revenueLabel || c.profile?.revenueLabel || "";
  const head = sectionHead("요약", "summary", locked);

  if (editing) {
    return `<section class="detail-block" data-section="summary">
      ${head}
      ${fieldRow("회사명", `<input id="detailName" type="text" value="${escapeAttr(name)}" />`)}
      ${fieldRow("규모", `<select id="detailTier">${tierOptions(tier)}</select>`)}
      ${fieldRow("매출", `<input id="detailRevenue" type="text" value="${escapeAttr(revenue)}" placeholder="예: 114억 (2025)" />`)}
      ${fieldRow("제외 사유", `<input id="detailExcludeReason" type="text" value="${escapeAttr(excludeReason)}" placeholder="회사 제외 사유(공유)" />`)}
      ${fieldRow("영업 메모", `<textarea id="detailMemo" placeholder="Offer 영업 메모">${escapeHtml(memo)}</textarea>`)}
      ${fieldRow("회사 노트", `<textarea id="detailNotes" placeholder="Client와 공유되는 회사 노트">${escapeHtml(notes)}</textarea>`)}
    </section>`;
  }

  const tierLabel = { startup: "스타트업·미확인", mid: "중견", enterprise: "대기업" }[tier] || tier || "—";
  return `<section class="detail-block" data-section="summary">
    ${head}
    <dl class="detail-kv">
      ${kvRow("회사명", escapeHtml(name))}
      ${kvRow("규모", escapeHtml(tierLabel))}
      ${kvRow("매출", escapeHtml(revenue || "—"))}
      ${kvRow("제외 사유", escapeHtml(excludeReason || "—"))}
      ${kvRow("영업 메모", memo ? `<span class="text-preline">${escapeHtml(memo)}</span>` : "—")}
      ${kvRow("회사 노트", notes ? `<span class="text-preline">${escapeHtml(notes)}</span>` : "—")}
    </dl>
  </section>`;
}

function renderContactsSection(c, locked) {
  const editing = state.detailEdit === "contacts";
  const list = contactsOf(c);
  const head = sectionHead("담당자", "contacts", locked);

  if (editing) {
    const cards = (list.length ? list : [{ name: "", email: "", phone: "" }])
      .map(
        (ct, i) => `<div class="contact-edit-card" data-contact-card="${i}">
          ${fieldRow("이름", `<input type="text" data-contact-field="name" value="${escapeAttr(ct.name)}" placeholder="이름" />`)}
          ${fieldRow("이메일", `<input type="email" data-contact-field="email" value="${escapeAttr(ct.email)}" placeholder="email@…" />`)}
          ${fieldRow("전화", `<input type="tel" data-contact-field="phone" value="${escapeAttr(ct.phone)}" placeholder="전화" />`)}
          <div class="detail-actions-row">
            <button type="button" class="btn-ghost btn-sm danger-text" data-contact-remove="${i}">이 담당자 삭제</button>
          </div>
        </div>`
      )
      .join("");
    return `<section class="detail-block" data-section="contacts">
      ${head}
      <div id="detailContactList">${cards}</div>
      <div class="detail-actions-row">
        <button type="button" class="btn-ghost btn-sm" id="detailAddContact">담당자 추가</button>
      </div>
    </section>`;
  }

  const body = list.length
    ? `<ul class="contact-view-list">${list
        .map((ct) => {
          const parts = [
            ct.name ? `<strong>${escapeHtml(ct.name)}</strong>` : "",
            ct.email
              ? `<a class="post-link" href="mailto:${escapeAttr(ct.email)}">${escapeHtml(ct.email)}</a>`
              : "",
            ct.phone ? escapeHtml(ct.phone) : ""
          ].filter(Boolean);
          return `<li>${parts.join(" · ")}</li>`;
        })
        .join("")}</ul>`
    : `<p class="detail-muted">등록된 담당자가 없습니다.</p>`;

  return `<section class="detail-block" data-section="contacts">${head}${body}</section>`;
}

function renderProfileSection(c, edit, locked) {
  const editing = state.detailEdit === "profile";
  const p = profileOf(c);
  const domain = edit.domain || c.domain || "";
  const head = sectionHead("회사 프로필", "profile", locked);
  const fields = [
    ["도메인", "detailDomain", domain],
    ["홈페이지", "detailHomepage", p.homepage || c.homepage || ""],
    ["서비스명", "detailServiceName", p.serviceName || p.service_name || ""],
    ["서비스 URL", "detailServiceUrl", p.serviceUrl || p.service_url || ""],
    ["법인명", "detailLegal", p.companyNameLegal || ""],
    ["사업자번호", "detailBizNo", p.bizNo || ""],
    ["업태", "detailBizType", p.bizType || ""],
    ["종목", "detailBizItem", p.bizItem || ""],
    ["기업규모", "detailScale", p.companyScale || ""],
    ["사업자상태", "detailBizStatus", p.bizStatus || ""],
    ["등록일", "detailFounded", p.foundedDate || ""],
    ["종업원", "detailEmp", p.employeeCount || ""],
    ["산업분류", "detailIndustry", p.industrySummary || ""]
  ];

  if (editing) {
    return `<section class="detail-block" data-section="profile">
      ${head}
      ${fields
        .map(([label, id, val]) => {
          const type = id.includes("Homepage") || id.includes("Url") ? "url" : "text";
          return fieldRow(label, `<input id="${id}" type="${type}" value="${escapeAttr(val)}" />`);
        })
        .join("")}
    </section>`;
  }

  const shown = fields.filter(([, , v]) => `${v ?? ""}`.trim());
  const body = shown.length
    ? `<dl class="detail-kv">${shown
        .map(([label, , val]) => {
          const v = `${val}`.trim();
          const cell =
            label === "홈페이지" || label === "서비스 URL"
              ? `<a class="post-link" href="${escapeAttr(v)}" target="_blank" rel="noopener">${escapeHtml(v)}</a>`
              : escapeHtml(v);
          return kvRow(label, cell);
        })
        .join("")}</dl>`
    : `<p class="detail-muted">프로필 정보가 없습니다. 편집으로 입력하세요.</p>`;

  return `<section class="detail-block" data-section="profile">${head}${body}</section>`;
}

function renderCrmSection(c, locked) {
  const editing = state.detailEdit === "crm";
  const excluded = isExcluded(c);
  const stage = stageOf(c);
  const pool = poolOf(c);
  const dis = locked ? "disabled" : "";
  const head = sectionHead("Offer 분류", "crm", locked);

  // Pool / stage always interactive when logged in (quick actions); score/reason in edit mode.
  const poolBlock = `<div class="detail-field">
      <label>풀</label>
      <div class="pool-radios">
        <label><input type="radio" name="detailPool" value="normal" ${pool === "normal" ? "checked" : ""} ${dis} /> 일반</label>
        <label><input type="radio" name="detailPool" value="recommended" ${pool === "recommended" ? "checked" : ""} ${dis} /> 추천</label>
        <label><input type="radio" name="detailPool" value="hidden" ${pool === "hidden" ? "checked" : ""} ${dis} /> 제외</label>
      </div>
    </div>
    <div class="detail-field">
      <label>단계</label>
      <select id="detailStage" ${dis}>
        ${Object.entries(STAGE_LABELS)
          .map(
            ([k, v]) =>
              `<option value="${k}" ${stage === k ? "selected" : ""}>${escapeHtml(v)}</option>`
          )
          .join("")}
      </select>
    </div>`;

  if (editing) {
    return `<section class="detail-block" data-section="crm">
      ${head}
      ${poolBlock}
      ${fieldRow(
        "추천점수",
        `<input id="detailRecScore" type="number" min="0" max="5" step="1" value="${escapeAttr(String(c.recommend_score ?? 0))}" />`
      )}
      ${fieldRow(
        "제외사유",
        `<input id="detailClosedReason" type="text" value="${escapeAttr(c.closed_reason || "")}" placeholder="Offer 제외 시 사유" />`
      )}
    </section>`;
  }

  return `<section class="detail-block" data-section="crm">
    ${head}
    ${poolBlock}
    <dl class="detail-kv">
      ${kvRow("추천점수", escapeHtml(String(c.recommend_score ?? 0)))}
      ${kvRow("제외사유", escapeHtml(c.closed_reason || "—"))}
      ${excluded ? kvRow("상태", `<span class="badge badge-closed">제외됨</span>`) : ""}
    </dl>
  </section>`;
}

function paintDetail() {
  const c = findCompany(state.detailId);
  const drawer = $("#detailDrawer");
  if (!c || !drawer) {
    closeDetail();
    return;
  }
  const edit = state.edits[c.company_id] || {};
  const locked = !state.userEmail;
  const excluded = isExcluded(c);
  const posts = postsForCompany(c);
  const grade = (c.lead_grade || "C").toUpperCase();
  const stage = stageOf(c);
  const p = profileOf(c);

  $("#detailTitle").textContent = displayName(c);
  $("#detailHeaderChips").innerHTML = `
    <span class="badge ${grade === "A" ? "badge-a" : grade === "B" ? "badge-b" : "badge-c"}">${escapeHtml(grade)}</span>
    <span class="badge badge-src">${escapeHtml(STAGE_LABELS[stage] || stage)}</span>
    ${c.is_recommended ? `<span class="badge badge-rec">추천</span>` : ""}
    ${excluded ? `<span class="badge badge-closed">제외</span>` : ""}
  `;
  $("#detailHeaderSub").textContent = [
    edit.domain || c.domain || "",
    p.homepage || c.homepage || "",
    `점수 ${c.priority_score ?? 0}`
  ]
    .filter(Boolean)
    .join(" · ");

  $("#detailRecommendBtn").classList.toggle("hidden", excluded);
  $("#detailExcludeBtn").classList.toggle("hidden", excluded);
  $("#detailRestoreBtn").classList.toggle("hidden", !excluded);
  if (state.empFilter === "all") {
    $("#detailRecommendBtn").textContent = isInAlbaPool(c) ? "알바해제" : "알바태그";
    $("#detailRecommendBtn").title = "알바 탭에 넣기/빼기";
  } else {
    $("#detailRecommendBtn").textContent = c.is_recommended ? "추천해제" : "추천";
    $("#detailRecommendBtn").title = "추천";
  }
  $("#detailRecommendBtn").disabled = locked;
  $("#detailExcludeBtn").disabled = locked;
  $("#detailRestoreBtn").disabled = locked;

  const dis = locked ? "disabled" : "";
  $("#detailBody").innerHTML = `
    ${renderCrmSection(c, locked)}
    ${renderSummarySection(c, edit, locked)}
    ${renderContactsSection(c, locked)}
    ${renderProfileSection(c, edit, locked)}

    <section class="detail-block">
      <h3 class="detail-block-title">빠른 액션</h3>
      <div class="detail-actions-row">
        <button type="button" class="btn-ghost" id="detailPromoBtn">메일문구 복사</button>
        <button type="button" class="btn-ghost" id="detailMailReadyBtn" ${dis}>메일대기로</button>
        <button type="button" class="btn-ghost" id="detailMailedBtn" ${dis}>발송완료</button>
      </div>
      ${locked ? `<p class="detail-muted">편집하려면 「관리」에서 로그인하세요. (T-Client와 동일 계정)</p>` : ""}
      ${c.score_reason ? `<p class="detail-muted">점수 사유: ${escapeHtml(c.score_reason)}</p>` : ""}
    </section>

    <section class="detail-block">
      <h3 class="detail-block-title">공고 ${posts.length}</h3>
      ${
        posts.length
          ? `<ul class="detail-post-list">${posts
              .map((post) => {
                const src = SOURCE_LABELS[post.source] || post.source || "—";
                const title = post.title || "(제목 없음)";
                const url = post.url || "";
                const st = postStatusOf(post);
                return `<li>
                  ${statusBadge(st)}
                  <span class="badge badge-src">${escapeHtml(src)}</span>
                  ${
                    url
                      ? `<a class="post-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
                      : escapeHtml(title)
                  }
                  <div class="detail-muted">${escapeHtml(formatTime(post.collected_at || post.collectedAt))}</div>
                </li>`;
              })
              .join("")}</ul>`
          : `<p class="detail-muted">연결된 Offer 공고가 없습니다.</p>`
      }
    </section>
  `;

  bindDetailEvents(c);
}

function bindDetailEvents(c) {
  $("#detailPromoBtn")?.addEventListener("click", () => copyPromo(c));
  $("#detailMailReadyBtn")?.addEventListener("click", async () => {
    await patchCompany(c.company_id, { stage: "mail_ready", mailStatus: "ready", isHidden: false });
    switchTab("progress");
  });
  $("#detailMailedBtn")?.addEventListener("click", async () => {
    await patchCompany(c.company_id, {
      stage: "mailed",
      mailStatus: "sent",
      mailedAt: new Date().toISOString(),
      isHidden: false
    });
    switchTab("progress");
  });

  document.querySelectorAll("[data-section-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!requireLogin()) return;
      state.detailEdit = btn.getAttribute("data-section-edit");
      paintDetail();
    });
  });
  document.querySelectorAll("[data-section-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.detailEdit = null;
      paintDetail();
    });
  });
  document.querySelectorAll("[data-section-save]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void saveDetailSection(c, btn.getAttribute("data-section-save"));
    });
  });

  $("#detailAddContact")?.addEventListener("click", () => {
    const list = $("#detailContactList");
    if (!list) return;
    const i = list.querySelectorAll("[data-contact-card]").length;
    const wrap = document.createElement("div");
    wrap.className = "contact-edit-card";
    wrap.setAttribute("data-contact-card", String(i));
    wrap.innerHTML = `
      ${fieldRow("이름", `<input type="text" data-contact-field="name" value="" placeholder="이름" />`)}
      ${fieldRow("이메일", `<input type="email" data-contact-field="email" value="" placeholder="email@…" />`)}
      ${fieldRow("전화", `<input type="tel" data-contact-field="phone" value="" placeholder="전화" />`)}
      <div class="detail-actions-row">
        <button type="button" class="btn-ghost btn-sm danger-text" data-contact-remove="${i}">이 담당자 삭제</button>
      </div>`;
    list.appendChild(wrap);
    wrap.querySelector("[data-contact-remove]")?.addEventListener("click", () => wrap.remove());
  });
  document.querySelectorAll("[data-contact-remove]").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest("[data-contact-card]")?.remove());
  });

  document.querySelectorAll('input[name="detailPool"]').forEach((el) => {
    el.addEventListener("change", async () => {
      const v = el.value;
      if (v === "recommended") await recommendCompany(c, true);
      else if (v === "hidden") await excludeCompany(c);
      else {
        await patchCompany(c.company_id, {
          isRecommended: false,
          isHidden: false,
          ...(stageOf(c) === "lost" ? { stage: "new", status: "active", closedReason: "" } : {})
        });
      }
    });
  });
  $("#detailStage")?.addEventListener("change", async (e) => {
    const next = e.target.value;
    const patch = { stage: next };
    if (next === "mail_ready") patch.mailStatus = "ready";
    if (next === "mailed") {
      patch.mailStatus = "sent";
      patch.mailedAt = new Date().toISOString();
    }
    if (next === "lost") {
      patch.isHidden = true;
      patch.isRecommended = false;
    }
    await patchCompany(c.company_id, patch);
    if (PROGRESS_STAGES.has(next)) switchTab("progress");
  });
}

function readContactsFromForm() {
  return [...document.querySelectorAll("[data-contact-card]")]
    .map((card) =>
      normalizeContactEntry({
        name: card.querySelector('[data-contact-field="name"]')?.value,
        email: card.querySelector('[data-contact-field="email"]')?.value,
        phone: card.querySelector('[data-contact-field="phone"]')?.value
      })
    )
    .filter(hasContactData);
}

async function saveDetailSection(c, section) {
  if (!requireLogin()) return;
  try {
    if (section === "summary") {
      const name = $("#detailName")?.value?.trim() || "";
      const tier = $("#detailTier")?.value || "";
      const revenue = $("#detailRevenue")?.value?.trim() || "";
      const excludeReason = $("#detailExcludeReason")?.value?.trim() || "";
      const notes = $("#detailNotes")?.value ?? "";
      const memo = $("#detailMemo")?.value ?? "";
      const prevProfile = profileOf(c);
      await saveCompanyEdit(c.company_id, {
        companyNameKo: name,
        companyTier: tier,
        notes,
        excludeReason,
        profile: { ...prevProfile, revenueLabel: revenue }
      });
      await patchCompany(c.company_id, { memo });
    } else if (section === "contacts") {
      await saveCompanyEdit(c.company_id, { contact: buildContactPatch(readContactsFromForm()) });
    } else if (section === "profile") {
      const prev = profileOf(c);
      await saveCompanyEdit(c.company_id, {
        domain: $("#detailDomain")?.value?.trim() || "",
        profile: {
          ...prev,
          homepage: $("#detailHomepage")?.value?.trim() || "",
          serviceName: $("#detailServiceName")?.value?.trim() || "",
          serviceUrl: $("#detailServiceUrl")?.value?.trim() || "",
          companyNameLegal: $("#detailLegal")?.value?.trim() || "",
          bizNo: $("#detailBizNo")?.value?.trim() || "",
          bizType: $("#detailBizType")?.value?.trim() || "",
          bizItem: $("#detailBizItem")?.value?.trim() || "",
          companyScale: $("#detailScale")?.value?.trim() || "",
          bizStatus: $("#detailBizStatus")?.value?.trim() || "",
          foundedDate: $("#detailFounded")?.value?.trim() || "",
          employeeCount: $("#detailEmp")?.value?.trim() || "",
          industrySummary: $("#detailIndustry")?.value?.trim() || ""
        }
      });
    } else if (section === "crm") {
      await patchCompany(c.company_id, {
        recommendScore: Number($("#detailRecScore")?.value || 0),
        closedReason: $("#detailClosedReason")?.value?.trim() || "",
        stage: $("#detailStage")?.value || stageOf(c)
      });
    }
    state.detailEdit = null;
    paintDetail();
    $("#status").textContent = "저장됨";
  } catch (err) {
    $("#status").textContent = err.message || "저장 실패";
  }
}

function openDetail(companyId) {
  const c = findCompany(companyId);
  if (!c) return;
  state.detailId = companyId;
  state.detailEdit = null;
  const drawer = $("#detailDrawer");
  drawer?.classList.remove("hidden");
  drawer?.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-drawer-open");
  paintDetail();
  renderList();
  void ensureCompanyEditsLoaded().then(() => {
    if (state.detailId === companyId) paintDetail();
  });
}

function closeDetail() {
  state.detailId = "";
  state.detailEdit = null;
  const drawer = $("#detailDrawer");
  drawer?.classList.add("hidden");
  drawer?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("detail-drawer-open");
  renderList();
}

function mergeEditsIntoCompanies() {
  for (const list of [state.offerCompanies, state.allCompanies, state.companies]) {
    for (const company of list) {
      const edit = state.edits[company.company_id];
      if (!edit) continue;
      if (edit.companyNameKo) company.company_name = edit.companyNameKo;
      if (edit.domain) company.domain = edit.domain;
      if (edit.companyTier) company.company_tier = edit.companyTier;
      if (edit.excludeReason != null) company.exclude_reason = edit.excludeReason;
      if (edit.profile) {
        company.profile = { ...(company.profile || {}), ...edit.profile };
        if (edit.profile.homepage) company.homepage = edit.profile.homepage;
      }
      if (edit.contact) {
        company.contact = edit.contact;
        company.contact_name = edit.contact.name || company.contact_name || "";
        company.contact_email = edit.contact.email || company.contact_email || "";
        company.contact_phone = edit.contact.phone || company.contact_phone || "";
      }
    }
  }
}

async function copyPromo(c) {
  const latest = latestPostForCompany(c);
  const mail = TOfferSupabase.buildPromoMail({
    companyName: displayName(c),
    postTitle: c.latest_offer_title || latest?.title,
    postUrl: c.latest_offer_url || latest?.url
  });
  const text = `${mail.subject}\n\n${mail.body}`;
  try {
    await navigator.clipboard.writeText(text);
    $("#status").textContent = "프로모 메일 문구 복사됨 (공용 본문 사용)";
  } catch {
    const href = TOfferSupabase.mailtoHref(mail);
    window.open(href, "_blank");
    $("#status").textContent = "메일 앱으로 열림";
  }
}

function fillMailTemplateForm() {
  const tpl = TOfferSupabase.loadMailTemplate();
  const subject = $("#mailTplSubject");
  const body = $("#mailTplBody");
  if (subject) subject.value = tpl.subject;
  if (body) body.value = tpl.body;
}

async function recommendCompany(c, on = true) {
  await patchCompany(c.company_id, {
    isRecommended: on,
    isHidden: false,
    ...(on && stageOf(c) === "lost" ? { stage: "new" } : {})
  });
  if (on && state.tab === "new") switchTab("recommended");
}

async function setAlbaTag(c, on = true) {
  const id = c.company_id;
  if (on) {
    state.albaTags.add(id);
    state.albaDenied.delete(id);
  } else {
    state.albaTags.delete(id);
    state.albaDenied.add(id);
  }
  persistAlbaTagState();
  syncCompanyEverywhere(id, (row) => {
    row.is_alba = on;
  });
  try {
    if (state.userEmail) {
      await patchCompany(id, { isAlba: on, isHidden: false });
    }
  } catch (err) {
    // Column may not exist yet — local tag still applies
    console.warn("isAlba persist failed", err);
    $("#status").textContent = on ? "알바 태그 저장(로컬)" : "알바 태그 해제(로컬)";
  }
  rebuildActiveCompanies();
  renderList();
  if (state.detailId === id) paintDetail();
  $("#status").textContent = on ? "알바 태그 붙임" : "알바 태그 해제";
}

async function excludeCompany(c) {
  if (!requireLogin()) return;
  const reason = window.prompt("제외 사유 (선택)", c.closed_reason || "") ?? null;
  if (reason === null) return;
  await patchCompany(c.company_id, {
    isHidden: true,
    isRecommended: false,
    stage: "lost",
    status: "closed",
    closedReason: reason.trim()
  });
  closeDetail();
  switchTab("excluded");
}

async function restoreCompany(c) {
  if (!requireLogin()) return;
  await patchCompany(c.company_id, {
    isHidden: false,
    stage: "new",
    status: "active",
    closedReason: "",
    mailStatus: "none"
  });
  switchTab("new");
  paintDetail();
}

function actionButtons(c) {
  const id = escapeAttr(c.company_id);
  const busy = state.busyId === c.company_id;
  const disabled = busy || !state.userEmail ? "disabled" : "";
  const stage = stageOf(c);
  const rec = !!c.is_recommended;
  const excluded = isExcluded(c);
  const albaOn = isInAlbaPool(c);
  if (excluded) {
    return `<div class="row-actions">
      <button type="button" class="btn-act" data-act="restore" data-id="${id}" ${disabled}>복구</button>
    </div>`;
  }
  // 전체 탭: 알바 태그 (추천 아님)
  if (state.empFilter === "all") {
    return `<div class="row-actions">
      <button type="button" class="btn-act primary" data-act="alba_tag" data-id="${id}" ${disabled}>
        ${albaOn ? "알바해제" : "알바태그"}
      </button>
      <button type="button" class="btn-act danger" data-act="exclude" data-id="${id}" ${disabled}>제외</button>
    </div>`;
  }
  return `<div class="row-actions">
    <button type="button" class="btn-act" data-act="recommend" data-id="${id}" ${disabled} title="추천 탭으로">
      ${rec ? "추천해제" : "추천"}
    </button>
    <button type="button" class="btn-act primary" data-act="mail_ready" data-id="${id}" ${disabled} ${
      stage === "mail_ready" ? "disabled" : ""
    }>메일대기</button>
    <button type="button" class="btn-act" data-act="mailed" data-id="${id}" ${disabled}>발송완료</button>
    <button type="button" class="btn-act" data-act="promo" data-id="${id}">메일문구</button>
    <button type="button" class="btn-act danger" data-act="exclude" data-id="${id}" ${disabled}>제외</button>
  </div>`;
}

function updateCounts() {
  const buckets = {
    all: 0,
    new: 0,
    recommended: 0,
    progress: 0,
    excluded: 0
  };
  for (const c of state.companies) {
    if (isExcluded(c)) {
      buckets.excluded += 1;
      continue;
    }
    if (!companyHasVisiblePost(c)) continue;
    buckets.all += 1;
    if (isProgress(c)) buckets.progress += 1;
    else if (c.is_recommended) buckets.recommended += 1;
    else if (stageOf(c) === "new") buckets.new += 1;
  }
  for (const [k, v] of Object.entries(buckets)) {
    const el = document.querySelector(`[data-count="${k}"]`);
    if (el) el.textContent = String(v);
  }

  const viewPosts = listViewPosts();
  const postBuckets = {
    all: viewPosts.filter((p) => state.postFilter === "all" || true).length,
    open: viewPosts.filter((p) => !isClosedPost(p)).length,
    closed: viewPosts.filter((p) => isClosedPost(p)).length
  };
  // recompute with post filter awareness for display counts of status tabs
  postBuckets.all = viewPosts.length;
  for (const [k, v] of Object.entries(postBuckets)) {
    const el = document.querySelector(`[data-post-count="${k}"]`);
    if (el) el.textContent = String(v);
  }
  // emp tab counts: 알바 = 알바 풀 회사 수, 전체 = T-Client 회사 수
  let albaCo = 0;
  const seen = new Set();
  for (const c of [...state.offerCompanies, ...state.allCompanies]) {
    if (seen.has(c.company_id)) continue;
    seen.add(c.company_id);
    if (isInAlbaPool(c) && !isExcluded(c)) albaCo += 1;
  }
  const empBuckets = {
    alba: albaCo,
    all: state.allCompanies.length || state.offerCompanies.length
  };
  for (const [k, v] of Object.entries(empBuckets)) {
    const el = document.querySelector(`[data-emp-count="${k}"]`);
    if (el) el.textContent = String(v);
  }
}

function renderMeta(data) {
  const nOffer = state.offerCompanies.filter((c) => !isExcluded(c)).length;
  const nAll = state.allCompanies.length;
  const posts = offerPosts();
  const alba = posts.filter(isAlbaPost).length;
  const closed = posts.filter((p) => isClosedPost(p)).length;
  const open = posts.length - closed;
  $("#metaLine").textContent =
    `전체 ${nAll} · 알바회사 ${nOffer} · 알바공고 ${alba}/${posts.length} (모집 ${open}·마감 ${closed}) · ${formatTime(data.generatedAt || state.generatedAt)}`;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-view") === view);
  });
  $("#companyTable").classList.toggle("hidden", view !== "companies");
  $("#postsTable").classList.toggle("hidden", view !== "posts");
  $("#stageTabs").classList.toggle("hidden", view !== "companies");
  $("#postTabs").classList.toggle("hidden", view !== "posts");
  renderList();
}

function switchTab(tab) {
  state.tab = tab;
  state.page = 1;
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tab);
  });
  renderList();
}

function renderCompanies() {
  const body = $("#leadBody");
  const empty = $("#empty");
  const filtered = filteredCompanyRows();
  const { rows, total, pages } = pagedSlice(filtered);
  updateCounts();
  renderPager(total, pages);
  if (!rows.length) {
    body.innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent =
      state.tab === "recommended"
        ? "비어 있습니다. 알바 탭에서 「추천」으로 보내세요."
        : state.tab === "progress"
          ? "비어 있습니다. 「메일대기」또는 「발송완료」로 진행에 넣으세요."
          : state.empFilter === "alba"
            ? "알바 태그가 없습니다. 전체 탭에서 「알바태그」로 추가하세요."
            : "표시할 회사가 없습니다.";
    return;
  }
  empty.classList.add("hidden");
  body.innerHTML = rows
    .map((c) => {
      const grade = (c.lead_grade || "C").toUpperCase();
      const gradeClass = grade === "A" ? "badge-a" : grade === "B" ? "badge-b" : "badge-c";
      const stage = STAGE_LABELS[stageOf(c)] || stageOf(c);
      const latest = latestPostForCompany(c);
      const closed = latest ? isClosedPost(latest) : false;
      const title = c.latest_offer_title || latest?.title || "(공고 없음)";
      const url = c.latest_offer_url || latest?.url || "";
      const srcKey = sourceOfCompany(c);
      const src = SOURCE_LABELS[srcKey] || srcKey || "—";
      const open = state.detailId === c.company_id;
      const albaBadge = isInAlbaPool(c) ? ` <span class="badge badge-alba">알바</span>` : "";
      return `<tr class="${closed ? "row-closed" : ""} ${open ? "is-open" : ""}" data-company-id="${escapeAttr(c.company_id)}">
        <td><span class="badge ${gradeClass}">${escapeHtml(grade)}</span></td>
        <td class="co-name" data-open-detail="${escapeAttr(c.company_id)}">${escapeHtml(displayName(c))}${albaBadge}${
          c.is_recommended && state.empFilter === "alba" ? ` <span class="badge badge-rec">추천</span>` : ""
        }</td>
        <td>${
          url
            ? `<a class="post-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
            : escapeHtml(title)
        }${closed ? ` ${statusBadge("closed")}` : ""}</td>
        <td><span class="badge badge-src">${escapeHtml(src)}</span></td>
        <td>${escapeHtml(stage)}</td>
        <td>${escapeHtml(c.mail_status || "none")}</td>
        <td class="col-score">${escapeHtml(String(c.priority_score ?? 0))}</td>
        <td class="col-actions">${actionButtons(c)}</td>
      </tr>`;
    })
    .join("");
}

function renderPosts() {
  const body = $("#postsBody");
  const empty = $("#empty");
  const filtered = listViewPosts().filter(matchesPostFilter).filter(matchesQueryPost);
  const { rows, total, pages } = pagedSlice(filtered);
  $("#leadBody").innerHTML = "";
  updateCounts();
  renderPager(total, pages);
  if (!rows.length) {
    body.innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = "표시할 공고가 없습니다.";
    return;
  }
  empty.classList.add("hidden");
  body.innerHTML = rows
    .map((p) => {
      const coId = p.company_id || p.companyId;
      const co = companyName(coId);
      const src = SOURCE_LABELS[p.source] || p.source || "—";
      const title = p.title || "(제목 없음)";
      const url = p.url || "";
      const when = formatTime(p.collected_at || p.collectedAt);
      const st = postStatusOf(p);
      return `<tr class="${st === "closed" ? "row-closed" : ""}" data-open-company="${escapeAttr(coId)}">
        <td class="co-name">${escapeHtml(co)}</td>
        <td>${
          url
            ? `<a class="post-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
            : escapeHtml(title)
        }</td>
        <td><span class="badge badge-src">${escapeHtml(src)}</span></td>
        <td>${statusBadge(st)}</td>
        <td>${escapeHtml(when)}</td>
      </tr>`;
    })
    .join("");
}

function renderList() {
  if (state.view === "posts") renderPosts();
  else renderCompanies();
}

async function loadOfferData() {
  try {
    return await TOfferSupabase.getDashboard();
  } catch {
    const snap = await TOfferSupabase.getSnapshot();
    return {
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
        is_recommended: false,
        closed_reason: ""
      })),
      posts: (snap.posts || []).map((p) => ({
        ...p,
        company_id: p.companyId,
        classify_label: "offer",
        status: p.status || "open",
        collected_at: p.collectedAt
      }))
    };
  }
}

async function loadClientUniverse() {
  // Do not fall back to get_lead_dashboard — it often statement-timeouts (57014)
  // and stalls both Client and Offer. Empty snapshot → empty 전체 until republish.
  try {
    const snap = await TOfferSupabase.getPublishedSnapshot();
    if (snap?.rows?.length) return snap;
  } catch (err) {
    console.warn("published snapshot failed", err);
  }
  return { rows: [], generatedAt: "" };
}

async function load() {
  $("#status").textContent = "불러오는 중…";
  loadAlbaTagState();
  try {
    // 1) Client snapshot first — fast first paint for 전체
    const clientData = await loadClientUniverse();
    state.clientRows = clientData.rows || [];
    state.clientPosts = null;
    state.generatedAt = clientData.generatedAt || "";
    state.allCompanies = state.clientRows.map((r) => mapClientRow(r, new Map()));
    if (!state.allCompanies.length) {
      $("#status").textContent = "Client 스냅샷 비어 있음 — Offer 데이터 로딩…";
    } else {
      rebuildActiveCompanies();
      renderMeta({ generatedAt: state.generatedAt });
      renderList();
      $("#status").textContent = "목록 표시 중 · Offer 알바 동기화…";
    }

    // 2) Offer dashboard in background (알바 풀)
    const offerData = await loadOfferData();
    state.offerCompanies = offerData.companies || [];
    state.posts = offerData.posts || [];
    rebuildAlbaPostIndex();
    state.generatedAt = offerData.generatedAt || state.generatedAt;
    const offerMap = new Map(state.offerCompanies.map((c) => [c.company_id, c]));
    state.allCompanies = (state.clientRows.length ? state.clientRows : []).map((r) => mapClientRow(r, offerMap));
    if (!state.allCompanies.length) state.allCompanies = state.offerCompanies.slice();

    // Sync alba tags from server management when available (non-blocking)
    TOfferSupabase.getOfferSalesManagementAll()
      .then((mgmt) => {
        state.offerMgmt = mgmt || {};
        for (const [id, m] of Object.entries(state.offerMgmt)) {
          if (m?.isAlba) {
            state.albaTags.add(id);
            state.albaDenied.delete(id);
          }
        }
        persistAlbaTagState();
        for (const c of state.allCompanies) {
          const m = state.offerMgmt[c.company_id];
          if (m?.isAlba != null) c.is_alba = !!m.isAlba;
          if (m?.isRecommended != null) c.is_recommended = !!m.isRecommended;
          if (m?.isHidden != null) c.is_hidden = !!m.isHidden;
          if (m?.stage) c.stage = m.stage;
          if (m?.mailStatus) c.mail_status = m.mailStatus;
          if (m?.memo != null) c.memo = m.memo;
        }
        rebuildActiveCompanies();
        renderList();
      })
      .catch(() => {});

    rebuildActiveCompanies();
    renderMeta({ generatedAt: state.generatedAt });
    renderList();
    if (state.detailId) paintDetail();
    $("#status").textContent = state.userEmail ? "준비됨 (로그인)" : "준비됨 — 편집은 「관리」로그인 필요";

    // Edits only when opening detail (avoid multi-MB parse on boot)
    state.edits = {};
  } catch (err) {
    console.error(err);
    $("#status").textContent = "로드 실패";
    $("#empty").classList.remove("hidden");
    $("#empty").classList.add("error");
    $("#empty").textContent = `${err.message ?? err}`;
  }
}

async function ensureCompanyEditsLoaded() {
  if (state._editsLoaded) return;
  state._editsLoaded = true;
  try {
    state.edits = (await TOfferSupabase.getCompanyEditsAll()) || {};
    mergeEditsIntoCompanies();
  } catch (err) {
    console.warn("company edits load failed", err);
    state.edits = {};
    state._editsLoaded = false;
  }
}

async function handleRowAction(act, id) {
  const c = findCompany(id);
  if (!c) return;
  if (act === "promo") {
    await copyPromo(c);
    return;
  }
  if (act === "recommend") {
    await recommendCompany(c, !c.is_recommended);
    return;
  }
  if (act === "alba_tag") {
    if (!requireLogin()) return;
    await setAlbaTag(c, !isInAlbaPool(c));
    return;
  }
  if (act === "mail_ready") {
    await patchCompany(id, { stage: "mail_ready", mailStatus: "ready", isHidden: false });
    switchTab("progress");
    return;
  }
  if (act === "mailed") {
    await patchCompany(id, {
      stage: "mailed",
      mailStatus: "sent",
      mailedAt: new Date().toISOString(),
      isHidden: false
    });
    switchTab("progress");
    return;
  }
  if (act === "exclude") {
    await excludeCompany(c);
    return;
  }
  if (act === "restore") {
    await restoreCompany(c);
  }
}

function bindAuth() {
  let authBusy = false;
  $("#adminUnlockBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAdminPopover();
  });
  document.addEventListener("click", (e) => {
    if (authBusy) return;
    const pop = $("#adminPopover");
    if (!pop || pop.classList.contains("hidden")) return;
    if (e.target.closest("#adminPopover") || e.target.closest("#adminUnlockBtn")) return;
    closeAdminPopover();
  });

  async function doLogin() {
    if (authBusy) return;
    const btn = $("#adminLoginBtn");
    authBusy = true;
    if (btn) btn.disabled = true;
    try {
      setAdminStatus("로그인 중…");
      const result = await window.TOfferAuth.signIn($("#adminEmail").value, $("#adminPassword").value);
      state.userEmail = result?.email || (await window.TOfferAuth.getUserEmail());
      state.passwordSetup = false;
      setAdminUi();
      setAdminStatus("로그인됨");
      $("#status").textContent = "로그인됨 — 편집·추천·제외 가능";
      renderList();
      if (state.detailId) paintDetail();
      // Keep popover open so mail template is visible after login.
      openAdminPopover();
    } catch (err) {
      console.error(err);
      setAdminStatus(err.message || "로그인 실패");
    } finally {
      authBusy = false;
      if (btn) btn.disabled = false;
    }
  }

  $("#adminLoginBtn")?.addEventListener("click", () => void doLogin());
  $("#adminPassword")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void doLogin();
    }
  });
  $("#adminSetupEmailBtn")?.addEventListener("click", async () => {
    if (authBusy) return;
    authBusy = true;
    try {
      const email = $("#adminEmail").value;
      setAdminStatus("설정 메일 발송 중…");
      await window.TOfferAuth.sendPasswordSetupEmail(email);
      setAdminStatus("설정 메일을 보냈습니다. 메일 링크로 들어와 비밀번호를 설정하세요.");
    } catch (err) {
      console.error(err);
      setAdminStatus(err.message || "메일 발송 실패");
    } finally {
      authBusy = false;
    }
  });
  $("#adminPasswordSaveBtn")?.addEventListener("click", async () => {
    if (authBusy) return;
    authBusy = true;
    try {
      const a = $("#adminNewPassword").value;
      const b = $("#adminConfirmPassword").value;
      if (a !== b) throw new Error("비밀번호가 일치하지 않습니다.");
      await window.TOfferAuth.updatePassword(a);
      state.userEmail = await window.TOfferAuth.getUserEmail();
      state.passwordSetup = false;
      setAdminUi();
      setAdminStatus("비밀번호가 저장되었습니다. 이제 로그인된 상태입니다.");
      history.replaceState(null, "", window.location.pathname + window.location.search);
      openAdminPopover();
    } catch (err) {
      console.error(err);
      setAdminStatus(err.message || "비밀번호 저장 실패");
    } finally {
      authBusy = false;
    }
  });
  $("#mailTplSaveBtn")?.addEventListener("click", () => {
    TOfferSupabase.saveMailTemplate({
      subject: $("#mailTplSubject")?.value,
      body: $("#mailTplBody")?.value
    });
    setAdminStatus("메일 본문을 저장했습니다. 「메일문구」복사에 바로 반영됩니다.");
    $("#status").textContent = "메일 본문 저장됨";
  });
  $("#mailTplResetBtn")?.addEventListener("click", () => {
    const tpl = TOfferSupabase.resetMailTemplate();
    fillMailTemplateForm();
    setAdminStatus("기본 메일 본문으로 되돌렸습니다.");
  });
  $("#adminLogout")?.addEventListener("click", async () => {
    await window.TOfferAuth.signOut();
    state.userEmail = "";
    setAdminUi();
    setAdminStatus("");
    closeAdminPopover();
    renderList();
    if (state.detailId) paintDetail();
  });
}

function bind() {
  bindAuth();
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.getAttribute("data-view")));
  });
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
  });
  document.querySelectorAll("[data-post-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-post-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.postFilter = btn.getAttribute("data-post-filter");
      state.page = 1;
      renderList();
    });
  });
  document.querySelectorAll("[data-emp-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-emp-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.empFilter = btn.getAttribute("data-emp-filter");
      rebuildActiveCompanies();
      renderList();
    });
  });
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    state.page = 1;
    renderList();
  });
  $("#pagerPrev")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  $("#pagerNext")?.addEventListener("click", () => {
    state.page += 1;
    renderList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#reload").addEventListener("click", () => load());

  $("#companyTable").addEventListener("click", async (e) => {
    const openId = e.target.closest("[data-open-detail]")?.getAttribute("data-open-detail");
    if (openId) {
      openDetail(openId);
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    e.stopPropagation();
    await handleRowAction(btn.getAttribute("data-act"), btn.getAttribute("data-id"));
  });

  $("#postsTable").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const id = e.target.closest("[data-open-company]")?.getAttribute("data-open-company");
    if (!id) return;
    setView("companies");
    openDetail(id);
  });

  $("#detailDrawer")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-detail]")) closeDetail();
  });
  $("#detailRecommendBtn")?.addEventListener("click", async () => {
    const c = findCompany(state.detailId);
    if (!c) return;
    if (state.empFilter === "all") {
      if (!requireLogin()) return;
      await setAlbaTag(c, !isInAlbaPool(c));
    } else {
      await recommendCompany(c, !c.is_recommended);
    }
  });
  $("#detailExcludeBtn")?.addEventListener("click", async () => {
    const c = findCompany(state.detailId);
    if (c) await excludeCompany(c);
  });
  $("#detailRestoreBtn")?.addEventListener("click", async () => {
    const c = findCompany(state.detailId);
    if (c) await restoreCompany(c);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
}

bind();
setAdminUi();
if (window.TOfferAuth) {
  window.TOfferAuth.getUserEmail()
    .then((email) => {
      state.userEmail = email;
      if (window.location.hash.includes("type=recovery")) {
        state.passwordSetup = true;
        setAdminUi({ passwordSetup: true });
        openAdminPopover();
      } else {
        setAdminUi();
      }
      renderList();
    })
    .catch((err) => {
      console.warn("session restore failed", err);
      state.userEmail = "";
      setAdminUi();
    });
  window.TOfferAuth.onAuthStateChange((event, session) => {
    state.userEmail = session?.user?.email?.toLowerCase() || "";
    if (event === "PASSWORD_RECOVERY") {
      state.passwordSetup = true;
      setAdminUi({ passwordSetup: true });
      openAdminPopover();
    } else if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      setAdminUi();
      renderList();
      if (state.detailId) paintDetail();
    }
  });
}
load();
