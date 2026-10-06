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
