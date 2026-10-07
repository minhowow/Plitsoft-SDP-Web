import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { packMeta } from "@/lib/pack";
import { assertFreshBuild, outDir } from "./site";

// 빌드된 out/ 의 파일을 본다. 브라우저는 쓰지 않지만 빌드 뒤에 돌아야 해서 이 단계(`npm run test:browser`)에 둔다.
//
// out/ 의 어느 파일에도 팩 작성자 메모의 글이 없어야 한다(docs/commitments.md 의 1, ROADMAP 8번에 넘어와 있던 확인).
// tests/bundle.test.ts 는 소스의 불러오기만 따라가 본다. 여기서는 배포되는 파일 자체를 본다. 쪽의 HTML, 서버 부품의
// 내용(.txt), JS 묶음, CSS 가 모두 들어 있다.

/** out/ 아래 모든 파일(절대 경로). */
function outFiles(dir = outDir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? outFiles(full) : [full];
  });
}

/**
 * 글에서 찾을 조각을 뽑는다. 따옴표·꺾쇠·역빗금·줄바꿈은 HTML 과 JS 에서 다른 글자로 바뀌어 실리므로, 그런 글자에서
 * 끊고 남은 조각 가운데 긴 것(20자 이상)만 쓴다. 짧은 조각("시행 2026-08-20" 등)은 다른 글에도 나온다.
 */
function fragments(text: string): string[] {
  return text
    .split(/["'<>&\\\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 20);
}

describe("빌드된 out/ 의 파일", () => {
  // out/ 이 없거나 소스보다 낡았으면 까닭을 알리고 멈춘다.
  beforeAll(assertFreshBuild);

  const files = existsSync(outDir) ? outFiles() : [];
  const contents = files.map((file) => ({ file: path.relative(outDir, file), text: readFileSync(file, "utf8") }));
  const found = (fragment: string) => contents.filter(({ text }) => text.includes(fragment)).map(({ file }) => file);

  it("볼 파일이 있다 (쪽, 서버 부품의 내용, JS 묶음, CSS)", () => {
    const kinds = new Set(files.map((file) => path.extname(file)));
    for (const kind of [".html", ".txt", ".js", ".css"]) expect(kinds.has(kind), kind).toBe(true);
    expect(files.length).toBeGreaterThan(40);
  });

  it("같은 방법으로 찾으면, 화면에 싣는 팩의 글(정책마다 개발자에게 할 질문)은 나온다", () => {
    // 찾는 방법이 듣는지 본다. 이것이 나오지 않으면 아래 시험은 아무것도 찾지 못해서 통과하는 것이다.
    for (const policy of packMeta.policies) {
      const pieces = fragments(policy.ask_developer ?? "");
      expect(pieces.length, policy.id).toBeGreaterThan(0);
      for (const piece of pieces) expect(found(piece).length, `${policy.id}: ${piece}`).toBeGreaterThan(0);
    }
  });

  it("팩 작성자 메모의 글은 어느 파일에도 없다", () => {
    const memos = packMeta.policies.flatMap((policy) =>
      Object.values(policy.rationale ?? {})
        .filter((text): text is string => typeof text === "string" && text.length > 0)
        .map((text) => ({ policy: policy.id, text })),
    );
    // 정책 다섯에 메모가 둘씩 있다. 메모마다 찾을 조각이 하나는 있어야 한다.
    expect(memos).toHaveLength(packMeta.policies.length * 2);
    for (const { policy, text } of memos) {
      const pieces = fragments(text);
      expect(pieces.length, `${policy}: ${text.slice(0, 30)}`).toBeGreaterThan(0);
      for (const piece of pieces) expect(found(piece), `${policy}: ${piece}`).toEqual([]);
    }
  });
});
