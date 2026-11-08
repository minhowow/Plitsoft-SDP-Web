import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PolicyIndexPage from "@/app/policy/page";
import { PolicyDetail } from "@/components/policy/PolicyDetail";
import { RuleId } from "@/components/result/RuleId";
import { packMeta, policyHref, ruleAnchor, ruleHref } from "@/lib/pack";
import { sameTextNote } from "@/lib/pack/guide";
import type { Alternative, LegalRef, PolicyMeta, Rule } from "@/lib/pack/types";
import { SCOPE_LEGEND, scopeLabel, scopeNote } from "@/lib/report/scope";
import { STATUS_LABEL, STATUS_LEGEND, STATUS_ORDER } from "@/lib/report/status";
import type { Report } from "@/lib/report/types";
import { SITE } from "@/lib/site";
import { closedDetailsAt, elementsOf, jsonFiles, readJson, textOf } from "./helpers";
import {
  anchorOf,
  ASKED,
  CODE_LEAVES,
  decodeEntities,
  DIFFERS,
  expectedPolicyPage,
  JUDGE_ON,
  NO_TEXT,
  NOT_IN_PACK,
  partingOf,
  plain,
  POLICY_FRAME,
  readAround,
  readPolicyIndex,
  readPolicyPage,
  squash,
  UNDESCRIBED,
  WEAK,
  wholeText,
} from "./policy-page";
import { BANNED_WORDING } from "./wording";

// 조문 도감(`/policy`)을 그려서 본다. 정책 쪽(src/app/policy/[id]/page.tsx)은 async 라 여기서 그리지 않고, 쪽이 그리는
// 부품(PolicyDetail)을 그린다. 빌드된 쪽은 tests/browser/served-files.test.ts 가 같은 방법으로 읽는다.
//
// 팩에 실린 정책은 팩 메타데이터의 값과 통째로 견준다. 팩의 특정 값(날짜, 해시, 글)을 여기에 적어 두지 않는다. 팩 판이
// 바뀌면 값도 바뀐다. 팩에 실린 정책에 없는 모양(값이 빠진 것, 모르는 값, 같은 원문이 되풀이되는 것)은 손으로 만들어 그린다.
//
// 여기서 쓰는 팩 메타데이터는 소스가 읽어 들인 것(packMeta)이다. 부품이 받은 값을 그대로 그리는지를 본다. 그 값이 파일
// (data/pack-meta.json)과 같은지는 tests/contract.test.ts 가 보고, 빌드된 쪽은 tests/browser/ 의 시험이 파일과 직접 견준다.

const { pack, policies } = packMeta;
const named = policies.map((policy) => [policy.id, policy] as const);
const render = (policy: PolicyMeta) => renderToStaticMarkup(<PolicyDetail policy={policy} pack={pack} />);
const read = (policy: PolicyMeta) => readPolicyPage(render(policy));
/** 곁칸의 원문 해시 대조 줄(이름표와 값). 없으면 undefined. */
const hashSide = (page: ReturnType<typeof readPolicyPage>) => page.side.facts.find(([label]) => label === "원문 해시 대조");

const LEGAL: LegalRef = {
  statute: "시험법",
  article: "제1조",
  clause: null,
  label: "시험법 제1조",
  url: null,
  law_id: null,
  effective_from: null,
  text_retrieved: null,
  text_sha256: null,
  text_sha256_matches: null,
  text: null,
};

/** 값이 다 있는 조문(손으로 만든 것). 한 곳만 바꿔 가며 그린다. */
const FULL_LEGAL: LegalRef = {
  ...LEGAL,
  url: "https://law.example/시험법",
  effective_from: "2001-02-03",
  text_retrieved: "2004-05-06",
  text_sha256: "0123456789abcdef".repeat(4),
  text_sha256_matches: true,
  text: "시험법 제1조(목적)\n\n제1조(목적) 이 법은 시험을 위한 것이다.",
};

const STATIC: Alternative = {
  id: "some-static",
  kind: "static",
  strength: "strong",
  question: null,
  evidence: null,
  message: "정적 대안의 알리는 말",
  ask_developer: "정적 대안의 질문인가요?",
  remediation: null,
};

const AI: Alternative = { ...STATIC, id: "some-ai", kind: "ai", strength: null, question: "이 코드에 그 처리가 있는가?", evidence: "required", message: "AI 대안의 알리는 말", remediation: "그 처리를 넣으세요." };

const RULE: Rule = { id: "some-rule", scope: "file", applies_question: null, applies_when: ["some-condition"], alternatives: [STATIC] };

/** 손으로 만든 정책. 팩에 실린 것이 아니다. `change` 로 한 곳만 바꿔 그린다. */
function made(change: (policy: PolicyMeta) => void = () => {}): PolicyMeta {
  const policy: PolicyMeta = {
    id: "test.made-1",
    category: "test",
    title: "시험용 정책",
    ask_developer: "시험용 질문인가요?",
    legal: [structuredClone(FULL_LEGAL)],
    review_by: "2030-01-02",
    rationale: { motivation: "시험용 작성자 메모 하나. 화면에 실리면 안 된다.", implementation: "시험용 작성자 메모 둘. 화면에 실리면 안 된다." },
    rules: [structuredClone({ ...RULE, alternatives: [STATIC, AI] })],
  };
  change(policy);
  return policy;
}

/** 읽은 것이 팩 메타데이터의 값에서 만든 기대값과 통째로 같은지 본다. 틀도 함께 본다. */
function expectWhole(policy: PolicyMeta, frame = POLICY_FRAME) {
  expect(read(policy)).toEqual({ ...expectedPolicyPage(policy, pack), frame });
}

/** 팩 작성자 메모(rationale)의 글에서 15자 넘는 문장들. 쪽에 그 조각이 하나도 없어야 한다. */
const memoSentences = (policy: PolicyMeta) =>
  Object.values(policy.rationale)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .flatMap((memo) => memo.split(/(?<=[.다])\s+/).filter((piece) => piece.length >= 15));

describe("글자 참조를 푸는 도구 (조문 원문을 견주는 데 쓴다)", () => {
  it("이름과 숫자로 적은 참조를 한 번에 푼다. 두 번 풀지 않는다", () => {
    expect(decodeEntities("&lt;개정 2016.3.22&gt; &quot;기간&quot; &#x27;무료&#x27; &#39;A&#39; &amp;")).toBe(`<개정 2016.3.22> "기간" '무료' 'A' &`);
    // "&lt;" 라는 글자 그대로를 적은 것(&amp;lt;)은 "<" 가 되지 않는다.
    expect(decodeEntities("&amp;lt; &amp;amp; &amp;#x27;")).toBe("&lt; &amp; &#x27;");
    expect(decodeEntities("빈칸&nbsp;하나 &#xAC00;&#44032;")).toBe("빈칸\u00a0하나 가가");
  });

  it("모르는 이름은 조용히 넘기지 않는다", () => {
    expect(() => decodeEntities("&copy; 2026")).toThrow("모르는 글자 참조");
    expect(() => decodeEntities("&constructor;")).toThrow("모르는 글자 참조");
  });

  it("태그와 React 가 끼워 넣는 주석을 걷어 낸다", () => {
    expect(plain('<h2>규칙 <!-- -->5<!-- -->개</h2><p class="a">A &amp; B</p>')).toBe("규칙 5개A & B");
  });
});

