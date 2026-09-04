import { buildPromoMail, mailtoHref } from "./promoMail.js";

const cfg = window.TOfferSupabaseConfig || {};

async function rpc(name, args = {}, { auth = false } = {}) {
  const headers = {
    apikey: cfg.anonKey,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
  if (auth) {
    const token = await window.TOfferAuth?.getAccessToken?.();
    if (!token) throw new Error("로그인이 필요합니다. 헤더에서 로그인해 주세요.");
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers.Authorization = `Bearer ${cfg.anonKey}`;
  }

  const res = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${name} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const TOfferSupabase = {
  getDashboard: () => rpc("get_offer_dashboard"),
  getSnapshot: () => rpc("get_offer_published_snapshot"),
  getCompanyEditsAll: () => rpc("get_company_edits_all"),
  checkEmailAllowed: (email) => rpc("check_email_allowed", { addr: email }),
  upsertSalesManagement: (companyId, patch) =>
    rpc(
      "upsert_offer_sales_management",
      { p_company_id: companyId, p_patch: patch },
      { auth: true }
    ),
  upsertCompanyEdit: (companyId, patch) =>
    rpc("upsert_company_edit", { p_company_id: companyId, p_patch: patch }, { auth: true }),
  buildPromoMail,
  mailtoHref
};
