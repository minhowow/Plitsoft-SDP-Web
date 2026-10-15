import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEMO_APPS, DEMO_VARIANTS } from "@/lib/demo/apps";
import { STATUS_LABEL } from "@/lib/report/status";
import type { Report } from "@/lib/report/types";
import { SITE } from "@/lib/site";
import { readJson, root } from "../helpers";
import { partingOf, squash } from "../policy-page";
import { builtMainText, demoApps, panelText } from "./expected";
import {
  accessibleNodes,
  closeChrome,
  contrast,
  cssDrawn,
  launchChrome,
  newPage,
  NO_STORAGE,
  openPage,
  overflow as overflowOf,
  pixelAt,
  RESULT_ATTRIBUTES,
  scrollThrough,
  serveOut,
  settle,
  stored,
  undrawn,
  unknownAttributes,
  type Opened,
  type Site,
} from "./site";

// `/demo` 를 실제 브라우저로 열어 본다. 빌드된 out/ 을 127.0.0.1 에 띄우고 이 컴퓨터의 Chrome(헤드리스)으로 연다.
// 그려 낸 HTML 만 보는 시험(tests/demo.test.tsx)이 볼 수 없는 것을 본다: 단추로 고른 세 앱 × 두 판이 실제로 보이는지,
// 판을 바꿀 때 요청이 나가는지, 좁은 화면의 가로 넘침과 표의 쌓임, 코드 상자의 스크롤과 키보드 초점, 표의 정책 이름으로
// 아래 결과의 그 정책으로 옮겨 가는 것, 칠한 줄의 색(두 테마), 다른 쪽에 다녀온 뒤, 글이 실제로 그려지는지, CSS 가 그린 글,
// 화면 낭독기에 드러나는 표.

let site: Site;
let browser: Browser;
const contexts: BrowserContext[] = [];
/** 쪽에서 난 오류(잡히지 않은 예외, 콘솔의 오류 줄). 시험마다 비어 있어야 한다. */
const problems: string[] = [];

beforeAll(async () => {
  site = await serveOut();
  try {
    browser = await launchChrome();
  } catch (error) {
    await site.close();
    throw error;
  }
});

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  expect(problems.splice(0)).toEqual([]);
});

// 시험이 실패해도 띄운 것은 닫는다.
afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
});

/**
 * 새 창에서 `/demo` 를 연다(tests/browser/site.ts 의 `openPage`). 테마는 운영체제 설정을 따르므로
 * (`prefers-color-scheme`), 어두운 테마는 그 설정을 흉내 내어 본다.
 */
const openDemo = (viewport = { width: 1280, height: 720 }, colorScheme: "light" | "dark" = "light"): Promise<Opened> =>
  openPage(browser, site, "/demo/", { viewport, colorScheme, contexts, problems });

const APPS = "데모 코드 고르기";
const VARIANTS = "고치기 전과 고친 뒤 고르기";
const button = (page: Page, group: string, name: string) => page.getByRole("group", { name: group }).getByRole("button", { name, exact: true });
const title = (page: Page) => page.locator(".demo-title").innerText();
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
/** 눌려 있는 단추의 이름(앱, 판). */
const pressed = (page: Page) => page.locator('.demo-pick button[aria-pressed="true"]').allInnerTexts();

/** 그 이름의 판이 그려질 때까지 기다린다. */
async function shown(page: Page, name: string): Promise<void> {
  await page.waitForFunction((want) => document.querySelector(".demo-title")?.textContent === want, name);
}

/** 단추를 눌러 앱과 판을 고른다. */
async function pick(page: Page, app: string, variant: string): Promise<void> {
  await button(page, APPS, app).click();
  await button(page, VARIANTS, variant).click();
  await shown(page, `${app} · ${variant}`);
}

/**
 * 쪽이 가로로 넘치는지 잰다(tests/browser/site.ts 의 `overflow`). 코드 상자는 제 안에서 가로로 밀리는 스크롤 상자다.
 * 그 안의 줄은 상자에 가려지므로 재지 않고, 상자 자신은 잰다.
 */
const overflow = (page: Page) => overflowOf(page, ".codeblock pre");

