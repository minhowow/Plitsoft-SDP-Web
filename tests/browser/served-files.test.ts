import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { caseChecklistHref, casesFile, casesHref } from "@/lib/cases";
import { policyHref, policySlug } from "@/lib/pack";
import { analysisHref, checklistHref, repoHref } from "@/lib/service/href";
import { syntheticRepositories, syntheticStore } from "@/lib/service/synthetic";
import { SITE } from "@/lib/site";
import { elementAt, elementsOf, readPackFile, root } from "../helpers";
import { decodeEntities, expectedPolicyPage, plain, POLICY_FRAME, readAround, readPolicyIndex, readPolicyPage } from "../policy-page";
import { nextDir, serveSite, type Site } from "./site";

// 빌드된 사이트가 브라우저에 내주는 것을 본다. 브라우저는 쓰지 않지만 빌드 뒤에 돌아야 해서 이 단계(`npm run test:browser`)에 둔다.
// B1 까지는 out/ 의 정적 파일을 읽었다. B2 에서 서버가 생겨(`next start`) 분석 서비스의 쪽은 요청 때 그린다. 그래서 쪽의 HTML 은
// 띄운 서버(합성 저장소)에서 받고, JS 묶음·CSS 는 빌드가 내놓은 .next/static 에서, 미리 그려 둔 쪽(조문 도감 등)이 쪽을 옮겨 올 때
// 쓰는 내용(.rsc)은 .next/server/app 에서 읽는다. 요청 때 그리는 쪽의 그 내용은 HTML 안에 함께 실려 있다.
//
// 어느 것에도 팩 작성자 메모의 글이 없어야 한다(docs/commitments.md 의 1, ROADMAP 8번에 넘어와 있던 확인).
// tests/bundle.test.ts 는 소스의 불러오기만 따라가 본다. 여기서는 브라우저가 받는 것 자체를 본다.
//
// 조문 도감의 정책 쪽도 여기서 본다(ROADMAP 6번의 완료 조건). 쪽이 async 라 부품 시험으로는 그릴 수 없어서, 빌드된
// HTML 을 읽어 팩 메타데이터와 견준다. 쪽이 그리는 부품은 tests/policy.test.tsx 가 같은 방법으로 읽는다. 쪽(page.tsx)이
// 그 부품 밖에 더한 것은 부품 시험에 보이지 않는다. 여기서 틀의 둘레를 읽어 본다.

/**
 * 견줄 팩 메타데이터. data/pack-meta.json 을 파일에서 직접 읽은 것이다. 소스가 읽어 들인 것(`@/lib/pack` 의 packMeta)과
 * 견주지 않는다. 쪽도 그것으로 그리므로, 읽어 들이는 곳이 조문 원문이나 날짜를 고치면 쪽이 파일과 달라져도 기대값이 함께
 * 달라져 통과한다(6번의 셋째 검토에서 사본에 넣어 보고 드러났다). 소스에서는 주소를 만드는 함수만 가져온다.
 */
const packFile = readPackFile();

/** 받아 볼 쪽: 첫 화면, 결과 보기, 데모, 구조, 조문 도감(목록과 정책마다), 사례(목록과 사례마다), 검색, 합성 저장소마다, 합성 분석마다. */
const hits = syntheticRepositories();
const PAGES = [
  "/",
  "/view/",
  "/demo/",
  "/demo/review/",
  "/how/",
  "/policy/",
  ...packFile.policies.map((policy) => policyHref(policy.id)),
  casesHref(),
  ...casesFile.cases.map((c) => casesHref(c.slug)),
  ...casesFile.cases.map((c) => caseChecklistHref(c.slug)),
  checklistHref("example-studio", "genai-chat", "4qqa6fdx2h"),
  "/search/",
  "/search/?q=example",
  ...hits.map(({ repository: r }) => repoHref(r.owner, r.name)),
  ...(await Promise.all(hits.map(({ repository: r }) => syntheticStore.listAnalyses(r.owner, r.name))))
    .flat()
    .map((a) => analysisHref(a.owner, a.name, a.id)),
];