describe("쪽을 읽는 도구: 읽은 것이 쪽의 전부여야 한다", () => {
  // 읽는 도구는 아는 자리만 찾아 읽는다. 그것만으로는 한 정책의 쪽에만 설명이 더해지거나 구역의 차례가 바뀌어도 읽은 값과
  // 틀이 그대로다. 그래서 읽은 것 밖의 것이 쪽에 있으면 읽지 않고 실패한다. 아래는 쪽의 HTML 을 한 곳씩 고쳐 본 것이다.
  /** 조문이 둘 이상이고, 규칙이 둘 이상이며, 적용 조건·판정자 알림·접어 둔 묻는 글이 있는 정책. 팩에 없으면 손으로 만든 것을 쓴다. */
  const policy =
    policies.find((entry) => entry.legal.length >= 2 && entry.rules.length >= 2 && entry.rules.every((rule) => rule.applies_when.length > 0 && rule.applies_question)) ??
    made((draft) => {
      draft.legal = [1, 2].map((n) => ({ ...FULL_LEGAL, label: `시험법 제${n}조` }));
      draft.rules = ["a", "b"].map((id) => ({ ...RULE, id, applies_question: "적용되는가?", alternatives: [STATIC, AI] }));
    });
  const html = render(policy);
  const part = (open: string, nth = 0) => elementsOf(html, open)[nth];
  const side = part('<aside class="policy-side">');
  const notice = part('<p class="judge-note">');
  const legend = part('<details class="legend-fold">');
  const second = part('<div class="lg-item', 1);

  it("고치지 않은 쪽은 읽힌다", () => {
    expect(() => readPolicyPage(html)).not.toThrow();
    expect(readPolicyPage(html).frame).toEqual(POLICY_FRAME);
  });

  it.each<[string, (page: string) => string, string]>([
    ["머리 아래에 설명 문단을 더함", (page) => page.replace("</header>", '</header><p class="extra">이 정책은 가입 화면을 봅니다.</p>'), "읽지 않은 글이 있거나 차례가"],
    ["규칙에 설명 문단을 더함", (page) => page.replace('<dl class="facts">', '<p>이 규칙은 가입 화면을 봅니다.</p><dl class="facts">'), "읽지 않은 글이 있거나 차례가"],
    ["적용 조건 목록 아래에 id 를 풀어 쓴 문단을 더함", (page) => page.replace("</ul></dd>", "</ul><p>이 조건은 가입 화면인지 봅니다.</p></dd>"), "읽지 않은 글이 있거나 차례가"],
    ["곁칸을 근거 조문 위로 옮김", (page) => page.replace(side, "").replace('<div class="policy-main">', `${side}<div class="policy-main">`), "읽지 않은 글이 있거나 차례가"],
    ["판정자 알림을 규칙 읽는 법 아래로 옮김", (page) => page.replace(notice, "").replace(legend, `${legend}${notice}`), "읽지 않은 글이 있거나 차례가"],
    ["같은 문단을 한 번 더 적음", (page) => page.replace(notice, `${notice}${notice}`), "읽지 않은 글이 있거나 차례가"],
    ["표시에 마우스를 올려야 뜨는 말을 붙임", (page) => page.replace('<span class="tag">', '<span class="tag" title="이 정책의 대표 조문입니다.">'), "모르는 속성이 있습니다(title)"],
    ["문단을 속성으로 가림", (page) => page.replace('<p class="judge-note">', '<p class="judge-note" hidden="">'), "모르는 속성이 있습니다(hidden)"],
    ["요소에 꾸밈을 직접 적음", (page) => page.replace('<ul class="legend">', '<ul class="legend" style="display:none">'), "모르는 속성이 있습니다(style)"],
    ["화면 낭독기에서 가림", (page) => page.replace('<ul class="alt-list">', '<ul class="alt-list" aria-hidden="true">'), "모르는 속성이 있습니다(aria-hidden)"],
    ["정해 두지 않은 쪽 안의 자리를 만듦", (page) => page.replace('<span class="tag">', '<span class="tag" id="primary">'), "정해 두지 않은 쪽 안의 자리가 있습니다(primary)"],
    ["그림을 더함", (page) => page.replace("</header>", '</header><img src="/a.png" alt="그림"/>'), "모르는 요소가 있습니다"],
    ["그려지지 않는 요소에 글을 둠", (page) => page.replace("</header>", "</header><template><p>숨긴 글</p></template>"), "모르는 요소가 있습니다"],
    ["둘째 조문을 이름 없이 한 번 더 접음", (page) => page.replace(second, `<details>${second}</details>`), "접어 둔 것이 읽은 것보다"],
    ["읽은 문단을 화면에서만 가린 글로 감쌈", (page) => page.replace(notice, `<div class="visually-hidden">${notice}</div>`), "화면에서만 가린 글이 읽은 것보다"],
  ])("%s: 읽지 않고 실패한다", (_, change, message) => {
    const changed = change(html);
    expect(changed).not.toBe(html);
    expect(() => readPolicyPage(changed)).toThrow(message);
  });

  it("기대값에서 만든 글 전체가 그려 낸 쪽의 글 전체와 같다 (브라우저가 그린 쪽은 이 글로 견준다)", () => {
    for (const entry of [...policies, made()]) {
      expect(partingOf(squash(plain(render(entry))), wholeText(expectedPolicyPage(entry, pack))), entry.id).toBeNull();
    }
    // 어긋나면 어긋나기 시작한 곳의 앞뒤를 내준다(쪽의 것, 견준 것).
    expect(partingOf("가나다라", "가나라")).toEqual(["가나다라", "가나라"]);
  });
});

describe("쪽을 읽는 도구: 틀의 둘레 (빌드된 쪽 전체에서 읽는다)", () => {
  // 읽는 도구(readPolicyPage)는 틀(article) 안만 읽는다. 쪽(page.tsx)이 틀 밖에 무엇을 더해도 읽은 값과 틀은 그대로다.
  // 빌드된 쪽에서는 틀의 둘레를 따로 읽는다(tests/browser/served-files.test.ts). 여기서는 빌드된 쪽의 모양을 손으로 지어 그
  // 도구가 읽어 내는지 본다. 모양은 Next 가 내보내는 것을 따랐다: 머리 앞의 빈 상자, 본문 끝의 주석, 바닥 뒤의 스크립트.
  const article = render(policies[0]);
  const built = (main: string, tail = "", payload = "첫 쪽") =>
    '<!DOCTYPE html><html lang="ko"><head><title>시험</title></head><body><div hidden=""><!--$--><!--/$--></div>' +
    `<header class="site-header"><a href="/">머리</a></header><main class="wrap">${main}<!--$--><!--/$--></main>` +
    `<footer class="site-footer"><p>바닥</p></footer>${tail}<script>self.__next_f.push([1,"${payload}"])</script></body></html>`;
  const CHROME =
    '<body><div hidden=""></div><header class="site-header"><a href="/">머리</a></header><main class="wrap"></main>' +
    '<footer class="site-footer"><p>바닥</p></footer></body>';

  it("틀 밖에 아무것도 없는 쪽: 본문 안은 비어 있고, 본문 밖은 주석과 스크립트를 걷어 낸 머리와 바닥이다", () => {
    expect(readAround(built(article))).toEqual({ beside: ["", ""], chrome: CHROME });
    // 바닥 뒤 스크립트의 내용이 달라도 본문 밖은 같게 읽힌다.
    expect(readAround(built(article, "", "다른 쪽")).chrome).toBe(CHROME);
  });

  it.each<[string, string, [string, string]]>([
    ["틀 앞에 문단을 더함", `<p class="hint">이 정책은 규칙이 여럿입니다.</p>${article}`, ['<p class="hint">이 정책은 규칙이 여럿입니다.</p>', ""]],
    ["틀 뒤에 문단을 더함", `${article}<p>덧붙인 글</p>`, ["", "<p>덧붙인 글</p>"]],
    ["틀 앞에 요소 없이 글만 더함", `덧붙인 글${article}`, ["덧붙인 글", ""]],
    ["틀을 다른 요소로 감쌈", `<div>${article}</div>`, ["<div>", "</div>"]],
    ["틀 뒤에 가려 둔 요소를 더함", `${article}<p hidden="">가린 글</p>`, ["", '<p hidden="">가린 글</p>']],
    ["틀 뒤에 스크립트를 더함", `${article}<script>document.title = "x";</script>`, ["", '<script>document.title = "x";</script>']],
  ])("%s: 본문 안에서 틀 말고 다른 것이 읽힌다 (틀 안만 읽어서는 드러나지 않는다)", (_, main, beside) => {
    expect(readAround(built(main))).toEqual({ beside, chrome: CHROME });
    expect(readPolicyPage(built(main))).toEqual(readPolicyPage(article));
  });

  it("본문 밖에 더한 것은 본문 밖에서 읽힌다 (정책마다 같은지로 견준다)", () => {
    const read = readAround(built(article, '<div hidden="" id="S:0"><p>뒤늦게 끼워 넣는 글</p></div>'));
    expect(read.beside).toEqual(["", ""]);
    expect(read.chrome).toBe(CHROME.replace("</body>", '<div hidden="" id="S:0"><p>뒤늦게 끼워 넣는 글</p></div></body>'));
  });

  it("본문이 하나가 아니거나 틀이 본문 안에 없으면 읽지 않고 실패한다", () => {
    expect(() => readAround(built(article).replace('<main class="wrap">', "<div>").replace("</main>", "</div>"))).toThrow("본문(main)이 하나가 아닙니다: 0개");
    expect(() => readAround(built(`${article}<main>둘째 본문</main>`))).toThrow("본문(main)이 하나가 아닙니다: 2개");
    expect(() => readAround(built("").replace("</footer>", `</footer>${article}`))).toThrow("요소가 없습니다");
  });
});

