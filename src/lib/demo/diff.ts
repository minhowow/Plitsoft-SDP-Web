/**
 * 두 파일의 줄을 견줘, 다른 쪽에 짝이 없는 줄을 가린다. 데모가 고치기 전·후 코드의 차이를 표시하는 데 쓴다.
 *
 * 두 파일의 글자 차이일 뿐이다. 어느 줄 때문에 판정이 달라졌는지는 여기서 알 수 없고, 화면도 그렇게 적지 않는다.
 *
 * 가장 긴 공통 부분열로 짝짓는다. 글이 같은 줄이 여럿이면(빈 줄, 닫는 괄호) 앞에서부터 짝짓고, 어느 쪽을 버려도
 * 길이가 같으면 앞 파일의 줄을 먼저 버린다. 그래서 어디서 돌려도 결과가 같다.
 */
export function unmatchedLines(before: string[], after: string[]): { before: boolean[]; after: boolean[] } {
  const n = before.length;
  const m = after.length;
  // common[i][j]: before 의 i 번째 줄부터와 after 의 j 번째 줄부터에서 짝지을 수 있는 줄의 가장 큰 수.
  const common = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i][j] = before[i] === after[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  const alone = { before: new Array<boolean>(n).fill(false), after: new Array<boolean>(m).fill(false) };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      i++;
      j++;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      alone.before[i++] = true;
    } else {
      alone.after[j++] = true;
    }
  }
  while (i < n) alone.before[i++] = true;
  while (j < m) alone.after[j++] = true;
  return alone;
}
