import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packIndex, packMeta } from "@/lib/pack";
import { root, walk } from "./helpers";

// 브라우저로 가는 JS 묶음에 팩 메타데이터 전체가 실리지 않게 한다.
// 팩 메타데이터에는 화면에 싣지 않기로 한 팩 작성자 메모가 들어 있다(docs/commitments.md 의 1). 브라우저에서 도는
// 부품이 그 파일을 불러오면, 화면에 그리지 않아도 묶음에 통째로 실려 나간다.
// 이 시험은 소스의 불러오기만 따라간다. 빌드된 out/ 의 파일을 보는 것은 아니다(docs/ROADMAP.md 의 8번).

const SOURCE = /\.(ts|tsx)$/;
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const isFile = (file: string) => existsSync(path.join(root, file)) && statSync(path.join(root, file)).isFile();

/** 불러오는 이름을 저장소 안의 파일로 바꾼다. 패키지(react, next 등)는 null 이다. */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
  else if (spec.startsWith("@data/")) base = path.join("data", spec.slice(6));
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (isFile(candidate)) return candidate;
  }
  throw new Error(`${from}: 불러오는 파일을 찾지 못했습니다: ${spec}`);
}

/** 파일이 불러오는 저장소 안의 파일. 타입만 불러오는 줄(import type)은 빌드에서 지워지므로 뺀다. */
function imports(file: string): string[] {
  const out: string[] = [];
  const statement = /^\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (const match of read(file).matchAll(statement)) {
    if (match[2]) continue;
    const target = resolve(file, match[3] ?? match[4]);
    if (target) out.push(target);
  }
  return out;
}

/** "use client" 로 시작하는 파일과, 거기서 불러오기를 따라가 닿는 모든 파일. 값은 그 파일에 닿은 길이다. */
function clientReachable(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = walk("src")
    .filter((file) => SOURCE.test(file) && /^\s*["']use client["']/.test(read(file)))
    .map((file) => [file]);
  for (let trail = queue.shift(); trail; trail = queue.shift()) {
    const file = trail[trail.length - 1];
    if (seen.has(file)) continue;
    seen.set(file, trail);
    if (!SOURCE.test(file)) continue;
    for (const next of imports(file)) queue.push([...trail, next]);
  }
  return seen;
}

describe("브라우저로 가는 묶음", () => {
  const reachable = clientReachable();

  it("브라우저에서 도는 부품이 있다 (시험이 빈 목록을 보고 통과하지 않게)", () => {
    expect([...reachable.keys()]).toContain("src/components/viewer/ReportViewer.tsx");
    expect([...reachable.keys()]).toContain("src/components/result/PolicyCard.tsx");
  });

  it("브라우저에서 도는 부품은 팩 메타데이터 전체를 불러오지 않는다", () => {
    for (const banned of ["data/pack-meta.json", "src/lib/pack/index.ts"]) {
      const trail = reachable.get(banned);
      expect(trail, `${banned} 에 닿는 길: ${trail?.join(" → ")}`).toBeUndefined();
    }
  });

  it("브라우저로 넘기는 팩 정보에는 팩 판, 정책의 id·제목·조문 이름, 대표 조문의 시행일·원문 해시만 있다", () => {
    expect(Object.keys(packIndex).sort()).toEqual(["pack", "policies"]);
    expect(Object.keys(packIndex.pack)).toEqual(["digest"]);
    expect(packIndex.pack.digest).toBe(packMeta.pack.digest);
    expect(packIndex.policies).toHaveLength(packMeta.policies.length);
    for (const [i, policy] of packIndex.policies.entries()) {
      const meta = packMeta.policies[i];
      expect(Object.keys(policy).sort(), policy.id).toEqual(["id", "legal", "title"]);
      expect([policy.id, policy.title], policy.id).toEqual([meta.id, meta.title]);
      expect(policy.legal.map((ref) => ref.label), policy.id).toEqual(meta.legal.map((ref) => ref.label));
      // 조문은 이름만 넘긴다. 대표 조문(첫 조문)에만 조문별 검사 기록이 적는 값이 더 실린다: 시행일, 원문 해시, 그 해시가
      // 팩 안의 원문 파일과 맞는지(src/lib/report/record.ts).
      for (const [j, ref] of policy.legal.entries()) {
        expect(Object.keys(ref).sort(), `${policy.id} ${ref.label}`).toEqual(
          j === 0 ? ["effective_from", "label", "text_sha256", "text_sha256_matches"] : ["label"],
        );
      }
      // 값은 팩 메타데이터의 것 그대로다.
      const primary = meta.legal[0];
      expect(policy.legal[0], policy.id).toEqual({
        label: primary.label,
        effective_from: primary.effective_from,
        text_sha256: primary.text_sha256,
        text_sha256_matches: primary.text_sha256_matches,
      });
    }
    // 빈 것끼리 견준 것이 아니다. 조문이 둘 이상인 정책이 있고, 대표 조문마다 해시와 시행일이 있다.
    expect(packIndex.policies.some((policy) => policy.legal.length > 1)).toBe(true);
    for (const policy of packIndex.policies) {
      expect(policy.legal[0].text_sha256, policy.id).toMatch(/^[0-9a-f]{64}$/);
      expect(policy.legal[0].effective_from, policy.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("브라우저로 넘기는 팩 정보에 팩 작성자 메모의 글이 없다", () => {
    const sent = JSON.stringify(packIndex);
    const memos = packMeta.policies.flatMap((policy) => Object.values(policy.rationale ?? {}));
    const texts = memos.filter((text): text is string => typeof text === "string" && text.length > 0);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(sent.includes(text), text).toBe(false);
  });

  it("브라우저로 넘기는 팩 정보에 조문 원문이 없다 (원문의 해시만 넘긴다)", () => {
    // 원문은 조문 도감이 빌드할 때 그린다. 결과 화면과 검사 기록은 원문을 쓰지 않는다.
    const sent = JSON.stringify(packIndex);
    const texts = packMeta.policies.flatMap((policy) => policy.legal.map((ref) => ref.text)).filter((text): text is string => Boolean(text));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      // 원문의 줄 가운데 긴 것 하나라도 실려 있으면 안 된다(JSON 으로 적으면 줄바꿈과 따옴표가 달리 적히므로 줄 단위로 본다).
      const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length >= 20 && !/["\\]/.test(line));
      expect(lines.length, text.slice(0, 20)).toBeGreaterThan(0);
      for (const line of lines) expect(sent.includes(line), line).toBe(false);
    }
    // 다른 조문의 값(시행일, 해시, 원문을 받은 날, 법제처 주소)도 넘기지 않는다.
    for (const key of ["text", "text_retrieved", "url", "law_id", "rationale", "rules", "review_by", "ask_developer"]) {
      expect(sent.includes(`"${key}":`), key).toBe(false);
    }
  });
});
