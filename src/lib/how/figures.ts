/**
 * 구조 쪽(/how/)의 그림(2026-11-13 오너 지시). 쉬운 판 셋(전시·포스터, 처음 보는 사람이 10초 안에 읽는 것. 상자 7개 이하, 상자마다
 * 제목과 한 줄, 숫자·커밋·모델 이름·내부 낱말 없음), 따라가 보기 하나(사례 하나가 단계를 지나는 모습. 사례 쪽에 실린 결과에서 그대로
 * 옮긴다), 자세한 판 셋(보고서, 만든 사람이 읽는 설계도). 낱말과 숫자의 출처:
 * - 그림 1: 이 저장소의 코드(src/server/config.ts 의 기본값. 운영 환경 변수는 이 값들을 바꾸지 않는다), .github/workflows/analyze.yml,
 *   runner/run.mjs, src/server/queue.ts·callbacks.ts, src/server/db/migrations/. VM 이 작업 뒤 사라지는 것은 GitHub 호스팅 실행기의
 *   성질이다(이 저장소는 '분석마다 새 VM'만 적는다).
 * - 그림 2·3: CLI 세션의 사실 자료(~/.cache/policypack-eval/structure-2026-11-13/cli-structure.md, 태그 handoff-w11-8 기준)와 그 태그의
 *   CLI 코드. 의무 지도는 법령 206개(법률·시행령·시행규칙·고시)를 읽어 뽑은 의무 795개이고, 795줄에 적힌 법령 이름은 113개다
 *   (CLI docs/lawmap/README.md, duties.jsonl). 기능은 26가지(features.yaml 의 features. 품목 6가지는 따로). 상태 이름은 사이트의 말
 *   (src/lib/report/status.ts)을 쓴다.
 * - 따라가 보기: data/cases.json 의 사례(TRACE)를 그대로 읽는다. 고른 까닭은 그 사례의 한 줄 요약(src/lib/cases/stories.ts)이 이 의무다.
 * CLI 를 옮겨 고정하면(CLI_PIN) 낱말과 숫자를 다시 보고 `node scripts/export-figures.mjs` 로 docs/figures/ 를 다시 뽑는다
 * (tests/how.test.ts 가 파일이 이 자료와 같은지, CLI_PIN 이 수집본의 커밋과 같은지 본다).
 */
import { CASE_STORIES } from "../cases/stories.ts";
import { REVIEW_STATUS_LABEL } from "../report/status.ts";
import { SITE } from "../site.ts";
import { BIG, boxHeight, Canvas, SIZE, wrap, type Figure, type Tone } from "./draw.ts";

/** 실행기가 고정한 CLI(analyze.yml 의 CLI_COMMIT 앞 7자리, contract/cli-current/MANIFEST.json 과 같다)와 그 커밋을 가리키는 태그. */
export const CLI_PIN = { commit: "b5888e5", tag: "handoff-w11-8" } as const;

/** 따라가 보기의 사례와 의무(jobtalk: 상담 메시지를 OpenAI 로 보내는데 가입 동의문에 국외 이전이 없다). */
export const TRACE = { slug: "jobtalk", duty: "pipa-28-8-1" } as const;

const LINE = 21;
const boxH = (n: number) => boxHeight(n);

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  bottom: number;
  right: number;
}

function put(
  c: Canvas,
  id: string,
  x: number,
  y: number,
  w: number,
  title: string,
  lines: string[],
  opts: { tone?: Tone; tag?: string; tagAbove?: boolean; size?: { title: number; line: number }; h?: number } = {},
): Placed {
  const h = opts.h ?? boxHeight(lines.length, opts.size);
  c.box(id, x, y, w, h, title, lines, opts);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, bottom: y + h, right: x + w };
}

/* ─────────────────────────── 쉬운 판 1: 한 번의 분석이 지나는 길 ─────────────────────────── */

