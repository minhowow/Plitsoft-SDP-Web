import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { root, walk } from "../helpers";

// 브라우저 시험의 바탕: 빌드된 out/ 을 127.0.0.1 의 빈 포트에 띄우고, 이 컴퓨터에 깔린 Chrome 을 헤드리스로 연다.
// 시험이 끝나면(실패해도) 띄운 서버와 브라우저를 닫는 것은 부르는 쪽의 afterAll 이 한다(`closeChrome`).
//
// 아래쪽은 쪽을 열고 재는 준비 코드다. 시험 파일 넷(view·demo·policy·record)이 함께 쓴다: 창을 만들며 요청을 가로채고
// 오류를 적는 것(`newPage`. 시험이 쓰는 창은 모두 이것으로 만든다), 그 창에서 쪽을 여는 것(`openPage`), 요청이 잦아들기를
// 기다리는 것(`settle`), 넘침(`overflow`), 명도 대비(`contrast`), 브라우저 저장소(`stored`), 끝까지 내리기(`scrollThrough`),
// 글이 그려지는지(`undrawn`), CSS 가 그린 글(`cssDrawn`), Chrome 의 접근성 트리에 드러나는 role 과 이름(`accessibleNodes`,
// `accessibleNames`).

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
  /**
   * 서버가 받은 요청 전부(받은 순서). 브라우저가 알리지 않는 요청(파비콘 등)도 여기에는 남는다. `status` 는 서버가 돌려준
   * 응답의 상태(응답하기 전에는 0).
   */
  requests: { method: string; url: string; status: number }[];
  close(): Promise<void>;
}

/** 빌드된 out/ 을 그대로 내주는 서버. 정적 호스팅과 같게, 폴더 주소는 그 안의 index.html 을 준다. */
export async function serveOut(): Promise<Site> {
  assertFreshBuild();
  const requests: Site["requests"] = [];
  const server = createServer((request, response) => {
    const entry = { method: request.method ?? "", url: request.url ?? "", status: 0 };
    requests.push(entry);
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      let file = path.join(outDir, pathname);
      // out/ 밖은 내주지 않는다.
      if (file !== outDir && !file.startsWith(outDir + path.sep)) {
        entry.status = 403;
        response.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
        const body = await readFile(file);
        entry.status = 200;
        response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        response.end(request.method === "HEAD" ? undefined : body);
      } catch {
        entry.status = 404;
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
 * 쪽을 여는 창의 가로채기(`newPage` 의 route)는 HTTP 요청만 막는다. Chrome 은 새 창이 옮겨 가기 시작할 때 그 출처로
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
/** 시험이 끝나고 Chrome 이 닫히기를 기다려 주는 시간(ms). 보통 0.1초 안에 닫힌다. 넘으면 프로세스를 끈다. */
const CLOSE_MS = 5_000;

/**
 * 시험용 Chrome 의 임시 폴더를 모아 두는 폴더의 이름 앞부분. 뒤에 이 시험 프로세스의 번호(pid)와 아무 글자가 붙는다.
 *
 * playwright-core 는 Chrome 을 띄울 때마다 운영체제의 임시 폴더에 프로필(`playwright_chromiumdev_profile-*`)과 내려받기
 * 폴더(`playwright-artifacts-*`)를 만들고, Chrome 이 닫히면 지운다. 지우기 전에 시험 프로세스가 강제로(SIGKILL) 끝나면
 * 남는다(사본에서 시험 파일 하나를 돌리다 끄니 둘이 하나씩 남았다). 시험 도구도 시험 파일을 마친 프로세스를 SIGTERM 으로
 * 끄고 0.5초 뒤에 SIGKILL 로 끈다. 7번까지 임시 폴더에 프로필 13개와 내려받기 폴더 14개가 남았다.
 *
 * 그래서 띄우는 동안만 이 프로세스의 임시 폴더(TMPDIR)를 이 폴더로 돌려, 두 폴더가 여기 생기게 한다(Chrome 에게는 원래의
 * 임시 폴더를 준다). 시험 파일이 끝나면 `closeChrome` 이 이 폴더를 통째로 지운다. 그 전에 프로세스가 죽으면 다음에 Chrome 을
 * 띄울 때 지운다(`sweepChromeTmp`).
 */
const CHROME_TMP = "policypack-chrome-";

/** 이 프로세스의 그 폴더. 처음 띄울 때 만든다. */
let chromeTmp: string | null = null;

function ownChromeTmp(): string {
  if (chromeTmp === null) {
    sweepChromeTmp();
    chromeTmp = mkdtempSync(path.join(tmpdir(), `${CHROME_TMP}${process.pid}-`));
  }
  return chromeTmp;
}

/** 그 프로세스가 살아 있는지. 다른 사용자의 프로세스라 신호를 보낼 수 없으면 살아 있는 것으로 본다. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * 그 폴더 아래의 프로필로 뜬 Chrome 프로세스(자식 프로세스까지). 명령줄의 `--user-data-dir` 로 찾는다. 폴더 이름에 이
 * 프로세스의 번호와 아무 글자가 들어 있어서, 다른 시험 파일이나 사람이 쓰는 Chrome 은 걸리지 않는다. `ps` 가 없는
 * 운영체제에서는 찾지 못한다(빈 목록).
 */
function chromesUsing(dir: string): number[] {
  let listing = "";
  try {
    // 출력이 터미널이 아니면 명령줄을 자르지 않는다.
    listing = execFileSync("ps", ["-A", "-o", "pid=", "-o", "args="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return [];
  }
  const mark = `--user-data-dir=${dir}${path.sep}`;
  return listing
    .split("\n")
    .filter((line) => line.includes(mark))
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

/** 그 폴더의 프로필로 뜬 Chrome 을 모두 끈다(SIGKILL). */
function killChromesUsing(dir: string): void {
  for (const pid of chromesUsing(dir)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 그새 꺼졌다.
    }
  }
}

function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}

/**
 * 죽은 시험 프로세스가 남긴 폴더(`CHROME_TMP`)를 지운다. 그 폴더의 프로필로 떠 있는 Chrome 이 있으면(주인 프로세스가 죽어
 * 홀로 남은 것) 먼저 끈다. 살아 있는 프로세스의 것(나란히 도는 다른 시험)은 건드리지 않는다.
 */
function sweepChromeTmp(): void {
  const base = tmpdir();
  for (const name of readdirSync(base)) {
    const owner = new RegExp(`^${CHROME_TMP}(\\d+)-`).exec(name)?.[1];
    if (owner === undefined || alive(Number(owner))) continue;
    const dir = path.join(base, name);
    killChromesUsing(dir);
    removeDir(dir);
  }
}

/** 이 프로세스의 그 폴더를 임시 폴더로 삼아 Chrome 을 띄운다. 띄우는 동안만 돌리고 곧 되돌린다. */
async function launchInto(dir: string): Promise<Browser> {
  const executablePath = process.env.CHROME_PATH;
  // Chrome 에게는 원래의 환경(임시 폴더)을 준다. 돌리는 것은 playwright-core 가 두 폴더를 만드는 자리뿐이다.
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const options = { headless: true, args: [NO_OUTSIDE_NAMES], timeout: LAUNCH_MS, env };
  const outer = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    return await chromium.launch(executablePath ? { ...options, executablePath } : { ...options, channel: "chrome" });
  } finally {
    if (outer === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = outer;
  }
}

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
 * 다 쓰면 `closeChrome` 으로 닫는다(임시 폴더까지 지운다).
 *
 * 열지 못하면 시험을 건너뛰지 않고 실패한다. 건너뛰면 "연 파일을 어디로도 보내지 않는다"를 보는 시험 없이
 * `npm run check` 가 통과한다.
 *
 * 떴는데 쪽을 열지 못하는 Chrome 은 버리고 다시 띄운다. 시험 파일마다 Chrome 을 하나씩, 한꺼번에 띄우는데, 그렇게 띄운
 * 것 가운데 하나가 드물게 처음부터 멈춰 있다(따로 띄운 프로세스 넷이 한꺼번에 띄우기를 되풀이해 보니 160번에 2번, CPU 를
 * 바쁘게 해 두면 400번에 4번이었다. Chrome 의 자식 프로세스 하나가 죽은 채 남고, 새 쪽도 닫기도 듣지 않는다). 그대로 두면
 * 그 파일의 시험이 하나씩 30초 한도를 채우고 실패해서, `npm run check` 가 10분 넘게 걸려 실패한다(7번에서 봤다). 띄운 뒤에
 * 빈 쪽 하나를 열어 보고, 열지 못하면 다시 띄운다. 그렇게 하니 멈춘 것을 5초 뒤에 알아채고 새로 띄운 것으로 넘어갔다
 * (docs/architecture.md 의 "브라우저 시험"). 버린 Chrome 은 닫으라고 해 두고 그 프로세스를 곧바로 끈다(8번). 멈춘 것은
 * 닫기를 듣지 않아서, 그대로 두면 시험 프로세스가 끝날 때까지 떠 있고 시험 프로세스가 강제로 끝나면 홀로 남는다(7번에서
 * 셋을 손으로 껐다). 뜨지 못한 것(시간 안에 붙지 못함)도 같은 식으로 다시 띄운다. Chrome 이 없어서 띄우지 못한 것은 다시
 * 해 보지 않고 곧바로 알린다.
 */
export async function launchChrome(): Promise<Browser> {
  const dir = ownChromeTmp();
  const stuck: string[] = [];
  for (;;) {
    let browser: Browser | null = null;
    try {
      browser = await launchInto(dir);
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) {
        throw new Error(
          "브라우저 시험에 쓸 Chrome 을 열지 못했습니다. Google Chrome 을 설치하거나, Chrome·Chromium 실행 파일의 경로를 " +
            "CHROME_PATH 환경 변수로 주세요. 이 시험은 건너뛰지 않습니다(docs/architecture.md 의 \"브라우저 시험\").",
          { cause: error },
        );
      }
      stuck.push("뜨지 못함");
      killChromesUsing(dir);
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
      // 아직 다음 것을 띄우기 전이라, 이 폴더의 프로필로 떠 있는 것은 버린 이것뿐이다.
      killChromesUsing(dir);
    }
    if (stuck.length === LAUNCH_TRIES) {
      throw new Error(
        `시험용 Chrome 을 ${LAUNCH_TRIES}번 띄웠지만 쓸 수 없었습니다(${stuck.join(", ")}). 다른 작업으로 컴퓨터가 바쁜지 ` +
          "확인하고 다시 돌려 보세요.",
      );
    }
  }
}

/**
 * `launchChrome` 으로 띄운 Chrome 을 닫고, 이 프로세스의 임시 폴더(프로필, 내려받기 폴더)를 지운다. 시험 파일의 afterAll 이
 * 부른다. 닫히기를 `CLOSE_MS` 까지 기다리고, 그래도 떠 있는 것(버린 것까지)은 끈다. 띄우지 못했으면(`browser` 가 없으면)
 * 폴더만 지운다.
 */
export async function closeChrome(browser: Browser | undefined): Promise<void> {
  try {
    if (browser) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_MS);
      });
      await Promise.race([browser.close().catch(() => undefined), late]);
      clearTimeout(timer);
    }
  } finally {
    if (chromeTmp !== null) {
      killChromesUsing(chromeTmp);
      removeDir(chromeTmp);
      chromeTmp = null;
    }
  }
}

