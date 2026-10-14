import { existsSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium, errors, type Browser, type BrowserContext, type Page } from "playwright-core";
import { root, walk } from "../helpers";

// 브라우저 시험의 바탕: 빌드된 out/ 을 127.0.0.1 의 빈 포트에 띄우고, 이 컴퓨터에 깔린 Chrome 을 헤드리스로 연다.
// 시험이 끝나면(실패해도) 띄운 서버와 브라우저를 닫는 것은 부르는 쪽의 afterAll 이 한다.
//
// 아래쪽의 openPage·settle·overflow·contrast 는 쪽을 열고 재는 준비 코드다. 조문 도감의 시험(policy.test.ts)이 쓴다.
// view.test.ts 와 demo.test.ts 는 같은 일을 하는 코드를 아직 따로 가지고 있다(docs/ROADMAP.md 의 8번에서 모은다).

export const outDir = path.join(root, "out");

/** 빌드에 들어가는 것. 이 가운데 out/ 보다 새로 고친 파일이 있으면 낡은 빌드를 보는 것이다. */
const BUILD_INPUTS = ["src", "data", ...["cli-current", "samples-v1-draft", "fixtures"].map((dir) => path.join("contract", dir))];

/** out/ 이 없거나 소스보다 낡았으면 시험을 돌리지 않고 까닭을 알린다. 낡은 빌드로 통과한 시험은 아무것도 말해 주지 않는다. */
export function assertFreshBuild(): void {
  const page = path.join(outDir, "view", "index.html");
  if (!existsSync(page)) {
    throw new Error("빌드된 out/ 이 없습니다. 브라우저 시험은 빌드 뒤에 돕니다. `npm run build` 를 먼저 돌리세요.");
  }
  const built = statSync(page).mtimeMs;
  const newer = BUILD_INPUTS.flatMap((dir) => walk(dir)).filter((file) => statSync(path.join(root, file)).mtimeMs > built);
  if (newer.length > 0) {
    throw new Error(
      `out/ 이 소스보다 낡았습니다(${newer.slice(0, 3).join(", ")}${newer.length > 3 ? " 등" : ""}). ` +
        "`npm run build` 를 다시 돌린 뒤 시험하세요.",
    );
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface Site {
  /** 예: 127.0.0.1 의 빈 포트. 끝에 "/" 가 없다. */
  origin: string;
  /** 서버가 받은 요청 전부(받은 순서). 브라우저가 알리지 않는 요청(파비콘 등)도 여기에는 남는다. */
  requests: { method: string; url: string }[];
  close(): Promise<void>;
}

/** 빌드된 out/ 을 그대로 내주는 서버. 정적 호스팅과 같게, 폴더 주소는 그 안의 index.html 을 준다. */
export async function serveOut(): Promise<Site> {
  assertFreshBuild();
  const requests: Site["requests"] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? "", url: request.url ?? "" });
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      let file = path.join(outDir, pathname);
      // out/ 밖은 내주지 않는다.
      if (file !== outDir && !file.startsWith(outDir + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
        const body = await readFile(file);
        response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        response.end(request.method === "HEAD" ? undefined : body);
      } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1 에만 연다. 포트는 비어 있는 것을 운영체제가 고른다.
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("서버 주소를 알 수 없습니다.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // 브라우저가 붙들고 있는 연결 때문에 닫히지 않고 남는 일이 없게 한다.
        server.closeAllConnections();
      }),
  };
}

/**
 * 시험용 Chrome 이 127.0.0.1 밖의 이름과 주소를 풀지 못하게 하는 옵션. 풀지 못하므로 그리로 가는 연결이 생기지 않는다.
 *
 * 쪽을 여는 창의 가로채기(`openPage` 의 route)는 HTTP 요청만 막는다. Chrome 은 새 창이 옮겨 가기 시작할 때 그 출처로
 * 연결을 먼저 열어서, 요청을 막아도 법제처 링크를 누르는 시험이 돌 때마다 그 서버로 연결(이름 풀이와 TLS)이 나갔다.
 * Chrome 이 스스로 뒤에서 여는 연결(갱신 확인 등)도 이 옵션으로 함께 멎는다. 가로채기는 전처럼 가려던 주소를 적는다.
 *
 * 이 옵션이 막지 못하는 것이 하나 있다. 창이 이름을 풀지 못해 오류 쪽을 띄우면 Chrome 은 DNS 가 살아 있는지 알아보는
 * 질의(google.com)를 실제로 내보낸다. 그래서 시험에서 창을 풀리지 않는 이름으로 옮기지 않는다(가로채기가 먼저 끊는
 * 요청은 이름 풀이까지 가지 않는다). 재어 본 것은 docs/architecture.md 의 "브라우저 시험"에 있다.
 */
const NO_OUTSIDE_NAMES = "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1";

