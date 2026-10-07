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
