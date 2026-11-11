#!/usr/bin/env node
// 사례 쪽(/cases)의 데이터를 만든다: CLI 세션이 미리 돌린 공개 저장소 결과(--agent combined)와 규칙만 돌린 결과에서
// 쪽이 쓰는 필드만 옮겨 data/cases.json 에 쓴다. Node 내장 모듈만 쓴다.
//
//   node scripts/export-cases.mjs [사례 폴더]   (기본 ~/.cache/policypack-eval/cases-2026-11-10)
//
// 필드는 그대로 옮기기만 한다. 서로 견주는 것(규칙만 본 발견 가운데 AI 가 푼 것, AI 가 새로 찾은 것)은 쪽이 한다
// (src/lib/cases/). 결과 판 1 의 `run.agent` 는 서비스의 결과 계약에 없다. 여기서만 읽는다.

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] ?? path.join(os.homedir(), ".cache/policypack-eval/cases-2026-11-10");

/** 2026-11-11 에 돌린 것(agent/LOG, agent/cases.md). 결과 JSON 에는 날짜와 CLI 커밋이 실려 있지 않다. */
const RAN_ON = "2026-11-11";
const CLI_COMMIT = "0be0c07";

/** 쪽의 차례(마지막이 예비). 커밋은 corpus-2026-09-30/commits.txt 의 것(그 커밋을 받아 검사했다). */
const CASES = [
  { file: "JinInSaDaeCheonMyeong__starthub-app", commit: "0ab1c2b70b5d79fb9f80519044760cdd0fd8a30b" },
  { file: "Malbolo__Excelerate", commit: "53bf78a586bc2e3f04d38ebd6281b90c293deb64" },
  { file: "Vactor0911__jobtalk", commit: "bbfb3ab14534907ff4618c563ff92a6354da97a1" },
  { file: "team-medeasy__medeasy-frontend", commit: "95fd35fd20a23ff3057b613b02922f4a8f4be2b7" },
];

const read = (file) => JSON.parse(readFileSync(path.join(dir, file), "utf8"));

/** 인용 검사를 통과한 인용만. 거절된 인용은 판단을 받치지 못했다. */
const citations = (list) => (list ?? []).filter((c) => c.ok === true).map(({ file, line, text }) => ({ file, line, text }));

const cases = CASES.map(({ file, commit }) => {
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
const out = {
  ranOn: RAN_ON,
  cli: { commit: CLI_COMMIT, version: [...tools].join(", ") },
  packDigest: [...digests].join(", "),
  cases,
};
writeFileSync(path.join(root, "data/cases.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`data/cases.json: ${cases.length}곳`);