describe("정책 한 쪽: 팩 메타데이터에 실린 정책", () => {
  it("볼 정책이 여럿이다 (같은 틀인지 견줄 수 있다)", () => {
    expect(policies.length).toBeGreaterThan(1);
  });

  it.each(named)("%s: 쪽의 값과 글이 팩 메타데이터 그대로이고, 틀이 같다", (_, policy) => {
    expectWhole(policy);
  });

  it.each(named)("%s: 조문 원문이 legal[].text 와 글자 그대로 같다 (원문 상자는 원문이 있는 조문의 수만큼)", (_, policy) => {
    const html = render(policy);
    const page = readPolicyPage(html);
    expect(page.legal.map((legal) => legal.statute)).toEqual(policy.legal.map((legal) => legal.text || null));
    for (const [i, legal] of policy.legal.entries()) {
      if (legal.text) expect(page.legal[i].statute === legal.text, `${policy.id} ${legal.label}`).toBe(true);
    }
    expect(elementsOf(html, '<pre class="statute">')).toHaveLength(policy.legal.filter((legal) => legal.text).length);
  });

  it.each(named)("%s: 쓰지 않는 말이 없다 (조문 원문은 빼고 본다)", (_, policy) => {
    // 조문 원문에 나오는 낱말은 해당하지 않는다(tests/wording.ts). 원문 상자를 걷어 낸 화면의 글을 본다.
    const html = render(policy);
    const boxes = elementsOf(html, '<pre class="statute">');
    const shown = textOf(boxes.reduce((rest, box) => rest.replace(box, ""), html));
    expect(shown).toContain(policy.title);
    expect(textOf(html).length - shown.length).toBe(boxes.reduce((sum, box) => sum + textOf(box).length, 0));
    for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(shown), `${pattern} — ${why}`).toBe(false);
  });

  it("팩 작성자 메모의 글은 어느 정책의 쪽에도, 목록에도 없다 (모든 정책의 메모와 견준다)", () => {
    const pages = [...policies.map((policy) => plain(render(policy))), plain(renderToStaticMarkup(<PolicyIndexPage />))];
    const sentences = policies.flatMap(memoSentences);
    expect(sentences.length).toBeGreaterThan(policies.length);
    for (const shown of pages) for (const sentence of sentences) expect(shown.includes(sentence), sentence).toBe(false);
  });
});

describe("손으로 만든 정책 (팩에 실린 정책에 없는 모양을 그려 본다)", () => {
  it("값이 다 있는 정책이 팩에 실린 정책과 같은 틀로 그려진다", () => {
    expectWhole(made());
  });

  it("팩 작성자 메모는 받아도 그리지 않는다", () => {
    const policy = made();
    const shown = plain(render(policy));
    expect(shown).not.toContain("작성자 메모");
    expect(shown).toContain(policy.title);
  });
});

describe("조문 원문", () => {
  it("줄바꿈, 이어진 빈칸, 탭, 꺾쇠와 따옴표가 든 원문도 글자 그대로 싣는다. 다듬거나 줄이지 않는다", () => {
    const texts = [
      "제1조(목적)\n\n\n① 첫째  항   빈칸 셋\n\t탭으로 들여 쓴 줄\n끝에 빈칸이 있는 줄  \n<개정 2016.3.22> \"기간\" '무료' A&B &lt; &amp; 「법」",
      // 줄바꿈으로 시작하는 글. HTML 은 pre 의 첫 줄바꿈을 버리므로, 그대로 두면 한 줄이 사라진다.
      "\n줄바꿈으로 시작하는 원문\n\n",
      "   빈칸으로 시작하고 끝나는 원문   ",
      "가".repeat(5000),
    ];
    const policy = made((draft) => {
      draft.legal = texts.map((text, i) => ({ ...FULL_LEGAL, label: `시험법 제${i + 1}조`, text }));
    });
    const page = read(policy);
    expect(page.legal.map((legal) => legal.statute)).toEqual(texts);
    // 원문 상자에는 원문만 있다. 다른 글이나 요소가 섞이지 않는다.
    const boxes = elementsOf(render(policy), '<pre class="statute">');
    expect(boxes).toHaveLength(texts.length);
    for (const box of boxes) expect(box.slice('<pre class="statute">'.length, -"</pre>".length)).not.toContain("<");
    expectWhole(policy);
  });

  it("대표 조문(첫 조문)의 원문만 펼쳐 두고 나머지는 접는다. 접혀 있어도 원문은 쪽에 들어 있다", () => {
    const policy = made((draft) => {
      draft.legal = ["가", "나", "다"].map((text, i) => ({ ...FULL_LEGAL, label: `시험법 제${i + 1}조`, text: `${text}\n${text}` }));
    });
    const html = render(policy);
    const page = readPolicyPage(html);
    expect(page.legal.map((legal) => legal.open)).toEqual([true, false, false]);
    expect(page.legal.map((legal) => legal.tag)).toEqual(["대표 조문", null, null]);
    expect(page.legal.map((legal) => legal.statute)).toEqual(["가\n가", "나\n나", "다\n다"]);
    expect(page.law).toBe("시험법 제1조");
    expect(closedDetailsAt(html, html.indexOf("가\n가"))).toEqual([]);
    expect(closedDetailsAt(html, html.indexOf("나\n나"))).toHaveLength(1);
    expectWhole(policy);
  });

  it("앞선 조문과 원문이 글자까지 같으면 접어 둔 이름 옆에 그렇다고 적는다 (한 조의 여러 항을 근거로 든 정책)", () => {
    const policy = made((draft) => {
      draft.legal = [
        { ...FULL_LEGAL, label: "시험법 제1조 제1항", text: "제1조 전체" },
        { ...FULL_LEGAL, label: "시험법 제1조 제2항", text: "제1조 전체" },
        { ...FULL_LEGAL, label: "시험법 시행령 제3조", text: "제3조 전체" },
        { ...FULL_LEGAL, label: "시험법 제1조 제3항", text: "제1조 전체" },
      ];
    });
    const page = read(policy);
    expect(page.legal.map((legal) => legal.sameText)).toEqual([null, "위 첫째 조문과 원문이 같습니다", null, "위 첫째 조문과 원문이 같습니다"]);
    // 같다고 적어도 원문은 줄이지 않고 다시 싣는다.
    expect(page.legal.map((legal) => legal.statute)).toEqual(policy.legal.map((legal) => legal.text));
    expectWhole(policy);
  });

  it("차례는 같은 원문이 처음 나온 조문을 가리킨다. 원문이 없는 조문끼리는 같다고 적지 않는다", () => {
    const refs = (texts: (string | null)[]) => texts.map((text, i) => ({ ...LEGAL, label: `시험법 제${i + 1}조`, text }));
    const legal = refs(["가", "나", "가", "나", "나", null, null, "다", "다"]);
    expect(legal.map((_, i) => sameTextNote(legal, i))).toEqual([
      null,
      null,
      "위 첫째 조문과 원문이 같습니다",
      "위 둘째 조문과 원문이 같습니다",
      "위 둘째 조문과 원문이 같습니다",
      null,
      null,
      null,
      "위 8번째 조문과 원문이 같습니다",
    ]);
  });

  it("원문이 없는 조문: 원문이 실려 있지 않다고 적는다. 빈 상자를 그리지 않는다", () => {
    expect(NO_TEXT).toBe("원문이 실려 있지 않습니다.");
    for (const text of [null, ""]) {
      const policy = made((draft) => {
        draft.legal[0].text = text;
        draft.legal[0].text_sha256_matches = null;
      });
      const html = render(policy);
      const page = readPolicyPage(html);
      expect(page.legal[0].statute).toBeNull();
      expect(page.legal[0].missing).toBe(NO_TEXT);
      expect(html).not.toContain('<pre class="statute">');
      // 견줄 원문이 없으므로 해시도 견주지 못했다고 눈에 띄게 적는다(조문이 하나라 곁칸에).
      expect(page.side.facts.find(([label]) => label === "원문 해시 대조")).toEqual(["원문 해시 대조", "원문이 없어 견주지 못함"]);
      expect(page.side.warned).toEqual(["원문 해시 대조"]);
      expectWhole(policy);
    }
  });
});

