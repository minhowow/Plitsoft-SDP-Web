/**
 * 조문 도감 주소. 팩 데이터를 불러오지 않는 파일에 따로 둔다. 브라우저에서 도는 부품이 주소만 만들려고
 * 팩 메타데이터 전체(data/pack-meta.json)를 끌어오지 않게 하기 위해서다.
 */

/**
 * 주소에 쓰는 이름. 정책 id 의 점을 빼기표로 바꾼다(kr.pipa.22-2 → kr-pipa-22-2).
 * 점이 든 경로는 Next 가 파일 이름으로 보고 끝 슬래시를 떼어, 일부 정적 호스팅에서 열리지 않는다.
 */
export function policySlug(id: string): string {
  return id.replaceAll(".", "-");
}

/** 조문 도감 주소. 화면 어디서든 이 함수로 만든다. */
export function policyHref(id: string): string {
  return `/policy/${policySlug(id)}/`;
}

/**
 * 결과 화면의 정책 카드에 주는 id. 같은 쪽 안에서 그 카드로 옮겨 갈 때 쓴다(데모의 "고치기 전과 고친 뒤의 결과" 표).
 * 한 쪽에 그리는 결과는 하나뿐이라 정책마다 카드도 하나다. 주소의 이름과 같게 점을 빼기표로 바꾼다.
 */
export function policyCardId(id: string): string {
  return `policy-${policySlug(id)}`;
}

/**
 * 정책 쪽 안에서 규칙 하나의 자리(닻) 이름. 결과 화면의 규칙 id 가 이 자리로 잇는다(`ruleHref`). 닻은 쪽을 빌드할 때마다
 * 같아야 하므로 규칙 id 에서만 만든다(차례나 다른 값을 섞지 않는다).
 *
 * 영문자·숫자·빼기표는 그대로 두고, 그 밖의 글자(밑줄 포함)는 `_<16진 코드>_` 로 바꾼다. 밑줄도 바꾸므로 서로 다른 id 가
 * 같은 이름이 되지 않는다(`a_b` → `rule-a_5f_b`, `a.b` → `rule-a_2e_b`). 팩의 규칙 id 는 지금 영문 소문자와 빼기표뿐이라
 * `rule-` 를 붙인 그대로다. 앞에 `rule-` 를 붙여 쪽의 다른 자리(`legal`, `rules`)와 겹치지 않게 한다.
 */
export function ruleAnchor(ruleId: string): string {
  return `rule-${ruleId.replace(/[^A-Za-z0-9-]/gu, (char) => `_${char.codePointAt(0)!.toString(16)}_`)}`;
}

/** 조문 도감에서 규칙 하나의 주소: 그 정책 쪽의 그 규칙 자리. */
export function ruleHref(policyId: string, ruleId: string): string {
  return `${policyHref(policyId)}#${ruleAnchor(ruleId)}`;
}