/**
 * 기다리는 일 가운데 시험 도구가 시간 한도를 두지 않는 것(쪽 안에서 스크립트 돌리기, 창에 가로채기를 거는 것, 요청이
 * 잦아들기)에 주는 한도(ms). 시험 하나의 한도(30초)보다 먼저 끝나야 무엇을 기다리다 실패했는지가 남는다. 이 파일의 공용
 * 함수에만 건다(`within`). 시험 본문이 직접 부르는 것은 아래 `STALL_MS` 가 받친다.
 */
const WAIT_MS = 10_000;

/**
 * 창 하나를 쓰는 시간의 한도(ms). 창을 연 지 이만큼 지나도 닫히지 않으면(시험이 끝나지 않으면) `newPage` 가 그 창을 닫는다.
 *
 * 쪽 안에서 스크립트를 돌리는 호출(page.evaluate, locator 의 evaluate·evaluateAll·allInnerTexts·count 등)은 시험 도구가
 * 한도를 두지 않는다. 시험 본문에 파일마다 수십 곳이 있고, 쪽이 멈추면 시험 하나의 한도(30초)를 채운 뒤 어디서 멈췄는지
 * 남기지 않고 실패한다(8번을 하는 동안 결과 화면의 첫 시험이 한 번 그랬다). 창을 닫으면 멈춰 있던 호출이 "Target page,
 * context or browser has been closed" 로 끝나고, 그 오류에 호출의 이름(예: page.evaluate)과 시험 파일의 줄이 남는다(사본에서
 * 끝나지 않는 스크립트와 도는 채 멈춘 쪽으로 봤다. 닫고 1초 안에 끝났다. 시험 하나의 한도가 오기 전이다).
 *
 * 시험 하나의 한도(30초)에 가깝게 둔다. 이 한도는 느리게 도는 시험도 끊는다. 가장 오래 걸리는 시험(조문 도감의 "맨 아래까지
 * 내리고, 접어 둔 것을 모두 펼치고 …")이 창 하나로 13~16초다. 그 시험은 이 한도가 없을 때 30초까지 쓸 수 있었다.
 */
const STALL_MS = 28_000;

/**
 * `work` 가 `WAIT_MS` 안에 끝나지 않으면 `what` 을 적어 실패한다. 쪽이 멈추면(스크립트가 돌지 않으면) 시험 도구는 끝없이 기다린다.
 * 오류는 부를 때 만들어 둔다. 그래야 그 오류의 자취(stack)에 부른 자리(시험 파일의 줄)가 남는다.
 */
async function within<T>(what: string, work: Promise<T>): Promise<T> {
  const stalled = new Error(`${what}: ${WAIT_MS / 1000}초 안에 끝나지 않았습니다(쪽이 답하지 않습니다).`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(stalled), WAIT_MS);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Opened {
  context: BrowserContext;
  page: Page;
  /**
   * 이 사이트 밖으로 나가려던 HTTP 요청과, 열려던 WebSocket(어디로 가든). 막은 뒤 여기에 적는다. 막는 것은 요청이다.
   * 그 출처로 가는 연결이 생기지 않게 하는 것은 Chrome 을 띄울 때의 옵션이다(`NO_OUTSIDE_NAMES`). HTTP 도 WebSocket 도 아닌
   * 길로 밖과 이을 수 있는 생성자(`UNROUTED`)를 쪽에서 부른 것도 막고 여기에 적는다.
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
  /**
   * 이 사이트 밖으로 나가려는 HTTP 요청과 WebSocket 을 가로채는지. 기본은 가로챈다. 끄는 것은 시험용 Chrome 이 바깥 이름을
   * 풀지 못한다는 것을 보는 시험뿐이다(가로채기가 먼저 끊으면 그 옵션이 듣는지 알 수 없다). 꺼도 생성자 감싸기, 오류 적기,
   * 창을 쓰는 시간의 한도는 그대로다.
   */
  intercept?: boolean;
}

/**
 * HTTP 요청도 WebSocket 도 아닌 길로 밖과 이을 수 있는 생성자. 위의 가로채기(route)는 이것들이 여는 연결을 보지 못한다.
 * WebRTC(`RTCPeerConnection`)는 이름 풀이 없이 숫자로 적은 주소로 UDP·TCP 를 연다. 4번에서 연 결과를 127.0.0.1 의 수신기로
 * 보내는 줄을 넣어 보니 시험은 통과했고 수신기에는 연결이 닿았다. WebTransport 도 같은 길이다. 워커(`Worker`,
 * `SharedWorker`)는 그 안에서 여는 연결을 쪽에 넣은 스크립트가 보지 못하므로, 워커를 만드는 것부터 적는다. 사이트는 이
 * 가운데 어느 것도 쓰지 않는다.
 */
const UNROUTED = ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport", "Worker", "SharedWorker"];

/**
 * 새 창과 그 안의 새 탭을 만든다. 쪽은 열지 않는다(주소로 여는 것은 `openPage`. 다른 때에 열어야 하는 시험은 돌려받은 탭으로
 * 연다). 시험이 쓰는 창은 모두 이것으로 만든다. 그래서 아래가 어느 시험에서든 걸린다. 그 창에서 뜨는 새 탭에도 가로채기와
 * 감싸기는 걸린다.
 *
 * - 이 사이트 밖으로 나가려는 HTTP 요청과 WebSocket(어디로 가든)을 막고 `outside` 에 적는다(`intercept` 가 false 면 걸지 않는다).
 * - 쪽의 스크립트보다 먼저 `UNROUTED` 의 생성자를 감싼다. 쪽에서 부르면 만들지 않고 예외를 던지며, 무엇을 불렀는지 `outside`
 *   와 `problems` 에 적는다. 그래서 불리면 그 시험이 실패한다(시험마다 `problems` 가 비어 있는지 본다).
 * - 쪽에서 난 오류(잡히지 않은 예외, 콘솔의 오류 줄)를 `problems` 에 적는다(새 탭의 것은 적지 않는다).
 * - 창을 연 지 `STALL_MS` 가 지나도 닫히지 않으면 창을 닫고 `problems` 에 적는다.
 */
export async function newPage(browser: Browser, site: Site, options: OpenOptions): Promise<Opened> {
  const context = await within(
    "새 창 만들기",
    browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 720 },
      colorScheme: options.colorScheme ?? "light",
    }),
  );
  options.contexts.push(context);
  // 기다리는 일은 10초까지만 한다. 시험 하나의 한도(30초)보다 먼저 끝나야 무엇을 기다리다 실패했는지가 남는다.
  context.setDefaultTimeout(10_000);
  // 한도가 없는 호출이 멈춰 있으면 창을 닫아 그 호출이 제 이름과 줄을 적고 끝나게 한다(`STALL_MS`). 창이 닫히면 거둔다.
  const stall = setTimeout(() => {
    options.problems.push(
      `창을 연 지 ${STALL_MS / 1000}초가 지나도 시험이 끝나지 않아 창을 닫았습니다. 멈춰 있던 호출과 그 줄은 그 호출의 오류("…has been closed")에 있습니다.`,
    );
    void context.close().catch(() => undefined);
  }, STALL_MS);
  stall.unref();
  context.on("close", () => clearTimeout(stall));
  const outside: string[] = [];
  if (options.intercept ?? true) {
    await within(
      "요청 가로채기 걸기",
      context.route(
        () => true,
        (route) => {
          const url = route.request().url();
          if (url.startsWith(`${site.origin}/`)) return route.continue();
          outside.push(url);
          return route.abort();
        },
      ),
    );
    // WebSocket 은 위의 route 가 다루지 않는다. 따로 가로챈다. 정적 사이트라 받을 곳이 없으므로 어디로 가는 것이든 적는다.
    // 가로챈 연결은 서버에 닿지 않는다(이어 주지 않고 닫는다). 쪽을 만들기 전에 걸어야 한다.
    await within(
      "WebSocket 가로채기 걸기",
      context.routeWebSocket(
        () => true,
        (ws) => {
          outside.push(ws.url());
          void ws.close();
        },
      ),
    );
  }
  await within(
    "생성자 감싸기 걸기",
    context.exposeBinding("__unroutedCall", (_source, call: string) => {
      outside.push(call);
      options.problems.push(`밖과 이을 수 있는 생성자를 불렀습니다(시험이 막았다): ${call}`);
    }),
  );
  await within("생성자 감싸기 걸기", context.addInitScript((names: string[]) => {
    const scope = window as unknown as Record<string, unknown> & { __unroutedCall?: (call: string) => unknown };
    for (const name of names) {
      if (typeof scope[name] !== "function") continue;
      const blocked = function (...args: unknown[]) {
        let first = "";
        try {
          first = JSON.stringify(args[0]) ?? "";
        } catch {
          first = String(args[0]);
        }
        void scope.__unroutedCall?.(`${name} ${first}`.trim());
        throw new DOMException(`시험이 막았습니다: ${name}`, "NotAllowedError");
      };
      Object.defineProperty(window, name, { configurable: true, writable: true, value: blocked });
    }
  }, UNROUTED));
  const page = await within("새 탭 열기", context.newPage());
  page.on("pageerror", (error) => options.problems.push(`예외: ${error.message}`));
  // 콘솔의 오류 줄은 모두 적는다. 9번 전에는 파비콘이 없어 브라우저가 스스로 청한 /favicon.ico 가 404 로 돌아와 그 한 줄을
  // 뺐다. 9번에서 파비콘(src/app/favicon.ico)을 두고 봐주던 것을 걷었다. 그 404 가 다시 나면 어느 시험에서든 실패한다.
  page.on("console", (message) => {
    if (message.type() === "error") options.problems.push(`콘솔: ${message.text()}`);
  });
  return { context, page, outside };
}

