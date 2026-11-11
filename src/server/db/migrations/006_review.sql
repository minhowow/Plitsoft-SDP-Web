-- review 결과(2026-11-11, 오너 지시). 실행기가 `policypack review` 를 돌렸을 때(사이트의 REVIEW 스위치가 켜져 있고 같은 커밋의
-- 저장된 review 가 없을 때만) 받은 JSON 을 그대로 둔다(review 2판: 프로필·개인정보 흐름·걸리는 의무·체크리스트·실행 정보). 화면은
-- `lib/review` 의 읽기로 읽는다. 보내지 않았거나 읽히지 않으면 비운다. review 때문에 분석을 실패로 적지 않는다. 같은 커밋의 다른
-- 분석은 이것을 다시 돌리지 않고 보인다(`getReview`).
ALTER TABLE results ADD COLUMN review text;