/** 코드 상자 하나를 화면에서 읽은 것. */
async function codeBox(page: Page) {
  return page.locator(".codeblock").first().evaluate((figure) => {
    const pre = figure.querySelector("pre")!;
    const box = pre.getBoundingClientRect();
    const lines = [...pre.querySelectorAll<HTMLElement>(".codeline")];
    // 줄의 글 앞에 CSS 가 그리는 것: 줄 번호, 다른 판과 다른 줄이면 그 앞에 표시("+12"처럼 모아 읽는다).
    const gutters = lines.map((line) => getComputedStyle(line, "::before").content.replace(/["\s]/g, ""));
    return {
      caption: figure.querySelector("figcaption")!.textContent,
      /** 줄의 글을 이은 것. 줄마다 줄바꿈으로 끝난다. */
      code: lines.map((line) => line.textContent).join(""),
      numbers: gutters.map((gutter) => gutter.replace(/^\D+/, "")),
      /** 칠한 줄의 번호. 배경색이 있는 줄을 센다(이름이 아니라 화면에 칠해진 것). */
      painted: lines
        .filter((line) => getComputedStyle(line).backgroundColor !== "rgba(0, 0, 0, 0)")
        .map((line) => Number(line.dataset.line)),
      /** 칠한 줄 바로 아래의 설명. 어느 줄 아래인지와 함께. */
      notes: [...pre.querySelectorAll<HTMLElement>(".codenote")].map((note) => {
        const rect = note.getBoundingClientRect();
        return {
          after: Number((note.previousElementSibling as HTMLElement | null)?.dataset.line),
          text: note.textContent,
          // 설명은 상자의 보이는 너비 안에 있고, 제 글이 그 안에서 줄을 바꾼다(코드처럼 가로로 길게 늘어나지 않는다).
          inside: rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 && note.scrollWidth <= note.clientWidth,
        };
      }),
      /** 다른 판과 다른 줄의 표시(줄 번호 → 표시). 줄 번호 앞에 그려진다. */
      signs: lines.flatMap((line, i) => {
        const sign = gutters[i].replace(/\d+$/, "");
        return sign === "" ? [] : [[Number(line.dataset.line), sign] as const];
      }),
      /** 줄의 글 뒤에는 아무것도 그리지 않는다(표시를 뒤에 두면 화면 낭독기가 다음 줄의 것처럼 읽는다). */
      trailing: [...new Set(lines.map((line) => getComputedStyle(line, "::after").content))],
      legend: figure.querySelector(".code-legend")?.textContent ?? null,
      scroll: pre.scrollWidth,
      client: pre.clientWidth,
    };
  });
}

/** "고치기 전과 고친 뒤의 결과" 표를 화면에서 읽은 것. 넓은 화면에서는 칸 머리가, 좁은 화면에서는 칸마다 적힌 판 이름이 어느 판의 칸인지 말한다. */
async function compareTable(page: Page) {
  return page.locator(".compare").evaluate((table) => {
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    /** 한 줄에 놓였는지: 글 조각들의 위쪽 끝이 하나다. */
    const lines = (el: Element) => new Set([...el.getClientRects()].map((rect) => Math.round(rect.top))).size;
    return {
      /** 칸 머리를 담은 상자. 좁은 화면에서는 1px 로 가린다(안의 칸 머리는 제 크기 그대로 잘려 보이지 않는다). */
      headBox: box(table.querySelector("thead")!),
      /** 칸 머리(정책, 고치기 전, 고친 뒤). */
      head: [...table.querySelectorAll("thead th")].map((th) => ({
        text: th.textContent,
        current: th.classList.contains("compare-current"),
        weight: getComputedStyle(th).fontWeight,
        ...box(th),
      })),
      rows: [...table.querySelectorAll("tbody tr")].map((tr) => {
        const name = tr.querySelector("th")!;
        return {
          name: name.textContent,
          href: name.querySelector("a")?.getAttribute("href") ?? null,
          nameBox: box(name),
          cells: [...tr.querySelectorAll("td")].map((td) => {
            const before = getComputedStyle(td, "::before");
            const chip = td.querySelector(".chip")!.getBoundingClientRect();
            return {
              /** 칸 앞에 CSS 가 적는 판 이름. 넓은 화면에서는 적지 않는다("none"). */
              label: before.content,
              labelWeight: before.fontWeight,
              current: td.classList.contains("compare-current"),
              text: (td as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
              ...box(td),
              /** 칩 옆의 수("발견 N건"): 몇 줄에 걸쳤는지, 칩 아래로 내려갔는지, 내려갔으면 칩과 왼쪽 끝이 맞는지. */
              counts: [...td.querySelectorAll(".count")].map((count) => {
                const rect = count.getBoundingClientRect();
                const dropped = rect.top >= chip.bottom - 4;
                return { lines: lines(count), dropped, aligned: !dropped || Math.abs(rect.left - chip.left) <= 1 };
              }),
            };
          }),
        };
      }),
    };
  });
}

const AI = STATUS_LABEL["needs-review-ai-pending"];
const UNCERTAIN = STATUS_LABEL.uncertain;
const NONE = STATUS_LABEL["not-reported"];
// 코드 상자에는 곁에 조문 이름이 없다. "이 조문"이라고 적지 않는다(채팅의 1행에는 조문이 다른 발견이 둘 실린다).
const FILE_SCOPE = "파일 전체를 보고 내린 판정입니다. 줄 번호는 조문이 닿는다고 본 첫 줄입니다.";

/** 판마다 화면에 보여야 하는 것. 수집본(contract/cli-current)과 합성 코드(contract/fixtures)에서 읽은 대로다. */
interface Expected {
  file: string;
  /** 칠한 줄: 발견에 실린 줄 번호. */
  lines: number[];
  /** 다른 판과 견주어 다른 줄. 칠하지 않고 줄 번호 앞에 표시만 붙인다. */
  differs: number[];
  /** 발견 줄마다의 상태(화면 순서). */
  statuses: string[];
  /** 두 결과의 표의 칸(정책마다 고치기 전, 고친 뒤). */
  compare: string[];
  /** 두 결과의 표의 줄: 정책 이름과, 그 이름이 가리키는 아래 결과의 정책 카드. */
  policies: [name: string, card: string][];
}

const KIDS = [`${AI} 발견 1건`, NONE];
// 고친 뒤에도 두 발견이 남고, 고치기 전에 없던 정책의 발견이 하나 나온다. 그대로 보인다.
const PUSH = [`${AI} 발견 2건`, `${AI} 발견 2건`, NONE, `${UNCERTAIN} 발견 1건`];
const CHAT = [`${AI} 발견 1건`, `${UNCERTAIN} 발견 1건`, `${AI} 발견 1건`, `${AI} 발견 1건`];

const KIDS_POLICIES: Expected["policies"] = [["만 14세 미만 아동의 개인정보 처리", "policy-kr-pipa-22-2"]];
const PUSH_POLICIES: Expected["policies"] = [
  ["광고성 정보에 밝혀야 할 사항 — (광고) 표기, 전송자 명칭·연락처, 무료 수신거부 방법", "policy-kr-network-act-50-4"],
  ["야간(21시~08시) 광고성 정보 전송의 별도 동의", "policy-kr-network-act-50-3"],
];
const CHAT_POLICIES: Expected["policies"] = [
  ["생성형 AI 결과물 표시", "policy-kr-ai-basic-act-31"],
  ["생성형 AI 기반 서비스 사전 고지", "policy-kr-ai-basic-act-31-1"],
];

const EXPECTED: Record<string, Expected> = {
  "kids-signup.main": { file: "src/auth/signup.ts", lines: [5], differs: [], statuses: [AI], compare: KIDS, policies: KIDS_POLICIES },
  "kids-signup.fixed": { file: "src/auth/signup.ts", lines: [], differs: [7], statuses: [], compare: KIDS, policies: KIDS_POLICIES },
  "night-push.main": {
    file: "src/marketing/campaign.ts",
    lines: [2],
    differs: [4, 7, 9, 10],
    statuses: [AI, AI],
    compare: PUSH,
    policies: PUSH_POLICIES,
  },
  "night-push.fixed": {
    file: "src/marketing/campaign.ts",
    lines: [2, 12],
    differs: [4, 5, 6, 7, 8, 9, 11, 13, 15, 16],
    statuses: [AI, AI, UNCERTAIN],
    compare: PUSH,
    policies: PUSH_POLICIES,
  },
  "genai-chat.main": { file: "src/chat/ChatPanel.tsx", lines: [1], differs: [], statuses: [AI, AI], compare: CHAT, policies: CHAT_POLICIES },
  "genai-chat.fixed": {
    file: "src/chat/ChatPanel.tsx",
    lines: [1],
    differs: [7, 10],
    statuses: [AI, UNCERTAIN],
    compare: CHAT,
    policies: CHAT_POLICIES,
  },
};

/** 표 아래에 적는 말. 아래 결과가 어느 판의 것인지와, 다른 판의 결과를 어디서 보는지. */
const WHERE = (label: string) => `표의 정책 이름을 누르면 아래 결과(${label})의 그 정책으로 갑니다.`;
const WHY = "발견마다의 까닭은 그 안의 ‘판정 경로’에 CLI 가 남긴 문장으로 나옵니다.";
const ELSEWHERE = (label: string) => `${label}의 결과는 위의 ‘${label}’ 단추를 누르면 나옵니다.`;
const hints = (page: Page) => page.locator(".demo-compare p.hint").allInnerTexts();
/** 두 결과의 표의 칸 머리. */
const COMPARE_COLUMNS = ["정책", "고치기 전", "고친 뒤"];

/** 다른 판과 다른 줄의 표시가 무엇인지 코드 상자 아래에 적는 말. */
const LEGEND: Record<string, string> = {
  main: "− 고친 뒤의 파일과 견주어 빠졌거나 바뀐 줄입니다.",
  fixed: "+ 고치기 전의 파일과 견주어 더해졌거나 바뀐 줄입니다.",
};

const every = DEMO_APPS.flatMap((app) => DEMO_VARIANTS.map((variant) => ({ app, variant, name: `${app.key}.${variant.key}` })));

describe("세 앱 × 두 판", () => {
  it("볼 판이 여섯이다", () => {
    expect(every.map((entry) => entry.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("세 앱 × 두 판이 모두 보인다: 코드, 칠한 줄과 그 설명, 두 결과의 표, 그 판의 결과", async () => {
    const { page } = await openDemo();
    // 처음에는 첫 앱의 고치기 전이 열려 있다.
    expect(await title(page)).toBe("아동 가입 · 고치기 전");
    expect(await pressed(page)).toEqual(["아동 가입", "고치기 전"]);
    expect(await page.locator("h1").innerText()).toBe("데모: 고치기 전과 고친 뒤");
    expect(await page.locator(".lede").innerText()).toContain("합성 예시입니다. 실제 서비스의 코드가 아닙니다.");

    for (const { app, variant, name } of every) {
      const want = EXPECTED[name];
      const data = readJson("contract", "cli-current", `${name}.json`) as Report;
      await pick(page, app.label, variant.label);
      expect(await pressed(page), name).toEqual([app.label, variant.label]);

      // 판마다 합성 예시라고 밝힌다: 설명의 첫 문장과 코드 상자의 이름표.
      expect(await page.locator(".demo-note").innerText(), name).toMatch(/^합성 예시입니다\. /);
      const box = await codeBox(page);
      expect(box.caption, name).toBe(`${want.file} · 합성 예시`);

      // 코드는 합성 코드 파일 그대로다. 줄 번호는 1부터 차례대로 보인다.
      const code = readFileSync(path.join(root, "contract", "fixtures", app.key, variant.key, want.file), "utf8");
      expect(box.code, name).toBe(code);
      expect(box.numbers, name).toEqual(code.trimEnd().split("\n").map((_, i) => String(i + 1)));

      // 칠한 줄은 결과의 발견에 실린 줄 번호뿐이다. 바로 아래에 파일 전체를 보고 내린 판정이라고 적혀 있다.
      expect(want.lines, name).toEqual([...new Set(data.findings.map((finding) => finding.line))].sort((a, b) => a! - b!));
      expect(box.painted, name).toEqual(want.lines);
      expect(box.notes, name).toEqual(
        want.lines.map((line) => ({
          after: line,
          text: `발견 ${data.findings.filter((finding) => finding.line === line).length}건에 실린 줄 번호입니다. ${FILE_SCOPE}`,
          inside: true,
        })),
      );
      for (const note of await page.locator(".codenote").all()) expect(await note.isVisible(), name).toBe(true);

      // 다른 판과 다른 줄에는 줄 번호 앞에 표시만 붙는다(칠하지 않는다). 표시가 있으면 무엇과 견준 것인지 적혀 있다.
      expect(box.signs, name).toEqual(want.differs.map((line) => [line, variant.sign]));
      expect(box.trailing, name).toEqual(["none"]);
      expect(box.legend, name).toBe(want.differs.length > 0 ? LEGEND[variant.key] : null);

      // 두 결과의 표: 어느 판을 보고 있든 고치기 전과 고친 뒤의 상태가 함께 보인다.
      expect(await page.locator(".compare caption").innerText(), name).toBe("고치기 전과 고친 뒤의 결과");
      expect((await page.locator(".compare tbody td").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim()), name).toEqual(
        want.compare,
      );
      expect(await page.locator(".compare").isVisible(), name).toBe(true);
      // 어느 칸이 어느 판의 것인지는 칸 머리가 말한다. 칸 머리가 보이고, 칸이 제 머리 아래에 놓여 있다.
      const table = await compareTable(page);
      expect(table.head.map((th) => th.text), name).toEqual(["정책", "고치기 전", "고친 뒤"]);
      for (const th of await page.locator(".compare thead th").all()) expect(await th.isVisible(), name).toBe(true);
      // 지금 보는 판의 이름만 짙게 적는다.
      expect(table.head.filter((th) => th.current).map((th) => th.text), name).toEqual([variant.label]);
      expect(table.head.map((th) => th.weight), name).toEqual(table.head.map((th) => (th.current ? "600" : "400")));
      // 줄마다 정책 이름이 보인다. 이름은 아래 결과의 그 정책 카드로 가는 링크다.
      expect(table.rows.map((row) => [row.name, row.href]), name).toEqual(want.policies.map(([policy, card]) => [policy, `#${card}`]));
      for (const th of await page.locator(".compare tbody th").all()) expect(await th.isVisible(), name).toBe(true);
      for (const row of table.rows) {
        expect(row.cells.map((cell) => cell.left), `${name} ${row.name}`).toEqual(table.head.slice(1).map((th) => th.left));
        // 넓은 화면에서는 칸 앞에 판 이름을 따로 적지 않는다(칸 머리가 있다).
        expect(row.cells.map((cell) => cell.label), `${name} ${row.name}`).toEqual(["none", "none"]);
        for (const count of row.cells.flatMap((cell) => cell.counts)) expect(count, `${name} ${row.name}`).toEqual({ lines: 1, dropped: false, aligned: true });
      }
      // 표 아래: 아래 결과가 지금 보는 판의 것이라는 말과, 다른 판의 결과를 어디서 보는지.
      const other = DEMO_VARIANTS.find((v) => v.key !== variant.key)!;
      const otherFindings = (readJson("contract", "cli-current", `${app.key}.${other.key}.json`) as Report).findings.length;
      expect(await hints(page), name).toEqual([
        ...(data.findings.length > 0 && otherFindings === 0 ? [SITE.zeroIsNotClearance] : []),
        data.findings.length > 0 ? `${WHERE(variant.label)} ${WHY}` : WHERE(variant.label),
        ...(otherFindings > 0 ? [ELSEWHERE(other.label)] : []),
      ]);

      // 그 판의 결과: 발견 수, 발견 줄마다의 상태(고친 뒤에도 남은 것은 남은 대로), 정책 카드 다섯.
      expect(await page.locator(".report > .notice").innerText(), name).toBe(
        data.findings.length > 0 ? `사람이 확인할 발견이 ${data.findings.length}건 있습니다.` : SITE.zeroIsNotClearance,
      );
      expect(await page.locator("li.finding summary .chip").allInnerTexts(), name).toEqual(want.statuses);
      expect(want.statuses, name).toHaveLength(data.findings.length);
      expect((await page.locator("li.finding summary code").allInnerTexts()).sort(), name).toEqual(
        data.findings.map((finding) => `${finding.file}:${finding.line}`).sort(),
      );
      expect(await page.locator("article.policy").count(), name).toBe(5);
      expect(await page.locator(".report-meta").innerText(), name).toContain("꺼짐");
      for (const selector of [".demo-title", ".codeblock", ".report", ".disclaimer"]) {
        expect(await page.locator(selector).first().isVisible(), `${name} ${selector}`).toBe(true);
      }
    }
  });

  it("고친 뒤에도 남은 발견에는 왜 그런지가 화면에 보인다: 상태의 뜻과, CLI 가 남긴 판정 경로의 문장", async () => {
    const { page } = await openDemo();
    await pick(page, "광고 푸시", "고친 뒤");
    const notes = (await page.locator(".status-notes li").allInnerTexts()).map((text) => text.replace(/\s+/g, " "));
    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain(`${AI} 정적 조건으로는 대안이 확인되지 않았고, AI 에게 물어야 할 조건은 판정에 넣을 답이 없습니다`);
    expect(notes[1]).toContain(`${UNCERTAIN} 적용 여부나 대안이 '모름'으로 남았습니다. 약한 근거만 있거나`);
    expect(notes[2]).toBe(`${NONE} 발견이 없는 정책은 지금 CLI 출력으로는 '충족 근거 발견'과 '적용 신호 없음'을 구분할 수 없습니다.`);
    // 표 아래의 글은 여러 정책을 두고 하는 말이다. 곁에 없는 정책이나 조문을 "이"로 가리키지 않는다.
    expect(await page.locator(".demo-compare").innerText()).not.toMatch(/이 (정책|조문|결과)/);
    // 판단 보류로 남은 발견의 판정 경로는 처음부터 펼쳐져 있다. 약한 근거라는 문장이 접히지 않은 채 보인다.
    const weak = page.locator("ol.path li", { hasText: "대안 night-consent-field: 약한 근거 — AI 확인 전에는 풀지 않음 → unknown" });
    expect(await weak.count()).toBe(1);
    expect(await weak.isVisible()).toBe(true);
    // 판정자를 켜 보라고 권하는 자리마다 코드가 외부로 나간다는 것이 함께 보인다.
    const advice = await page.locator("p.pending").allInnerTexts();
    expect(advice).toHaveLength(3);
    for (const text of advice) {
      expect(text).toContain("판정자를 켜고 다시 검사하면 풀릴 수 있습니다.");
      expect(text).toContain("판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.");
    }

    await pick(page, "생성형 AI 채팅", "고친 뒤");
    const label = page.locator("ol.path li", { hasText: "대안 label-text: 약한 근거 — AI 확인 전에는 풀지 않음 → unknown" });
    expect(await label.isVisible()).toBe(true);
  });

  it("고치기 전을 볼 때: 표의 '고친 뒤' 칸에 있는 판단 보류의 까닭은 아래에 없고, 고친 뒤를 고르면 나온다고 적혀 있다", async () => {
    // 표와 상태의 뜻은 두 판을 함께 보이지만 아래의 결과는 지금 보는 판의 것뿐이다.
    const { page } = await openDemo({ width: 375, height: 667 });
    const weak = page.locator("ol.path li", { hasText: "약한 근거 — AI 확인 전에는 풀지 않음 → unknown" });
    for (const app of ["광고 푸시", "생성형 AI 채팅"]) {
      await pick(page, app, "고치기 전");
      // 표에는 고친 뒤의 판단 보류가 보이고 그 뜻도 적혀 있다.
      expect((await compareTable(page)).rows.flatMap((row) => row.cells[1].text), app).toContain(`${UNCERTAIN} 발견 1건`);
      expect(await page.locator(".status-notes li", { hasText: UNCERTAIN }).isVisible(), app).toBe(true);
      // 아래 결과(고치기 전)에는 판단 보류인 발견도, 약한 근거라는 문장도 없다.
      expect(await page.locator("li.finding summary .chip").allInnerTexts(), app).not.toContain(UNCERTAIN);
      expect(await weak.count(), app).toBe(0);
      // 그래서 가리키는 말이 아래 결과가 고치기 전의 것임을 밝히고, 고친 뒤의 결과를 어디서 보는지 적는다.
      expect(await hints(page), app).toEqual([`${WHERE("고치기 전")} ${WHY}`, ELSEWHERE("고친 뒤")]);
      for (const hint of await page.locator(".demo-compare p.hint").all()) expect(await hint.isVisible(), app).toBe(true);
      // 적힌 대로 위의 단추를 누르면 나온다.
      await button(page, VARIANTS, "고친 뒤").click();
      await shown(page, `${app} · 고친 뒤`);
      expect(await weak.count(), app).toBe(1);
      expect(await hints(page), app).toEqual([`${WHERE("고친 뒤")} ${WHY}`, ELSEWHERE("고치기 전")]);
    }
  });

  it("앱을 바꿔도 보던 판(고치기 전·고친 뒤)은 그대로다", async () => {
    const { page } = await openDemo();
    await pick(page, "광고 푸시", "고친 뒤");
    // 앱 단추만 누른다. 판 단추는 누르지 않는다.
    await button(page, APPS, "생성형 AI 채팅").click();
    await shown(page, "생성형 AI 채팅 · 고친 뒤");
    expect(await pressed(page)).toEqual(["생성형 AI 채팅", "고친 뒤"]);
    // 이름만이 아니라 보이는 것도 그 판의 것이다(고친 뒤에만 있는 줄의 표시, 판단 보류로 남은 발견).
    expect((await codeBox(page)).signs).toEqual([
      [7, "+"],
      [10, "+"],
    ]);
    expect(await page.locator("li.finding summary .chip").allInnerTexts()).toEqual([AI, UNCERTAIN]);
    await button(page, APPS, "아동 가입").click();
    await shown(page, "아동 가입 · 고친 뒤");
    expect(await pressed(page)).toEqual(["아동 가입", "고친 뒤"]);
    // 고치기 전으로 바꾼 뒤에 앱을 바꾸면 고치기 전이다.
    await button(page, VARIANTS, "고치기 전").click();
    await shown(page, "아동 가입 · 고치기 전");
    await button(page, APPS, "광고 푸시").click();
    await shown(page, "광고 푸시 · 고치기 전");
    expect(await pressed(page)).toEqual(["광고 푸시", "고치기 전"]);
  });

  it("한 판에서 접은 발견 줄이 다른 판의 발견으로 넘어가지 않는다", async () => {
    // 채팅의 두 판은 발견의 지문이 같다(줄 둘레의 코드가 같다). 판마다 새로 그리지 않으면, 고치기 전에서 접은 줄이
    // 고친 뒤의 다른 판정에서도 접힌 채로 남아 판정 경로가 보이지 않는다.
    const { page } = await openDemo();
    const open = () => page.locator("li.finding > details").evaluateAll((all) => all.map((el) => (el as HTMLDetailsElement).open));
    await pick(page, "생성형 AI 채팅", "고치기 전");
    expect(await open()).toEqual([true, true]);
    for (const summary of await page.locator("li.finding > details > summary").all()) await summary.click();
    expect(await open()).toEqual([false, false]);
    await pick(page, "생성형 AI 채팅", "고친 뒤");
    expect(await open()).toEqual([true, true]);
    // 돌아와도 처음 상태다.
    await pick(page, "생성형 AI 채팅", "고치기 전");
    expect(await open()).toEqual([true, true]);
  });
});

describe("표의 정책 이름으로 아래 결과의 그 정책으로 간다", () => {
  /** 초점이 놓인 요소와 쪽의 자리. */
  const where = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement!;
      return {
        id: el.id,
        tag: el.tagName.toLowerCase(),
        /** 창의 위쪽 끝에서 그 요소까지. */
        top: Math.round(el.getBoundingClientRect().top),
        tabindex: el.getAttribute("tabindex"),
        ring: el.matches(":focus-visible") ? getComputedStyle(el).outlineStyle : "none",
        url: location.pathname + location.hash,
        history: history.length,
      };
    });

  it("누르면 그 정책 카드가 창 위쪽에 오고 초점이 그리로 옮겨 간다. 주소와 방문 기록은 그대로다", async () => {
    const { page } = await openDemo({ width: 375, height: 667 });
    await pick(page, "광고 푸시", "고친 뒤");
    const start = await where(page);
    expect(start).toMatchObject({ url: "/demo/" });
    const [first, second] = await page.locator(".compare tbody th a").all();
    expect(await second.innerText()).toBe("야간(21시~08시) 광고성 정보 전송의 별도 동의");

    // 마우스로 누른다. 판단 보류로 남은 정책의 카드가 창 위쪽에 온다(위에 12px 을 띄운다).
    await second.click();
    const card = page.locator("#policy-kr-network-act-50-3");
    expect(await where(page)).toEqual({
      id: "policy-kr-network-act-50-3",
      tag: "article",
      top: 12,
      tabindex: "-1",
      // 마우스로 눌렀을 때는 둘레선을 그리지 않는다.
      ring: "none",
      url: "/demo/",
      history: start.history,
    });
    expect(await card.locator("h3").innerText()).toBe("야간(21시~08시) 광고성 정보 전송의 별도 동의");
    expect(await card.locator(".policy-state .chip").innerText()).toBe(UNCERTAIN);
    // 까닭을 적은 문장(약한 근거)이 그 카드 안에 있다.
    expect(await card.locator("ol.path li", { hasText: "대안 night-consent-field: 약한 근거 — AI 확인 전에는 풀지 않음 → unknown" }).isVisible()).toBe(true);

    // 다음 Tab 은 그 카드 안에서 이어진다(카드의 첫 링크). 초점이 떠나면 카드는 다시 초점을 받지 않는 요소다.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement!.closest("article.policy")?.id)).toBe("policy-kr-network-act-50-3");
    expect(await page.evaluate(() => document.activeElement!.tagName)).toBe("A");
    expect(await page.locator("article.policy[tabindex]").count()).toBe(0);

    // 키보드로: 링크에 초점을 두고 Enter. 옮겨 간 카드에 둘레선이 보인다.
    await first.focus();
    await page.keyboard.press("Enter");
    expect(await where(page)).toEqual({
      id: "policy-kr-network-act-50-4",
      tag: "article",
      top: 12,
      tabindex: "-1",
      ring: "solid",
      url: "/demo/",
      history: start.history,
    });
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });
  });

  it("고치기 전을 볼 때는 그 판의 카드로 간다 (그 판에 발견이 없는 정책이어도)", async () => {
    const { page } = await openDemo();
    await pick(page, "광고 푸시", "고치기 전");
    await page.locator(".compare tbody th a").nth(1).click();
    const at = await where(page);
    expect(at).toMatchObject({ id: "policy-kr-network-act-50-3", url: "/demo/" });
    // 발견이 없는 카드는 쪽의 아래쪽에 있어서, 창 위쪽까지 올라오지 못하면 창 안의 어딘가에 놓인다.
    expect(at.top).toBeGreaterThanOrEqual(12);
    expect(at.top).toBeLessThan(720);
    const card = page.locator("#policy-kr-network-act-50-3");
    expect(await card.locator(".policy-state .chip").innerText()).toBe(NONE);
    expect(await card.locator("li.finding").count()).toBe(0);
  });

  it("옮겨 간 뒤에 다른 쪽에 다녀와도 뒤로 가기가 듣는다", async () => {
    // 해시 링크를 브라우저에 그대로 맡기면 방문 기록에 Next 의 라우터가 모르는 항목이 생긴다. 그 뒤 조문 도감에 갔다가
    // 뒤로 오면 주소만 돌아오고 화면은 조문 도감 그대로다(src/lib/scroll.ts 의 moveTo). 그래서 직접 옮긴다.
    const { page } = await openDemo();
    await pick(page, "광고 푸시", "고친 뒤");
    await page.locator(".compare tbody th a").nth(1).click();
    const landed = await where(page);
    expect(landed).toMatchObject({ id: "policy-kr-network-act-50-3", url: "/demo/" });
    const y = await scrollY(page);

    await page.locator("#policy-kr-network-act-50-3 h3 a").click();
    await page.waitForURL("**/policy/kr-network-act-50-3/");
    await page.waitForSelector(".demo", { state: "detached" });
    await page.goBack();
    await shown(page, "광고 푸시 · 고친 뒤");
    expect(await page.locator("h1").innerText()).toBe("데모: 고치기 전과 고친 뒤");
    expect(await page.evaluate(() => location.pathname + location.hash)).toBe("/demo/");
    expect(await pressed(page)).toEqual(["광고 푸시", "고친 뒤"]);
    await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(y);
  });
});

describe("판을 바꿔도 밖으로 나가는 요청이 없다", () => {
  it("세 앱 × 두 판을 오가며 맨 아래까지 내려도 네트워크 요청이 없고, 브라우저 저장소에도 두지 않는다", async () => {
    const start = site.requests.length;
    const { context, page, outside } = await openDemo();
    const seen: string[] = [];
    context.on("request", (request) => seen.push(`${request.method()} ${request.url()}`));

    // 쪽을 열 때의 요청은 서버에 적힌다(머리 링크의 프리페치까지). 이 시험이 요청을 본다는 뜻이다.
    await settle(site, page);
    const loading = site.requests.slice(start).map((request) => request.url);
    expect(loading[0]).toBe("/demo/");
    expect(loading.some((url) => url.startsWith("/view/"))).toBe(true);
    expect(loading.some((url) => url.startsWith("/policy/"))).toBe(true);
    const mark = { server: site.requests.length, browser: seen.length };

    for (const { app, variant } of every) {
      await pick(page, app.label, variant.label);
      // 맨 아래까지 한 화면씩 내린다. 정책 카드의 링크가 차례로 화면에 들어온다.
      await scrollThrough(page, 40);
      await page.locator("article.policy h3 a").last().hover();
      // 표의 정책 이름을 눌러 아래 결과의 그 정책으로 옮겨 간다. 같은 쪽 안에서 옮겨 갈 뿐이다.
      for (const link of await page.locator(".compare tbody th a").all()) {
        await link.click();
        expect(await page.evaluate(() => document.activeElement!.matches("article.policy"))).toBe(true);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await settle(site, page);

    expect(site.requests.slice(mark.server)).toEqual([]);
    expect(seen.slice(mark.browser)).toEqual([]);
    // 처음부터 끝까지, 이 사이트 밖으로 나가려던 요청도 없다. HTTP 도 WebSocket 도 아닌 길(WebRTC 등)로 이으려던 것도 없다.
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });
});

describe("좁은 화면", () => {
  const FITS: { page: number; over: string[] } = { page: 0, over: [] };

  it.each([
    [375, 667, 355],
    [320, 568, 300],
  ])("%dpx: 세 앱 × 두 판이 가로로 넘치지 않는다 (접힌 채와 모두 펼친 채)", async (width, height, limit) => {
    const { context, page } = await openDemo({ width, height });
    expect(await overflow(page)).toEqual({ ...FITS, limit });
    for (const { app, variant, name } of every) {
      await pick(page, app.label, variant.label);
      expect(await overflow(page), `${name} (접힌 채)`).toEqual({ ...FITS, limit });
      await page.evaluate(() => {
        for (const details of document.querySelectorAll("details")) details.open = true;
      });
      expect(await overflow(page), `${name} (펼친 채)`).toEqual({ ...FITS, limit });
      // 긴 코드 줄은 쪽을 넓히지 않고 코드 상자 안에서 가로로 밀린다. 줄 아래의 설명은 상자 너비 안에서 줄을 바꾼다.
      const box = await codeBox(page);
      expect(box.scroll, name).toBeGreaterThan(box.client);
      for (const note of box.notes) expect(note.inside, `${name} ${note.after}행 아래의 설명`).toBe(true);

      // 두 결과의 표는 줄을 세로로 쌓는다. 칸 머리가 가려지므로, 어느 판의 칸인지는 칸마다 앞에 적힌 판 이름이 말한다.
      // 그 이름은 눈에만 보인다(빈 대체 글 `/ ""` 이 붙어 있다. 화면 낭독기에는 가려 둔 칸 머리가 있다. 아래 "접근성 트리").
      const table = await compareTable(page);
      expect(table.rows.map((row) => row.name), name).toEqual(EXPECTED[name].policies.map(([policy]) => policy));
      for (const th of await page.locator(".compare tbody th").all()) expect(await th.isVisible(), name).toBe(true);
      for (const row of table.rows) {
        expect(row.cells.map((cell) => cell.label), `${name} ${row.name}`).toEqual(['"고치기 전" / ""', '"고친 뒤" / ""']);
        // 지금 보는 판의 이름만 짙게 적는다.
        expect(row.cells.filter((cell) => cell.current).map((cell) => cell.label), `${name} ${row.name}`).toEqual([`"${variant.label}" / ""`]);
        expect(row.cells.map((cell) => cell.labelWeight), `${name} ${row.name}`).toEqual(row.cells.map((cell) => (cell.current ? "600" : "400")));
        // 칸은 정책 이름 아래에 한 줄씩 쌓인다(나란히 놓이지 않는다).
        expect(new Set(row.cells.map((cell) => cell.left)).size, `${name} ${row.name}`).toBe(1);
        // "발견 N건"은 한 덩어리다. 칩 옆에 다 들어가지 않으면 통째로 다음 줄로 내려가 칩 아래에 놓인다.
        for (const count of row.cells.flatMap((cell) => cell.counts)) expect(count, `${name} ${row.name}`).toMatchObject({ lines: 1, aligned: true });
      }
      // 칸 머리는 화면에서만 가린다(1px). 화면 낭독기에는 표의 칸 머리로 남는다(Chrome 의 접근성 트리를 CDP 로 읽는다).
      expect(table.head.map((th) => th.text), name).toEqual(COMPARE_COLUMNS);
      expect([table.headBox.width, table.headBox.height], name).toEqual([1, 1]);
      expect(await accessibleNodes(context, page, ".compare thead th"), name).toEqual(COMPARE_COLUMNS.map((column) => ({ role: "columnheader", name: column })));
      expect((await accessibleNodes(context, page, ".compare tbody th")).map((node) => node.role), name).toEqual(table.rows.map(() => "rowheader"));
    }
    // 고르는 단추는 글이 접히지 않는다(모두 한 줄 높이다). 한 줄에 다 들어가지 않으면 단추가 다음 줄로 넘어간다.
    const heights = await page.locator(".demo-pick button").evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(heights).toHaveLength(5);
    expect(new Set(heights).size).toBe(1);
  });

  it("375px: 코드를 가로로 밀어도 칠한 줄 아래의 설명은 제자리에 남고, 칠은 상자 끝까지 이어진다", async () => {
    const { page } = await openDemo({ width: 375, height: 667 });
    await pick(page, "광고 푸시", "고친 뒤");
    const measure = () =>
      page.locator(".codeblock pre").evaluate((pre) => {
        const box = pre.getBoundingClientRect();
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left - box.left), right: Math.round(r.right - box.left) };
        };
        const line = pre.querySelector('.codeline[data-line="12"]')!;
        return {
          width: Math.round(box.width),
          scrollLeft: pre.scrollLeft,
          notes: [...pre.querySelectorAll(".codenote")].map(rect),
          line: rect(line),
          shadow: getComputedStyle(line).boxShadow !== "none",
        };
      });
    const before = await measure();
    expect(before.notes).toEqual([
      { left: 0, right: before.width },
      { left: 0, right: before.width },
    ]);
    await page.locator(".codeblock pre").evaluate((pre) => (pre.scrollLeft = 200));
    const after = await measure();
    expect(after.scrollLeft).toBe(200);
    // 코드는 밀렸고(줄의 왼쪽 끝이 상자 밖으로 나갔다), 설명은 그대로다.
    expect(after.line.left).toBe(before.line.left - 200);
    expect(after.notes).toEqual(before.notes);
    // 12행의 글은 상자의 오른쪽 끝에 못 미쳐 끝난다. 칠은 좌우로 편 그림자로 끝까지 잇는다.
    expect(after.line.right).toBeLessThan(after.width);
    expect(after.shadow).toBe(true);
    expect((await overflow(page)).page).toBe(0);

    // 칠이 실제로 상자의 오른쪽 끝까지 칠해졌는지, 그 자리의 점을 찍어 본다(꾸밈의 값만으로는 알 수 없다. ROADMAP 8번에
    // 5번에서 넘어와 있던 확인이다). 대조로, 같은 자리의 빈 줄은 코드 상자의 바탕색이다(글자가 없는 줄을 고른다).
    const spot = await page.locator(".codeblock pre").evaluate((pre) => {
      const marked = pre.querySelector<HTMLElement>('.codeline[data-line="12"]')!;
      // 칠한 줄에 가장 가까운 빈 줄.
      const empty = [...pre.querySelectorAll<HTMLElement>(".codeline:not(.codeline-marked)")]
        .filter((line) => line.textContent === "\n")
        .sort((a, b) => Math.abs(Number(a.dataset.line) - 12) - Math.abs(Number(b.dataset.line) - 12))[0];
      // 두 줄의 가운데가 창 가운데에 오게 내린다(줄 자체를 창 안으로 끌어오면 상자의 가로 스크롤도 움직인다).
      const between = (marked.getBoundingClientRect().top + empty.getBoundingClientRect().top) / 2;
      window.scrollTo(0, window.scrollY + between - window.innerHeight / 2);
      const box = pre.getBoundingClientRect();
      const middle = (el: Element) => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
      return {
        x: box.left + pre.clientWidth - 3,
        marked: middle(marked),
        empty: middle(empty),
        emptyLine: Number(empty.dataset.line),
        mark: getComputedStyle(marked).backgroundColor,
        box: getComputedStyle(pre).backgroundColor,
        scrollLeft: pre.scrollLeft,
      };
    });
    expect(spot.scrollLeft).toBe(200);
    expect(spot.mark).not.toBe(spot.box);
    expect(await pixelAt(page, spot.x, spot.marked), "12행의 오른쪽 끝").toBe(spot.mark);
    expect(await pixelAt(page, spot.x, spot.empty), `${spot.emptyLine}행(빈 줄)의 오른쪽 끝`).toBe(spot.box);
  });

  it("375px: 코드를 끌어 골라 복사한 글은 파일의 글과 같다 (줄 번호, 표시, 줄 아래의 설명이 섞이지 않는다)", async () => {
    const { page } = await openDemo({ width: 375, height: 667 });
    for (const [app, variant, file] of [
      ["광고 푸시", "고친 뒤", "night-push/fixed/src/marketing/campaign.ts"],
      ["아동 가입", "고치기 전", "kids-signup/main/src/auth/signup.ts"],
    ]) {
      await pick(page, app, variant);
      const selected = await page.locator(".codeblock pre").evaluate((pre) => {
        const selection = window.getSelection()!;
        selection.selectAllChildren(pre);
        return selection.toString();
      });
      // 빈 줄도 빈 줄로 복사된다.
      expect(`${selected}\n`, file).toBe(readFileSync(path.join(root, "contract", "fixtures", file), "utf8"));
    }
  });
});

describe("칠한 줄의 색", () => {
  it.each(["light", "dark"] as const)("%s: 칠한 줄의 줄 번호와 그 아래의 설명이 칠한 바탕 위에서 읽힌다 (명도 대비 4.5:1 이상)", async (scheme) => {
    // 줄 아래의 설명("발견 N건에 실린 줄 번호입니다")이 가리키는 것이 그 줄 번호다. 옅은 색으로 두면 어두운 테마에서
    // 칠한 바탕과의 대비가 4.18:1 이다.
    const { page } = await openDemo({ width: 375, height: 667 }, scheme);
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
    await pick(page, "광고 푸시", "고친 뒤");
    const colors = await page.locator(".codeblock pre").evaluate((pre) => {
      const of = (line: Element) => ({
        line: Number((line as HTMLElement).dataset.line),
        number: getComputedStyle(line, "::before").color,
        code: getComputedStyle(line).color,
        background: getComputedStyle(line).backgroundColor,
      });
      return {
        marked: [...pre.querySelectorAll(".codeline-marked")].map((line) => {
          const note = getComputedStyle(line.nextElementSibling!);
          return { ...of(line), note: note.color, noteBackground: note.backgroundColor };
        }),
        plain: of(pre.querySelector('.codeline[data-line="1"]')!),
        // 다른 판과 다른 줄의 표시(+·−)와 그 줄 번호. 칠한 줄이 아니면 바탕은 코드 상자의 것이다.
        signed: [...pre.querySelectorAll(".codeline[data-sign]")].map((line) => {
          const own = getComputedStyle(line).backgroundColor;
          return { ...of(line), background: own === "rgba(0, 0, 0, 0)" ? getComputedStyle(pre).backgroundColor : own };
        }),
        box: getComputedStyle(pre).backgroundColor,
      };
    });
    // 다른 판과 다른 줄의 표시(+·−)도 두 테마에서 읽힌다(5번에서는 눈으로만 봤다. ROADMAP 8번).
    expect(colors.signed.map((line) => line.line)).toEqual([4, 5, 6, 7, 8, 9, 11, 13, 15, 16]);
    for (const line of colors.signed) {
      expect(contrast(line.number, line.background), `${line.line}행의 표시와 줄 번호`).toBeGreaterThanOrEqual(4.5);
    }
    expect(colors.marked.map((line) => line.line)).toEqual([2, 12]);
    for (const line of colors.marked) {
      expect(contrast(line.number, line.background), `${line.line}행의 줄 번호`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(line.code, line.background), `${line.line}행의 코드`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(line.note, line.noteBackground), `${line.line}행 아래의 설명`).toBeGreaterThanOrEqual(4.5);
      // 칠한 줄의 줄 번호는 본문 색이다. 설명은 칠한 줄과 같은 바탕이다.
      expect(line.number).toBe(line.code);
      expect(line.noteBackground).toBe(line.background);
    }
    // 칠하지 않은 줄의 번호는 옅은 색이다(칠한 줄만 달리 적는다). 그 줄의 바탕은 코드 상자의 바탕 그대로다.
    expect(colors.plain.number).not.toBe(colors.plain.code);
    expect(colors.plain.background).toBe("rgba(0, 0, 0, 0)");
    expect(contrast(colors.plain.number, colors.box)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("키보드만으로", () => {
  it("단추에 차례로 닿고 Enter·Space 로 고른다. 코드 상자에 초점이 가면 둘레선이 잘리거나 가려지지 않는다", async () => {
    const { page } = await openDemo({ width: 375, height: 667 });
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement!;
        return el.closest(".demo-pick") ? `단추 ${el.textContent}` : el.tagName.toLowerCase();
      });

    // Tab 으로 머리의 링크 넷을 지나 앱 단추 셋, 판 단추 둘, 코드 상자 차례로 닿는다.
    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused());
    }
    expect(order).toEqual(["a", "a", "a", "a", "단추 아동 가입", "단추 광고 푸시", "단추 생성형 AI 채팅", "단추 고치기 전", "단추 고친 뒤", "pre"]);

    // 단추에서 Enter 와 Space 로 고른다. 초점은 누른 단추에 남는다.
    await button(page, APPS, "광고 푸시").focus();
    await page.keyboard.press("Enter");
    await shown(page, "광고 푸시 · 고치기 전");
    expect(await focused()).toBe("단추 광고 푸시");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await focused()).toBe("단추 고친 뒤");
    await page.keyboard.press("Space");
    await shown(page, "광고 푸시 · 고친 뒤");
    expect(await focused()).toBe("단추 고친 뒤");
    expect(await pressed(page)).toEqual(["광고 푸시", "고친 뒤"]);
    // 초점이 어디 있는지 보인다.
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");

    // 다음은 코드 상자다. 좁은 화면에서는 코드가 가로로 넘쳐 스크롤 상자가 되고, 키보드 초점을 받는다(화살표로 민다).
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const pre = document.activeElement!;
      const figure = pre.closest(".codeblock")!;
      const style = getComputedStyle(figure);
      const box = figure.getBoundingClientRect();
      const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
      // 둘레선을 자를 수 있는 것: 넘치는 것을 자르는 조상.
      const clipping: string[] = [];
      for (let el = figure.parentElement; el; el = el.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(el);
        if (el !== document.documentElement && el !== document.body && (overflowX !== "visible" || overflowY !== "visible")) {
          clipping.push(el.className);
        }
      }
      return {
        tag: pre.tagName,
        focusVisible: pre.matches(":focus-visible"),
        // 스크롤 상자 안쪽에 그리면 칠한 줄과 그 아래의 설명이 둘레선을 덮는다. 코드 상자 전체의 바깥에 그린다.
        own: getComputedStyle(pre).outlineStyle,
        figure: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
        // 둘레선의 바깥 끝이 창 안에 있다.
        left: box.left - reach,
        right: box.right + reach,
        clipping,
      };
    });
    expect(ring).toMatchObject({ tag: "PRE", focusVisible: true, own: "none", figure: "solid 2px 2px", clipping: [] });
    expect(ring.left).toBeGreaterThanOrEqual(0);
    expect(ring.right).toBeLessThanOrEqual(375);
    // 화살표로 코드를 가로로 민다.
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.locator(".codeblock pre").evaluate((pre) => pre.scrollLeft), { timeout: 3_000 }).toBeGreaterThan(0);
  });
});

