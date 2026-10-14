import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GAPS_NOTE, GAPS_TITLE, GAPS_UNLISTED, SARIF_COUNTS_NOTE } from "@/lib/report/coverage";
import { MAX_FILE_BYTES, NOT_UTF8 } from "@/lib/report/open";
import { scopeLabel } from "@/lib/report/scope";
import { STATUS_LABEL } from "@/lib/report/status";
import type { Finding, Report } from "@/lib/report/types";
import { SAMPLES } from "@/lib/samples";
import { SITE } from "@/lib/site";
import { jsonFiles, readJson, root, sarifFiles } from "../helpers";
import { partingOf, squash } from "../policy-page";
import { builtMainText, reportText, viewOfFile, viewOfText } from "./expected";
import {
  accessibleNames,
  accessibleNodes,
  closeChrome,
  cssDrawn,
  launchChrome,
  newPage,
  NO_STORAGE,
  openPage,
  overflow,
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

// `/view` 를 실제 브라우저로 열어 본다. 빌드된 out/ 을 127.0.0.1 에 띄우고 이 컴퓨터의 Chrome(헤드리스)으로 연다.
// 그려 낸 HTML 만 보는 시험(tests/render.test.tsx)이 볼 수 없는 것을 본다: 네트워크 요청, 키보드, 끌어다 놓기,
// 화면이 멈추는지, 다른 쪽에 다녀오거나 새로 고친 뒤에 무엇이 열려 있는지, 좁은 화면의 가로 넘침과 표의 쌓임, 접힌 곳과
// 발견 줄이 실제로 여닫히는지, 글이 실제로 그려지는지, CSS 가 그린 글, 화면 낭독기에 드러나는 표와 이름.

let site: Site;
let browser: Browser;
/** 시험이 만들어 쓰는 파일을 두는 임시 폴더(저장소 밖). 끝나면 지운다. */
let scratch: string;
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
  scratch = mkdtempSync(path.join(tmpdir(), "policypack-view-test-"));
});

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  // 시험이 본 것이 맞아도, 그동안 쪽에서 오류가 났으면(그리다 실패, 스크립트 오류) 통과가 아니다.
  expect(problems.splice(0)).toEqual([]);
});

// 시험이 실패해도 띄운 것은 닫고, 만든 것은 지운다.
afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const file = (...parts: string[]) => path.join(root, ...parts);
const CAPTURES = jsonFiles("contract", "cli-current").map((name) => ["contract", "cli-current", name]);
const SARIFS = sarifFiles("contract", "cli-current").map((name) => ["contract", "cli-current", name]);
const DRAFTS = jsonFiles("contract", "samples-v1-draft").map((name) => ["contract", "samples-v1-draft", name]);
const FIXTURES = jsonFiles("tests", "fixtures").map((name) => ["tests", "fixtures", name]);

/** 새 창에서 `/view` 를 연다(tests/browser/site.ts 의 `openPage`). */
const openView = (viewport = { width: 1280, height: 720 }, pathname = "/view/"): Promise<Opened> =>
  openPage(browser, site, pathname, { viewport, contexts, problems });

/**
 * 그 이름의 것이 열려 다 그려질 때까지 기다린다. 제목이 바뀌고, 여는 중이라는 표시(aria-busy)가 풀린다. 읽지 못했거나
 * 그리지 못한 파일도 안내가 뜨면 풀린다.
 */
async function opened(page: Page, name: string): Promise<void> {
  try {
    await page.waitForFunction(
      (want) =>
        document.querySelector(".viewer-title")?.textContent === want &&
        document.querySelector(".opened")?.getAttribute("aria-busy") === "false",
      name,
    );
  } catch (error) {
    // 기다리다 끝났을 때 무슨 일이 있었는지 알 수 있게 적는다(쪽을 떠났는지, 새 탭이 떴는지, 다른 것이 열려 있는지).
    const now = await page.locator(".viewer-title").textContent({ timeout: 1_000 }).catch(() => null);
    throw new Error(
      `"${name}" 이 열리지 않았습니다. 지금 제목: ${now ?? "(없음)"}, 주소: ${page.url()}, 열린 탭: ${page.context().pages().length}개`,
      { cause: error },
    );
  }
}

/** 파일 고르기에 파일을 넣는다(마우스나 키보드로 고른 것과 같은 change 가 난다). */
async function pick(page: Page, parts: string[]): Promise<void> {
  await page.locator("#report-file").setInputFiles(file(...parts));
  await opened(page, parts.at(-1)!);
}

async function pickContent(page: Page, name: string, content: string | Buffer): Promise<void> {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  await page.locator("#report-file").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
  await opened(page, name);
}

const title = (page: Page) => page.locator(".viewer-title").innerText();
const alertText = (page: Page) => page.locator('.viewer [role="alert"]').innerText();
const statusText = (page: Page) => page.locator('.viewer [role="status"]').textContent();
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");
/** 정책 카드의 차례(카드 제목). */
const policyOrder = (page: Page) => page.locator("article.policy h3").allInnerTexts();
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
/** 파일 입력에 들어 있는 파일의 이름. 브라우저는 이 이름을 입력 옆에 적고, 없으면 "선택된 파일 없음"이라고 적는다. */
const chosenFile = (page: Page) => page.locator("#report-file").evaluate((el) => (el as HTMLInputElement).files?.[0]?.name ?? "");
/** 그 요소가 지금 창 안에 온전히 들어와 있는지. */
const inView = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight;
  });
/** 기본으로 열려 있는 합성 예시의 제목. */
const DEFAULT_TITLE = `${SAMPLES[0].label} (${SAMPLES[0].origin})`;

/** 화면 낭독기에 알린 말 하나. 알릴 때 화면의 제목이 무엇이었는지도 함께 적는다(결과가 이미 바뀌어 있었는지 본다). */
interface Announced {
  text: string;
  title: string;
}

/** 지금부터 화면 낭독기에 알리는 말(role="status" 의 글이 바뀌는 것)을 차례대로 적어 둔다. `announced` 로 읽는다. */
async function watchStatus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const status = document.querySelector('.viewer [role="status"]')!;
    const log: Announced[] = ((window as unknown as { __status: Announced[] }).__status = []);
    new MutationObserver(() =>
      log.push({ text: status.textContent ?? "", title: document.querySelector(".viewer-title")?.textContent ?? "" }),
    ).observe(status, { childList: true, characterData: true, subtree: true });
  });
}

/** `watchStatus` 뒤로 알린 말 전부(차례대로). */
const announced = (page: Page) => page.evaluate(() => [...(window as unknown as { __status: Announced[] }).__status]);
const announcedTexts = async (page: Page) => (await announced(page)).map((entry) => entry.text);

/**
 * 발견이 많은 결과를 만든다. 손으로 만든 시험용 자료다(실제 CLI 출력이 아니다). 큰 파일을 저장소에 두지 않으려고 여기서
 * 만든다. 수집본과 시험용 자료의 발견 아홉(팩의 규칙 아홉)을 본으로 삼아 파일 이름·줄·지문만 바꾼다. 줄은 2행부터다.
 */
function manyFindings(count: number): Report {
  const base = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
  const from = (...parts: string[]) => (readJson(...parts) as Report).findings;
  const templates = [
    ...base.findings,
    ...from("contract", "cli-current", "night-push.fixed.json"),
    ...from("contract", "cli-current", "genai-chat.fixed.json"),
    ...from("tests", "fixtures", "repeated-rule.json").filter((f) => f.rule.startsWith("email-")),
  ];
  const findings = Array.from({ length: count }, (_, i): Finding => {
    const area = String(i % 37).padStart(2, "0");
    return {
      ...templates[i % templates.length],
      file: `src/features/area-${area}/module-${String(i).padStart(4, "0")}.ts`,
      line: (i % 90) + 2,
      fingerprint: i.toString(16).padStart(32, "0"),
    };
  });
  const pending = findings.filter((f) => f.ai_pending.length > 0).length;
  return { ...base, run: { ...base.run, units: count, files: count, ai_pending: pending }, findings };
}

type DragStep = "dragEnter" | "dragOver" | "drop" | "dragCancel";

async function dragFiles(cdp: CDPSession, type: DragStep, at: { x: number; y: number }, files: string[]) {
  // Chrome 의 끌어다 놓기를 그대로 흉내 낸다(스크립트로 만든 이벤트가 아니다). 쪽이 받지 않으면 브라우저가 그 파일을 연다.
  await cdp.send("Input.dispatchDragEvent", { type, x: at.x, y: at.y, data: { items: [], files, dragOperationsMask: 1 } });
}

async function dropFiles(cdp: CDPSession, at: { x: number; y: number }, files: string[]) {
  await dragFiles(cdp, "dragEnter", at, files);
  await dragFiles(cdp, "dragOver", at, files);
  await dragFiles(cdp, "drop", at, files);
}

/** 그 요소 안의 한 점(화면 좌표). 화면 밖에 있으면 먼저 화면 안으로 끌어온다. */
const inside = async (page: Page, selector: string) => {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  return { x: box.x + Math.min(20, box.width / 2), y: box.y + Math.min(10, box.height / 2) };
};