/**
 * 새 창에서(`newPage`) 쪽을 연다. 스크립트가 붙고, 쪽이 스스로 내는 요청(묶음, 머리 링크의 프리페치)이 끝날 때까지 기다린다.
 */
export async function openPage(browser: Browser, site: Site, pathname: string, options: OpenOptions): Promise<Opened> {
  const opened = await newPage(browser, site, options);
  await opened.page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
  return opened;
}

/** 서버가 받는 요청이 한동안(0.4초) 더 없을 때까지 기다린다. `WAIT_MS` 가 지나도 요청이 이어지면 실패한다. */
export async function settle(site: Site, page: Page): Promise<void> {
  const started = Date.now();
  for (let seen = -1; seen !== site.requests.length; ) {
    if (Date.now() - started > WAIT_MS) {
      throw new Error(`요청이 ${WAIT_MS / 1000}초 동안 잦아들지 않았습니다. 마지막 요청: ${site.requests.slice(-3).map((request) => request.url).join(", ")}`);
    }
    seen = site.requests.length;
    await page.waitForTimeout(400);
  }
}

/** 맨 위에서 맨 아래까지 한 화면씩 내린다. 링크와 접어 둔 것이 차례로 화면에 들어온다. `pause` 는 한 번 내릴 때마다 기다리는 시간(ms). */
export async function scrollThrough(page: Page, pause = 40): Promise<void> {
  await within("맨 위로 올리기", page.evaluate(() => window.scrollTo(0, 0)));
  for (let bottom = false, steps = 0; !bottom; steps++) {
    if (steps > 200) throw new Error("200번 내려도 쪽의 맨 아래에 닿지 않았습니다.");
    bottom = await within(
      "한 화면 내리기",
      page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8);
        return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
      }),
    );
    await page.waitForTimeout(pause);
  }
}

/** 브라우저 저장소에 든 것의 수. 연 결과도 고른 것도 메모리에만 둔다(docs/commitments.md 의 1층). */
export const stored = (page: Page) =>
  within(
    "브라우저 저장소 읽기",
    page.evaluate(async () => ({
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      cookie: document.cookie,
      indexedDB: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
    })),
  );

/** 비어 있는 브라우저 저장소. */
export const NO_STORAGE = { localStorage: 0, sessionStorage: 0, cookie: "", indexedDB: 0, caches: 0 };

/**
 * 쪽이 가로로 넘치는지 잰다. 쪽 너비만이 아니라 본문 칸의 오른쪽 끝도 본다. 본문 안의 것이 칸을 넓히면 쪽은 넘치지
 * 않아도 오른쪽 여백이 사라진다(320px 에서 예시 고르기 상자가 그랬다). 화면에 보이지 않게 둔 글(화면 낭독기용)과 크기가
 * 0인 것은 재지 않는다.
 *
 * 닫힌 details 안의 것도 함께 잰다. Chrome 은 그 안을 그리지만 않고 상자는 펼쳤을 때의 크기로 잡아 둔다(닫힌 조문 원문
 * 상자가 375px 에서 335×2398px 로 읽혔다. 8번에서 Chrome 155 로 다시 봤다). 그래서 닫힌 채로 재도 펼쳤을 때 넘칠 것이 걸린다.
 *
 * `scrollers` 는 제 안에서 가로로 밀리는 스크롤 상자다(데모의 코드 상자). 그 안의 것은 상자에 가려지므로 재지 않고, 상자
 * 자신은 잰다.
 */
