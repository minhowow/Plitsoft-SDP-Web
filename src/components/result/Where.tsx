import { Fragment } from "react";

/** 줄 번호와 한 덩어리로 묶는 이름 끝(확장자 + ":줄")의 가장 긴 길이. 덩어리는 줄을 바꾸지 못하므로 짧아야 한다. */
const TAIL_MAX = 16;

/**
 * 파일 경로와 줄. 글자는 더하지 않으므로 복사한 글은 경로 그대로다.
 *
 * 경로는 좁은 화면에서 거의 언제나 줄이 바뀐다. "/" 뒤에서 바뀌게 줄바꿈 자리(wbr)를 넣는다. 파일 이름 하나가
 * 한 줄보다 길면 이름 한가운데서도 바뀐다(가로로 넘치게 두지 않는다). 그때 줄 번호만 다음 줄에 홀로 남지 않게
 * 확장자와 ":줄"은 한 덩어리로 묶는다.
 *
 * 줄바꿈 자리는 화면 낭독기에 알리지 않는다(aria-hidden). 알리면 경로가 "src/ auth/ …"처럼 빈칸이 낀 이름으로 읽힌다.
 */
export function Where({ file, line }: { file: string; line: number | null }) {
  const folders = file.split("/");
  const last = folders.pop() ?? "";
  let name = last;
  let tail = "";
  if (line !== null) {
    const dot = last.lastIndexOf(".");
    const extension = dot > 0 ? last.slice(dot) : "";
    tail = `${extension}:${line}`.length <= TAIL_MAX ? `${extension}:${line}` : `:${line}`;
    name = last.slice(0, last.length + `:${line}`.length - tail.length);
  }
  return (
    <code>
      {folders.map((folder, i) => (
        <Fragment key={i}>
          {folder}/<wbr aria-hidden="true" />
        </Fragment>
      ))}
      {name}
      {tail && <span className="where-tail">{tail}</span>}
    </code>
  );
}
