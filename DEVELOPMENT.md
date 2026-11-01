## 목차

- [구조와 범위](#구조와-범위)
- [실행 흐름](#실행-흐름)
- [파일과 데이터](#파일과-데이터)
- [개발과 패키징](#개발과-패키징)
- [오류와 제약](#오류와-제약)
- [로컬 자료와 배포 관리](#로컬-자료와-배포-관리)

<br><br>

# 구조와 범위

---

```mermaid
flowchart LR
    U[사용자가 Instagram 탭에서 확장 아이콘 클릭] --> BG[background.js]
    BG --> APP[확장 내부 app.html / app.js]
    APP --> RUN[InstagramRunner]
    RUN -->|activeTab + scripting| IG[사용자 브라우저의 Instagram 화면]
    RUN --> MEM[창 메모리의 이벤트·결과]
    MEM --> TXT[사용자가 요청한 로컬 TXT]
```

사이트·로컬 HTTP 서버·백엔드·Python CLI는 없다. 확장은 브라우저 기본 JavaScript ES 모듈·HTML·CSS와 Chrome API만 사용한다. Instagram 외의 서비스에 의존하는 실행 경로, AI 호출, 데이터베이스, npm 패키지나 번들 빌드가 없다. ZIP 생성 도구만 Python 3 표준 라이브러리를 사용하며 확장 런타임과 분리된다.

<br><br>

## 실행 흐름

---

1. 사용자가 Instagram 탭에서 확장 아이콘을 눌러 임시 접근 권한을 부여한다. `background.js`가 탭 ID를 붙여 정리 창을 열거나 기존 창을 재사용한다.
2. `app.js`가 사용자 이름 형식과 같은 탭의 중복 정리 창을 확인한다. saved URL이면 이름을 채우지만 대상까지 승인하지 않는다.
3. `InstagramRunner.collections()`가 본인 saved URL을 열고 `chrome.scripting.executeScript`로 `probePage`를 실행한다. 정확한 origin·계정 경로·본인 비공개 안내를 확인한다.
4. 스크롤하며 숫자 ID·이름·URL을 모은다. 바닥에서 새 ID가 세 번 늘지 않으면 완료하며 최대 200회다. 사용자 입력은 `textContent`로 표시한다.
5. 실제 목록의 대상 선택·중복 저장 영향 확인·정확한 계정 포함 문구가 맞아야 시작 버튼을 활성화한다. 계정과 선택 변경 시 승인을 초기화한다. 시작 핸들러는 첫 비동기 대기 전에 실행을 잠그고 승인 계정·대상을 복사한다. 창 소유권 확인 후 취소 상태·계정·선택·확인란·문구를 재검사하며 실행별 러너 참조로 실행과 결과를 처리한다.
6. 현재 컬렉션을 매번 새로 열어 첫 게시글을 처리한다. URL·게시글 ID가 일치하는 저장된 북마크만 클릭하며 이미 해제된 상태는 건너뛴다.
7. 알려진 전체 저장 해제 확인창의 단일 삭제 버튼만 처리한다. 첫 실제 해제는 1초 후 새로고침해 최대 20초 확인한다. 이후 개별 새로고침은 생략하고 화면 상태를 확인한다. 게시글 사이에는 1.5초 대기한다.
8. 같은 게시글이 세 번째 반복되거나 상태가 모호하면 중단한다. 빈 상태가 나오면 별도 이동으로 두 번 더 확인하고 알려진 컬렉션 삭제 메뉴와 확인창만 처리한다.
9. saved 목록을 새로 읽어 대상 ID가 없을 때만 삭제 완료다. 한 대상 실패 시 뒤쪽도 멈춘다. 탭 조회를 기다린 뒤 취소 상태를 재확인하고, 이동·스크립트 주입 직전에도 다시 확인한다. 중단 후 새 Chrome API 동작을 시작하지 않으며 이미 요청한 동작은 되돌리지 않는다.
10. 컬렉션별 결과와 한글 이벤트는 창 메모리에 남긴다. 사용자가 요청하면 TXT로 내려받고, 다음 실행은 목록 조회·선택·승인을 새로 한다. 창 종료 시 메모리는 소실된다. 작업 종료·조회 실패·계정 변경 후에는 목록을 ‘미조회’로 표시한다. 계정을 정상 조회해 실제 빈 목록을 받은 경우에만 0개와 빈 계정 안내를 표시한다.

<br><br>

## 파일과 데이터

---

| 구성요소 | 역할 |
| --- | --- |
| `manifest.json` | MV3·버전·권한·아이콘·CSP |
| `background.js` | 아이콘 클릭과 정리 창 재사용 |
| `app.html`, `app.css`, `app.js` | 입력·선택·승인·중단·TXT 내려받기 |
| `runner.js`의 `probePage` | DOM 판독·URL 경계·제한된 클릭 |
| `runner.js`의 `InstagramRunner` | 탭 이동·대기·반복·오류 중단·집계 |
| `icons/` | 로컬 아이콘과 벡터 원본 |
| `development/build_release.py` | 확장 ZIP과 SHA-256 생성 |
| `development/releases/` | 무시된 로컬 배포 생성물 |
| `development/support/diagnostics/fix-v0.1.3/` | 최신 회귀 검사·패키지·미리보기 원본 출력, Git 제외 |
| `development/support/archive/` | 과거 CLI·사이트·문서·진단 기록, Git 제외 |

이벤트는 `time`, `account`, `event`, `message`와 필요시 `collection`, `collection_id`, `url`, `post_id`, `reason`을 담는다. `pending`은 클릭 전, `unknown`은 미확정, `deleted_verified`는 ID 부재까지 확인한 상태다. 고유 게시글 수는 실행 내 shortcode로 중복 제거하고 `unsaved`를 우선한다. 기록은 복구 백업이나 다음 실행의 상태 복원 자료가 아니다.

권한은 `activeTab`, `scripting`뿐이다. CSP의 `connect-src 'none'`과 로컬 스크립트 정책을 유지한다. 쿠키·브라우저 storage·원격 코드·외부 API 클라이언트가 없다. Instagram 자체 통신과 GitHub 배포 다운로드는 별개다.

<br><br>

## 개발과 패키징

---

개발자 모드에서 확장 폴더를 직접 불러오면 된다. npm 설치·Python 가상환경·웹서버가 필요하지 않다. 코드 수정 후 브라우저 확장 관리 화면에서 새로고침하고 정리 창도 다시 연다. manifest 최소 Chrome 버전은 120이다.

```bash
python3 development/build_release.py
```

버전은 manifest에서 읽고 `development/releases/insta-saved-collection-clean-extension-0.1.3.zip`과 `.sha256`을 만든다. 파일 순서와 ZIP 시간을 고정해 같은 소스의 해시를 재현한다. ZIP 안에는 `insta-saved-collection-clean-extension/`과 LICENSE만 넣으며 로그·인증·도구·문서는 포함하지 않는다. 스토어 제출 전용 ZIP이나 스토어 자동 배포는 구현하지 않았다.

현재 배포 채널은 GitHub `ind2x/savedpoststree`의 Release다. 저장소 이름은 사용자가 별도로 변경한다. 기존 Release·버전 태그를 정리하고 최신 v0.1.3 하나만 재게시한다. 태그는 정리한 현재 소스 커밋을 가리켜 자동 생성 Source code와 문서도 최신 상태가 되게 한다. 배포 전 ZIP 목록·manifest·원본 일치·개인 자료 제외와 Git 변경 목록을 확인한다. 필요한 검증은 일회성 외부 환경에서 수행하고 최종 프로젝트에는 테스트 소스·검증용 가상환경·Node 도구를 남기지 않는다.

<br><br>

## 오류와 제약

---

한국어 문구·역할 선택자에 의존하며 UI 변경 시 중단한다. 기본 대기는 20초다. 일반 오류 화면만으로 봇 감지·IP 제한 여부를 판정하지 않는다. 모호한 결과에서 다시 토글하지 않고 실제 Instagram 상태와 내려받은 기록을 대조한다.

계정 단위의 여러 탭 병렬 실행 잠금은 없으므로 한 계정은 한 창에서 작업한다. 자동 롤백·dry-run·모바일 앱·공식 API·스토어 등록은 미구현이다. 실제 Instagram 계정의 확장 삭제 동작과 Windows Chrome·Edge 실기기 사용성은 후속 사용자 확인 항목이다.

<br><br>

## 로컬 자료와 배포 관리

---

제품은 확장 폴더와 주요 문서, ZIP 생성 도구만으로 구성한다. Python CLI·정적 사이트·호스팅 체크아웃·프로젝트 가상환경·Node 도구·자체 테스트 소스·캐시는 현재 구조에 없다. 임시 확인용 모의 화면은 제품 밖에서 실행하며 확장이나 배포 파일에 포함하지 않는다.

최신 회귀 검사 원본은 `development/support/diagnostics/fix-v0.1.3/`에 둔다. 과거 CLI 로그·진단 화면은 `archive/legacy-cli/`, 이전 문서는 `archive/document-history-20261101/`, 폐기 사이트 기록은 `archive/site/`, 이전 모의 화면 증거는 `archive/v0.1.2/`에 구분했다. 이동 전후 파일 SHA-256이 같은지 확인하고 이동 목록을 비공개 `archive/relocation-20261101.json`에 남긴다. 과거 원문 안의 이름·경로·실행 ID는 역사적 기록이므로 다시 쓰지 않는다.

실제 로그인 프로필과 사용자 범위 글꼴은 프로젝트 밖의 기존 사용자 홈에 보존한다. 폐기 사이트의 원격 영구 삭제는 이전 도구의 미지원으로 완료되지 않았으며, 로컬 사이트 파일과 공개 접근은 이미 제거했다. 이 자료들은 현재 제품의 실행 의존성이 아니다.

로컬 배포 폴더에는 최신 v0.1.3 ZIP·해시만 남긴다. GitHub에서는 현재 소스 브랜치를 갱신하고 기존 Release·태그를 내려 최신본 하나로 교체한다. 저장소 자체를 삭제하거나 원본 Git 커밋 이력을 강제로 재작성하지 않는다. 배포 ZIP 해시는 확장 파일과 LICENSE 내용으로 정해지므로 문서·비공개 자료 정리만으로는 바뀌지 않는다.