export async function overflow(page: Page, scrollers = ""): Promise<{ page: number; limit: number; over: string[] }> {
  return within(
    "넘침 재기",
    page.evaluate((inner) => {
      const doc = document.documentElement;
      const main = document.querySelector("main.wrap")!;
      const limit = main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight);
      const over: string[] = [];
      for (const el of main.querySelectorAll("*")) {
        if (el.closest(".visually-hidden") || (inner !== "" && el.parentElement?.closest(inner))) continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.right > limit + 0.5) over.push(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(box.right)}`);
      }
      return { page: doc.scrollWidth - doc.clientWidth, limit: Math.round(limit), over: over.slice(0, 5) };
    }, scrollers),
  );
}

/** 창의 네모 하나(창 기준 CSS px)를 찍은 그림(PNG)을 풀어 점마다의 색 [r, g, b] 를 줄 차례로 돌려준다. */
async function pixelsIn(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<[number, number, number][]> {
  const png = await page.screenshot({ clip });
  const data: Buffer[] = [];
  let header: Buffer | null = null;
  // 8바이트 서명 뒤에 덩어리(길이, 이름, 내용, 검사 값)가 이어진다.
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const name = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") header = body;
    if (name === "IDAT") data.push(body);
    at += 12 + length;
  }
  // 깊이 8비트, 색 형식 RGB(2) 또는 RGBA(6), 엇걸기 없음만 읽는다. 그 밖의 그림이면 읽는 법이 틀린 것이다.
  if (header === null || header[8] !== 8 || ![2, 6].includes(header[9]) || header[12] !== 0) throw new Error("찍은 그림을 읽지 못했습니다.");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const size = header[9] === 6 ? 4 : 3;
  const stride = width * size;
  const raw = inflateSync(Buffer.concat(data));
  const out = Buffer.alloc(height * stride);
  // 줄마다 맨 앞의 거르개(filter) 한 바이트를 보고 그 줄의 값을 되돌린다(PNG 의 다섯 거르개).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= size ? out[y * stride + x - size] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= size && y > 0 ? out[(y - 1) * stride + x - size] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter];
      if (add === undefined) throw new Error(`모르는 거르개입니다: ${filter}`);
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + add) & 0xff;
    }
  }
  return Array.from({ length: width * height }, (_, i) => [out[i * size], out[i * size + 1], out[i * size + 2]]);
}

/**
 * 창의 한 점에 실제로 칠해진 색("rgb(r, g, b)"). 그 점 하나만 찍은 그림(PNG)을 풀어 읽는다. 브라우저가 계산한 꾸밈
 * (`getComputedStyle`)이 아니라 그려진 결과라서, 그림자로 편 칠처럼 꾸밈의 값만으로는 알 수 없는 것을 본다. 좌표는 창
 * 기준(CSS px)이다. 새 의존성 없이 Node 의 zlib 로 푼다.
 */
export async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const [[r, g, b]] = await pixelsIn(page, { x, y, width: 1, height: 1 });
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 창의 네모 하나(창 기준 CSS px)에 실제로 칠해진 점들 가운데 가장 밝은 점과 가장 어두운 점의 명도 대비. 글자 상자를 주면
 * 글자가 바탕과 갈려 보이게 그려졌는지를 본다(글자의 획과 바탕). 글자가 바탕과 같은 색으로 칠해졌으면 1 에 가깝다.
 * 계산된 꾸밈이 아니라 그려진 결과다(예: 강제 색 모드에서 브라우저가 글자 뒤에 까는 바탕은 계산된 꾸밈에 드러나지 않는다).
 */
export async function inkContrast(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const luminance = ([r, g, b]: [number, number, number]) =>
    [r, g, b]
      .map((v) => v / 255)
      .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const values = (await pixelsIn(page, clip)).map(luminance);
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
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

/** 명도 대비가 모자란 글자 조각 하나. */
export interface LowContrast {
  /** 그 글이 든 요소(`태그.class`, CSS 가 그린 글이면 뒤에 `::before` 등, 입력 부품이면 그 이름). */
  what: string;
  /** 글의 앞 24자. */
  text: string;
  color: string;
  /** 그 글 뒤에 실제로 깔린 바탕(비치는 조상의 바탕을 겹쳐 셈한 색). `paper` 를 준 재기에서는 종이의 색일 수도 있다. */
  background: string;
  ratio: number;
}

export interface ContrastScan {
  /** 잰 글자 조각의 수(글 조각, CSS 가 그린 글, 목록 표시, 입력 부품의 글). */
  measured: number;
  /** 기준에 못 미친 것. 앞의 열 개만. */
  low: LowContrast[];
  /** 기준에 못 미친 것의 수(모두). */
  lowCount: number;
  /** 잰 것 가운데 가장 낮은 대비. */
  lowest: number;
  /** 그려진 상태 칩의 상태(`chip-<상태>` 의 <상태>). */
  chips: string[];
}

export interface ContrastOptions {
  /** 볼 곳(선택자). 기본은 쪽 전체(body). */
  root?: string;
  /** 기준 명도 대비. 기본 4.5. 큰 글자라고 낮추지 않는다. */
  minimum?: number;
  /**
   * 종이의 색("rgb(255, 255, 255)"). 주면 계산된 바탕과 함께 이 색 위에서도 잰다(둘 가운데 낮은 쪽). 브라우저는 바탕색을
   * 찍지 않는 것이 기본이라, 인쇄물의 글자는 흰 종이 위에 놓인다.
   */
  paper?: string;
}

/**
 * 그려진 글자 조각마다 글자색과 그 뒤에 실제로 깔린 바탕색의 명도 대비(WCAG 2 의 식)를 잰다. 쪽마다 한 번의 evaluate 다.
 *
 * - 잰 것: 그려진 글 조각(텍스트 노드)마다 그 요소의 글자색. CSS 가 그린 글(`::before`·`::after` 의 content 가 글인 것)과 목록
 *   표시(`::marker`. 접어 둔 것의 세모, 목록의 점과 번호)도 글자로 잰다. 고르기 상자의 보이는 글, 파일 입력의 글과 그 단추도.
 *   글자를 칠하는 색(`-webkit-text-fill-color`)이 글자색과 다르면 칠하는 색으로 잰다(실제로 그 색이 칠해진다).
 * - 바탕: 그 요소에서 문서의 뿌리까지 조상의 바탕색을 아래에서부터 겹쳐 셈한다. 비치는 바탕(알파가 1보다 작은 색)과 흐리게 한
 *   조상(opacity)도 겹친다. 뿌리가 비치면 테마의 기본 바탕(밝음: 흰색, 어두움: Chrome 의 어두운 바탕) 위에 겹친다. CSS 가 그린
 *   글은 그 가상 요소의 opacity 도 곱한다.
 * - 셈할 수 없는 것은 "색을 읽지 못함"으로 실패한다: 글자색이나 바탕색을 읽지 못한 것, 그 요소나 조상(CSS 가 그린 글이면 그
 *   가상 요소도)에 필터(`filter`, `backdrop-filter`)나 섞어 그리기(`mix-blend-mode`)가 걸린 것. 그런 꾸밈은 그려지는 색을 바꾸는데
 *   계산된 색에는 드러나지 않는다(9번의 첫 검토에서, 정책 카드를 `filter: opacity(.35)` 로 흐려도 이 재기가 통과했다). 사이트는
 *   이 셋을 쓰지 않는다.
 * - 빼는 것: 그려지지 않는 글(display·visibility·content-visibility, 닫힌 details 의 안), 일부러 가린 글(1px 로 자른 상자 안.
 *   화면 낭독기용 글과 좁은 화면의 칸 머리), 빈칸뿐인 글, `<option>` 의 글(고르기 상자가 보이는 글로 잰다).
 * - 보지 못하는 것: 바탕 그림(이 사이트는 쓰지 않는다), 다른 요소가 위에 겹친 글(조상이 아닌 요소의 바탕은 셈하지 않는다).
 */
export const textContrast = (page: Page, options: ContrastOptions = {}) =>
  within(
    "명도 대비 재기",
    page.evaluate(
      ({ root, minimum, paper }) => {
        type Rgba = [number, number, number, number];
        const parse = (color: string): Rgba | null => {
          const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(color.trim());
          if (!m) return null;
          const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
          return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
        };
        /** 위의 색을 아래(불투명)의 색 위에 겹친다. */
        const over = (top: Rgba, bottom: Rgba): Rgba => {
          const a = top[3];
          return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
        };
        const show = (c: Rgba) => `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(", ")})`;
        const luminance = (c: Rgba) => {
          const [r, g, b] = c.slice(0, 3).map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a: Rgba, b: Rgba) => {
          const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };

        const dark = matchMedia("(prefers-color-scheme: dark)").matches && !matchMedia("print").matches;
        // 뿌리까지 비칠 때 그 아래에 깔리는 바탕: 브라우저의 기본 바탕(Canvas).
        const canvas: Rgba = dark ? [18, 18, 18, 1] : [255, 255, 255, 1];
        const paperColor = paper === null ? null : parse(paper);

        /** 그 요소까지(그 요소를 포함해) 조상의 opacity 를 곱한 값. */
        const opacityCache = new Map<Element, number>();
        const opacityOf = (el: Element | null): number => {
          if (el === null) return 1;
          const known = opacityCache.get(el);
          if (known !== undefined) return known;
          const value = Number(getComputedStyle(el).opacity) * opacityOf(el.parentElement);
          opacityCache.set(el, value);
          return value;
        };
        /** 그 요소의 상자 안에 깔린 바탕(불투명한 색): 조상의 바탕을 뿌리부터 차례로 겹친 것. */
        const backgroundCache = new Map<Element, Rgba>();
        const unreadable: string[] = [];
        const backgroundOf = (el: Element | null): Rgba => {
          if (el === null) return canvas;
          const known = backgroundCache.get(el);
          if (known !== undefined) return known;
          const below = backgroundOf(el.parentElement);
          const own = parse(getComputedStyle(el).backgroundColor);
          if (own === null) unreadable.push(`${el.tagName.toLowerCase()} 바탕 ${getComputedStyle(el).backgroundColor}`);
          const color = own === null ? below : over([own[0], own[1], own[2], own[3] * opacityOf(el)], below);
          backgroundCache.set(el, color);
          return color;
        };
        /** 일부러 가린 곳(1px 로 자른 상자) 안인지. 화면 낭독기용 글과 좁은 화면의 칸 머리. */
        const veiledCache = new Map<Element, boolean>();
        const veiled = (el: Element | null): boolean => {
          if (el === null || el === document.body) return false;
          const known = veiledCache.get(el);
          if (known !== undefined) return known;
          const style = getComputedStyle(el);
          const box = style.overflow === "visible" && style.clipPath === "none" ? null : el.getBoundingClientRect();
          const value = (box !== null && box.width <= 1 && box.height <= 1) || veiled(el.parentElement);
          veiledCache.set(el, value);
          return value;
        };
        /** 닫힌 details 의 안(이름 summary 는 빼고). */
        const folded = (el: Element): boolean => {
          for (let fold = el.closest("details:not([open])"); fold; fold = fold.parentElement?.closest("details:not([open])") ?? null) {
            if (!fold.querySelector(":scope > summary")?.contains(el)) return true;
          }
          return false;
        };
        const drawnCache = new Map<Element, boolean>();
        const drawnEl = (el: Element) => {
          const known = drawnCache.get(el);
          if (known !== undefined) return known;
          const value =
            el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true }) && !folded(el) && !veiled(el);
          drawnCache.set(el, value);
          return value;
        };
        /** 실패 글에 적는 요소의 이름: `태그.class.class`(class 가 없으면 태그만). */
        const name = (el: Element) => [el.tagName.toLowerCase(), ...(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)].join(".");

        /** 그려지는 색을 바꾸지만 계산된 색에는 드러나지 않는 꾸밈. 있으면 그 선언. */
        const effectIn = (style: CSSStyleDeclaration): string | null => {
          if (style.filter !== "none") return `filter: ${style.filter}`;
          if (style.backdropFilter !== "none") return `backdrop-filter: ${style.backdropFilter}`;
          if (style.mixBlendMode !== "normal") return `mix-blend-mode: ${style.mixBlendMode}`;
          return null;
        };
        /** 그 요소나 조상에 걸린 그런 꾸밈. */
        const effectCache = new Map<Element, string | null>();
        const effectOf = (el: Element | null): string | null => {
          if (el === null) return null;
          const known = effectCache.get(el);
          if (known !== undefined) return known;
          const value = effectIn(getComputedStyle(el)) ?? effectOf(el.parentElement);
          effectCache.set(el, value);
          return value;
        };
        /** 글자를 칠하는 색. `-webkit-text-fill-color` 를 따로 주지 않으면 글자색과 같다. */
        const fillOf = (style: CSSStyleDeclaration) => (style.webkitTextFillColor && style.webkitTextFillColor !== style.color ? style.webkitTextFillColor : style.color);

        const low: { what: string; text: string; color: string; background: string; ratio: number }[] = [];
        let measured = 0;
        let lowest = Infinity;
        /**
         * 글 하나를 잰다. `style` 은 그 글을 그리는 것의 계산된 꾸밈이다(요소, 또는 CSS 가 그린 글이면 그 가상 요소). 가상
         * 요소면(`pseudo`) 그 가상 요소의 opacity 와 꾸밈도 본다.
         */
        const measure = (what: string, text: string, el: Element, style: CSSStyleDeclaration, pseudo = false) => {
          const effect = effectOf(el) ?? (pseudo ? effectIn(style) : null);
          if (effect !== null) {
            unreadable.push(`${what} ${effect}`);
            return;
          }
          const colorText = fillOf(style);
          const color = parse(colorText);
          if (color === null) {
            unreadable.push(`${what} 글자색 ${colorText}`);
            return;
          }
          const background = backgroundOf(el);
          const alpha = color[3] * opacityOf(el) * (pseudo ? Number(style.opacity) : 1);
          const fg = over([color[0], color[1], color[2], alpha], background);
          const backs = paperColor === null ? [background] : [background, paperColor];
          for (const back of backs) {
            const value = ratio(fg, back);
            lowest = Math.min(lowest, value);
            if (value < minimum) low.push({ what, text: text.slice(0, 24), color: show(fg), background: show(back), ratio: Math.round(value * 100) / 100 });
          }
          measured += 1;
        };

        const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "OPTION", "TITLE"]);
        const NO_TEXT = new Set(["none", "normal", '""']);
        for (const scope of document.querySelectorAll(root)) {
          // 글 조각.
          const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node.textContent ?? "").trim();
            const el = node.parentElement;
            if (text === "" || el === null || SKIP.has(el.tagName) || el.closest("select") || !drawnEl(el)) continue;
            measure(name(el), text, el, getComputedStyle(el));
          }
          for (const el of [scope, ...scope.querySelectorAll("*")]) {
            if (SKIP.has(el.tagName) || !drawnEl(el)) continue;
            // CSS 가 그린 글.
            for (const pseudo of ["::before", "::after"]) {
              const style = getComputedStyle(el, pseudo);
              if (NO_TEXT.has(style.content) || style.display === "none") continue;
              measure(`${name(el)}${pseudo}`, style.content, el, style, true);
            }
            // 목록 표시(점, 번호, 접어 둔 것의 세모).
            const style = getComputedStyle(el);
            if (style.display.includes("list-item") && style.listStyleType !== "none" && style.listStyleImage === "none") {
              measure(`${name(el)}::marker`, style.listStyleType, el, getComputedStyle(el, "::marker"), true);
            }
            // 입력 부품의 글: 고르기 상자에 보이는 항목, 파일 입력의 글과 그 단추.
            if (el instanceof HTMLSelectElement) {
              measure(name(el), el.selectedOptions[0]?.textContent ?? "", el, style);
            }
            if (el instanceof HTMLInputElement && el.type === "file") {
              measure(name(el), "(파일 입력의 글)", el, style);
              const button = getComputedStyle(el, "::file-selector-button");
              const back = parse(button.backgroundColor);
              const color = parse(fillOf(button));
              const effect = effectOf(el) ?? effectIn(button);
              if (effect !== null) unreadable.push(`파일 고르기 단추 ${effect}`);
              else if (back === null || color === null) unreadable.push(`파일 고르기 단추 ${fillOf(button)} / ${button.backgroundColor}`);
              else {
                const behind = over(back, backgroundOf(el));
                const value = ratio(over(color, behind), behind);
                lowest = Math.min(lowest, value);
                measured += 1;
                if (value < minimum) low.push({ what: "input::file-selector-button", text: "(파일 고르기 단추)", color: show(color), background: show(behind), ratio: Math.round(value * 100) / 100 });
              }
            }
          }
        }
        for (const entry of unreadable) low.push({ what: "색을 읽지 못함", text: entry, color: "", background: "", ratio: 0 });
        const chips = [...document.querySelectorAll(".chip")]
          .filter((chip) => drawnEl(chip) && chip.getBoundingClientRect().width > 1)
          .flatMap((chip) => [...chip.classList].filter((c) => c.startsWith("chip-")).map((c) => c.slice("chip-".length)));
        return { measured, low: low.slice(0, 10), lowCount: low.length, lowest: Math.round(lowest * 100) / 100, chips: [...new Set(chips)].sort() };
      },
      { root: options.root ?? "body", minimum: options.minimum ?? 4.5, paper: options.paper ?? null },
    ),
  );

/**
 * 키보드 초점의 둘레선과 그 바깥 바탕의 명도 대비. 지금 초점이 있는 요소를 잰다. 둘레선이 없으면 0.
 * 둘레선은 요소의 바깥(outline-offset 만큼 떨어진 곳)에 그려지므로 바탕은 부모 요소의 상자 안에 깔린 색으로 본다.
 */
export const focusRingContrast = (page: Page) =>
  within(
    "초점 둘레선 재기",
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { what: "(초점 없음)", ratio: 0, color: "", background: "" };
      // 데모의 코드 상자는 둘레선을 상자 전체(.codeblock)의 바깥에 그린다(globals.css).
      const ringed = getComputedStyle(el).outlineStyle === "none" && el.closest(".codeblock") ? el.closest(".codeblock")! : el;
      const style = getComputedStyle(ringed);
      const parse = (color: string) => (/^rgba?\(([^)]+)\)$/.exec(color)?.[1].split(/[,\s/]+/).filter(Boolean).map(Number) ?? null);
      const backOf = (node: Element | null): number[] => {
        const chain: number[][] = [];
        for (let up = node; up; up = up.parentElement) {
          const c = parse(getComputedStyle(up).backgroundColor);
          if (c) chain.push(c);
        }
        let base = matchMedia("(prefers-color-scheme: dark)").matches ? [18, 18, 18] : [255, 255, 255];
        for (const c of chain.reverse()) {
          const a = c[3] ?? 1;
          base = [0, 1, 2].map((i) => c[i] * a + base[i] * (1 - a));
        }
        return base;
      };
      const lum = (c: number[]) =>
        c
          .slice(0, 3)
          .map((v) => v / 255)
          .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const color = parse(style.outlineColor);
      if (style.outlineStyle === "none" || color === null) return { what: ringed.tagName.toLowerCase(), ratio: 0, color: style.outlineColor, background: "" };
      // 필터나 섞어 그리기가 걸리면 그려지는 색을 셈할 수 없다(`textContrast` 와 같다). 재지 못한 것(0)으로 적는다.
      for (let up: Element | null = ringed; up; up = up.parentElement) {
        const s = getComputedStyle(up);
        if (s.filter !== "none" || s.backdropFilter !== "none" || s.mixBlendMode !== "normal") {
          return { what: `${ringed.tagName.toLowerCase()} (필터나 섞어 그리기가 걸림)`, ratio: 0, color: style.outlineColor, background: "" };
        }
      }
      const offset = parseFloat(style.outlineOffset);
      // 바깥에 그리면 부모의 바탕 위에, 안쪽에 그리면(음수) 제 바탕 위에 놓인다.
      const back = backOf(offset < 0 ? ringed : ringed.parentElement);
      const [hi, lo] = [lum(color), lum(back)].sort((a, b) => b - a);
      return {
        what: [ringed.tagName.toLowerCase(), ...(ringed.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)].join("."),
        ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
        color: style.outlineColor,
        background: `rgb(${back.map((v) => Math.round(v)).join(", ")})`,
      };
    }),
  );

/** 테두리 하나를 잰 것. */
export interface BorderContrast {
  /** 그 요소(`#id` 또는 `태그.class`). 가상 요소면 뒤에 그 이름, 단추면 그 글. */
  what: string;
  /** 네 변 가운데 가장 낮은 명도 대비. 테두리가 없으면 0. */
  ratio: number;
  border: string;
  background: string;
}