function pathSimple(): Figure {
  const W = 1216;
  const c = new Canvas();
  const lanes = [
    { id: "browser", name: "브라우저", sub: "", y: 16, h: 108, tone: "plain" as Tone },
    { id: "web", name: "웹", sub: "Vercel", y: 132, h: 108, tone: "plain" as Tone },
    { id: "db", name: "DB", sub: "Postgres", y: 248, h: 108, tone: "plain" as Tone },
    { id: "vm", name: "VM", sub: "GitHub Actions", y: 364, h: 108, tone: "keep" as Tone },
    { id: "ai", name: "AI", sub: "Anthropic", y: 480, h: 132, tone: "out" as Tone },
  ];
  const H = 628;
  const lane = Object.fromEntries(lanes.map((l) => [l.id, l]));
  for (const l of lanes) c.lane(`lane-${l.id}`, 16, l.y, W - 32, l.h, l.name, { sub: l.sub || undefined, tone: l.tone, size: BIG.lane });
  /** 띠 안에 상자 하나(세로 가운데, `low` 면 띠의 아래쪽). 상자는 계단처럼 놓아 ②·③·⑥ 이 곧게 내려가거나 올라간다. */
  const at = (id: string, laneId: string, x: number, w: number, title: string, line: string, opts: { tone?: Tone; low?: boolean } = {}) => {
    const l = lane[laneId];
    const h = boxHeight(1, BIG);
    const y = opts.low ? l.y + l.h - h - 16 : Math.round(l.y + (l.h - h) / 2);
    return put(c, id, x, y, w, title, [line], { tone: opts.tone, size: BIG });
  };
  const s1 = at("s1", "browser", 160, 250, "주소를 넣는다", "저장소 쪽의 분석 요청 단추");
  const s2 = at("s2", "web", 160, 250, "확인하고 줄을 세운다", "공개인지 보고 차례를 정함");
  const s3 = at("s3", "vm", 250, 320, "새 VM 이 코드를 받는다", "GitHub 에서 받아 읽기만, 끝나면 사라짐");
  const s4 = at("s4", "vm", 620, 280, "AI 와 함께 읽는다", "검토 엔진이 의무마다 근거를 찾음");
  const ai = at("ai", "ai", 620, 280, "AI", "바깥 서비스", { tone: "out", low: true });
  const s5 = at("s5", "db", 970, 210, "결과만 저장한다", "코드 전체는 두지 않음", { tone: "keep" });
  const s6 = at("s6", "browser", 970, 210, "화면에 보인다", "진행과 체크리스트");

  // 번호는 선 바로 옆(세로 선은 오른쪽이나 왼쪽 16, 가로 선은 위 12)에 붙인다.
  const NEAR = 16;
  c.arrow([
    [s1.x - 44, s1.cy],
    [s1.x, s1.cy],
  ]);
  c.num(s1.x - 22, s1.cy - 12, 1);
  const x2 = s1.x + 60;
  c.arrow([
    [x2, s1.bottom],
    [x2, s2.y],
  ]);
  c.num(x2 + NEAR, (s1.bottom + s2.y) / 2 + 8, 2);
  // ③ 웹이 VM 을 깨운다(코드는 VM 이 GitHub 에서 받는다). 웹 상자 아래에서 DB 띠를 곧게 지나 VM 상자로.
  const x3 = 330;
  c.arrow([
    [x3, s2.bottom],
    [x3, s3.y],
  ]);
  c.num(x3 + NEAR, lane.db.y + lane.db.h / 2 + 8, 3);
  c.arrow([
    [s3.right, s3.cy],
    [s4.x, s4.cy],
  ]);
  c.num((s3.right + s4.x) / 2, s3.cy - 12, 4);
  const outX = s4.x + 80;
  const backX = s4.x + 200;
  c.arrow(
    [
      [outX, s4.bottom],
      [outX, ai.y],
    ],
    { tone: "out" },
  );
  c.label(outX - 14, lane.ai.y + 30, "AI 가 읽는 코드가 나감", { tone: "out", anchor: "end", size: BIG.line });
  c.arrow([
    [backX, ai.y],
    [backX, s4.bottom],
  ]);
  c.label(backX + 14, lane.ai.y + 30, "답", { anchor: "start", size: BIG.line });
  // ⑤ 결과는 웹을 거쳐(웹이 받아) DB 에 둔다. 웹 띠까지 올라갔다가 DB 상자로 내려온다. ⑥ 의 왼쪽으로 내려와 엇갈리지 않는다.
  const x5 = s4.right + 36;
  const y5 = lane.web.y + lane.web.h - 30;
  const in5 = s5.x + 40;
  c.arrow([
    [s4.right, s4.cy],
    [x5, s4.cy],
    [x5, y5],
    [in5, y5],
    [in5, s5.y],
  ]);
  c.num(x5 - NEAR, lane.db.y + lane.db.h / 2 + 8, 5);
  const x6 = s5.x + 150;
  c.arrow([
    [x6, s5.y],
    [x6, s6.bottom],
  ]);
  c.num(x6 + NEAR, lane.web.y + 40, 6);

  return {
    id: "how-path-simple",
    file: "analysis-path-simple",
    title: "한 번의 분석이 지나는 길",
    width: W,
    height: H,
    shapes: c.shapes,
    list: [
      {
        items: [
          { tag: "브라우저", title: "① 주소를 넣는다", lines: ["저장소 쪽의 분석 요청 단추"] },
          { tag: "웹", title: "② 확인하고 줄을 세운다", lines: ["공개인지 보고 차례를 정함"] },
          { tag: "VM", tone: "keep", title: "③ 새 VM 이 코드를 받는다", lines: ["GitHub 에서 받아 읽기만, 끝나면 사라짐"] },
          { tag: "VM", tone: "keep", title: "④ AI 와 함께 읽는다", lines: ["검토 엔진이 의무마다 근거를 찾음"] },
          { via: "AI 가 읽는 코드가 나감", viaTone: "out", tag: "AI", tone: "out", title: "AI", lines: ["바깥 서비스. 답은 검토 엔진으로 돌아감"] },
          { tag: "DB", title: "⑤ 결과만 저장한다", lines: ["웹이 받아 둠. 코드 전체는 두지 않음"] },
          { tag: "브라우저", title: "⑥ 화면에 보인다", lines: ["진행과 체크리스트"] },
        ],
      },
    ],
    notes: [],
  };
}

/* ─────────────────────────── 쉬운 판 2: 검토 엔진 안에서 일어나는 일 ─────────────────────────── */

/** 도구가 직접 확인하는 것과 못 하는 것. 검색은 다시 돌려 줄 수만 맞춰 본다(검색어가 넓었는지는 보지 않는다). */
const CHECKED = "인용한 코드가 실제로 있는가, '없다'며 낸 검색을 다시 돌려도 같은가";
const UNCHECKED = "그 코드가 의무와 정말 관련 있는가, 검색이 충분히 넓었는가";

function reviewSimple(): Figure {
  const W = 1456;
  const c = new Canvas();
  const size = { title: 18, line: BIG.line };
  const lx = c.swatch(16, 34, "model", "AI 가 말한 것", BIG.line);
  c.swatch(lx + 32, 34, "tool", "도구가 한 것", BIG.line);
  const steps: [string, string, Tone][] = [
    ["무슨 서비스인지 파악", "신호로 찾고 AI 가 보탬", "tool"],
    ["걸리는 법 의무 고르기", "AI 없이 정해 둔 규칙으로", "tool"],
    ["의무마다 근거 찾기", "AI 가 코드를 읽고 답함", "model"],
    ["다른 AI 가 반박", "반대 근거를 다시 찾아봄", "model"],
    ["도구가 직접 확인", "AI 답을 코드에서 대조", "tool"],
    ["체크리스트", "사람이 확인할 목록", "keep"],
  ];
  const w = 214;
  const gap = 28;
  const y = 84;
  const tagOf = (i: number, tone: Tone) => (i === 0 ? "도구 + AI" : tone === "model" ? "AI" : tone === "tool" ? "도구" : undefined);
  // 딱지(AI·도구)는 상자 위에 둔다(제목과 겹치지 않게).
  const boxes = steps.map(([title, line, tone], i) =>
    put(c, `s${i + 1}`, 16 + i * (w + gap), y, w, title, [line], { tone, size, tag: tagOf(i, tone), tagAbove: true }),
  );
  boxes.slice(1).forEach((b, i) =>
    c.arrow([
      [boxes[i].right, boxes[i].cy],
      [b.x, b.cy],
    ]),
  );
  const ty = boxes[0].bottom + 46;
  c.text(16, ty, "직접 확인하는 것", { cls: "hw-tag t-tool", size: 17, bold: true });
  c.text(200, ty, CHECKED, { cls: "hw-title", size: 17 });
  c.text(16, ty + 34, "확인하지 못하는 것", { cls: "hw-tag t-model", size: 17, bold: true });
  c.text(200, ty + 34, UNCHECKED, { cls: "hw-title", size: 17 });

  return {
    id: "how-review-simple",
    file: "analysis-flow-simple",
    title: "검토 엔진 안에서 일어나는 일",
    width: W,
    height: ty + 34 + 22,
    shapes: c.shapes,
    list: [
      { items: steps.map(([title, line, tone], i) => ({ tag: tagOf(i, tone), tone, title, lines: [line] })) },
      {
        items: [
          { tag: "도구", tone: "tool", title: "직접 확인하는 것", lines: [CHECKED] },
          { tag: "AI", tone: "model", title: "확인하지 못하는 것", lines: [UNCHECKED] },
        ],
      },
    ],
    notes: [],
  };
}

/* ─────────────────────────── 쉬운 판 3: 같은 엔진, 두 가지 쓰임 ─────────────────────────── */

