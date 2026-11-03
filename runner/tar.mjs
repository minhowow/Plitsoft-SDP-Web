// 저장소 압축 파일(GitHub 의 tarball, .tar.gz)을 푼다. Node 내장 모듈만 쓴다(실행기 VM 에 따로 깔지 않는다).
//
// 지키는 것
//   - 압축을 푼 크기에 상한을 둔다(maxBytes). 넘으면 그만 푼다(압축 폭탄).
//   - 일반 파일과 폴더만 만든다. 심볼릭 링크·하드 링크·장치 파일은 만들지 않고 센다(링크를 따라 밖의 파일을 읽지 않게).
//   - 경로가 풀 폴더 밖을 가리키면(절대 경로, `..`, 역빗금, NUL) 압축 파일 전체를 받지 않는다.
//   - 파일은 실행 권한 없이(0644) 쓴다. 대상 코드를 실행하지 않는다.
//   - GitHub 의 tarball 은 모든 항목이 `{owner}-{repo}-{짧은 커밋}/` 폴더 아래에 있다. 첫 경로 조각을 떼고 푼다.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchiveError";
  }
}

const BLOCK = 512;

function cstring(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

/** 8진수 크기. 첫 바이트의 높은 비트가 서 있으면 base-256(GNU) 이다. */
function readSize(header) {
  const field = header.subarray(124, 136);
  if (field[0] & 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i += 1) value = value * 256 + field[i];
    return value;
  }
  const text = cstring(field, 0, field.length).trim();
  if (!/^[0-7]*$/.test(text)) throw new ArchiveError("압축 파일의 항목 크기를 읽지 못했습니다.");
  return text === "" ? 0 : Number.parseInt(text, 8);
}

function checksumOk(header) {
  const stored = cstring(header, 148, 8).trim();
  if (!/^[0-7]+$/.test(stored)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum === Number.parseInt(stored, 8);
}

/** pax 확장 머리("길이 키=값\n" 의 연속)에서 path 를 읽는다. */
function paxPath(data) {
  // 길이는 바이트 수다(글자 수가 아니다). 바이트로 자른다.
  let at = 0;
  let found = null;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(at, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= space - at || at + length > data.length) break;
    const body = data.subarray(space + 1, at + length).toString("utf8").replace(/\n$/, "");
    const eq = body.indexOf("=");
    if (eq !== -1 && body.slice(0, eq) === "path") found = body.slice(eq + 1);
    at += length;
  }
  return found;
}

/**
 * 압축 파일 안의 경로를 풀 폴더 안의 상대 경로로 바꾼다. 첫 조각(최상위 폴더)을 뗀다. 최상위 폴더 자체면 null.
 * 밖을 가리키면 던진다.
 */
export function safeRelative(name, { stripFirst = true } = {}) {
  if (name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new ArchiveError("압축 파일에 저장소 밖을 가리키는 경로가 있어 받지 않았습니다.");
  }
  const parts = name.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new ArchiveError("압축 파일에 저장소 밖을 가리키는 경로가 있어 받지 않았습니다.");
  }
  const rest = stripFirst ? parts.slice(1) : parts;
  return rest.length === 0 ? null : rest.join("/");
}

/**
 * .tar.gz 를 dest 폴더(비어 있어야 한다)에 푼다.
 * @param {Buffer} gz 압축 파일
 * @param {string} dest 풀 폴더
 * @param {{ maxBytes: number }} limits 푼 크기 상한(바이트, tar 전체)
 * @returns {{ files: number, bytes: number, links: number, others: number }}
 */
export function extractTarGz(gz, dest, { maxBytes }) {
  let tar;
  try {
    tar = gunzipSync(gz, { maxOutputLength: maxBytes });
  } catch (error) {
    if (error && error.code === "ERR_BUFFER_TOO_LARGE") {
      throw new ArchiveError(`압축을 푼 크기가 상한(${Math.round(maxBytes / 1_000_000)}MB)을 넘어 받지 않았습니다.`);
    }
    throw new ArchiveError("압축 파일을 풀지 못했습니다(gzip 이 아니거나 깨졌습니다).");
  }
  return extractTar(tar, dest);
}

/** 압축을 푼 tar 를 dest 에 푼다(시험이 바로 부르기도 한다). */
export function extractTar(tar, dest, { stripFirst = true } = {}) {
  const root = path.resolve(dest);
  mkdirSync(root, { recursive: true });
  const counts = { files: 0, bytes: 0, links: 0, others: 0 };
  let longName = null;
  let paxName = null;
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumOk(header)) throw new ArchiveError("압축 파일의 항목 머리가 깨져 있어 받지 않았습니다.");
    const size = readSize(header);
    const type = String.fromCharCode(header[156] || 0x30);
    const start = offset + BLOCK;
    const end = start + size;
    if (end > tar.length) throw new ArchiveError("압축 파일이 중간에 끊겨 있어 받지 않았습니다.");
    const data = tar.subarray(start, end);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      paxName = paxPath(data);
      continue;
    }
    if (type === "g") continue; // 전체 머리(GitHub 은 커밋을 적는다). 경로가 아니다.
    if (type === "L") {
      longName = cstring(data, 0, data.length);
      continue;
    }
    if (type === "K") continue; // 긴 링크 이름. 링크는 만들지 않는다.

    const prefix = cstring(header, 345, 155);
    const plain = cstring(header, 0, 100);
    const name = paxName ?? longName ?? (prefix ? `${prefix}/${plain}` : plain);
    paxName = null;
    longName = null;

    // 경로는 항목의 종류와 상관없이 본다(링크라도 밖을 가리키는 이름이 있으면 압축 파일을 받지 않는다).
    const relative = safeRelative(name, { stripFirst });
    if (type === "1" || type === "2") {
      counts.links += 1;
      continue;
    }
    if (relative === null) continue;
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new ArchiveError("압축 파일에 저장소 밖을 가리키는 경로가 있어 받지 않았습니다.");
    }
    if (type === "5") {
      mkdirSync(target, { recursive: true });
    } else if (type === "0" || type === "7" || header[156] === 0) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data, { mode: 0o644 });
      counts.files += 1;
      counts.bytes += size;
    } else {
      counts.others += 1;
    }
  }
  return counts;
}
