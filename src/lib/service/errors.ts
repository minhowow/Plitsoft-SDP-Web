/**
 * 저장소 구현이 GitHub 이나 DB 에 닿지 못했을 때 던지는 오류. `message` 는 화면에 그대로 적을 수 있는 말만 담는다(비밀값,
 * 내부 오류, 주소를 싣지 않는다). 쪽은 이것을 받아 까닭을 보이고, 그 밖의 오류는 Next 의 오류 쪽으로 넘긴다.
 */
export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

/** 쪽이 저장소를 부를 때 쓴다. `ServiceUnavailableError` 면 화면에 적을 까닭을 돌려주고, 그 밖의 오류는 그대로 던진다. */
export async function orUnavailable<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    if (error instanceof ServiceUnavailableError) return { ok: false, message: error.message };
    throw error;
  }
}
