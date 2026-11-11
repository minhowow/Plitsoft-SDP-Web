import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnalysisDashboard } from "@/components/service/AnalysisDashboard";
import { ActivityList } from "@/components/service/activity";
import { Failed, HistoryTable, InProgress, PROGRESS_NOTE, RequestAction, StepList } from "@/components/service/analysis";
import { LiveAnalysis, POLL_MS } from "@/components/service/LiveAnalysis";
import { movingText } from "@/components/service/RequestButton";
import { RepoRow } from "@/components/service/parts";
import { LATEST_FINDINGS, LatestAnalysis } from "@/components/service/repository";
import { SearchHome, SearchResults } from "@/components/service/SearchResults";
import { keepArticle } from "@/components/text";
import { packMeta, policyHref } from "@/lib/pack";
import { paragraphOf } from "@/lib/pack/legal";
import { SYNTHETIC_PROFILES } from "@/lib/profile";
import { NO_FEATURES, NO_JUDGEMENT } from "@/components/result/Tiers";
import { parseReport } from "@/lib/report/parse";
import type { Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { analysisHref, commitLink, fileLink, repoHref, repoKey, searchHref, shortCommit } from "@/lib/service/href";
import { ID_ALPHABET, ID_LENGTH, isAnalysisId, newAnalysisId } from "@/lib/service/id";
import { pickActivity } from "@/lib/service/activity";
import { hangulToQwerty } from "@/lib/service/keyboard";
import { placeAt, placeOf, placeText, readPlace } from "@/lib/service/queue";
import { matchRepositories } from "@/lib/service/search";
import { activeStep, duration, finishedAt, formatKst, STEP_ORDER, stepState } from "@/lib/service/steps";
import { SYNTHETIC_RESULT_SOURCES, syntheticRepositories, syntheticStore as store } from "@/lib/service/synthetic";
import type { Analysis, Repository } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { elementsOf, readJson, textOf } from "./helpers";
import { BANNED_WORDING } from "./wording";

// 분석 서비스(방향 B): 데이터 모델, 합성 저장소(SERVICE_STORE=synthetic 의 미리보기), 주소, 그리고 쪽의 부품. 운영 구현
// (DB + GitHub)은 tests/server-store.test.ts, 브라우저에서만 드러나는 것(이동, 넘침, 대비, 요청)은 tests/browser/service.test.ts 가 본다.

// 브라우저 부품(요청 단추, 진행 다시 읽기)은 Next 의 라우터를 쓴다. 부품 시험에는 라우터가 없어 빈 것으로 바꿔 끼운다
// (누르고 다시 읽는 것은 브라우저 시험이 본다: tests/browser/service-db.test.ts).
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));

const repos = syntheticRepositories();
const analyses = (await Promise.all(repos.map(({ repository: r }) => store.listAnalyses(r.owner, r.name)))).flat();

