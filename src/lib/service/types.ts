/**
 * 분석 서비스(방향 B, docs/direction.md)의 데이터 모델.
 *
 * 쪽은 이 모양과 `ServiceStore` 만 안다. 운영 구현은 Postgres 와 GitHub API 로 채우고(`src/server/store/db.ts`), 합성
 * 구현(`synthetic.ts`)은 SERVICE_STORE=synthetic 일 때만 쓰는 미리보기·시험용이다. 결과 JSON 은 CLI 가 낸 그대로다. 이 모델은
 * 그 안을 해석하지 않는다(읽는 것은 `lib/report/` 의 파서와 화면 구조).
 */

import type { Profile } from "@/lib/profile";
import type { Review } from "@/lib/review";
import type { QueueSnapshot } from "./queue";
import type { GitHubSuggestPart, SiteSuggestion } from "./suggest";

/**
 * 저장소. GitHub 의 저장소 정보(search/repositories 의 항목, repos/{owner}/{repo})에서 오는 것만 둔다. 거기에 없는 것을 꾸며
 * 채우지 않는다.
 */
export interface Repository {
  /** GitHub 이 돌려준 그대로의 대소문자. 화면에는 이것을 적는다. 주소는 소문자로 만든다(`href.ts`). */
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  /** GitHub 이 정한 주 언어. 없을 수 있다. */
  language: string | null;
  /**
   * GitHub 의 저장소 주소(검색 결과의 html_url). 파일·줄·커밋 고정 링크는 이것에서 만든다. 합성 저장소는 GitHub 에 없으므로
   * null 이고, 그때 화면은 링크를 걸지 않는다(없는 저장소나 같은 이름의 남의 계정으로 보내지 않는다).
   */
  htmlUrl: string | null;
  /** 합성 예시인지. 합성인 곳에는 그렇다고 밝힌다(docs/commitments.md 의 1). */
  synthetic: boolean;
}

export type AnalysisStatus = "queued" | "running" | "succeeded" | "failed";

/** 진행 단계. 차례대로 지난다(`steps.ts` 의 `STEP_ORDER`). 정적 검사와 AI 판정은 한 단계 `scan` 이다(그 까닭은 `steps.ts`). */
export type StepName = "queued" | "fetch" | "scan" | "finish";

export interface AnalysisStep {
  name: StepName;
  /** 시작한 시각(ISO 8601, UTC). 아직 시작하지 않았으면 null. */
  startedAt: string | null;
  /** 끝난 시각. 진행 중이거나 시작하지 않았으면 null. */
  endedAt: string | null;
}

export interface AnalysisFailure {
  /** 멈춘 단계. */
  step: StepName;
  /** 사람이 읽는 까닭. 실행기가 남긴 것을 그대로 적는다. */
  reason: string;
}

/**
 * 분석 하나. 같은 저장소를 여러 번 분석해도 분석마다 따로 남고, 저마다 id 가 있다.
 */
export interface Analysis {
  /** 추측하기 어려운 짧은 id(`id.ts`). 주소에 그대로 쓴다. */
  id: string;
  owner: string;
  name: string;
  /** 검사한 커밋(40자리 16진수). 요청할 때 기본 브랜치의 끝 커밋으로 정한다. */
  commit: string;
  /** 요청할 때의 브랜치. */
  branch: string;
  requestedAt: string;
  status: AnalysisStatus;
  /** 단계 목록. `STEP_ORDER` 의 차례로 모두 있다. */
  steps: AnalysisStep[];
  /** 실패한 분석에만 있다. */
  failure: AnalysisFailure | null;
  /**
   * 도구와 팩의 판. 실행기가 CLI 를 설치한 뒤에 안다. 그 전(대기, 저장소 받기)에는 null 이다. 끝난 분석에서는 결과 JSON 의
   * `tool.version`, `run.pack_digest` 와 같다(tests/service.test.ts).
   */
  versions: { tool: string; pack: string } | null;
  /**
   * 이 분석에서 review 를 어떻게 했는지(실행기에 보낼 때 정한다. `ReviewPlan`). REVIEW 스위치가 꺼져 있었거나 아직 보내지 않았으면
   * 없다.
   */
  review?: ReviewPlan;
  /**
   * 검사 단계 안에서 실행기가 마지막으로 알린 일과 그 알림을 받은 때(2026-11-13). 검사 단계는 실행기가 CLI 명령을 차례로 부른다:
   * 정적 검사와 AI 판정(`policypack scan`) → 저장소 프로필(`profile`) → `review` 가 `run` 일 때 review(`review`). 실행기는 명령
   * 사이마다 다음 명령을 알린다(best-effort. 알림이 빠질 수 있다). 없으면(null 포함) 아직 정적 검사와 AI 판정 중이거나, 알림이
   * 오지 않았거나, 검사 단계에 이르지 않았다. 검사 단계가 끝난 뒤에도 마지막 값이 남는다(그 뒤의 단계에서는 뜻이 없다).
   * review 안의 단계(의무 고르기·의무별 조사·반박)는 CLI 가 알리지 않아 여기에 없다.
   */
  scanPart?: ScanPart | null;
}

