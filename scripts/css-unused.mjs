#!/usr/bin/env node
// 죽은 CSS 점검: src/app/globals.css 의 선택자에 나오는 클래스 가운데 src/ 의 어느 파일(globals.css 밖)도 쓰지 않는 것을 적는다.
// Node 내장 모듈만 쓴다. 고치지는 않는다. 적힌 것을 사람이(또는 에이전트가) 읽고 지운다.
//
//   node scripts/css-unused.mjs            죽은 것과 "만들어 붙일 수 있는 것"을 적는다. 죽은 것이 있으면 1 로 끝난다
//   node scripts/css-unused.mjs --all      쓰이는 클래스까지 모두 적는다
//
// 클래스 이름은 소스에서 글자 그대로 찾는다(앞뒤가 이름 글자가 아니어야 한다). 이렇게 찾은 것은 세지 않는다:
//   - 주석 안의 것(`/* */`, `{/* */}`, 줄 끝의 `//`. 주소의 `://` 는 주석으로 보지 않는다)
//   - 주소 길의 조각(앞이나 뒤에 `/` 가 붙은 것. 예: "/demo/" 의 demo)
//   - className·class 가 아닌 JSX 속성의 값(예: `<Icon name="search" />`, `fill="none"`)
// 템플릿 문자열로 만드는 이름(`chip-${status}`, `badge-${status}` 등)은 소스에서 `접두-${` 꼴을 모아, 그 접두로 시작하는 클래스를
// "만들어 붙일 수 있는 것"으로 따로 적는다. 그런 클래스는 지우기 전에 그 값의 목록(예: status.ts 의 상태)을 손으로 견준다.
// 정의만 있고 var() 로 쓰지 않는 사용자 속성(--토큰)도 적는다.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssFile = path.join(root, "src", "app", "globals.css");

/** 주석을 걷은 CSS 에서 규칙의 선택자(@ 규칙의 머리는 뺀다)를 모은다. */
function selectorsOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      const prelude = text.slice(start, i).trim();
      if (prelude !== "" && !prelude.startsWith("@")) selectors.push(prelude);
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      start = i + 1;
    }
  }
  return selectors;
}

/** 선택자 안의 클래스 이름. 속성 선택자와 :is()/:has() 안의 것도 든다. 따옴표 속 글은 걷는다. */
function classesOf(selector) {
  const bare = selector.replace(/"[^"]*"|'[^']*'/g, "");
  return [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

/** 주석을 걷는다. 길이는 그대로 두지 않아도 된다(줄 단위로만 앞을 본다). */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/** 이름이 쓰인 자리 하나가 클래스로 쓰인 것으로 셀 만한가. */
function countsAt(text, index, name) {
  const before = text[index - 1];
  const after = text[index + name.length];
  if (before === "/" || after === "/") return false;
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const head = text.slice(lineStart, index);
  const attr = head.match(/([A-Za-z][\w-]*)=\{?["'`][^"'`]*$/);
  if (attr && attr[1] !== "className" && attr[1] !== "class") return false;
  return true;
}

function uses(text, name) {
  const pattern = new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`, "g");
  for (const match of text.matchAll(pattern)) if (countsAt(text, match.index, name)) return true;
  return false;
}

const css = readFileSync(cssFile, "utf8");
const classes = [...new Set(selectorsOf(css).flatMap(classesOf))].sort();
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const sources = filesUnder(path.join(root, "src"))
  .filter((file) => file !== cssFile && /\.(tsx?|mjs|js|css)$/.test(file))
  .map((file) => ({ file: path.relative(root, file), text: stripComments(readFileSync(file, "utf8")) }));

// 템플릿 문자열로 만드는 이름의 접두: `chip-${…}` 의 "chip-".
const prefixes = new Set(sources.flatMap(({ text }) => [...text.matchAll(/([a-zA-Z][\w-]*-)\$\{/g)].map((m) => m[1])));

const used = [];
const dynamic = [];
const dead = [];
for (const name of classes) {
  const where = sources.filter(({ text }) => uses(text, name)).map(({ file }) => file);
  if (where.length > 0) used.push({ name, where });
  else {
    const prefix = [...prefixes].find((p) => name.startsWith(p));
    if (prefix) dynamic.push({ name, prefix });
    else dead.push(name);
  }
}

const all = process.argv.includes("--all");
if (all) for (const { name, where } of used) console.log(`쓰임  .${name}  ${where.slice(0, 3).join(", ")}${where.length > 3 ? " …" : ""}`);
for (const { name, prefix } of dynamic) console.log(`만들어 붙일 수 있음  .${name}  (소스의 \`${prefix}\${…}\`)`);
for (const name of dead) console.log(`죽음  .${name}`);

// 정의만 있고 쓰지 않는 사용자 속성. CSS 와 소스(style={{ "--x": … }} 등) 어디서든 var(--x) 나 이름이 나오면 쓰인 것으로 센다.
const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, "");
const defined = [...new Set([...bareCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))].sort();
// 미리 정해 두고 아직 쓰지 않는 토큰. --font-serif 는 조문 원문에 조문 도감 단계(D6)에서 쓴다(docs/redesign.md 2.1).
const reserved = new Set(["--font-serif"]);
const deadTokens = defined.filter(
  (token) =>
    !reserved.has(token) &&
    !new RegExp(`var\\(\\s*${escape(token)}(?![\\w-])`).test(bareCss) &&
    !sources.some(({ text }) => new RegExp(`${escape(token)}(?![\\w-])`).test(text)),
);
for (const token of deadTokens) console.log(`쓰지 않는 토큰  ${token}`);

console.log(
  `클래스 ${classes.length}개: 쓰임 ${used.length}, 만들어 붙일 수 있음 ${dynamic.length}, 죽음 ${dead.length}. ` +
    `토큰 ${defined.length}개: 쓰지 않음 ${deadTokens.length}`,
);
process.exitCode = dead.length + deadTokens.length > 0 ? 1 : 0;
