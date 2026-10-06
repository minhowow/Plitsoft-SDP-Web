import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));

export function readJson(...parts: string[]): unknown {
  return JSON.parse(readFileSync(path.join(root, ...parts), "utf8"));
}

/** 폴더 안의 .json 파일 이름(MANIFEST 제외). */
export function jsonFiles(...parts: string[]): string[] {
  return readdirSync(path.join(root, ...parts))
    .filter((name) => name.endsWith(".json") && name !== "MANIFEST.json")
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