function viewOf(id: string): ReportView {
  const name = SYNTHETIC_RESULT_SOURCES[id];
  const parsed = parseReport(readJson("contract", "cli-current", `${name}.json`));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

describe("합성 저장소는 인터페이스 뒤에 있다", () => {
  it("합성 구현은 합성이라고 밝힌다", () => {
    expect(store.synthetic).toBe(true);
  });

  it("분석 요청은 합성 미리보기라 받지 않는다고 정직하게 돌려준다", async () => {
    expect(await store.requestAnalysis("example-org", "kids-signup")).toMatchObject({ ok: false, reason: "no-server" });
    expect(await store.requestAnalysis("nobody", "nothing")).toMatchObject({ ok: false, reason: "not-found" });
    expect(store.requestsClosed()).toBe(SITE.service.noServer);
  });

  it("저장소는 대소문자를 가리지 않고 찾는다", async () => {
    expect((await store.getRepository("Example-Org", "KIDS-SIGNUP"))?.name).toBe("kids-signup");
    expect(await store.getRepository("example-org", "nothing")).toBeNull();
  });
});

describe("합성 데이터", () => {
  it("저장소는 모두 합성이고, GitHub 주소가 없으며(링크를 걸지 않는다), 이름에 점·대문자가 없다", () => {
    expect(repos.length).toBeGreaterThanOrEqual(5);
    for (const { repository } of repos) {
      expect(repository.synthetic).toBe(true);
      expect(repository.htmlUrl).toBeNull();
      // 설명에는 "합성 예시"를 적지 않는다(재디자인 D4). 합성인 것은 쪽의 이름표가 밝힌다(showsSyntheticTag, tests/server-config.test.ts).
      expect(repository.description).toBeTruthy();
      // 정적 내보내기에서 점이 든 마지막 조각은 끝 슬래시를 잃는다(src/lib/service/href.ts).
      expect(`${repository.owner}/${repository.name}`).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(repository.owner).toMatch(/^example-/);
    }
  });

  it("네 상태(대기·분석 중·끝남·실패), 분석이 여러 번인 저장소, 분석이 없는 저장소가 모두 있다", () => {
    expect(new Set(analyses.map((a) => a.status))).toEqual(new Set(["queued", "running", "succeeded", "failed"]));
    expect(repos.some((hit) => hit.analyses >= 2)).toBe(true);
    expect(repos.some((hit) => hit.analyses === 0 && hit.latest === null)).toBe(true);
  });

  it("분석 id 는 모양이 맞고 서로 겹치지 않는다", () => {
    for (const analysis of analyses) expect(isAnalysisId(analysis.id), analysis.id).toBe(true);
    expect(new Set(analyses.map((a) => a.id)).size).toBe(analyses.length);
  });

  it("단계는 차례대로 모두 있고, 상태와 맞는다", () => {
    for (const analysis of analyses) {
      expect(analysis.steps.map((step) => step.name), analysis.id).toEqual(STEP_ORDER);
      expect(analysis.commit, analysis.id).toMatch(/^[0-9a-f]{40}$/);
      const states = analysis.steps.map((step) => stepState(analysis, step));
      if (analysis.status === "succeeded") expect(states.every((s) => s === "done"), analysis.id).toBe(true);
      if (analysis.status === "running" || analysis.status === "queued") {
        expect(states.filter((s) => s === "active"), analysis.id).toHaveLength(1);
        expect(activeStep(analysis), analysis.id).not.toBeNull();
      }
      if (analysis.status === "failed") {
        expect(analysis.failure, analysis.id).not.toBeNull();
        expect(states.filter((s) => s === "failed"), analysis.id).toEqual(["failed"]);
      } else expect(analysis.failure, analysis.id).toBeNull();
    }
  });

  it("끝난 분석의 결과는 contract/cli-current 의 수집본 그대로이고, 판이 결과와 맞는다", async () => {
    const done = analyses.filter((a) => a.status === "succeeded");
    expect(done.length).toBeGreaterThanOrEqual(4);
    for (const analysis of done) {
      const result = (await store.getResult(analysis.id)) as Report;
      expect(result, analysis.id).toEqual(readJson("contract", "cli-current", `${SYNTHETIC_RESULT_SOURCES[analysis.id]}.json`));
      expect(analysis.versions, analysis.id).toEqual({ tool: result.tool.version, pack: result.run.pack_digest });
    }
    for (const analysis of analyses.filter((a) => a.status !== "succeeded")) {
      expect(await store.getResult(analysis.id), analysis.id).toBeNull();
    }
  });

  it("최근 분석은 저장소마다 한 줄이다: 진행 중인 분석이 있으면 그것, 없으면 가장 나중의 분석. 요청 시각 차례(나중 것이 앞)", async () => {
    const recent = await store.recentActivity(10);
    // 분석이 있는 저장소 다섯(todo-web 은 분석이 없다).
    expect(recent.map(({ repository: r }) => `${r.owner}/${r.name}`)).toEqual([
      "example-labs/shop-front",
      "example-org/night-push",
      "example-studio/genai-chat",
      "example-org/kids-signup",
      "example-labs/plain-utils",
    ]);
    // night-push 는 끝난 분석(64y4jdtazh)보다 분석 중인 것(9f4gxaqj6s)을 보인다.
    expect(recent[1].analysis).toMatchObject({ id: "9f4gxaqj6s", status: "running" });
    expect(recent[1].analyses).toBe(2);
    // genai-chat 은 실패한 분석보다 나중의 끝난 분석을 보인다.
    expect(recent[2].analysis.id).toBe("mruw8xjzjw");
    const times = recent.map(({ analysis }) => analysis.requestedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect((await store.recentActivity(4)).map(({ analysis }) => analysis.id)).toEqual(recent.slice(0, 4).map(({ analysis }) => analysis.id));
    expect(await store.recentActivity(0)).toEqual([]);
  });
});

describe("분석 id", () => {
  it("헷갈리는 글자 없이 10자리이고, 만들 때마다 다르다", () => {
    expect(ID_ALPHABET).not.toMatch(/[01ilo]/);
    const ids = Array.from({ length: 2000 }, () => newAnalysisId());
    for (const id of ids) expect(id).toMatch(new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("치우치지 않게 248 이상의 바이트는 버린다", () => {
    const bytes = [255, 250, 248, 0, 30, 31, 247, 1, 2, 3, 4, 5, 6];
    let at = 0;
    const id = newAnalysisId((buffer) => buffer.map(() => bytes[at++ % bytes.length]));
    expect(id).toBe([0, 30, 0, 247 % 31, 1, 2, 3, 4, 5, 6].map((n) => ID_ALPHABET[n % 31]).join(""));
  });
});

describe("주소와 링크", () => {
  it("저장소·분석·검색 주소", () => {
    expect(repoHref("Example-Org", "Kids-Signup")).toBe("/r/example-org/kids-signup/");
    expect(analysisHref("example-org", "kids-signup", "wtk33e9zuf")).toBe("/r/example-org/kids-signup/a/wtk33e9zuf/");
    expect(repoKey("A", "B")).toBe("a/b");
    expect(searchHref("")).toBe("/search/");
    expect(searchHref("kids signup")).toBe("/search/?q=kids%20signup");
  });

  it("GitHub 의 커밋 고정 링크는 저장소 주소가 있을 때만 만든다", () => {
    const base = ["https:", "", "github.com", "someone", "repo"].join("/");
    const commit = "a".repeat(40);
    expect(commitLink(null, commit)).toBeNull();
    expect(fileLink(null, commit, "src/a.ts", 3)).toBeNull();
    expect(commitLink(base, commit)).toBe(`${base}/commit/${commit}`);
    expect(fileLink(base, commit, "src/a b/c#.ts", 12)).toBe(`${base}/blob/${commit}/src/a%20b/c%23.ts#L12`);
    expect(fileLink(base, commit, "src/a.ts", null)).toBe(`${base}/blob/${commit}/src/a.ts`);
    expect(shortCommit(commit)).toBe("aaaaaaa");
  });
});

describe("검색", () => {
  it("낱말이 모두 이름·설명·언어에 들어 있는 저장소만 남긴다. 대소문자를 가리지 않고, 빈 질의는 빈 목록이다", () => {
    const names = (q: string) => matchRepositories(repos, q).map(({ repository: r }) => `${r.owner}/${r.name}`);
    expect(names("KIDS")).toEqual(["example-org/kids-signup"]);
    expect(names("example-labs")).toEqual(["example-labs/plain-utils", "example-labs/shop-front", "example-labs/todo-web"]);
    expect(names("javascript 쇼핑몰")).toEqual(["example-labs/shop-front"]);
    expect(names("nothing-like-this")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });

  it("합성 저장소의 검색은 같은 거르기다", async () => {
    const hits = matchRepositories(repos, "genai");
    expect(await store.search("genai")).toEqual({ ok: true, hits, total: hits.length });
    expect(await store.search("")).toEqual({ ok: true, hits: [], total: 0 });
  });
});

describe("시각", () => {
  it("한국 표준시로 적고, 걸린 시간을 분·초로 적는다", () => {
    expect(formatKst("2026-10-24T15:30:00Z")).toBe("2026-10-25 00:30");
    expect(duration("2026-10-24T00:00:00Z", "2026-10-24T00:04:12Z")).toBe("4분 12초");
    expect(duration("2026-10-24T00:00:00Z", "2026-10-24T00:00:09Z")).toBe("9초");
  });
});

const find = (status: Analysis["status"]) => analyses.find((a) => a.status === status)!;
const repoOf = (analysis: Analysis) => repos.find(({ repository: r }) => r.name === analysis.name)!.repository;

/** 부품 시험에는 next.config 의 trailingSlash 가 없어 Link 가 끝 슬래시를 뗀다(빌드에서는 붙는다. 브라우저 시험이 본다). */
const linked = (href: string) => `href="${href.replace(/\/$/, "")}"`;

function expectNoBannedWording(html: string): void {
  for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(textOf(html)), why).toBe(false);
}

describe("부품", () => {
  it("진행 중: 진행 중인 단계가 하나이고 aria-current 로 알린다. 합성이면 고정된 순간이라는 것을 밝힌다", () => {
    const html = renderToStaticMarkup(<InProgress analysis={find("running")} note={PROGRESS_NOTE.synthetic} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(textOf(html)).toContain("‘검사(정적 검사와 AI 판정)’ 단계");
    expect(textOf(html)).toContain("고정해 보인 것");
    expectNoBannedWording(html);
    // 실제 분석에는 고정된 순간이라고 적지 않는다.
    expect(textOf(renderToStaticMarkup(<InProgress analysis={find("running")} />))).not.toContain("고정해 보인 것");
  });

  it("진행 중인 실제 분석(LiveAnalysis): 머리와 단계를 그리고, 지금 단계의 줄을 화면 낭독기가 읽는다", () => {
    const running = find("running");
    const html = renderToStaticMarkup(<LiveAnalysis repository={repoOf(running)} analysis={running} />);
    expect(html).toContain(`분석 <code class="v" translate="no">${running.id}</code>`);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    // (D5) `진행` 상자 하나: 지금 단계 한 줄(role=status)과 단계 표(docs/redesign.md 3장). "누구나 볼 수 있고 끝나면 이 주소에…"와
    // "몇 초마다 다시 읽는다"는 풀이 문장은 지웠다(2.3).
    expect(html).toMatch(/<p class="live-now" role="status">지금 ‘검사\(정적 검사와 AI 판정\)’ 단계<\/p>/);
    expect(textOf(html)).not.toMatch(/누구나 볼 수 있고|몇 초마다/);
    expect(textOf(html)).not.toContain("고정해 보인 것");
    expect(POLL_MS).toBe(3_000);
    expectNoBannedWording(html);
  });

  it("진행 중 부품이 끝난·멈춘 분석을 잠깐 그릴 때(다시 읽은 직후) '다음 단계를 기다린다'고 적지 않는다", () => {
    expect(textOf(renderToStaticMarkup(<InProgress analysis={find("succeeded")} />))).toContain("분석이 끝났습니다.");
    const failed = textOf(renderToStaticMarkup(<InProgress analysis={find("failed")} />));
    expect(failed).toContain("분석이 멈췄습니다.");
    expect(failed).not.toContain("기다리고");
  });

  it("실패: 다음 단계에서 멈췄다는 알림을 받아 앞 단계의 끝난 시각을 모르면, 앞 단계는 '끝남'(시각 없음)이고 멈춘 단계만 '멈춤'이다", () => {
    const at = "2026-11-03T08:00:00.000Z";
    const analysis: Analysis = {
      ...find("failed"),
      steps: STEP_ORDER.map((name) => ({ name, startedAt: name === "queued" || name === "fetch" ? at : null, endedAt: name === "fetch" ? at : null })),
      failure: { step: "fetch", reason: "시험" },
    };
    expect(analysis.steps.map((step) => stepState(analysis, step))).toEqual(["done", "failed", "notrun", "notrun"]);
    const html = renderToStaticMarkup(<StepList analysis={analysis} />);
    expect(html.match(/step-failed/g)).toHaveLength(1);
  });

  it("실패: 멈춘 단계와 까닭을 보이고, 검토할 곳이 없다는 뜻이 아니라고 적는다", () => {
    const failed = find("failed");
    const html = renderToStaticMarkup(<Failed analysis={failed} />);
    // (D5) 빨간 테두리 상자의 머리가 멈춘 단계다(목업 analysis-live #failed).
    expect(textOf(html)).toContain("‘저장소 받기·도구 설치’ 단계에서 멈춤");
    expect(html).toContain('<section class="box live-box fail-box"');
    expect(textOf(html)).toContain(failed.failure!.reason);
    expect(textOf(html)).toContain("검토할 곳이 없다는 뜻이 아닙니다");
  });

  it("단계는 넷이다. 정적 검사와 AI 판정은 CLI 명령 하나라 한 단계로 적는다(CLI 가 둘의 경계를 알려 주지 않는다)", () => {
    const html = renderToStaticMarkup(<StepList analysis={find("succeeded")} />);
    expect([...html.matchAll(/<span class="step-name">([^<]*)<\/span>/g)].map((m) => m[1])).toEqual([
      "대기",
      "저장소 받기·도구 설치",
      "검사(정적 검사와 AI 판정)",
      "정리",
    ]);
    expect(textOf(html)).not.toContain("건너뜀");
  });

  it("분석 요청 단추는 누를 수 없고, 바로 옆에 까닭이 있다", () => {
    const repository = repos[0].repository;
    const html = renderToStaticMarkup(<RequestAction repository={repository} closed={SITE.service.noServer} />);
    // disabled 가 아니라 aria-disabled: 키보드로 닿아 까닭을 들을 수 있다. 단추 이름은 기본 브랜치의 최신 커밋을 분석한다는 것 하나다.
    expect(html).toMatch(/<button type="button" aria-disabled="true" aria-describedby="request-off">main 최신 커밋 분석<\/button>/);
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
    expect(textOf(html)).toContain(SITE.service.noServer);
  });

  it("요청을 받는 서버에서는 단추가 듣는다(같은 사이트의 /api/ 를 부르는 브라우저 부품). 까닭 자리는 비어 있다가 바뀌면 읽힌다", () => {
    const repository = repos[0].repository;
    const html = renderToStaticMarkup(<RequestAction repository={{ ...repository, defaultBranch: "develop" }} closed={null} />);
    expect(html).toMatch(/<button type="button" aria-describedby="request-note">develop 최신 커밋 분석<\/button>/);
    expect(html).not.toContain("aria-disabled");
    expect(html).toContain('<p id="request-note" class="hint" role="status"></p>');
    // 요청에 관한 풀이 문장은 두지 않는다(docs/redesign.md 2.3).
    expect(textOf(html)).toBe("develop 최신 커밋 분석");
  });

  it("요청 단추가 옮겨 가며 적는 말: 대기열의 몇 번째인지만 적고 실행 자리의 수는 적지 않는다", () => {
    const base = { kind: "moving", reused: false, failed: false } as const;
    expect(movingText({ ...base, place: { kind: "waiting", ahead: 1, poolSize: 2, inUse: 2 } })).toBe("대기열 2번째. 분석 쪽으로 갑니다.");
    expect(movingText({ ...base, place: { kind: "waiting", ahead: 0, poolSize: 2, inUse: 0, wakeFailure: "까닭" } })).toBe(
      "대기열 1번째. 실행기를 깨우지 못해 대기열이 잠시 멈춰 있습니다. 분석 쪽으로 갑니다.",
    );
    expect(movingText({ ...base, place: { kind: "dispatched", poolSize: 2, inUse: 1 } })).toBe("실행기에 보냈습니다. 분석 쪽으로 갑니다.");
    expect(movingText({ ...base, reused: true, place: null })).toBe("같은 커밋의 분석이 이미 있어 그 분석으로 갑니다.");
    for (const place of [{ kind: "waiting", ahead: 3, poolSize: 2, inUse: 2 }, { kind: "dispatched", poolSize: 2, inUse: 2 }] as const) {
      expect(movingText({ ...base, place })).not.toMatch(/실행 자리|사용 중/);
    }
  });

  it("분석 기록 표: 분석마다 그 쪽으로 가는 링크, 상태, 짧은 커밋, 요청 시각(KST). 끝난 분석에는 발견 수", () => {
    const running = find("running");
    const repository = repoOf(running);
    const list = analyses.filter((a) => a.name === repository.name);
    const html = renderToStaticMarkup(<HistoryTable repository={repository} analyses={list} findings={{ "64y4jdtazh": 2 }} />);
    for (const analysis of list) expect(html).toContain(linked(analysisHref(repository.owner, repository.name, analysis.id)));
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["분석", "상태", "커밋", "요청 시각 (KST)", "발견"]);
    expect(textOf(html)).toContain("2건");
    expect(textOf(html)).toContain("검사(정적 검사와 AI 판정) 중");
    // 합성 저장소의 커밋은 링크가 아니다.
    expect(html).not.toContain("/commit/");
  });

  it("대기열: 대기 중인 분석에 대기열의 몇 번째인지만 적는다(DB 에서 센 숫자). 실행 자리의 수는 적지 않는다. 모르면 적지 않는다", () => {
    const queued = find("queued");
    const repository = repoOf(queued);
    const snapshot = { countedAt: "2026-11-03T03:04:00.000Z", poolSize: 2, inUse: 2, waiting: ["zzzzzzzzzz", queued.id], dispatched: ["yyyyyyyyyy"], wakeFailure: null };
    const place = placeOf(snapshot, queued.id);
    expect(place).toEqual({ kind: "waiting", ahead: 1, poolSize: 2, inUse: 2 });
    expect(placeText(place!)).toBe("대기열 2번째");
    expect(placeAt(place!, snapshot.countedAt)).toBe("대기열 2번째 (12:04 KST 기준)");
    // 분석 쪽은 다시 읽으므로 대기열 줄도 화면 낭독기가 읽는다(role="status"). 센 때는 적지 않는다(늘 지금 숫자다).
    const live = renderToStaticMarkup(<InProgress analysis={queued} live place={place} />);
    // (D5) 대기 중이면 지금 단계 줄이 대기열의 자리다(목업 analysis-live #queued).
    expect(live).toMatch(/<p class="live-now" role="status">대기열 2번째<\/p>/);
    expect(textOf(live)).not.toMatch(/실행 자리|사용 중|기준/);
    // 저장소 쪽의 표는 한 번 그리고 다시 읽지 않는다. 센 때(한국 표준시 시:분)를 붙인다.
    const table = textOf(renderToStaticMarkup(<HistoryTable repository={repository} analyses={[queued]} findings={{}} queue={snapshot} />));
    expect(table).toContain("대기열 2번째 (12:04 KST 기준)");
    expect(table).not.toMatch(/실행 자리|사용 중/);
    // 실행기에 보낸 분석.
    const sent = placeOf({ ...snapshot, waiting: [], dispatched: [queued.id] }, queued.id)!;
    expect(textOf(renderToStaticMarkup(<InProgress analysis={queued} place={sent} />))).toContain("실행기에 보냄, 시작 기다림");
    // 대기열을 모르면(합성, 읽지 못함) 숫자를 적지 않는다. 분석 중인 분석에는 대기열을 적지 않는다.
    expect(textOf(renderToStaticMarkup(<InProgress analysis={queued} />))).not.toContain("대기열");
    expect(textOf(renderToStaticMarkup(<InProgress analysis={find("running")} place={place} />))).not.toContain("대기열");
    expect(textOf(renderToStaticMarkup(<HistoryTable repository={repository} analyses={[queued]} findings={{}} />))).not.toContain("대기열");
  });

  it("실행기를 깨우지 못해 대기열이 멈춰 있으면 분석 쪽에 그 사실과 까닭을 적는다(실행 자리의 수는 적지 않는다)", () => {
    const text = placeText({ kind: "waiting", ahead: 0, poolSize: 2, inUse: 0, wakeFailure: "응답 404." });
    expect(text).toBe("대기열 1번째. 실행기를 깨우지 못해 대기열이 잠시 멈춰 있습니다. 까닭: 응답 404. 2분이 지난 뒤 다시 깨워 봅니다.");
  });

  it("대기열의 자리는 서버가 준 모양일 때만 읽는다", () => {
    expect(readPlace({ kind: "waiting", ahead: 0, poolSize: 2, inUse: 2 })).toEqual({ kind: "waiting", ahead: 0, poolSize: 2, inUse: 2 });
    expect(readPlace({ kind: "dispatched", poolSize: 1, inUse: 1, extra: "x" })).toEqual({ kind: "dispatched", poolSize: 1, inUse: 1 });
    expect(readPlace({ kind: "waiting", ahead: 0, poolSize: 1, inUse: 0, wakeFailure: "까닭." })).toEqual({ kind: "waiting", ahead: 0, poolSize: 1, inUse: 0, wakeFailure: "까닭." });
    expect(readPlace({ kind: "waiting", ahead: 0, poolSize: 1, inUse: 0, wakeFailure: 3 })).toEqual({ kind: "waiting", ahead: 0, poolSize: 1, inUse: 0 });
    for (const bad of [null, "x", { kind: "waiting", poolSize: 2, inUse: 1 }, { kind: "waiting", ahead: -1, poolSize: 2, inUse: 1 }, { kind: "other", poolSize: 1, inUse: 1 }, { kind: "dispatched", poolSize: 1.5, inUse: 1 }]) {
      expect(readPlace(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("분석 기록 표: 발견 0건인 끝난 분석이 있으면 0의 뜻을 함께 적고, 없으면 적지 않는다", () => {
    const done = find("succeeded");
    const repository = repoOf(done);
    const list = analyses.filter((a) => a.name === repository.name);
    const none = Object.fromEntries(list.map((a) => [a.id, 0]));
    const zero = textOf(renderToStaticMarkup(<HistoryTable repository={repository} analyses={list} findings={none} />));
    expect(zero).toContain("0건");
    expect(zero).toContain(SITE.zeroIsNotClearance);
    const some = Object.fromEntries(list.map((a) => [a.id, 3]));
    expect(textOf(renderToStaticMarkup(<HistoryTable repository={repository} analyses={list} findings={some} />))).not.toContain(
      SITE.zeroIsNotClearance,
    );
  });

  it("분석 기록 표: 결과가 없거나 읽지 못한 끝난 분석은 0건이라고 적지 않는다", () => {
    const done = find("succeeded");
    const repository = repoOf(done);
    const list = analyses.filter((a) => a.name === repository.name);
    for (const findings of [{}, Object.fromEntries(list.map((a) => [a.id, null]))]) {
      const text = textOf(renderToStaticMarkup(<HistoryTable repository={repository} analyses={list} findings={findings} />));
      expect(text).not.toContain("0건");
      expect(text).toContain("알 수 없음");
      expect(text).not.toContain(SITE.zeroIsNotClearance);
    }
  });

  it("분석 기록 표: 대기열의 자리를 모르는 대기 중인 분석은 배지만 적는다('대기 중 대기 중'이 되지 않는다)", () => {
    const queued = find("queued");
    const html = renderToStaticMarkup(<HistoryTable repository={repoOf(queued)} analyses={[queued]} findings={{}} queue={null} />);
    expect(textOf(html).match(/대기 중/g)).toHaveLength(1);
    expect(html).not.toContain("an-row-note");
  });

  it("분석 기록 표: 단계 사이에 있는 분석 중인 분석을 '대기 중'이라고 적지 않는다", () => {
    const running = find("running");
    const between: Analysis = {
      ...running,
      steps: running.steps.map((step) => (step.name === "scan" ? { ...step, startedAt: null, endedAt: null } : step)),
    };
    expect(activeStep(between)).toBeNull();
    const text = textOf(renderToStaticMarkup(<HistoryTable repository={repoOf(running)} analyses={[between]} findings={{}} />));
    expect(text).not.toContain("대기 중");
    expect(text).toContain("다음 단계 기다림");
  });

  it("실패한 단계에 끝난 시각이 없으면 멈춘 시각과 걸린 시간을 적지 않는다", () => {
    const failed = find("failed");
    const open: Analysis = {
      ...failed,
      steps: failed.steps.map((step) => (step.name === failed.failure!.step ? { ...step, endedAt: null } : step)),
    };
    expect(finishedAt(failed)).not.toBeNull();
    expect(finishedAt(open)).toBeNull();
  });

  it("실패한 분석에서 시작하지 않은 단계는 '하지 않음'이고 '기다림'이 없다. 대기 중인 분석의 대기 단계는 '대기 중'이다", () => {
    const failed = find("failed");
    const failedText = textOf(renderToStaticMarkup(<StepList analysis={failed} />));
    expect(failedText).not.toContain("기다림");
    expect(failedText).toContain("하지 않음");
    const queued = find("queued");
    const html = renderToStaticMarkup(<StepList analysis={queued} />);
    expect(html).toMatch(/aria-current="step"[^]*?<span class="step-name">대기<\/span><span class="step-time">[^]*?<\/span><span class="step-state">대기 중<\/span>/);
    expect(textOf(html)).not.toContain("진행 중");
  });

  it("검색 결과의 한 줄: 줄 전체가 저장소 쪽 링크이고, 언어·분석 수·최근 분석 날짜. 분석된 적이 없는 저장소는 그렇다고 적는다", () => {
    const none = repos.find((hit) => hit.analyses === 0)!;
    expect(textOf(renderToStaticMarkup(<RepoRow hit={none} />))).toContain("분석된 적 없음");
    const some = repos.find((hit) => hit.analyses >= 2)!;
    const html = renderToStaticMarkup(<RepoRow hit={some} />);
    expect(html).toContain(linked(repoHref(some.repository.owner, some.repository.name)));
    expect(textOf(html)).toContain(`분석 ${some.analyses}회`);
    expect(textOf(html)).toContain(`최근 ${formatKst(some.latest!.requestedAt).slice(0, 10)}`);
    // 줄 안에 링크가 하나뿐이다(분석 id 로 가는 링크를 겹쳐 두지 않는다). 합성 예시 이름표는 줄이 아니라 목록의 머리에 단다.
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain('class="tag"');
  });
});

describe("대시보드", () => {
  // (D5) 분석 쪽의 결과는 /view·데모와 같은 부품(ReportSummary)을 같은 차례로 그린다(docs/redesign.md 3장 "분석").
  const done = analyses.filter((a) => a.status === "succeeded");

  it.each(done.map((a) => [SYNTHETIC_RESULT_SOURCES[a.id], a.id] as const))("%s: 곁칸이 정책 전부를 세고 잇는다. 점수 대신 수만 센다", (_name, id) => {
    const view = viewOf(id);
    const html = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} />);
    const text = textOf(html);
    // 곁칸 `정책 N`: N 은 데이터에서 센다. 상자가 있는 정책은 상자로, 나머지는 조문 도감으로 잇는다.
    expect(html).toContain(`정책 <span class="count">${view.policies.length}</span>`);
    for (const policy of view.policies) {
      const boxed = policy.locations.length > 0 || policy.evidence.length > 0;
      if (boxed) {
        expect(html).toContain(`href="#policy-${policy.id.replaceAll(".", "-")}"`);
        expect(html).toContain(`id="policy-${policy.id.replaceAll(".", "-")}"`);
      } else {
        expect(html).toContain(linked(policyHref(policy.id)));
        expect(html).not.toContain(`id="policy-${policy.id.replaceAll(".", "-")}"`);
      }
    }
    expect(text).toContain(`사람이 볼 곳 ${view.findingCount}건`);
    // 면책은 바닥글(모든 쪽)이 싣는다. 결과 화면 안에 되풀이하지 않는다.
    expect(text).not.toContain(SITE.disclaimer);
    if (view.findingCount === 0) expect(html).toContain(`<p class="zero-line">${SITE.zeroIsNotClearance}</p>`);
    // AI 검토와 다 보지 못한 것을 숨기지 않는다: 검사 정보의 AI 줄과 "결과에 실린 ‘다 보지 못한 파일’ 없음".
    expect(html).toContain(`<dt>판정자</dt><dd>${view.judge ?? "꺼짐"}</dd>`);
    expect(text).toContain("결과에 실린 ‘다 보지 못한 파일’없음");
    expect(text).not.toMatch(/%|점수|등급/);
    expectNoBannedWording(html);
    // 합성 저장소에는 GitHub 링크가 없다.
    expect(html).not.toContain("target=\"_blank\"");
  });

  it("발견이 있는 정책 상자 맨 아래에 근거 조문 원문을 접어 두고(팩 그대로), 판정자를 켜 보라고 권하지 않는다", () => {
    const id = done.find((a) => viewOf(a.id).findingCount > 0)!.id;
    const view = viewOf(id);
    const statutes = Object.fromEntries(
      packMeta.policies.flatMap((policy) => {
        const ref = policy.legal.find((legal) => legal.text);
        return ref?.text ? [[policy.id, { label: ref.label, text: ref.text }]] : [];
      }),
    );
    const html = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} statutes={statutes} />);
    const withFindings = view.policies.filter((policy) => policy.locations.length > 0);
    expect(withFindings.length).toBeGreaterThan(0);
    for (const policy of withFindings) {
      const text = statutes[policy.id]?.text;
      if (text) expect(textOf(html)).toContain(textOf(renderToStaticMarkup(<pre>{text}</pre>)));
    }
    // 접힌 채로 둔다(details, open 없음). 이름은 "근거 조문 원문"이다. 조문 이름은 상자 머리의 조문 링크와 다를 때만 덧붙인다
    // (같은 사실을 한 상자에 두 번 적지 않는다).
    const folds = html.match(/<details class="lg statute-fold"><summary>근거 조문 원문(?: <span class="lg-name">[^<]*<\/span>)?<\/summary>/g) ?? [];
    expect(folds).toHaveLength(withFindings.filter((p) => statutes[p.id]).length);
    // (2026-11-11 오너 지시) 펼치면 조문 이름의 항만 먼저 보이고(원문에서 그대로 잘라 낸 것), 조문 전체는 그 안에서 다시 펼친다.
    for (const policy of withFindings.filter((p) => statutes[p.id])) {
      const statute = statutes[policy.id]!;
      const part = paragraphOf(statute.label, statute.text);
      if (part === null) continue;
      expect(statute.text).toContain(part);
      expect(html).toContain(`<div class="legal-text">${textOf(renderToStaticMarkup(<pre>{part}</pre>))}</div><details class="lg legal-all"><summary>조문 전체</summary>`);
    }
    for (const policy of withFindings.filter((p) => statutes[p.id])) {
      const named = html.includes(`근거 조문 원문 <span class="lg-name">${statutes[policy.id]!.label}</span>`);
      if (statutes[policy.id]!.label === policy.law) expect(named).toBe(false);
    }
    expect(html).not.toContain("로컬에서 판정자를 켜고");
    expect(html).not.toContain("외부 API");
  });

  it("발견이 없는 정책은 곁칸의 상태별 묶음에 모으고, 0의 뜻을 그 아래에 한 번 적는다. 상태 풀이 문장은 정책마다 적지 않는다", () => {
    for (const analysis of done) {
      const view = viewOf(analysis.id);
      const html = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} />);
      const quiet = view.policies.filter((p) => p.locations.length === 0 && p.evidence.length === 0 && p.aiCleared === 0);
      expect((html.match(/<article class="box policy /g) ?? []).length, analysis.id).toBe(
        view.policies.filter((p) => p.locations.length > 0 || p.evidence.length > 0).length,
      );
      expect((html.match(/<div class="side-group">/g) ?? []).length, analysis.id).toBe(new Set(quiet.map((p) => p.status)).size);
      expect((html.match(/<p class="z">/g) ?? []).length, analysis.id).toBe(quiet.length > 0 ? 1 : 0);
      expect(html).not.toContain("quiet-hint");
      expect(html).toContain('href="/policy#status">상태의 뜻</a>');
    }
  });

  it("세 단으로 그린다: 1·2단은 예시 자료가 있을 때만 '예시'로 채우고, 없으면 '아직 없음'이다. 기능이 없는 예시는 걸리는 의무가 없다고 답한다", () => {
    const view = viewOf("64y4jdtazh");
    const heads = (html: string) => elementsOf(html, '<h2 class="tier-hd"').map(textOf);
    const real = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} />);
    expect(heads(real)).toEqual(["1프로필", "2걸리는 의무", "3검토 결과"]);
    expect(elementsOf(real, '<p class="tier-none">').map(textOf)).toEqual(["아직 없음", "아직 없음"]);
    const example = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} profile={SYNTHETIC_PROFILES["example-org/night-push"]} />);
    expect(heads(example)).toEqual(["1프로필예시", "2걸리는 의무예시", "3검토 결과"]);
    expect(textOf(example)).toContain(NO_JUDGEMENT);
    expect(textOf(example)).toContain("걸릴 수 있는 의무 2개");
    const none = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} profile={SYNTHETIC_PROFILES["example-labs/plain-utils"]} />);
    expect(textOf(none)).toContain(NO_FEATURES);
  });

  it("저장소 주소가 있으면 발견 줄마다 커밋 고정 링크를 새 창으로 걸고, 새 창과 고정한 커밋을 화면 낭독기에 알린다", () => {
    const view = viewOf("64y4jdtazh");
    const base = ["https:", "", "github.com", "someone", "night-push"].join("/");
    const commit = "b".repeat(40);
    const html = renderToStaticMarkup(<AnalysisDashboard view={view} code={{ htmlUrl: base, commit }} />);
    const links = [
      ...html.matchAll(
        /<a class="gh" href="([^"]+)" target="_blank" rel="noopener noreferrer"><code>[^]*?<\/code><svg[^]*?<\/svg><span class="visually-hidden">\(GitHub, 새 창, 커밋 bbbbbbb 에 고정\)<\/span><\/a>/g,
      ),
    ].map((m) => m[1]);
    expect(links).toHaveLength(view.findingCount);
    for (const link of links) expect(link.startsWith(`${base}/blob/${commit}/src/marketing/campaign.ts#L`)).toBe(true);
  });
});

