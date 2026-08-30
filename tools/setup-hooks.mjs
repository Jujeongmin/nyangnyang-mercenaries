/**
 * 훅 경로를 저장소 안(`tools/githooks`)으로 돌린다.
 *
 * `core.hooksPath` 는 저장소마다의 **로컬 설정**이라 클론에 딸려오지 않는다.
 * 그래서 새로 받을 때마다 손으로 한 줄 쳐야 했는데, 그 한 줄을 잊으면
 * pre-push 훅이 없는 채로 밀게 되고 배포링크가 도로 바뀐다 — 훅을 만든
 * 이유가 통째로 무너진다. `npm install` 이 `prepare` 로 이것을 대신 돌린다.
 *
 * **실패해도 설치를 막지 않는다.** Verse8 에디터 컨테이너는 턴 사이에 `.git`
 * 을 지우고, 압축본만 받아 쓰는 경우도 있다. 그런 자리에서 git 이 없다고
 * `npm install` 이 통째로 죽으면 안 된다.
 */
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', 'tools/githooks'], { stdio: 'ignore' });
  console.log('훅 경로 설정됨 — core.hooksPath=tools/githooks');
} catch {
  console.log('git 저장소가 아니라 훅 설정을 건너뛴다 (설치는 계속한다)');
}
