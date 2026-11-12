#!/usr/bin/env node
// 사례 쪽(/cases)의 데이터를 만든다: CLI 세션이 미리 돌린 공개 저장소 결과(--agent combined)와 규칙만 돌린 결과에서
// 쪽이 쓰는 필드만 옮겨 data/cases.json 에 쓴다. Node 내장 모듈만 쓴다.
//
//   node scripts/export-cases.mjs [사례 폴더] [프로필 폴더] [사례 review 폴더] [8곳 review 폴더]
//     (기본 ~/.cache/policypack-eval/cases-2026-11-10, ~/.cache/policypack-eval/profile-2026-11-11/repos,
//      ~/.cache/policypack-eval/review-w11-6-2026-11-12, ~/.cache/policypack-eval/review-v2-2026-11-11)
//
// review 2판(`policypack review`)의 실측 결과도 옮긴다(2026-11-12 오너 지시). 사례 4곳은 CLI f4967db(handoff-w11-6)로 다시 돌린
// 결과에서 화면이 읽는 필드만(의무의 `title` 과 `quote` 는 처분 액수·조문 인용이 들어 있어 뺀다). 나머지 8곳은 CLI e12e6ba 로 돌린
// 11/12 실측이고, 남의 저장소라 이름·주소·코드를 옮기지 않고 성격과 갈래별 건수·시간·비용만 옮긴다. 저장소 이름은 이 스크립트에도
// 적지 않는다: 성격은 그 폴더의 plan.md 표에서 찾는다. 8곳의 비용은 결과에 실린 사용량을 공식 단가(`PRICE`)로 다시 센다(결과의
// 어림 금액은 옛 단가표로 센 것이라 약 2.4배 컸다).
//
// 저장소 프로필(`policypack profile`, CLI fe98fb7, 같은 커밋의 사본에서 돌린 것)도 사례마다 함께 옮긴다. 의무 항목은 화면이 쓰는
// 필드(id, 법, 조문, 의무 한 줄, 법제처 링크)만 남긴다.
//
// 필드는 그대로 옮기기만 한다. 서로 견주는 것(규칙만 본 발견 가운데 AI 가 푼 것, AI 가 새로 찾은 것)은 쪽이 한다
// (src/lib/cases/). 결과 판 1 의 `run.agent` 는 서비스의 결과 계약에 없다. 여기서만 읽는다.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] ?? path.join(os.homedir(), ".cache/policypack-eval/cases-2026-11-10");
const profileDir = process.argv[3] ?? path.join(os.homedir(), ".cache/policypack-eval/profile-2026-11-11/repos");
const reviewDir = process.argv[4] ?? path.join(os.homedir(), ".cache/policypack-eval/review-w11-6-2026-11-12");
const othersDir = process.argv[5] ?? path.join(os.homedir(), ".cache/policypack-eval/review-v2-2026-11-11");
/** 프로필을 돌린 CLI 와 날(profile-41.md). */
const PROFILE_CLI = { commit: "fe98fb7", ranOn: "2026-11-11" };

/** 의무 묶음에서 화면이 쓰는 필드만. */
const duties = (d) => ({ ...d, items: d.items.map(({ id, law, article, duty, url }) => ({ id, law, article, duty, url })) });
const readProfile = (file) => {
  const profile = JSON.parse(readFileSync(path.join(profileDir, `${file}.json`), "utf8"));
  return {
    ...profile,
    features: profile.features.map((feature) => ({ ...feature, duties: duties(feature.duties) })),
    ...(profile.common ? { common: { ...profile.common, duties: duties(profile.common.duties) } } : {}),
  };
};

/** 2026-11-11 에 돌린 것(agent/LOG, agent/cases.md). 결과 JSON 에는 날짜와 CLI 커밋이 실려 있지 않다. */
const RAN_ON = "2026-11-11";
const CLI_COMMIT = "0be0c07";

/** 쪽의 차례(마지막이 예비). 커밋은 corpus-2026-09-30/commits.txt 의 것(그 커밋을 받아 검사했다). */
// recheck: 11/12 실측에서 짚은 의무는 CLI f4967db 로 다시 돌린 결과에서 고쳐졌다(results.md). 사례 4곳에서는 걷어 냈다(2026-11-12
// 오너 지시). 다시 짚을 것이 생기면 여기에 의무 id 를 적는다.
const CASES = [
  { file: "JinInSaDaeCheonMyeong__starthub-app", commit: "0ab1c2b70b5d79fb9f80519044760cdd0fd8a30b", recheck: [] },
  { file: "Malbolo__Excelerate", commit: "53bf78a586bc2e3f04d38ebd6281b90c293deb64", recheck: [] },
  { file: "Vactor0911__jobtalk", commit: "bbfb3ab14534907ff4618c563ff92a6354da97a1", recheck: [] },
  { file: "team-medeasy__medeasy-frontend", commit: "95fd35fd20a23ff3057b613b02922f4a8f4be2b7", recheck: [] },
];

