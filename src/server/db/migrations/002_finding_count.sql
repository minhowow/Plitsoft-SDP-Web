-- 끝난 분석의 발견 수(검토 1). 결과를 받을 때 결과 화면과 같은 파서(lib/report/parse.ts)로 읽어 센 값을 적는다. 저장소 쪽과
-- 첫 화면은 분석마다 결과 JSON(최대 RESULT_MAX_KB) 전체를 읽고 해석하지 않고 이 열만 읽는다.
-- 비어 있으면(이 열을 두기 전에 끝난 분석, 결과를 읽지 못한 분석) 화면은 "발견 수 알 수 없음"이다(0 으로 적지 않는다).

ALTER TABLE analyses ADD COLUMN finding_count integer CHECK (finding_count >= 0);