/** Chrome 이 뜨기를 기다려 주는 시간(ms). 보통 1초 안에 뜬다. */
const LAUNCH_MS = 10_000;
/** 띄운 Chrome 이 빈 쪽 하나를 열기를 기다려 주는 시간(ms). 보통 0.2초 안에 열린다. */
const ANSWER_MS = 5_000;
/** 띄워 보는 횟수. 뜨지 못했거나 떴는데 쪽을 열지 못하면 버리고 다시 띄운다. */
const LAUNCH_TRIES = 3;

/**
 * 띄운 Chrome 이 쪽을 여는지 본다. 빈 쪽 하나를 열어 스크립트 한 줄을 돌려 보고 닫는다. `ANSWER_MS` 안에 끝나지 않으면
 * 열지 못하는 것으로 본다.
 */
async function opensPage(browser: Browser): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opened = (async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      return (await page.evaluate(() => 1 + 1)) === 2;
    } finally {
      await context.close();
    }
  })().catch(() => false);
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ANSWER_MS);
  });
  try {
    return await Promise.race([opened, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 이 컴퓨터에 깔린 Google Chrome 을 헤드리스로 연다. 브라우저를 내려받지 않는다(playwright-core 는 브라우저를 함께
 * 받지 않는다). Chrome 이 다른 자리에 있거나 Chromium 계열의 다른 브라우저를 쓰려면 CHROME_PATH 에 실행 파일을 준다.
 *
 * 열지 못하면 시험을 건너뛰지 않고 실패한다. 건너뛰면 "연 파일을 어디로도 보내지 않는다"를 보는 시험 없이
 * `npm run check` 가 통과한다.
 *
 * 떴는데 쪽을 열지 못하는 Chrome 은 버리고 다시 띄운다. 시험 파일마다 Chrome 을 하나씩, 한꺼번에 띄우는데, 그렇게 띄운
 * 것 가운데 하나가 드물게 처음부터 멈춰 있다(따로 띄운 프로세스 넷이 한꺼번에 띄우기를 되풀이해 보니 160번에 2번, CPU 를
 * 바쁘게 해 두면 400번에 4번이었다. Chrome 의 자식 프로세스 하나가 죽은 채 남고, 새 쪽도 닫기도 듣지 않는다). 그대로 두면
 * 그 파일의 시험이 하나씩 30초 한도를 채우고 실패해서, `npm run check` 가 10분 넘게 걸려 실패한다(7번에서 봤다). 띄운 뒤에
 * 빈 쪽 하나를 열어 보고, 열지 못하면 다시 띄운다. 그렇게 하니 멈춘 것을 5초 뒤에 알아채고 새로 띄운 것으로 넘어갔다
 * (docs/architecture.md 의 "브라우저 시험"). 버린 Chrome 은 닫으라고만 해 두고 기다리지 않는다. 시험 프로세스가 끝날 때
 * 함께 꺼진다. 뜨지 못한 것(시간 안에 붙지 못함)도 같은 식으로 다시 띄운다. Chrome 이 없어서 띄우지 못한 것은 다시
 * 해 보지 않고 곧바로 알린다.
 */
export async function launchChrome(): Promise<Browser> {
  const executablePath = process.env.CHROME_PATH;
  const options = { headless: true, args: [NO_OUTSIDE_NAMES], timeout: LAUNCH_MS };
  const stuck: string[] = [];
  for (;;) {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch(executablePath ? { ...options, executablePath } : { ...options, channel: "chrome" });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) {
        throw new Error(
          "브라우저 시험에 쓸 Chrome 을 열지 못했습니다. Google Chrome 을 설치하거나, Chrome·Chromium 실행 파일의 경로를 " +
            "CHROME_PATH 환경 변수로 주세요. 이 시험은 건너뛰지 않습니다(docs/architecture.md 의 \"브라우저 시험\").",
          { cause: error },
        );
      }
      stuck.push("뜨지 못함");
    }
    if (browser !== null) {
      if (await opensPage(browser)) {
        // 다시 띄운 일이 있으면 시험의 출력에 한 줄 남긴다. 실패는 아니다. 얼마나 잦은지 알아보는 데 쓴다. 시험 도구는
        // 통과한 시험의 console 출력을 보이지 않아서 표준 오류에 바로 적는다.
        if (stuck.length > 0) process.stderr.write(`시험용 Chrome 을 다시 띄웠습니다(${stuck.join(", ")}).\n`);
        return browser;
      }
      stuck.push("쪽을 열지 못함");
      void browser.close().catch(() => undefined);
    }
    if (stuck.length === LAUNCH_TRIES) {
      throw new Error(
        `시험용 Chrome 을 ${LAUNCH_TRIES}번 띄웠지만 쓸 수 없었습니다(${stuck.join(", ")}). 다른 작업으로 컴퓨터가 바쁜지 ` +
          "확인하고 다시 돌려 보세요.",
      );
    }
  }
}

export interface Opened {
  context: BrowserContext;
  page: Page;
  /**
   * 이 사이트 밖으로 나가려던 HTTP 요청과, 열려던 WebSocket(어디로 가든). 막은 뒤 여기에 적는다. 막는 것은 요청이다.
   * 그 출처로 가는 연결이 생기지 않게 하는 것은 Chrome 을 띄울 때의 옵션이다(`NO_OUTSIDE_NAMES`).
   */
  outside: string[];
}

export interface OpenOptions {
  viewport?: { width: number; height: number };
  /** 테마는 운영체제 설정을 따른다(`prefers-color-scheme`). 어두운 테마는 그 설정을 흉내 내어 본다. */
  colorScheme?: "light" | "dark";
  /** 연 창을 적어 둘 곳. 부르는 쪽이 시험이 끝나면(실패해도) 닫는다. */
  contexts: BrowserContext[];
  /** 쪽에서 난 오류(잡히지 않은 예외, 콘솔의 오류 줄)를 적어 둘 곳. 부르는 쪽이 시험마다 비어 있는지 본다. */
  problems: string[];
}

/**
 * 새 창에서 쪽을 연다. 스크립트가 붙고, 쪽이 스스로 내는 요청(묶음, 머리 링크의 프리페치)이 끝날 때까지 기다린다.
 * 그 창에서 뜨는 새 탭의 요청도 같은 방법으로 가로챈다.
 */
export async function openPage(browser: Browser, site: Site, pathname: string, options: OpenOptions): Promise<Opened> {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 720 },
    colorScheme: options.colorScheme ?? "light",
  });
  options.contexts.push(context);
  // 기다리는 일은 10초까지만 한다. 시험 하나의 한도(30초)보다 먼저 끝나야 무엇을 기다리다 실패했는지가 남는다.
  context.setDefaultTimeout(10_000);
  const outside: string[] = [];
  await context.route(
    () => true,
    (route) => {
      const url = route.request().url();
      if (url.startsWith(`${site.origin}/`)) return route.continue();
      outside.push(url);
      return route.abort();
    },
  );
  // WebSocket 은 위의 route 가 다루지 않는다. 따로 가로챈다. 정적 사이트라 받을 곳이 없으므로 어디로 가는 것이든 적는다.
  await context.routeWebSocket(
    () => true,
    (ws) => {
      outside.push(ws.url());
      void ws.close();
    },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => options.problems.push(`예외: ${error.message}`));
  page.on("console", (message) => {
    // 파비콘이 아직 없어서 브라우저가 스스로 청한 /favicon.ico 가 404 로 돌아온다(ROADMAP 9번). 그 한 줄은 뺀다.
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) options.problems.push(`콘솔: ${message.text()}`);
  });
  await page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
  return { context, page, outside };
}