/**
 * 누르거나 고르는 것의 테두리와 그 바깥 바탕의 명도 대비(WCAG 2 의 비텍스트 대비, 3:1 을 본다). 선택자에 맞는 요소 가운데
 * 그려진 것마다 잰다. `pseudo` 를 주면 그 가상 요소의 테두리를 잰다(파일 입력의 단추). 바깥 바탕은 그 요소를 품은 것(가상
 * 요소면 그 요소)부터 문서의 뿌리까지 조상의 바탕을 겹쳐 셈한다. 비치는 테두리는 그 바탕 위에 겹친다.
 */
export const borderContrast = (page: Page, selector: string, pseudo?: "::file-selector-button") =>
  within(
    "테두리 재기",
    page.evaluate(
      ({ selector, pseudo }) => {
        const parse = (color: string) => (/^rgba?\(([^)]+)\)$/.exec(color)?.[1].split(/[,\s/]+/).filter(Boolean).map(Number) ?? null);
        const over = (top: number[], bottom: number[]) => [0, 1, 2].map((i) => top[i] * (top[3] ?? 1) + bottom[i] * (1 - (top[3] ?? 1)));
        const backOf = (node: Element | null): number[] => {
          const chain: number[][] = [];
          for (let up = node; up; up = up.parentElement) {
            const c = parse(getComputedStyle(up).backgroundColor);
            if (c) chain.push(c);
          }
          let base = matchMedia("(prefers-color-scheme: dark)").matches && !matchMedia("print").matches ? [18, 18, 18] : [255, 255, 255];
          for (const c of chain.reverse()) base = over(c, base);
          return base;
        };
        const lum = (c: number[]) =>
          c
            .slice(0, 3)
            .map((v) => v / 255)
            .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a: number[], b: number[]) => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
          return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
        };
        const show = (c: number[]) => `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(", ")})`;
        return [...document.querySelectorAll(selector)]
          .filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 1)
          .map((el) => {
            const name = el.id ? `#${el.id}` : [el.tagName.toLowerCase(), ...(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)].join(".");
            const what = `${name}${pseudo ?? ""}${el instanceof HTMLButtonElement ? ` "${(el.textContent ?? "").trim()}"` : ""}`;
            const style = getComputedStyle(el, pseudo);
            const back = backOf(pseudo ? el : el.parentElement);
            // 필터나 섞어 그리기가 걸리면 그려지는 색을 셈할 수 없다(`textContrast` 와 같다). 재지 못한 것(0)으로 적는다.
            const effected = (s: CSSStyleDeclaration) => s.filter !== "none" || s.backdropFilter !== "none" || s.mixBlendMode !== "normal";
            let effect = pseudo !== null && effected(style);
            for (let up: Element | null = el; up && !effect; up = up.parentElement) effect = effected(getComputedStyle(up));
            if (effect) return { what, ratio: 0, border: "(필터나 섞어 그리기가 걸림)", background: show(back) };
            const sides = (["Top", "Right", "Bottom", "Left"] as const).map((side) => {
              const color = parse(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
              const drawn = style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none" && parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0;
              return { color: color ? over(color, back) : null, drawn };
            });
            if (sides.some((side) => !side.drawn || side.color === null)) return { what, ratio: 0, border: "(테두리 없음)", background: show(back) };
            const lowest = sides.reduce((low, side) => (ratio(side.color!, back) < ratio(low.color!, back) ? side : low));
            return { what, ratio: ratio(lowest.color!, back), border: show(lowest.color!), background: show(back) };
          });
      },
      { selector, pseudo: pseudo ?? null },
    ),
  ) as Promise<BorderContrast[]>;

