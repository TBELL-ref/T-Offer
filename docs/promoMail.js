/** T-Offer outreach mail: HTML body from Tassi subscription QA template. */

const LS_KEY = "toffer-mail-template-v2";
const HTML_TEMPLATE_URL = new URL("./mail/tassi-subscription-qa.html", import.meta.url).href;

export const DEFAULT_MAIL_TEMPLATE = {
  subject: "[티어시] 전문 QA팀을 필요한 만큼, 구독형 QA 서비스를 소개드립니다",
  body: "",
  /** true when body is HTML (clipboard text/html). */
  isHtml: true
};

let cachedHtmlBody = null;
let htmlLoadPromise = null;

export async function loadDefaultHtmlBody() {
  if (cachedHtmlBody) return cachedHtmlBody;
  if (!htmlLoadPromise) {
    htmlLoadPromise = fetch(HTML_TEMPLATE_URL)
      .then(async (res) => {
        if (!res.ok) throw new Error(`mail template fetch failed: ${res.status}`);
        const html = await res.text();
        cachedHtmlBody = html;
        return html;
      })
      .catch((err) => {
        htmlLoadPromise = null;
        throw err;
      });
  }
  return htmlLoadPromise;
}

export function loadMailTemplate() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_MAIL_TEMPLATE, body: cachedHtmlBody || "" };
    const parsed = JSON.parse(raw);
    return {
      subject: `${parsed.subject ?? DEFAULT_MAIL_TEMPLATE.subject}`,
      body: `${parsed.body ?? cachedHtmlBody ?? ""}`,
      isHtml: parsed.isHtml !== false
    };
  } catch {
    return { ...DEFAULT_MAIL_TEMPLATE, body: cachedHtmlBody || "" };
  }
}

export async function ensureMailTemplate() {
  const tpl = loadMailTemplate();
  if (tpl.body && tpl.body.trim()) return tpl;
  const html = await loadDefaultHtmlBody();
  return { ...tpl, subject: tpl.subject || DEFAULT_MAIL_TEMPLATE.subject, body: html, isHtml: true };
}

export function saveMailTemplate({ subject, body, isHtml = true }) {
  const next = {
    subject: `${subject ?? ""}`.trim() || DEFAULT_MAIL_TEMPLATE.subject,
    body: `${body ?? ""}`,
    isHtml: Boolean(isHtml)
  };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return next;
}

export async function resetMailTemplate() {
  localStorage.removeItem(LS_KEY);
  cachedHtmlBody = null;
  htmlLoadPromise = null;
  const html = await loadDefaultHtmlBody();
  return { ...DEFAULT_MAIL_TEMPLATE, body: html, isHtml: true };
}

function fill(template, vars) {
  return `${template ?? ""}`.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? "" : `${v}`;
  });
}

function htmlToPlainText(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const text = `${tmp.textContent || tmp.innerText || ""}`
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

export function buildPromoMail({ companyName, postTitle, postUrl } = {}, template = loadMailTemplate()) {
  const co = `${companyName || "귀사"}`.trim();
  const title = `${postTitle || ""}`.trim();
  const url = `${postUrl || ""}`.trim();
  const vars = {
    company: co,
    title,
    url,
    titleLine: title ? `· 관련 공고: ${title}` : "",
    urlLine: url ? `· 링크: ${url}` : ""
  };
  const subject = fill(template.subject || DEFAULT_MAIL_TEMPLATE.subject, vars)
    .replace(/\n+/g, " ")
    .trim();
  const body = fill(template.body || cachedHtmlBody || DEFAULT_MAIL_TEMPLATE.body, vars);
  const isHtml = template.isHtml !== false && /<[a-z][\s\S]*>/i.test(body);
  const plain = isHtml ? htmlToPlainText(body) : body.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  return { subject, body, plain, isHtml };
}

export async function buildPromoMailAsync(opts = {}) {
  const template = await ensureMailTemplate();
  return buildPromoMail(opts, template);
}

export async function copyPromoToClipboard(mail) {
  const subject = mail.subject || "";
  const html = mail.isHtml ? mail.body : "";
  const plain = mail.plain || mail.body || "";
  const bundle = mail.isHtml
    ? `${subject}\n\n${plain}`
    : `${subject}\n\n${plain}`;

  if (mail.isHtml && html && navigator.clipboard?.write && window.ClipboardItem) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([bundle], { type: "text/plain" })
      });
      await navigator.clipboard.write([item]);
      return "html";
    } catch {
      /* fall through */
    }
  }
  await navigator.clipboard.writeText(bundle);
  return "text";
}

export function mailtoHref({ subject, body, to = "" }) {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  // HTML bodies are too large for mailto — subject only
  const plain = `${body || ""}`;
  if (plain && plain.length < 1200 && !/<[a-z][\s\S]*>/i.test(plain)) q.set("body", plain);
  const qs = q.toString();
  return `mailto:${encodeURIComponent(to)}?${qs}`;
}