describe("연 파일을 어디로도 보내지 않는다", () => {
  it("파일을 열고 맨 아래까지 스크롤한 뒤에도 네트워크 요청이 없다 (기본 예시와 정책 순서가 달라지는 파일)", async () => {
    const start = site.requests.length;
    const { context, page, outside } = await openView();
    const seen: string[] = [];
    context.on("request", (request) => seen.push(`${request.method()} ${request.url()}`));

    // 처음에는 기본 예시가 열려 있다. 머리의 링크는 화면에 보이므로 Next 가 미리 받아 둔다. 그 요청이 서버에 적힌다는
    // 것은, 정책 카드의 링크가 화면에 들어올 때 요청이 나가면 이 시험이 본다는 뜻이다. 이 시험이 도는 몇 초 동안 쪽이
    // 스스로 내는 요청은 여기까지다. 받아 둔 것이 낡은 뒤(5분)에 머리 링크가 다시 받는 것은 이 시험이 보지 못한다
    // (docs/architecture.md 의 "`/view`").
    await settle(site, page);
    expect(await title(page)).toBe(DEFAULT_TITLE);
    const loading = site.requests.slice(start).map((request) => request.url);
    expect(loading[0]).toBe("/view/");
    expect(loading.some((url) => url.startsWith("/demo/"))).toBe(true);
    expect(loading.some((url) => url.startsWith("/policy/"))).toBe(true);
    const before = await policyOrder(page);
    const mark = { server: site.requests.length, browser: seen.length };

    // 정책 순서가 달라지는 파일을 연다. 발견이 있는 정책이 위로 오므로, 화면에 들어오는 정책 링크가 달라진다.
    await pick(page, ["contract", "cli-current", "night-push.main.json"]);
    const after = await policyOrder(page);
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());

    // 맨 아래까지 한 화면씩 내린다. 링크가 차례로 화면에 들어온다.
    const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight * 2);
    expect(tall).toBe(true);
    await scrollThrough(page, 80);
    // 정책 링크 위에 마우스를 올리고, 발견 줄을 펼쳐 본다.
    await page.locator("article.policy h3 a").last().hover();
    await page.locator("li.finding summary").last().click();
    await settle(site, page);

    expect(site.requests.slice(mark.server)).toEqual([]);
    expect(seen.slice(mark.browser)).toEqual([]);
    // 처음부터 끝까지, 이 사이트 밖으로 나가려던 요청도 없다. HTTP 도 WebSocket 도 아닌 길(WebRTC 등)로 이으려던 것도
    // 없다(그런 생성자를 부르면 site.ts 의 newPage 가 걸어 둔 감싸기가 막고 여기와 problems 에 적는다. 아래 "대조"가 그것을 본다).
    expect(outside).toEqual([]);
  });

  it("대조: 쪽에서 RTCPeerConnection·WebTransport·워커를 부르면 막고 적는다 (HTTP 도 WebSocket 도 아닌 길)", async () => {
    // 위 시험의 대조다. 가로채기(route)는 이 길로 나가는 연결을 보지 못한다. 4번에서 연 결과를 WebRTC 로 127.0.0.1 의
    // 수신기에 보내는 줄을 넣어 보니 시험은 통과하고 수신기에 연결이 닿았다. 쪽의 스크립트보다 먼저 생성자를 감싸 두므로,
    // 사이트의 코드가 부르면 만들어지지 않고(예외) 어디로 이으려 했는지가 적힌다. 쪽은 127.0.0.1 이라 보안 맥락이고,
    // WebTransport 도 있다(감쌀 것이 있다).
    const { page, outside } = await openView();
    const CALLS: [name: string, argument: unknown][] = [
      ["RTCPeerConnection", { iceServers: [{ urls: "stun:192.0.2.1:3478" }] }],
      ["webkitRTCPeerConnection", null],
      ["WebTransport", "https://192.0.2.1:4433/"],
      ["Worker", "data:text/javascript,0"],
      ["SharedWorker", "data:text/javascript,0"],
    ];
    const made = await page.evaluate(
      (calls) =>
        calls.map(([name, argument]) => {
          const make = (window as unknown as Record<string, new (arg: unknown) => unknown>)[name];
          if (typeof make !== "function") return `${name}: 없음`;
          try {
            new make(argument);
            return `${name}: 만들어짐`;
          } catch (error) {
            return `${name}: ${(error as Error).name}`;
          }
        }),
      CALLS,
    );
    expect(made).toEqual(CALLS.map(([name]) => `${name}: NotAllowedError`));
    const recorded = CALLS.map(([name, argument]) => `${name} ${argument === null ? "null" : JSON.stringify(argument)}`);
    await expect.poll(() => outside.length, { timeout: 3_000 }).toBe(CALLS.length);
    expect(outside).toEqual(recorded);
    // 다른 시험에서 불렸다면 그 시험이 실패한다(쪽에서 난 오류로도 적는다). 여기서는 일부러 불렀으니 걷어 낸다.
    expect(problems.splice(0)).toEqual(recorded.map((call) => `밖과 이을 수 있는 생성자를 불렀습니다(시험이 막았다): ${call}`));
  });

  it("연 결과를 브라우저 저장소에 두지 않는다", async () => {
    // 연 결과는 메모리에만 둔다(docs/commitments.md 의 1층). 파일과 예시를 열고 난 뒤에도 저장소가 비어 있다.
    const { page } = await openView();
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    await page.locator("#sample-select").selectOption("plain.main");
    await pick(page, ["contract", "cli-current", "kids-signup.main.sarif"]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("SARIF 를 열어도 같다. 같은 검사의 JSON 과 발견 부분이 같고, 없는 수는 알 수 없음으로 보인다", async () => {
    const { page, outside } = await openView();
    await settle(site, page);
    const mark = site.requests.length;

    await pick(page, ["contract", "cli-current", "kids-signup.main.sarif"]);
    expect(await page.locator(".report-meta").innerText()).toContain("SARIF");
    expect(await page.locator(".coverage > p").allInnerTexts()).toEqual([
      "검사한 파일 수 알 수 없음 · 판정 단위 수 알 수 없음",
      SARIF_COUNTS_NOTE,
    ]);
    const fromSarif = await page.locator(".policies").innerHTML();

    await pick(page, ["contract", "cli-current", "kids-signup.main.json"]);
    expect(await page.locator(".coverage > p").allInnerTexts()).toEqual(["파일 1개 검사 · 판정 단위 1개"]);
    expect(await page.locator(".policies").innerHTML()).toBe(fromSarif);
    // 빈 것끼리 견준 것이 아니다. 발견 줄과 그 안쪽이 들어 있다.
    expect(await page.locator(".policies li.finding").count()).toBe(1);
    expect(await page.locator(".policies").innerText()).toContain("src/auth/signup.ts:5");
    expect(await page.locator(".policies").innerText()).toContain("대안 under14-branch: 정적 false");

    await settle(site, page);
    expect(site.requests.slice(mark)).toEqual([]);
    expect(outside).toEqual([]);
  });
});

describe("키보드만으로", () => {
  it("파일을 열고 예시를 고른다", async () => {
    const { context, page } = await openView();
    // 파일 고르기 창을 가로채는 것을 먼저 켜 둔다. 시험 도구는 그 창을 기다리기 시작할 때 가로채기를 켜는데, 바로 이어
    // 키를 누르면 켜지기 전에 창이 열려 기다리는 일이 끝나지 않을 때가 있다(5번에서 쟀다. 150번에 4번. 먼저 켜 두면
    // 300번에 0번이었다). 사이트의 동작과는 무관하다.
    page.on("filechooser", () => {});

    // Tab 으로 머리의 링크를 지나 파일 고르기, 예시 고르기 차례로 닿는다.
    const order: string[] = [];
    for (let i = 0; i < 10 && order.at(-1) !== "sample-select"; i++) {
      await page.keyboard.press("Tab");
      order.push(await focusedId(page));
    }
    expect(order.filter(Boolean)).toEqual(["report-file", "sample-select"]);
    await page.keyboard.press("Shift+Tab");
    expect(await focusedId(page)).toBe("report-file");
    // 초점이 어디 있는지 보인다.
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(ring).toBe("solid");

    // Enter 와 Space 가 파일 고르기를 연다. 고른 뒤에도 초점은 그 자리에 남고, 연 것을 화면 낭독기에 알린다.
    // 알리는 것은 무엇을 열었는지뿐이다. 발견 수는 알리지 않는다(수만 들으면 0건이 볼 것이 없다는 말로 들린다).
    for (const [key, name] of [
      ["Enter", "night-push.main.json"],
      ["Space", "genai-chat.main.json"],
    ]) {
      const chooser = page.waitForEvent("filechooser");
      await page.keyboard.press(key);
      await (await chooser).setFiles(file("contract", "cli-current", name));
      await opened(page, name);
      expect(await focusedId(page)).toBe("report-file");
      expect(await statusText(page)).toBe(`열었습니다: ${name}`);
      expect(await page.locator("#sample-select").inputValue()).toBe("");
      // 고른 파일의 이름이 입력에 남아 있다(브라우저가 입력 옆에 적는다).
      expect(await chosenFile(page)).toBe(name);
    }

    // 예시 고르기로 넘어가 글자를 쳐서 고른다(브라우저가 그 글자로 시작하는 항목으로 옮긴다). 화살표 키는 운영체제마다
    // 달라서(맥은 메뉴를 연다) 누르지 않는다.
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("sample-select");
    const cdp = await context.newCDPSession(page);
    const sample = SAMPLES.find((s) => s.id === "night-push.main")!;
    expect(sample.label.startsWith("광")).toBe(true);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "광", text: "광", unmodifiedText: "광" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "광" });
    await opened(page, `${sample.label} (${sample.origin})`);
    expect(await page.locator("#sample-select").inputValue()).toBe(sample.id);
    expect(await focusedId(page)).toBe("sample-select");
    expect(await page.locator(".viewer-note").innerText()).toBe(`합성 예시입니다. ${sample.note}`);
    // 예시를 열면 파일 입력은 비운다. 앞서 고른 파일의 이름이 남아 있으면 그 파일이 열려 있는 것처럼 보인다.
    expect(await chosenFile(page)).toBe("");
  });

  it("파일 고르기 창을 열 때 입력을 비운다 (같은 이름의 파일을 다시 골라도 열리게)", async () => {
    // 고친 뒤 다시 검사한 결과는 이름이 같다. 입력에 그 파일이 남아 있으면 브라우저는 바뀐 것이 없다고 보고 알리지 않는다.
    // 그래서 창을 열기 전에 비운다. 브라우저가 알리지 않는 것까지는 여기서 일으키지 못한다(시험 도구가 파일을 넣을 때는
    // 늘 알린다). 비우는 때만 본다. 고른 뒤에 비우면 방금 연 파일인데도 입력 옆에 "선택된 파일 없음"이 보인다.
    const { page } = await openView();
    const name = "kids-signup.main.json";
    const first = page.waitForEvent("filechooser");
    await page.locator("#report-file").click();
    await (await first).setFiles(file("contract", "cli-current", name));
    await opened(page, name);
    expect(await chosenFile(page)).toBe(name);

    const second = page.waitForEvent("filechooser");
    await page.locator("#report-file").click();
    const chooser = await second;
    expect(await chosenFile(page)).toBe("");
    await watchStatus(page);
    await chooser.setFiles(file("contract", "cli-current", name));
    // 다시 열었다. 여는 중이라고 알린 뒤 열었다고 알린다.
    await expect.poll(() => announcedTexts(page), { timeout: 5_000 }).toEqual([`여는 중입니다: ${name}`, `열었습니다: ${name}`]);
    expect(await chosenFile(page)).toBe(name);
  });
});

