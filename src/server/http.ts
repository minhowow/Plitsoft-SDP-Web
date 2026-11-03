import "server-only";

/**
 * route handler 가 함께 쓰는 작은 도구. 응답에는 화면에 적을 수 있는 말만 싣는다(비밀값, 내부 오류, 쌓인 호출을 싣지 않는다).
 */

/** 본문을 글로 읽되, maxBytes 를 넘으면 그만 읽는다(넘는 본문을 메모리에 다 올리지 않는다). */
export async function readBody(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

/** JSON 응답. 캐시하지 않는다. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** 모르는 오류. 까닭은 서버 기록에도 이름만 남긴다(본문·비밀값이 실린 메시지를 남기지 않는다). */
export function internalError(where: string, error: unknown): Response {
  console.error(`[${where}] ${error instanceof Error ? error.name : "오류"}`);
  return json({ ok: false, message: "서버에서 처리하지 못했습니다. 잠시 뒤에 다시 해 보세요." }, 500);
}

/** 본문이 JSON 이라고 밝힌 요청인지. 다른 사이트의 양식(form)이 보낸 요청을 받지 않는다(JSON 은 미리 묻기를 거친다). */
export function isJsonRequest(request: Request): boolean {
  return /^application\/json(\s*;|$)/i.test(request.headers.get("content-type") ?? "");
}