/** 합성 저장소의 Repository 가 모양을 지킨다(타입이 바뀌면 여기서 드러난다). */
const _shape: Repository = repos[0].repository;
void _shape;

describe("검색 쪽이 되뇌는 검색어 (검토 1)", () => {
  it("글은 ‘검색어’에 맞는 저장소 없음 그대로이고, 검색어는 줄을 바꿀 수 있는 조각, 마지막 글자와 ’에 만 묶는다", () => {
    const query = "a".repeat(60);
    const html = renderToStaticMarkup(<SearchResults query={query} outcome={{ ok: true, hits: [], total: 0 }} tagged={false} fakeGitHub={false} />);
    const count = html.match(/<h2 class="empty-head search-count"[^>]*>(.*?)<\/h2>/)![1];
    expect(count).toBe(`‘<span class="search-q">${"a".repeat(59)}</span><span class="nobreak">a’에</span> 맞는 저장소 없음`);
    // 검색어 전체가 줄을 바꾸지 않는 조각 안에 들어가지 않는다.
    expect(html).not.toContain(`<span class="nobreak">‘${query}`);
  });
});

describe("검색 0건 (docs/redesign.md 3장 '검색')", () => {
  const zero = (query: string, options: { fakeGitHub?: boolean; tagged?: boolean } = {}) =>
    renderToStaticMarkup(
      <SearchResults
        query={query}
        outcome={{ ok: true, hits: [], total: 0 }}
        tagged={options.tagged ?? false}
        fakeGitHub={options.fakeGitHub ?? false}
        analyzed={{ ok: true, rows: [], findings: {} }}
      />,
    );

  it("한글만 친 질의에는 같은 글쇠의 영문으로 찾는 링크를 둔다. 영문이 섞이면 두지 않는다", () => {
    const html = zero("ㅁㅁ");
    expect(textOf(html)).toContain("‘ㅁㅁ’에 맞는 저장소 없음");
    expect(textOf(html)).toContain("영문 자판으로 친 ‘aa’로 찾기");
    expect(html).toMatch(/href="\/search\/?\?q=aa"/);
    expect(textOf(zero("kids ㅁ"))).not.toContain("영문 자판");
    expect(textOf(zero("zzzz"))).not.toContain("영문 자판");
  });

  it("로컬 가짜 GitHub 이면 그 사실을 한 줄로 적고(저장소 수는 적지 않는다), 아니면 적지 않는다", () => {
    expect(textOf(zero("zzzz", { fakeGitHub: true }))).toContain("로컬 가짜 GitHub: 합성 저장소만 찾습니다.");
    expect(textOf(zero("zzzz"))).not.toContain("가짜 GitHub");
    // 긴 합성 문장은 쓰지 않는다. 이름표다.
    expect(textOf(zero("zzzz", { tagged: true }))).not.toContain(SITE.service.synthetic);
  });

  it("그 아래에 이 사이트에서 분석된 저장소를 둔다. 0건 줄이 보이면 0의 뜻을 둔다", async () => {
    const rows = await store.recentActivity(20);
    const findings = await store.findingCounts(rows.map(({ analysis }) => analysis.id));
    const html = renderToStaticMarkup(
      <SearchResults query="zzzz" outcome={{ ok: true, hits: [], total: 0 }} tagged fakeGitHub={false} analyzed={{ ok: true, rows, findings }} />,
    );
    const text = textOf(html);
    expect(text).toContain("이 사이트에서 분석된 저장소");
    expect(text).toContain("합성 예시");
    for (const { repository: r } of rows) expect(html).toContain(linked(repoHref(r.owner, r.name)));
    // plain-utils 의 끝난 분석은 발견 0건이다.
    expect(text).toContain("발견 0건");
    expect(text).toContain(SITE.zeroIsNotClearance);
  });

  it("결과가 있으면 결과 머리에 합성 예시 이름표를 단다(서버가 정한 tagged 일 때만)", () => {
    const hits = repos.filter((hit) => hit.repository.name.includes("kids"));
    expect(hits.length).toBeGreaterThan(0);
    const render = (tagged: boolean) =>
      renderToStaticMarkup(<SearchResults query="kids" outcome={{ ok: true, hits, total: hits.length }} tagged={tagged} fakeGitHub={false} />);
    expect(render(true)).toMatch(/<div class="sec-h">[^]*?<span class="tag">합성 예시<\/span>/);
    expect(render(false)).not.toContain('class="tag"');
    // 쪽 제목은 검색창과 같은 단 안에 있다(목업 search: 제목과 검색창 사이 16px).
    expect(render(false)).toMatch(/^<div class="search-page"><h1>저장소 검색<\/h1><form/);
  });

  it("GitHub 에 묻지 못하면 그 까닭을 그대로 적는다", () => {
    const html = renderToStaticMarkup(<SearchResults query="kids" outcome={{ ok: false, message: "상한(시험)." }} tagged={false} fakeGitHub={false} />);
    // 제목(‘kids’ 검색하지 못함)이 이미 말하므로 '검색하지 못했습니다.'를 되풀이하지 않는다(D4 검토).
    expect(textOf(html)).toContain("검색하지 못함");
    expect(textOf(html)).toContain("상한(시험).");
    expect(textOf(html)).not.toContain("검색하지 못했습니다");
  });
});

