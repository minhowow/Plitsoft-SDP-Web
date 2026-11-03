import genaiChatFixed from "@contract/cli-current/genai-chat.fixed.json";
import genaiChatMain from "@contract/cli-current/genai-chat.main.json";
import kidsSignupFixed from "@contract/cli-current/kids-signup.fixed.json";
import kidsSignupMain from "@contract/cli-current/kids-signup.main.json";
import nightPushMain from "@contract/cli-current/night-push.main.json";
import plainMain from "@contract/cli-current/plain.main.json";
import { parseReport } from "@/lib/report/parse";
import { repoKey } from "./href";
import { matchRepositories } from "./search";
import { STEP_ORDER } from "./steps";
import { SITE } from "@/lib/site";
import type { Analysis, AnalysisStep, Repository, RepositoryHit, ServiceStore, StepName } from "./types";

/**
 * 합성 저장소. DB 도 GitHub 도 부르지 않고 `ServiceStore` 를 채운다. SERVICE_STORE=synthetic 일 때만 쓰는 미리보기·시험용이다
 * (`src/server/store/index.ts`). 쪽은 `synthetic: true` 를 보고 "합성 예시"를 밝힌다.
 *
 * - 저장소는 모두 합성이다. 실제로 있는 남의 저장소 이름을 쓰지 않고, GitHub 주소(`htmlUrl`)도 없다(링크를 걸지 않는다).
 * - 끝난 분석의 결과는 contract/cli-current 의 CLI 실제 출력이다(합성 데모 코드 contract/fixtures 를 검사한 것). 손으로 고치지
 *   않는다. 그 출력은 판정자 없이 만들었다(대시보드가 결과의 `run.judge` 대로 "판정자 꺼짐"을 보인다).
 * - 진행 중·대기·실패한 분석, 분석이 여러 번인 저장소, 분석이 없는 저장소를 모두 둔다. 진행 중인 분석은 한 순간을 고정한
 *   것이다(합성 미리보기는 진행을 다시 읽지 않아 움직이지 않는다).
 */

type Capture = { tool: { version: string }; run: { pack_digest: string; judge: string | null } };

const repo = (owner: string, name: string, description: string, language: string): Repository => ({
  owner,
  name,
  description,
  defaultBranch: "main",
  language,
  htmlUrl: null,
  synthetic: true,
});

const REPOSITORIES: Repository[] = [
  repo("example-org", "kids-signup", "아동도 쓰는 회원 가입 화면. 합성 예시 저장소입니다.", "TypeScript"),
  repo("example-org", "night-push", "마케팅 앱 푸시를 보내는 코드. 합성 예시 저장소입니다.", "TypeScript"),
  repo("example-studio", "genai-chat", "생성형 AI 채팅 화면. 합성 예시 저장소입니다.", "TypeScript"),
  repo("example-labs", "plain-utils", "숫자 계산 유틸리티. 정책 신호가 없는 합성 예시 저장소입니다.", "TypeScript"),
  repo("example-labs", "shop-front", "쇼핑몰 화면. 첫 분석을 기다리는 합성 예시 저장소입니다.", "JavaScript"),
  repo("example-labs", "todo-web", "할 일 목록 웹. 아직 분석된 적이 없는 합성 예시 저장소입니다.", "JavaScript"),
];

/** 분석 id → CLI 결과. 끝난 분석에만 있다. */
const RESULTS: Record<string, Capture> = {
  wtk33e9zuf: kidsSignupMain,
  "87q82b6jbu": kidsSignupFixed,
  "64y4jdtazh": nightPushMain,
  "4qqa6fdx2h": genaiChatMain,
  mruw8xjzjw: genaiChatFixed,
  w7bc479x2u: plainMain,
};

/** 결과마다 어느 수집본인지. 시험이 수집본과 견줄 때 쓴다. */
export const SYNTHETIC_RESULT_SOURCES: Record<string, string> = {
  wtk33e9zuf: "kids-signup.main",
  "87q82b6jbu": "kids-signup.fixed",
  "64y4jdtazh": "night-push.main",
  "4qqa6fdx2h": "genai-chat.main",
  mruw8xjzjw: "genai-chat.fixed",
  w7bc479x2u: "plain.main",
};

/** 요청한 시각에서 몇 초 뒤인지로 단계의 시작·끝을 적는다. null 이면 그 일이 아직 없다. */
type Timeline = Partial<Record<StepName, [number | null, number | null]>>;

function steps(requestedAt: string, timeline: Timeline): AnalysisStep[] {
  const at = (seconds: number | null) => (seconds === null ? null : new Date(Date.parse(requestedAt) + seconds * 1000).toISOString());
  return STEP_ORDER.map((name) => {
    const entry = timeline[name];
    return { name, startedAt: at(entry?.[0] ?? null), endedAt: at(entry?.[1] ?? null) };
  });
}

function succeeded(id: string, owner: string, name: string, commit: string, requestedAt: string, seconds: [number, number, number, number]): Analysis {
  const [queued, fetched, scanned, finished] = seconds;
  const result = RESULTS[id];
  return {
    id,
    owner,
    name,
    commit,
    branch: "main",
    requestedAt,
    status: "succeeded",
    steps: steps(requestedAt, {
      queued: [0, queued],
      fetch: [queued, fetched],
      scan: [fetched, scanned],
      finish: [scanned, finished],
    }),
    failure: null,
    versions: { tool: result.tool.version, pack: result.run.pack_digest },
  };
}

