import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packMeta, policySlug } from "@/lib/pack";
import nextConfig from "../next.config";
import { root, walk } from "./helpers";
import { BANNED_WORDING } from "./wording";

// docs/commitments.md 의 약속 가운데 기계로 지킬 수 있는 것. 2026-11-03 에 2장(2026-10-24 에 바뀐 약속: 서버가 있는 분석
// 서비스)에 맞췄다. 정적 내보내기 시험을 걷고, 서버를 정한 구조 안에만 두는 시험으로 바꿨다. 문구 시험은 그대로다.
// 이 시험을 고쳐서 통과시키지 않는다. 약속을 바꾸려면 사람(오너)의 결정이 먼저다.
// 여기 있는 검사는 흔한 실수를 잡는 그물이다. 통과했다고 약속을 지켰다는 증명은 아니다.

const CODE = /\.(js|jsx|mjs|cjs|ts|tsx)$/;
const sources = walk("src");
const code = sources.filter((file) => CODE.test(file));
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("표기 약속: 소스에 적은 문구", () => {
  it.each(sources.filter((file) => /\.(js|jsx|mjs|cjs|ts|tsx|css|json|md|mdx|txt)$/.test(file)))("%s", (file) => {
    const text = read(file);
    for (const [pattern, why] of BANNED_WORDING) {
      expect(pattern.test(text), `${file}: ${pattern} — ${why}`).toBe(false);
    }
  });
});

describe("표기 약속: 화면에 싣는 팩 문구", () => {
  // 팩에서 온 글 가운데 화면에 그리는 것(제목, 질문, 메시지, 고치는 법)에 단정하는 말이나 처분·액수가 없어야 한다.
  // 걸리면 화면에서 그 필드를 빼고 docs/cli-requests.md 의 "팩 쪽에 전할 관찰"에 적는다. 조문 원문은 보지 않는다.
  it.each(packMeta.policies.map((p) => p.id))("%s", (id) => {
    const policy = packMeta.policies.find((p) => p.id === id)!;
    const shown = [
      policy.title,
      policy.ask_developer,
      ...policy.rules.flatMap((rule) => [
        rule.applies_question,
        ...rule.alternatives.flatMap((alt) => [alt.message, alt.ask_developer, alt.remediation, alt.question]),
      ]),
    ].filter((text): text is string => Boolean(text));
    for (const text of shown) {
      for (const [pattern, why] of BANNED_WORDING) {
        expect(pattern.test(text), `${id}: "${text}" — ${why}`).toBe(false);
      }
    }
  });

  it("팩 작성자 메모(rationale)는 화면에 싣지 않는다", () => {
    // 조문이 아닌 글에 처분·액수 같은 법 관련 주장이 들어 있다. 실을지는 사람이 정한다.
    for (const file of code) {
      expect(/\.rationale\b/.test(read(file)), file).toBe(false);
    }
  });
});

// docs/commitments.md 의 2(2026-10-24 방향 B 에 맞춰 바뀐 약속): 서버는 있되 그 구조 안에서만 둔다(CLAUDE.md 의 절대 규칙).
// 서버 코드는 src/server/ 와 src/app/api/ 에만, 브라우저 쪽 코드는 같은 사이트의 /api/ 밖으로 요청하지 않고, 비밀값은 서버
// 코드에만, 쿠키·브라우저 저장소는 쓰지 않는다.

/** 서버 코드가 사는 곳. */
const isServerCode = (file: string) => file.startsWith("src/server/") || file.startsWith("src/app/api/");
/** 서버에서 도는 Next 의 파일. route handler 만 src/app/api/ 에 둔다. */
const SERVER_FILE = /(^|\/)(route|proxy|middleware)\.(js|jsx|mjs|cjs|ts|tsx)$/;
/** 비밀값의 환경 변수 이름. 서버 코드 말고는 이름조차 적지 않는다. */
const SECRET_NAMES = ["GITHUB_TOKEN", "RUNNER_TOKEN", "RUNNER_SECRET", "ANTHROPIC_API_KEY", "DATABASE_URL"];

/** 불러오는 이름을 저장소 안의 파일로 바꾼다. 패키지는 null 이다(tests/bundle.test.ts 와 같은 규칙). */
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(path.join(root, candidate)) && !candidate.endsWith(path.sep) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