describe("원문의 출처: 곁칸 `이 정책` 과 조문마다의 줄", () => {
  it("조문이 모두 같은 값이면 곁칸에 한 번 적고, 조문마다의 줄에는 원문 해시만 있다", () => {
    const policy = made((draft) => {
      draft.legal = [1, 2].map((n) => ({ ...FULL_LEGAL, label: `시험법 제${n}조` }));
    });
    const page = read(policy);
    expect(page.side.facts.slice(4)).toEqual([
      ["원문과 날짜", "팩에 실린 그대로"],
      ["원문 받은 날", FULL_LEGAL.text_retrieved],
      // 해시는 시행일의 판본보다 앞이다(docs/redesign.md 3장의 곁칸 목록).
      ["원문 해시 대조", "2개 모두 팩에 적힌 것과 같음"],
      ["시행일", FULL_LEGAL.effective_from],
      ["시행일의 판본", "팩이 아직 알려 주지 않음"],
    ]);
    expect(page.legal.map((legal) => legal.facts)).toEqual([[], []]);
    expectWhole(policy);
  });

  it("조문마다 다르면 곁칸에는 `조문마다 다름` 이고, 그 조문을 펼친 안쪽의 줄에 그 조문의 값이 있다", () => {
    const policy = made((draft) => {
      draft.legal = [
        { ...FULL_LEGAL, label: "시험법 제1조" },
        { ...FULL_LEGAL, label: "시험법 제2조", effective_from: "2010-10-10", text_retrieved: null },
      ];
    });
    const page = read(policy);
    const side = new Map(page.side.facts);
    expect([side.get("원문 받은 날"), side.get("시행일")]).toEqual([DIFFERS, DIFFERS]);
    expect(page.legal.map((legal) => legal.facts)).toEqual([
      [
        ["원문 받은 날", FULL_LEGAL.text_retrieved],
        ["시행일", FULL_LEGAL.effective_from],
      ],
      [
        ["원문 받은 날", NOT_IN_PACK],
        ["시행일", "2010-10-10"],
      ],
    ]);
    expectWhole(policy);
  });

  it.each(named)("%s: 날짜는 팩의 값 그대로다(같으면 곁칸에, 다르면 조문마다). 시행일이 어느 판본인지는 팩이 알려 주지 않는다고 적는다", (_, policy) => {
    const page = read(policy);
    const side = new Map(page.side.facts);
    for (const [label, pick] of [
      ["원문 받은 날", (legal: LegalRef) => legal.text_retrieved],
      ["시행일", (legal: LegalRef) => legal.effective_from],
    ] as const) {
      const values = [...new Set(policy.legal.map(pick))];
      if (values.length === 1) {
        expect(side.get(label), `${policy.id} ${label}`).toBe(values[0] ?? NOT_IN_PACK);
        for (const legal of page.legal) expect(legal.facts.map(([name]) => name)).not.toContain(label);
      } else {
        expect(side.get(label), `${policy.id} ${label}`).toBe(DIFFERS);
        expect(page.legal.map((legal) => new Map(legal.facts).get(label))).toEqual(policy.legal.map((legal) => pick(legal) ?? NOT_IN_PACK));
      }
    }
    expect(side.get("원문과 날짜")).toBe("팩에 실린 그대로");
    expect(side.get("시행일의 판본")).toBe("팩이 아직 알려 주지 않음");
  });

  it("D5 까지의 긴 문장(원문과 날짜의 출처)은 쪽에 없다. 그 두 사실은 곁칸의 사실 줄이 말한다", () => {
    for (const policy of policies) {
      const shown = plain(render(policy));
      expect(shown).not.toContain("원문과 날짜는 팩에 실린 그대로입니다.");
      expect(shown).not.toContain("시행일이 어느 판본의 날짜인지는");
    }
  });
});

