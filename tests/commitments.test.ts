import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packMeta, policySlug } from "@/lib/pack";
import nextConfig from "../next.config";
import { root, walk } from "./helpers";
import { BANNED_WORDING } from "./wording";

// docs/commitments.md 의 약속 가운데 기계로 지킬 수 있는 것.
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

describe("1층 약속: 서버가 없다 (관문 G2 전까지)", () => {
  it("next.config.ts 가 정적 내보내기다", () => {
    // 글자가 아니라 값을 본다. 주석 처리하면 실패한다.
    expect(nextConfig.output).toBe("export");
  });

  it("서버에서 도는 파일이 없다", () => {
    const serverFile = /(^|\/)(route|proxy|middleware)\.(js|jsx|mjs|cjs|ts|tsx)$/;
    for (const file of sources) {
      expect(serverFile.test(file), `${file}: 서버에서 도는 파일`).toBe(false);
      expect(/(^|\/)pages\/api\//.test(file), `${file}: pages API`).toBe(false);
    }
    for (const file of code) {
      expect(/["']use server["']/.test(read(file)), `${file}: server action`).toBe(false);
    }
  });

  it("페이지는 src/app 아래에만 있다", () => {
    for (const dir of ["app", "pages", "src/pages"]) {
      expect(existsSync(path.join(root, dir)), dir).toBe(false);
    }
    for (const name of ["middleware", "proxy"]) {
      for (const ext of ["js", "ts", "mjs"]) {
        expect(existsSync(path.join(root, `${name}.${ext}`)), `${name}.${ext}`).toBe(false);
      }
    }
  });
});

describe("1층 약속: 밖으로 나가는 요청과 저장이 없다", () => {
  // 연 파일은 브라우저 안에서만 읽는다. 분석 도구·외부 글꼴·제3자 스크립트를 넣지 않는다.
  // 법제처 링크처럼 사용자가 눌러서 가는 주소는 데이터(data/pack-meta.json)에서 온다. 소스에는 주소를 적지 않는다.
  const network: [RegExp, string][] = [
    [/\bfetch\s*\(/, "fetch"],
    [/sendBeacon|XMLHttpRequest|WebSocket|EventSource/, "네트워크 API"],
    [/next\/script|next\/font\/google/, "외부 스크립트·글꼴"],
    // XML 이름공간(SVG 의 xmlns)은 주소 모양일 뿐 요청이 아니라서 뺀다.
    [/https?:\/\/(?!www\.w3\.org\/)/, "소스에 적힌 외부 주소"],
    [/@import\s+url\(/, "CSS 외부 불러오기"],
  ];
  // 브라우저 저장소를 어디까지 쓸지는 아직 정하지 않았다(docs/ROADMAP.md). 정해질 때까지 쓰지 않는다.
  const storage: [RegExp, string][] = [[/localStorage|sessionStorage|indexedDB|document\.cookie/, "브라우저 저장소"]];

  it.each(sources.filter((file) => /\.(js|jsx|mjs|cjs|ts|tsx|css)$/.test(file)))("%s", (file) => {
    const text = read(file);
    for (const [pattern, what] of [...network, ...storage]) {
      expect(pattern.test(text), `${file}: ${what}`).toBe(false);
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
