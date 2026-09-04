/** Promo outreach copy for QA alba hiring companies. */

export function buildPromoMail({ companyName, postTitle, postUrl } = {}) {
  const co = `${companyName || "귀사"}`.trim();
  const title = `${postTitle || ""}`.trim();
  const url = `${postUrl || ""}`.trim();
  const subject = `[T-Offer] ${co} QA/테스트 알바 채용, 운영 대행 제안`;
  const body = [
    `안녕하세요, ${co} 채용 담당자님.`,
    ``,
    `QA·앱/게임 테스터 단기·알바 채용 공고를 보고 연락드렸습니다.`,
    title ? `· 관련 공고: ${title}` : null,
    url ? `· 링크: ${url}` : null,
    ``,
    `채용·일정·근무 관리를 매번 내부에서 직접 하시기보다,`,
    `저희 서비스로 알바 QA를 모집·운영하시면 반복 채용 비용을 줄일 수 있습니다.`,
    ``,
    `관심 있으시면 회신 부탁드립니다. 짧은 소개 미팅도 가능합니다.`,
    ``,
    `감사합니다.`,
    `T-Offer 팀`
  ]
    .filter((line) => line != null)
    .join("\n");

  return { subject, body };
}

export function mailtoHref({ subject, body, to = "" }) {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  if (body) q.set("body", body);
  const qs = q.toString();
  return `mailto:${encodeURIComponent(to)}?${qs}`;
}
