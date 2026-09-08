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

/** Warm the HTML template cache so 「메일문구」can copy without losing the user gesture. */
export function prefetchMailTemplate() {
  return loadDefaultHtmlBody().catch((err) => {
    console.warn("mail template prefetch failed", err);
    return "";
  });
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
  const looksHtml = /<table[\s>]/i.test(tpl.body || "") || /<!DOCTYPE html>/i.test(tpl.body || "");
  if (tpl.body && tpl.body.trim() && looksHtml) return { ...tpl, isHtml: true };
  const html = await loadDefaultHtmlBody();
  return { ...DEFAULT_MAIL_TEMPLATE, subject: tpl.subject || DEFAULT_MAIL_TEMPLATE.subject, body: html, isHtml: true };
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
  try {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return `${tmp.textContent || tmp.innerText || ""}`
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return `${html || ""}`.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

/** Body fragment pastes more reliably into Outlook/Gmail than a full HTML document. */
export function htmlClipboardFragment(fullHtml) {
  try {
    const doc = new DOMParser().parseFromString(fullHtml, "text/html");
    const bodyHtml = doc.body?.innerHTML?.trim();
    if (bodyHtml) {
      return `<div style="margin:0;padding:0;background:#e8edf4;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;color:#222222;">${bodyHtml}</div>`;
    }
  } catch {
    /* keep full */
  }
  return fullHtml;
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
  const rawBody = fill(template.body || cachedHtmlBody || DEFAULT_MAIL_TEMPLATE.body, vars);
  const isHtml = template.isHtml !== false && /<[a-z][\s\S]*>/i.test(rawBody);
  const body = isHtml ? htmlClipboardFragment(rawBody) : rawBody;
  const plain = isHtml ? htmlToPlainText(body) : body.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  return { subject, body, plain, isHtml };
}

export async function buildPromoMailAsync(opts = {}) {
  const template = await ensureMailTemplate();
  return buildPromoMail(opts, template);
}

function copyHtmlViaExecCommand(html, plain) {
  return new Promise((resolve, reject) => {
    const onCopy = (e) => {
      try {
        e.clipboardData.setData("text/html", html);
        e.clipboardData.setData("text/plain", plain);
        e.preventDefault();
        resolve("html");
      } catch (err) {
        reject(err);
      }
    };
    document.addEventListener("copy", onCopy, { once: true });
    const ok = document.execCommand("copy");
    if (!ok) {
      document.removeEventListener("copy", onCopy);
      reject(new Error("execCommand copy failed"));
    }
  });
}

async function copyHtmlViaClipboardItem(html, plain) {
  if (!navigator.clipboard?.write || !window.ClipboardItem) {
    throw new Error("ClipboardItem unsupported");
  }
  // Safari wants Promise<Blob> values; Chromium accepts Blob.
  const htmlBlob = new Blob([html], { type: "text/html" });
  const plainBlob = new Blob([plain], { type: "text/plain" });
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": plainBlob
      })
    ]);
    return "html";
  } catch {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": Promise.resolve(htmlBlob),
        "text/plain": Promise.resolve(plainBlob)
      })
    ]);
    return "html";
  }
}

/**
 * Copy styled HTML for paste into Outlook/Gmail compose.
 * - text/html → 메일 본문에 Ctrl+V (스타일 유지)
 * - text/plain → 제목만 (메일 제목란에 Ctrl+V)
 */
export async function copyPromoToClipboard(mail) {
  const subject = `${mail.subject || ""}`.trim();
  const html = mail.isHtml ? mail.body : "";
  const plainBody = mail.plain || (!mail.isHtml ? mail.body : "") || "";
  // Subject field uses text/plain; body field prefers text/html.
  const plainForClipboard = subject || plainBody;

  if (mail.isHtml && html) {
    try {
      await copyHtmlViaClipboardItem(html, plainForClipboard);
      return "html";
    } catch (err) {
      console.warn("ClipboardItem html copy failed, trying execCommand", err);
    }
    try {
      await copyHtmlViaExecCommand(html, plainForClipboard);
      return "html";
    } catch (err) {
      console.warn("execCommand html copy failed", err);
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(subject ? `${subject}\n\n${plainBody}` : plainBody);
    return "text";
  }
  throw new Error("clipboard unavailable");
}

export function mailtoHref({ subject, body, to = "" }) {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  const plain = `${body || ""}`;
  if (plain && plain.length < 1200 && !/<[a-z][\s\S]*>/i.test(plain)) q.set("body", plain);
  const qs = q.toString();
  return `mailto:${encodeURIComponent(to)}?${qs}`;
}
