-- 이 분석에서 review 를 어떻게 했는지(2026-11-12, 오너 지시: 하루 review 실행 수 상한). 실행기에 보낼 때 정해 적는다.
--   run    실행기에 review 를 맡겼다(하루 상한 REVIEW_DAILY_LIMIT 을 셀 때 이것만 센다)
--   stored 같은 저장소·커밋의 저장된 review 가 있어 맡기지 않았다(그것을 보인다)
--   limit  오늘(한국 표준시) review 실행 수가 상한에 닿아 맡기지 않았다(화면에 '오늘 검토 한도가 찼습니다')
-- 비어 있으면 REVIEW 스위치가 꺼져 있었거나, 아직 실행기에 보내지 않았거나, 이 열을 두기 전의 분석이다.
ALTER TABLE analyses ADD COLUMN review_plan text CHECK (review_plan IN ('run', 'stored', 'limit'));
