import type { ReviewStatus } from "../review/index.ts";
import { REVIEW_STATUS_LABEL } from "../report/status.ts";

/**
 * 공개 저장소 41곳 review 평가의 포스터 그림(docs/figures/review-results-41, `node scripts/export-eval-figure.mjs`). 사례 쪽의 구역과
 * 같은 숫자(data/eval-41.json, 읽는 것은 `eval.ts`)를 받는다. 내보내기 스크립트가 Node 로 바로 읽으므로 JSON 을 가져오지 않고 받는다.
 */

export interface EvalRow {
  repos: number;
  counts: Record<ReviewStatus, number>;
  citations: number;
  citationsRejected: number;
  searches: number;
  searchesRejected: number;
  usd: number;
  seconds: number;
  /** 체크리스트가 빈 곳(기능이 없는 저장소). */
  emptyChecklists: number;
  /** '코드에서 본 것'이 1건 이상인 곳. */
  withSeenInCode: number;
  /** 정적 검사만(내장 팩, 판정자 없음)으로 경고가 1건 이상인 곳. */
  staticWithFindings: number;
}

export interface EvalFile {
  ranOn: string;
  /** 판정 규칙의 CLI 판(태그). */
  rules: string;
  /** 조사 모델. */
  model: string;
  rebut: boolean;
  categories: (EvalRow & { kind: string })[];
  total: EvalRow;
  static: { withFindings: number; both: number; reviewOnly: number; staticOnly: number };
}


/** 갈래 색(밝은 바탕). review-results-12 와 같은 색이다. `ink` 는 칸 안 글자색. */
const STATUS_COLOR: Record<ReviewStatus, { fill: string; ink: string; stroke?: string }> = {
  "seen-in-code": { fill: "#bc4c00", ink: "#ffffff" },
  "check-outside": { fill: "#e16f24", ink: "#ffffff" },
  "check-applicability": { fill: "#f5a35c", ink: "#1f2328" },
  unknown: { fill: "#818b98", ink: "#ffffff" },
  "evidence-found": { fill: "#1a7f37", ink: "#ffffff" },
  "likely-not-applicable": { fill: "#c3cad3", ink: "#1f2328" },
  "not-applicable": { fill: "#e3e8ed", ink: "#1f2328", stroke: "#d1d9e0" },
};
const INK = "#1f2328";
const MUTED = "#59636e";
const FONT = "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v: number) => v.toLocaleString("en-US");
const minutes = (seconds: number) => `${Math.round(seconds / 60)}분`;
/** 글의 어림 너비(한글은 글자 크기, 그 밖은 그 0.55 배). 갈래 풀이를 늘어놓는 데만 쓴다(겹침은 내보내기 스크립트가 잰다). */
const approxWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? size : size * 0.55), 0);

/** 그림의 차례: 확인할 것 세 갈래, 모름, 지킨 근거, 걸리지 않는 듯, 해당 없음(`REVIEW_STATUSES` 와 같다). */
const ORDER: ReviewStatus[] = [
  "seen-in-code",
  "check-outside",
  "check-applicability",
  "unknown",
  "evidence-found",
  "likely-not-applicable",
  "not-applicable",
];

/**
 * 포스터 그림(밝은 바탕, 1920 너비). 위에서부터 제목·출처 한 줄, 큰 숫자 넷, 갈래 색 풀이, 성격마다 의무 갈래의 비율 막대(칸 안은
 * 건수), 합계 막대. 오른쪽 칸은 '코드에서 본 것'이 있는 곳 수·비용·시간. 기능이 없는 성격은 막대 대신 빈 체크리스트 수.
 */