describe("조문 이름의 줄 바꿈", () => {
  it("끝의 조·항(·호)만 줄을 바꾸지 않는 조각으로 묶고 글자는 그대로다", () => {
    for (const label of packMeta.policies.flatMap((policy) => policy.legal.map((legal) => legal.label))) {
      const html = renderToStaticMarkup(<>{keepArticle(label)}</>);
      expect(textOf(html)).toBe(label);
      expect(html).toMatch(/<span class="nobreak">제\d+조(의\d+)?( 제\d+항)?<\/span>$/);
    }
    expect(renderToStaticMarkup(<>{keepArticle("개인정보 보호법 제22조의2 제1항")}</>)).toBe('개인정보 보호법 <span class="nobreak">제22조의2 제1항</span>');
    expect(keepArticle("조문 없음")).toBe("조문 없음");
  });
});

describe("영문 자판으로 옮기기 (두벌식 → QWERTY)", () => {
  it.each([
    ["ㅁㅁ", "aa"],
    ["한글", "gksrmf"],
    ["ㅏ", "k"],
    ["까치", "Rkcl"],
    ["얘기", "dOrl"],
    ["값", "rkqt"],
    ["닭", "ekfr"],
    ["와", "dhk"],
    ["뷁", "qnpfr"],
    ["의사", "dmltk"],
    ["ㄳ ㅘ", "rt hk"],
    ["ㅃ", "Q"],
  ])("%s → %s", (input, output) => {
    expect(hangulToQwerty(input)).toBe(output);
  });

  it("한글이 아닌 글자가 섞이거나 한글이 없으면 옮기지 않는다", () => {
    for (const input of ["", "  ", "kids", "kids ㅁ", "ㅁ1", "日本", "ㅁ-ㅁ"]) expect(hangulToQwerty(input), input).toBeNull();
  });
});