/**
 * review 2판을 돌린 날과 CLI(out/LOG 와 결과 파일의 시각, results.md). 결과 JSON 에는 날짜와 커밋이 없다. 사례 4곳은 handoff-w11-6
 * (f4967db)에 단가표만 고친 판으로 다시 돌렸다. 8곳은 그보다 앞선 e12e6ba 다.
 */
const REVIEW_RUN = { ranOn: "2026-11-12", cli: "f4967db" };
const OTHERS_RUN = { ranOn: "2026-11-12", cli: "e12e6ba" };

/**
 * 공식 단가(100만 토큰당 달러: 입력, 출력, 캐시 쓰기 배수, 캐시 읽기 배수). CLI 세션이 공식 가격표에서 옮긴 것이다
 * (review-w11-6-2026-11-12/results.md "비용 계산 점검", 2026-11-12). haiku 의 10만 토큰을 넘는 프롬프트 구간(5배)은 11/12 실측의
 * 호출에 거의 없어 셈하지 않는다(그 셈으로 12곳 합계 $15.06, results.md 와 같다).
 */
const PRICE = {
  "claude-haiku-5-5": [0.1, 0.5, 1.25, 0.1],
  "claude-sonnet-5-5": [2, 10, 1.25, 0.05],
};
/** 결과의 모델별 사용량(`run.usage`)을 공식 단가로 센 금액. 단가가 없는 모델이 있으면 멈춘다. */
const officialUsd = (usage) =>
  Object.entries(usage).reduce((sum, [model, u]) => {
    const price = PRICE[model];
    if (!price) throw new Error(`공식 단가가 없는 모델: ${model}`);
    const [input, output, write, read] = price;
    return (
      sum +
      (u.input_tokens * input +
        u.cache_creation_input_tokens * input * write +
        u.cache_read_input_tokens * input * read +
        u.output_tokens * output) /
        1e6
    );
  }, 0);

/**
 * 성격이 다른 저장소 8곳(오너가 정한 이름과 차례). `match` 는 plan.md 표의 '성격' 칸에서 찾는 말이다. recheck 는 위와 같다
 * (쇼핑몰의 취소·탈퇴 경로, 위치의 동의 철회).
 */
const OTHERS = [
  { kind: "쇼핑몰", match: "쇼핑몰", recheck: ["ecom-21-2-1-h4"] },
  { kind: "위치", match: "위치", recheck: ["locinfo-24-4"] },
  { kind: "가입만", match: "가입만", recheck: [] },
  { kind: "AI 없는 커뮤니티", match: "AI 없는 커뮤니티", recheck: [] },
  { kind: "라이브러리", match: "라이브러리", recheck: [] },
  { kind: "POS", match: "POS", recheck: [] },
  { kind: "자체 서버 AI", match: "자체 서버", recheck: [] },
  { kind: "실시간 게임", match: "실시간 게임", recheck: [] },
];

const read = (file) => JSON.parse(readFileSync(path.join(dir, file), "utf8"));
const readReview = (name) => JSON.parse(readFileSync(path.join(reviewDir, "out", `${name}.json`), "utf8"));
const readOther = (name) => JSON.parse(readFileSync(path.join(othersDir, "out", `${name}.json`), "utf8"));

/** review 결과에서 화면이 읽는 필드만(`src/lib/review`). 의무의 `title`(처분 액수)과 `quote`(조문 인용)는 옮기지 않는다. */
const cite = ({ file, line, text, ok, why }) => ({ file, line, text, ok, why });
const trimReview = (r) => ({
  review_version: r.review_version,
  tool: r.tool,
  summary: { counts: r.summary.counts, top: r.summary.top },
  profile: {
    commit: r.profile.commit,
    platforms: r.profile.platforms,
    summary: r.profile.summary,
    files: r.profile.files,
    features: r.profile.features.map((f) => ({
      id: f.id,
      name: f.name,
      sources: f.sources,
      evidence: f.evidence,
      evidence_total: f.evidence_total,
      model_citations: (f.model_citations ?? []).map(cite),
      ...(f.model_reason ? { model_reason: f.model_reason } : {}),
      ...(f.removed ? { removed: { reason: f.removed.reason, citations: (f.removed.citations ?? []).map(cite) } } : {}),
    })),
  },
  data_flow: {
    nodes: r.data_flow.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, data: n.data, citations: (n.citations ?? []).map(cite) })),
    edges: r.data_flow.edges.map((e) => ({ from: e.from, to: e.to, data: e.data, citations: (e.citations ?? []).map(cite) })),
  },
  obligations: { listed: r.obligations.listed.map(({ id, feature }) => ({ id, feature })), status_only: r.obligations.status_only },
  checklist: r.checklist.map((it) => ({
    duty: it.duty,
    feature: it.feature,
    law: it.law,
    article: it.article,
    duty_text: it.duty_text,
    url: it.url,
    status: it.status,
    citations: (it.citations ?? []).map(cite),
    searches: (it.searches ?? []).map(({ pattern, path: at, claimed, found, ok }) => ({ pattern, path: at, claimed, found, ok })),
    question: it.question,
    reason: it.reason,
    ...(it.not_answered ? { not_answered: it.not_answered } : {}),
    ...(it.verification ? { verification: { result: it.verification.result } } : {}),
    // CLI f4967db 의 덧붙임: 없는 것, 품목 묶음, 관문이 바꾼 까닭(화면이 reason 앞의 메모를 떼는 데 쓴다).
    ...(it.missing ? { missing: it.missing } : {}),
    ...(it.group ? { group: it.group } : {}),
    ...(it.first?.gate ? { first: { gate: it.first.gate } } : {}),
  })),
  run: Object.fromEntries(
    [
      "models",
      "seconds",
      "usd_estimate",
      "limits",
      "citations",
      "citations_rejected",
      "searches",
      "searches_rejected",
      "verification_counts",
      "masked",
      "not_asked",
    ].map((k) => [k, r.run[k]]),
  ),
});