/** 검사 단계 안에서 실행기가 알린 일(`Analysis.scanPart`). */
export interface ScanPart {
  name: "profile" | "review";
  /** 이 서버가 그 알림을 받은 때(ISO 8601, UTC). */
  startedAt: string;
}

/**
 * review 를 맡긴 방식: `run` 실행기가 돌린다, `stored` 같은 커밋의 저장된 review 를 쓴다, `limit` 오늘의 review 실행 수가 상한에
 * 닿아 돌리지 않았다(2026-11-12 오너 지시, 하루 10건).
 */
export type ReviewPlan = "run" | "stored" | "limit";

/** 저장소 목록·검색 결과의 한 줄. 저장소와 그 분석의 요약. */
export interface RepositoryHit {
  repository: Repository;
  /** 분석 수. 0 이면 분석된 적이 없다. */
  analyses: number;
  /** 가장 나중에 요청한 분석. 없으면 null. */
  latest: Pick<Analysis, "id" | "status" | "requestedAt"> | null;
}

/** 최근 분석의 한 줄(`ServiceStore.recentActivity`). */
export interface RepositoryActivity {
  repository: Repository;
  /** 보이는 분석: 대기·분석 중인 것이 있으면 그것, 없으면 가장 나중에 요청한 것. */
  analysis: Analysis;
  /** 그 저장소의 분석 수. */
  analyses: number;
  /** 그 저장소에서 가장 나중에 요청한 때. */
  latestAt: string;
}

/**
 * 검색의 결과. GitHub 을 부르지 못하면 그 까닭을 그대로 보인다(빈 목록으로 꾸미지 않는다). `github` 는 묻지 못한 까닭의 갈래다
 * (요청 수 상한, 시간 초과, 연결 실패. 화면이 자동 완성과 같은 말로 적는다). DB 에 닿지 못한 것이면 없다.
 */
export type SearchOutcome =
  | { ok: true; hits: RepositoryHit[]; /** 맞는 저장소 수(GitHub 이 센 것. 보이는 것보다 많을 수 있다). */ total: number }
  | { ok: false; message: string; github?: "limited" | "timeout" | "unavailable" };

/**
 * 자동 완성의 두 출처(docs/redesign.md 5장). 합치고 줄 수를 줄이는 것은 `/api/` 의 일(`mergeSuggestions`)이다.
 * `site` 는 DB 를 읽지 못했으면 null, `github` 는 묻지 않은 요청(이 사이트만 먼저 묻는 요청)이면 null 이다.
 */
export interface StoreSuggestions {
  site: SiteSuggestion[] | null;
  github: GitHubSuggestPart | null;
}

/**
 * 분석 요청이 되지 않은 까닭.
 * - `no-server`: 합성 미리보기라 요청을 받지 않는다.
 * - `closed`: 실행기가 설정되지 않아 요청을 받지 않는다(RUNNER=none).
 * - `not-found`: 그런 공개 저장소가 없다(없음·비공개·이름이 규칙에 맞지 않음·기본 브랜치 커밋 없음).
 * - `too-large`: 저장소가 크기 상한을 넘는다.
 * - `limit`: 하루 상한이나 대기열 상한(QUEUE_LIMIT)에 닿았다. 실행 자리(POOL_SIZE)가 찬 것으로는 거절하지 않는다(대기열에 받는다).
 * - `unavailable`: GitHub 이나 DB 에 닿지 못했다.
 */
export type RequestRefusal = "no-server" | "closed" | "not-found" | "too-large" | "limit" | "unavailable";

/** 분석 요청의 결과. `reused` 는 같은 커밋의 대기·진행 중이거나 최근에 끝난 분석으로 보냈다는 뜻이다. */
export type RequestOutcome =
  | { ok: true; analysis: Analysis; reused: boolean }
  | { ok: false; reason: RequestRefusal; message: string };

/**
 * 쪽이 데이터를 읽는 길. 모든 메서드가 Promise 를 돌려준다(B2 의 구현은 DB 와 GitHub 을 부른다).
 * 저장소는 owner·name 으로 찾고, 대소문자를 가리지 않는다(GitHub 과 같다).
 *
 * 구현은 둘이다. 운영: DB + GitHub(`src/server/store/db.ts`). 미리보기·시험: 합성(`synthetic.ts`, SERVICE_STORE=synthetic).
 * 고르는 것은 `src/server/store/index.ts` 의 `getStore()` 다.
 */