/** 닫는 따옴표·괄호 바로 뒤에서 줄이 바뀐 곳 하나. */
export interface ParticleBreak {
  /** 그 글이 든 요소(`태그.class`). */
  what: string;
  /** 줄이 바뀐 자리의 앞뒤(⏎ 가 줄이 바뀐 자리). 같은 블록 안의 앞뒤 글 조각까지 이어 붙여 보인다. */
  around: string;
  /** 부호가 든 글 조각 전체(앞뒤 빈칸은 걷는다). 팩·CLI 출력의 글인지 가려낼 때 쓴다. */
  node: string;
  /** 사이트가 묶어 둔 조각(`.nobreak`) 안의 글인지. 그 안의 글은 사이트가 쓴 글이다(조각이 짧아 `node` 로는 가려내지 못한다). */
  kept: boolean;
}

/**
 * 닫는 따옴표·괄호(’ ” 」 』 ) ] ' ")와 바로 뒤에 붙은 한글 사이에서 줄이 바뀐 곳('‘판정 경로’ ⏎ 에'). Chrome 은
 * `word-break: keep-all` 이어도 그 사이를 줄바꿈 자리로 본다(사이트는 그 자리를 `.nobreak` 로 묶는다. src/components/text.tsx).
 * 그려진 글 조각마다 부호와 그 다음 글자의 자리를 재어, 다음 글자가 아래 줄에 있으면 적는다. 부호가 글 조각의 끝이면 같은
 * 블록(한 줄 흐름) 안의 다음 글 조각의 첫 글자를 본다. `checked` 는 본 자리(부호 바로 뒤에 한글이 붙은 곳)의 수다.
 * 그려지지 않는 글(닫힌 details 의 안)은 자리가 없어 빠진다.
 */
export const particleBreaks = (page: Page) =>
  within(
    "닫는 부호 뒤의 줄바꿈 찾기",
    page.evaluate(() => {
      const CLOSE = /[’”」』)\]'"]/;
      const HANGUL = /[가-힣]/;
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (el && !el.closest("script, style, template") && el.checkVisibility({ visibilityProperty: true })) nodes.push(node as Text);
      }
      /** 그 글자의 상자(크기가 있는 것). 그려지지 않았으면 null. */
      const box = (node: Text, at: number) => {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        return [...range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0) ?? null;
      };
      /** 글 조각이 놓인 블록(가장 가까운, inline 이 아닌 조상). */
      const blockOf = (node: Text) => {
        for (let el = node.parentElement; el; el = el.parentElement) if (!getComputedStyle(el).display.startsWith("inline")) return el;
        return null;
      };
      /** k 번째 글 조각의 처음부터 upto 글자 앞까지에, 같은 블록 안의 앞 조각들을 이어 붙인 끝 12자. */
      const before = (k: number, upto: number) => {
        const block = blockOf(nodes[k]);
        let text = nodes[k].data.slice(0, upto);
        for (let j = k - 1; j >= 0 && text.length < 12 && blockOf(nodes[j]) === block; j--) text = nodes[j].data + text;
        return text.slice(-12);
      };
      /** k 번째 글 조각의 from 글자부터에, 같은 블록 안의 뒤 조각들을 이어 붙인 처음 8자. */
      const after = (k: number, from: number) => {
        const block = blockOf(nodes[k]);
        let text = nodes[k].data.slice(from);
        for (let j = k + 1; j < nodes.length && text.length < 8 && blockOf(nodes[j]) === block; j++) text += nodes[j].data;
        return text.slice(0, 8);
      };
      const found: { what: string; around: string; node: string; kept: boolean }[] = [];
      let checked = 0;
      nodes.forEach((node, k) => {
        const text = node.data;
        for (let i = 0; i < text.length; i++) {
          if (!CLOSE.test(text[i])) continue;
          let n = k;
          let at = i + 1;
          if (at >= text.length) {
            n = k + 1;
            at = 0;
            if (n >= nodes.length || blockOf(nodes[n]) !== blockOf(node)) continue;
          }
          const next = nodes[n];
          if (!HANGUL.test(next.data[at] ?? "")) continue;
          const mark = box(node, i);
          const later = box(next, at);
          if (mark === null || later === null) continue;
          checked += 1;
          if (later.top > mark.top + mark.height / 2) {
            const el = node.parentElement!;
            found.push({
              what: [el.tagName.toLowerCase(), ...(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)].join("."),
              around: `…${before(k, i + 1)}⏎${after(n, at)}…`,
              node: text.trim(),
              kept: el.closest(".nobreak") !== null,
            });
          }
        }
      });
      return { checked, found };
    }),
  ) as Promise<{ checked: number; found: ParticleBreak[] }>;

export interface UndrawnOptions {
  /** 볼 곳(선택자). 그 안의 글 조각을 모두 본다. 여럿이면 모두 본다. */
  root: string;
  /** 일부러 화면에서만 가린 것(화면 낭독기용 글, 좁은 화면의 칸 머리). 그 안의 글은 보지 않는다. */
  veiled: string;
  /**
   * 가장 작은 글자 크기(px). 기본은 10px(화면에서 가장 작은 글자는 작은 글 안의 코드로 12px 남짓이다. 9번 전에는 11.6px). 인쇄할
   * 때는 더 작다.
   */
  minFont?: number;
}