describe("최근 분석 고르기 (첫 화면의 줄)", () => {
  const at = (minute: number) => new Date(Date.parse("2026-11-03T00:00:00Z") + minute * 60_000).toISOString();
  const make = (id: string, repo: string, status: Analysis["status"], minute: number): Analysis => ({
    ...find("succeeded"),
    id,
    owner: repo.split("/")[0],
    name: repo.split("/")[1],
    status,
    requestedAt: at(minute),
    failure: status === "failed" ? { step: "fetch", reason: "시험" } : null,
  });

  it("저장소마다 한 줄, 진행 중인 분석이 먼저, 그다음 가장 나중의 분석. 대소문자만 다른 이름은 한 저장소다. 요청 시각 차례", () => {
    const list = [
      make("aaaaaaaaa1", "Org/One", "succeeded", 10),
      make("aaaaaaaaa2", "org/one", "running", 5),
      make("aaaaaaaaa3", "org/two", "failed", 7),
      make("aaaaaaaaa4", "org/two", "succeeded", 3),
      make("aaaaaaaaa5", "org/three", "queued", 1),
      make("aaaaaaaaa6", "org/three", "running", 2),
      make("aaaaaaaaa7", "org/four", "succeeded", 9),
    ];
    const picked = pickActivity(list, 10);
    expect(picked.map(({ analysis }) => analysis.id)).toEqual(["aaaaaaaaa7", "aaaaaaaaa3", "aaaaaaaaa2", "aaaaaaaaa6"]);
    expect(picked.map(({ analyses }) => analyses)).toEqual([1, 2, 2, 2]);
    // 보이는 분석이 앞의 것이어도 가장 나중의 요청 시각을 따로 안다.
    expect(picked[2].latestAt).toBe(at(10));
    expect(pickActivity(list, 2).map(({ analysis }) => analysis.id)).toEqual(["aaaaaaaaa7", "aaaaaaaaa3"]);
  });
});