/** 짚은 의무가 결과에 있는지 본다(이름이 틀리면 조용히 빠지지 않게). */
const checkRecheck = (review, ids, where) => {
  for (const id of ids) if (!review.checklist.some((it) => it.duty === id)) throw new Error(`${where}: 체크리스트에 ${id} 가 없다`);
  return ids;
};

/** 인용 검사를 통과한 인용만. 거절된 인용은 판단을 받치지 못했다. */
const citations = (list) => (list ?? []).filter((c) => c.ok === true).map(({ file, line, text }) => ({ file, line, text }));

const cases = CASES.map(({ file, commit, recheck }) => {
  const [owner, name] = file.split("__");
  const agent = read(`agent/${file}.json`);
  const ruleOnly = read(`static/${file}.json`);
  const run = agent.run.agent;
  // 규칙만 본 발견마다 AI 검토의 기록(남김·풂·확정)과 그 인용. 기록은 진입 파일과 발견의 줄로 찾는다.
  const reviewOf = (finding) =>
    run.records.find(
      (record) =>
        record.policy === finding.policy &&
        record.entry === finding.file &&
        record.findings.some((f) => f.rule === finding.rule && f.line === finding.line),
    );
  return {
    slug: name.toLowerCase(),
    owner,
    name,
    htmlUrl: `https://github.com/${owner}/${name}`,
    commit,
    files: agent.run.files,
    finder: run.discover.judge,
    rechecker: run.recheck.judge,
    ruleOnly: ruleOnly.findings.map((f) => {
      const review = reviewOf(f);
      return {
        policy: f.policy,
        rule: f.rule,
        file: f.file,
        line: f.line,
        outcome: f.outcome,
        review: review ? { action: review.action, citations: citations(review.citations) } : null,
      };
    }),
    profile: readProfile(file),
    review: trimReview(readReview(file)),
    recheck: checkRecheck(readReview(file), recheck, file),
    final: agent.findings.map((f) => ({
      policy: f.policy,
      rule: f.rule,
      title: f.title,
      law: f.law,
      file: f.file,
      line: f.line,
      outcome: f.outcome,
      action: f.agent?.action ?? null,
      citations: citations(f.agent?.citations),
    })),
  };
});

const tools = new Set(CASES.map(({ file }) => read(`agent/${file}.json`).tool.version));
const digests = new Set(CASES.map(({ file }) => read(`agent/${file}.json`).run.pack_digest));
// 8곳: plan.md 표(| 저장소 | 성격 | …)에서 성격으로 저장소를 찾아 결과의 갈래별 건수·시간·비용만 옮긴다.
const planRows = readFileSync(path.join(othersDir, "plan.md"), "utf8")
  .split("\n")
  .filter((line) => line.startsWith("| ") && !line.startsWith("| 저장소") && !line.startsWith("|---"))
  .map((line) => line.split("|").map((cell) => cell.trim()))
  .map((cells) => ({ name: cells[1], kind: cells[2] }));
const outFiles = readdirSync(path.join(othersDir, "out")).filter((f) => f.endsWith(".json"));
const others = OTHERS.map(({ kind, match, recheck }) => {
  const rows = planRows.filter((row) => !row.kind.startsWith("사례") && row.kind.includes(match));
  if (rows.length !== 1) throw new Error(`plan.md 에서 '${match}' 성격의 저장소가 ${rows.length}곳`);
  const file = outFiles.find((f) => f.endsWith(`__${rows[0].name}.json`));
  if (!file) throw new Error(`'${kind}' 의 결과가 없다`);
  const review = readOther(file.slice(0, -5));
  checkRecheck(review, recheck, kind);
  const counts = { ...review.summary.counts };
  for (const id of recheck) counts[review.checklist.find((it) => it.duty === id).status] -= 1;
  return {
    kind,
    counts,
    recheck: recheck.length,
    seconds: review.run.seconds,
    usd: Math.round(officialUsd(review.run.usage) * 1e4) / 1e4,
  };
});

const out = {
  ranOn: RAN_ON,
  cli: { commit: CLI_COMMIT, version: [...tools].join(", ") },
  packDigest: [...digests].join(", "),
  profileCli: PROFILE_CLI,
  reviewRun: REVIEW_RUN,
  othersRun: OTHERS_RUN,
  cases,
  others,
};
writeFileSync(path.join(root, "data/cases.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`data/cases.json: ${cases.length}곳, 성격이 다른 저장소 ${others.length}곳`);