const ANALYSES: Analysis[] = [
  succeeded("wtk33e9zuf", "example-org", "kids-signup", "e8d8015c26e6e1c553cf79187eabc073558efe4c", "2026-10-20T05:12:04Z", [14, 31, 78, 83]),
  succeeded("87q82b6jbu", "example-org", "kids-signup", "6051cc40ecefa52e69845cc174f61cc7ccd556b8", "2026-10-23T02:40:51Z", [9, 25, 69, 73]),
  succeeded("64y4jdtazh", "example-org", "night-push", "28b62493605ccf0cf06cd4cf5372a43ab9599948", "2026-10-21T08:05:17Z", [21, 40, 96, 101]),
  {
    id: "9f4gxaqj6s",
    owner: "example-org",
    name: "night-push",
    commit: "8ce3f2606acbc3d411cd5ded8c32f2b7b520699a",
    branch: "main",
    requestedAt: "2026-10-24T04:58:02Z",
    status: "running",
    steps: steps("2026-10-24T04:58:02Z", { queued: [0, 18], fetch: [18, 37], scan: [37, null] }),
    failure: null,
    versions: { tool: "0.3.0.dev0", pack: "366a3dd4fdae08d8" },
  },
  succeeded("4qqa6fdx2h", "example-studio", "genai-chat", "5d34db91055d0cacd81e5aa655a6ae2a04cc7007", "2026-10-18T11:20:40Z", [12, 33, 84, 90]),
  {
    id: "w7nna7856b",
    owner: "example-studio",
    name: "genai-chat",
    commit: "2d572973a9c4b29e01830b13cc34f799d9042fe6",
    branch: "main",
    requestedAt: "2026-10-22T06:31:09Z",
    status: "failed",
    steps: steps("2026-10-22T06:31:09Z", { queued: [0, 11], fetch: [11, 611] }),
    failure: {
      step: "fetch",
      reason: "저장소를 받는 동안 실행기가 10분 넘게 응답하지 않아 멈췄습니다. 검사는 시작하지 않았습니다.",
    },
    versions: null,
  },
  succeeded("mruw8xjzjw", "example-studio", "genai-chat", "0f22ea76a80b53fd403db5a6b573866afd8583eb", "2026-10-23T09:10:26Z", [16, 35, 88, 94]),
  succeeded("w7bc479x2u", "example-labs", "plain-utils", "91756f04431bcc4323f060b101a6efec6eef6517", "2026-10-19T13:44:58Z", [8, 19, 41, 44]),
  {
    id: "m3dx2vjg7c",
    owner: "example-labs",
    name: "shop-front",
    commit: "c7a6e1670891a933719130c4c05ae7dc8385ba2d",
    branch: "main",
    requestedAt: "2026-10-24T05:02:37Z",
    status: "queued",
    steps: steps("2026-10-24T05:02:37Z", { queued: [0, null] }),
    failure: null,
    versions: null,
  },
];

const newestFirst = (a: Analysis, b: Analysis) => b.requestedAt.localeCompare(a.requestedAt);

function analysesOf(owner: string, name: string): Analysis[] {
  const key = repoKey(owner, name);
  return ANALYSES.filter((analysis) => repoKey(analysis.owner, analysis.name) === key).sort(newestFirst);
}

function hit(repository: Repository): RepositoryHit {
  const list = analysesOf(repository.owner, repository.name);
  const latest = list[0] ?? null;
  return {
    repository,
    analyses: list.length,
    latest: latest && { id: latest.id, status: latest.status, requestedAt: latest.requestedAt },
  };
}

function findRepository(owner: string, name: string): Repository | null {
  const key = repoKey(owner, name);
  return REPOSITORIES.find((repository) => repoKey(repository.owner, repository.name) === key) ?? null;
}

/** 합성 저장소 모두(목록의 차례). 시험이 쪽을 모두 열어 볼 때 쓴다. */
export function syntheticRepositories(): RepositoryHit[] {
  return REPOSITORIES.map(hit);
}

export const syntheticStore: ServiceStore = {
  synthetic: true,
  async search(query) {
    const hits = matchRepositories(REPOSITORIES.map(hit), query);
    return { ok: true, hits, total: hits.length };
  },
  async getRepository(owner, name) {
    return findRepository(owner, name);
  },
  async listAnalyses(owner, name) {
    return analysesOf(owner, name);
  },
  async getAnalysis(owner, name, id) {
    return analysesOf(owner, name).find((analysis) => analysis.id === id) ?? null;
  },
  async findAnalysis(id) {
    return ANALYSES.find((analysis) => analysis.id === id) ?? null;
  },
  async getResult(id) {
    const analysis = ANALYSES.find((entry) => entry.id === id);
    return analysis?.status === "succeeded" ? (RESULTS[id] ?? null) : null;
  },
  async findingCounts(ids) {
    const counts: Record<string, number | null> = {};
    for (const id of ids) {
      const analysis = ANALYSES.find((entry) => entry.id === id);
      if (analysis?.status !== "succeeded") continue;
      const parsed = parseReport(RESULTS[id] ?? null);
      counts[id] = parsed.ok ? parsed.report.findings.length : null;
    }
    return counts;
  },
  async queue() {
    return null;
  },
  async recentSucceeded(limit) {
    return ANALYSES.filter((analysis) => analysis.status === "succeeded")
      .sort(newestFirst)
      .slice(0, limit)
      .map((analysis) => ({ repository: findRepository(analysis.owner, analysis.name)!, analysis }));
  },
  async requestAnalysis(owner, name) {
    if (!findRepository(owner, name)) return { ok: false, reason: "not-found", message: "그런 저장소를 찾지 못했습니다." };
    return { ok: false, reason: "no-server", message: SITE.service.noServer };
  },
  requestsClosed() {
    return SITE.service.noServer;
  },
};
