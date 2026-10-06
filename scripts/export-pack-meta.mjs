#!/usr/bin/env node
// 정책 팩(pack.yaml + _legal/)에서 웹이 쓰는 팩 메타데이터(data/pack-meta.json)를 만든다.
//
// 임시 도구다. CLI 가 팩 메타데이터를 직접 내보내게 되면(docs/cli-requests.md 의 요청 5) 이 스크립트를
// 지우고 그 출력을 쓴다. 그때까지 웹이 팩 문법을 아는 곳은 이 파일 하나로 묶어 둔다.
//
//   POLICYPACK_PACK_DIR  팩 폴더. 주지 않으면 POLICYPACK_FROM 이 폴더일 때 그 아래 policies/kr-core,
//                        그것도 없으면 옆 폴더 CLI 저장소의 policies/kr-core.
//   수집(npm run capture)과 같은 출처를 봐야 한다. 결과의 팩 판과 어긋나면 tests/contract.test.ts 가 실패한다.
//
// 실행: npm run pack-meta
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromEnv = process.env.POLICYPACK_FROM;
const cliDir =
  fromEnv && existsSync(fromEnv) && statSync(fromEnv).isDirectory()
    ? path.resolve(fromEnv)
    : path.resolve(root, "..", "Plitsoft-SDP");
const packDir = process.env.POLICYPACK_PACK_DIR
  ? path.resolve(process.env.POLICYPACK_PACK_DIR)
  : path.join(cliDir, "policies", "kr-core");
const packFile = path.join(packDir, "pack.yaml");

if (!existsSync(packFile)) {
  throw new Error(`pack.yaml 을 찾지 못했습니다: ${packFile}\nPOLICYPACK_PACK_DIR 로 팩 폴더를 알려 주세요.`);
}

const raw = readFileSync(packFile);
const pack = parse(raw.toString("utf8"), { maxAliasCount: -1 });
const str = (value) => (value === undefined || value === null ? null : String(value).trim());

function legalRef(ref) {
  const textFile = ref["text-file"] ? path.join(packDir, ref["text-file"]) : null;
  const text = textFile && existsSync(textFile) ? readFileSync(textFile, "utf8").trimEnd() : null;
  return {
    statute: str(ref.statute),
    article: str(ref.article),
    clause: str(ref.clause),
    // 화면에 그대로 쓰는 이름. CLI 의 findings[].law 와 같은 모양이다.
    label: [ref.statute, ref.article, ref.clause].filter(Boolean).join(" "),
    url: str(ref.url),
    law_id: str(ref["law-id"]),
    effective_from: str(ref["effective-from"]),
    text_retrieved: str(ref["text-retrieved"]),
    text_sha256: str(ref["text-sha256"]),
    // 팩에 적힌 해시와 실제 파일이 맞는지. 어긋나면 조문 원문이 팩 기록과 다르다는 뜻이다.
    text_sha256_matches:
      textFile && existsSync(textFile) && ref["text-sha256"]
        ? createHash("sha256").update(readFileSync(textFile)).digest("hex") === ref["text-sha256"]
        : null,
    text,
  };
}

function alternative(alt) {
  const on = alt["on-unsatisfied"] ?? {};
  const isAi = alt.ai !== undefined;
  return {
    id: str(alt.id),
    kind: isAi ? "ai" : "static",
    // 약한 대안(이름·문자열만 본 근거)은 혼자서는 경고를 풀지 못한다.
    strength: isAi ? null : (str(alt.strength) ?? "strong"),
    question: isAi ? str(alt.ai.question) : null,
    // 적지 않으면 CLI 의 기본값(required: '예'는 코드 줄을 인용해야 인정)이다.
    evidence: isAi ? (str(alt.ai.evidence) ?? "required") : null,
    message: str(on.message),
    ask_developer: str(on["ask-developer"]),
    remediation: str(on.remediation),
  };
}

function rule(r) {
  return {
    id: str(r.id),
    scope: str(r.scope) ?? "file",
    applies_question: r["applies-ai"] ? str(r["applies-ai"].question) : null,
    applies_when: (r["applies-when"] ?? []).map((c) => str(c.id)),
    alternatives: (r["compliant-if-any"] ?? []).map(alternative),
  };
}

const meta = {
  schema_version: "pack-meta/0-draft",
  generated_by: "scripts/export-pack-meta.mjs (임시: CLI 가 팩 메타데이터를 내보낼 때까지)",
  pack: {
    id: str(pack.pack?.id),
    title: str(pack.pack?.title),
    api_version: str(pack.apiVersion),
    // CLI 의 run.pack_digest 와 같은 계산(pack.yaml sha256 앞 16자). 결과와 팩 판이 맞는지 볼 때 쓴다.
    digest: createHash("sha256").update(raw).digest("hex").slice(0, 16),
  },
  policies: (pack.policies ?? []).map((p) => ({
    id: str(p.id),
    category: str(p.category),
    title: str(p.title),
    ask_developer: str(p["ask-developer"]),
    legal: (p.legal?.["violated-when-failed"] ?? []).map(legalRef),
    review_by: str(p.review?.["review-by"]),
    rationale: {
      motivation: str(p.rationale?.motivation),
      implementation: str(p.rationale?.implementation),
    },
    rules: (p.rules ?? []).map(rule),
  })),
};

const outFile = path.join(root, "data", "pack-meta.json");
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(meta, null, 2) + "\n");
console.log(`data/pack-meta.json: 정책 ${meta.policies.length}개, 팩 ${meta.pack.id} (${meta.pack.digest})`);
