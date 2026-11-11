-- 저장소 프로필(2026-11-11, 오너 지시). 실행기가 검사와 함께 돌린 `policypack profile` 의 JSON 을 받은 그대로 둔다(모델 호출이
-- 없는 목록 층: 코드 신호로 고른 기능과 그 기능에 걸릴 수 있는 의무). 화면은 `lib/profile` 의 읽기로 읽는다. 실행기가 보내지
-- 않았거나(이 열을 두기 전의 분석, 실행기에서 프로필이 실패) 읽히지 않으면 비운다. 프로필 때문에 분석을 실패로 적지 않는다.
ALTER TABLE results ADD COLUMN profile text;

-- 목록(첫 화면·저장소 쪽)의 한 줄에 짧게 싣는 감지된 기능 이름(JSON 글 배열, `featureNames` 의 차례). 결과를 받을 때 프로필에서
-- 한 번 적는다(목록을 그릴 때마다 프로필 전체를 읽고 해석하지 않게). 비어 있으면 모른다(프로필이 없던 분석). 빈 배열과 다르다.
ALTER TABLE analyses ADD COLUMN feature_names text;