export function evalFigureSvg(data: EvalFile): string {
  const W = 1920;
  const out: string[] = [];
  const text = (x: number, y: number, s: string, size: number, opts: { fill?: string; bold?: number; anchor?: string } = {}) =>
    out.push(
      `<text x="${x}" y="${y}" font-size="${size}"${opts.bold ? ` font-weight="${opts.bold}"` : ""}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""} fill="${opts.fill ?? INK}">${esc(s)}</text>`,
    );
  const { total } = data;
  text(48, 58, `공개 저장소 ${total.repos}곳의 review 결과 · 성격별 의무 갈래`, 30, { bold: 700 });
  text(
    48,
    94,
    `${data.ranOn} · 판정 규칙 CLI ${data.rules} · 조사 ${data.model} · 반박 없음 · 비용(공식 단가) 합계 $${total.usd.toFixed(2)} · 합계 ${minutes(total.seconds)} · 저장소 이름은 싣지 않음`,
    17,
    { fill: MUTED },
  );

  // 큰 숫자 넷.
  const tiles: [string, string, string][] = [
    [`${total.withSeenInCode} / ${total.repos}곳`, "코드 줄을 인용한 '코드에서 본 것'이 있는 곳", `정적 검사만으로 경고가 있는 곳은 ${data.static.withFindings}곳`],
    [`${total.emptyChecklists}곳`, "기능이 없는 저장소", "체크리스트가 비어 있음"],
    [`${n(total.citationsRejected)} / ${n(total.citations)}건`, "도구가 거절한 인용", "코드에 그대로 없거나 시험·설정 파일의 줄"],
    [`$${total.usd.toFixed(2)}`, `${total.repos}곳 전체 비용 어림`, `걸린 시간 합계 ${minutes(total.seconds)}`],
  ];
  const tileW = (W - 96 - 3 * 24) / 4;
  tiles.forEach(([big, label, small], i) => {
    const x = 48 + i * (tileW + 24);
    out.push(`<rect x="${x}" y="122" width="${tileW}" height="132" rx="8" fill="#f6f8fa" stroke="#d1d9e0"/>`);
    text(x + 24, 178, big, 42, { bold: 700, fill: i === 0 ? STATUS_COLOR["seen-in-code"].fill : INK });
    text(x + 24, 210, label, 18, { bold: 600 });
    text(x + 24, 236, small, 15, { fill: MUTED });
  });

  // 갈래 색 풀이(두 줄).
  let lx = 48;
  let ly = 290;
  ORDER.forEach((status, i) => {
    if (i === 4) {
      lx = 48;
      ly += 34;
    }
    const c = STATUS_COLOR[status];
    out.push(`<rect x="${lx}" y="${ly - 16}" width="20" height="20" rx="3" fill="${c.fill}"${c.stroke ? ` stroke="${c.stroke}"` : ""}/>`);
    text(lx + 28, ly, REVIEW_STATUS_LABEL[status], 17);
    lx += 28 + approxWidth(REVIEW_STATUS_LABEL[status], 17) + 40;
  });
  text(W - 48, ly + 30, "코드에서 본 것이 있는 곳 · 비용 어림 · 걸린 시간", 15, { fill: MUTED, anchor: "end" });

  // 막대: 성격마다, 그다음 합계.
  const BAR_X = 360;
  const BAR_W = 1120;
  const rows = [...data.categories, { kind: "합계", ...total }];
  let y = ly + 64;
  rows.forEach((row, r) => {
    const isTotal = r === rows.length - 1;
    if (isTotal) {
      out.push(`<line x1="48" x2="${W - 48}" y1="${y - 14}" y2="${y - 14}" stroke="#d1d9e0"/>`);
      y += 8;
    }
    text(48, y + 26, row.kind, 18, { bold: isTotal ? 700 : 600 });
    text(BAR_X - 16, y + 26, `${row.repos}곳`, 15, { fill: MUTED, anchor: "end" });
    const sum = ORDER.reduce((s, status) => s + row.counts[status], 0);
    if (sum === 0) {
      out.push(`<rect x="${BAR_X}" y="${y}" width="${BAR_W}" height="36" fill="none" stroke="#d1d9e0" stroke-dasharray="6 5"/>`);
      text(BAR_X + 16, y + 24, `빈 체크리스트 ${row.emptyChecklists}곳`, 15, { fill: MUTED });
    } else {
      let x = BAR_X;
      for (const status of ORDER) {
        const v = row.counts[status];
        if (v === 0) continue;
        const w = (v / sum) * BAR_W;
        const c = STATUS_COLOR[status];
        out.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="36" fill="${c.fill}"${c.stroke ? ` stroke="${c.stroke}"` : ""}/>`);
        if (w >= 12 + String(v).length * 9) text(+(x + w / 2).toFixed(1), y + 24, n(v), 14, { bold: 600, fill: c.ink, anchor: "middle" });
        x += w;
      }
      text(BAR_X + BAR_W + 12, y + 24, `${n(sum)}건`, 14, { fill: MUTED });
    }
    text(W - 48, y + 24, `${row.withSeenInCode}/${row.repos}곳 · $${row.usd.toFixed(2)} · ${minutes(row.seconds)}`, 15, {
      bold: isTotal ? 700 : undefined,
      anchor: "end",
    });
    y += 58;
  });
  text(48, y + 18, "막대 길이는 성격마다 의무 갈래의 비율, 칸 안의 수는 의무 건수입니다. 칸이 좁으면 수를 적지 않았습니다.", 15, { fill: MUTED });
  const H = y + 48;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    ...out,
    "</svg>",
    "",
  ].join("\n");
}