/** 쪽 주소를 out/ 때의 파일 이름처럼 적는다: "/" → "index.html", "/view/" → "view/index.html", 질의는 이름에 붙인다. */
const pageFile = (pathname: string, ext: "html" | "txt") => {
  const [route, query] = pathname.split("?");
  const dir = route.replace(/^\//, "");
  return path.join(dir, query ? `?${query}` : "", `index.${ext}`);
};

/** .next 아래의 모든 파일(저장소 기준 경로). */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

let site: Site | undefined;
/** 브라우저가 받는 것: 쪽의 HTML, 미리 그린 쪽의 내용(.txt 로 적는다), JS 묶음, CSS. */
const contents: { file: string; text: string }[] = [];
let favicon: Buffer = Buffer.alloc(0);

beforeAll(async () => {
  site = await serveSite();
  for (const pathname of PAGES) {
    const response = await fetch(`${site.origin}${pathname}`);
    if (response.status !== 200) throw new Error(`${pathname}: ${response.status}`);
    contents.push({ file: pageFile(pathname, "html"), text: await response.text() });
  }
  // 미리 그린 쪽이 쪽을 옮겨 올 때 쓰는 내용. 서버가 이 파일을 그대로 내준다.
  const app = path.join(nextDir, "server", "app");
  for (const file of filesUnder(app).filter((f) => f.endsWith(".rsc"))) {
    const route = path.relative(app, file).replace(/\.rsc$/, "");
    if (route.startsWith("_")) continue;
    contents.push({ file: path.join(route === "index" ? "" : route, "index.txt"), text: readFileSync(file, "utf8") });
  }
  for (const file of filesUnder(path.join(nextDir, "static")).filter((f) => /\.(js|css)$/.test(f))) {
    contents.push({ file: path.join("_next", path.relative(nextDir, file)), text: readFileSync(file, "utf8") });
  }
  favicon = Buffer.from(await (await fetch(`${site.origin}/favicon.ico`)).arrayBuffer());
}, 60_000);

afterAll(async () => {
  await site?.close();
});

/**
 * 글에서 찾을 조각을 뽑는다. 따옴표·꺾쇠·역빗금·줄바꿈은 HTML 과 JS 에서 다른 글자로 바뀌어 실리므로, 그런 글자에서
 * 끊고 남은 조각 가운데 긴 것(20자 이상)만 쓴다. 짧은 조각("시행 2026-08-20" 등)은 다른 글에도 나온다.
 */
function fragments(text: string): string[] {
  return text
    .split(/["'<>&\\\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 20);
}

/**
 * 빌드된 쪽에서 본문(main) 밖의 것: 사이트의 머리와 바닥. 본문은 비워서 자리만 남긴다. React 가 끼워 넣는 주석과 스크립트는
 * 걷어 낸다(Next 가 바닥 뒤에 싣는 스크립트는 쪽을 옮겨 올 때 쓰는 내용이라 쪽마다 다르다). 조문 도감의 쪽을 읽는 도구
 * (`readAround`)와 같은 방법이다. 그 도구는 정책 쪽의 틀(article)이 있는 쪽만 읽는다.
 */
function chromeOf(html: string): string {
  const bare = html.replace(/<!--[\s\S]*?-->/g, "");
  const body = elementAt(bare, bare.indexOf("<body"));
  const mains = elementsOf(body, "<main");
  if (mains.length !== 1) throw new Error(`쪽의 본문(main)이 하나가 아닙니다: ${mains.length}개`);
  const [main] = mains;
  const start = body.indexOf(main);
  const outside = `${body.slice(0, start)}${main.slice(0, main.indexOf(">") + 1)}</main>${body.slice(start + main.length)}`;
  return outside.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
}

/** 빌드된 쪽의 본문(main) 바로 아래 요소들의 여는 태그. 요소 사이에 빈칸이 아닌 글이 있으면 실패한다. */
function mainChildren(html: string): string[] {
  const [main] = elementsOf(html.replace(/<!--[\s\S]*?-->/g, ""), "<main");
  const inner = main.slice(main.indexOf(">") + 1, -"</main>".length);
  const tags: string[] = [];
  let at = 0;
  for (let next = inner.indexOf("<"); next !== -1; next = inner.indexOf("<", at)) {
    if (inner.slice(at, next).trim() !== "") throw new Error(`본문의 요소 사이에 글이 있습니다: ${inner.slice(at, next).slice(0, 60)}`);
    const element = elementAt(inner, next);
    tags.push(element.slice(0, element.indexOf(">") + 1));
    at = next + element.length;
  }
  if (inner.slice(at).trim() !== "") throw new Error(`본문의 끝에 글이 있습니다: ${inner.slice(at).slice(0, 60)}`);
  return tags;
}

describe("빌드된 사이트가 내주는 것", () => {
  const found = (fragment: string) => contents.filter(({ text }) => text.includes(fragment)).map(({ file }) => file);

  it("볼 것이 있다 (쪽, 미리 그린 쪽의 내용, JS 묶음, CSS)", () => {
    const kinds = new Set(contents.map(({ file }) => path.extname(file)));
    for (const kind of [".html", ".txt", ".js", ".css"]) expect(kinds.has(kind), kind).toBe(true);
    expect(contents.length).toBeGreaterThan(40);
    // 분석 서비스의 쪽(요청 때 그린다)도 들어 있다.
    expect(contents.some(({ file }) => file === pageFile("/r/example-org/kids-signup/a/wtk33e9zuf/", "html"))).toBe(true);
  });

  it("같은 방법으로 찾으면, 화면에 싣는 팩의 글(정책마다 개발자에게 할 질문)은 나온다", () => {
    // 찾는 방법이 듣는지 본다. 이것이 나오지 않으면 아래 시험은 아무것도 찾지 못해서 통과하는 것이다.
    for (const policy of packFile.policies) {
      const pieces = fragments(policy.ask_developer ?? "");
      expect(pieces.length, policy.id).toBeGreaterThan(0);
      for (const piece of pieces) expect(found(piece).length, `${policy.id}: ${piece}`).toBeGreaterThan(0);
    }
  });

  it("팩 작성자 메모의 글은 어느 파일에도 없다", () => {
    const memos = packFile.policies.flatMap((policy) =>
      Object.values(policy.rationale ?? {})
        .filter((text): text is string => typeof text === "string" && text.length > 0)
        .map((text) => ({ policy: policy.id, text })),
    );
    // 정책마다 메모가 둘씩 있다. 메모마다 찾을 조각이 하나는 있어야 한다.
    expect(memos).toHaveLength(packFile.policies.length * 2);
    for (const { policy, text } of memos) {
      const pieces = fragments(text);
      expect(pieces.length, `${policy}: ${text.slice(0, 30)}`).toBeGreaterThan(0);
      for (const piece of pieces) expect(found(piece), `${policy}: ${piece}`).toEqual([]);
    }
  });

  it("사이트의 머리와 바닥은 모든 쪽에서 글자까지 같다. 결과 보기와 데모의 본문(main)에는 정해 둔 것뿐이다", () => {
    // 조문 도감의 쪽에만 있던 확인(아래 "정책마다 쪽이 같은 틀로 읽힌다"의 틀 둘레)을 모든 쪽으로 넓힌다(ROADMAP 8번).
    // 쪽(page.tsx)이 한 쪽의 머리나 바닥에만 글을 더하거나, 본문에 틀 말고 다른 것을 넣으면 여기서 걸린다.
    const pages = contents.filter(({ file }) => file.endsWith(".html"));
    expect(pages.map(({ file }) => file)).toEqual(expect.arrayContaining(["index.html", path.join("view", "index.html"), path.join("demo", "index.html")]));
    const chromes = pages.map(({ file, text }) => ({ file, chrome: chromeOf(text) }));
    for (const { file, chrome } of chromes) expect(chrome, file).toBe(chromes[0].chrome);
    // 빈 것끼리 견준 것이 아니다. 사이트의 머리와 바닥이 있다. 조문 도감의 쪽을 읽는 도구가 읽은 둘레와도 같다.
    expect(chromes[0].chrome).toContain('<header class="site-header">');
    expect(plain(chromes[0].chrome)).toContain(SITE.disclaimer);
    const policyPage = contents.find(({ file }) => file === pageFile(policyHref(packFile.policies[0].id), "html"))!.text;
    expect(readAround(policyPage).chrome).toBe(chromes[0].chrome);

    // 결과 보기와 데모의 본문: 제목(데모는 제목과 이름표 `합성 예시` 의 줄), 그리고 부품 하나. 그 사이와 둘레에 다른 글이나
    // 요소가 없다. (D5) 머리말(p.lede)은 지웠다(docs/redesign.md 3장).
    const html = (dir: string) => contents.find(({ file }) => file === path.join(dir, "index.html"))!.text;
    expect(mainChildren(html("view"))).toEqual(["<h1>", '<div class="viewer">']);
    expect(mainChildren(html("demo"))).toEqual(['<div class="ttl demo-head">', '<div class="demo">']);
  });

  it.each([
    ["조문별 검사 기록의 표", /\.record-table tbody td::?before\s*\{([^}]*)\}/g],
    ["데모의 두 결과의 표", /\.compare tbody td::?before\s*\{([^}]*)\}/g],
  ])("%s의 칸 앞 이름: 빈 대체 글을 단 선언 앞에, 대체 글 없는 선언이 배포되는 CSS 에 남아 있다", (_, rule) => {
    // 쌓은 표의 칸 앞 이름은 CSS 가 그린다. 빈 대체 글(`content: … / ""`)을 줘서 화면 낭독기가 그 이름을 칸 머리와 함께 두 번
    // 읽지 않게 한다(src/app/globals.css). 그 문법을 모르는 브라우저는 그 선언을 버리므로, 앞에 대체 글 없는 선언을 하나 더
    // 둔다. 앞의 것이 빌드에서 빠지면 그런 브라우저에서는 칸 앞 이름이 아예 그려지지 않는다. 브라우저 시험은 Chrome 으로만
    // 보고, Chrome 은 뒤의 선언을 쓴다. 그래서 배포되는 CSS 를 직접 읽는다. 데모의 표는 9번에서 기록과 같게 했다.
    const css = contents.filter(({ file }) => file.endsWith(".css")).map(({ text }) => text);
    const rules = css.flatMap((text) => [...text.matchAll(rule)].map((match) => match[1]));
    expect(rules).toHaveLength(1);
    const contentOf = rules[0]
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.startsWith("content:"))
      .map((declaration) => declaration.replace(/\s+/g, ""));
    expect(contentOf).toEqual(["content:attr(data-label)", 'content:attr(data-label)/""']);
  });

  it("파비콘: /favicon.ico 가 소스의 파일(src/app/favicon.ico) 그대로이고, 모든 쪽의 머리에 그 파일을 가리키는 link 가 하나 있다", () => {
    // 9번 전에는 파비콘이 없어 브라우저가 스스로 청한 /favicon.ico 가 404 로 돌아왔다(브라우저 시험이 그 콘솔 오류를 봐주고
    // 있었다). Next 의 파일 규칙(app/favicon.ico)으로 두면 서버가 그 파일을 내주고 쪽마다 link 를 단다.
    const source = readFileSync(path.join(root, "src", "app", "favicon.ico"));
    expect(favicon.equals(source)).toBe(true);
    // ICO 파일이다(머리의 예약 0, 종류 1, 그림이 하나 이상).
    expect([source.readUInt16LE(0), source.readUInt16LE(2), source.readUInt16LE(4) > 0]).toEqual([0, 1, true]);
    const pages = contents.filter(({ file }) => file.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(5);
    for (const { file, text } of pages) {
      const head = elementAt(text, text.indexOf("<head"));
      const icons = [...head.matchAll(/<link\b[^>]*\brel="(?:shortcut )?icon"[^>]*>/g)].map((match) => match[0]);
      expect(icons, file).toHaveLength(1);
      expect(icons[0], file).toMatch(/\bhref="\/favicon\.ico(\?[^"]*)?"/);
    }
  });
});