/**
 * 볼 곳의 글 가운데 화면에 그려지지 않는 것. 없어야 한다. 쪽의 HTML 에 글이 있어도 CSS 가 가리면 읽히지 않는다(맨 위의
 * 말을 흐리게 하거나 1px 로 잘라도 글은 문서에 그대로 있어서, 글을 읽는 시험은 통과한다). 글 조각(텍스트 노드)마다 본다.
 * - 요소가 그려진다(display, visibility, content-visibility, opacity 0). 조상까지 흐리지 않다(opacity 1).
 * - 글자가 있다: 크기가 `minFont` 이상이고 색이 비치지 않는다.
 * - 글의 상자가 있고(크기 0 이 아니다) 화면 옆으로 나가 있지 않다.
 * - 그 자리를 짚으면 그 요소가 나온다. 잘렸거나(1px 로 자르기, overflow, clip-path) 다른 요소에 덮였으면 나오지 않는다.
 *   글이 가로로 밀리는 스크롤 상자(데모의 코드 상자) 안에 있으면 그 상자를 밀어 글을 상자 가운데로 가져온 뒤 짚는다.
 *
 * 닫힌 details 의 내용은 그려지지 않는 것이 맞으므로 뺀다. 그 details 의 이름(summary)은 닫혀 있어도 보여야 한다.
 * 일부러 화면에서만 가린 것(`veiled`)도 뺀다. 그것이 몇 곳인지는 HTML 을 읽는 시험과 표의 시험이 본다. 제 요소가 스스로
 * 그린 것(`::after` 등)에 덮인 글과 옅은 색은 이것으로 보지 못한다. 색은 대비를 재는 시험이 본다.
 */
export const undrawn = (page: Page, options: UndrawnOptions) =>
  within("그려지지 않은 글 찾기", page.evaluate(({ root, veiled, min }) => {
    const folded = (el: Element): boolean => {
      for (let fold = el.parentElement?.closest("details:not([open])"); fold; fold = fold.parentElement?.closest("details:not([open])")) {
        if (!fold.querySelector(":scope > summary")?.contains(el)) return true;
      }
      return false;
    };
    const range = document.createRange();
    const boxOf = (node: Node) => {
      range.selectNodeContents(node);
      return [...range.getClientRects()].find((box) => box.width >= 1 && box.height >= 1);
    };
    /** 그 요소를 품은, 가로로 밀리는 스크롤 상자. */
    const scrollerOf = (el: Element): HTMLElement | null => {
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const { overflowX } = getComputedStyle(up);
        if ((overflowX === "auto" || overflowX === "scroll") && up.scrollWidth > up.clientWidth) return up;
      }
      return null;
    };
    const reason = (node: Node, el: Element): string | null => {
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true })) return "그려지지 않음";
      for (let up: Element | null = el; up; up = up.parentElement) {
        if (Number(getComputedStyle(up).opacity) < 1) return `흐림(${up.tagName.toLowerCase()}.${up.className})`;
      }
      const style = getComputedStyle(el);
      if (parseFloat(style.fontSize) < min) return `글자 크기 ${style.fontSize}`;
      const alpha = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(style.color)?.[1];
      if (alpha !== undefined && Number(alpha) < 1) return `글자색이 비침(${style.color})`;
      const laidOut = boxOf(node);
      if (!laidOut) return "글의 상자가 없음";
      // 그 글이 화면 가운데에 오게 한 뒤 그 자리를 짚는다. 가로로 밀리는 상자 안이면 그 상자도 밀었다가 되돌린다.
      window.scrollTo(0, window.scrollY + laidOut.top - window.innerHeight / 2);
      const scroller = scrollerOf(el);
      const was = scroller?.scrollLeft ?? 0;
      if (scroller) {
        const view = scroller.getBoundingClientRect();
        const now = boxOf(node)!;
        scroller.scrollLeft += now.left + now.width / 2 - (view.left + scroller.clientWidth / 2);
      }
      const box = boxOf(node)!;
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hit = x < 0 || x >= document.documentElement.clientWidth ? undefined : document.elementFromPoint(x, y);
      if (scroller) scroller.scrollLeft = was;
      if (hit === undefined) return "화면 옆으로 나감";
      if (hit === null || !el.contains(hit)) return `잘렸거나 덮임(그 자리에 ${hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : "아무것도 없음"})`;
      return null;
    };
    const start = { x: window.scrollX, y: window.scrollY };
    const found: string[] = [];
    let texts = 0;
    for (const scope of document.querySelectorAll(root)) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").trim();
        const el = node.parentElement;
        if (text === "" || el === null || el.closest(veiled) || folded(el)) continue;
        texts += 1;
        const why = reason(node, el);
        if (why) found.push(`${el.tagName.toLowerCase()}.${el.className} "${text.slice(0, 16)}": ${why}`);
      }
    }
    window.scrollTo(start.x, start.y);
    return { texts, undrawn: found.slice(0, 8) };
  }, { root: options.root, veiled: options.veiled, min: options.minFont ?? 10 }));

/**
 * 볼 곳의 요소에 붙은 속성 가운데 허용하지 않은 것(`태그.class[속성]`). 없어야 한다. 조문 도감의 쪽을 읽는 도구가 아는
 * 요소와 속성만 받는 것(`tests/policy-page.ts` 의 `assertKnownMarkup`)을 브라우저가 그린 쪽으로 넓힌 것이다. 글이 아닌 것으로
 * 가리거나(hidden, style, aria-hidden, inert) 보이지 않는 글을 싣는(title, aria-label, alt) 길을 막는다. 브라우저에서 도는
 * 코드가 붙은 뒤에 더한 속성도 걸린다. `allowed` 는 속성 이름에서 그 속성이 붙어도 되는 요소의 선택자로 가는 표다.
 */
export const unknownAttributes = (page: Page, root: string, allowed: Record<string, string>) =>
  within("속성 읽기", page.evaluate(
    ({ root, allowed }) => {
      const found = new Set<string>();
      for (const scope of document.querySelectorAll(root)) {
        for (const el of [scope, ...scope.querySelectorAll("*")]) {
          for (const { name } of el.attributes) {
            const where = allowed[name];
            if (where === undefined || !el.matches(where)) found.add(`${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}[${name}]`);
          }
        }
      }
      return [...found];
    },
    { root, allowed },
  ));

/**
 * 결과 화면(`.report`)에 붙는 속성. 표의 role(좁은 화면에서도 표로 읽히게), 정책 카드의 id(데모의 표에서 옮겨 온다), 상태
 * 칩의 title(상태의 뜻), 경로의 줄바꿈 자리(wbr)의 aria-hidden, 충족 근거 목록의 이름(aria-label). 그 밖의 속성은 없다.
 */
export const RESULT_ATTRIBUTES: Record<string, string> = {
  class: "*",
  role: "table, thead, tbody, tr, th, td",
  scope: "th",
  id: "article.policy",
  href: "a",
  title: ".chip",
  open: "details",
  "aria-hidden": "wbr",
  "aria-label": "ul.evidence",
};

/** 그려도 되는 CSS 의 글 하나: 그 선택자에 맞는 요소의 그 자리(`::before` 등)가 그 속성들의 값을 빈칸으로 이어 그린 것. */
export interface DrawnFromAttributes {
  selector: string;
  pseudo: "::before" | "::after";
  attributes: string[];
  /** 화면 낭독기에 주는 대체 글(`content: … / "…"`). 대체 글을 붙인 꾸밈만 적는다. */
  alt?: string;
}

export interface CssDrawnOptions {
  /** 화면에 그려진 것을 볼 곳(선택자). 없으면 쪽 전체(html, body 와 그 안의 모든 요소). */
  within?: string;
  /** `within` 안에서 빼고 볼 곳(그 요소와 그 안). */
  except?: string;
  /**
   * 꾸밈의 규칙 가운데 볼 것. 없으면 이 쪽에 있는 class 의 규칙 전부(다른 쪽의 꾸밈은 뺀다). 주면 선택자에 그 글이 든 규칙만
   * (조문별 검사 기록의 `record`).
   */
  selectorHas?: string;
  /** 그려도 되는 목록 표시(`list-style-type`). 기본은 점, 없음, 접어 둔 것의 세모. */
  markers?: string[];
  /** 화면에 그려도 되는 글. 속성의 값을 그대로 옮겨 그린 것만 된다. */
  allowed?: DrawnFromAttributes[];
  /** 규칙 가운데 글을 그려도 되는 것(`content: attr(data-line)` 처럼 선언을 적는다). 선택자는 보지 않는다. */
  allowedRules?: string[];
}