describe("원문 해시", () => {
  it("앞 16자만 보이고 전체 값은 그것을 펼친 자리에 글로 있다. 마우스를 올려야 뜨는 말(title)이 아니다", () => {
    const policy = made();
    const html = render(policy);
    const [legal] = readPolicyPage(html).legal;
    expect(legal.hash).toEqual({ whose: "시험법 제1조 원문 해시", short: `${FULL_LEGAL.text_sha256!.slice(0, 16)}…`, full: FULL_LEGAL.text_sha256 });
    expect(html).not.toMatch(/\stitle="/);
    // 전체 값은 닫힌 details 안이고, 앞부분은 그 이름(summary)이라 접혀 있어도 보인다.
    expect(closedDetailsAt(html, html.indexOf(FULL_LEGAL.text_sha256!))).toHaveLength(1);
    expect(closedDetailsAt(html, html.indexOf(`${FULL_LEGAL.text_sha256!.slice(0, 16)}…`))).toEqual([]);
  });

  it("맞으면 그렇다고만 적는다", () => {
    const page = read(made());
    expect(hashSide(page)).toEqual(["원문 해시 대조", "팩에 적힌 것과 같음"]);
    expect(page.side.warned).toEqual([]);
    expect(page.legal[0].mismatch).toBeNull();
  });

  it("다르면 눈에 띄게 적고, 원문 바로 위에도 적는다. 원문은 그대로 보인다", () => {
    const policy = made((draft) => {
      draft.legal[0].text_sha256_matches = false;
    });
    const html = render(policy);
    const page = readPolicyPage(html);
    expect(hashSide(page)).toEqual(["원문 해시 대조", "팩에 적힌 것과 다름"]);
    expect(page.side.warned).toEqual(["원문 해시 대조"]);
    expect(page.legal[0].mismatch).toBe("아래 원문은 팩에 적힌 해시와 맞지 않습니다.");
    expect(page.legal[0].statute).toBe(policy.legal[0].text);
    expect(html.indexOf("아래 원문은 팩에 적힌 해시와 맞지 않습니다.")).toBeLessThan(html.indexOf('<pre class="statute">'));
    expectWhole(policy);
  });

  it("조문마다 결과가 다르면 곁칸에는 맞지 않는 것의 수를 말로(눈에 띄게), 조문마다의 줄에 그 조문의 결과가 있다", () => {
    const policy = made((draft) => {
      draft.legal = [
        { ...FULL_LEGAL, label: "시험법 제1조" },
        { ...FULL_LEGAL, label: "시험법 제2조", text_sha256_matches: null },
      ];
    });
    const page = read(policy);
    // "조문마다 다름"은 해시가 맞든 맞지 않든 참인 말이라 쓰지 않는다. 색만으로 알리지 않는다.
    expect(hashSide(page)).toEqual(["원문 해시 대조", "2개 가운데 1개 견주지 못함"]);
    expect(page.side.warned).toEqual(["원문 해시 대조"]);
    expect(page.legal.map((legal) => [legal.facts, legal.warned])).toEqual([
      [[["원문 해시 대조", "팩에 적힌 것과 같음"]], []],
      [[["원문 해시 대조", "견주지 못함"]], ["원문 해시 대조"]],
    ]);
    // 견주지 못한 조문은 대표 조문이 아니어도 펼쳐 둔다. 그 줄이 펼치기 전에도 보인다.
    expect(page.legal.map((legal) => legal.open)).toEqual([true, true]);
    expectWhole(policy);
  });

  it("맞지 않는 조문이 대표 조문이 아니어도: 그 조문은 펼쳐 두어 대조의 줄과 원문 위의 알림이 접히지 않는다. 곁칸은 말마다 센다", () => {
    const policy = made((draft) => {
      draft.legal = [
        { ...FULL_LEGAL, label: "시험법 제1조" },
        { ...FULL_LEGAL, label: "시험법 제2조", text_sha256_matches: false },
        { ...FULL_LEGAL, label: "시험법 제3조" },
        { ...FULL_LEGAL, label: "시험법 제4조", text_sha256_matches: null },
      ];
    });
    const html = render(policy);
    const page = readPolicyPage(html);
    expect(hashSide(page)).toEqual(["원문 해시 대조", "4개 가운데 1개 팩에 적힌 것과 다름, 1개 견주지 못함"]);
    expect(page.legal.map((legal) => legal.open)).toEqual([true, true, false, true]);
    expect(page.legal[1].mismatch).toBe("아래 원문은 팩에 적힌 해시와 맞지 않습니다.");
    for (const text of ["아래 원문은 팩에 적힌 해시와 맞지 않습니다.", "팩에 적힌 것과 다름", "견주지 못함"]) {
      expect(closedDetailsAt(html, html.indexOf(text)), text).toEqual([]);
    }
    expectWhole(policy);
  });

  it("견주지 못했으면(모름) 까닭과 함께 눈에 띄게 적는다. 맞는다고 적지 않는다. 해시가 없으면 값 자리에 없다고 적는다", () => {
    const noHash = made((draft) => {
      draft.legal[0].text_sha256 = null;
      draft.legal[0].text_sha256_matches = null;
    });
    const unknown = made((draft) => {
      draft.legal[0].text_sha256_matches = null;
    });
    for (const [policy, text] of [
      [noHash, "팩에 해시가 적혀 있지 않음"],
      [unknown, "견주지 못함"],
    ] as const) {
      const page = read(policy);
      expect(hashSide(page)).toEqual(["원문 해시 대조", text]);
      expect(page.side.warned).toEqual(["원문 해시 대조"]);
      expect(page.legal[0].mismatch).toBeNull();
      expect(render(policy)).not.toContain("팩에 적힌 것과 같음");
      expectWhole(policy);
    }
    expect(read(noHash).legal[0].hash).toBeNull();
    expect(read(noHash).legal[0].hashMissing).toBe(NOT_IN_PACK);
  });

  it.each(named)("%s: 해시의 값은 팩에 적힌 것 그대로이고, 맞는지는 팩 메타데이터의 text_sha256_matches 대로다", (_, policy) => {
    const page = read(policy);
    expect(page.legal.map((legal) => legal.hash?.full ?? null)).toEqual(policy.legal.map((legal) => legal.text_sha256));
    const all = policy.legal.every((legal) => legal.text_sha256_matches === true);
    expect(page.side.warned).toEqual(all ? [] : ["원문 해시 대조"]);
    if (all) expect(new Map(page.side.facts).get("원문 해시 대조")).toBe(policy.legal.length > 1 ? `${policy.legal.length}개 모두 팩에 적힌 것과 같음` : "팩에 적힌 것과 같음");
  });
});

describe("팩에 없는 값", () => {
  it("날짜, 링크, 재검토 기한이 없으면 없다고 적는다. 빈 자리로 두지 않는다", () => {
    expect(NOT_IN_PACK).toBe("팩에 실려 있지 않습니다.");
    const policy = made((draft) => {
      draft.legal = [{ ...LEGAL, text: "원문" }];
      draft.review_by = null;
    });
    const page = read(policy);
    expect(new Map(page.side.facts).get("원문 받은 날")).toBe(NOT_IN_PACK);
    expect(new Map(page.side.facts).get("시행일")).toBe(NOT_IN_PACK);
    expect(new Map(page.side.facts).get("재검토 기한")).toBe(NOT_IN_PACK);
    expect(page.legal[0].link).toBeNull();
    // 법제처 주소가 없으면 링크 자리를 비워 두지 않고 조문의 사실 줄에 없다고 적는다.
    expect(page.legal[0].facts).toContainEqual(["법제처 링크", NOT_IN_PACK]);
    expect(page.legal[0].hashMissing).toBe(NOT_IN_PACK);
    expect(page.hrefs).toEqual(["#legal", "#rules"]);
    expectWhole(policy, POLICY_FRAME.map((line) => (line.startsWith("조문:") ? "조문: 이름 · 조문마다의 사실 · 원문 해시 · 조문 원문" : line)));
  });

  it("알리는 말, 질문이 없는 대안: 없다고 적는다. 고치는 법은 있는 대안에만 적는다. 같은 규칙의 다른 대안에서 끌어오지 않는다", () => {
    const other: Alternative = { ...STATIC, id: "other", message: "다른 대안의 알리는 말", ask_developer: "다른 대안의 질문", remediation: "다른 대안의 고치는 법" };
    const policy = made((draft) => {
      draft.rules[0].alternatives = [{ ...STATIC, id: "bare", message: null, ask_developer: null }, other, AI];
    });
    const html = render(policy);
    const page = readPolicyPage(html);
    const [bare, full] = page.rules[0].alternatives;
    expect(bare.says).toEqual([
      ["알리는 말", NOT_IN_PACK],
      ["질문", NOT_IN_PACK],
    ]);
    expect(full.says).toEqual([
      ["알리는 말", other.message],
      ["질문", other.ask_developer],
      ["고치는 법", other.remediation],
    ]);
    // 첫 대안에 알리는 말이 없으면 규칙 줄의 첫 줄도 없다고 적는다. 다른 대안의 말을 끌어오지 않는다.
    expect(page.rules[0].lead).toBe(NOT_IN_PACK);
    for (const text of [other.message!, other.ask_developer!, other.remediation!]) expect(html.split(text)).toHaveLength(2);
    expectWhole(policy);
  });

  it("근거 조문이 없는 정책, 개발자에게 할 질문이 없는 정책도 그려진다. 원문의 사실은 곁칸에 적지 않는다", () => {
    const policy = made((draft) => {
      draft.legal = [];
      draft.ask_developer = null;
    });
    const page = read(policy);
    expect(page.law).toBeNull();
    expect(page.question).toBeNull();
    expect(page.sections[0]).toBe("근거 조문 0");
    expect(page.jump.text).toBe("근거 조문 0 · 규칙 1");
    expect(page.legal).toEqual([]);
    expect(page.noLegal).toBe("팩에 근거 조문이 실려 있지 않습니다.");
    expect(page.side.facts.map(([label]) => label)).toEqual(["판정 단위", "재검토 기한", "팩", "팩 판"]);
    expect(page.frame[0]).toBe("머리: 제목 · 정책 id · 바로가기");
    expectWhole(policy, page.frame);
  });

  it("규칙이 없는 정책(손으로 만든 자료)도 그려진다. 판정 단위는 없다고 적는다", () => {
    const policy = made((draft) => {
      draft.rules = [];
    });
    const page = read(policy);
    expect(page.sections[1]).toBe("규칙 0");
    expect(page.side.facts[0]).toEqual(["판정 단위", NOT_IN_PACK]);
    expect(page.rules).toEqual([]);
    expect(page.judge).toBeNull();
  });
});

describe("규칙 줄", () => {
  it.each(named)("%s: 첫 줄은 첫 대안의 알리는 말(팩 원문), 둘째 줄은 규칙 id 와 판정 단위다. 대안의 수는 팩에서 센다", (_, policy) => {
    const page = read(policy);
    expect(page.rules.map((rule) => [rule.lead, rule.id, rule.unit, rule.count])).toEqual(
      policy.rules.map((rule) => [rule.alternatives[0].message, rule.id, `판정 단위 ${rule.scope === "file" ? "파일" : "함수"}`, `대안 ${rule.alternatives.length}`]),
    );
    // 첫 규칙만 펼쳐 둔다.
    expect(page.rules.map((rule) => rule.open)).toEqual(policy.rules.map((_, i) => i === 0));
  });

  it("적용 조건은 팩에 적힌 id 그대로이고, 그 옆 설명 자리에는 팩이 아직 알려 주지 않는다고 적는다", () => {
    expect(UNDESCRIBED).toBe("팩이 아직 알려 주지 않습니다.");
    for (const policy of [...policies, made((draft) => void (draft.rules[0].applies_when = ["first-one", "second-one", "third-one"]))]) {
      const html = render(policy);
      const page = readPolicyPage(html);
      for (const [i, rule] of policy.rules.entries()) {
        expect(page.rules[i].conditions, `${policy.id} ${rule.id}`).toEqual(rule.applies_when.map((id) => [id, UNDESCRIBED]));
      }
      // 조건마다 한 줄이고, 줄에는 id 와 그 말뿐이다. id 를 풀어 쓴 글이 끼어 있지 않다.
      const items = elementsOf(html, '<ul class="conditions">').flatMap((list) => elementsOf(list, "<li>"));
      const ids = policy.rules.flatMap((rule) => rule.applies_when);
      expect(items).toEqual(ids.map((id) => `<li><code translate="no">${id}</code> <span class="none">팩이 아직 알려 주지 않습니다.</span></li>`));
    }
  });

  it("적용 조건이 없는 규칙에는 없다고 적는다", () => {
    const policy = made((draft) => {
      draft.rules[0].applies_when = [];
      draft.rules[0].applies_question = "적용되는가?";
    });
    const [rule] = read(policy).rules;
    expect(rule.conditions).toEqual([]);
    expect(rule.noConditions).toBe("이 규칙에는 적용 조건이 없습니다.");
    expectWhole(policy);
  });

  it("판정 단위는 팩의 값을 옮긴다: file 은 파일, anchor 는 함수, 모르는 값은 팩에 적힌 그대로", () => {
    for (const [scope, label, legend] of [
      ["file", "파일", ["판정 단위 · 파일: 파일마다 판정 하나를 냅니다. 파일 전체를 보고 판정합니다."]],
      ["anchor", "함수", ["판정 단위 · 함수: 팩이 고른 적용 조건이 맞은 자리를 감싸는 가장 바깥 함수마다 판정 하나를 냅니다."]],
      // 모르는 값에는 풀이가 없다. 뜻을 지어내지 않는다.
      ["module", "module", []],
      ["constructor", "constructor", []],
    ] as const) {
      const policy = made((draft) => {
        draft.rules[0].scope = scope;
      });
      const page = read(policy);
      expect(page.rules[0].unit, scope).toBe(`판정 단위 ${label}`);
      expect(page.side.facts[0], scope).toEqual(["판정 단위", label]);
      expect(page.legend.items.filter((item) => item.startsWith("판정 단위")), scope).toEqual(legend);
      expectWhole(policy);
    }
  });

  it("규칙마다 판정 단위가 다르면 곁칸에는 `규칙마다 다름` 이고, 규칙 줄에는 제 것을 적는다", () => {
    const policy = made((draft) => {
      draft.rules = ["file", "anchor", "file", "anchor"].map((scope, i) => ({ ...RULE, id: `rule-${i}`, scope, alternatives: [STATIC, AI] }));
    });
    const page = read(policy);
    expect(page.side.facts[0]).toEqual(["판정 단위", "규칙마다 다름"]);
    expect(page.rules.map((rule) => rule.unit)).toEqual(["판정 단위 파일", "판정 단위 함수", "판정 단위 파일", "판정 단위 함수"]);
    expect(page.legend.items.slice(0, 2).map((item) => item.split(":")[0])).toEqual(["판정 단위 · 파일", "판정 단위 · 함수"]);
    expectWhole(policy);
  });

  it("적용 질문은 판정자에게 묻는 글이라 접어 둔다. 없는 규칙에는 없다고 적는다", () => {
    const policy = made((draft) => {
      draft.rules = [
        { ...RULE, id: "asks", applies_question: "이 코드는 그 일을 하는가?" },
        { ...RULE, id: "does-not-ask", applies_question: null },
      ];
    });
    const html = render(policy);
    const [asks, silent] = readPolicyPage(html).rules;
    expect(asks.applies).toEqual({ open: false, whose: "asks 적용 질문", summary: ASKED, text: "이 코드는 그 일을 하는가?" });
    expect(silent.applies).toBeNull();
    expect(silent.noApplies).toBe("이 규칙에는 적용 질문이 없습니다.");
    expect(closedDetailsAt(html, html.indexOf("이 코드는 그 일을 하는가?"))).toHaveLength(1);
    expectWhole(policy);
  });

  it("id 가 없는 규칙·조건·대안(손으로 만든 자료)은 빈 자리로 두지 않는다. 그 규칙에는 쪽 안의 자리가 없다", () => {
    const policy = made((draft) => {
      draft.rules = [{ ...RULE, id: null, applies_when: [null], alternatives: [{ ...STATIC, id: null }, AI] }];
    });
    const [rule] = read(policy).rules;
    expect(rule.id).toBe("(id 없음)");
    expect(rule.anchor).toBeNull();
    expect(rule.conditions).toEqual([["(id 없음)", UNDESCRIBED]]);
    expect(rule.alternatives[0].id).toBe("(id 없음)");
    expectWhole(policy);
  });
});

describe("대안", () => {
  const KIND: Record<string, string> = { "static/strong": "정적 · 강한", "static/weak": "정적 · 약한", "ai/required": "AI · 코드 인용 필요", "ai/strict": "AI · 코드 인용 필요" };

  it("대안마다 한 줄이고, 종류와 세기는 팩의 값을 옮긴 것이다", () => {
    const every: Alternative[] = [
      { ...STATIC, id: "strong", strength: "strong" },
      { ...STATIC, id: "weak", strength: "weak" },
      { ...AI, id: "required", evidence: "required" },
      { ...AI, id: "strict", evidence: "strict" },
    ];
    const policy = made((draft) => {
      draft.rules[0].alternatives = every;
    });
    const [rule] = read(policy).rules;
    expect(rule.count).toBe("대안 4");
    expect(rule.alternatives.map((alt) => [alt.id, alt.kind])).toEqual([
      ["strong", "정적 · 강한"],
      ["weak", "정적 · 약한"],
      ["required", "AI · 코드 인용 필요"],
      ["strict", "AI · 코드 인용 필요"],
    ]);
    expectWhole(policy);
  });

  it("팩에 실린 정책: 대안마다 한 줄이고 종류와 세기가 그 값이다", () => {
    for (const policy of policies) {
      const page = read(policy);
      for (const [i, rule] of policy.rules.entries()) {
        expect(page.rules[i].alternatives.map((alt) => [alt.id, alt.kind])).toEqual(
          rule.alternatives.map((alt) => [alt.id, KIND[`${alt.kind}/${alt.kind === "ai" ? alt.evidence : alt.strength}`]]),
        );
        for (const alt of rule.alternatives) expect(Object.keys(KIND), `${policy.id} ${alt.id}`).toContain(`${alt.kind}/${alt.kind === "ai" ? alt.evidence : alt.strength}`);
      }
    }
  });

  it("모르는 세기와 모르는 인용 조건은 풀어 쓰지 않고 팩에 적힌 그대로 보인다", () => {
    const policy = made((draft) => {
      draft.rules[0].alternatives = [
        { ...STATIC, id: "a", strength: "medium" },
        { ...STATIC, id: "b", strength: null },
        { ...STATIC, id: "c", strength: "constructor" },
        { ...AI, id: "d", evidence: "optional" },
        { ...AI, id: "e", evidence: null },
      ];
    });
    const page = read(policy);
    expect(page.rules[0].alternatives.map((alt) => alt.kind)).toEqual(["정적 · medium", "정적", "정적 · constructor", "AI · 인용 조건 optional", "AI"]);
    expectWhole(policy);
  });

  it("약한 대안의 줄에는 혼자서는 경고를 풀지 못한다고 적혀 있다. 강한 대안과 AI 대안의 줄에는 없다", () => {
    expect(WEAK).toBe("약한 대안은 참이어도 혼자서는 경고를 풀지 못합니다.");
    const policy = made((draft) => {
      draft.rules[0].alternatives = [{ ...STATIC, id: "strong" }, { ...STATIC, id: "weak", strength: "weak" }, AI];
    });
    const html = render(policy);
    expect(readPolicyPage(html).rules[0].alternatives.map((alt) => alt.weak)).toEqual([null, WEAK, null]);
    // 펼친 규칙(첫 규칙)에서는 접혀 있지 않다. "규칙 읽는 법"을 펼치지 않아도 보인다.
    expect(closedDetailsAt(html, html.indexOf(WEAK))).toEqual([]);
    for (const real of policies) {
      const page = read(real);
      for (const [i, rule] of real.rules.entries()) {
        expect(page.rules[i].alternatives.map((alt) => alt.weak), `${real.id} ${rule.id}`).toEqual(
          rule.alternatives.map((alt) => (alt.kind === "static" && alt.strength === "weak" ? WEAK : null)),
        );
      }
    }
  });

  it("사람에게 하는 말(알리는 말, 질문, 고치는 법)은 규칙을 펼치면 보이고, 판정자에게 묻는 글은 한 번 더 접혀 있다", () => {
    const spoken: Alternative = { ...AI, message: "그 처리를 찾지 못했습니다.", ask_developer: "그 처리는 어디에 있나요?", remediation: "그 처리를 넣으세요." };
    const policy = made((draft) => {
      draft.rules[0].alternatives = [{ ...STATIC, message: "정적 대안의 알리는 말" }, spoken];
    });
    const html = render(policy);
    const [fixed, asked] = readPolicyPage(html).rules[0].alternatives;
    for (const text of [spoken.message!, spoken.ask_developer!, spoken.remediation!]) {
      expect(closedDetailsAt(html, html.indexOf(text)), text).toEqual([]);
    }
    expect(asked.asked).toEqual({ open: false, whose: "some-rule 대안 some-ai", summary: ASKED, text: spoken.question });
    expect(closedDetailsAt(html, html.indexOf(spoken.question!))).toHaveLength(1);
    expect(fixed.asked).toBeNull();
    expectWhole(policy);
  });
});

describe("판정자", () => {
  const rest = `${JUDGE_ON} ${CODE_LEAVES}`;

  it("묻는 것에 맞춰 적는다: AI 대안만, 적용 질문만, 둘 다. 판정자를 켜야 묻는다는 것과 코드가 외부 API 로 나간다는 것이 한 문단에 함께 있다", () => {
    expect(`${JUDGE_ON} ${CODE_LEAVES}`).toBe("판정자를 켠 검사에서만 묻습니다. 판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.");
    const of = (alternatives: Alternative[], question: string | null) =>
      made((draft) => {
        draft.rules = [{ ...RULE, alternatives, applies_question: question }];
      });
    expect(read(of([STATIC, AI], null)).judge).toBe(`AI 대안은 ${rest}`);
    expect(read(of([STATIC], "적용되는가?")).judge).toBe(`적용 질문은 ${rest}`);
    expect(read(of([STATIC, AI], "적용되는가?")).judge).toBe(`AI 대안과 적용 질문은 ${rest}`);
  });

  it("판정자에게 묻는 것이 없는 정책에는 판정자 이야기를 하지 않는다", () => {
    const none = made((draft) => {
      draft.rules = [{ ...RULE, alternatives: [STATIC], applies_question: null }];
    });
    expect(read(none).judge).toBeNull();
    expect(read(none).frame).not.toContain("판정자 알림");
    expect(render(none)).not.toContain(CODE_LEAVES);
  });

  it.each([...named, ["손으로 만든 정책", made()] as const])("%s: 그 말은 전문이고, 접혀 있지 않고 규칙보다 앞에 있다", (_, policy) => {
    const html = render(policy);
    const page = readPolicyPage(html);
    const ai = policy.rules.some((rule) => rule.alternatives.some((alt) => alt.kind === "ai"));
    const applies = policy.rules.some((rule) => Boolean(rule.applies_question));
    if (!ai && !applies) {
      expect(page.judge).toBeNull();
      return;
    }
    expect(page.judge).toBe(`${[ai && "AI 대안", applies && "적용 질문"].filter(Boolean).join("과 ")}은 ${rest}`);
    const at = html.indexOf(CODE_LEAVES);
    expect(closedDetailsAt(html, at)).toEqual([]);
    expect(at).toBeLessThan(html.indexOf('<details class="rule-row"'));
    // "판정자를 켜"라는 말이 나오는 문단과 항목마다 코드가 밖으로 나간다는 말이 함께 있다.
    const mentions = [...elementsOf(html, "<p"), ...elementsOf(html, "<li>")].filter((element) => plain(element).includes("판정자를 켜"));
    expect(mentions.length).toBeGreaterThan(0);
    for (const element of mentions) expect(plain(element)).toContain(CODE_LEAVES);
  });
});

describe("머리와 곁칸 `이 정책`", () => {
  it.each(named)("%s: 제목, 대표 조문, 정책 id, 개발자에게 할 질문, 바로가기(근거 조문과 규칙의 수는 팩에서 센다)", (_, policy) => {
    const page = read(policy);
    expect(page.title).toBe(policy.title);
    expect(page.law).toBe(policy.legal[0].label);
    expect(page.id).toBe(policy.id);
    expect(page.question).toEqual({ label: "개발자에게 할 질문", text: policy.ask_developer });
    expect(page.jump).toEqual({ text: `근거 조문 ${policy.legal.length} · 규칙 ${policy.rules.length}`, hrefs: ["#legal", "#rules"] });
    expect(page.sections).toEqual([`근거 조문 ${policy.legal.length}`, `규칙 ${policy.rules.length}`]);
    // "조문 도감" 눈썹 글은 없다.
    expect(plain(render(policy))).not.toContain("조문 도감");
  });

  it.each(named)("%s: 곁칸에 이 쪽을 만든 팩과 팩 판, 재검토 기한이 팩의 값 그대로다", (_, policy) => {
    const side = new Map(read(policy).side.facts);
    expect(side.get("팩")).toBe(pack.id);
    expect(side.get("팩 판")).toBe(pack.digest);
    expect(side.get("재검토 기한")).toBe(policy.review_by ?? NOT_IN_PACK);
  });

  it("곁칸의 팩과 팩 판은 식별자라 번역하지 않는 code 로 적는다(목록의 메타 줄과 같다). 팩 이름이 없으면 없다는 말은 code 가 아니다", () => {
    const sideOf = (policy: PolicyMeta, meta: typeof pack) => elementsOf(renderToStaticMarkup(<PolicyDetail policy={policy} pack={meta} />), '<dl class="side-facts">')[0];
    const side = sideOf(policies[0], pack);
    expect(side).toContain(`<dt>팩</dt><dd><code translate="no">${pack.id}</code></dd>`);
    expect(side).toContain(`<dt>팩 판</dt><dd><code translate="no">${pack.digest}</code></dd>`);
    expect(sideOf(policies[0], { ...pack, id: null })).toContain(`<dt>팩</dt><dd>${NOT_IN_PACK}</dd>`);
  });

  it("수집본의 팩 판이 이 쪽에 적히는 팩 판과 같다 (같은 판의 팩으로 만든 결과다)", () => {
    const captures = jsonFiles("contract", "cli-current");
    expect(captures.length).toBeGreaterThan(0);
    for (const name of captures) {
      expect((readJson("contract", "cli-current", name) as Report).run.pack_digest, name).toBe(pack.digest);
    }
  });

  it("대표 조문은 팩의 첫 조문이다. 수집본과 예시의 발견에 적힌 조문 이름이 그 이름이다", () => {
    const first = new Map(policies.map((policy) => [policy.id, policy.legal[0]?.label]));
    let findings = 0;
    for (const parts of [
      ["contract", "cli-current"],
      ["contract", "samples-v1-draft"],
    ]) {
      for (const name of jsonFiles(...parts)) {
        for (const finding of (readJson(...parts, name) as Report).findings) {
          expect(finding.law, `${name} ${finding.policy}`).toBe(first.get(finding.policy));
          findings += 1;
        }
      }
    }
    expect(findings).toBeGreaterThan(0);
    for (const policy of policies) {
      const page = read(policy);
      expect(page.law).toBe(policy.legal[0]?.label ?? null);
      expect(page.legal.map((legal) => legal.tag)).toEqual(policy.legal.map((_, i) => (i === 0 ? "대표 조문" : null)));
    }
  });
});

describe("링크와 쪽 안의 자리", () => {
  it.each([...named, ["손으로 만든 정책", made()] as const])("%s: 밖으로 가는 링크는 팩 메타데이터의 법제처 주소뿐이다. 새 창에서 열리고(rel), 새 창이라는 것이 화면 낭독기에 읽힌다", (_, policy) => {
    const html = render(policy);
    const page = readPolicyPage(html);
    expect(page.hrefs.filter((href) => !href.startsWith("#"))).toEqual(policy.legal.flatMap((legal) => legal.url ?? []));
    for (const [i, legal] of policy.legal.entries()) {
      expect(page.legal[i].link, legal.label).toEqual(
        legal.url === null ? null : { href: legal.url, target: "_blank", rel: "noopener noreferrer", whose: legal.label, text: "법제처 원문", newWindow: "(새 창)" },
      );
    }
    // 주소가 실리는 곳은 링크뿐이다. 그림·글꼴·스크립트로 스스로 받아 오는 것이 없다.
    expect(html.match(/(?:src|srcset|action|poster|data)="[^"]*"/g) ?? []).toEqual([]);
    expect((html.match(/https?:/g) ?? []).length).toBe(policy.legal.filter((legal) => legal.url).length);
  });

  it.each([...named, ["손으로 만든 정책", made()] as const])("%s: 쪽 안의 링크는 근거 조문과 규칙 둘뿐이고, 가리키는 자리가 쪽에 있다", (_, policy) => {
    const page = read(policy);
    const inside = page.hrefs.filter((href) => href.startsWith("#"));
    expect(inside).toEqual(["#legal", "#rules"]);
    for (const href of inside) expect(page.ids).toContain(href.slice(1));
    // 자리의 이름은 겹치지 않는다.
    expect(new Set(page.ids).size).toBe(page.ids.length);
  });

  it.each(named)("%s: 팩의 규칙마다 그 규칙 줄에 자리가 있고, 이름은 규칙 id 에서만 만든다(빌드마다 같다)", (_, policy) => {
    const page = read(policy);
    expect(page.rules.map((rule) => rule.anchor)).toEqual(policy.rules.map((rule) => ruleAnchor(rule.id!)));
    expect(page.rules.map((rule) => rule.anchor)).toEqual(policy.rules.map((rule) => anchorOf(rule.id!)));
    // 팩의 규칙 id 는 그대로 쓸 수 있는 글자뿐이라 앞에 rule- 만 붙는다.
    expect(page.rules.map((rule) => rule.anchor)).toEqual(policy.rules.map((rule) => `rule-${rule.id}`));
  });
});

describe("규칙의 자리 이름 (ruleAnchor) 과 결과 화면의 규칙 id 링크 (RuleId)", () => {
  it("자리에 쓸 수 없는 글자는 정해진 대로 바꾼다. 서로 다른 id 가 같은 이름이 되지 않는다", () => {
    const ids = ["plain-id", "with.dot", "with_underscore", "with_2e_text", "공백 있는 id", "slash/id", "#hash", "a.b", "a_2e_b", "A-Z"];
    const anchors = ids.map(ruleAnchor);
    expect(anchors).toEqual([
      "rule-plain-id",
      "rule-with_2e_dot",
      "rule-with_5f_underscore",
      "rule-with_5f_2e_5f_text",
      "rule-_acf5__bc31__20__c788__b294__20_id",
      "rule-slash_2f_id",
      "rule-_23_hash",
      "rule-a_2e_b",
      "rule-a_5f_2e_5f_b",
      "rule-A-Z",
    ]);
    expect(new Set(anchors).size).toBe(ids.length);
    for (const anchor of anchors) expect(anchor).toMatch(/^rule-[A-Za-z0-9_-]+$/);
    // 시험의 기대값(따로 적은 같은 규칙)과 같다. 같은 id 는 늘 같은 이름이다.
    expect(ids.map(anchorOf)).toEqual(anchors);
    expect(ids.map(ruleAnchor)).toEqual(anchors);
  });

  it("팩에 있는 규칙 id 는 그 정책 쪽의 그 규칙 자리로 잇고(링크가 가리키는 자리가 그 쪽에 있다), 없는 규칙은 글로만 적는다", () => {
    for (const policy of policies) {
      const page = read(policy);
      for (const rule of policy.rules) {
        const html = renderToStaticMarkup(<RuleId policy={policy.id} rule={rule.id!} inPack />);
        const href = decodeEntities(/href="([^"]*)"/.exec(html)![1]);
        // 부품 시험에는 Next 의 설정(trailingSlash)이 걸리지 않아 Link 가 경로 끝의 빗금을 뗀다. 빌드된 쪽은 브라우저 시험이 본다.
        expect(href).toBe(ruleHref(policy.id, rule.id!).replace("/#", "#"));
        expect(ruleHref(policy.id, rule.id!)).toBe(`${policyHref(policy.id)}#${ruleAnchor(rule.id!)}`);
        expect(page.ids).toContain(href.split("#")[1]);
      }
    }
    expect(renderToStaticMarkup(<RuleId policy="kr.other.99" rule="made-up-rule" inPack={false} />)).toBe('<code translate="no">made-up-rule</code>');
  });
});

describe("화면 낭독기에 읽히는 이름", () => {
  /** 쪽의 접어 둔 것과 링크의 이름. 화면 낭독기에만 읽히는 앞말과 눈에 보이는 글을 이어 읽은 것이다. */
  function namesOf(policy: PolicyMeta): { folds: string[]; links: string[] } {
    const page = read(policy);
    const folds = [
      ...page.legal.flatMap((legal) => (legal.hash ? `${legal.hash.whose} ${legal.hash.short}` : [])),
      ...page.rules.flatMap((rule) => [rule.applies ?? [], ...rule.alternatives.map((alt) => alt.asked ?? [])].flat()).map((fold) => `${fold.whose} ${fold.summary}`),
    ];
    return {
      folds,
      links: page.legal.flatMap((legal) => (legal.link ? `${legal.link.whose} ${legal.link.text} ${legal.link.newWindow}` : [])),
    };
  }

  it.each(named)("%s: 한 쪽 안에서 같은 글이 되풀이되는 접어 둔 것(해시, 묻는 글)과 법제처 링크의 이름이 서로 다르다", (_, policy) => {
    const { folds, links } = namesOf(policy);
    expect(folds.length).toBeGreaterThan(0);
    expect(new Set(folds).size, folds.join(" / ")).toBe(folds.length);
    expect(new Set(links).size, links.join(" / ")).toBe(links.length);
  });
});

describe("조문 도감 목록 (/policy)", () => {
  const html = renderToStaticMarkup(<PolicyIndexPage />);
  const index = readPolicyIndex(html);

  it("메타 한 줄은 팩, 판, 정책의 수다(팩 메타데이터에서 센다). 부제는 없다", () => {
    expect(squash(index.meta)).toBe(squash(`팩 ${pack.id} 판 ${pack.digest} 정책 ${policies.length}`));
    expect(html).not.toContain('class="lede"');
    expect(plain(html)).not.toContain("에 실린 정책");
  });

  it("정책마다 한 줄: 제목, 대표 조문, 규칙의 수(팩에서 센다). 줄은 그 정책의 쪽으로 간다(주소는 policyHref 로 만든다)", () => {
    expect(index.rows).toEqual(
      policies.map((policy) => ({
        // 부품 시험에는 Next 의 설정(trailingSlash)이 걸리지 않아 Link 가 주소 끝의 빗금을 뗀다. 빌드된 쪽은 served-files 가 본다.
        href: policyHref(policy.id).replace(/\/$/, ""),
        title: policy.title,
        law: policy.legal[0]?.label ?? "",
        rules: `규칙 ${policy.rules.length}`,
      })),
    );
    for (const policy of policies) expect(policyHref(policy.id)).toMatch(/^\/policy\/[a-z0-9-]+\/$/);
  });

  it("#status 상태의 뜻: 상태 7개와 판정 범위. 글은 STATUS_LEGEND 와 판정 범위의 이름표·설명(scopeLabel, scopeNote) 그대로다", () => {
    expect(index.sections).toEqual([
      { id: "status", title: "상태의 뜻" },
      { id: "scope", title: SITE.notSeen.title },
    ]);
    expect(index.status).toEqual([
      ...STATUS_ORDER.map((status) => ({ label: STATUS_LABEL[status], text: STATUS_LEGEND[status], chip: true })),
      ...SCOPE_LEGEND.map((scope) => ({ label: scope.label, text: scope.note, chip: false })),
    ]);
    expect(STATUS_ORDER).toHaveLength(7);
    // 판정 범위의 풀이는 결과 화면의 이름표·설명과 같은 함수에서 나온다.
    expect(SCOPE_LEGEND[0]).toEqual({ label: scopeLabel({ kind: "file" }), note: scopeNote({ kind: "file" }, "known", true, "code") });
    expect(SCOPE_LEGEND.map((scope) => scope.label)).toEqual(["파일 전체 판정", "함수 N~M행 판정", "함수 밖 판정", "판정 구역 알 수 없음"]);
    expect(SCOPE_LEGEND[1].note).toBe(scopeNote({ kind: "function", startLine: 12, endLine: 34 }, "known", true).replace("12~34", "N~M"));
    // 판정 구역을 알 수 없는 줄은 결과 화면의 두 말 어느 쪽과도 어긋나지 않는다: 판정 경로가 있는 결과의 말(구역이 "따로" 실려 있지
    // 않다)에서 판정 경로를 가리키는 말만 뺀 것이다. 구역이 결과에 아예 없다고 잘라 적지 않는다(판정 경로의 문장에 구역이 있을 수 있다).
    const unknown = SCOPE_LEGEND[3].note;
    expect(unknown).toBe("함수 단위 규칙의 판정입니다. 판정 구역은 결과에 따로 실려 있지 않습니다.");
    for (const place of ["finding", "code"] as const) {
      expect(scopeNote({ kind: "unknown" }, "known", true, place).startsWith(unknown), place).toBe(true);
    }
    expect(unknown).not.toBe(scopeNote({ kind: "unknown" }, "known", false, "code"));
  });

  it("#scope 검사에 들지 않는 파일과 정보: SITE.notSeen 그대로. 첫 문단은 발견이 있는 결과에서 오는 사람에게 맞는 말(목업의 글)이다", () => {
    // 이 구역으로 잇는 것은 발견이 있는 결과뿐이다(발견이 0인 결과는 목록을 쪽 안에 펼쳐 둔다). "발견이 없어도"로 시작하는 말은 맞지 않는다.
    expect(SITE.notSeen.bookLead).toBe("이 도구는 검사한 파일의 코드를 읽기만 합니다. 아래는 보지 못하므로, 결과에 나온 발견이 전부라는 뜻은 아닙니다.");
    expect(index.scope).toEqual({
      title: SITE.notSeen.title,
      lead: SITE.notSeen.bookLead,
      items: SITE.notSeen.items.map((item) => ({ what: item.what, why: item.why, cases: [...(item.cases ?? [])] })),
    });
  });

  it("결과 화면이 잇는 자리(#status, #scope)가 목록에 있다", () => {
    for (const id of ["status", "scope"]) expect(html).toContain(` id="${id}"`);
  });

  it("쓰지 않는 말이 없고, 마우스를 올려야 뜨는 말(title)이 없다", () => {
    const shown = plain(html);
    for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(shown), `${pattern} — ${why}`).toBe(false);
    expect(html).not.toMatch(/\stitle="/);
  });
});
