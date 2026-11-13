#!/usr/bin/env node
// 사례 쪽(/cases)의 "공개 저장소 41곳" 구역과 포스터 그림(docs/figures/review-results-41)의 데이터를 만든다: CLI 세션의 41곳 평가
// 정리(summary.json, 2026-11-13)에서 성격별 숫자만 옮겨 data/eval-41.json 에 쓴다. Node 내장 모듈만 쓴다. 모델을 부르지 않는다.
//
//   node scripts/export-eval.mjs [summary.json]   (기본 ~/.cache/policypack-eval/eval41-2026-11-13/final/summary.json)
//
// 남의 저장소라 이름·주소·코드는 옮기지 않는다(그 파일에도 없다). 알려진 한계의 글은 옮기지 않는다: 쪽은 summary.md 를 사람이 짧게
// 줄인 글을 싣는다(src/lib/cases/eval.ts). 숫자는 그대로 옮기기만 하고, 합계가 성격별 합과 맞는지만 본다.

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? path.join(os.homedir(), ".cache/policypack-eval/eval41-2026-11-13/final/summary.json");
const summary = JSON.parse(readFileSync(file, "utf8"));

/** 성격 하나(또는 합계)에서 쪽이 쓰는 필드만. */
const row = (c) => ({
  repos: c.repos,
  counts: c.status_counts,
  citations: c.citations,
  citationsRejected: c.citations_rejected,
  searches: c.searches,
  searchesRejected: c.searches_rejected,
  usd: c.usd,
  seconds: c.seconds,
  emptyChecklists: c.empty_checklists,
  withSeenInCode: c.with_seen_in_code,
  staticWithFindings: c.static_with_findings,
});

const out = {
  ranOn: "2026-11-13",
  rules: summary.rules,
  model: "claude-haiku-5-5",
  rebut: false,
  categories: summary.categories.map((c) => ({ kind: c.name, ...row(c) })),
  total: row(summary.total),
  static: {
    withFindings: summary.static_compare.static_with_findings,
    both: summary.static_compare.both,
    reviewOnly: summary.static_compare.review_only,
    staticOnly: summary.static_compare.static_only,
  },
};

// 합계가 성격별 합과 맞는지(옮기다 어긋나지 않았는지).
for (const key of ["repos", "citations", "citationsRejected", "searches", "searchesRejected", "emptyChecklists", "withSeenInCode", "staticWithFindings"]) {
  const sum = out.categories.reduce((n, c) => n + c[key], 0);
  if (sum !== out.total[key]) throw new Error(`${key}: 성격별 합 ${sum} ≠ 합계 ${out.total[key]}`);
}
for (const status of Object.keys(out.total.counts)) {
  const sum = out.categories.reduce((n, c) => n + c.counts[status], 0);
  if (sum !== out.total.counts[status]) throw new Error(`${status}: 성격별 합 ${sum} ≠ 합계 ${out.total.counts[status]}`);
}

writeFileSync(path.join(root, "data/eval-41.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`data/eval-41.json: ${out.total.repos}곳, 성격 ${out.categories.length}가지`);