describe("첫 화면·검색 빈 상태의 최근 분석 줄", () => {
  it("줄은 분석 쪽 링크이고, 끝난 분석은 발견 수(화면 낭독기에는 '끝남, '), 나머지는 상태 글. 분석 중이면 단계 점과 지금 단계", async () => {
    const rows = await store.recentActivity(10);
    const findings = await store.findingCounts(rows.map(({ analysis }) => analysis.id));
    const html = renderToStaticMarkup(<ActivityList rows={rows} findings={findings} variant="feed" />);
    for (const { repository: r, analysis } of rows) expect(html).toContain(linked(analysisHref(r.owner, r.name, analysis.id)));
    expect(html).toContain('<span class="visually-hidden">끝남, </span>발견 0건');
    expect(textOf(html)).toContain("분석 중");
    expect(textOf(html)).toContain("대기 중");
    expect(html.match(/class="act-trail"/g)).toHaveLength(1);
    expect(textOf(html)).toContain("검사(정적 검사와 AI 판정)");
    expect(textOf(html)).toContain(SITE.zeroIsNotClearance);
  });

  it("단계 사이의 분석 중인 줄은 '다음 단계 기다림'이고, 결과를 읽지 못한 끝난 줄은 0이 아니라 '발견 수 알 수 없음'이다", async () => {
    const [row] = (await store.recentActivity(10)).filter(({ analysis }) => analysis.status === "running");
    const between = { ...row, analysis: { ...row.analysis, steps: row.analysis.steps.map((step) => (step.name === "scan" ? { ...step, startedAt: null } : step)) } };
    expect(textOf(renderToStaticMarkup(<ActivityList rows={[between]} findings={{}} variant="feed" />))).toContain("다음 단계 기다림");
    const done = (await store.recentActivity(10)).find(({ analysis }) => analysis.status === "succeeded")!;
    const text = textOf(renderToStaticMarkup(<ActivityList rows={[done]} findings={{ [done.analysis.id]: null }} variant="box" />));
    expect(text).toContain("발견 수 알 수 없음");
    expect(text).not.toContain("0건");
    expect(text).not.toContain(SITE.zeroIsNotClearance);
  });

  it("검색 빈 상태: 최근 분석 상자, 검사하는 정책(팩의 정책 모두, 조문 도감 링크). 분석이 없으면 '아직 분석 없음'", async () => {
    const rows = await store.recentActivity(8);
    const findings = await store.findingCounts(rows.map(({ analysis }) => analysis.id));
    const html = renderToStaticMarkup(<SearchHome recent={{ ok: true, rows, findings }} tagged />);
    expect(html.match(/class="pol-row"/g)).toHaveLength(packMeta.policies.length);
    for (const policy of packMeta.policies) expect(html).toContain(linked(policyHref(policy.id)));
    expect(textOf(html)).toContain(`검사하는 정책 ${packMeta.policies.length}`);
    // 대표 조문의 끝 '제N조 제M항'은 한 덩어리로 줄을 바꾼다(글자는 팩 그대로).
    expect(html).toContain('<span class="nobreak">제50조 제3항</span>');
    expect(textOf(html)).toContain(SITE.zeroIsNotClearance);
    expect(textOf(html)).toContain("합성 예시");
    const empty = textOf(renderToStaticMarkup(<SearchHome recent={{ ok: true, rows: [], findings: {} }} tagged={false} />));
    expect(empty).toContain("아직 분석 없음");
    expect(empty).not.toContain("합성 예시");
    const down = textOf(renderToStaticMarkup(<SearchHome recent={{ ok: false, message: "DB(시험)." }} tagged={false} />));
    expect(down).toContain("DB(시험).");
  });
});