function usesSimple(): Figure {
  const W = 1240;
  const c = new Canvas();
  const w = 372;
  const gap = (W - 32 - w * 3) / 2;
  const y = 16;
  const h = boxHeight(1, BIG) + 30;
  const parts: { id: string; title: string; line: string; small: string; tone: Tone; out: string }[] = [
    { id: "dev", title: "개발할 때", line: "내 컴퓨터와 CI 에서, AI 없이도 돎", small: "scan · Claude Code 훅 · pre-commit · CI", tone: "plain", out: "AI 를 켜면 코드가 바깥으로 나감" },
    { id: "engine", title: "같은 엔진 · 같은 정책", line: "같은 규칙으로 코드를 검사", small: "policypack", tone: "keep", out: "" },
    { id: "web", title: "웹에서", line: "남의 저장소를 AI 와 함께, 법 의무를 더 넓게", small: "scan · profile · review", tone: "plain", out: "읽는 코드가 AI(바깥)로 나감" },
  ];
  const boxes = parts.map((p, i) => {
    const x = 16 + i * (w + gap);
    const b = put(c, p.id, x, y, w, p.title, [p.line], { tone: p.tone, size: BIG, h });
    c.text(x + 14, y + h - 14, p.small, { cls: "hw-small", size: BIG.small, in: p.id });
    if (p.out) c.text(x + 14, y + h + 28, p.out, { cls: "hw-tag t-out", size: 15, bold: true });
    return b;
  });
  c.line(
    [
      [boxes[0].right, boxes[0].cy],
      [boxes[1].x, boxes[1].cy],
    ],
    "hw-edge",
  );
  c.line(
    [
      [boxes[1].right, boxes[1].cy],
      [boxes[2].x, boxes[2].cy],
    ],
    "hw-edge",
  );

  return {
    id: "how-uses-simple",
    file: "engine-two-uses-simple",
    title: "같은 엔진, 두 가지 쓰임",
    width: W,
    height: y + h + 48,
    shapes: c.shapes,
    list: [
      {
        items: parts.map((p) => ({
          tone: p.tone,
          title: p.title,
          lines: [p.line, p.small, ...(p.out ? [p.out] : [])],
        })),
      },
    ],
    notes: [],
  };
}

/* ─────────────────────────── 따라가 보기: 사례 하나가 단계를 지나는 모습 ─────────────────────────── */

/** 따라가 보기가 읽는 사례 자료(data/cases.json 의 꼴 가운데 쓰는 것만). */
export interface TraceSource {
  reviewRun: { ranOn: string };
  cases: { slug: string; owner: string; name: string; commit: string; review: unknown }[];
}

interface TraceItem {
  duty: string;
  feature: string;
  law: string;
  article: string;
  duty_text: string;
  status: keyof typeof REVIEW_STATUS_LABEL;
  citations: { file: string; line: number; text: string; ok: boolean }[];
  searches: { claimed: number | null; found: number | null; ok: boolean }[];
  reason: string;
  missing: string;
  verification: { result: string };
}

interface TraceFeature {
  id: string;
  name: string;
  evidence: { file: string; line: number | null; what: string }[];
}

/** 사례 자료에서 따라가 볼 의무 한 건과 그 기능. 없으면 멈춘다(자료가 바뀌면 그림을 다시 고를 일이다). */
export function traceData(source: TraceSource) {
  const found = source.cases.find((c) => c.slug === TRACE.slug);
  const review = found?.review as
    | { checklist?: TraceItem[]; profile?: { features?: TraceFeature[] }; run?: { models?: { investigate?: string; verify?: string } } }
    | undefined;
  const item = review?.checklist?.find((i) => i.duty === TRACE.duty);
  const feature = review?.profile?.features?.find((f) => f.id === item?.feature);
  if (!found || !item || !feature) throw new Error(`따라가 보기: 사례 ${TRACE.slug} 의 의무 ${TRACE.duty} 를 찾지 못했습니다.`);
  return { repo: found, item, feature, ranOn: source.reviewRun.ranOn, models: review?.run?.models ?? {} };
}

/** 사례 결과를 실을 때 함께 보이는 것(docs/commitments.md: 미리 돌린 것, 저장소·커밋·돌린 날·모델). 쪽의 그림 아래와 파일에 쓴다. */
export function traceSourceLine(source: TraceSource): string {
  const { repo, ranOn, models } = traceData(source);
  const by = [models.investigate && `조사 ${models.investigate}`, models.verify && `반박 ${models.verify}`].filter(Boolean).join(" · ");
  return `사례 ${repo.owner}/${repo.name} · 커밋 ${repo.commit.slice(0, 7)} · ${SITE.cases.prerun} ${ranOn}${by ? ` (${by})` : ""} · ${SITE.cases.regate}`;
}

const VERIFICATION: Record<string, string> = { upheld: "유지", overturned: "뒤집음", "overturn-ungrounded": "근거 없는 뒤집기 거절", "not-run": "묻지 못함" };