describe("잘못된 파일을 넣었을 때", () => {
  const HELP = `이 뷰어는 CLI 의 JSON·SARIF 출력을 저장한 파일을 엽니다. 예: ${SITE.scanExample}`;
  const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);

  it("까닭과 여는 법을 알리고, 앞서 연 결과를 그대로 두지 않는다. 그 뒤에 다른 파일을 열 수 있다", async () => {
    const { page } = await openView();
    expect(await page.locator(".report").count()).toBe(1);

    await pickContent(page, "scan.txt", "스테이징된 파일 1개를 검사합니다.\n검토 필요 1건\n");
    expect(lines(await alertText(page))).toEqual([
      "이 파일을 결과로 읽지 못했습니다.",
      "JSON 으로 읽을 수 없습니다. 출력 형식을 주지 않은 글 출력이거나, 터미널의 다른 글이 함께 적힌 파일일 수 있습니다.",
      HELP,
    ]);
    // 앞서 연 예시의 결과가 남아 그 파일의 결과처럼 보이면 안 된다.
    expect(await page.locator(".report").count()).toBe(0);
    expect(await title(page)).toBe("scan.txt");
    expect(await page.locator("#sample-select").inputValue()).toBe("");

    await pickContent(page, "package.json", JSON.stringify({ name: "my-app", scripts: {} }));
    expect(lines(await alertText(page))[1]).toBe("CLI 결과 파일의 모양이 아닙니다. tool, run, findings 가 모두 없습니다.");

    await pickContent(page, "empty.json", "");
    expect(lines(await alertText(page))[1]).toBe("빈 파일입니다. CLI 가 결과를 내지 못하고 끝났다면 터미널에 남은 오류를 확인하세요.");

    // UTF-8 이 아닌 파일(한글을 CP949 로 적은 것): 깨진 글자가 든 결과로 그리지 않는다.
    const cp949 = Buffer.concat([Buffer.from('{"tool": {"name": "'), Buffer.from([0xb0, 0xa1]), Buffer.from('"}}')]);
    await pickContent(page, "cp949.json", cp949);
    expect(lines(await alertText(page))[1]).toBe(NOT_UTF8);
    expect(await page.locator(".report").count()).toBe(0);

    // 한도보다 큰 파일은 읽지 않는다.
    await pickContent(page, "huge.json", Buffer.alloc(MAX_FILE_BYTES + 1, 0x20));
    expect(lines(await alertText(page))[1]).toBe("파일이 너무 큽니다(10.1MB). 이 뷰어는 10MB 까지만 엽니다.");

    // 발견마다 같은 필드가 빠진 파일: 까닭을 수백 줄 늘어놓지 않는다.
    const many = manyFindings(300);
    const broken = { ...many, findings: many.findings.map((f) => ({ ...f, fingerprint: undefined })) };
    await pickContent(page, "broken.json", JSON.stringify(broken));
    expect(lines(await alertText(page))).toEqual([
      "이 파일을 결과로 읽지 못했습니다.",
      ...[0, 1, 2, 3, 4].map((i) => `findings[${i}].fingerprint 가 없습니다.`),
      "그 밖에 295곳이 더 있습니다.",
      HELP,
    ]);

    // 제대로 된 파일을 열면 안내가 사라지고 결과가 보인다.
    await pick(page, ["contract", "cli-current", "kids-signup.main.json"]);
    expect(await page.locator('.viewer [role="alert"]').count()).toBe(0);
    expect(await page.locator(".report").count()).toBe(1);
    expect(await page.locator(".policies").innerText()).toContain("src/auth/signup.ts:5");
  });

  it("같은 까닭으로 읽지 못한 파일을 잇달아 열면 안내를 새로 만든다. 열었다고 알리지 않는다", async () => {
    // 안내(role="alert")가 같은 요소로 남고 글도 같으면, 둘째 파일에서는 화면 낭독기에 알릴 것이 없다. 열 때마다 새로 만든다.
    const { page } = await openView();
    await watchStatus(page);
    await pickContent(page, "empty-1.json", "");
    const first = await page.locator('.viewer [role="alert"]').elementHandle();
    await pickContent(page, "empty-2.json", "");
    expect(await first!.evaluate((el) => el.isConnected)).toBe(false);
    expect(lines(await alertText(page))[1]).toBe("빈 파일입니다. CLI 가 결과를 내지 못하고 끝났다면 터미널에 남은 오류를 확인하세요.");
    expect(await title(page)).toBe("empty-2.json");
    // 읽지 못한 것은 안내 상자가 스스로 알린다. 알림 줄에는 여는 중이라는 말만 지나간다.
    expect((await announcedTexts(page)).filter(Boolean)).toEqual(["여는 중입니다: empty-1.json", "여는 중입니다: empty-2.json"]);
    expect(await statusText(page)).toBe("");
  });

  it("결과로 읽었지만 그리지 못한 파일에는 열었다고 알리지 않는다", async () => {
    // 파서는 지나가지만 그리다 실패하는 파일. CLI 가 내는 파일로는 생기지 않고 손으로 고친 파일에서만 봤다(글이어야 할
    // 자리에 객체가 들어 있다). 결과 화면 대신 오류 경계의 안내가 뜬다.
    const { page } = await openView();
    const data = readJson("tests", "fixtures", "judge-on.dismissed.json") as Report;
    (data.run.ai_dismissed![0] as { question: unknown }).question = { text: "객체" };
    await watchStatus(page);
    await pickContent(page, "undrawable.json", JSON.stringify(data));
    expect(await alertText(page)).toBe("이 결과를 그리지 못했습니다. 파일 모양이 이 뷰어가 아는 것과 다릅니다. 다른 파일을 열어 보세요.");
    expect(await page.locator(".report").count()).toBe(0);
    expect(await announcedTexts(page)).toEqual(["여는 중입니다: undrawable.json", ""]);

    // 그 뒤에 멀쩡한 파일을 열면 열었다고 알린다.
    await pick(page, ["contract", "cli-current", "plain.main.json"]);
    expect(await statusText(page)).toBe("열었습니다: plain.main.json");
    expect(await page.locator(".report").count()).toBe(1);

    // 그리다 실패한 것은 콘솔에 오류로 남는다. 이 시험에서는 그 오류가 있어야 하고, 그것뿐이어야 한다.
    const errors = problems.splice(0);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect(error).toContain("Minified React error #31");
  });
});

describe("끌어다 놓기", () => {
  const FILE = file("contract", "cli-current", "night-push.main.json");

  it("대조: 파일을 받는 곳이 없는 쪽에서는 브라우저가 놓은 파일을 대신 연다", async () => {
    // 이 시험이 쓰는 끌어다 놓기가 브라우저의 기본 동작까지 일으킨다는 것을 본다. 그래야 아래 시험이 뜻이 있다.
    // 창은 다른 시험과 같게 연다(가로채기, 생성자 감싸기). 놓은 파일을 여는 file: 주소는 가로채기에 걸리지 않는다.
    const { context, page } = await openPage(browser, site, "/policy/", { contexts, problems });
    const url = page.url();
    const cdp = await context.newCDPSession(page);
    await dropFiles(cdp, await inside(page, "h1"), [FILE]);
    // Chrome 154 는 새 탭으로 연다. 보던 쪽을 그 파일로 바꾸는 동작이어도 받아 준다. 어느 쪽이든 보던 쪽을 잃거나 가린다.
    await expect.poll(() => context.pages().length > 1 || page.url() !== url, { timeout: 10_000 }).toBe(true);
  });

  it("드롭존 밖에 파일을 떨어뜨려도 쪽이 바뀌지 않고, 그 파일이 열린다", async () => {
    const { context, page, outside } = await openView();
    const url = page.url();
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => navigations.push(frame.url()));
    const cdp = await context.newCDPSession(page);
    const zone = () => page.locator(".dropzone").getAttribute("class");

    // 쪽 제목 위. 드롭존 밖이다.
    const outsideZone = await inside(page, "h1");
    const box = (await page.locator(".dropzone").boundingBox())!;
    expect(outsideZone.y).toBeLessThan(box.y);
    const top = () => page.evaluate(() => window.scrollTo(0, 0));
    await dragFiles(cdp, "dragEnter", outsideZone, [FILE]);
    await dragFiles(cdp, "dragOver", outsideZone, [FILE]);
    // 파일을 끌고 들어오면 어디에 놓아도 된다는 것을 드롭존과 창 둘레의 표시가 알린다.
    expect(await zone()).toBe("dropzone dropzone-on");
    expect(await page.locator(".drop-frame").count()).toBe(1);
    await dragFiles(cdp, "drop", outsideZone, [FILE]);
    await opened(page, "night-push.main.json");
    expect(await zone()).toBe("dropzone");
    expect(await page.locator(".drop-frame").count()).toBe(0);
    expect(await page.locator(".policies").innerText()).toContain("src/marketing/campaign.ts:2");

    // 바닥글 위, 파일 고르기 위, 드롭존 안에 놓아도 같다. 한 번 놓으면 한 번만 열린다.
    await watchStatus(page);
    const places: [string, string][] = [
      [".site-footer p", "genai-chat.main.json"],
      ["#report-file", "kids-signup.main.json"],
      [".dropzone strong", "plain.main.json"],
    ];
    for (const [selector, name] of places) {
      await dropFiles(cdp, await inside(page, selector), [file("contract", "cli-current", name)]);
      await opened(page, name);
      // 놓아서 연 것은 파일 입력이 고른 파일이 아니다. 입력에는 이름이 남지 않는다.
      expect(await chosenFile(page)).toBe("");
    }
    await top();
    expect((await announcedTexts(page)).filter((text) => text.startsWith("열었습니다: "))).toEqual([
      "열었습니다: genai-chat.main.json",
      "열었습니다: kids-signup.main.json",
      "열었습니다: plain.main.json",
    ]);

    // 파일을 여럿 놓으면 첫 파일만 보고 그렇다고 적는다.
    const FIRST_ONLY = "한 번에 한 파일만 엽니다. 놓은 파일 2개 가운데 첫 파일만 봅니다.";
    await dropFiles(cdp, outsideZone, [FILE, file("contract", "cli-current", "plain.main.json")]);
    await opened(page, "night-push.main.json");
    expect(await page.locator(".viewer-note").innerText()).toBe(FIRST_ONLY);
    // 첫 파일을 읽지 못해도 그 말이 아래의 안내와 어긋나지 않는다(열었다고 적지 않는다).
    const text = path.join(scratch, "scan.txt");
    writeFileSync(text, "스테이징된 파일 1개를 검사합니다.\n검토 필요 1건\n");
    await top();
    await dropFiles(cdp, outsideZone, [text, file("contract", "cli-current", "plain.main.json")]);
    await opened(page, "scan.txt");
    expect(await page.locator(".viewer-note").innerText()).toBe(FIRST_ONLY);
    expect(await alertText(page)).toContain("이 파일을 결과로 읽지 못했습니다.");

    // 폴더를 놓으면 읽지 못했다고 알린다.
    await top();
    await dropFiles(cdp, outsideZone, [file("contract", "cli-current")]);
    await opened(page, "cli-current");
    expect(await alertText(page)).toContain("파일을 읽지 못했습니다. 폴더가 아닌 파일인지, 파일이 그 자리에 있는지 확인하세요.");

    // 쪽은 그대로다: 주소가 같고, 새 탭이 뜨지 않았고, 다른 곳으로 옮겨 가지 않았다.
    await page.waitForTimeout(300);
    expect(page.url()).toBe(url);
    expect(context.pages()).toHaveLength(1);
    expect(navigations).toEqual([]);
    expect(outside).toEqual([]);
  });

  it("놓지 않고 끝난 끌기에도 끄는 동안의 표시가 켜진 채 남지 않는다", async () => {
    const { context, page } = await openView();
    const cdp = await context.newCDPSession(page);
    const at = await inside(page, "h1");
    // 끄는 동안의 표시 둘: 드롭존의 강조와 창 둘레의 표시.
    const shown = async () => ({
      zone: await page.locator(".dropzone").getAttribute("class"),
      frame: await page.locator(".drop-frame").count(),
    });
    const ON = { zone: "dropzone dropzone-on", frame: 1 };
    const OFF = { zone: "dropzone", frame: 0 };
    const before = await title(page);

    // 끌기를 그만두게 한다(개발 도구 통신의 dragCancel). 이때 쪽에는 아무 이벤트도 오지 않는다. 쪽은 끄는 동안 이어서
    // 오던 dragover 가 끊긴 것으로 안다.
    await dragFiles(cdp, "dragEnter", at, [FILE]);
    await dragFiles(cdp, "dragOver", at, [FILE]);
    expect(await shown()).toEqual(ON);
    await dragFiles(cdp, "dragCancel", at, [FILE]);
    await expect.poll(shown, { timeout: 3_000 }).toEqual(OFF);

    // 창 밖으로 끌고 나가면 기다리지 않고 끈다. 창 안의 요소 사이를 오갈 때의 나감은 끄지 않는다.
    await dragFiles(cdp, "dragEnter", at, [FILE]);
    await dragFiles(cdp, "dragOver", at, [FILE]);
    await page.evaluate(() => document.querySelector("h1")!.dispatchEvent(new DragEvent("dragleave", { bubbles: true, clientX: 300, clientY: 100 })));
    expect(await shown()).toEqual(ON);
    await page.evaluate(() => document.documentElement.dispatchEvent(new DragEvent("dragleave", { bubbles: true, clientX: 0, clientY: 0 })));
    expect(await shown()).toEqual(OFF);

    // 아무것도 열리지 않았다.
    expect(await title(page)).toBe(before);
    expect(context.pages()).toHaveLength(1);
  });

  it("아래로 내린 채 끌어도 받는다는 표시가 보이고, 놓으면 연 것의 제목이 화면에 들어온다", async () => {
    // 드롭존은 쪽의 위쪽에 있다. 결과를 읽으며 내려가 있으면 드롭존의 강조는 화면 밖이고, 놓은 뒤에도 스크롤 자리가
    // 그대로면 무엇이 열렸는지 보이지 않는다. 표시는 창에 붙이고, 놓아서 연 뒤에는 제목을 화면 안으로 가져온다.
    const { context, page } = await openView({ width: 375, height: 667 });
    const cdp = await context.newCDPSession(page);
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    await page.evaluate(() => window.scrollTo(0, 1800));
    expect(await scrollY(page)).toBe(1800);
    expect(await inView(page, ".viewer-title")).toBe(false);
    const zone = (await page.locator(".dropzone").boundingBox())!;
    expect(zone.y + zone.height).toBeLessThan(0);

    const at = { x: 180, y: 320 };
    await dragFiles(cdp, "dragEnter", at, [FILE]);
    await dragFiles(cdp, "dragOver", at, [FILE]);
    // 창 둘레를 꽉 채운다. 끄는 것을 가로채지 않고(놓는 것은 창이 받는다), 쪽을 넓히지도 않는다.
    expect(await page.locator(".drop-frame").boundingBox()).toEqual({ x: 0, y: 0, width: 375, height: 667 });
    expect(await page.locator(".drop-frame").innerText()).toBe("이 화면 어디에 놓아도 됩니다");
    expect(await page.locator(".drop-frame").evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    expect((await overflow(page)).page).toBe(0);
    expect(await scrollY(page)).toBe(1800);

    await dragFiles(cdp, "drop", at, [FILE]);
    await opened(page, "night-push.main.json");
    expect(await page.locator(".drop-frame").count()).toBe(0);
    expect(await inView(page, ".viewer-title")).toBe(true);
    expect(await title(page)).toBe("night-push.main.json");

    // 제목이 이미 화면 안에 있으면 움직이지 않는다.
    const still = await scrollY(page);
    await dropFiles(cdp, at, [file("contract", "cli-current", "genai-chat.main.json")]);
    await opened(page, "genai-chat.main.json");
    expect(await scrollY(page)).toBe(still);
  });

  it("파일이 아닌 것(글)을 끄는 동안에는 나서지 않는다", async () => {
    const { context, page } = await openView();
    const cdp = await context.newCDPSession(page);
    const at = await inside(page, "h1");
    const data = { items: [{ mimeType: "text/plain", data: "src/auth/signup.ts" }], dragOperationsMask: 1 };
    const before = await title(page);
    await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", ...at, data });
    await cdp.send("Input.dispatchDragEvent", { type: "dragOver", ...at, data });
    expect(await page.locator(".dropzone").getAttribute("class")).toBe("dropzone");
    await cdp.send("Input.dispatchDragEvent", { type: "drop", ...at, data });
    await page.waitForTimeout(200);
    expect(await title(page)).toBe(before);
    expect(context.pages()).toHaveLength(1);
  });
});