describe("저장소 쪽의 최신 분석 상자", () => {
  const done = (id: string) => analyses.find((a) => a.id === id)!;

  it("머리 줄: 배지, id, 커밋, 시각 KST, 걸린 시간(단계의 시각에서), 사람이 볼 곳 N건, 결과 보기. 정책 줄과 발견 줄(CLI 메시지 그대로, 경로:줄, 판정 범위)", () => {
    const analysis = done("64y4jdtazh");
    const view = viewOf(analysis.id);
    const html = renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={view} />);
    const text = textOf(html);
    expect(text).toContain("최신 분석");
    expect(text).toContain("끝남");
    expect(text).toContain(analysis.id);
    expect(text).toContain(shortCommit(analysis.commit));
    expect(text).toContain(`${formatKst(analysis.requestedAt)} KST`);
    expect(text).toContain(`걸린 시간 ${duration(analysis.steps[0].startedAt!, finishedAt(analysis)!)}`);
    expect(text).toContain(`사람이 볼 곳 ${view.findingCount}건`);
    expect(html).toContain(linked(analysisHref(analysis.owner, analysis.name, analysis.id)));
    // 판정자 없이 만든 결과라 AI 가 푼 경고 수는 적지 않는다.
    expect(text).not.toContain("AI 가 푼 경고");
    const located = view.policies.filter((p) => p.locations.length > 0);
    for (const policy of located) expect(text).toContain(policy.title);
    const first = located[0].locations[0];
    expect(text).toContain(first.finding.unsatisfied_alternatives[0].message!);
    expect(text).toContain(`${first.file}:${first.line}`);
    expect(text).toContain("파일 전체 판정");
    expect(html).not.toMatch(/\stitle="/);
    expect(text).not.toContain(SITE.zeroIsNotClearance);
  });

  it(`발견 줄은 모두 합해 ${LATEST_FINDINGS}개까지다`, () => {
    const analysis = done("64y4jdtazh");
    const view = viewOf(analysis.id);
    const many: ReportView = {
      ...view,
      policies: view.policies.map((p) => (p.locations.length > 0 ? { ...p, locations: Array.from({ length: 4 }, () => p.locations).flat() } : p)),
    };
    const html = renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={many} />);
    expect(html.match(/class="latest-fd"/g)).toHaveLength(LATEST_FINDINGS);
  });

  it("발견이 0이면 0의 뜻을 둔다. 결과를 읽지 못했으면 0 이 아니라 알 수 없음이다", () => {
    const analysis = done("w7bc479x2u");
    const zero = textOf(renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={viewOf(analysis.id)} />));
    expect(zero).toContain("사람이 볼 곳 0건");
    expect(zero).toContain(SITE.zeroIsNotClearance);
    const unread = textOf(renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={null} />));
    expect(unread).toContain("발견 수 알 수 없음");
    expect(unread).not.toContain("0건");
    expect(unread).not.toContain(SITE.zeroIsNotClearance);
  });

  it("판정자를 켠 분석이면 머리에 AI 가 푼 경고 수(run.ai_cleared)를 더한다", () => {
    const analysis = done("64y4jdtazh");
    const parsed = parseReport(readJson("tests", "fixtures", "judge-on.cleared.json"));
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const view = buildReportView(parsed.report, parsed.contract, packMeta);
    expect(view.judge).not.toBeNull();
    expect(view.aiCleared.length).toBeGreaterThan(0);
    const text = textOf(renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={view} />));
    expect(text).toContain(`AI 가 푼 경고 ${view.aiCleared.length}건`);
  });

  it("판정자를 켠 분석이면 적용 질문으로 빠진 판정 수(run.ai_dismissed)도 숨기지 않는다. 목록이 없으면 수를 모른다고 적는다", () => {
    const analysis = done("64y4jdtazh");
    const parsed = parseReport(readJson("tests", "fixtures", "judge-on.dismissed.json"));
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const view = buildReportView(parsed.report, parsed.contract, packMeta);
    expect(view.judge).not.toBeNull();
    expect(view.aiDismissedKnown).toBe(true);
    expect(view.aiDismissed.length).toBeGreaterThan(0);
    const text = textOf(renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={view} />));
    expect(text).toContain(`AI 가 적용되지 않는다고 답해 빠진 판정 ${view.aiDismissed.length}건`);
    expect(text).toContain("AI 가 푼 경고 0건");
    const unknown = textOf(
      renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={{ ...view, aiDismissed: [], aiDismissedKnown: false }} />),
    );
    expect(unknown).toContain("AI 가 적용되지 않는다고 답해 빠진 판정 알 수 없음");
    // 판정자 없이 만든 결과에는 둘 다 적지 않는다.
    const off = textOf(renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={viewOf(analysis.id)} />));
    expect(off).not.toContain("빠진 판정");
  });

  it("첫 대안의 값이 '모름'이면 발견 줄 앞에 채운 '모름' 이름표(.unk)를 단다. 합성 예시의 테두리 이름표(.tag)가 아니다", () => {
    const analysis = done("64y4jdtazh");
    const view = viewOf(analysis.id);
    const unknown: ReportView = {
      ...view,
      policies: view.policies.map((p) => ({
        ...p,
        locations: p.locations.map((location) => ({
          ...location,
          finding: {
            ...location.finding,
            unsatisfied_alternatives: location.finding.unsatisfied_alternatives.map((alt, i) => (i === 0 ? { ...alt, value: "unknown" as const } : alt)),
          },
        })),
      })),
    };
    const html = renderToStaticMarkup(<LatestAnalysis repository={repoOf(analysis)} analysis={analysis} view={unknown} />);
    expect(html).toContain('<span class="unk">모름</span>');
    expect(html).not.toContain('class="tag"');
  });
});