function traceFigure(source: TraceSource): Figure {
  const { repo, item, feature } = traceData(source);
  const W = 1240;
  const c = new Canvas();
  const headline = `${repo.name} — ${CASE_STORIES[TRACE.slug]?.headline ?? ""}`;
  const head = wrap(headline, W - 32, 18, 2);
  head.forEach((line, i) => c.text(16, 30 + i * 26, line, { cls: "hw-title", size: 18, bold: true }));
  let y = 30 + head.length * 26;
  const lx = c.swatch(16, y + 8, "model", "AI 가 말한 것", 15);
  c.swatch(lx + 28, y + 8, "tool", "도구가 한 것", 15);
  y += 34;

  const DX = 300;
  const DW = W - 16 - DX;
  const cites = item.citations.filter((cite) => cite.ok);
  const cite = cites[0];
  const searches = item.searches;
  const counted = searches.filter((s) => s.ok).map((s) => `${s.found}줄`);
  type Row = { title: string; who: string; tone: Tone; lines: { text: string; cls?: string; mono?: boolean; bold?: boolean }[] };
  const evidence = feature.evidence[0];
  const rows: Row[] = [
    {
      title: "① 감지된 기능",
      who: "도구가 코드 신호로",
      tone: "tool",
      lines: [{ text: feature.name, bold: true }, { text: `신호: ${evidence.file}${evidence.line ? `:${evidence.line}` : ""} — ${evidence.what}` }],
    },
    {
      title: "② 고른 의무",
      who: "도구가 규칙으로",
      tone: "tool",
      lines: [{ text: `${item.law} ${item.article}`, bold: true }, ...wrap(item.duty_text, DW, 15, 2).map((text) => ({ text }))],
    },
    {
      title: "③ AI 가 댄 근거",
      who: "AI (조사)",
      tone: "model",
      lines: [
        { text: `${cite.file}:${cite.line}`, mono: true, bold: true },
        { text: cite.text.trim(), mono: true, cls: "hw-code" },
        ...wrap(item.reason, DW, 15, 3).map((text) => ({ text })),
      ],
    },
    {
      title: "④ 반박",
      who: "다른 AI",
      tone: "model",
      lines: [
        { text: VERIFICATION[item.verification.result] ?? item.verification.result, bold: true },
        { text: item.verification.result === "upheld" ? "반대 근거를 찾아봤지만 앞 판단을 그대로 둠" : "" },
      ].filter((line) => line.text),
    },
    {
      title: "⑤ 도구가 직접 확인",
      who: "조사 답을 받은 바로 뒤",
      tone: "tool",
      lines: [
        {
          text: `인용한 ${cites.map((c) => `${c.line}줄`).join("·")}${cites.length === item.citations.length && cites.length > 1 ? " 모두" : ""} 그 파일에 글자 그대로 있음`,
          bold: true,
        },
        {
          text:
            searches.length > 0
              ? `'없다'며 낸 검색 ${searches.length}개를 다시 돌려 줄 수만 맞춰 봄: ${counted.join("·")}${counted.length === searches.length ? ", AI 가 적은 수와 같음" : ""}`
              : "",
        },
      ].filter((line) => line.text),
    },
    {
      title: "⑥ 체크리스트의 그 줄",
      who: "사람이 확인할 것",
      tone: "keep",
      lines: [
        { text: `${REVIEW_STATUS_LABEL[item.status]} — ${item.law} ${item.article}`, bold: true },
        ...wrap(`없는 것: ${item.missing}`, DW, 15, 2).map((text) => ({ text })),
      ],
    },
  ];

  const step = { title: 17, line: 14 };
  let prev: Placed | null = null;
  rows.forEach((row, i) => {
    const textH = row.lines.length * 22 + 14;
    const h = Math.max(boxHeight(1, step), textH);
    const box = put(c, `t${i + 1}`, 16, y, DX - 40, row.title, [row.who], { tone: row.tone, size: step, h });
    row.lines.forEach((line, j) =>
      c.text(DX, y + 24 + j * 22, line.text, {
        cls: line.cls ?? (line.bold ? "hw-title" : "hw-line"),
        size: line.mono ? 14 : 15,
        bold: line.bold,
        mono: line.mono,
      }),
    );
    if (prev)
      c.arrow([
        [prev.x + 60, prev.bottom],
        [box.x + 60, box.y],
      ]);
    prev = box;
    y = box.bottom + 24;
  });

  // 출처(미리 돌린 결과라는 것, 저장소·커밋·돌린 날·모델, 판정 규칙만 다시 적용함).
  const sourceLines = wrap(traceSourceLine(source), W - 32, 14, 2);
  sourceLines.forEach((line, i) => c.text(16, y + 6 + i * 20, line, { cls: "hw-line", size: 14 }));
  y += 6 + sourceLines.length * 20;
  return {
    id: "how-trace",
    file: "trace-jobtalk",
    title: "따라가 보기: 한 저장소의 한 줄",
    width: W,
    height: y,
    shapes: c.shapes,
    list: [
      {
        items: rows.map((row) => ({
          tag: row.who,
          tone: row.tone,
          title: row.title,
          lines: row.lines.map((line) => line.text),
        })),
      },
    ],
    notes: [],
  };
}

/* ─────────────────────────── 그림 1: 한 번의 분석이 지나는 길 ─────────────────────────── */