/** 쪽 안에서 잰 것: 프레임·작업 사이의 가장 긴 틈(ms). */
interface Probe {
  gap: number;
}

describe("발견이 많은 결과", () => {
  it("발견 500건짜리 파일을 여는 동안에도, 연 뒤에도 화면이 멈추지 않는다", async () => {
    const { context, page } = await openView();
    const data = manyFindings(500);
    expect(new Set(data.findings.map((f) => `${f.policy}/${f.rule}`)).size).toBe(9);

    // 느린 기기를 흉내 낸다(CPU 를 4배 늦춘다). 그리고 화면이 살아 있는지 쪽 안에서 잰다: 프레임과 프레임 사이,
    // 작업과 작업 사이의 가장 긴 틈. 쪽이 멈추면 그동안 둘 다 돌지 못해 틈이 그만큼 벌어진다.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await watchStatus(page);
    await page.evaluate(() => {
      const probe: Probe = { gap: 0 };
      (window as unknown as { __probe: Probe }).__probe = probe;
      let frameAt = performance.now();
      const onFrame = (now: number) => {
        probe.gap = Math.max(probe.gap, now - frameAt);
        frameAt = now;
        requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
      let taskAt = performance.now();
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        const now = performance.now();
        probe.gap = Math.max(probe.gap, now - taskAt);
        taskAt = now;
        setTimeout(() => channel.port2.postMessage(0), 4);
      };
      channel.port2.postMessage(0);
    });

    // 파일로 써서 고른다. 내용을 쪽 안으로 밀어 넣는 방식은 그 일이 화면을 막아 잰 값에 섞인다.
    const many = path.join(scratch, "many-500.json");
    writeFileSync(many, JSON.stringify(data));
    await page.locator("#report-file").setInputFiles(many);
    // 다 그려질 때까지 기다린다. 기다리는 동안 쪽을 훑는 일을 가볍게 둔다(요소가 많아서, 글을 찾는 식으로 기다리면
    // 기다리는 일이 화면을 막는다).
    await page.waitForFunction(() => document.querySelectorAll("li.finding").length === 500);
    await opened(page, "many-500.json");
    const probe = await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);

    // 0.5초 넘게 멈춘 적이 없다. 이 컴퓨터에서 잰 값은 4배 늦춘 채로 0.03~0.05초다(docs/architecture.md 의 "`/view`").
    expect(probe.gap).toBeLessThan(500);
    // 결과를 그리는 일을 뒤로 미뤄 조금씩 한다. 그동안 파일 고르기는 이미 새 파일을 가리키고, 화면 낭독기에는 여는
    // 중이라고 알린다. 여는 중이라고 알릴 때 아래에는 아직 앞서 연 것이 있다. 그때 이미 새 결과가 그려져 있었다면
    // 결과를 한 번에 그린 것이다(발견이 많을수록 그만큼 화면이 멈춘다).
    expect(await announced(page)).toEqual([
      { text: "여는 중입니다: many-500.json", title: DEFAULT_TITLE },
      { text: "열었습니다: many-500.json", title: "many-500.json" },
    ]);

    // 발견은 하나도 빠지지 않았다. 같은 규칙의 3곳까지만 먼저 보이고 나머지는 접혀 있다.
    expect(await page.locator(".report > .notice").innerText()).toBe("사람이 확인할 발견이 500건 있습니다.");
    expect(await page.locator("article.policy").count()).toBe(5);
    expect(await page.locator("li.finding").count()).toBe(500);
    expect(await page.locator(".rule-group").count()).toBe(9);
    expect(await page.locator("details.more").count()).toBe(9);

    // 연 뒤에도 곧바로 반응한다: 접힌 곳을 펼치고, 그 안의 발견 줄을 여닫는다.
    const started = Date.now();
    const more = page.locator("details.more").first();
    await more.locator("> summary").click();
    expect(await more.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    const row = more.locator("li.finding > details").first();
    expect(await row.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await row.locator("> summary").click();
    expect(await row.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    expect(await row.locator(".finding-body").innerText()).toContain("판정 경로");
    expect(Date.now() - started).toBeLessThan(5_000);

    // 다른 예시로 돌아가는 것도 된다.
    await page.locator("#sample-select").selectOption(SAMPLES[0].id);
    await opened(page, `${SAMPLES[0].label} (${SAMPLES[0].origin})`);
    expect(await page.locator("li.finding").count()).toBe(1);
  });
});

describe("다른 쪽에 다녀오거나 새로 고친 뒤", () => {
  // 연 것은 메모리에만 둔다. 같은 문서 안에서 다른 쪽에 다녀오면 남아 있고, 문서를 다시 받으면 사라진다.
  const FIXED = ["contract", "cli-current", "night-push.fixed.json"];

  /** 지금 화면에 그려진 결과(정책 카드 부분)의 글. */
  const cards = (page: Page) => page.locator(".policies").innerText();

  it("정책 링크로 갔다가 뒤로 와도 연 파일이 그대로다. 스크롤 자리도 같다", async () => {
    // 되살리지 않으면 기본 합성 예시가 열린다. 브라우저가 스크롤 자리는 되살리므로 "합성 예시입니다"는 화면 밖이고,
    // 화면에 보이는 것은 예시의 정책 카드다.
    const { page } = await openView();
    await pick(page, FIXED);
    const link = page.locator("article.policy h3 a").nth(1);
    await link.scrollIntoViewIfNeeded();
    const before = { y: await scrollY(page), cards: await cards(page) };
    expect(before.y).toBeGreaterThan(720);
    expect(before.cards).toContain("src/marketing/campaign.ts:12");

    await link.click();
    await page.waitForURL("**/policy/**");
    // 뷰어가 떨어져 나간 뒤에 돌아온다(다른 쪽이 그려졌다).
    await page.waitForSelector(".viewer", { state: "detached" });
    await page.goBack();
    await page.waitForURL("**/view/");
    await opened(page, "night-push.fixed.json");
    expect(await cards(page)).toBe(before.cards);
    expect(await page.locator("#sample-select").inputValue()).toBe("");
    await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(before.y);
    // 새로 연 것이 아니다. 화면 낭독기에 다시 알리지 않는다.
    expect(await statusText(page)).toBe("");

    // 머리의 링크로 다녀와도(뒤로 가기가 아니다) 그대로다.
    await page.locator(".site-header nav a", { hasText: "조문 도감" }).click();
    await page.waitForURL("**/policy/");
    await page.locator(".site-header nav a", { hasText: "결과 보기" }).click();
    await page.waitForURL("**/view/");
    await opened(page, "night-push.fixed.json");
    expect(await cards(page)).toBe(before.cards);
    expect(await inView(page, ".viewer-title")).toBe(true);

    // 되살린 뒤에 새로 여는 것은 알린다. 예시를 열어 두고 다녀오면 그 예시가 열려 있다.
    await pick(page, ["contract", "cli-current", "plain.main.json"]);
    expect(await statusText(page)).toBe("열었습니다: plain.main.json");
    const sample = SAMPLES.find((s) => s.id === "genai-chat.main")!;
    await page.locator("#sample-select").selectOption(sample.id);
    await opened(page, `${sample.label} (${sample.origin})`);
    await page.locator(".site-header nav a", { hasText: "데모" }).click();
    await page.waitForURL("**/demo/");
    await page.goBack();
    await page.waitForURL("**/view/");
    await opened(page, `${sample.label} (${sample.origin})`);
    expect(await page.locator("#sample-select").inputValue()).toBe(sample.id);
    expect(await page.locator(".viewer-note").innerText()).toBe(`합성 예시입니다. ${sample.note}`);
  });

  /** 기본 예시가 맨 위에서 열려 있고, 조금 뒤에도 그대로다(브라우저가 스크롤 자리를 늦게 되살리는 때가 있다). */
  async function startsAtTop(page: Page, when: string): Promise<void> {
    await page.waitForSelector(".viewer-title");
    await expect.poll(() => scrollY(page), { message: when, timeout: 5_000 }).toBe(0);
    await page.waitForTimeout(700);
    expect(await scrollY(page), `${when} (조금 뒤)`).toBe(0);
    expect(await title(page), when).toBe(DEFAULT_TITLE);
    expect(await page.locator("#sample-select").inputValue(), when).toBe(SAMPLES[0].id);
    expect(await inView(page, ".viewer-title"), when).toBe(true);
    expect(await inView(page, ".viewer-note"), when).toBe(true);
    expect(await page.locator(".viewer-note").innerText(), when).toBe(`합성 예시입니다. ${SAMPLES[0].note}`);
  }

  it("새로 고치면 연 것은 사라지고, 기본 예시가 맨 위에서 열린다", async () => {
    // 브라우저는 새로 고친 뒤에도 앞서 보던 스크롤 자리를 되살린다. 그대로 두면 기본 예시의 제목과 "합성 예시입니다"가
    // 화면 밖에 놓인다. 되살리는 때는 둘이다: 그 자리가 기본 예시의 높이 안쪽이면 문서를 읽자마자, 그보다 깊으면 문서를
    // 다 받은 뒤에(갈 수 있는 데까지만) 되살린다.
    const { page } = await openView();
    for (const depth of [1500, 100_000]) {
      await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
      await page.evaluate((y) => window.scrollTo(0, y), depth);
      const from = await scrollY(page);
      expect(from).toBeGreaterThan(1400);
      expect(await inView(page, ".viewer-title")).toBe(false);
      await page.reload({ waitUntil: "load" });
      await startsAtTop(page, `내려 둔 자리 ${from}에서 새로 고침`);
    }

    // 지켜보는 동안이 지나면 스크롤을 건드리지 않는다.
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300);
    expect(await scrollY(page)).toBe(900);
  });

  it("조문 도감 쪽에서 새로 고친 뒤 뒤로 와도 기본 예시가 맨 위에서 열린다", async () => {
    // 뷰어는 새 문서에서 처음 붙으므로 되살릴 것이 없다. 그런데 같은 문서 안의 뒤로 가기라서, 브라우저는 뷰어가 붙은
    // 뒤에 앞서 보던 스크롤 자리를 되살린다.
    const { page } = await openView();
    await pick(page, FIXED);
    const link = page.locator("article.policy h3 a").nth(1);
    await link.scrollIntoViewIfNeeded();
    expect(await scrollY(page)).toBeGreaterThan(720);
    await link.click();
    await page.waitForURL("**/policy/**");
    // 새로 고친 쪽에 스크립트가 다 붙은 뒤에 뒤로 간다(사람이 새로 고치고 읽다가 돌아오는 차례다). 그래야 뒤로 가기가 같은
    // 문서 안의 이동이 된다.
    await page.reload({ waitUntil: "networkidle" });
    await page.goBack();
    await page.waitForURL("**/view/");
    await startsAtTop(page, "조문 도감에서 새로 고친 뒤 뒤로");
  });

  it("다른 쪽을 주소로 열었다가 뒤로 와도 파일 입력과 예시 고르기에 앞서의 값이 되살아나지 않는다", async () => {
    // 주소로 연 쪽은 새 문서다. 거기서 뒤로 오면 /view 문서를 다시 받는다(이 시험의 Chrome 은 문서를 통째로 되살리지
    // 않는다. 자동화 도구가 그 기능을 끄고 띄운다). 연 것은 사라지고 기본 예시가 열리는데, 브라우저는 이때 폼 값을
    // 되살린다. 되살리게 두면 화면은 기본 예시인데 파일 입력 옆에는 앞서 고른 파일의 이름이 적히고, 예시 고르기는
    // "직접 연 파일"을 가리킨다.
    const { context, page } = await openView();
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#report-file").click();
    await (await chooser).setFiles(file(...FIXED));
    await opened(page, "night-push.fixed.json");
    expect(await chosenFile(page)).toBe("night-push.fixed.json");
    expect(await page.locator("#sample-select").inputValue()).toBe("");
    await page.locator("article.policy h3 a").nth(1).scrollIntoViewIfNeeded();
    expect(await scrollY(page)).toBeGreaterThan(720);
    await page.goto(`${site.origin}/policy/`, { waitUntil: "load" });

    // 돌아올 때는 스크립트를 붙들어 둔다. 스크립트가 붙으면 예시 고르기는 다시 그려지며 제 값을 찾으므로, 브라우저가
    // 되살렸는지는 붙기 전에만 가릴 수 있다. 느린 연결에서는 사람도 이 화면을 본다.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await context.route("**/_next/static/**/*.js", async (route) => {
      await held;
      await route.fallback().catch(() => {});
    });
    try {
      await page.goBack({ waitUntil: "domcontentloaded" });
      // 브라우저는 문서를 다 읽은 바로 뒤에 폼 값을 되살린다(쪽에는 아무 이벤트도 오지 않는다). 조금 기다렸다가 본다.
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => ({
        navigation: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).type,
        attached: Object.keys(document.querySelector("#report-file")!).some((key) => key.startsWith("__react")),
      }));
      expect(state).toEqual({ navigation: "back_forward", attached: false });
      expect(await title(page)).toBe(DEFAULT_TITLE);
      expect(await chosenFile(page)).toBe("");
      expect(await page.locator("#sample-select").inputValue()).toBe(SAMPLES[0].id);
    } finally {
      release();
    }

    // 스크립트가 붙은 뒤에도 같다. 기본 예시가 맨 위에서 열려 있고 입력은 비어 있다.
    await startsAtTop(page, "다른 쪽을 주소로 열었다가 뒤로");
    expect(await chosenFile(page)).toBe("");
  });

  it("처음 찾아온 쪽에서는 스크롤을 건드리지 않는다", async () => {
    // 맨 위로 올리는 것은 문서를 다시 받았을 때뿐이다. 처음 찾아온 쪽에서 스크립트가 늦게 붙는 동안 읽어 내려간 사람을
    // 끌어올리면 안 된다. 스크립트가 붙기 전에 내려야 하므로 쪽은 문서만 읽고 바로 돌려받는다(창은 다른 시험과 같게 연다).
    const { page } = await newPage(browser, site, { contexts, problems });
    await page.goto(`${site.origin}/view/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, 400));
    // 스크립트가 붙을 때까지 기다린다(파일 입력에 React 가 붙는다).
    await page.waitForFunction(() => Object.keys(document.querySelector("#report-file")!).some((key) => key.startsWith("__react")));
    await page.waitForTimeout(700);
    expect(await scrollY(page)).toBe(400);
    expect(await title(page)).toBe(DEFAULT_TITLE);
  });
});

describe("좁은 화면에서 가로로 넘치지 않는다", () => {
  // ROADMAP 8번에 넘어와 있던 확인이다. 수집본 7개와 tests/fixtures 전부를 375px 에서 연다. SARIF 수집본과 v1 초안 예시,
  // 읽지 못한 파일의 안내도 함께 본다. 접힌 채로 한 번, 모두 펼친 채로 한 번 잰다.
  const NONE: { page: number; over: string[] } = { page: 0, over: [] };
  const every = [...CAPTURES, ...SARIFS, ...DRAFTS, ...FIXTURES];

  it("볼 파일이 있다", () => {
    expect([CAPTURES.length, SARIFS.length, DRAFTS.length]).toEqual([7, 1, 3]);
    expect(FIXTURES.length).toBeGreaterThanOrEqual(6);
  });

  it("375px: 수집본, SARIF, v1 초안 예시, 시험용 자료", async () => {
    const { page } = await openView({ width: 375, height: 667 });
    expect(await overflow(page)).toMatchObject({ ...NONE, limit: 355 });
    for (const parts of every) {
      const name = parts.join("/");
      await pick(page, parts);
      expect(await overflow(page), `${name} (접힌 채)`).toMatchObject(NONE);
      await page.evaluate(() => {
        for (const details of document.querySelectorAll("details")) details.open = true;
      });
      expect(await overflow(page), `${name} (펼친 채)`).toMatchObject(NONE);
    }
    await pickContent(page, "a-very-long-file-name-for-a-file-that-is-not-a-result.package.json", "{}");
    expect(await overflow(page), "읽지 못한 파일의 안내").toMatchObject(NONE);
  });

  /**
   * 예시 고르기 상자의 너비(px). `room` 은 상자가 든 칸, `shown` 은 화면에 보이는 너비, `natural` 은 칸에 맞춰 줄이지
   * 않았을 때의 제 너비(가장 긴 항목에 맞춘 너비)다.
   */
  const selectWidths = (page: Page) =>
    page.locator("#sample-select").evaluate((el) => {
      const select = el as HTMLSelectElement;
      const room = select.parentElement!.getBoundingClientRect().width;
      const shown = select.getBoundingClientRect().width;
      select.style.maxWidth = "none";
      const natural = select.getBoundingClientRect().width;
      select.style.maxWidth = "";
      return { room, shown, natural, options: select.options.length };
    });

  it("320px: 예시 고르기 상자가 본문 칸을 넓히지 않는다", async () => {
    // 고르기 상자는 줄을 바꾸지 못한다. 상자가 칸(280px)보다 넓으면 칸이 그 너비만큼 넓어져 본문의 오른쪽 여백이
    // 사라지고 쪽이 가로로 넘친다(ROADMAP 3번에서 넘어온 것). 뷰어의 칸을 minmax(0, 1fr) 로 정해 막았다(globals.css).
    const { page } = await openView({ width: 320, height: 640 });
    expect(await overflow(page)).toEqual({ ...NONE, limit: 300 });
    // 넓은 글꼴을 흉내 낸다. 이 컴퓨터의 글꼴로는 상자의 제 너비(276px)가 칸보다 좁아서, 여기까지만 재면 칸을 붙드는
    // 줄을 지워도 통과한다(예시 이름을 줄인 뒤로 그랬다). 상자의 글자만 키워 제 너비가 칸보다 넓어지게 한다.
    await page.addStyleTag({ content: "#sample-select { font-size: 20px; }" });
    const select = await selectWidths(page);
    // 칸을 밀 만큼 넓어야 이 시험이 무엇인가를 본다. 여기서 실패하면 글자를 더 키운다.
    expect(select.natural).toBeGreaterThan(280);
    expect(await overflow(page)).toEqual({ ...NONE, limit: 300 });
    // 칸은 그대로이고, 상자가 칸에 맞춰 줄었다.
    expect(select).toMatchObject({ room: 280, shown: 280 });
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    expect(await overflow(page)).toEqual({ ...NONE, limit: 300 });
  });

  it("320px: 예시 고르기 상자가 가장 긴 항목도 자르지 않는다", async () => {
    // 고르기 상자는 가장 긴 항목에 맞춰 넓어진다. 그 너비가 칸(280px)보다 넓으면 칸에 맞춰 줄고(max-width), 고른 항목의
    // 끝이 잘려 보인다. 이름에 출처를 한 번 더 적던 때 그랬다("… (v1 초안) · v1 초안 예시"). 줄이지 않았을 때의 너비가
    // 칸 안에 드는지를 본다. 이 컴퓨터의 글꼴로 잰 것이다(글꼴이 더 넓으면 달라진다).
    const { page } = await openView({ width: 320, height: 640 });
    const widths = await selectWidths(page);
    expect(widths.options).toBe(SAMPLES.length + 1);
    expect(widths.room).toBe(280);
    expect(widths.natural).toBeLessThanOrEqual(widths.room);
    expect(widths.shown).toBe(widths.natural);
  });

  it("낮은 화면(320×568)에서 파일을 열면 제목이 화면에 들어온다. 읽지 못한 파일의 안내도 보인다", async () => {
    // 이 크기에서는 파일 입력과 예시 고르기 아래의 제목이 화면 아래에 있다. 스크롤 자리가 그대로면, 파일을 고른 뒤에도
    // 무엇이 열렸는지와 읽지 못했다는 안내가 보이지 않는다.
    const { page } = await openView({ width: 320, height: 568 });
    expect(await inView(page, ".viewer-title")).toBe(false);
    await pick(page, ["contract", "cli-current", "kids-signup.main.json"]);
    expect(await inView(page, ".viewer-title")).toBe(true);
    expect(await chosenFile(page)).toBe("kids-signup.main.json");

    await page.evaluate(() => window.scrollTo(0, 0));
    await pickContent(page, "scan.txt", "검토 필요 1건\n");
    expect(await inView(page, ".viewer-title")).toBe(true);
    const alert = (await page.locator('.viewer [role="alert"]').boundingBox())!;
    expect(alert.y).toBeGreaterThanOrEqual(0);
    expect(alert.y).toBeLessThan(568 - 100);

    // 예시를 고를 때는 움직이지 않는다(고르기 상자에 초점을 둔 채 넘겨 보는 동안 화면이 움직이면 안 된다).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#sample-select").selectOption("plain.main");
    await opened(page, "정책 신호가 없는 코드 (CLI 실제 출력)");
    expect(await scrollY(page)).toBe(0);
  });
});

describe("같은 규칙이 여러 파일에 반복되는 결과 (tests/fixtures/repeated-rule.json)", () => {
  // ROADMAP 8번에 1번에서 넘어와 있던 확인이다. 부품 시험(tests/render.test.tsx)은 접힌 곳이 HTML 에서 어디에 있는지만 본다.
  // 여기서는 실제로 가려지고 펼쳐지는지, 닫힌 줄에도 판정 범위가 그려져 있는지, 줄을 누르는 것이 어떻게 듣는지를 본다.
  const REPEATED = ["tests", "fixtures", "repeated-rule.json"];
  const view = viewOfFile(...REPEATED);
  /** 화면 차례의 발견 줄: 먼저 보이는 곳과 접힌 곳. 묶음마다 먼저 보이는 곳 뒤에 그 묶음의 접힌 곳이 온다. */
  const groups = view.policies.flatMap((policy) => policy.rules);
  const expectedRow = (location: (typeof groups)[number]["shown"][number]) => ({
    where: location.line === null ? location.file : `${location.file}:${location.line}`,
    scope: scopeLabel(location.scope),
    status: STATUS_LABEL[location.status],
  });

  /** 화면에 보이는(그려진) 발견 줄마다: 경로·줄, 판정 범위, 상태, 그리고 판정 범위가 줄 번호 바로 옆(같은 줄의 오른쪽)에 있는지. */
  const shownRows = (page: Page) =>
    page.locator("li.finding").evaluateAll((all) =>
      all
        .filter((li) => li.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        .map((li) => {
          const summary = li.querySelector(":scope > details > summary")!;
          const code = summary.querySelector("code")!;
          const scope = summary.querySelector(".finding-scope")!;
          // 경로는 줄이 바뀔 수 있다. 줄 번호는 마지막 줄 조각에 있다.
          const tail = [...code.getClientRects()].at(-1)!;
          const box = scope.getBoundingClientRect();
          const inRow = summary.getBoundingClientRect();
          return {
            row: {
              where: code.textContent,
              scope: scope.textContent,
              status: summary.querySelector(".chip")!.textContent,
            },
            beside: box.left >= tail.right - 1 && box.top < tail.bottom && box.bottom > tail.top,
            inside: box.left >= inRow.left && box.right <= inRow.right + 0.5 && box.width > 0,
          };
        }),
    );

  it("처음에 보이는 발견 줄은 8개이고, '같은 규칙의 나머지 17곳'을 누르면 25개다. 보이는 줄마다 줄 번호 옆에 판정이 본 범위가 보인다", async () => {
    const { page } = await openView();
    await pick(page, REPEATED);
    const first = groups.flatMap((group) => group.shown).map(expectedRow);
    const all = groups.flatMap((group) => [...group.shown, ...group.folded]).map(expectedRow);
    expect([first.length, all.length]).toEqual([8, 25]);

    // 처음: 묶음마다 먼저 보이는 곳만 그려져 있다. 접힌 17곳은 문서에는 있지만 보이지 않는다.
    expect(await page.locator("li.finding").count()).toBe(25);
    let rows = await shownRows(page);
    expect(rows.map((entry) => entry.row)).toEqual(first);
    for (const entry of rows) expect(entry, entry.row.where!).toMatchObject({ beside: true, inside: true });
    // 판정 범위와 줄 번호는 실제로 그려진다(흐리거나 잘리거나 덮이지 않았다).
    const closed = await undrawn(page, { root: "li.finding > details > summary", veiled: ".visually-hidden" });
    expect(closed.undrawn).toEqual([]);
    expect(closed.texts).toBeGreaterThanOrEqual(first.length * 3);

    // 접힌 곳은 하나다. 그 이름을 누르면 나머지 17곳이 그 묶음 안에 나온다.
    const more = page.locator("details.more > summary");
    expect(await more.allInnerTexts()).toEqual(["같은 규칙의 나머지 17곳"]);
    await more.click();
    rows = await shownRows(page);
    expect(rows.map((entry) => entry.row)).toEqual(all);
    for (const entry of rows) expect(entry, entry.row.where!).toMatchObject({ beside: true, inside: true });
    const opened = await undrawn(page, { root: "li.finding > details > summary", veiled: ".visually-hidden" });
    expect(opened.undrawn).toEqual([]);
    expect(opened.texts).toBeGreaterThan(closed.texts);

    // 좁은 화면에서도 보이는 줄마다 범위가 그려진다. 경로가 길면 범위가 다음 줄로 내려갈 수 있어서 자리는 보지 않는다.
    await page.setViewportSize({ width: 375, height: 667 });
    rows = await shownRows(page);
    expect(rows.map((entry) => entry.row)).toEqual(all);
    for (const entry of rows) expect(entry.inside, entry.row.where!).toBe(true);
    expect((await undrawn(page, { root: "li.finding > details > summary", veiled: ".visually-hidden" })).undrawn).toEqual([]);
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });

    // 접으면 다시 8개다.
    await more.click();
    expect((await shownRows(page)).map((entry) => entry.row)).toEqual(first);
  });

  it("발견 줄의 경로를 끌어 고르거나 두 번·세 번 눌러 골라도 줄이 여닫히지 않는다. 그냥 누르거나 Enter·Space 를 누르면 여닫힌다", async () => {
    // 줄 전체가 펼침 단추(summary)다. 경로는 복사해 가는 글이라 고를 수 있어야 한다(components/result/FindingSummary.tsx).
    // 판단 규칙은 부품 시험이 본다(tests/render.test.tsx 의 "발견 줄을 누를 때"). 여기서는 브라우저가 실제로 그렇게 하는지 본다.
    const { page } = await openView();
    // 처음에 열린 예시의 발견 줄 하나. 묶음의 첫 발견이라 펼쳐져 있다.
    const row = page.locator("li.finding > details").first();
    const summary = row.locator("> summary");
    const path = summary.locator("code");
    const isOpen = () => row.evaluate((el) => (el as HTMLDetailsElement).open);
    const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? "");
    const where = (await path.textContent())!;
    expect(where).toBe("src/auth/signup.ts:5");
    expect(await isOpen()).toBe(true);

    // 경로를 처음부터 끝까지 끌어 고른다(누른 채 움직이고 뗀다). 골라진 글은 경로의 일부이고, 줄은 펼쳐진 그대로다.
    // 마우스는 창 안의 자리만 누를 수 있다. 그 줄을 먼저 창 안으로 가져온다.
    await summary.scrollIntoViewIfNeeded();
    const box = (await path.boundingBox())!;
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const dragged = await selected();
    expect(dragged.length).toBeGreaterThan(10);
    expect(where).toContain(dragged);
    expect(await isOpen()).toBe(true);

    // 두 번 눌러 낱말을, 세 번 눌러 줄을 골라도 처음 상태로 돌아온다(첫 누름에 여닫힌 것을 둘째 누름이 되돌린다).
    for (const clickCount of [2, 3]) {
      await path.click({ clickCount });
      expect(await selected(), `${clickCount}번 누름`).not.toBe("");
      expect(await isOpen(), `${clickCount}번 누름`).toBe(true);
    }

    // 그냥 누르면 여닫힌다. 골라 둔 글 밖을 누르면 누르는 순간 고른 것이 풀린다.
    await summary.locator(".finding-scope").click();
    expect(await isOpen()).toBe(false);
    await path.click();
    expect(await isOpen()).toBe(true);

    // 골라 둔 글 위를 그냥 눌러도 여닫힌다. 두 번 눌러 고른 낱말의 가운데를 한 번 누른다. Chrome 은 골라진 글 위를 누르면
    // click 이 올 때까지 그 글을 골라진 채로 둔다(끌어 옮기기의 시작일 수 있어서다). 그래서 줄의 click 처리는 골라진 글을 보고,
    // 끌지도 이어 누르지도 않았으니 여닫아야 한다. click 이 올 때 글이 골라져 있었는지도 적어 본다(풀린 뒤라면 위와 같은 것을
    // 볼 뿐이다).
    await path.click({ clickCount: 2 });
    const word = await selected();
    expect(word).not.toBe("");
    expect(await isOpen()).toBe(true);
    const middle = await page.evaluate(() => {
      const box = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await summary.evaluate((el) =>
      el.addEventListener(
        "click",
        () => ((window as unknown as { __selectedAtClick: string }).__selectedAtClick = window.getSelection()?.toString() ?? ""),
        { capture: true, once: true },
      ),
    );
    await page.mouse.click(middle.x, middle.y);
    expect(await page.evaluate(() => (window as unknown as { __selectedAtClick?: string }).__selectedAtClick)).toBe(word);
    expect(await isOpen()).toBe(false);
    await path.click();
    expect(await isOpen()).toBe(true);

    // 키보드: Enter 와 Space 가 여닫는다(골라 둔 글이 있어도 키는 고르는 동작이 아니다).
    await path.click({ clickCount: 2 });
    await summary.focus();
    await page.keyboard.press("Enter");
    expect(await isOpen()).toBe(false);
    await page.keyboard.press("Space");
    expect(await isOpen()).toBe(true);
    await page.keyboard.press("Space");
    expect(await isOpen()).toBe(false);
    // 초점이 어디 있는지 보인다.
    expect(await summary.evaluate((el) => el.matches(":focus-visible") && getComputedStyle(el).outlineStyle)).toBe("solid");
  });
});

describe("다 보지 못한 것 (tests/fixtures/incomplete-coverage.json)", () => {
  // ROADMAP 8번에 3번에서 넘어와 있던 확인이다. 부품 시험은 HTML 의 구조와 글만 본다(tests/render.test.tsx 의 "커버리지 보기").
  // 좁은 화면에서 줄이 쌓이는지, 칸 머리가 가려지는지, 표로 드러나는지, 오류 문장의 빈칸이 보이는지는 브라우저에서 본다.
  const INCOMPLETE = ["tests", "fixtures", "incomplete-coverage.json"];
  const LABELS = ["검사하지 않은 파일", "일부를 읽지 못한 파일", "엔진이 끝내지 못한 파일"];

  it("맨 위 경고가 결과의 첫 줄로 보이고, 접어 둔 '이 도구가 보지 못하는 것'은 처음에 닫혀 있다", async () => {
    const { page } = await openView({ width: 375, height: 667 });
    await pick(page, INCOMPLETE);
    const read = await page.locator(".report").evaluate((report) => {
      const shown = [...report.children].filter((el) => el.checkVisibility());
      const notSeen = report.querySelector(".coverage > details.fold") as HTMLDetailsElement | null;
      return {
        first: report.firstElementChild?.className,
        // 결과 화면에 그려진 것 가운데 가장 위에 있는 것(CSS 로 자리를 옮겨도 드러나게 자리를 잰다).
        top: shown.reduce((best, el) => (el.getBoundingClientRect().top < best.getBoundingClientRect().top ? el : best)).className,
        firstLine: (report as HTMLElement).innerText.split("\n")[0],
        notSeen: notSeen && {
          open: notSeen.open,
          summary: notSeen.querySelector(":scope > summary")!.textContent,
          shown: notSeen.querySelector(".not-seen")!.checkVisibility(),
        },
      };
    });
    expect(read).toEqual({
      first: "notice notice-warn coverage-warning",
      top: "notice notice-warn coverage-warning",
      firstLine: expect.stringMatching(/^다 보지 못한 검사입니다\. 검사하지 않은 파일 1개 · /),
      notSeen: { open: false, summary: `${SITE.notSeen.title} ${GAPS_UNLISTED}`, shown: false },
    });
    // 경고는 실제로 그려진다.
    expect((await undrawn(page, { root: ".coverage-warning", veiled: ".visually-hidden" })).undrawn).toEqual([]);
    // 이름을 누르면 펼쳐진다.
    await page.locator(".coverage > details.fold > summary").click();
    expect(await page.locator(".coverage .not-seen").isVisible()).toBe(true);
  });

  /** "다 보지 못한 것" 표의 줄마다 이름·수·뜻과 파일의 칸이 놓인 자리, 그리고 이름과 수의 글자 밑줄(baseline). */
  const gapRows = (page: Page) =>
    page.locator("table.gaps tbody tr").evaluateAll((rows) =>
      rows.map((tr) => {
        const box = (el: Element) => {
          const rect = el.getBoundingClientRect();
          return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
        };
        // 글자 밑줄: 칸 끝에 크기가 0인 글줄 상자를 넣어 그 자리를 잰다(그 상자의 아래 끝이 글자 밑줄에 놓인다). 재고 걷어 낸다.
        const baseline = (cell: Element) => {
          const probe = document.createElement("span");
          probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
          cell.append(probe);
          const y = probe.getBoundingClientRect().bottom;
          probe.remove();
          return y;
        };
        const [name, count, detail] = [tr.querySelector("th")!, tr.querySelector(".gap-count")!, tr.querySelector(".gap-detail")!];
        const range = document.createRange();
        range.selectNodeContents(name);
        return {
          label: name.textContent,
          name: box(name),
          nameLines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
          count: box(count),
          detail: box(detail),
          row: box(tr),
          baselines: Math.abs(baseline(name) - baseline(count)),
        };
      }),
    );

  it("480px 이하: 표의 줄을 세로로 쌓는다(이름과 수가 한 줄, 뜻과 파일이 그 아래). 넘치지 않고, 칸 머리는 화면에 보이지 않고, 이름과 수의 글자 밑줄이 맞는다", async () => {
    const { page } = await openView({ width: 480, height: 720 });
    await pick(page, INCOMPLETE);
    for (const width of [480, 375, 320]) {
      await page.setViewportSize({ width, height: 720 });
      const rows = await gapRows(page);
      expect(rows.map((row) => row.label), `${width}px`).toEqual(LABELS);
      for (const row of rows) {
        const at = `${width}px ${row.label}`;
        // 이름과 수가 한 줄: 이름은 한 줄로 적히고, 수는 그 오른쪽에 같은 글자 밑줄로 놓인다.
        expect(row.nameLines, at).toBe(1);
        expect(row.count.left, at).toBeGreaterThanOrEqual(row.name.right);
        expect(row.baselines, at).toBeLessThanOrEqual(1);
        // 뜻과 파일은 그 아래에서 줄의 너비를 다 쓴다.
        expect(row.detail.top, at).toBeGreaterThanOrEqual(Math.max(row.name.bottom, row.count.bottom) - 1);
        expect([row.detail.left, row.detail.right], at).toEqual([row.row.left, row.row.right]);
      }
      // 칸 머리("목록", "수", "뜻과 파일")는 화면에 보이지 않는다(1px 로 가린다).
      const head = await page.locator("table.gaps thead").evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
      expect(head, `${width}px`).toEqual([1, 1]);
      expect(await overflow(page), `${width}px`).toMatchObject({ page: 0, over: [] });
      // 펼쳐도 넘치지 않는다.
      await page.evaluate(() => {
        for (const details of document.querySelectorAll<HTMLDetailsElement>(".report details")) details.open = true;
      });
      expect(await overflow(page), `${width}px (펼친 채)`).toMatchObject({ page: 0, over: [] });
      await page.evaluate(() => {
        for (const details of document.querySelectorAll<HTMLDetailsElement>(".report details")) details.open = false;
      });
    }

    // 대조: 481px 부터는 쌓지 않는다. 이름·수·뜻과 파일이 한 줄에 나란히 놓이고, 이름과 수의 글자 밑줄은 그대로 맞는다.
    await page.setViewportSize({ width: 481, height: 720 });
    for (const row of await gapRows(page)) {
      expect(row.detail.left, row.label!).toBeGreaterThanOrEqual(row.count.right);
      expect(row.detail.top, row.label!).toBeLessThan(row.name.bottom);
      expect(row.baselines, row.label!).toBeLessThanOrEqual(1);
    }
  });

  it("좁은 화면에서도, 넓은 화면에서도 표가 접근성 트리에 표·줄·칸으로 드러난다. 표의 이름은 그 제목이다", async () => {
    // 좁은 화면에서는 CSS 가 표의 display 를 바꾼다. 그래도 표로 읽히게 role 을 직접 적었다(components/result/Coverage.tsx).
    // Chrome 의 접근성 트리를 CDP 로 읽는다(site.ts 의 accessibleNodes. 화면 낭독기의 음성은 아니다). 시험 도구의 getByRole 은
    // 태그와 role 속성으로 셈해서, 브라우저가 표의 뜻을 버려도 표로 센다. Chrome 155 는 role 속성을 걷어 내도 쌓은 표를
    // 표·줄·칸으로 드러내므로(8번에서 사본으로 걷어 봤다), role 이 붙어 있는지는 부품 시험(tests/parts.test.tsx)이 본다.
    const { context, page } = await openView({ width: 375, height: 667 });
    await pick(page, INCOMPLETE);
    const nodes = (selector: string) => accessibleNodes(context, page, selector);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      const at = `${width}px`;
      expect(await nodes("table.gaps"), at).toEqual([{ role: "table", name: `${GAPS_TITLE} ${GAPS_NOTE}` }]);
      expect(await nodes("table.gaps thead th"), at).toEqual(["목록", "수", "뜻과 파일"].map((name) => ({ role: "columnheader", name })));
      expect(await nodes("table.gaps tbody th"), at).toEqual(LABELS.map((name) => ({ role: "rowheader", name })));
      expect((await nodes("table.gaps tr")).map((node) => node.role), at).toEqual(Array(1 + LABELS.length).fill("row"));
      // 그려진 칸이 모두 칸으로 드러난다. 줄마다 수와 뜻·파일의 두 칸이다.
      const drawn = await page.locator("table.gaps td").evaluateAll((all) => all.map((td) => td.getClientRects().length > 0));
      expect(drawn, at).toEqual(Array(LABELS.length * 2).fill(true));
      const cells = await nodes("table.gaps td");
      expect(cells.map((node) => node.role), at).toEqual(drawn.map(() => "cell"));
      expect(cells.filter((_, i) => i % 2 === 0).map((node) => node.name), at).toEqual(["1개", "1개", "1개"]);
    }
  });

  it("결과에 실린 오류 문장의 줄바꿈·탭·이어진 빈칸이 화면에 그대로 보이고, 문장 사이가 떨어져 있다", async () => {
    // CLI 는 엔진의 문장을 양끝만 다듬어 싣는다. 안쪽의 줄바꿈·탭·이어진 빈칸은 남는다(docs/architecture.md 의 "커버리지 보기").
    // 손으로 만든 결과다(수집본에는 엔진 오류가 없다).
    const texts = [
      "[Fatal error] first line\n\tsecond line with a tab\n    third line with four spaces",
      "[Timeout] <b>not</b> markup & \"quoted\"  two spaces",
    ];
    const base = readJson(...INCOMPLETE) as Report;
    const { page } = await openView({ width: 375, height: 667 });
    await pickContent(page, "engine-errors.json", JSON.stringify({ ...base, run: { ...base.run, engine_errors: texts } }));
    const fold = page.locator("table.gaps details.fold", { hasText: "결과에 실린 오류 문장" });
    expect(await fold.locator("> summary").innerText()).toBe("결과에 실린 오류 문장 2개");
    await fold.locator("> summary").click();
    const items = await page.locator(".gap-texts li").evaluateAll((all) =>
      all.map((li) => ({
        drawn: (li as HTMLElement).innerText,
        lines: new Set([...li.getClientRects(), ...(() => {
          const range = document.createRange();
          range.selectNodeContents(li);
          return [...range.getClientRects()];
        })()].map((rect) => Math.round(rect.top))).size,
        top: li.getBoundingClientRect().top,
        bottom: li.getBoundingClientRect().bottom,
      })),
    );
    // 화면에 그려진 글(innerText)이 실린 글과 같다. 줄바꿈과 탭과 이어진 빈칸이 접히지 않았다.
    expect(items.map((item) => item.drawn)).toEqual(texts);
    // 첫 문장은 실린 줄바꿈대로 세 줄 이상으로 그려진다.
    expect(items[0].lines).toBeGreaterThanOrEqual(3);
    // 문장 사이가 떨어져 있다(한 문단처럼 붙어 읽히지 않는다).
    expect(items[1].top - items[0].bottom).toBeGreaterThanOrEqual(6);
    // 글로만 그려진다(꺾쇠가 요소가 되지 않는다). 좁은 화면에서 넘치지 않는다.
    expect(await page.locator(".gap-texts b").count()).toBe(0);
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });
  });
});

describe("결과 화면의 글과 꾸밈 (조문 도감·기록의 시험과 같은 기준)", () => {
  // 조문 도감과 조문별 검사 기록의 시험에만 있던 확인을 결과 화면으로 넓힌다(ROADMAP 8번): 브라우저에서 도는 코드가 더한 글이
  // 없는지(그린 글이 부품이 그린 글과 같은지), 글이 실제로 그려지는지, CSS 가 그린 글이 없는지, 접근성 트리의 이름.
  const every = [...CAPTURES, ...SARIFS, ...DRAFTS, ...FIXTURES];
  /**
   * 결과 화면이 그려도 되는 목록 표시. 판정 경로는 CLI 가 남긴 문장을 차례대로 적는 번호 목록이다(브라우저가 번호를 그린다).
   * 목록 안의 목록은 빈 동그라미다. 그 밖의 글을 CSS 로 그리지 않는다.
   */
  const MARKERS = ["disc", "circle", "decimal", "none", "disclosure-closed", "disclosure-open"];

  it("쪽의 본문에는 정해 둔 것뿐이고, 스크립트가 붙은 뒤의 글이 빌드된 쪽의 글과 같다 (주소로 열었을 때)", async () => {
    const { page } = await openView();
    await settle(site, page);
    const main = await page.locator("main.wrap").evaluate((el) => ({
      children: [...el.children].map((child) => `${child.tagName.toLowerCase()}.${child.className}`),
      text: el.textContent ?? "",
    }));
    expect(main.children).toEqual(["h1.", "p.lede", "div.viewer"]);
    // 빈칸은 빼고 견준다. 붙은 뒤에 화면 낭독기 알림 줄이나 결과에 글이 더해지면 여기서 어긋난다.
    expect(partingOf(squash(main.text), builtMainText("view"))).toBeNull();
    // 처음에 열린 예시의 결과 화면은 결과 화면 부품이 그 예시로 그린 글과 같다.
    const report = await page.locator(".report").evaluate((el) => el.textContent ?? "");
    expect(partingOf(squash(report), reportText(viewOfText(JSON.stringify(SAMPLES[0].data))))).toBeNull();
  });

  it("수집본, SARIF, v1 초안 예시, 시험용 자료: 그린 글이 결과 화면 부품이 그린 글과 같고, 정해 둔 속성만 있고, CSS 가 그린 글은 목록 표시뿐이다", async () => {
    const { page } = await openView();
    let rules = 0;
    for (const parts of every) {
      const name = parts.join("/");
      await pick(page, parts);
      await page.evaluate(() => {
        for (const details of document.querySelectorAll<HTMLDetailsElement>(".report details")) details.open = true;
      });
      const report = await page.locator(".report").evaluate((el) => el.textContent ?? "");
      expect(partingOf(squash(report), reportText(viewOfFile(...parts))), name).toBeNull();
      // 결과 화면의 요소에는 정해 둔 속성만 있다(가리거나 보이지 않는 글을 싣는 속성이 없다).
      expect(await unknownAttributes(page, ".report", RESULT_ATTRIBUTES), name).toEqual([]);
      // 쪽 전체(사이트의 머리와 바닥까지)를 본다. 다른 쪽의 꾸밈(데모의 줄 번호, 기록의 칸 이름)은 이 쪽에 그 class 가 없어 빠진다.
      const css = await cssDrawn(page, { markers: MARKERS });
      expect(css.rules, name).toEqual([]);
      expect(css.drawn, name).toEqual([]);
      rules = css.read.rules;
    }
    // 꾸밈의 규칙을 읽었다(꾸밈이 실리지 않은 쪽을 보고 통과한 것이 아니다).
    expect(rules).toBeGreaterThan(100);

    // 대조: 같은 방법으로, 결과 화면에 CSS 가 글을 그리면 잡힌다(연 쪽에만 넣는다). 판정 범위 옆의 풀이, 글로 적은 목록 표시.
    // 이 쪽에 없는 class 의 규칙은 다른 쪽의 꾸밈으로 보고 빼므로, 발견 줄이 있는 결과를 열어 둔다.
    await pick(page, ["contract", "cli-current", "night-push.main.json"]);
    // 속성도 같다. 정책 카드를 화면 낭독기에서 가리거나, 칩이 아닌 곳에 마우스를 올려야 뜨는 글을 더하면 잡힌다.
    await page.evaluate(() => {
      document.querySelector(".report article.policy")!.setAttribute("aria-hidden", "true");
      document.querySelector(".report .finding-scope")!.setAttribute("title", "풀이");
    });
    expect(await unknownAttributes(page, ".report", RESULT_ATTRIBUTES)).toEqual(["article.policy policy-needs-review-ai-pending[aria-hidden]", "span.finding-scope[title]"]);
    await page.addStyleTag({ content: '.finding-scope::after { content: " (풀이)"; } .findings { list-style-type: "→ "; } .no-such-class::before { content: "다른 쪽의 것"; }' });
    const control = await cssDrawn(page, { markers: MARKERS });
    expect(control.rules).toEqual(['.finding-scope::after { content: " (풀이)" }', '.findings { list-style-type: "→ " }']);
    expect(control.drawn).toEqual(
      expect.arrayContaining(['span.finding-scope::after content: " (풀이)"', 'ul.findings list-style-type: "→ "']),
    );
  });

  it("결과 화면의 글은 모두 그려진다: 좁은 화면(접힌 채와 펼친 채)과 넓은 화면에서 가려진 글이 없다", async () => {
    // 경고와 표, AI 의 판정, 같은 규칙의 접힌 곳, 드문 모양, 발견이 0인 결과(빈 결과 화면), SARIF 로 본다.
    const picked = [
      ["tests", "fixtures", "incomplete-coverage.json"],
      ["tests", "fixtures", "judge-on.cleared.json"],
      ["tests", "fixtures", "judge-on.dismissed.json"],
      ["tests", "fixtures", "repeated-rule.json"],
      ["tests", "fixtures", "uncommon-shapes.json"],
      ["contract", "cli-current", "kids-signup.fixed.json"],
      ["contract", "cli-current", "kids-signup.main.sarif"],
    ];
    const ROOT = ".viewer-title, .viewer-note, .report";
    const { page } = await openView({ width: 375, height: 667 });
    for (const parts of picked) {
      const name = parts.join("/");
      await page.setViewportSize({ width: 375, height: 667 });
      await pick(page, parts);
      const closed = await undrawn(page, { root: ROOT, veiled: ".visually-hidden" });
      expect(closed.undrawn, `${name} 375px 접힌 채`).toEqual([]);
      const folds = await page.locator(".report details:not([open])").count();
      await page.evaluate(() => {
        for (const details of document.querySelectorAll<HTMLDetailsElement>(".report details")) details.open = true;
      });
      const opened = await undrawn(page, { root: ROOT, veiled: ".visually-hidden" });
      expect(opened.undrawn, `${name} 375px 펼친 채`).toEqual([]);
      // 본 글이 있다. 접어 둔 것이 있었으면 펼친 뒤에 볼 글이 는다(접어 둔 글을 빼고 본 것이 맞다).
      expect(closed.texts, name).toBeGreaterThan(20);
      if (folds > 0) expect(opened.texts, name).toBeGreaterThan(closed.texts);
      else expect(opened.texts, name).toBe(closed.texts);
      await page.setViewportSize({ width: 1280, height: 720 });
      expect((await undrawn(page, { root: ROOT, veiled: ".visually-hidden" })).undrawn, `${name} 1280px`).toEqual([]);
    }
  });

  it("접근성 트리: 정책 카드와 규칙 묶음은 제목으로, 발견 줄은 경로·범위·상태·규칙이 든 서로 다른 이름으로 드러난다", async () => {
    // 같은 파일·같은 줄에 규칙이 다른 발견이 둘 있는 결과다. 눈에는 묶음 머리가 규칙을 말해 주고, 화면 낭독기에는 줄마다
    // 보이지 않게 붙인 규칙 이름이 구분해 준다(components/result/PolicyCard.tsx).
    // 제목은 Chrome 의 접근성 트리를 CDP 로 읽는다(site.ts 의 accessibleNodes). 제목이 될 수 있는 요소를 모두 읽고 단계로 고른다.
    const parts = ["contract", "cli-current", "night-push.main.json"];
    const view = viewOfFile(...parts);
    const { context, page } = await openView({ width: 375, height: 667 });
    await pick(page, parts);
    const headings = await accessibleNodes(context, page, ".report :is(h1, h2, h3, h4, h5, h6, [role=heading])");
    const atLevel = (level: number) => headings.filter((node) => node.role === "heading" && node.level === level).map((node) => node.name);
    expect(atLevel(3)).toEqual(view.policies.map((policy) => policy.title));
    const groups = view.policies.flatMap((policy) => policy.rules);
    expect(atLevel(4)).toEqual(groups.map((group) => `규칙 ${group.rule}`));
    const locations = groups.flatMap((group) => [...group.shown, ...group.folded]);
    const names = (await accessibleNames(context, page, ".report li.finding > details > summary")).map((name) => name.replace(/\s+/g, " ").trim());
    expect(names).toEqual(
      locations.map((location) => `${location.file}:${location.line} ${scopeLabel(location.scope)} ${STATUS_LABEL[location.status]} 규칙 ${location.rule}`),
    );
    // 같은 줄의 두 발견은 눈에 보이는 글(화면 낭독기용 규칙 이름을 뺀 글)이 같다. 이름은 서로 다르다.
    const shown = await page.locator(".report li.finding > details > summary").evaluateAll((all) =>
      all.map((el) => {
        const copy = el.cloneNode(true) as Element;
        for (const veiled of copy.querySelectorAll(".visually-hidden")) veiled.remove();
        return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
      }),
    );
    expect(new Set(shown).size).toBeLessThan(shown.length);
    expect(new Set(names).size).toBe(names.length);
    // 규칙 이름은 화면에서만 가린다(1px).
    const hidden = await page.locator(".report li.finding .visually-hidden").evaluateAll((all) => all.map((el) => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height)));
    expect(hidden).toEqual(locations.map(() => 1));
  });
});
