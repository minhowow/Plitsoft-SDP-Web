import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { policyHref, policySlug } from "@/lib/pack";
import { SITE } from "@/lib/site";
import { elementAt, elementsOf, readPackFile } from "../helpers";
import { DIGEST_NOTE, expectedPolicyPage, plain, POLICY_FRAME, readAround, readPolicyPage } from "../policy-page";
import { assertFreshBuild, outDir } from "./site";

// 빌드된 out/ 의 파일을 본다. 브라우저는 쓰지 않지만 빌드 뒤에 돌아야 해서 이 단계(`npm run test:browser`)에 둔다.
//
// out/ 의 어느 파일에도 팩 작성자 메모의 글이 없어야 한다(docs/commitments.md 의 1, ROADMAP 8번에 넘어와 있던 확인).
// tests/bundle.test.ts 는 소스의 불러오기만 따라가 본다. 여기서는 배포되는 파일 자체를 본다. 쪽의 HTML, 서버 부품의
// 내용(.txt), JS 묶음, CSS 가 모두 들어 있다.
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

/** out/ 아래 모든 파일(절대 경로). */
function outFiles(dir = outDir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? outFiles(full) : [full];
  });
}

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

describe("빌드된 out/ 의 파일", () => {
  // out/ 이 없거나 소스보다 낡았으면 까닭을 알리고 멈춘다.
  beforeAll(assertFreshBuild);

  const files = existsSync(outDir) ? outFiles() : [];
  const contents = files.map((file) => ({ file: path.relative(outDir, file), text: readFileSync(file, "utf8") }));
  const found = (fragment: string) => contents.filter(({ text }) => text.includes(fragment)).map(({ file }) => file);

  it("볼 파일이 있다 (쪽, 서버 부품의 내용, JS 묶음, CSS)", () => {
    const kinds = new Set(files.map((file) => path.extname(file)));
    for (const kind of [".html", ".txt", ".js", ".css"]) expect(kinds.has(kind), kind).toBe(true);
    expect(files.length).toBeGreaterThan(40);
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
    // 정책 다섯에 메모가 둘씩 있다. 메모마다 찾을 조각이 하나는 있어야 한다.
    expect(memos).toHaveLength(packFile.policies.length * 2);
    for (const { policy, text } of memos) {
      const pieces = fragments(text);
      expect(pieces.length, `${policy}: ${text.slice(0, 30)}`).toBeGreaterThan(0);
      for (const piece of pieces) expect(found(piece), `${policy}: ${piece}`).toEqual([]);
    }
  });

  it("조문별 검사 기록의 칸 앞 이름: 빈 대체 글을 단 선언 앞에, 대체 글 없는 선언이 배포되는 CSS 에 남아 있다", () => {
    // 쌓은 표의 칸 앞 이름은 CSS 가 그린다. 빈 대체 글(`content: … / ""`)을 줘서 화면 낭독기가 그 이름을 칸 머리와 함께 두 번
    // 읽지 않게 한다(src/app/globals.css). 그 문법을 모르는 브라우저는 그 선언을 버리므로, 앞에 대체 글 없는 선언을 하나 더
    // 둔다. 앞의 것이 빌드에서 빠지면 그런 브라우저에서는 칸 앞 이름이 아예 그려지지 않는다. 브라우저 시험은 Chrome 으로만
    // 보고, Chrome 은 뒤의 선언을 쓴다. 그래서 배포되는 CSS 를 직접 읽는다.
    const css = contents.filter(({ file }) => file.endsWith(".css")).map(({ text }) => text);
    const rules = css.flatMap((text) => [...text.matchAll(/\.record-table tbody td::?before\s*\{([^}]*)\}/g)].map((match) => match[1]));
    expect(rules).toHaveLength(1);
    const contentOf = rules[0]
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.startsWith("content:"))
      .map((declaration) => declaration.replace(/\s+/g, ""));
    expect(contentOf).toEqual(["content:attr(data-label)", 'content:attr(data-label)/""']);
  });
});