/**
 * CSS 가 그린 글. 쪽의 HTML 에 없는 글도 CSS 는 그린다: `::before`·`::after`·`::marker` 의 content 와, 글로 적은 목록
 * 표시(list-style-type). 그런 글은 HTML 을 읽는 시험에도, 글 조각을 걷는 `undrawn` 에도 보이지 않는다. 두 가지로 본다.
 *
 * - `rules`: 쪽에 실린 꾸밈(스타일시트)의 규칙 가운데 글을 그리는 것. 규칙 자체를 읽으므로 화면 너비, 테마, 인쇄, 마우스를
 *   올렸는지, 접어 둔 것이 펼쳐졌는지와 상관없다. 묶는 규칙(@media, @supports, 안에 적은 규칙 등) 속까지 걷는다. 이 쪽에 없는
 *   class 를 가리키는 규칙은 다른 쪽의 꾸밈이라 뺀다. 괄호(:not, :is, :has 등)나 낯선 글자가 든 선택자는 그렇게 단정하지 않고
 *   이 쪽의 것으로 본다. 속성 선택자 안의 점은 class 가 아니라서 걷어 내고 본다.
 * - `drawn`: 지금 화면의 요소마다 실제로 계산된 값.
 *
 * 빈 글("")은 글이 아니다(꾸밈에 쓴다). 그려도 되는 것은 부르는 쪽이 준다(`markers`, `allowed`, `allowedRules`). 조문·규칙·
 * 조건·결과를 풀이하는 글은 CSS 로 그리지 않는다.
 */
export const cssDrawn = (page: Page, options: CssDrawnOptions = {}) =>
  within("CSS 가 그린 글 찾기", page.evaluate(
    ({ within, except, selectorHas, markers, allowed, allowedRules }) => {
      const NO_TEXT = new Set(["", "none", "normal", '""']);
      const MARKERS = new Set(["", ...markers]);
      const ALLOWED_RULES = new Set(allowedRules);
      /** 그 꾸밈이 그리는 글. 적혀 있지 않은 값("")은 그리는 것이 없다. */
      const textOf = (style: CSSStyleDeclaration): string[] => {
        const content = style.getPropertyValue("content").trim();
        const marker = style.getPropertyValue("list-style-type").trim();
        return [...(NO_TEXT.has(content) ? [] : [`content: ${content}`]), ...(MARKERS.has(marker) ? [] : [`list-style-type: ${marker}`])];
      };
      /** 이 쪽의 요소에는 맞을 수 없는 선택자인지: 이 쪽에 없는 class 를 가리킨다. */
      const elsewhere = (selector: string) =>
        !/[(\\]|[^\x20-\x7e]/.test(selector) &&
        (selector.replace(/\[[^\]]*\]/g, "").match(/\.-?[_a-zA-Z][\w-]*/g) ?? []).some((name) => document.getElementsByClassName(name.slice(1)).length === 0);
      const rules: string[] = [];
      let read = 0;
      /** 규칙을 걷는다. 묶는 규칙 속까지 걷는다. 조건이 지금 맞는지는 따지지 않는다. `here` 는 품은 규칙이 이 쪽의 것인지. */
      const walk = (list: CSSRuleList, here: boolean) => {
        for (const rule of list) {
          read += 1;
          const selector = rule instanceof CSSStyleRule ? rule.selectorText : null;
          const look =
            selectorHas === null
              ? here && (selector === null || selector.split(",").some((one) => !elsewhere(one)))
              : selector !== null && selector.includes(selectorHas);
          const style = (rule as Partial<CSSStyleRule>).style;
          if (look && style) {
            for (const text of textOf(style)) if (!ALLOWED_RULES.has(text)) rules.push(`${selector ?? rule.cssText.slice(0, 40)} { ${text} }`);
          }
          const inner = (rule as Partial<CSSGroupingRule>).cssRules ?? (rule as Partial<CSSImportRule>).styleSheet?.cssRules;
          if (inner) walk(inner, selectorHas === null ? look : true);
        }
      };
      for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) walk(sheet.cssRules, true);

      /** 그 자리가 속성의 값을 그대로 옮겨 그린 것인지. */
      const fromAttributes = (el: Element, pseudo: string, content: string) =>
        allowed.some(
          (entry) =>
            entry.pseudo === pseudo &&
            el.matches(entry.selector) &&
            content ===
              `${JSON.stringify(entry.attributes.map((name) => el.getAttribute(name) ?? "").join(" "))}${entry.alt === undefined ? "" : ` / ${JSON.stringify(entry.alt)}`}`,
        );
      const all =
        within === null
          ? [...document.querySelectorAll("html, body, body *")]
          : [...new Set([...document.querySelectorAll(within)].flatMap((el) => [el, ...el.querySelectorAll("*")]))];
      const elements = except === null ? all : all.filter((el) => !el.closest(except));
      const drawn: string[] = [];
      for (const el of elements) {
        const name = `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`;
        drawn.push(...textOf(getComputedStyle(el)).map((text) => `${name} ${text}`));
        for (const pseudo of ["::before", "::after", "::marker"]) {
          const content = getComputedStyle(el, pseudo).getPropertyValue("content");
          if (!NO_TEXT.has(content) && !fromAttributes(el, pseudo, content)) drawn.push(`${name}${pseudo} content: ${content}`);
        }
      }
      return { read: { rules: read, elements: elements.length }, rules, drawn };
    },
    {
      within: options.within ?? null,
      except: options.except ?? null,
      selectorHas: options.selectorHas ?? null,
      markers: options.markers ?? ["disc", "none", "disclosure-closed", "disclosure-open"],
      allowed: options.allowed ?? [],
      allowedRules: options.allowedRules ?? [],
    },
  ));

/** Chrome 의 접근성 트리에서 읽은 요소 하나. */
export interface AccessibleNode {
  /**
   * Chrome 이 정한 role(table, row, columnheader, rowheader, cell, heading 등). 트리에서 빠진 요소(그려지지 않는 칸, 화면
   * 낭독기에서 가린 것)는 "ignored" 다.
   */
  role: string;
  /** 화면 낭독기에 읽히는 이름. */
  name: string;
  /** 제목의 단계. Chrome 이 단계를 적는 것(제목)에만 있다. */
  level?: number;
}

/** `accessibleNodes` 가 찾은 요소를 CDP 쪽으로 넘기려고 잠깐 두는 자리(쪽의 window). 읽고 나면 걷는다. */
const AX_TARGETS = "__axTargets";

/**
 * Chrome 이 화면 낭독기에 내주는 접근성 트리를 CDP 로 읽는다(`Accessibility.getPartialAXTree`). 선택자(또는 시험 도구의
 * locator)에 맞는 요소마다, 문서에 나오는 차례로 그 role 과 이름. 화면 낭독기의 음성은 아니다.
 *
 * 시험 도구의 `getByRole`·`ariaSnapshot` 은 Chrome 의 트리가 아니다. 쪽에 넣은 스크립트가 태그 이름과 role 속성으로 role 을
 * 셈한다(playwright-core 1.63: `TABLE` 은 table, `TD` 는 cell. CSS 의 display 는 보지 않는다). 그래서 좁은 화면의 CSS 때문에
 * 브라우저가 표의 뜻을 버려도 표·줄·칸으로 센다. 표·줄·칸과 제목이 화면 낭독기에 어떻게 드러나는지는 이것으로 본다.
 */
export async function accessibleNodes(context: BrowserContext, page: Page, target: string | Locator): Promise<AccessibleNode[]> {
  return within(
    `접근성 트리 읽기(${String(target)})`,
    (async () => {
      const cdp = await context.newCDPSession(page);
      try {
        // locator 가 찾은 요소는 쪽의 window 에 잠깐 두고 CDP 로 읽는다(둘 다 쪽의 기본 스크립트 세계다).
        if (typeof target !== "string") {
          await target.evaluateAll((all, key) => void ((window as unknown as Record<string, unknown>)[key] = all), AX_TARGETS);
        }
        const expression = typeof target === "string" ? `[...document.querySelectorAll(${JSON.stringify(target)})]` : `window.${AX_TARGETS}`;
        const { result } = await cdp.send("Runtime.evaluate", { expression });
        if (result.objectId === undefined) throw new Error(`요소를 찾지 못했습니다: ${String(target)}`);
        const { result: entries } = await cdp.send("Runtime.getProperties", { objectId: result.objectId, ownProperties: true });
        const found: AccessibleNode[] = [];
        for (const entry of entries) {
          const objectId = entry.value?.objectId;
          if (!/^\d+$/.test(entry.name) || !objectId) continue;
          const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { objectId, fetchRelatives: false });
          const node = nodes[0];
          const level: unknown = node?.properties?.find((property) => property.name === "level")?.value.value;
          found.push({
            role: node === undefined || node.ignored ? "ignored" : String(node.role?.value ?? ""),
            name: String(node?.name?.value ?? ""),
            ...(typeof level === "number" ? { level } : {}),
          });
        }
        return found;
      } finally {
        await cdp.detach();
        if (typeof target !== "string") {
          await page.evaluate((key) => void delete (window as unknown as Record<string, unknown>)[key], AX_TARGETS).catch(() => undefined);
        }
      }
    })(),
  );
}

/** Chrome 이 화면 낭독기에 내주는 이름(`accessibleNodes` 의 이름만). 요소마다, 문서에 나오는 차례로. */
export async function accessibleNames(context: BrowserContext, page: Page, target: string | Locator): Promise<string[]> {
  return (await accessibleNodes(context, page, target)).map((node) => node.name);
}