export interface ServiceStore {
  /** 이 구현이 합성 데이터인지. 쪽은 이것으로 "합성 예시"를 밝힌다. */
  readonly synthetic: boolean;
  /** 저장소를 찾는다. 합성은 합성 목록을 거르고, 운영은 GitHub 검색을 부른다. 빈 질의는 빈 목록이다. */
  search(query: string): Promise<SearchOutcome>;
  /**
   * 저장소. 없으면 null. GitHub 에 닿지 못하면 던진다(`ServiceUnavailableError`). 단 이 사이트에 분석 기록이 있는 저장소는
   * 기록에 있는 이름으로 돌려준다(그때 설명·언어·GitHub 주소는 null 이다. 꾸며 채우지 않는다).
   */
  getRepository(owner: string, name: string): Promise<Repository | null>;
  /** 그 저장소의 분석. 나중에 요청한 것이 앞이다. */
  listAnalyses(owner: string, name: string): Promise<Analysis[]>;
  getAnalysis(owner: string, name: string, id: string): Promise<Analysis | null>;
  /** id 만으로 분석을 찾는다(진행 중인 분석 쪽이 몇 초마다 다시 읽는 `GET /api/analyses/{id}/`). 없으면 null. */
  findAnalysis(id: string): Promise<Analysis | null>;
  /** 끝난 분석의 CLI 결과 JSON. 끝나지 않았거나 없으면 null. 해석은 `lib/report/parse.ts` 가 한다. */
  getResult(id: string): Promise<unknown | null>;
  /**
   * 끝난 분석마다 결과에 실린 발견 수. 결과가 없거나 읽지 못한 분석은 null(0 으로 적지 않는다). 운영은 결과를 받을 때 센 값을
   * 분석 행에서 읽는다(쪽을 열 때마다 결과 JSON 전체를 읽고 해석하지 않는다).
   */
  findingCounts(ids: string[]): Promise<Record<string, number | null>>;
  /**
   * 끝난 분석의 저장소 프로필(`policypack profile` 의 JSON, `lib/profile`). 실행기가 검사와 함께 돌려 보낸 것을 받은 그대로 두었다가
   * 읽는다. 끝나지 않았거나, 프로필을 받지 못했거나(그 기능이 생기기 전의 분석, 실행기에서 프로필이 실패), 읽지 못하면 null.
   */
  getProfile(id: string): Promise<Profile | null>;
  /**
   * 끝난 분석마다 감지된 기능의 이름(목록 줄에 짧게 싣는다. `featureNames` 의 차례). 프로필이 없는 분석은 null(빈 목록과 다르다).
   * 운영은 결과를 받을 때 적어 둔 값을 분석 행에서 읽는다.
   */
  featureNames(ids: string[]): Promise<Record<string, string[] | null>>;
  /**
   * 그 저장소·커밋의 review 결과(`policypack review` 2판, `lib/review`). 어느 분석에서 받았든 가장 나중에 받은 것이다(같은 커밋은
   * 다시 돌리지 않고 저장된 것을 보인다. 2026-11-11 오너 지시). 이름은 대소문자를 가리지 않는다. 없거나 읽지 못하면 null.
   */
  getReview(owner: string, name: string, commit: string): Promise<Review | null>;
  /**
   * 지금의 대기열과 실행 자리(DB 에서 센 것, `queue.ts`). 대기 중인 분석이 대기열의 몇 번째인지 적는 데 쓴다. 합성 미리보기는
   * 대기열이 없으므로 null 이다(숫자를 꾸며 적지 않는다).
   */
  queue(): Promise<QueueSnapshot | null>;
  /**
   * 이 사이트의 최근 분석. 저장소마다 한 줄이고, 그 저장소에 대기·분석 중인 분석이 있으면 그것, 없으면 가장 나중에 요청한
   * 분석이다(`activity.ts` 의 `pickActivity`). 줄은 그 분석을 요청한 때의 차례(나중 것이 앞)다. 운영 구현은 다른 읽기와 같이
   * 정리(`tidyQueue`)를 한 뒤에 읽어 시간을 넘긴 분석이 이미 실패로 보인다. GitHub 은 부르지 않는다(저장소는 기록의 이름이다).
   */
  recentActivity(limit: number): Promise<RepositoryActivity[]>;
  /**
   * 자동 완성(`GET /api/repos/suggest/`). `text` 는 다듬은 질의(`cleanSuggestText`). 이 사이트에서 분석된 저장소(owner/name 에
   * 친 글자가 든 것, 가장 나중에 요청한 차례로 `SUGGEST_ROWS` 개까지)와, `github` 가 참이면 GitHub 검색 한 번의 결과(겹침을 빼기
   * 전, 받은 차례). 운영 구현은 읽기만 한다(대기열 정리 `tidyQueue` 를 하지 않는다). 합성은 GitHub 을 부르지 않는다(`off`).
   */
  suggest(text: string, options: { github: boolean }): Promise<StoreSuggestions>;
  /** 분석을 요청한다. 같은 커밋에 진행 중이거나 최근에 끝난 분석이 있으면 새로 만들지 않고 그것을 돌려준다. */
  requestAnalysis(owner: string, name: string): Promise<RequestOutcome>;
  /** 지금 요청을 받지 않으면 그 까닭(화면의 요청 단추 옆에 적는다). 받으면 null. */
  requestsClosed(): string | null;
}