describe("빌드된 out/ 의 조문 도감 쪽", () => {
  beforeAll(assertFreshBuild);

  const { pack, policies } = packFile;
  const named = policies.map((policy) => [policy.id, policy] as const);
  const file = (...parts: string[]) => path.join(outDir, "policy", ...parts);
  /** 정책 쪽의 HTML. 빌드가 내보낸 파일 그대로다. */
  const pageOf = (id: string) => readFileSync(file(policySlug(id), "index.html"), "utf8");
  /** 파일에 적힌 바깥 주소 전부(HTML 의 링크와, 쪽을 옮겨 올 때 쓰는 내용에 실린 것). */
  const outsideUrls = (html: string) => [...new Set([...html.matchAll(/https?:[^\s"'\\<>]*/g)].map((match) => match[0]))].sort();

  it("정책마다 쪽이 하나씩 있다. 주소의 이름에는 점이 없다", () => {
    const folders = readdirSync(file()).filter((name) => statSync(file(name)).isDirectory());
    expect(folders.sort()).toEqual(policies.map((policy) => policySlug(policy.id)).sort());
    expect(folders.length).toBeGreaterThan(1);
    for (const name of folders) {
      expect(name).not.toContain(".");
      expect(existsSync(file(name, "index.html")), name).toBe(true);
    }
  });

  // 이름은 ROADMAP 6번의 완료 조건 그대로다. 정책의 수는 여기에 못 박지 않고 팩 메타데이터의 정책을 모두 본다(지금 다섯이다).
  it("정책 5개의 쪽이 같은 틀로 읽힌다", () => {
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

  it("조문 원문은 data/pack-meta.json 의 것과 글자 그대로 같다", () => {
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
        // 글자 하나, 줄바꿈 하나, 빈칸 하나까지 같다. 줄이거나 다듬지 않았다.
        expect(shown.statute?.text === legal.text, `${policy.id} ${legal.label}`).toBe(true);
        expect(shown.statute?.text.length, legal.label).toBe(legal.text.length);
        expect(shown.missing, legal.label).toBeNull();
        boxes += 1;
      }
      // 원문 상자는 원문이 있는 조문의 수만큼만 있다.
      expect(elementsOf(html, '<pre class="statute">'), policy.id).toHaveLength(policy.legal.filter((legal) => legal.text).length);
    }
    // 빈 것끼리 견준 것이 아니다.
    expect(boxes).toBeGreaterThan(0);
  });

  it.each(named)("%s: 밖으로 가는 주소는 팩 메타데이터의 법제처 링크뿐이고, 쪽 안의 자리로 가는 링크는 없다", (_, policy) => {
    const html = pageOf(policy.id);
    const page = readPolicyPage(html);
    expect(page.hrefs).toEqual(policy.legal.map((legal) => legal.url));
    // 쪽의 다른 곳(머리, 바닥, 쪽을 옮겨 올 때 쓰는 내용)에도 그 밖의 바깥 주소는 없다.
    expect(outsideUrls(html)).toEqual([...new Set(policy.legal.flatMap((legal) => legal.url ?? []))].sort());
    expect(outsideUrls(readFileSync(file(policySlug(policy.id), "index.txt"), "utf8"))).toEqual(outsideUrls(html));
    // 링크는 눌러야 나간다. 스스로 받아 오는 것(그림, 틀, 글꼴)에는 바깥 주소가 없다.
    for (const tag of html.match(/<(?:img|iframe|script|link|source|video|audio|embed|object)\b[^>]*>/g) ?? []) {
      expect(tag, tag).not.toMatch(/https?:/);
    }
    expect(html).not.toMatch(/href="#/);
  });

  it("목록(/policy/)의 링크가 정책 쪽의 주소이고, 이 도감을 만든 팩 판이 적혀 있다", () => {
    const html = readFileSync(file("index.html"), "utf8");
    const items = elementsOf(elementAt(html, html.indexOf('<ul class="policy-index">')), "<li>");
    expect(items).toHaveLength(policies.length);
    for (const [i, policy] of policies.entries()) {
      const link = elementAt(items[i], items[i].indexOf("<a "));
      // 빌드된 쪽의 주소는 끝에 빗금이 있다(쪽마다 폴더/index.html 로 내보낸다).
      expect(/href="([^"]*)"/.exec(link)?.[1], policy.id).toBe(policyHref(policy.id));
      expect(existsSync(path.join(outDir, policyHref(policy.id), "index.html")), policy.id).toBe(true);
      expect(plain(link)).toBe(policy.title);
    }
    expect(plain(html)).toContain(`이 도감을 만든 팩 판은 ${pack.digest} 입니다. ${DIGEST_NOTE}`);
    expect(outsideUrls(html)).toEqual([]);
  });
});