/** 서버가 받는 요청이 한동안 더 없을 때까지 기다린다. */
export async function settle(site: Site, page: Page): Promise<void> {
  for (let seen = -1; seen !== site.requests.length; ) {
    seen = site.requests.length;
    await page.waitForTimeout(400);
  }
}

/**
 * 쪽이 가로로 넘치는지 잰다. 쪽 너비만이 아니라 본문 칸의 오른쪽 끝도 본다. 본문 안의 것이 칸을 넓히면 쪽은 넘치지
 * 않아도 오른쪽 여백이 사라진다. 화면에 보이지 않게 둔 글(화면 낭독기용)과 크기가 0인 것은 재지 않는다.
 *
 * 닫힌 details 안의 것은 함께 재진다. Chrome 154 는 그 안을 그리지만 않고 상자는 펼쳤을 때의 크기로 잡아 둔다
 * (닫힌 조문 원문 상자가 375px 에서 335×2398px 로 읽혔다).
 */
export async function overflow(page: Page): Promise<{ page: number; limit: number; over: string[] }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main.wrap")!;
    const limit = main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight);
    const over: string[] = [];
    for (const el of main.querySelectorAll("*")) {
      if (el.closest(".visually-hidden")) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > limit + 0.5) over.push(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(box.right)}`);
    }
    return { page: doc.scrollWidth - doc.clientWidth, limit: Math.round(limit), over: over.slice(0, 5) };
  });
}

/** 두 색의 명도 대비(WCAG 2 의 식). 색은 브라우저가 계산한 "rgb(…)" 꼴이다. 비치는 색은 재지 않는다(실패한다). */
export function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g);
    if (!color.startsWith("rgb") || !channels || channels.length < 3) throw new Error(`색을 읽지 못했습니다: ${color}`);
    if (channels.length > 3 && Number(channels[3]) !== 1) throw new Error(`비치는 색입니다: ${color}`);
    const [r, g, bl] = channels.slice(0, 3).map((value) => {
      const c = Number(value) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