/** "use client" 로 시작하는 파일과, 거기서 (타입 아닌) 불러오기를 따라가 닿는 저장소 안의 모든 파일. 브라우저 묶음에 드는 코드다. */
function clientCode(): Set<string> {
  const seen = new Set<string>();
  const queue = code.filter((file) => /^\s*["']use client["']/.test(read(file)));
  const statement = /^\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (let file = queue.shift(); file; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(statement)) {
      if (match[2]) continue;
      const target = resolveImport(file, match[3] ?? match[4]);
      if (target) queue.push(target);
    }
  }
  return seen;
}

describe("서버는 정한 구조 안에만 (docs/commitments.md 의 2, CLAUDE.md)", () => {
  const client = clientCode();

  it("서버에서 도는 Next 의 파일은 src/app/api/ 의 route handler 뿐이다. server action·proxy·pages API 는 없다", () => {
    for (const file of sources) {
      if (SERVER_FILE.test(file)) {
        expect(file.startsWith("src/app/api/") && /(^|\/)route\.(ts|tsx)$/.test(file), `${file}: src/app/api/ 밖의 서버 파일`).toBe(true);
      }
      expect(/(^|\/)pages\/api\//.test(file), `${file}: pages API`).toBe(false);
    }
    for (const file of code) {
      expect(/["']use server["']/.test(read(file)), `${file}: server action`).toBe(false);
    }
  });

  it("페이지는 src/app 아래에만 있고, 루트에 proxy·middleware 가 없다", () => {
    for (const dir of ["app", "pages", "src/pages"]) {
      expect(existsSync(path.join(root, dir)), dir).toBe(false);
    }
    for (const name of ["middleware", "proxy"]) {
      for (const ext of ["js", "ts", "mjs"]) {
        for (const at of ["", "src/"]) expect(existsSync(path.join(root, `${at}${name}.${ext}`)), `${at}${name}.${ext}`).toBe(false);
      }
    }
  });

  it("서버 전용 코드(환경 변수, DB 드라이버, server-only)는 src/server/·src/app/api/ 에만 있고, src/server/ 의 파일은 모두 server-only 다", () => {
    const serverOnly: [RegExp, string][] = [
      [/\bprocess\.env\b/, "환경 변수"],
      [/from\s+["'](pg|@electric-sql\/pglite)["']|import\(\s*["'](pg|@electric-sql\/pglite)["']\s*\)/, "DB 드라이버"],
      [/^\s*import\s+["']server-only["']/m, "server-only"],
    ];
    for (const file of code.filter((f) => !isServerCode(f))) {
      for (const [pattern, what] of serverOnly) expect(pattern.test(read(file)), `${file}: ${what}`).toBe(false);
    }
    const server = code.filter((file) => file.startsWith("src/server/"));
    expect(server.length).toBeGreaterThan(3);
    for (const file of server) expect(read(file), file).toMatch(/^import "server-only";$/m);
  });

  it("브라우저에서 도는 코드는 서버 코드를 불러오지 않는다", () => {
    expect(client.size).toBeGreaterThan(5);
    for (const file of client) expect(isServerCode(file), `${file}: 브라우저 묶음에 든 서버 코드`).toBe(false);
  });

  it("비밀값의 이름은 서버 코드에만 있고, 브라우저로 내보내는 환경 변수(NEXT_PUBLIC_)나 next.config 의 env 가 없다", () => {
    for (const file of sources.filter((f) => !isServerCode(f))) {
      const text = read(file);
      for (const name of SECRET_NAMES) expect(text.includes(name), `${file}: ${name}`).toBe(false);
    }
    for (const file of sources) expect(read(file).includes("NEXT_PUBLIC_"), `${file}: NEXT_PUBLIC_`).toBe(false);
    expect(nextConfig.env).toBeUndefined();
    expect(read("next.config.ts")).not.toMatch(/NEXT_PUBLIC_|\benv\s*:/);
  });
});

describe("밖으로 나가는 요청과 저장 (docs/commitments.md 의 2)", () => {
  // 연 파일은 브라우저 안에서만 읽는다. 분석 도구·외부 글꼴·제3자 스크립트를 넣지 않는다. 브라우저 쪽 코드는 같은 사이트의
  // /api/ 말고는 요청하지 않는다. 법제처·GitHub 링크처럼 사용자가 눌러서 가는 주소는 데이터(팩 메타데이터, GitHub 이 돌려준
  // html_url)에서 온다. 서버 코드(src/server/)만 GitHub API 의 주소를 적는다.
  const client = clientCode();
  const anywhere: [RegExp, string][] = [
    [/sendBeacon|XMLHttpRequest|WebSocket|EventSource/, "네트워크 API"],
    [/next\/script|next\/font\/google/, "외부 스크립트·글꼴"],
    [/@import\s+url\(/, "CSS 외부 불러오기"],
  ];
  // 브라우저 저장소를 어디까지 쓸지는 아직 정하지 않았다(docs/commitments.md 의 4). 정해질 때까지 쓰지 않는다. 쿠키도 없다.
  const storage: [RegExp, string][] = [
    [/localStorage|sessionStorage|indexedDB|document\.cookie/, "브라우저 저장소"],
    [/\bcookies\s*\(|set-cookie|\.cookies\b/i, "쿠키"],
  ];

  it.each(sources.filter((file) => /\.(js|jsx|mjs|cjs|ts|tsx|css)$/.test(file)))("%s", (file) => {
    const text = read(file);
    for (const [pattern, what] of [...anywhere, ...storage]) {
      expect(pattern.test(text), `${file}: ${what}`).toBe(false);
    }
    if (!file.startsWith("src/server/")) {
      // XML 이름공간(SVG 의 xmlns)은 주소 모양일 뿐 요청이 아니라서 뺀다.
      expect(/https?:\/\/(?!www\.w3\.org\/)/.test(text), `${file}: 소스에 적힌 외부 주소`).toBe(false);
    }
    if (isServerCode(file)) return;
    // 서버 코드 밖의 fetch 는 브라우저 부품이 같은 사이트의 /api/ 를 부르는 것뿐이다(주소를 글자로 적고 /api/ 로 시작한다).
    for (const match of text.matchAll(/\bfetch\s*\(\s*(.{0,12})/g)) {
      expect(client.has(file), `${file}: 서버 부품의 fetch`).toBe(true);
      expect(match[1], `${file}: /api/ 밖으로 가는 fetch`).toMatch(/^["'`]\/api\//);
    }
  });
});

describe("합성 예시 표시와 면책", () => {
  it("데모와 뷰어가 예시임을 밝힌다", () => {
    expect(read("src/app/demo/page.tsx")).toContain("합성 예시");
    expect(read("src/components/viewer/ReportViewer.tsx")).toContain("합성 예시");
  });

  it("면책 문구가 모든 화면의 바닥에 있다", () => {
    expect(read("src/app/layout.tsx")).toContain("SITE.disclaimer");
  });
});

describe("주소", () => {
  it("정책 주소 이름에 점이 없고 서로 겹치지 않는다", () => {
    const slugs = packMeta.policies.map((p) => policySlug(p.id));
    expect(slugs.every((slug) => !slug.includes("."))).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
