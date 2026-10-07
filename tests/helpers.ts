import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PackMeta } from "@/lib/pack/types";

export const root = fileURLToPath(new URL("..", import.meta.url));

export function readJson(...parts: string[]): unknown {
  return JSON.parse(readFileSync(path.join(root, ...parts), "utf8"));
}

/**
 * 팩 메타데이터를 파일(data/pack-meta.json)에서 직접 읽는다. 소스가 읽어 들인 것(`@/lib/pack` 의 `packMeta`)이 아니다.
 *
 * 화면은 `packMeta` 로 그린다. 그것을 기대값으로 삼으면, 읽어 들이는 곳이 값을 고쳤을 때(조문 원문을 다듬거나 날짜를 손으로
 * 바로잡았을 때) 화면과 기대값이 함께 달라져 시험이 통과한다. 빌드된 쪽을 보는 시험(tests/browser/)은 이것과 견준다.
 * 부품 시험은 `packMeta` 를 쓴다. 그것이 파일과 같은지는 tests/contract.test.ts 가 본다.
 */
export function readPackFile(): PackMeta {
  return readJson("data", "pack-meta.json") as PackMeta;
}

/** 폴더 안의 .json 파일 이름(MANIFEST 제외). */
export function jsonFiles(...parts: string[]): string[] {
  return readdirSync(path.join(root, ...parts))
    .filter((name) => name.endsWith(".json") && name !== "MANIFEST.json")
    .sort();
}

/** 폴더 안의 .sarif 파일 이름. SARIF 수집본은 표본 가운데 일부에만 있다(scripts/capture-cli-output.mjs). */
export function sarifFiles(...parts: string[]): string[] {
  return readdirSync(path.join(root, ...parts))
    .filter((name) => name.endsWith(".sarif"))
    .sort();
}

/**
 * 그려 낸 HTML 에서 `start` 자리에 시작하는 요소 하나를 통째로 잘라 낸다. 같은 이름의 태그가 안에 겹쳐 있어도 된다.
 * 시험이 DOM 도구 없이 "이 묶음 안", "접힌 곳 안"을 가려 보기 위한 것이다.
 */
export function elementAt(html: string, start: number): string {
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1];
  if (!tag) throw new Error(`요소의 시작이 아닙니다: ${html.slice(start, start + 40)}`);
  const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  token.lastIndex = start;
  let depth = 0;
  for (let match = token.exec(html); match; match = token.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, token.lastIndex);
  }
  throw new Error(`닫히지 않은 요소입니다: <${tag}>`);
}

/** `open` 으로 시작하는 요소를 문서 순서대로 모두 잘라 낸다. `open` 은 여는 태그의 앞부분이다(예: `<li class="finding">`). */
export function elementsOf(html: string, open: string): string[] {
  const out: string[] = [];
  for (let at = html.indexOf(open); at !== -1; at = html.indexOf(open, at + 1)) {
    out.push(elementAt(html, at));
  }
  return out;
}

/**
 * `at` 자리를 감싸고 있는 요소들의 여는 태그(바깥부터 안쪽 순서).
 * "이 줄이 닫힌 details 안에 있는가"처럼, 그려 낸 HTML 에서 무엇이 무엇에 가려지는지 보는 데 쓴다.
 */
export function ancestorsAt(html: string, at: number): string[] {
  const stack: string[] = [];
  const token = /<(\/?)[a-z][a-z0-9]*\b[^>]*>/g;
  for (let match = token.exec(html); match && match.index < at; match = token.exec(html)) {
    // 빈 요소(wbr 등)는 닫는 태그가 없다. React 는 `<wbr/>` 처럼 그린다.
    if (match[0].endsWith("/>")) continue;
    if (match[1]) stack.pop();
    else stack.push(match[0]);
  }
  return stack;
}

/**
 * `at` 자리를 가리고 있는 닫힌 details 의 여는 태그들. 비어 있으면 처음부터 화면에 보이는 자리다.
 * 닫힌 details 도 제 summary 는 보여 준다. 그 summary 안의 자리는 가려진 것으로 치지 않는다.
 */
export function closedDetailsAt(html: string, at: number): string[] {
  const around = ancestorsAt(html, at);
  return around.filter(
    (tag, i) => tag.startsWith("<details") && !/\sopen[\s=>]/.test(tag) && !around[i + 1]?.startsWith("<summary"),
  );
}

/** 그려 낸 HTML 에서 태그를 걷어 내고 화면에 보이는 글만 남긴다. 줄바꿈 자리(wbr) 같은 표시가 글을 끊지 않는다. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 그려 낸 화면의 글을 줄(문단, 목록 항목, 제목, 표의 칸)로 나눈다. 두 화면이 어디서 다른지 볼 때 쓴다. */
export function linesOf(html: string): string[] {
  const block = /<\/?(p|li|h[1-6]|dt|dd|div|section|article|summary|ul|ol|dl|details|header|table|caption|tr|th|td)\b[^>]*>/g;
  return textOf(html.replace(block, "\n"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 폴더 아래 모든 파일의 경로(저장소 기준 상대 경로). */
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}
