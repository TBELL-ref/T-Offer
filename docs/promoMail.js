/** Single editable promo mail template for T-Offer outreach. */

const LS_KEY = "toffer-mail-template-v1";

export const DEFAULT_MAIL_TEMPLATE = {
  subject: "[T-Offer] {{company}} QA/테스트 알바 채용, 운영 대행 제안",
  body: [
    "안녕하세요, {{company}} 채용 담당자님.",
    "",
    "QA·앱/게임 테스터 단기·알바 채용 공고를 보고 연락드렸습니다.",
    "{{titleLine}}",
    "{{urlLine}}",
    "",
    "채용·일정·근무 관리를 매번 내부에서 직접 하시기보다,",
    "저희 서비스로 알바 QA를 모집·운영하시면 반복 채용 비용을 줄일 수 있습니다.",
    "",
    "관심 있으시면 회신 부탁드립니다. 짧은 소개 미팅도 가능합니다.",
    "",
    "감사합니다.",
    "T-Offer 팀"
  ].join("\n")
};

export function loadMailTemplate() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_MAIL_TEMPLATE };
    const parsed = JSON.parse(raw);
    return {
      subject: `${parsed.subject ?? DEFAULT_MAIL_TEMPLATE.subject}`,
      body: `${parsed.body ?? DEFAULT_MAIL_TEMPLATE.body}`
    };
  } catch {
    return { ...DEFAULT_MAIL_TEMPLATE };
  }
}

export function saveMailTemplate({ subject, body }) {
  const next = {
    subject: `${subject ?? ""}`.trim() || DEFAULT_MAIL_TEMPLATE.subject,
    body: `${body ?? ""}`
  };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return next;
}

export function resetMailTemplate() {
  localStorage.removeItem(LS_KEY);
  return { ...DEFAULT_MAIL_TEMPLATE };
}

function fill(template, vars) {
  return `${template ?? ""}`.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? "" : `${v}`;
  });
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
  const body = fill(template.body || DEFAULT_MAIL_TEMPLATE.body, vars)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
  return { subject, body };
}

export function mailtoHref({ subject, body, to = "" }) {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  if (body) q.set("body", body);
  const qs = q.toString();
  return `mailto:${encodeURIComponent(to)}?${qs}`;
}
