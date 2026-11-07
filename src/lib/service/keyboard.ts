/**
 * 한글 자판(두벌식)으로 친 글을 같은 자리의 영문(QWERTY) 글쇠로 옮긴다. "ㅁㅁ" → "aa", "한글" → "gksrmf".
 *
 * 영문 이름을 찾으려다 한글 자판인 채로 친 질의에 "영문 자판으로 친 ‘…’로 찾기" 를 보이는 데 쓴다(docs/redesign.md 3장 "검색").
 * 자판의 글쇠 자리를 정해진 대로 옮길 뿐이라 짐작하거나 꾸미는 것이 없다. 겹받침(ㄳ → rt)과 겹모음(ㅘ → hk)은 두 글쇠다.
 * 된소리와 ㅒ·ㅖ 는 Shift 를 누른 글쇠(대문자)다. 브라우저에서도 도는 순수 함수다.
 */

/** 첫소리 19개(유니코드 한글 음절의 차례). */
const INITIAL = ["r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"];
/** 가운뎃소리 21개. */
const MEDIAL = ["k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"];
/** 끝소리 28개(첫째는 받침 없음). */
const FINAL = ["", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g"];
/** 낱자(호환용 한글 자모 U+3131 ㄱ ~ U+3163 ㅣ). */
const JAMO = [
  // ㄱ ㄲ ㄳ ㄴ ㄵ ㄶ ㄷ ㄸ ㄹ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅁ ㅂ ㅃ ㅄ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ
  "r", "R", "rt", "s", "sw", "sg", "e", "E", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "Q", "qt", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g",
  // ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅗ ㅘ ㅙ ㅚ ㅛ ㅜ ㅝ ㅞ ㅟ ㅠ ㅡ ㅢ ㅣ
  ...MEDIAL,
];

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const JAMO_FIRST = 0x3131;
const JAMO_LAST = 0x3163;

/**
 * 질의가 한글 글자(음절이나 낱자)와 빈칸뿐이고 한글이 하나라도 있으면 영문 글쇠로 옮긴 글을 돌려준다. 그 밖(영문·숫자·기호가
 * 섞였거나 한글이 없음)은 null 이다. 빈칸은 그대로 둔다.
 */
export function hangulToQwerty(text: string): string | null {
  let out = "";
  let hangul = false;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST) {
      const index = code - SYLLABLE_FIRST;
      out += INITIAL[Math.floor(index / 588)] + MEDIAL[Math.floor((index % 588) / 28)] + FINAL[index % 28];
      hangul = true;
    } else if (code >= JAMO_FIRST && code <= JAMO_LAST) {
      out += JAMO[code - JAMO_FIRST];
      hangul = true;
    } else if (/\s/.test(char)) {
      out += char;
    } else {
      return null;
    }
  }
  return hangul ? out : null;
}