describe("다른 쪽에 다녀오거나 새로 고친 뒤", () => {
  it("정책 링크로 갔다가 뒤로 와도, 머리의 링크로 다녀와도 고른 앱과 판이 그대로다", async () => {
    // 고른 것은 메모리에만 둔다. 되살리지 않으면 뒤로 왔을 때 첫 앱의 고치기 전이 열리는데, 브라우저가 스크롤 자리는
    // 되살리므로 보던 것과 다른 앱의 결과 한가운데에 놓인다.
    const { page } = await openDemo();
    await pick(page, "광고 푸시", "고친 뒤");
    const link = page.locator("article.policy h3 a").nth(1);
    await link.scrollIntoViewIfNeeded();
    const before = { y: await scrollY(page), cards: await page.locator(".policies").innerText() };
    expect(before.y).toBeGreaterThan(720);
    expect(before.cards).toContain("src/marketing/campaign.ts:12");

    await link.click();
    await page.waitForURL("**/policy/**");
    await page.waitForSelector(".demo", { state: "detached" });
    await page.goBack();
    await page.waitForURL("**/demo/");
    await shown(page, "광고 푸시 · 고친 뒤");
    expect(await pressed(page)).toEqual(["광고 푸시", "고친 뒤"]);
    expect(await page.locator(".policies").innerText()).toBe(before.cards);
    await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(before.y);

    // 머리의 링크로 다녀와도(뒤로 가기가 아니다) 그대로다.
    await page.locator(".site-header nav a", { hasText: "조문 도감" }).click();
    await page.waitForURL("**/policy/");
    await page.locator(".site-header nav a", { hasText: "데모" }).click();
    await page.waitForURL("**/demo/");
    await shown(page, "광고 푸시 · 고친 뒤");
    expect(await pressed(page)).toEqual(["광고 푸시", "고친 뒤"]);
  });

  it("새로 고치면 첫 앱의 고치기 전이 맨 위에서 열린다", async () => {
    // 고른 것은 브라우저 저장소에 두지 않으므로 새로 고치면 사라진다. 그런데 브라우저는 앞서 보던 스크롤 자리를 되살린다.
    // 그대로 두면 보던 것과 다른 앱의 결과 한가운데에 놓이고, 무엇이 열려 있는지 알리는 이름과 단추는 화면 밖이다.
    const { page } = await openDemo();
    await pick(page, "광고 푸시", "고친 뒤");
    await page.evaluate(() => window.scrollTo(0, 2000));
    expect(await scrollY(page)).toBe(2000);
    await page.reload({ waitUntil: "load" });
    await shown(page, "아동 가입 · 고치기 전");
    expect(await pressed(page)).toEqual(["아동 가입", "고치기 전"]);
    await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(0);
    // 조금 뒤에도 그대로다(브라우저가 스크롤 자리를 늦게 되살리는 때가 있다).
    await page.waitForTimeout(700);
    expect(await scrollY(page)).toBe(0);
    // 지켜보는 동안이 지나면 스크롤을 건드리지 않는다.
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300);
    expect(await scrollY(page)).toBe(900);
  });

  it("처음 찾아온 쪽에서는 스크롤을 건드리지 않는다", async () => {
    // 맨 위로 올리는 것은 문서를 다시 받았을 때뿐이다. 스크립트가 늦게 붙는 동안 읽어 내려간 사람을 끌어올리면 안 된다.
    // 스크립트가 붙기 전에 내려야 하므로 쪽은 문서만 읽고 바로 돌려받는다(창은 다른 시험과 같게 연다).
    const { page } = await newPage(browser, site, { contexts, problems });
    await page.goto(`${site.origin}/demo/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, 400));
    // 스크립트가 붙을 때까지 기다린다(단추에 React 가 붙는다).
    await page.waitForFunction(() => Object.keys(document.querySelector(".demo-pick button")!).some((key) => key.startsWith("__react")));
    await page.waitForTimeout(700);
    expect(await scrollY(page)).toBe(400);
    expect(await title(page)).toBe("아동 가입 · 고치기 전");
  });
});

describe("데모의 글과 꾸밈 (조문 도감·기록의 시험과 같은 기준)", () => {
  // 조문 도감과 조문별 검사 기록의 시험에만 있던 확인을 데모로 넓힌다(ROADMAP 8번): 브라우저에서 도는 코드가 더한 글이
  // 없는지(그린 글이 부품이 그린 글과 같은지), CSS 가 그린 글, 글이 실제로 그려지는지, 접근성 트리의 이름.

  /**
   * 데모가 CSS 로 그리는 글. 셋 다 그 요소의 속성 값을 그대로 옮겨 그린다. 코드의 줄 번호(복사한 글에 섞이지 않게 CSS 로
   * 그린다), 다른 판과 다른 줄의 표시와 줄 번호, 좁은 화면에서 두 결과의 표의 칸 앞에 적는 판 이름(칸 머리를 가린다). 판
   * 이름에는 빈 대체 글이 붙어 있어야 한다(9번. 조문별 검사 기록의 칸 앞 이름과 같다). 없으면 칸마다 판 이름이 두 번 읽힌다.
   */
  const ALLOWED = [
    { selector: ".codeline:not([data-sign])", pseudo: "::before" as const, attributes: ["data-line"] },
    { selector: ".codeline[data-sign]", pseudo: "::before" as const, attributes: ["data-sign", "data-line"] },
    { selector: ".compare tbody td", pseudo: "::before" as const, attributes: ["data-label"], alt: "" },
  ];
  const ALLOWED_RULES = ["content: attr(data-line)", 'content: attr(data-sign) " " attr(data-line)', 'content: attr(data-label) / ""'];
  /** 데모(`.demo`)에 붙는 속성. 결과 화면의 것(`RESULT_ATTRIBUTES`)에 고르는 단추와 그 묶음, 코드 줄, 두 결과의 표의 칸이 더해진다. */
  const DEMO_ATTRIBUTES: Record<string, string> = {
    ...RESULT_ATTRIBUTES,
    role: `${RESULT_ATTRIBUTES.role}, .segmented`,
    "aria-label": `${RESULT_ATTRIBUTES["aria-label"]}, .segmented`,
    type: "button",
    "aria-pressed": ".segmented button",
    "data-line": ".codeline",
    "data-sign": ".codeline",
    "data-label": ".compare td",
  };
  /** 아래 결과(판정 경로의 번호 목록, 목록 안의 목록)와 접어 둔 것의 세모. 결과 화면의 시험과 같다(tests/browser/view.test.ts). */
  const MARKERS = ["disc", "circle", "decimal", "none", "disclosure-closed", "disclosure-open"];
  const panels = demoApps.flatMap((app) => app.variants.map((variant) => ({ app, variant, name: `${app.key}.${variant.key}` })));

  /** 지금 그려진 판(고르는 단추 아래)의 글 전체. 빈칸은 뺀다(부품의 글과 같은 방법이다). */
  const panelShown = async (page: Page) =>
    squash(await page.locator(".demo").evaluate((demo) => [...demo.children].slice(1).map((child) => child.textContent ?? "").join("")));

  it("쪽의 본문에는 정해 둔 것뿐이고, 스크립트가 붙은 뒤의 글이 빌드된 쪽의 글과 같다 (주소로 열었을 때)", async () => {
    const { page } = await openDemo();
    await settle(site, page);
    const main = await page.locator("main.wrap").evaluate((el) => ({
      children: [...el.children].map((child) => `${child.tagName.toLowerCase()}.${child.className}`),
      text: el.textContent ?? "",
    }));
    expect(main.children).toEqual(["h1.", "p.lede", "div.demo"]);
    expect(partingOf(squash(main.text), builtMainText("demo"))).toBeNull();
  });

  it("여섯 판: 그린 글이 판 부품(DemoPanel)이 그린 글과 같고, 정해 둔 속성만 있고, CSS 가 그린 글은 줄 번호·다른 줄의 표시·좁은 화면의 판 이름과 목록 표시뿐이다", async () => {
    expect(panels.map((entry) => entry.name).sort()).toEqual(Object.keys(EXPECTED).sort());
    const { page } = await openDemo({ width: 375, height: 667 });
    let allowed = 0;
    for (const { app, variant, name } of panels) {
      await pick(page, app.label, variant.label);
      expect(partingOf(await panelShown(page), panelText(app, variant)), name).toBeNull();
      // 정해 둔 속성만 있다. 결과 화면의 것에 더해 고르는 단추(눌렸는지), 단추 묶음의 이름, 코드의 줄 번호와 표시, 칸 앞 판 이름.
      expect(await unknownAttributes(page, ".demo", DEMO_ATTRIBUTES), name).toEqual([]);
      // 쪽 전체(사이트의 머리와 바닥까지)를 본다. 좁은 화면이라 두 결과의 표의 칸 앞에 판 이름이 그려져 있다.
      const css = await cssDrawn(page, { markers: MARKERS, allowed: ALLOWED, allowedRules: ALLOWED_RULES });
      expect(css.rules, name).toEqual([]);
      expect(css.drawn, name).toEqual([]);
      // 허용한 글은 실제로 그려져 있다(허용 목록이 아무것도 거르지 않는데 통과한 것이 아니다).
      const all = await cssDrawn(page, { markers: MARKERS });
      allowed += all.drawn.length;
      expect(all.drawn.filter((entry) => entry.startsWith("td.")).length, name).toBeGreaterThan(0);
    }
    expect(allowed).toBeGreaterThan(100);
    // 넓은 화면에서는 칸 앞의 판 이름을 그리지 않는다. 줄 번호만 그린다.
    await page.setViewportSize({ width: 1280, height: 720 });
    expect((await cssDrawn(page, { markers: MARKERS })).drawn.filter((entry) => entry.startsWith("td."))).toEqual([]);

    // 대조: 같은 방법으로, 데모에 CSS 가 글을 그리면 잡힌다(연 쪽에만 넣는다). 줄 번호처럼 속성을 옮겨 그려도 다른 속성이면
    // 잡힌다. 칠한 줄 아래의 설명 뒤에 덧붙인 풀이도 잡힌다.
    await page.addStyleTag({ content: '.codeline::after { content: attr(class); } .codenote::after { content: " (풀이)"; }' });
    const control = await cssDrawn(page, { markers: MARKERS, allowed: ALLOWED, allowedRules: ALLOWED_RULES });
    expect(control.rules).toEqual([".codeline::after { content: attr(class) }", '.codenote::after { content: " (풀이)" }']);
    expect(control.drawn).toEqual(expect.arrayContaining(['span.codenote::after content: " (풀이)"']));
  });

  it("여섯 판의 글은 모두 그려진다: 좁은 화면(접힌 채와 펼친 채)과 넓은 화면에서 가려진 글이 없다", async () => {
    // 코드 상자 안의 긴 줄은 상자 안에서 밀린다. 그 글은 상자를 밀어 상자 가운데로 가져온 뒤 짚는다(site.ts 의 undrawn).
    // 좁은 화면에서 두 결과의 표의 칸 머리는 일부러 가린다(1px). 칸마다 앞에 판 이름이 그려진다.
    const NARROW = ".visually-hidden, .compare thead";
    const { page } = await openDemo({ width: 375, height: 667 });
    for (const { app, variant, name } of panels) {
      await page.setViewportSize({ width: 375, height: 667 });
      await pick(page, app.label, variant.label);
      const closed = await undrawn(page, { root: ".demo", veiled: NARROW });
      expect(closed.undrawn, `${name} 375px 접힌 채`).toEqual([]);
      const folds = await page.locator(".demo details:not([open])").count();
      await page.evaluate(() => {
        for (const details of document.querySelectorAll<HTMLDetailsElement>(".demo details")) details.open = true;
      });
      const opened = await undrawn(page, { root: ".demo", veiled: NARROW });
      expect(opened.undrawn, `${name} 375px 펼친 채`).toEqual([]);
      // 본 글이 있다. 접어 둔 것이 있었으면 펼친 뒤에 볼 글이 는다(접어 둔 글을 빼고 본 것이 맞다).
      expect(closed.texts, name).toBeGreaterThan(40);
      if (folds > 0) expect(opened.texts, name).toBeGreaterThan(closed.texts);
      else expect(opened.texts, name).toBe(closed.texts);
      await page.setViewportSize({ width: 1280, height: 720 });
      expect((await undrawn(page, { root: ".demo", veiled: ".visually-hidden" })).undrawn, `${name} 1280px`).toEqual([]);
    }
  });

  it("접근성 트리: 두 결과의 표는 그 제목을 이름으로 가진 표이고, 그려진 칸이 모두 칸으로 드러난다. 좁은 화면에서도 넓은 화면에서도 칸의 이름은 값뿐이다", async () => {
    // 좁은 화면에서는 CSS 가 표의 display 를 바꾼다. role 을 직접 적어 표로 남게 했다(components/demo/DemoPanel.tsx).
    // Chrome 의 접근성 트리를 CDP 로 읽는다(site.ts 의 accessibleNodes. 시험 도구의 getByRole 은 태그와 role 속성으로 셈해서
    // 브라우저가 표의 뜻을 버려도 표로 센다). Chrome 155 는 role 이 없어도 표로 드러낸다(결과 화면의 표와 같다).
    // 좁은 화면의 칸 앞에 CSS 가 그린 판 이름은 빈 대체 글을 단다(9번). 대체 글이 없던 8번까지는 칸의 이름이
    // "고치기 전 검토 필요 · AI 확인 전 발견 1건"처럼 판 이름으로 시작해, 가려 둔 칸 머리와 함께 판 이름이 두 번 읽혔다.
    const { context, page } = await openDemo({ width: 375, height: 667 });
    const nodes = (selector: string) => accessibleNodes(context, page, selector);
    for (const { app, variant, name } of panels) {
      await pick(page, app.label, variant.label);
      const want = EXPECTED[name];
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 720 });
        const at = `${name} ${width}px`;
        expect(await nodes(".compare"), at).toEqual([{ role: "table", name: "고치기 전과 고친 뒤의 결과" }]);
        expect((await nodes(".compare tr")).map((node) => node.role), at).toEqual(Array(1 + want.policies.length).fill("row"));
        // 그려진 칸이 모두 칸으로 드러난다.
        const drawn = await page.locator(".compare td").evaluateAll((all) => all.map((td) => td.getClientRects().length > 0));
        expect(drawn, at).toEqual(want.compare.map(() => true));
        const cells = await nodes(".compare td");
        expect(cells.map((node) => node.role), at).toEqual(drawn.map(() => "cell"));
        expect(await nodes(".compare tbody th"), at).toEqual(want.policies.map(([policy]) => ({ role: "rowheader", name: policy })));
        expect(await nodes(".compare thead th"), at).toEqual(COMPARE_COLUMNS.map((column) => ({ role: "columnheader", name: column })));
        expect(cells.map((node) => node.name), at).toEqual(want.compare);
      }
      await page.setViewportSize({ width: 375, height: 667 });
    }
  });
});