function pathFigure(): Figure {
  const W = 1280;
  const c = new Canvas();
  // 경계는 가로 띠, 왼쪽에서 오른쪽이 시간 순서다. 띠의 이름은 왼쪽 칸에 둔다.
  const col = [
    { x: 196, w: 250 },
    { x: 498, w: 230 },
    { x: 760, w: 244 },
    { x: 1066, w: 190 },
  ];
  const lanes = [
    { id: "browser", name: "브라우저", sub: "", y: 16, h: 112, tone: "plain" as Tone },
    { id: "vercel", name: "Vercel", sub: "서버 함수 · sin1", y: 136, h: 178, tone: "plain" as Tone },
    { id: "db", name: "DB", sub: "Postgres · Neon", y: 322, h: 128, tone: "plain" as Tone },
    { id: "vm", name: "GitHub Actions VM", sub: "분석마다 새 VM", y: 458, h: 180, tone: "keep" as Tone },
    { id: "ai", name: "Anthropic API", sub: "", y: 646, h: 128, tone: "out" as Tone },
  ];
  const H = 790;
  const lane = Object.fromEntries(lanes.map((l) => [l.id, l]));
  for (const l of lanes) c.lane(`lane-${l.id}`, 16, l.y, W - 32, l.h, l.name, { sub: l.sub || undefined, tone: l.tone });

  /** 띠 안에서 세로 가운데에 놓는다. */
  const place = (id: string, laneId: string, ci: number, title: string, lines: string[], opts: { tone?: Tone; tag?: string } = {}) => {
    const l = lane[laneId];
    return put(c, id, col[ci].x, Math.round(l.y + (l.h - boxH(lines.length)) / 2), col[ci].w, title, lines, opts);
  };

  const ask = place("ask", "browser", 0, "분석 요청", ["저장소 쪽의 단추"]);
  const web = place("web", "vercel", 0, "웹 (Next.js)", ["GitHub 에 공개·끝 커밋 확인", "새 분석 하루 30건", "review 하루 10건", "같은 커밋은 다시 씀", "(분석은 60분 · review 는 늘)"]);
  const queue = place("queue", "db", 0, "대기열", ["분석 줄 (analyses 표)", "실행 자리 2 · 대기 20"]);
  // 실행기(runner/run.mjs)가 CLI 를 부르고, 진행과 결과를 서명해 웹에 보낸다. CLI 는 실행기 상자 안에 둔다(웹과 직접 잇지 않는다).
  const cliLines = ["scan · AI 판정 (haiku)", "profile 명령 (모델 없음)", "review (haiku·sonnet)", "review 한 건 어림 $3·420초"];
  const runH = boxH(cliLines.length) + 24;
  const runY = Math.round(lane.vm.y + (lane.vm.h - runH) / 2);
  const runW = col[2].x + col[2].w + 12 - col[1].x;
  c.box("runner", col[1].x, runY, runW, runH, "실행기", ["입력 확인", "GitHub 에서 압축본 받기", "CLI 설치 (고정 커밋)", "진행·결과를 서명해 보냄"]);
  const runner = { x: col[1].x, y: runY, w: runW, h: runH, cx: col[1].x + runW / 2, cy: runY + runH / 2, bottom: runY + runH, right: col[1].x + runW };
  const cli = put(c, "cli", col[2].x, runY + 12, col[2].w, `CLI ${CLI_PIN.commit}`, cliLines, { tag: CLI_PIN.tag });
  const recv = place("recv", "vercel", 3, "결과 받기·보이기", ["콜백 서명 확인 (HMAC)", "DB 에서 읽어 쪽을 그림"]);
  const store = place("store", "db", 3, "결과 저장", ["결과 JSON 셋", "(인용한 코드 줄 포함)", "코드 전체는 두지 않음"], { tone: "keep" });
  const screen = place("screen", "browser", 3, "화면", ["3초마다 진행 읽기"]);
  // AI 상자는 띠의 아래쪽에 두어, 오가는 화살표의 말이 들어갈 자리를 남긴다.
  const ai = put(c, "ai", col[2].x, lane.ai.y + lane.ai.h - boxH(1) - 14, col[2].w, "AI", ["haiku 5.5 · sonnet 5.5"], { tone: "out", tag: "외부" });

  const ax = ask.x + 56;
  c.arrow([
    [ax, ask.bottom],
    [ax, web.y],
  ]);
  c.label(ax + 12, (ask.bottom + web.y) / 2 + 5, "① 저장소 주소", { anchor: "start" });
  c.arrow([
    [ax, web.bottom],
    [ax, queue.y],
  ]);
  c.label(ax + 12, (web.bottom + queue.y) / 2 + 5, "② 분석 줄", { anchor: "start" });
  // 웹 서버 함수가 대기열에서 고른 분석을 GitHub API(workflow_dispatch)로 실행기에 맡긴다.
  const dx = runner.x + 60;
  c.arrow([
    [web.right, web.cy],
    [dx, web.cy],
    [dx, runner.y],
  ]);
  c.label(dx + 12, lane.db.y + 52, "③ 깨움: 분석 id·커밋", { anchor: "start" });
  c.label(dx + 12, lane.db.y + 74, "(GitHub API)", { anchor: "start" });
  // CLI ↔ AI: 나가는 것(주황)과 돌아오는 답.
  const outX = cli.x + 70;
  const backX = cli.x + 180;
  c.arrow(
    [
      [outX, cli.bottom],
      [outX, ai.y],
    ],
    { tone: "out" },
  );
  c.label(outX - 12, lane.ai.y + 30, "④ 코드·질문", { tone: "out", anchor: "end" });
  c.arrow([
    [backX, ai.y],
    [backX, cli.bottom],
  ]);
  c.label(backX + 12, lane.ai.y + 30, "답", { anchor: "start" });
  // 진행과 결과는 실행기가 서명한 콜백으로 웹에 오고, 웹이 DB 에 둔다.
  const cbX = recv.x - 24;
  c.arrow([
    [runner.right, runner.cy],
    [cbX, runner.cy],
    [cbX, recv.cy],
    [recv.x, recv.cy],
  ]);
  c.label(cbX - 12, lane.db.y + 52, "⑤ 진행·결과 JSON", { anchor: "end" });
  c.label(cbX - 12, lane.db.y + 74, "(서명한 콜백)", { anchor: "end" });
  c.arrow([
    [recv.cx, recv.bottom],
    [recv.cx, store.y],
  ]);
  c.label(recv.cx + 12, (recv.bottom + store.y) / 2 + 5, "⑥ 저장", { anchor: "start" });
  c.arrow([
    [recv.cx, recv.y],
    [recv.cx, screen.bottom],
  ]);
  c.label(recv.cx - 12, (screen.bottom + recv.y) / 2 + 5, "⑦ 진행·결과 (3초마다 읽음)", { anchor: "end" });

  // 남의 코드가 놓이는 곳(VM 띠의 빈 왼쪽)과 바깥으로 나가는 것의 범례(Anthropic 띠의 빈 왼쪽).
  const nx = col[0].x;
  const ny = lane.vm.y + 66;
  c.text(nx, ny, "남의 코드는 이 VM 에만 풀림", { cls: "hw-title", bold: true });
  c.text(nx, ny + LINE, "읽기만 (설치·빌드·실행 없음)");
  c.text(nx, ny + LINE * 2, "작업이 끝나면 VM 째 사라짐");
  const ly = lane.ai.y + 78;
  c.arrow(
    [
      [nx, ly - 5],
      [nx + 44, ly - 5],
    ],
    { tone: "out" },
  );
  c.text(nx + 56, ly, "바깥으로 나감 (비밀값 모양은 가림)", { cls: "hw-tag t-out", size: SIZE.line, bold: true });

  return {
    id: "how-path",
    file: "analysis-path",
    title: "한 번의 분석이 지나는 길",
    width: W,
    height: H,
    shapes: c.shapes,
    list: [
      {
        items: [
          { tag: "브라우저", title: "분석 요청", lines: ["저장소 쪽의 단추"] },
          {
            via: "① 저장소 주소",
            tag: "Vercel · 서버 함수 sin1",
            title: "웹 (Next.js)",
            lines: ["GitHub 에 공개·끝 커밋 확인", "새 분석 하루 30건, review 하루 10건", "같은 커밋은 다시 씀 (분석은 60분, review 는 늘)"],
          },
          { via: "② 분석 줄", tag: "DB · Postgres(Neon)", title: "대기열", lines: ["분석 줄 (analyses 표)", "실행 자리 2 · 대기 20"] },
          {
            via: "③ 깨움: 분석 id·커밋 (웹이 GitHub API 로)",
            tag: "GitHub Actions VM · 분석마다 새 VM",
            tone: "keep",
            title: "실행기",
            lines: ["입력 확인", "GitHub 에서 압축본 받기", "CLI 설치 (고정 커밋)", "진행·결과를 서명해 보냄"],
          },
          {
            via: "실행기 안에서 돎",
            tag: "GitHub Actions VM",
            tone: "keep",
            title: `CLI ${CLI_PIN.commit} (${CLI_PIN.tag})`,
            lines: cliLines,
          },
          {
            via: "④ 코드·질문 (비밀값 모양은 가림)",
            viaTone: "out",
            tag: "Anthropic API · 외부",
            tone: "out",
            title: "AI",
            lines: ["haiku 5.5 · sonnet 5.5", "답은 CLI 로 돌아감"],
          },
          { via: "⑤ 진행·결과 JSON (실행기가 서명한 콜백)", tag: "Vercel", title: "결과 받기·보이기", lines: ["콜백 서명 확인 (HMAC)", "DB 에서 읽어 쪽을 그림"] },
          { via: "⑥ 저장", tag: "DB", tone: "keep", title: "결과 저장", lines: ["결과 JSON 셋 (인용한 코드 줄 포함)", "코드 전체는 두지 않음"] },
          { via: "⑦ 진행·결과 (3초마다 읽음)", tag: "브라우저", title: "화면", lines: ["3초마다 진행 읽기"] },
        ],
      },
      {
        title: "남의 코드",
        items: [{ tone: "keep", title: "GitHub Actions VM 에만 풀림", lines: ["읽기만 (설치·빌드·실행 없음)", "작업이 끝나면 VM 째 사라짐"] }],
      },
    ],
    notes: [
      "요청은 브라우저 → Vercel 의 웹 → DB 의 대기열을 지나, 실행 자리가 비면 웹이 GitHub Actions 에 맡긴다. 분석마다 새 VM 이 뜨고, 실행기가 진행과 결과를 서명한 콜백으로 보내면 웹이 DB 에 둔다. 화면은 3초마다 그것을 읽는다.",
      `남의 코드는 그 VM 에만 풀리고 읽기만 한다. 바깥(Anthropic)으로는 CLI 가 고른 파일의 코드와 질문이 나간다(비밀값 모양은 가린다). 웹은 Anthropic 을 부르지 않는다. CLI 는 커밋 ${CLI_PIN.commit}(태그 ${CLI_PIN.tag})에 고정했다.`,
      "DB 에 두는 것은 결과 JSON 셋(scan·profile·review)과 진행 기록이다. 인용한 코드 줄은 결과 안에 있고, 코드 전체와 압축본은 두지 않는다.",
      "한도: 새 분석 하루 30건, review 하루 10건, review 한 건 어림 $3·420초(새 질문마다 본다). 같은 커밋은 60분 안의 분석과 저장된 review 를 다시 쓴다.",
    ],
  };
}