describe("빌드된 사이트의 조문 도감 쪽", () => {
  const { pack, policies } = packFile;
  const named = policies.map((policy) => [policy.id, policy] as const);
  const textOf = (file: string) => {
    const found = contents.find((entry) => entry.file === file);
    if (!found) throw new Error(`받은 것에 없습니다: ${file}`);
    return found.text;
  };
  /** 정책 쪽의 HTML. 서버가 내준 그대로다. */
  const pageOf = (id: string) => textOf(path.join("policy", policySlug(id), "index.html"));
  /** 파일에 적힌 바깥 주소 전부(HTML 의 링크와, 쪽을 옮겨 올 때 쓰는 내용에 실린 것). */
  const outsideUrls = (html: string) => [...new Set([...html.matchAll(/https?:[^\s"'\\<>]*/g)].map((match) => match[0]))].sort();

  it("정책마다 쪽이 하나씩 미리 그려져 있다. 주소의 이름에는 점이 없고, 팩에 없는 이름의 쪽은 없다", async () => {
    const built = readdirSync(path.join(nextDir, "server", "app", "policy"))
      .filter((name) => name.endsWith(".html"))
      .map((name) => name.replace(/\.html$/, ""));
    expect(built.sort()).toEqual(policies.map((policy) => policySlug(policy.id)).sort());
    expect(built.length).toBeGreaterThan(1);
    for (const name of built) expect(name).not.toContain(".");
    expect((await fetch(`${site!.origin}/policy/no-such-policy/`)).status).toBe(404);
  });

  // 이름은 ROADMAP 6번의 완료 조건 그대로다. 정책의 수는 여기에 못 박지 않고 팩 메타데이터의 정책을 모두 본다(지금 여섯이다).
  it("정책마다 쪽이 같은 틀로 읽힌다", () => {
    const pages = policies.map((policy) => pageOf(policy.id));
    const frames = pages.map((html) => readPolicyPage(html).frame);
    // 틀은 하나다. 조문과 규칙의 수가 정책마다 달라도 같다.
    expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBe(1);
    for (const [i, frame] of frames.entries()) expect(frame, policies[i].id).toEqual(POLICY_FRAME);
    // 틀 밖에는 아무것도 없다. 위에서 읽은 것은 틀(article) 안이다. 쪽(page.tsx)이 한 정책의 쪽에만 틀 밖에 글을 더해도 읽은
    // 틀은 그대로다. 쪽의 본문(main)에는 그 틀 하나뿐이고, 본문 밖(사이트의 머리와 바닥)은 정책마다 글자까지 같다.
    const around = pages.map(readAround);
    for (const [i, read] of around.entries()) {
      expect(read.beside, policies[i].id).toEqual(["", ""]);
      expect(read.chrome, policies[i].id).toBe(around[0].chrome);
    }
    // 빈 것끼리 견준 것이 아니다. 본문 밖에 사이트의 머리와 바닥이 있다.
    expect(around[0].chrome).toContain('<header class="site-header">');
    expect(plain(around[0].chrome)).toContain(SITE.disclaimer);
  });

  it.each(named)("%s: 그 틀에 담긴 값과 글이 팩 메타데이터 그대로다", (_, policy) => {
    const html = pageOf(policy.id);
    // 쪽에 정책이 하나다. 제목이 창의 이름에도 있다.
    expect(elementsOf(html, '<article class="policy-page">')).toHaveLength(1);
    expect(elementsOf(html, "<h1>")).toHaveLength(1);
    expect(plain(elementAt(html, html.indexOf("<title>")))).toBe(`${policy.title} · ${SITE.name}`);
    expect(readPolicyPage(html)).toEqual({ ...expectedPolicyPage(policy, pack), frame: POLICY_FRAME });
  });

  it("조문 원문은 data/pack-meta.json 의 것과 글자 그대로 같다 (줄바꿈 하나, 빈칸 하나까지)", () => {
    let boxes = 0;
    for (const policy of policies) {
      const html = pageOf(policy.id);
      const page = readPolicyPage(html);
      // 조문마다 한 자리다. 차례도 팩의 차례다.
      expect(page.legal.map((legal) => legal.label), policy.id).toEqual(policy.legal.map((legal) => legal.label));
      for (const [i, legal] of policy.legal.entries()) {
        const shown = page.legal[i];
        if (!legal.text) {
          // 원문이 없는 조문에는 없다고 적혀 있다. 다른 글로 채우지 않는다.
          expect(shown.statute, legal.label).toBeNull();
          expect(shown.missing, legal.label).toBe("원문이 실려 있지 않습니다.");
          continue;
        }
        expect(shown.statute === legal.text, `${policy.id} ${legal.label}`).toBe(true);
        expect(shown.statute?.length, legal.label).toBe(legal.text.length);
        expect(shown.missing, legal.label).toBeNull();
        boxes += 1;
      }
      // 원문 상자는 원문이 있는 조문의 수만큼만 있다.
      expect(elementsOf(html, '<pre class="statute">'), policy.id).toHaveLength(policy.legal.filter((legal) => legal.text).length);
    }
    // 빈 것끼리 견준 것이 아니다.
    expect(boxes).toBeGreaterThan(0);
  });

  it.each(named)("%s: 밖으로 가는 주소는 팩 메타데이터의 법제처 링크뿐이고, 쪽 안의 링크는 근거 조문과 규칙의 자리뿐이다", (_, policy) => {
    const html = pageOf(policy.id);
    const page = readPolicyPage(html);
    expect(page.hrefs).toEqual(["#legal", "#rules", ...policy.legal.flatMap((legal) => legal.url ?? [])]);
    // 쪽의 다른 곳(머리, 바닥, 쪽을 옮겨 올 때 쓰는 내용)에도 그 밖의 바깥 주소는 없다.
    expect(outsideUrls(html)).toEqual([...new Set(policy.legal.flatMap((legal) => legal.url ?? []))].sort());
    expect(outsideUrls(textOf(path.join("policy", policySlug(policy.id), "index.txt")))).toEqual(outsideUrls(html));
    // 링크는 눌러야 나간다. 스스로 받아 오는 것(그림, 틀, 글꼴)에는 바깥 주소가 없다.
    for (const tag of html.match(/<(?:img|iframe|script|link|source|video|audio|embed|object)\b[^>]*>/g) ?? []) {
      expect(tag, tag).not.toMatch(/https?:/);
    }
    // 바깥 링크는 모두 새 창이고 rel 이 있다.
    for (const anchor of html.match(/<a [^>]*href="https?:[^"]*"[^>]*>/g) ?? []) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
    // 쪽 안의 링크(#…)가 가리키는 자리가 그 쪽에 있다.
    for (const [, id] of html.matchAll(/href="#([^"]*)"/g)) expect(html, id).toContain(` id="${id}"`);
  });

  it("목록(/policy/): 줄마다 정책 쪽의 주소이고, 메타 줄의 팩·판·정책 수가 팩 메타데이터에서 왔다. #status 와 #scope 가 있다", () => {
    const html = textOf(path.join("policy", "index.html"));
    const index = readPolicyIndex(html);
    expect(index.rows.map((row) => row.href)).toEqual(policies.map((policy) => policyHref(policy.id)));
    expect(index.rows.map((row) => [row.title, row.rules])).toEqual(policies.map((policy) => [policy.title, `규칙 ${policy.rules.length}`]));
    for (const policy of policies) expect(contents.some(({ file }) => file === pageFile(policyHref(policy.id), "html")), policy.id).toBe(true);
    expect(index.meta.replace(/\s+/g, " ")).toBe(`팩 ${pack.id} 판 ${pack.digest} 정책 ${policies.length}`);
    expect(index.sections.map((section) => section.id)).toEqual(["status", "scope"]);
    expect(outsideUrls(html)).toEqual([]);
  });

  it("결과 화면들의 `/policy/#status`·`/policy/#scope` 링크와 규칙 id 링크(`/policy/<이름>/#rule-…`)가 가리키는 자리가 빌드된 쪽에 있다", () => {
    const pages = contents.filter(({ file }) => file.endsWith(".html"));
    const links = pages.flatMap(({ file, text }) =>
      [...text.matchAll(/<a [^>]*href="(\/policy\/[^"]*#[^"]*)"/g)].map((match) => ({ file, href: decodeEntities(match[1]) })),
    );
    // 결과 화면(분석 쪽, 데모)이 잇는 링크를 봤다: 상태의 뜻, 검사에 들지 않는 것, 규칙의 자리.
    const hrefs = new Set(links.map((link) => link.href));
    expect(hrefs.has("/policy/#status")).toBe(true);
    expect(hrefs.has("/policy/#scope")).toBe(true);
    const ruleLinks = links.filter((link) => /#rule-/.test(link.href));
    expect(ruleLinks.length).toBeGreaterThan(0);
    for (const { file, href } of links) {
      const [pathname, id] = href.split("#");
      // 끝에 빗금이 있는 주소다(next.config 의 trailingSlash). 그 주소의 쪽이 빌드돼 있다.
      expect(pathname, `${file}: ${href}`).toMatch(/\/$/);
      const target = contents.find((entry) => entry.file === pageFile(pathname, "html"));
      expect(target, `${file}: ${href}`).toBeDefined();
      expect(target!.text, `${file}: ${href}`).toContain(` id="${id}"`);
    }
  });
});
