import { existsSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { root, walk } from "../helpers";

// 브라우저 시험의 바탕: 빌드된 out/ 을 127.0.0.1 의 빈 포트에 띄우고, 이 컴퓨터에 깔린 Chrome 을 헤드리스로 연다.
// 시험이 끝나면(실패해도) 띄운 서버와 브라우저를 닫는 것은 부르는 쪽의 afterAll 이 한다.

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
 * 이 컴퓨터에 깔린 Google Chrome 을 헤드리스로 연다. 브라우저를 내려받지 않는다(playwright-core 는 브라우저를 함께
 * 받지 않는다). Chrome 이 다른 자리에 있거나 Chromium 계열의 다른 브라우저를 쓰려면 CHROME_PATH 에 실행 파일을 준다.
 *
 * 열지 못하면 시험을 건너뛰지 않고 실패한다. 건너뛰면 "연 파일을 어디로도 보내지 않는다"를 보는 시험 없이
 * `npm run check` 가 통과한다.
 */
export async function launchChrome(): Promise<Browser> {
  const executablePath = process.env.CHROME_PATH;
  try {
    return await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
  } catch (error) {
    throw new Error(
      "브라우저 시험에 쓸 Chrome 을 열지 못했습니다. Google Chrome 을 설치하거나, Chrome·Chromium 실행 파일의 경로를 " +
        "CHROME_PATH 환경 변수로 주세요. 이 시험은 건너뛰지 않습니다(docs/architecture.md 의 \"브라우저 시험\").",
      { cause: error },
    );
  }
}
