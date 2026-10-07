import { parseReportText, type ParseResult } from "./parse";

const MB = 1024 * 1024;

/**
 * `/view` 가 여는 파일의 크기 한도(10MB). CLI 의 한도가 아니라 이 뷰어의 한도다.
 *
 * 결과 파일이 아닌 큰 파일(동영상, 압축 파일 등)을 통째로 메모리에 읽지 않기 위한 것이다. 결과 파일로는 발견이
 * 5,000건을 조금 넘는 크기다. 거기까지는 화면이 멈추지 않는 것을 쟀고, 그보다 큰 결과는 재 보지 않았다
 * (`docs/architecture.md` 의 "`/view`").
 */
export const MAX_FILE_BYTES = 10 * MB;

/** 글로 풀 수 없는 파일에 보이는 안내. */
export const NOT_UTF8 =
  "UTF-8 로 읽을 수 없는 파일입니다. 터미널이 다른 문자 부호화(예: CP949)로 받아 적은 파일일 수 있습니다. UTF-8 로 다시 저장해 여세요.";

/**
 * 파일의 바이트를 글로 푼다. 풀 수 없으면 null 이다.
 *
 * 결과 파일은 UTF-8 이다. 글자 순서 표시(BOM)가 UTF-16 이면 그 부호화로 푼다(받아 적는 터미널에 따라 그렇게 적힌다).
 * 그 밖에는 UTF-8 로만 풀고, UTF-8 이 아닌 바이트가 있으면 풀지 않는다. 어느 부호화인지 짐작해 풀지 않는다.
 * 느슨하게 풀면(`File.text()`) 깨진 글자가 든 채로 결과처럼 그려진다. 정책 제목과 경로가 읽을 수 없는 글이 된다.
 */
function decode(bytes: Uint8Array): string | null {
  const bom = (...head: number[]) => head.every((byte, i) => bytes[i] === byte);
  const encoding = bom(0xff, 0xfe) ? "utf-16le" : bom(0xfe, 0xff) ? "utf-16be" : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 고른 파일 하나를 읽어 결과로 바꾼다. 브라우저 안에서만 읽는다. 내용은 어디로도 보내지 않고 저장하지도 않는다.
 * 읽지 못한 까닭은 화면에 그대로 적을 문장으로 돌려준다.
 */
export async function readResultFile(file: Pick<File, "size" | "arrayBuffer">): Promise<ParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    // 크기는 소수 첫째 자리까지 적는다. 한도를 조금 넘은 파일이 한도와 같은 수로 보이지 않게 올림한다.
    const size = (Math.ceil((file.size / MB) * 10) / 10).toFixed(1);
    return {
      ok: false,
      errors: [`파일이 너무 큽니다(${size}MB). 이 뷰어는 ${MAX_FILE_BYTES / MB}MB 까지만 엽니다.`],
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    // 폴더를 끌어다 놓았거나, 고른 뒤에 파일이 옮겨지거나 지워졌을 때다.
    return { ok: false, errors: ["파일을 읽지 못했습니다. 폴더가 아닌 파일인지, 파일이 그 자리에 있는지 확인하세요."] };
  }
  const text = decode(bytes);
  if (text === null) return { ok: false, errors: [NOT_UTF8] };
  return parseReportText(text);
}
