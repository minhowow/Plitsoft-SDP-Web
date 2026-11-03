/**
 * 분석 id. 추측하기 어려운 짧은 id 다. 주소에 그대로 쓰므로 소문자와 숫자만 쓰고, 헷갈리는 글자(0·1·i·l·o)는 뺐다.
 * 31 글자에서 10자리라 가짓수가 31^10(약 8×10^14)이다. 차례 번호를 쓰지 않는다(다른 분석의 주소를 짐작할 수 없게).
 */
export const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const ID_LENGTH = 10;

const ID_PATTERN = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);

export function isAnalysisId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/**
 * 새 id 를 만든다. 암호학적 난수(`crypto.getRandomValues`)로 고르고, 256 을 31 로 나눈 나머지가 치우치지 않게 248 이상은
 * 버리고 다시 뽑는다. B2 의 서버가 분석 행을 만들 때 쓴다(B1 의 합성 데이터는 고정된 id 다).
 */
export function newAnalysisId(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const limit = 256 - (256 % ID_ALPHABET.length);
  let id = "";
  while (id.length < ID_LENGTH) {
    for (const byte of random(new Uint8Array(ID_LENGTH * 2))) {
      if (byte >= limit) continue;
      id += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (id.length === ID_LENGTH) break;
    }
  }
  return id;
}
