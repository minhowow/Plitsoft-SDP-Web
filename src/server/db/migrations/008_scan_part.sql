-- 검사 단계 안에서 실행기가 지금 하는 일(2026-11-13, 오너 지시: 분석이 지금 어느 단계인지 보이게). 검사 단계는 실행기가 CLI 명령을
-- 차례로 부른다: 정적 검사와 AI 판정(policypack scan) → 저장소 프로필(policypack profile) → 켰을 때 review(policypack review).
-- 실행기는 명령 사이마다 다음 명령을 알린다(콜백 event "part"). 그 이름과 받은 때를 적는다.
--   profile  저장소 프로필을 시작했다(정적 검사와 AI 판정은 끝났다)
--   review   review 를 시작했다(이 분석의 review_plan 이 run 일 때만 받는다)
-- 비어 있으면 아직 정적 검사와 AI 판정 중이거나, 알림이 오지 않았거나, 이 열을 두기 전의 분석이다. review 안의 단계(의무
-- 고르기·의무별 조사·반박)는 CLI 가 알리지 않으므로 적지 않는다.
ALTER TABLE analyses ADD COLUMN scan_part text CHECK (scan_part IN ('profile', 'review'));
ALTER TABLE analyses ADD COLUMN scan_part_at timestamptz;