/* ─────────────────────────── 그림 2: CLI 안에서 일어나는 일 ─────────────────────────── */

/** 체크리스트의 상태(사이트의 말). "확인할 것"의 세 갈래는 머리 한 줄 아래에 묶고, 긴 이름은 괄호 앞에서 끊는다. */
function statusLines(): string[] {
  const lines: string[] = [];
  let checkHead = false;
  for (const label of Object.values(REVIEW_STATUS_LABEL)) {
    const [head, sub] = label.split(" · ");
    if (sub) {
      if (!checkHead) lines.push(head);
      checkHead = true;
      lines.push(`· ${sub}`);
    } else if (label.includes("(")) {
      const at = label.indexOf("(");
      lines.push(label.slice(0, at), label.slice(at));
    } else lines.push(label);
  }
  return lines;
}

function reviewFigure(): Figure {
  const W = 1240;
  const c = new Canvas();
  const A = { x: 76, w: 246 };
  const B = { x: 372, w: 228 };
  const C = { x: 650, w: 250 };
  const D = { x: 950, w: 274 };
  const top = 96;
  const gap = 26;

  // 범례: 이 그림의 핵심(모델이 말한 것과 도구가 직접 확인한 것).
  const lx = c.swatch(16, 34, "model", "모델이 말한 것");
  c.swatch(lx + 32, 34, "tool", "도구가 한 것 (모델 없음)");

  c.text(A.x, top - 14, "프로필", { cls: "hw-lane-name", size: SIZE.lane, bold: true });
  c.text(C.x, top - 14, "의무마다 · 동시 6", { cls: "hw-lane-name", size: SIZE.lane, bold: true });

  // A: 프로필(위에서 아래로).
  const sig = put(c, "sig", A.x, top, A.w, "신호", ["의존성·import·호출·주소", "→ 기능(26가지 중)·플랫폼"], { tone: "tool", tag: "도구" });
  const stat = put(c, "stat", A.x, sig.bottom + gap, A.w, "정적 검사", ["kr-core 팩 · Semgrep", "→ 의무별 정적 경고"], { tone: "tool", tag: "도구" });
  const und = put(c, "und", A.x, stat.bottom + gap, A.w, "AI 이해", ["haiku 5.5", "서비스 요약", "기능 더하기·빼기", "개인정보 흐름"], { tone: "model", tag: "모델" });
  const g1 = put(c, "g1", A.x, und.bottom + gap, A.w, "관문 ①", ["인용을 못 넘은 주장은 버림"], { tone: "tool", tag: "도구" });
  // C: 의무마다 조사 → 관문 → 반박 → 관문.
  const inv = put(c, "inv", C.x, top, C.w, "조사", ["haiku 5.5 · 의무 하나씩", "코드 읽기·검색 도구로", "상태·인용·근거를 답함"], { tone: "model", tag: "모델" });
  const g2 = put(c, "g2", C.x, inv.bottom + gap, C.w, "관문 ①②③", ["못 넘으면 상태를 낮춤"], { tone: "tool", tag: "도구" });
  const rebLines = ["sonnet 5.5", "빼는 답엔 지키지 않은 곳,", "코드에서 본 것·저장소 밖엔", "지킨 근거나 조건 없음을 찾음", "해당 여부부터·모름은 안 함"];
  const reb = put(c, "reb", C.x, g2.bottom + gap, C.w, "반박", rebLines, {
    tone: "model",
    tag: "모델",
  });
  const g3 = put(c, "g3", C.x, reb.bottom + gap, C.w, "관문 ①②③", ["못 넘으면 앞 판단을 둠"], { tone: "tool", tag: "도구" });

  // B·D 는 A·C 칸 가운데 높은 쪽에 맞춰 세로 가운데에 둔다.
  const colBottom = Math.max(g1.bottom, g3.bottom);

  // B: 걸리는 의무(코드가 고른다).
  const dutyLines = ["의무 지도 795", "− 지위 의무 257", "→ 있는 기능에 걸리는 것", "→ 검토 후보·kr-core 만", "(후보: 조문 인용이 법령", "원문과 맞는 것, 미리 대조)"];
  const duty = put(c, "duty", B.x, Math.round(top + (colBottom - top - boxH(dutyLines.length)) / 2), B.w, "걸리는 의무", dutyLines, { tone: "tool", tag: "도구" });

  // D: 체크리스트.
  const states = statusLines();
  const list = put(c, "list", D.x, Math.round(top + (colBottom - top - boxH(states.length)) / 2), D.w, "체크리스트", states, { tone: "tool", tag: "도구" });

  // 흐름: 저장소에서 들어와 칸 안은 위에서 아래로, 칸 사이는 왼쪽에서 오른쪽으로.
  c.arrow([
    [16, sig.cy],
    [A.x, sig.cy],
  ]);
  c.label(16, sig.cy - 12, "저장소", { anchor: "start" });
  for (const [a, b] of [
    [sig, stat],
    [stat, und],
    [und, g1],
    [inv, g2],
    [g2, reb],
    [reb, g3],
  ] as const)
    c.arrow([
      [a.cx, a.bottom],
      [b.cx, b.y],
    ]);
  const elbow = (from: Placed, to: Placed) => {
    const mx = (from.right + to.x) / 2;
    c.arrow([
      [from.right, from.cy],
      [mx, from.cy],
      [mx, to.cy],
      [to.x, to.cy],
    ]);
  };
  elbow(g1, duty);
  elbow(duty, inv);
  elbow(g3, list);

  // 아래: 관문이 직접 확인하는 것과 확인하지 않고 받는 것.
  const trustLines = ["인용한 줄이 그 의무와 관련 있는지", "검색어가 충분히 넓은지", "모델이 붙인 값(걸리는지·근거·행위인지)", "서비스 요약, 이유·질문 글"];
  const sy = colBottom + 34;
  const gate = put(
    c,
    "gate",
    16,
    sy,
    680,
    "관문이 직접 확인하는 것",
    [
      "① 인용: 인용한 글이 그 파일 코드에 글자 그대로 있는지",
      "    (줄 번호는 도구가 다시 찾음 · 시험·설정 파일과 주석만의 인용은 받지 않음)",
      "② 검색: '없다'는 답의 검색을 다시 돌려 줄 수를 맞춰 봄",
      "③ '해당 없음': 걸리지 않음·조건·근거 '처리 없음'·② 일치가 모두 있을 때만",
      "못 넘으면 상태를 낮춤 (예: 인용이 없으면 '저장소 밖에서 확인할 것')",
    ],
    { tone: "tool", tag: "도구" },
  );
  put(c, "trust", 716, sy, W - 16 - 716, "확인하지 않고 받는 것", trustLines, {
    tone: "model",
    tag: "모델",
  });
  const H = gate.bottom + 16;

  return {
    id: "how-review",
    file: "analysis-flow",
    title: "CLI 안에서 일어나는 일 (review 한 번)",
    width: W,
    height: H,
    shapes: c.shapes,
    list: [
      {
        title: "프로필",
        items: [
          { tag: "도구", tone: "tool", title: "신호", lines: ["의존성·import·호출 모양·주소·경로 낱말·화면 파일", "→ 기능(26가지 중)·플랫폼"] },
          { tag: "도구", tone: "tool", title: "정적 검사", lines: ["kr-core 팩 · Semgrep", "→ 의무별 정적 경고"] },
          { tag: "모델", tone: "model", title: "AI 이해", lines: ["haiku 5.5", "서비스 요약 · 기능 더하기·빼기 · 개인정보 흐름"] },
          { tag: "도구", tone: "tool", title: "관문 ①", lines: ["인용을 못 넘은 주장은 버림"] },
        ],
      },
      {
        items: [{ tag: "도구", tone: "tool", title: "걸리는 의무", lines: dutyLines }],
      },
      {
        title: "의무마다 · 동시 6",
        items: [
          { tag: "모델", tone: "model", title: "조사", lines: ["haiku 5.5 · 의무 하나씩", "코드 읽기·검색 도구로 상태·인용·근거를 답함"] },
          { tag: "도구", tone: "tool", title: "관문 ①②③", lines: ["못 넘으면 상태를 낮춤"] },
          { tag: "모델", tone: "model", title: "반박", lines: ["sonnet 5.5", "빼는 답엔 지키지 않은 곳, 코드에서 본 것·저장소 밖엔 지킨 근거나 조건 없음을 찾음", "해당 여부부터·모름은 반박하지 않음"] },
          { tag: "도구", tone: "tool", title: "관문 ①②③", lines: ["못 넘으면 앞 판단을 둠"] },
        ],
      },
      { items: [{ tag: "도구", tone: "tool", title: "체크리스트", lines: Object.values(REVIEW_STATUS_LABEL) }] },
      {
        title: "관문",
        items: [
          {
            tag: "도구",
            tone: "tool",
            title: "직접 확인하는 것",
            lines: [
              "① 인용: 인용한 글이 그 파일 코드에 글자 그대로 있는지 (줄 번호는 도구가 다시 찾음, 시험·설정 파일과 주석만의 인용은 받지 않음)",
              "② 검색: '없다'는 답의 검색을 다시 돌려 줄 수를 맞춰 봄",
              "③ '해당 없음': 걸리지 않음·조건·근거 '처리 없음'·② 일치가 모두 있을 때만",
              "못 넘으면 상태를 낮춤 (예: 인용이 없으면 '저장소 밖에서 확인할 것')",
            ],
          },
          {
            tag: "모델",
            tone: "model",
            title: "확인하지 않고 받는 것",
            lines: trustLines,
          },
        ],
      },
    ],
    notes: [
      "보라(점선)는 모델이 말한 것, 파랑은 모델 없이 도구가 한 것이다. 어느 의무를 물을지는 코드의 규칙이 고른다: 의무 795개에서 지위 의무를 빼고, 있는 기능(신호와, 인용이 관문을 넘은 AI 의 더하기·빼기)에 걸리는 것 가운데 검토 후보와 kr-core 의무만.",
      "모델의 답은 모두 관문을 거쳐 상태가 정해진다. 관문은 인용한 글이 그 파일 코드에 글자 그대로 있는지, '없다'는 답의 검색을 다시 돌려 줄 수가 같은지, '해당 없음'의 조건과 근거가 갖춰졌는지를 직접 확인하고, 못 넘으면 빼지 않고 상태를 낮춘다.",
      "관문은 인용한 줄이 그 의무와 관련 있는지, 검색어가 충분히 넓은지는 보지 않는다. 그래서 체크리스트는 사람이 확인할 목록이다.",
      "조사는 haiku 5.5, 반박은 sonnet 5.5 이다. 의무 하나씩 묻고 여섯 개까지 동시에 돈다. 웹은 한 건에 어림 $3·420초 상한을 건다(새 질문마다 본다).",
    ],
  };
}

