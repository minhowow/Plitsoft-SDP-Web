/**
 * 구조 쪽(/how/)의 그림 세 장(2026-11-13 오너 지시). 낱말과 숫자의 출처:
 * - 그림 1: 이 저장소의 코드(src/server/config.ts 의 기본값. 운영 환경 변수는 이 값들을 바꾸지 않는다), .github/workflows/analyze.yml,
 *   runner/run.mjs, src/server/queue.ts·callbacks.ts, src/server/db/migrations/. VM 이 작업 뒤 사라지는 것은 GitHub 호스팅 실행기의
 *   성질이다(이 저장소는 '분석마다 새 VM'만 적는다).
 * - 그림 2·3: CLI 세션의 사실 자료(~/.cache/policypack-eval/structure-2026-11-13/cli-structure.md, 태그 handoff-w11-8 기준)와 그 태그의
 *   CLI 코드. 상태 이름은 사이트의 말(src/lib/report/status.ts)을 쓴다.
 * CLI 를 옮겨 고정하면(CLI_PIN) 낱말과 숫자를 다시 보고 `node scripts/export-figures.mjs` 로 docs/figures/ 를 다시 뽑는다
 * (tests/how.test.ts 가 파일이 이 자료와 같은지, CLI_PIN 이 수집본의 커밋과 같은지 본다).
 */
import { REVIEW_STATUS_LABEL } from "../report/status.ts";
import { Canvas, SIZE, type Figure, type Tone } from "./draw.ts";

/** 실행기가 고정한 CLI(analyze.yml 의 CLI_COMMIT 앞 7자리, contract/cli-current/MANIFEST.json 과 같다)와 그 커밋을 가리키는 태그. */
export const CLI_PIN = { commit: "b5888e5", tag: "handoff-w11-8" } as const;

const FIRST_LINE = 52;
const LINE = 21;
/** 줄 n 개인 상자의 높이. */
const boxH = (n: number) => (n === 0 ? 44 : FIRST_LINE + (n - 1) * LINE + 18);

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

function put(c: Canvas, id: string, x: number, y: number, w: number, title: string, lines: string[], opts: { tone?: Tone; tag?: string } = {}): Placed {
  const h = boxH(lines.length);
  c.box(id, x, y, w, h, title, lines, opts);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, bottom: y + h, right: x + w };
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
  c.label(ax + 12, (ask.bottom + web.y) / 2 + 5, "저장소 주소", { anchor: "start" });
  c.arrow([
    [ax, web.bottom],
    [ax, queue.y],
  ]);
  c.label(ax + 12, (web.bottom + queue.y) / 2 + 5, "분석 줄", { anchor: "start" });
  // 웹 서버 함수가 대기열에서 고른 분석을 GitHub API(workflow_dispatch)로 실행기에 맡긴다.
  const dx = runner.x + 60;
  c.arrow([
    [web.right, web.cy],
    [dx, web.cy],
    [dx, runner.y],
  ]);
  c.label(dx + 12, lane.db.y + 52, "깨움: 분석 id·커밋", { anchor: "start" });
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
  c.label(outX - 12, lane.ai.y + 30, "코드·질문", { tone: "out", anchor: "end" });
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
  c.label(cbX - 12, lane.db.y + 52, "진행·결과 JSON", { anchor: "end" });
  c.label(cbX - 12, lane.db.y + 74, "(서명한 콜백)", { anchor: "end" });
  c.arrow([
    [recv.cx, recv.bottom],
    [recv.cx, store.y],
  ]);
  c.label(recv.cx + 12, (recv.bottom + store.y) / 2 + 5, "저장", { anchor: "start" });
  c.arrow([
    [recv.cx, recv.y],
    [recv.cx, screen.bottom],
  ]);
  c.label(recv.cx - 12, (screen.bottom + recv.y) / 2 + 5, "진행·결과 (3초마다 읽음)", { anchor: "end" });

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
            via: "저장소 주소",
            tag: "Vercel · 서버 함수 sin1",
            title: "웹 (Next.js)",
            lines: ["GitHub 에 공개·끝 커밋 확인", "새 분석 하루 30건, review 하루 10건", "같은 커밋은 다시 씀 (분석은 60분, review 는 늘)"],
          },
          { via: "분석 줄", tag: "DB · Postgres(Neon)", title: "대기열", lines: ["분석 줄 (analyses 표)", "실행 자리 2 · 대기 20"] },
          {
            via: "깨움: 분석 id·커밋 (웹이 GitHub API 로)",
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
            via: "코드·질문 (비밀값 모양은 가림)",
            viaTone: "out",
            tag: "Anthropic API · 외부",
            tone: "out",
            title: "AI",
            lines: ["haiku 5.5 · sonnet 5.5", "답은 CLI 로 돌아감"],
          },
          { via: "진행·결과 JSON (실행기가 서명한 콜백)", tag: "Vercel", title: "결과 받기·보이기", lines: ["콜백 서명 확인 (HMAC)", "DB 에서 읽어 쪽을 그림"] },
          { via: "저장", tag: "DB", tone: "keep", title: "결과 저장", lines: ["결과 JSON 셋 (인용한 코드 줄 포함)", "코드 전체는 두지 않음"] },
          { via: "진행·결과 (3초마다 읽음)", tag: "브라우저", title: "화면", lines: ["3초마다 진행 읽기"] },
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
  const lx = c.swatch(16, 34, "model", "모델이 말한 것", 128);
  c.swatch(lx + 24, 34, "tool", "도구가 한 것 (모델 없음)", 180);

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
  const mapLines = ["법령 이름 113종 · 기능 26가지", "profile · review 만 읽음 (웹 쪽)", "kr-core 는 그 가운데 8개"];
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

export const FIGURES: Figure[] = [pathFigure(), reviewFigure(), usesFigure()];
