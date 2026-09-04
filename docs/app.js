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

const state = {
  view: "companies",
  tab: "new",
  empFilter: "all",
  postFilter: "open",
  companies: [],
  posts: [],
  edits: {},
  query: "",
  userEmail: "",
  busyId: "",
  detailId: "",
  passwordSetup: false
};

function $(sel) {
  return document.querySelector(sel);
}

function stageOf(c) {
  return c.stage || "new";
}

function isExcluded(c) {
  return !!(c.is_hidden || c.exclude_reason);
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
  const c = state.companies.find((x) => x.company_id === id || x.companyId === id);
  if (c) return displayName(c);
  const edit = state.edits[id];
  return edit?.companyNameKo || id || "—";
}

function contactOf(c) {
  const edit = state.edits[c.company_id]?.contact || {};
  return {
    name: edit.name || c.contact_name || "",
    email: edit.email || c.contact_email || "",
    phone: edit.phone || c.contact_phone || ""
  };
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
  if (!matchesEmpFilter(p)) return false;
  if (state.postFilter === "all") return true;
  return postStatusOf(p) === state.postFilter;
}

function companyHasVisiblePost(c) {
  if (isExcluded(c) && state.tab === "excluded") return true;
  const id = c.company_id || c.companyId;
  const posts = offerPosts().filter((p) => (p.company_id || p.companyId) === id);
  // 전체: 공고 없어도 회사 행 유지 (Client 전체와 동일)
  if (state.empFilter === "all") return true;
  // 알바: 알바 공고가 하나라도 있는 회사만
  return posts.some(isAlbaPost);
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

function latestPostForCompany(c) {
  const id = c.company_id || c.companyId;
  const url = c.latest_offer_url || c.latestOfferUrl || "";
  const byUrl = state.posts.find((p) => p.url === url);
  if (byUrl) return byUrl;
  const list = offerPosts().filter((p) => (p.company_id || p.companyId) === id);
  const open = list.find((p) => !isClosedPost(p));
  return open || list[0] || null;
}

function postsForCompany(c) {
  const id = c.company_id || c.companyId;
  return offerPosts().filter((p) => (p.company_id || p.companyId) === id);
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
    const c = state.companies.find((x) => x.company_id === companyId);
    if (out) applyRpcOut(c, out);
    else applyLocalPatch(c, patch);
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
  state.edits[companyId] = {
    ...prev,
    ...(out || {}),
    companyNameKo: patch.companyNameKo ?? out?.companyNameKo ?? prev.companyNameKo,
    domain: patch.domain ?? out?.domain ?? prev.domain,
    notes: patch.notes ?? out?.notes ?? prev.notes,
    contact: {
      ...(prev.contact || {}),
      ...(patch.contact || {}),
      ...(out?.contact || {})
    },
    profile: {
      ...(prev.profile || {}),
      ...(patch.profile || {}),
      ...(out?.profile || {})
    }
  };
  const c = state.companies.find((x) => x.company_id === companyId);
  if (c && patch.companyNameKo) c.company_name = patch.companyNameKo;
  if (c && patch.domain) c.domain = patch.domain;
  if (c && patch.profile?.homepage) c.homepage = patch.profile.homepage;
  renderList();
  if (state.detailId === companyId) paintDetail();
  $("#status").textContent = "회사 정보 저장됨";
  return out;
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
  if (excluded) {
    return `<div class="row-actions">
      <button type="button" class="btn-act" data-act="restore" data-id="${id}" ${disabled}>복구</button>
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

  const posts = offerPosts();
  const postBuckets = {
    all: posts.filter(matchesEmpFilter).length,
    open: posts.filter((p) => matchesEmpFilter(p) && !isClosedPost(p)).length,
    closed: posts.filter((p) => matchesEmpFilter(p) && isClosedPost(p)).length
  };
  for (const [k, v] of Object.entries(postBuckets)) {
    const el = document.querySelector(`[data-post-count="${k}"]`);
    if (el) el.textContent = String(v);
  }
  // emp tab counts: 전체 = Offer 공고 전부, 알바 = 알바 분류만
  const empBuckets = {
    all: posts.length,
    alba: posts.filter(isAlbaPost).length
  };
  for (const [k, v] of Object.entries(empBuckets)) {
    const el = document.querySelector(`[data-emp-count="${k}"]`);
    if (el) el.textContent = String(v);
  }
}

function renderMeta(data) {
  const n = (data.companies || []).filter((c) => !isExcluded(c)).length;
  const posts = offerPosts();
  const closed = posts.filter((p) => isClosedPost(p)).length;
  const open = posts.length - closed;
  $("#metaLine").textContent = `회사 ${n} · 공고 ${posts.length} (모집 ${open} · 마감 ${closed}) · ${formatTime(data.generatedAt)}`;
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
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tab);
  });
  renderList();
}

function renderCompanies() {
  const body = $("#leadBody");
  const empty = $("#empty");
  const rows = state.companies.filter(matchesTab).filter(matchesQueryCompany).filter(companyHasVisiblePost);
  updateCounts();
  if (!rows.length) {
    body.innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent =
      state.tab === "recommended"
        ? "비어 있습니다. 신규에서 「추천」으로 보내세요."
        : state.tab === "progress"
          ? "비어 있습니다. 「메일대기」또는 「발송완료」로 진행에 넣으세요."
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
      return `<tr class="${closed ? "row-closed" : ""} ${open ? "is-open" : ""}" data-company-id="${escapeAttr(c.company_id)}">
        <td><span class="badge ${gradeClass}">${escapeHtml(grade)}</span></td>
        <td class="co-name" data-open-detail="${escapeAttr(c.company_id)}">${escapeHtml(displayName(c))}${
          c.is_recommended ? ` <span class="badge badge-rec">추천</span>` : ""
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
  const rows = offerPosts().filter(matchesPostFilter).filter(matchesQueryPost);
  $("#leadBody").innerHTML = "";
  updateCounts();
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

function poolOf(c) {
  if (isExcluded(c)) return "hidden";
  if (c.is_recommended) return "recommended";
  return "normal";
}

function paintDetail() {
  const c = state.companies.find((x) => x.company_id === state.detailId);
  const drawer = $("#detailDrawer");
  if (!c || !drawer) {
    closeDetail();
    return;
  }
  const edit = state.edits[c.company_id] || {};
  const contact = contactOf(c);
  const locked = !state.userEmail;
  const excluded = isExcluded(c);
  const posts = postsForCompany(c);
  const grade = (c.lead_grade || "C").toUpperCase();
  const stage = stageOf(c);

  $("#detailTitle").textContent = displayName(c);
  $("#detailHeaderChips").innerHTML = `
    <span class="badge ${grade === "A" ? "badge-a" : grade === "B" ? "badge-b" : "badge-c"}">${escapeHtml(grade)}</span>
    <span class="badge badge-src">${escapeHtml(STAGE_LABELS[stage] || stage)}</span>
    ${c.is_recommended ? `<span class="badge badge-rec">추천</span>` : ""}
    ${excluded ? `<span class="badge badge-closed">제외</span>` : ""}
  `;
  $("#detailHeaderSub").textContent = [
    edit.domain || c.domain || "",
    c.homepage || edit.profile?.homepage || "",
    `점수 ${c.priority_score ?? 0}`
  ]
    .filter(Boolean)
    .join(" · ");

  $("#detailRecommendBtn").classList.toggle("hidden", excluded);
  $("#detailExcludeBtn").classList.toggle("hidden", excluded);
  $("#detailRestoreBtn").classList.toggle("hidden", !excluded);
  $("#detailRecommendBtn").textContent = c.is_recommended ? "추천해제" : "추천";
  $("#detailRecommendBtn").disabled = locked;
  $("#detailExcludeBtn").disabled = locked;
  $("#detailRestoreBtn").disabled = locked;

  const dis = locked ? "disabled" : "";
  const pool = poolOf(c);
  const homepage = c.homepage || edit.profile?.homepage || "";

  $("#detailBody").innerHTML = `
    <section class="detail-block">
      <h3 class="detail-block-title">분류</h3>
      <div class="detail-field">
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
      </div>
      <div class="detail-field">
        <label>추천점수</label>
        <input id="detailRecScore" type="number" min="0" max="5" step="1" value="${escapeAttr(String(c.recommend_score ?? 0))}" ${dis} />
      </div>
      <div class="detail-field">
        <label>제외사유</label>
        <input id="detailClosedReason" type="text" value="${escapeAttr(c.closed_reason || "")}" ${dis} placeholder="제외 시 사유" />
      </div>
    </section>

    <section class="detail-block">
      <h3 class="detail-block-title">회사 정보</h3>
      <div class="detail-field">
        <label>회사명</label>
        <input id="detailName" type="text" value="${escapeAttr(displayName(c))}" ${dis} />
      </div>
      <div class="detail-field">
        <label>도메인</label>
        <input id="detailDomain" type="text" value="${escapeAttr(edit.domain || c.domain || "")}" ${dis} />
      </div>
      <div class="detail-field">
        <label>홈페이지</label>
        <input id="detailHomepage" type="url" value="${escapeAttr(homepage)}" ${dis} />
      </div>
      <div class="detail-field">
        <label>담당자</label>
        <input id="detailContactName" type="text" value="${escapeAttr(contact.name)}" ${dis} />
      </div>
      <div class="detail-field">
        <label>이메일</label>
        <input id="detailContactEmail" type="email" value="${escapeAttr(contact.email)}" ${dis} />
      </div>
      <div class="detail-field">
        <label>전화</label>
        <input id="detailContactPhone" type="text" value="${escapeAttr(contact.phone)}" ${dis} />
      </div>
      <div class="detail-field">
        <label>메모</label>
        <textarea id="detailMemo" ${dis} placeholder="영업 메모">${escapeHtml(c.memo || "")}</textarea>
      </div>
      <div class="detail-field">
        <label>노트</label>
        <textarea id="detailNotes" ${dis} placeholder="회사 노트">${escapeHtml(edit.notes || "")}</textarea>
      </div>
      <div class="detail-actions-row">
        <button type="button" class="btn-primary btn-sm" id="detailSaveBtn" ${dis} style="width:auto">정보 저장</button>
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
              .map((p) => {
                const src = SOURCE_LABELS[p.source] || p.source || "—";
                const title = p.title || "(제목 없음)";
                const url = p.url || "";
                const st = postStatusOf(p);
                return `<li>
                  ${statusBadge(st)}
                  <span class="badge badge-src">${escapeHtml(src)}</span>
                  ${
                    url
                      ? `<a class="post-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
                      : escapeHtml(title)
                  }
                  <div class="detail-muted">${escapeHtml(formatTime(p.collected_at || p.collectedAt))}</div>
                </li>`;
              })
              .join("")}</ul>`
          : `<p class="detail-muted">연결된 Offer 공고가 없습니다.</p>`
      }
    </section>
  `;

  $("#detailSaveBtn")?.addEventListener("click", () => saveDetailForm(c));
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

async function saveDetailForm(c) {
  if (!requireLogin()) return;
  const name = $("#detailName")?.value?.trim() || "";
  const domain = $("#detailDomain")?.value?.trim() || "";
  const homepage = $("#detailHomepage")?.value?.trim() || "";
  const contact = {
    name: $("#detailContactName")?.value?.trim() || "",
    email: $("#detailContactEmail")?.value?.trim() || "",
    phone: $("#detailContactPhone")?.value?.trim() || ""
  };
  const notes = $("#detailNotes")?.value ?? "";
  const memo = $("#detailMemo")?.value ?? "";
  const recommendScore = Number($("#detailRecScore")?.value || 0);
  const closedReason = $("#detailClosedReason")?.value?.trim() || "";
  const stage = $("#detailStage")?.value || stageOf(c);

  try {
    await saveCompanyEdit(c.company_id, {
      companyNameKo: name,
      domain,
      notes,
      contact,
      profile: { homepage }
    });
    await patchCompany(c.company_id, {
      memo,
      recommendScore,
      closedReason,
      stage
    });
    $("#status").textContent = "저장됨";
  } catch (err) {
    $("#status").textContent = err.message || "저장 실패";
  }
}

function openDetail(companyId) {
  const c = state.companies.find((x) => x.company_id === companyId);
  if (!c) return;
  state.detailId = companyId;
  const drawer = $("#detailDrawer");
  drawer?.classList.remove("hidden");
  drawer?.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-drawer-open");
  paintDetail();
  renderList();
}

function closeDetail() {
  state.detailId = "";
  const drawer = $("#detailDrawer");
  drawer?.classList.add("hidden");
  drawer?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("detail-drawer-open");
  renderList();
}

function mergeEditsIntoCompanies() {
  for (const c of state.companies) {
    const edit = state.edits[c.company_id];
    if (!edit) continue;
    if (edit.companyNameKo) c.company_name = edit.companyNameKo;
    if (edit.domain) c.domain = edit.domain;
    if (edit.profile?.homepage) c.homepage = edit.profile.homepage;
  }
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
    state.companies = data.companies || [];
    state.posts = data.posts || [];
    try {
      state.edits = (await TOfferSupabase.getCompanyEditsAll()) || {};
      mergeEditsIntoCompanies();
    } catch (err) {
      console.warn("company edits load failed", err);
      state.edits = {};
    }
    renderMeta(data);
    renderList();
    if (state.detailId) paintDetail();
    $("#status").textContent = state.userEmail ? "준비됨 (로그인)" : "준비됨 — 편집은 「관리」로그인 필요";
  } catch (err) {
    console.error(err);
    $("#status").textContent = "로드 실패";
    $("#empty").classList.remove("hidden");
    $("#empty").classList.add("error");
    $("#empty").textContent = `${err.message ?? err}`;
  }
}

async function handleRowAction(act, id) {
  const c = state.companies.find((x) => x.company_id === id);
  if (!c) return;
  if (act === "promo") {
    await copyPromo(c);
    return;
  }
  if (act === "recommend") {
    await recommendCompany(c, !c.is_recommended);
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
      renderList();
    });
  });
  document.querySelectorAll("[data-emp-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-emp-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.empFilter = btn.getAttribute("data-emp-filter");
      renderList();
    });
  });
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
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
    const c = state.companies.find((x) => x.company_id === state.detailId);
    if (!c) return;
    await recommendCompany(c, !c.is_recommended);
  });
  $("#detailExcludeBtn")?.addEventListener("click", async () => {
    const c = state.companies.find((x) => x.company_id === state.detailId);
    if (c) await excludeCompany(c);
  });
  $("#detailRestoreBtn")?.addEventListener("click", async () => {
    const c = state.companies.find((x) => x.company_id === state.detailId);
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