/* ─────────────────────────── 그림 3: 같은 엔진, 두 가지 쓰임 ─────────────────────────── */

function usesFigure(): Figure {
  const W = 1240;
  const c = new Canvas();
  const L = { x: 16, w: 290 };
  const M = { x: 326, w: 300 };
  const R = { x: 646, w: 270 };
  const seamX = 956;
  const web = { x: 996, w: W - 16 - 996 };
  const laneY = 16;
  const top = laneY + 64;
  const gap = 16;
  const inner = (lane: { x: number; w: number }) => ({ x: lane.x + 14, w: lane.w - 28 });

  // 왼쪽: 개발자 쪽(기본값으로 모델·네트워크 없음).
  const li = inner(L);
  const scan = put(c, "scan", li.x, top, li.w, "scan", ["kr-core → Semgrep CE 로 한꺼번에", "참·거짓·모름 세 값으로", "--staged · --diff"]);
  const hook = put(c, "hook", li.x, scan.bottom + gap, li.w, "Claude Code 훅", ["Edit·Write 뒤 그 파일 하나", "확실한 '검토 필요'만 알림"]);
  const ciLines = ["pre-commit: 커밋할 JS/TS 파일", "CI: 저장소 전체", "SARIF 2.1.0 · GitLab Code Quality", "종료 코드 0·1·2"];
  const ci = put(c, "ci", li.x, hook.bottom + gap, li.w, "pre-commit · CI", ciLines);

  // 가운데: 함께 쓰는 것.
  const mi = inner(M);
  const packLines = ["정책 6 · 의무 8 · 조문 원문 8", "Semgrep 규칙으로 옮겨 씀", "두 쪽이 함께 씀"];
  const mapLines = ["법령 206개를 읽어 뽑은 의무", "(의무가 나온 법령 113개)", "기능 26가지와 이은 표", "profile · review 만 읽음 (웹 쪽)", "kr-core 는 그 가운데 8개"];
  const contractLines = ["scan: report-1 JSON 스키마", "review: review-2 JSON 스키마", "profile: 판 1 (스키마 파일 없음)"];
  const pack = put(c, "pack", mi.x, top, mi.w, "정책 팩 kr-core", packLines);
  const map = put(c, "map", mi.x, pack.bottom + gap, mi.w, "의무 지도 795", mapLines);
  const contract = put(c, "contract", mi.x, map.bottom + gap, mi.w, "출력 계약", contractLines);

  // 오른쪽: 웹 쪽(실행기가 부른다).
  const ri = inner(R);
  const judge = put(c, "judge", ri.x, top, ri.w, "scan --judge haiku", ["정적으로 결론이 안 난 곳만", "파일 하나씩 물음"], { tone: "model", tag: "모델" });
  const prof = put(c, "prof", ri.x, judge.bottom + gap, ri.w, "profile", ["모델 없음", "기능 · 플랫폼 · 의무 목록"]);
  const revLines = ["haiku 조사 + sonnet 반박", "켰을 때만 (하루 10건)", "한 건 상한 어림 $3·420초"];
  const rev = put(c, "rev", ri.x, prof.bottom + gap, ri.w, "review", revLines, { tone: "model", tag: "모델" });

  const bottom = Math.max(ci.bottom, contract.bottom, rev.bottom) + 48;
  // 띠는 상자보다 먼저 그려야 아래에 깔린다.
  const lanes = c.shapes.splice(0);
  c.lane("lane-dev", L.x, laneY, L.w, bottom - laneY, "개발자 쪽", { sub: "모델 없이 돎 · 바깥 통신 없음" });
  c.lane("lane-shared", M.x, laneY, M.w, bottom - laneY, "함께 쓰는 것", { sub: "파일 고르기 · 인용 관문 · 비밀값 가림도" });
  c.lane("lane-web", R.x, laneY, R.w, bottom - laneY, "웹 쪽", { sub: "실행기가 부름 · AI 중심" });
  c.shapes.push(...lanes);
  c.text(li.x, bottom - 18, "--judge 를 켜면 판정 대상 코드가 외부 API 로 나감", { cls: "hw-tag t-out", size: SIZE.tag, bold: true, in: "lane-dev" });
  c.text(ri.x, bottom - 18, "판정 대상 코드가 Anthropic API 로 나감", { cls: "hw-tag t-out", size: SIZE.tag, bold: true, in: "lane-web" });

  // 이음매: 웹은 고정한 커밋과 스키마로만 CLI 와 잇는다.
  c.line(
    [
      [seamX, laneY + 26],
      [seamX, bottom],
    ],
    "hw-seam",
    true,
  );
  c.text(seamX, laneY + 14, "이음매", { cls: "hw-lane-name", size: SIZE.lane, bold: true, anchor: "middle" });
  const siteLines = [`CLI 커밋 ${CLI_PIN.commit} 고정`, `(태그 ${CLI_PIN.tag})`, "결과 JSON 의 스키마", "(review-2 사본 · scan 판 1)", "팩 메타데이터 (조문 원문)", "계약 시험: 커밋·날짜·팩"];
  const site = put(c, "site", web.x, Math.round(laneY + (bottom - laneY - boxH(siteLines.length)) / 2), web.w, "웹 (이 사이트)", siteLines, { tone: "keep" });
  c.arrow([
    [R.x + R.w, site.cy],
    [site.x, site.cy],
  ]);
  c.label(seamX, site.cy - 12, "결과 JSON", { anchor: "middle" });

  return {
    id: "how-uses",
    file: "engine-two-uses",
    title: "같은 엔진, 두 가지 쓰임",
    width: W,
    height: bottom + 16,
    shapes: c.shapes,
    list: [
      {
        title: "개발자 쪽 · 모델 없이 돎 · 바깥 통신 없음",
        items: [
          { title: "scan", lines: ["kr-core → Semgrep CE 로 한꺼번에, 참·거짓·모름 세 값으로", "--staged · --diff"] },
          { title: "Claude Code 훅", lines: ["Edit·Write 뒤 그 파일 하나", "확실한 '검토 필요'만 알림"] },
          { title: "pre-commit · CI", lines: ciLines },
          { tone: "out", tag: "외부", title: "--judge 는 선택", lines: ["켜면 판정 대상 코드가 외부 API 로 나감"] },
        ],
      },
      {
        title: "함께 쓰는 것",
        items: [
          { title: "정책 팩 kr-core", lines: packLines },
          { title: "의무 지도 795", lines: mapLines },
          { title: "출력 계약", lines: contractLines },
          { title: "엔진 코드", lines: ["파일 고르기 · 인용 관문 · 비밀값 가림"] },
        ],
      },
      {
        title: "웹 쪽 · 실행기가 부름 · AI 중심",
        items: [
          { tag: "모델", tone: "model", title: "scan --judge haiku", lines: ["정적으로 결론이 안 난 곳만 파일 하나씩 물음"] },
          { title: "profile", lines: ["모델 없음", "기능 · 플랫폼 · 의무 목록"] },
          { tag: "모델", tone: "model", title: "review", lines: revLines },
          { tone: "out", tag: "외부", title: "Anthropic API", lines: ["판정 대상 코드가 나감 (비밀값 모양은 가림)"] },
        ],
      },
      {
        title: "이음매",
        items: [{ via: "결과 JSON", tone: "keep", title: "웹 (이 사이트)", lines: siteLines }],
      },
    ],
    notes: [
      "CLI 하나가 두 길로 쓰인다. 개발자 쪽(scan, Claude Code 훅, pre-commit·CI)은 기본값으로 모델을 부르지 않고 바깥 통신도 없다. 판정자(--judge)를 켜면 판정 대상 코드가 외부 API 로 나간다.",
      "웹 쪽은 실행기가 scan(haiku 판정자)과 profile 을 늘 부르고, review 는 켰을 때만(하루 10건, 같은 커밋의 저장된 것이 없을 때) 부른다. review 에서 조사와 반박은 모델이, 관문은 도구가 한다.",
      "가운데는 CLI 안에 있는 것이다. 정책 팩 kr-core(정책 6·의무 8)와 엔진 코드는 두 쪽이 함께 쓰고, 의무 지도 795 와 review-2 스키마는 웹 쪽(profile·review)만 쓴다.",
      `웹과 CLI 는 고정한 커밋(${CLI_PIN.commit}, 태그 ${CLI_PIN.tag}), 결과 JSON 의 스키마, 팩 메타데이터(조문 원문)로 잇는다. CLI 를 옮기면 계약 시험이 커밋·날짜·팩 판이 맞는지 본다.`,
    ],
  };
}


/** 쪽과 내보내기가 함께 쓰는 그림 모음. 따라가 보기는 사례 자료를 받아 그린다. */
export function buildFigures(cases: TraceSource) {
  return {
    simple: [pathSimple(), reviewSimple(), usesSimple()],
    trace: traceFigure(cases),
    detailed: [pathFigure(), reviewFigure(), usesFigure()],
  };
}
