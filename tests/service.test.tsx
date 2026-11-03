import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnalysisDashboard } from "@/components/service/AnalysisDashboard";
import { AnalysisList, Failed, InProgress, PROGRESS_NOTE, RequestPanel, StepList } from "@/components/service/analysis";
import { LiveAnalysis, POLL_MS } from "@/components/service/LiveAnalysis";
import { RepoRow } from "@/components/service/parts";
import { SearchResults } from "@/components/service/SearchResults";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import type { Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { analysisHref, commitLink, fileLink, repoHref, repoKey, searchHref, shortCommit } from "@/lib/service/href";
import { ID_ALPHABET, ID_LENGTH, isAnalysisId, newAnalysisId } from "@/lib/service/id";
import { placeOf, readPlace } from "@/lib/service/queue";
import { matchRepositories } from "@/lib/service/search";
import { activeStep, duration, finishedAt, formatKst, STEP_ORDER, stepState } from "@/lib/service/steps";
import { SYNTHETIC_RESULT_SOURCES, syntheticRepositories, syntheticStore as store } from "@/lib/service/synthetic";
import type { Analysis, Repository } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { readJson, textOf } from "./helpers";
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
      expect(repository.description).toContain("합성 예시");
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

  it("최근에 끝난 분석은 끝난 것만, 나중 것이 앞이다", async () => {
    const recent = await store.recentSucceeded(10);
    expect(recent.every(({ analysis }) => analysis.status === "succeeded")).toBe(true);
    const times = recent.map(({ analysis }) => analysis.requestedAt);
    expect(times).toEqual([...times].sort().reverse());
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

  it("진행 중인 실제 분석(LiveAnalysis): 머리와 단계를 그리고, 다시 읽는다고 적고, 지금 단계의 줄을 화면 낭독기가 읽는다", () => {
    const running = find("running");
    const html = renderToStaticMarkup(<LiveAnalysis repository={repoOf(running)} analysis={running} />);
    expect(html).toContain(`분석 <code>${running.id}</code>`);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/<p class="notice" role="status">지금 ‘검사\(정적 검사와 AI 판정\)’/);
    expect(textOf(html)).toContain(PROGRESS_NOTE.live);
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
    expect(textOf(html)).toContain("‘저장소 받기·도구 설치’ 단계에서 멈췄습니다.");
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
    const html = renderToStaticMarkup(<RequestPanel repository={repository} latest={null} closed={SITE.service.noServer} />);
    // disabled 가 아니라 aria-disabled: 키보드로 닿아 까닭을 들을 수 있다.
    expect(html).toMatch(/<button type="button" aria-disabled="true" aria-describedby="request-off">분석 요청<\/button>/);
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
    expect(textOf(html)).toContain(SITE.service.noServer);
  });

  it("요청을 받는 서버에서는 단추가 듣는다(같은 사이트의 /api/ 를 부르는 브라우저 부품). 까닭 자리는 비어 있다가 바뀌면 읽힌다", () => {
    const repository = repos[0].repository;
    const html = renderToStaticMarkup(<RequestPanel repository={repository} latest={find("succeeded")} closed={null} />);
    expect(html).toMatch(/<button type="button" aria-describedby="request-note">다시 분석 요청<\/button>/);
    expect(html).not.toContain("aria-disabled");
    expect(html).toContain('<p id="request-note" class="hint" role="status"></p>');
    expect(textOf(html)).toContain("같은 커밋을 최근에 분석했으면 그 분석으로 갑니다.");
  });

  it("분석 목록: 분석마다 그 쪽으로 가는 링크, 상태, 짧은 커밋. 끝난 분석에는 발견 수", () => {
    const running = find("running");
    const repository = repoOf(running);
    const list = analyses.filter((a) => a.name === repository.name);
    const html = renderToStaticMarkup(<AnalysisList repository={repository} analyses={list} findings={{ "64y4jdtazh": 2 }} />);
    for (const analysis of list) expect(html).toContain(linked(analysisHref(repository.owner, repository.name, analysis.id)));
    expect(textOf(html)).toContain("발견 2건");
    expect(textOf(html)).toContain("검사(정적 검사와 AI 판정) 중");
    // 합성 저장소의 커밋은 링크가 아니다.
    expect(html).not.toContain("/commit/");
  });

  it("대기열: 대기 중인 분석에 대기열의 몇 번째인지와 실행 자리를 적는다(DB 에서 센 숫자). 모르면 적지 않는다", () => {
    const queued = find("queued");
    const repository = repoOf(queued);
    const snapshot = { countedAt: "2026-11-03T03:04:00.000Z", poolSize: 2, inUse: 2, waiting: ["zzzzzzzzzz", queued.id], dispatched: ["yyyyyyyyyy"], wakeFailure: null };
    const place = placeOf(snapshot, queued.id);
    expect(place).toEqual({ kind: "waiting", ahead: 1, poolSize: 2, inUse: 2 });
    const page = textOf(renderToStaticMarkup(<LiveAnalysis repository={repository} analysis={queued} place={place} />));
    expect(page).toContain("대기열 2번째입니다(앞에 1개). 실행 자리 2개 중 2개 사용 중입니다.");
    // 진행 쪽은 다시 읽으므로 대기열 줄도 화면 낭독기가 읽는다(role="status"). 센 때는 적지 않는다(늘 지금 숫자다).
    const live = renderToStaticMarkup(<InProgress analysis={queued} live place={place} />);
    expect(live).toMatch(/<p class="hint an-queue" role="status">대기열 2번째/);
    expect(textOf(live)).not.toContain("이 쪽을 연 때");
    // 저장소 쪽은 한 번 그리고 다시 읽지 않는다. 숫자가 그때의 것이라고 적는다(검토).
    const compact = textOf(renderToStaticMarkup(<InProgress analysis={queued} compact place={place} countedAt={snapshot.countedAt} />));
    expect(compact).toContain("이 쪽을 연 때(2026-11-03 12:04 한국 표준시) 대기열 2번째입니다(앞에 1개).");
    expect(compact).toContain("분석 쪽에서는 계속 갱신됩니다.");
    const list = textOf(renderToStaticMarkup(<AnalysisList repository={repository} analyses={[queued]} findings={{}} queue={snapshot} />));
    expect(list).toContain("대기열 2번째(앞에 1개)");
    expect(list).toContain("대기열 순서는 이 쪽을 연 때(2026-11-03 12:04 한국 표준시)의 것입니다. 분석 쪽에서는 계속 갱신됩니다.");
    // 실행기에 보낸 분석.
    const sent = placeOf({ ...snapshot, waiting: [], dispatched: [queued.id] }, queued.id)!;
    expect(textOf(renderToStaticMarkup(<InProgress analysis={queued} place={sent} />))).toContain(
      "실행 자리를 얻어 실행기에 보냈고, 실행기가 시작을 알리기를 기다리고 있습니다. 실행 자리 2개 중 2개 사용 중입니다.",
    );
    // 대기열을 모르면(합성, 읽지 못함) 숫자를 적지 않는다. 분석 중인 분석에는 대기열을 적지 않는다.
    expect(textOf(renderToStaticMarkup(<InProgress analysis={queued} />))).not.toContain("대기열");
    expect(textOf(renderToStaticMarkup(<InProgress analysis={find("running")} place={place} />))).not.toContain("대기열");
    expect(textOf(renderToStaticMarkup(<AnalysisList repository={repository} analyses={[queued]} findings={{}} />))).not.toContain("대기열");
  });

  it("요청 칸: 요청을 받는 서버에서는 지금의 실행 자리와 대기열 길이를 적고, 받지 않으면 적지 않는다", () => {
    const repository = repos[0].repository;
    const snapshot = { countedAt: "2026-11-03T03:04:00.000Z", poolSize: 2, inUse: 1, waiting: [], dispatched: [], wakeFailure: null };
    const open = textOf(renderToStaticMarkup(<RequestPanel repository={repository} latest={null} closed={null} queue={snapshot} />));
    // 한 번 그리고 다시 읽지 않는 쪽이라 "지금"이라고 하지 않고 센 때를 적는다(검토).
    expect(open).toContain("이 쪽을 연 때(2026-11-03 12:04 한국 표준시) 이 사이트 전체에서 실행 자리 2개 중 1개 사용 중, 대기열 0개.");
    expect(open).not.toContain("지금 이 사이트");
    const closed = textOf(renderToStaticMarkup(<RequestPanel repository={repository} latest={null} closed={SITE.service.noServer} queue={snapshot} />));
    expect(closed).not.toContain("실행 자리");
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

  it("분석 목록: 발견 0건인 끝난 분석이 있으면 0의 뜻을 함께 적고, 없으면 적지 않는다", () => {
    const done = find("succeeded");
    const repository = repoOf(done);
    const list = analyses.filter((a) => a.name === repository.name);
    const none = Object.fromEntries(list.map((a) => [a.id, 0]));
    const zero = textOf(renderToStaticMarkup(<AnalysisList repository={repository} analyses={list} findings={none} />));
    expect(zero).toContain("발견 0건");
    expect(zero).toContain(SITE.zeroIsNotClearance);
    const some = Object.fromEntries(list.map((a) => [a.id, 3]));
    expect(textOf(renderToStaticMarkup(<AnalysisList repository={repository} analyses={list} findings={some} />))).not.toContain(
      SITE.zeroIsNotClearance,
    );
  });

  it("분석 목록: 결과가 없거나 읽지 못한 끝난 분석은 0건이라고 적지 않는다", () => {
    const done = find("succeeded");
    const repository = repoOf(done);
    const list = analyses.filter((a) => a.name === repository.name);
    for (const findings of [{}, Object.fromEntries(list.map((a) => [a.id, null]))]) {
      const text = textOf(renderToStaticMarkup(<AnalysisList repository={repository} analyses={list} findings={findings} />));
      expect(text).not.toContain("발견 0건");
      expect(text).toContain("발견 수 알 수 없음");
      expect(text).not.toContain(SITE.zeroIsNotClearance);
    }
  });

  it("분석 목록: 단계 사이에 있는 분석 중인 분석을 '대기 중'이라고 적지 않는다", () => {
    const running = find("running");
    const between: Analysis = {
      ...running,
      steps: running.steps.map((step) => (step.name === "scan" ? { ...step, startedAt: null, endedAt: null } : step)),
    };
    expect(activeStep(between)).toBeNull();
    const text = textOf(renderToStaticMarkup(<AnalysisList repository={repoOf(running)} analyses={[between]} findings={{}} />));
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
    expect(html).toMatch(/aria-current="step"[^]*?<span class="step-name">대기<\/span><span class="step-state">대기 중<\/span>/);
    expect(textOf(html)).not.toContain("진행 중");
  });

  it("검색 결과의 한 줄: 분석된 적이 없는 저장소는 그렇다고 적는다", () => {
    const none = repos.find((hit) => hit.analyses === 0)!;
    expect(textOf(renderToStaticMarkup(<RepoRow hit={none} />))).toContain("분석된 적 없음");
    const some = repos.find((hit) => hit.analyses >= 2)!;
    const html = renderToStaticMarkup(<RepoRow hit={some} />);
    expect(html).toContain(linked(repoHref(some.repository.owner, some.repository.name)));
    expect(textOf(html)).toContain("합성 예시");
  });
});

describe("대시보드", () => {
  const done = analyses.filter((a) => a.status === "succeeded");

  it.each(done.map((a) => [SYNTHETIC_RESULT_SOURCES[a.id], a.id] as const))("%s: 정책마다 요약과 카드가 있고, 점수 대신 수만 센다", (_name, id) => {
    const view = viewOf(id);
    const html = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} />);
    const text = textOf(html);
    // 정책별 요약은 카드로 가는 링크다.
    for (const policy of view.policies) {
      expect(html).toContain(`href="#policy-${policy.id.replaceAll(".", "-")}"`);
      expect(html).toContain(`id="policy-${policy.id.replaceAll(".", "-")}"`);
    }
    expect(text).toContain(`사람이 볼 곳${view.findingCount}건`);
    expect(text).toContain(SITE.disclaimer);
    if (view.findingCount === 0) expect(text).toContain(SITE.zeroIsNotClearance);
    // AI 가 푼 것과 검사 범위를 숨기지 않는다.
    expect(text).toContain("AI 가 푼 것");
    expect(text).toContain("다 보지 못한 것");
    expect(text).not.toMatch(/%|점수|등급/);
    expectNoBannedWording(html);
    // 합성 저장소에는 GitHub 링크가 없다.
    expect(html).not.toContain("target=\"_blank\"");
  });

  it("발견이 있는 정책 카드에 근거 조문 원문을 접어 두고(팩 그대로), 판정자를 켜 보라고 권하지 않는다", () => {
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
    expect(html.match(/<details class="fold dash-statute">/g)).toHaveLength(withFindings.filter((p) => statutes[p.id]).length);
    expect(html).not.toContain("로컬에서 판정자를 켜고");
  });

  it("발견이 없는 정책은 표 한 장에 모으고, 상태의 뜻을 상태마다 한 번만 적는다", () => {
    for (const analysis of done) {
      const view = viewOf(analysis.id);
      const html = renderToStaticMarkup(<AnalysisDashboard view={view} code={null} />);
      const quiet = view.policies.filter((p) => p.locations.length === 0 && p.evidence.length === 0 && p.aiCleared === 0);
      expect((html.match(/<article class="policy /g) ?? []).length, analysis.id).toBe(view.policies.length - quiet.length);
      expect((html.match(/class="hint quiet-hint"/g) ?? []).length, analysis.id).toBe(new Set(quiet.map((p) => p.status)).size);
    }
  });

  it("저장소 주소가 있으면 발견 줄마다 커밋 고정 링크를 새 창으로 건다", () => {
    const view = viewOf("64y4jdtazh");
    const base = ["https:", "", "github.com", "someone", "night-push"].join("/");
    const commit = "b".repeat(40);
    const html = renderToStaticMarkup(<AnalysisDashboard view={view} code={{ htmlUrl: base, commit }} />);
    const links = [...html.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">GitHub 에서 이 줄 보기<\/a>/g)].map((m) => m[1]);
    expect(links).toHaveLength(view.findingCount);
    for (const link of links) expect(link.startsWith(`${base}/blob/${commit}/src/marketing/campaign.ts#L`)).toBe(true);
  });
});

/** 합성 저장소의 Repository 가 모양을 지킨다(타입이 바뀌면 여기서 드러난다). */
const _shape: Repository = repos[0].repository;
void _shape;

describe("검색 쪽이 되뇌는 검색어 (검토 1)", () => {
  it("글은 ‘검색어’에 맞는 저장소 N개 그대로이고, 검색어는 줄을 바꿀 수 있는 조각, 마지막 글자와 ’에 만 묶는다", () => {
    const query = "a".repeat(60);
    const html = renderToStaticMarkup(<SearchResults query={query} outcome={{ ok: true, hits: [], total: 0 }} synthetic={false} />);
    const count = html.match(/<p class="search-count"[^>]*>(.*?)<\/p>/)![1];
    expect(count).toBe(`‘<span class="search-q">${"a".repeat(59)}</span><span class="nobreak">a’에</span> 맞는 저장소 0개`);
    // 검색어 전체가 줄을 바꾸지 않는 조각 안에 들어가지 않는다.
    expect(html).not.toContain(`<span class="nobreak">‘${query}`);
  });
});
