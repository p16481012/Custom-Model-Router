# v0.6.14 통합 사용자 검증 체크리스트

대상 버전: **v0.6.14**

이 문서는 v0.1~v0.6 기능을 한 번에 확인하는 최종 수동 검증 순서입니다. 위에서 아래로 진행하고, 사용하지 않는 제공업체·외부 확장·개발자 API 항목은 `해당 없음`으로 표시하세요.

## 판정 기준

- **필수**: 모든 사용자가 확인합니다.
- **조건부**: 해당 계정·프로필·기능을 사용하는 경우 확인합니다.
- **권장**: 안정성 판단에 도움이 되므로 가능하면 확인합니다.
- **선택**: 개발자 도구나 특수 환경이 있을 때 확인합니다.

각 항목에는 `통과 / 실패 / 해당 없음`과 짧은 메모를 남깁니다. API 키, Service Account, 전체 endpoint URL, project/account ID와 Connection Profile 본문은 스크린샷·로그·이슈에 포함하지 마세요.

데이터 손실, 인증 설정 변경, 반복 요청, 브라우저 멈춤 또는 비밀정보 노출이 보이면 즉시 검증을 중단하고 `치명`으로 기록하세요.

## 자동 검사 완료 범위

v0.6.14 저장소에서는 Node 자동 검사 232개와 Playwright Chromium UI 회귀 검사 14개를 별도로 실행합니다. Node 검사는 기존 UI·Registry·Routing·DOM 브리지·진단 schema v2·백업 계약에 더해 Provider Integration API `1.0.0`의 capability 협상, 선택된 일반·Custom Connection Profile 경계, handler 설치→모델 게시 순서, 실패·취소·종료 정리, 요청 allowlist, 메인 채팅 설정 불변, 비밀정보 비노출과 hookless provider UI 비변경을 포함합니다. UI 검사는 실제 `settings.html`과 SillyTavern 1.18.0 고정 commit의 core·Popup CSS를 결합한 설정 화면 검사와 브라우저 브리지 회귀에 더해, 실제 제품 provider integration 모듈·wiring을 가짜 Connection Manager 서비스와 로컬 echo 요청으로 실행합니다. GitHub Actions의 `ui-regression-evidence-*` artifact에는 성공·실패 PNG와 HTML report가 14일 보관됩니다.

provider integration 브라우저 fixture는 실제 제품 모듈과 공개 wiring을 실행하지만 Connection Manager와 네트워크는 더미입니다. 자동 검사는 전체 SillyTavern JavaScript 런타임, 실제 외부 확장 코드, 실제 제공업체 API 요청을 실행하지 않습니다. 아래 체크리스트에서 실제 설치 화면, 외부 확장의 provider/model 게시, Network payload와 제공업체 요청 성공을 계속 확인해야 합니다. API 키나 Service Account를 자동 검사에 제공할 필요는 없습니다.

## 0. 환경 기록과 사전 준비

```text
검증 날짜:
SillyTavern 버전:
Custom Model Router 버전: v0.6.14
브라우저·OS:
설치 방식: 신규 / 업데이트
이전 확장 버전:
주 Chat Completion source:
Connection Profile 사용 여부:
일반/스트리밍 확인 여부:
검증할 제공업체:
```

- [ ] **[필수][PRE-01] SillyTavern 버전을 기록하고 1.18.0인지 확인한다.**
  - 1.18.0보다 낮으면 진행하지 않습니다. 더 높으면 진단 경고와 실제 요청 결과를 반드시 기록합니다.
- [ ] **[필수][PRE-02] 확장을 설치하기 전 또는 비활성 상태에서 기존 주 모델로 일반 요청이 성공한다.**
- [ ] **[조건부][PRE-03] 스트리밍을 사용한다면 기존 주 모델의 스트리밍 요청도 성공한다.**
- [ ] **[필수][PRE-04] 현재 API source, 모델, endpoint 종류, 리전과 profile 이름을 비밀값 없이 기록한다.**
- [ ] **[필수][PRE-05] SillyTavern 전체 설정을 기존 방법으로 백업한다.**
- [ ] **[조건부][PRE-06] 이전 CMR 버전을 사용 중이면 기존 등록 모델·선택·route를 화면 캡처나 텍스트로 기록한다.**
- [ ] **[필수][PRE-07] 저장소 URL로 업데이트한 뒤 페이지를 완전히 새로고침한다.**
- [ ] **[필수][PRE-08] Extensions 목록에서 Custom Model Router가 활성화되어 있고 오류 알림이 없다.**

## 1. 버전·이관·초기화

- [ ] **[필수][MIG-01] API Connections 도구행에 숫자나 개수 배지 없이 사용자 모델 관리 아이콘이 정확히 하나 표시된다. 스크린 리더용 이름은 등록 모델 개수를 계속 안내한다.**
- [ ] **[필수][MIG-02] 관리 팝업에 버전 배지가 없고 SillyTavern 공식 닫기 버튼 하나만 표시된다.**
- [ ] **[필수][MIG-03] Extensions 설정 영역에 이전의 큰 CMR inline 패널이 남지 않는다.**
- [ ] **[조건부][MIG-04] v0.1.x의 Vertex 등록 모델이 Google Vertex AI 목록에 보존된다.**
- [ ] **[조건부][MIG-05] v0.2.x의 여러 제공업체 등록 모델과 선택 상태가 모두 보존된다.**
- [ ] **[조건부][MIG-06] v0.4.0의 용도별 route가 같은 모델과 profile ID를 가리킨다.**
- [ ] **[조건부][MIG-06A] v0.5.0에서 업데이트했다면 Registry와 route가 보존되고 외부 연결 설정은 빈 상태로 안전하게 시작한다.**
- [ ] **[조건부][MIG-06B] 외부 연결 schema v1 또는 v0.6.0~v0.6.5에서 업데이트했다면 legacy provider·`manual`·`disabled` mapping은 제거되고 정상 `selectedModels` 선택 기록은 schema v2에 보존된다. 과거 `disabled`는 사용자 제외로 되살아나지 않는다.**
- [ ] **[조건부][MIG-06C] legacy mapping 512개와 별도 target의 `selectedModels`가 함께 있으면 mapping 수와 관계없이 정상 선택 기록을 우선 보존한다.**
- [ ] **[조건부][MIG-06D] v0.6.5에서 업데이트했다면 외부 대상의 모드 선택기와 기본 상태 목록은 사라지고, 감지된 안전한 대상에는 별도 설정 없이 CMR 선택지가 표시된다.**
- [ ] **[조건부][MIG-06E] v0.6.9 schema v2에서 사용자가 명시적으로 제외한 target은 새로고침 뒤에도 제외 상태가 유지되며, schema v1의 임의 `excludedTargets` 값은 이관되지 않는다.**
- [ ] **[필수][MIG-07] 새로고침을 두 번 반복해도 런처·팝업·사용자 모델 그룹이 중복되지 않는다.**
- [ ] **[필수][MIG-08] 브라우저 콘솔에 처리되지 않은 CMR 초기화 오류가 없다.**

## 2. 팝업 UI·접근성·대량 목록

- [ ] **[필수][UI-01] 관리 아이콘을 누르면 팝업 하나가 열리고 아이콘의 펼침 상태가 갱신된다.**
- [ ] **[필수][UI-02] 닫기 버튼과 `Escape`가 각각 팝업을 닫는다.**
- [ ] **[필수][UI-03] 팝업을 닫으면 키보드 초점이 관리 아이콘으로 돌아온다.**
- [ ] **[필수][UI-04] 제공업체 선택기에 지원 연결 24개가 그룹별로 표시된다.**
- [ ] **[필수][UI-05] 등록할 제공업체를 바꾸면 모델 ID 정보 popover의 입력 규칙만 해당 업체 값으로 바뀌고, 아래 목록은 모든 제공업체의 등록 모델을 계속 표시한다. 모델 컨트롤이 정상일 때 감지 성공 문구나 빈 상태 여백은 나타나지 않는다.**
- [ ] **[조건부][UI-05A] 지원 모델 컨트롤을 실제로 찾지 못한 제공업체에서만 오류가 표시되고 정상·비활성 제공업체를 오류로 표시하지 않는다.**
- [ ] **[필수][UI-06] 전체 등록 목록이 제공업체별 그룹으로 정리되고 각 모델이 올바른 제공업체 아래에 한 번만 나타난다.**
- [ ] **[필수][UI-07] `제공업체 X곳 · 모델 N개`가 모델을 등록한 제공업체 수와 전체 등록 모델 수에 각각 일치한다.**
- [ ] **[권장][UI-08] 모델 6개까지는 목록이 자연스럽게 펼쳐지고 7개부터 목록 영역만 제한 높이 안에서 스크롤된다. 스크롤바는 보이지 않지만 마우스 휠·터치·키보드로 끝까지 이동할 수 있다.**
- [ ] **[권장][UI-08A] 팝업 본문, 진단 결과와 고급 외부 연결 목록도 내용이 길어지면 시각적 스크롤바 없이 휠·터치·키보드 스크롤이 동작한다.**
- [ ] **[필수][UI-08B] 등록 모델이 12개 이하일 때 검색창은 숨고 13개부터 나타난다. 제공업체 이름·ID 또는 모델 ID를 입력하면 일치하는 행과 `검색 결과/전체` 개수가 즉시 갱신되고 검색어가 없으면 전체 목록으로 돌아온다.**
- [ ] **[권장][UI-09] 긴 계층형 모델 ID가 행 밖으로 넘치거나 버튼을 가리지 않는다.**
- [ ] **[권장][UI-10] 좁은 창 또는 모바일 폭에서 입력·추가·삭제·진단과 고급 외부 연결 관리 섹션을 사용할 수 있다.**
- [ ] **[필수][UI-11] Tab 키만으로 제공업체, 단일·여러 줄 공용 모델 ID 입력란, 아이콘 전용 등록, 정보 아이콘 5곳, 검색, 모델 삭제·실행 취소, 백업 미리보기, 진단, 고급 외부 제외·복구와 SillyTavern 공식 닫기 컨트롤에 접근한다. 각 아이콘 버튼의 접근 가능한 이름이 역할을 설명한다.**
- [ ] **[필수][UI-11A] 제공업체·모델 ID·전체 등록 모델·진단 및 백업·외부 연결에 정보 아이콘이 하나씩 총 5개 있고, 각각 문맥을 설명하는 고유한 스크린 리더 이름과 연결된 도움말을 가진다.**
- [ ] **[필수][UI-11B] 각 정보 아이콘을 마우스·터치 또는 Tab 뒤 Enter·Space로 열 수 있고, Escape나 바깥 클릭으로 닫을 수 있다. `popover="auto"` 동작에 따라 다른 도움말을 열면 이전 도움말은 닫힌다.**
- [ ] **[권장][UI-11C] 320·360·420·720px에서 열린 도움말이 Popup 밖으로 잘리거나 가로 넘침을 만들지 않고, 닫은 뒤 원래 컨트롤을 계속 사용할 수 있다.**
- [ ] **[필수][UI-12] 등록 목록에는 제공업체 이름, 모델 ID와 작은 휴지통 버튼만 있고 선택·적용 버튼, 현재 사용 배지와 라우팅 설정 UI가 없다. 삭제 버튼이 모델 행보다 과도하게 크지 않다.**
- [ ] **[필수][UI-13] 팝업 안내가 실제 모델 선택은 SillyTavern의 기존 모델 선택기 또는 입력란에서 한다고 명시한다.**
- [ ] **[필수][UI-14] SillyTavern 공식 닫기 버튼 하나만 보이고 CMR 내부에 두 번째 닫기 버튼이 없다. 공식 버튼과 `Escape`가 모두 팝업을 닫는다.**
- [ ] **[권장][UI-15] `호환성 진단 및 CMR 설정 백업`과 `지원 범위 및 개인정보`를 펼쳤을 때 내용 아래에 충분한 안쪽 여백이 있어 마지막 문장이 테두리에 붙지 않는다.**
- [ ] **[필수][UI-15A] `지원 범위 및 개인정보`는 표준 Chat Completion 지원, 비채팅·자체 위젯 제외, 저장·백업하지 않는 API 키·계정·엔드포인트를 3문장으로 설명한다.**
- [ ] **[권장][UI-16] 일반 안내 문구는 단어 중간에서 잘리지 않고 공간이 부족할 때만 공백에서 줄바꿈된다. 짧은 구절은 가능한 한 한 줄에 유지되고 각 문장은 종결부호 뒤에서 다음 줄로 분리된다.**
- [ ] **[필수][UI-17] 모델 등록 버튼은 공용 textarea 옆의 중앙 정렬된 `+` 아이콘 하나만 표시하고 `추가` 텍스트나 별도 여러 모델 등록 버튼은 표시하지 않는다. hover title과 스크린 리더 이름으로 역할을 알 수 있으며, 삭제·진단·백업 버튼도 가로·세로 중앙 정렬되고 글자가 세로로 쪼개지지 않는다.**
- [ ] **[권장][UI-18] GitHub Actions의 최신 `UI 회귀 검사`가 통과했고 `ui-regression-evidence-*` artifact의 320·360·420·720px PNG에서 잘림·겹침·가로 넘침이 없는지 확인한다.**
- [ ] **[필수][UI-19] 정상 상태에서는 기본 팝업에 `다른 확장 모델 연결` 목록과 문제 경고 카드가 나타나지 않는다.**
- [ ] **[조건부][UI-20] 선택지 주입 실패, observer·binding 런타임 불일치 또는 외부 CMR option 용량·성능 주의가 있을 때 외부 연결 문제 카드가 나타나며, 설정 아이콘을 누르면 진단 섹션의 `고급: 외부 연결 관리`가 열린다.**
- [ ] **[필수][UI-21] 도움말을 열지 않아도 등록 위치, `한 줄에 하나 · 최대 200개 · 오류가 있으면 전체 취소`, 비밀정보를 제외한 백업과 실제 외부 요청 확인 안내를 볼 수 있다. 호환성 오류·외부 용량 경고·백업 충돌·진단 결과 같은 동적 상태도 popover 안으로 숨지 않는다.**

## 3. 모델 등록·SillyTavern native 선택·삭제 공통 경로

- [ ] **[필수][REG-01] 정확한 새 모델 ID를 등록하면 성공 메시지와 목록 행이 나타난다.**
- [ ] **[필수][REG-02] 같은 제공업체에 같은 ID를 다시 등록하면 중복 오류가 나타난다.**
- [ ] **[필수][REG-03] 같은 ID를 다른 제공업체에 등록하면 서로 독립된 레코드로 저장된다.**
- [ ] **[필수][REG-04] URL, 한 줄 안의 공백, `?`, `#`, `%`가 포함된 잘못된 모델 ID를 거부한다. 개행은 모델 ID 사이의 구분자로만 사용한다.**
- [ ] **[조건부][REG-05] OpenRouter·Workers AI·Fireworks 등에서 `/`, `:`, `@`가 들어간 공식 계층형 ID를 등록한다.**
- [ ] **[필수][REG-06] SillyTavern 기본 selector의 짧은 `사용자 모델` 그룹 또는 Custom 입력란에서 등록 모델을 선택하면 현재 모델 값이 정확한 ID가 된다. 이전의 긴 `사용자 지정 모델 · Custom Model Router` 라벨은 나타나지 않는다.**
- [ ] **[필수][REG-07] SillyTavern native 컨트롤에서 모델을 바꿔도 관리 팝업은 등록·삭제 목록으로만 유지되고 별도 선택 상태나 적용 버튼을 만들지 않는다.**
- [ ] **[필수][REG-08] 새로고침 뒤 등록 목록과 마지막 사용자 선택이 복원된다.**
- [ ] **[필수][REG-09] source를 다른 업체로 왕복해도 각 제공업체 선택이 섞이지 않는다.**
- [ ] **[조건부][REG-10] 원격 모델 목록 새로고침 뒤 CMR 그룹과 선택이 한 번만 복원된다.**
- [ ] **[필수][REG-11] 현재 사용 중인 select형 사용자 모델 삭제가 거부되고 SillyTavern native selector에서 다른 모델로 전환한 뒤 삭제된다.**
- [ ] **[조건부][REG-12] Custom 등록 삭제는 Registry 행만 지우고 현재 Custom model·endpoint는 지우지 않는다.**
- [ ] **[필수][REG-13] 공용 모델 ID 입력란에 ID 하나만 입력하거나 한 줄에 하나씩 최대 200줄을 입력한 뒤 같은 `+` 아이콘을 누르면 선택한 제공업체에 한 번에 등록하고 빈 줄·이미 등록된 중복은 건너뛴다.**
- [ ] **[필수][REG-14] 공용 입력란의 어느 한 줄이라도 해당 제공업체 규칙에 맞지 않거나 200줄을 넘으면 일부 모델도 추가하지 않고 오류 위치를 알린다.**
- [ ] **[필수][REG-15] 모델을 삭제하면 즉시 실행 취소가 나타나고 누르면 같은 provider·model ID가 원래 상태로 복원된다. 다른 작업이나 충돌이 생겼을 때 기존 레코드를 덮어쓰지 않는다.**

## 4. 다른 확장 모델 UI 주입과 실제 요청 확인

먼저 CMR Registry에 서로 다른 제공업체의 사용자 모델을 하나씩 등록합니다. 감지된 안전한 외부 Chat Completion 모델 칸에는 별도의 모드 설정 없이 native option과 중복되지 않는 등록 모델이 target별 최대 512개까지 제공업체별로 표시됩니다. provider/source 선택기는 이름에 `model`이 포함되어도 모델 target이 아니며, native option·현재 값을 유지한 채 실제 모델 control의 metadata·change/input 감시에만 사용합니다. 기본 팝업은 정상 대상 목록을 노출하지 않습니다. 진단 섹션의 고급 관리 기본 목록에는 실패·사용자 제외만 나타나고, 정상 target은 사용자가 **문제가 생긴 모델 칸 제외**를 펼쳤을 때만 선택기에 나타납니다. 안전상 제외 대상은 관리 행이 아니라 진단 집계로만 확인합니다.

- [ ] **[필수][EXT-01] 정상 상태의 기본 팝업에는 외부 target 목록이 없고 `자동 연결`, `직접 연결`, `연결 안 함` 선택기와 수동 모델 새로고침 버튼도 없다. 안전 target에는 CMR 선택지가 자동 표시된다.**
- [ ] **[필수][EXT-01A] `호환성 진단 및 CMR 설정 백업 → 고급: 외부 연결 관리`의 기본 목록에는 bridge 실패와 사용자가 제외한 target만 보이며, 각 행에 외부 확장 이름과 실제 모델 control 이름이 함께 표시된다.**
- [ ] **[필수][EXT-01B] 정상 target은 `문제가 생긴 모델 칸 제외`를 사용자가 직접 펼쳤을 때만 선택기에 나타난다. 선택기의 `선택지 연결됨`은 CMR option 주입 성공만 뜻하며 `실제 요청 확인 필요` 안내와 구분되고, 이를 실제 API 호환성 통과로 기록하지 않는다.**
- [ ] **[조건부][EXT-01C] 안전 target의 제외 아이콘을 누르면 그 대상에서만 CMR 선택지가 정리되고 native option·현재 값·다른 target은 유지된다. 다시 연결 아이콘을 누르면 CMR 선택지가 복원된다.**
- [ ] **[필수][EXT-01D] Vectors·embedding·TTS·Stable Diffusion 등 안전상 제외 target은 고급 기본 목록과 정상 대상 선택기 모두에 행을 만들지 않으며, 진단 복사 JSON에서 사용자 제외와 다른 사유·개수로만 집계된다. 강제 연결·복구 컨트롤은 없다.**
- [ ] **[필수][EXT-01E] 외부 provider/source 선택기는 이름·label에 `model`이 포함되어도 CMR 모델 target, 고급 관리 행 또는 진단 `targetCount`에 포함되지 않는다. CMR option이 추가되지 않고 native provider option·현재 값은 유지되며, 실제 모델 control만 등록 모델을 받는다.**
- [ ] **[조건부][EXT-02] native 중복 제외 CMR 후보가 512개 이하인 표준 Chat Completion `select`에는 그 후보 전체가 제공업체별 그룹으로 표시되고 native option과 현재 값은 유지된다.**
- [ ] **[조건부][EXT-03] native 중복 제외 CMR 후보가 512개 이하인 텍스트 `input` 또는 `datalist` 기반 외부 모델 컨트롤에는 그 후보 전체가 나타나며 기존 입력값과 기존 datalist option은 유지된다.**
- [ ] **[필수][EXT-04] 제공업체 선택기가 없더라도 안전한 표준 Chat Completion 모델 컨트롤에는 native 중복 제외 등록 모델이 target별 최대 512개까지 표시된다. 모델 컨트롤인지 안전하게 판별할 수 없는 대상은 원래 값과 option을 유지한다.**
- [ ] **[조건부][EXT-05] 외부 schema v1과 v0.6.0~v0.6.5의 provider·`manual`·`disabled` mapping은 제거되고, 과거 `disabled`는 schema v2 사용자 제외로 되살아나지 않는다. 이전에 연결 안 함이었던 안전한 대상에도 CMR 선택지가 자동 표시된다.**
- [ ] **[조건부][EXT-06] mapping 제거 뒤에도 같은 target과 provider의 마지막 CMR 모델 선택 기록은 보존된다.**
- [ ] **[조건부][EXT-06A] 제거된 확장의 stale 외부 선택 512개로 저장이 포화된 상태에서 현재 감지 target의 CMR 모델을 선택하면, 감지되지 않은 가장 오래된 target 기록 하나만 교체되고 나머지 기존 선택은 보존된다.**
- [ ] **[조건부][EXT-06B] stale legacy mapping 512개와 별도 target의 선택 기록이 함께 있어도 mapping은 제거되고 정상 선택 기록은 우선 보존된다.**
- [ ] **[조건부][EXT-07] Caption의 Multimodal provider/model control에서 provider/source 선택기는 metadata·change/input 감시에만 사용되고, `Anthropic→claude`, `Google AI Studio→makersuite`, `Mistral→mistralai` 같은 provider metadata가 실제 model control의 CMR option에 올바르게 유지된다.**
- [ ] **[조건부][EXT-07A] 같은 외부 확장 영역에 provider/source 후보가 여러 개면 첫 후보를 임의로 실제 model control에 연결하지 않으며 모든 후보의 native option·현재 값이 유지된다.**
- [ ] **[필수][EXT-08] 외부 `select`에는 target별 512개 한도 안에서 주입된 provider 모델이 `제공업체 이름 · 사용자 모델` optgroup으로 구분되어 나타나며 같은 모델 ID도 provider별로 구분된다.**
- [ ] **[조건부][EXT-08A] Caption처럼 option `data-type`을 쓰는 확장에서 CMR option에 올바른 외부 provider 값이 유지된다.**
- [ ] **[필수][EXT-08B] 관리 팝업을 닫거나 페이지를 다시 열어도 대상별 모드 선택 없이 같은 안전한 외부 모델 칸에 CMR 선택지가 다시 한 번만 나타난다.**
- [ ] **[조건부][EXT-09] 외부 확장에서 CMR 모델을 선택하면 그 확장의 기존 `input` 또는 `change` 저장 동작이 실행되고, 기능을 다시 열어도 선택이 남는다.**
- [ ] **[조건부][EXT-10] 외부 확장 기능을 한 번 실행하고 Network 요청 JSON의 `model`이 선택한 정확한 ID인지 확인한다. 인증 header와 전체 URL은 기록하지 않는다.**
- [ ] **[조건부][EXT-10A] Caption에서 CMR 모델을 선택해 이미지 설명을 한 번 실행하고, 실제 `/caption-image` Network 요청 JSON의 `model`이 선택한 정확한 ID인지 확인한다. 모델이 목록에 보이는 것만으로 통과 처리하지 않는다.**
- [ ] **[조건부][EXT-11] 페이지 새로고침 뒤 DOM 표식이 같은 외부 target의 마지막 CMR 선택을 provider 식별자와 함께 복원한다. 새 control 값이 비어 있을 때만 선택을 복원하고 외부 확장이 둔 유효한 현재값은 덮어쓰지 않는다.**
- [ ] **[조건부][EXT-11A] 외부 확장 업데이트로 control ID·name·label 또는 상위 구조가 바뀌면 새 target으로 다시 감지되며, 안전한 표준 모델 컨트롤이면 별도 설정 없이 CMR 선택지가 자동 주입된다.**
- [ ] **[조건부][EXT-11B] 같은 외부 확장 영역에 ID 없이 name·label이 같은 모델 칸 두 개가 있어도 live DOM 객체 또는 안정된 상위 구조 표식이 유지되면 각각 다른 CMR 모델을 선택할 수 있고, 재정렬 뒤에도 두 선택이 서로 바뀌거나 합쳐지지 않는다.**
- [ ] **[조건부][EXT-11C] 동일한 ID·name·label·구조의 모델 칸을 외부 확장이 모두 새 객체로 교체하면서 순서까지 뒤집는 경우에는 이전 선택 대응을 보장할 안정 표식이 없음을 확인한다. 해당 확장에는 고유 ID·name·label 또는 안정된 구조 표식이 필요하다.**
- [ ] **[조건부][EXT-12] 외부 확장의 새로고침 버튼 또는 설정 전환으로 모델 `select`가 다시 렌더링되어도 CMR option이 한 번만 복원된다.**
- [ ] **[조건부][EXT-12A] CMR 모델을 선택한 외부 `select`가 disabled·비대상 상태로 바뀌면 화면과 외부 확장 저장 상태가 같은 native fallback으로 전환된다. readonly input은 현재 값과 기존 datalist를 보존한 채 CMR 제안만 정리하며, DOM에서 이미 제거된 이전 control에는 불필요한 이벤트가 발생하지 않는다.**
- [ ] **[필수][EXT-13] Vectors·embedding·rerank 모델 컨트롤이 자동 주입 대상에 포함되지 않는다.**
- [ ] **[필수][EXT-14] TTS·voice·speech 모델 컨트롤이 자동 주입 대상에 포함되지 않는다.**
- [ ] **[필수][EXT-15] Stable Diffusion·이미지 생성 모델 컨트롤이 자동 주입 대상에 포함되지 않는다.**
- [ ] **[권장][EXT-16] provider/source 선택기를 제외한 진단 결과가 `후보 = 연결 정책 + 사용자 제외 + 비채팅·비호환 제외`로 일치하고, 연결 정책은 다시 `연결됨 + 등록 모델 없음 + 연결 실패`로 나뉘며 실제 외부 모델 컨트롤과 맞는다.**
- [ ] **[조건부][EXT-16A] 각 안전한 direct target에서 native option과 중복되는 항목을 제외한 표시 가능 CMR 후보가 512개를 넘을 때만 해당 모델 칸의 일부 선택지만 표시된다는 용량 경고가 나타난다. 활성 Registry 모델 총수가 512개를 넘더라도 target별 후보가 512개 이하이면 이 경고는 나타나지 않는다.**
- [ ] **[조건부][EXT-16B] 모든 direct target의 예상 CMR DOM option 합계 또는 실제 CMR DOM option 합계가 2,048개를 넘으면 성능 주의 카드와 진단 경고가 나타나고, Vectors·Stable Diffusion 같은 위험 대상과 native option은 이 CMR option 합계에 포함되지 않는다.**
- [ ] **[필수][EXT-17] 외부 브리지 동작 전후 메인 Chat Completion source·모델·API 키·endpoint가 바뀌지 않는다.**
- [ ] **[선택][EXT-18] React 자체 위젯, iframe, 닫힌 Shadow DOM과 모델 control 없는 확장은 대상 목록에도 나타나지 않으며 전용 opt-in API 연동이 필요하다는 안내를 확인한다.**

CMR 외부 브리지는 best-effort UI 선택지 주입 기능이며 전역 `fetch`나 `XMLHttpRequest`를 monkey patch하지 않습니다. `선택지 연결됨`과 실제 요청 반영은 별도 항목이며, `EXT-10`과 Caption 전용 `EXT-10A`에서 반드시 구분해 확인합니다. 저장소의 DOM 샌드박스는 option과 이벤트 전달을, Playwright UI 회귀 검사는 실제 설정 마크업과 SillyTavern CSS의 배치·상호작용을 확인합니다. 어느 검사도 실제 `/caption-image` 요청을 대신하지 않습니다.

## 5. 실제 제공업체 요청

아래 공통 절차를 사용할 수 있는 계정마다 반복합니다.

1. 확장 설치 전 해당 연결의 기본 모델 요청 성공을 확인합니다.
2. 코어 목록에 없는 정확한 공식 모델 ID를 등록한 뒤 SillyTavern native 모델 선택기 또는 입력란에서 선택합니다.
3. 일반 요청과 스트리밍 요청을 보냅니다.
4. 가능하면 브라우저 Network의 요청 payload에서 `model`을 확인하되 인증 헤더와 URL은 가립니다.
5. 오류가 나면 제공업체 오류가 그대로 표시되고 다른 모델로 조용히 바뀌지 않는지 확인합니다.
6. API 키·endpoint 모드·리전·project/account·provider filter가 전후 동일한지 확인합니다.

- [ ] **[조건부][REQ-OAI-01] OpenAI 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-ANTH-01] Anthropic 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-AI21-01] AI21 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-COHERE-01] Cohere 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-DEEPSEEK-01] DeepSeek 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-GAI-01] Google AI Studio 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-VERTEX-EXP-01] Vertex Express 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-VERTEX-FULL-01] Vertex Full 연결에서 project·region을 바꾸지 않고 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-GROQ-01] Groq 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-MISTRAL-01] Mistral AI 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-MINIMAX-01] MiniMax 연결에서 선택한 Global/China endpoint를 바꾸지 않고 통과한다.**
- [ ] **[조건부][REQ-MOONSHOT-01] Moonshot AI (Kimi) 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-PERPLEXITY-01] Perplexity 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-XAI-01] xAI 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-ZAI-01] Z.AI (GLM) Common 연결에서 GLM 모델로 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-ZAI-02] Z.AI (GLM) Coding 연결에서 endpoint 모드를 바꾸지 않고 통과한다.**
- [ ] **[조건부][REQ-AIML-01] AI/ML API 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-CHUTES-01] Chutes 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-WORKERS-01] Cloudflare Workers AI 연결에서 Account ID를 바꾸지 않고 통과한다.**
- [ ] **[조건부][REQ-EHUB-01] ElectronHub 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-FIREWORKS-01] Fireworks AI 연결에서 계층형 ID로 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-NANO-01] NanoGPT 연결에서 기존 provider pin을 바꾸지 않고 통과한다.**
- [ ] **[조건부][REQ-OPENROUTER-01] OpenRouter 연결에서 기존 provider filter를 바꾸지 않고 통과한다.**
- [ ] **[조건부][REQ-POLLINATIONS-01] Pollinations 연결에서 공통 요청 절차를 통과한다.**
- [ ] **[조건부][REQ-SILICON-01] SiliconFlow 연결에서 선택한 Global/China endpoint를 바꾸지 않고 통과한다.**
- [ ] **[조건부][REQ-CUSTOM-01] Custom OpenAI-compatible 연결에서 endpoint·key를 바꾸지 않고 수동 모델 ID 요청을 통과한다.**
- [ ] **[필수][SPEC-AZURE-01] Azure OpenAI가 등록 대상에 없고 deployment name으로 라우팅된다는 설명을 확인한다.**
- [ ] **[필수][SPEC-COMET-01] CometAPI가 지원 24개 목록에 없고 ST 1.18.0 코어 비활성으로 문서화되었는지 확인한다.**

## 6. 공개 Registry API 1.2.0과 Provider Integration API 1.0.0

브라우저 콘솔을 사용할 수 있을 때 확인합니다.

- [ ] **[선택][API-01] `CustomModelRouter.apiVersion`이 `1.2.0`이고 `isCompatible('1.2.0')`과 하위 호환 `isCompatible('1.1.0')`이 true다.**
- [ ] **[선택][API-02] `getProviders()`가 비밀정보 없이 provider metadata만 반환한다.**
- [ ] **[선택][API-03] `getSnapshot()`과 `listModels()` 반환 객체를 수정할 수 없고 내부 설정도 바뀌지 않는다.**
- [ ] **[선택][API-04] 같은 model ID를 두 provider에 등록해도 `createModelKey()` 결과가 다르다.**
- [ ] **[선택][API-05] `subscribe()`가 등록·선택·삭제 이벤트를 revision 순서로 받고 해제 뒤에는 받지 않는다.**
- [ ] **[선택][API-06] `selectModel()`이 Registry 상태만 바꾸고 현재 메인 source·selector·모델은 바꾸지 않는다.**
- [ ] **[선택][API-07] SillyTavern `select`에서 현재 사용 중인 custom-only 모델을 `unregisterModel()`로 지우면 `model_in_use`로 거부되고, native 모델로 전환한 뒤에는 등록 해제된다.**
- [ ] **[선택][INT-01] `CustomModelRouter.integrations.apiVersion`이 `1.0.0`이고 공개 capability에 선택된 Connection Profile 전용, Connection Manager 소유 자격 증명, 메인 채팅 무변경과 handler-before-models 계약이 표시된다.**
- [ ] **[필수][INT-02] Provider Integration hook을 등록하지 않은 외부 확장의 provider UI에는 CMR provider·model이 강제로 추가되지 않는다. 같은 확장의 안전한 표준 모델 컨트롤은 기존 DOM 브리지 대상이면 종전처럼 모델 선택지만 받을 수 있다.**
- [ ] **[조건부][INT-03] 공개 hook 소비 확장이 `installHandler`와 `publishModels`를 등록하면 handler 설치 영수증을 반환하기 전에는 모델 게시가 호출되지 않고, 두 영수증이 모두 유효한 뒤에만 binding과 provider UI가 준비 상태가 된다.**
- [ ] **[조건부][INT-04] 비-Custom Chat Completion Connection Profile을 선택하면 `sillytavern-inherited` slot에는 그 profile source와 같은 provider의 활성 Registry 모델만 게시되고 실제 요청은 선택된 profile을 사용한다.**
- [ ] **[조건부][INT-05] `Custom` Connection Profile을 선택하면 `openai-compatible` slot에 `custom` Registry 모델만 게시되고 그 프로필의 endpoint·API 키를 CMR에 다시 입력하거나 복제하지 않는다.**
- [ ] **[조건부][INT-06] 선택된 Connection Profile을 다른 source로 바꾸거나 선택 해제하면 이전 handler·모델 게시·진행 중 요청이 정리되고 새 조건이 충족될 때만 새 binding이 준비된다.**
- [ ] **[조건부][INT-07] handler 설치 또는 모델 게시가 거부·예외·취소되면 provider UI가 준비 상태로 노출되지 않고 다른 provider·등록 모델·메인 모델로 자동 대체되지 않는다.**
- [ ] **[조건부][INT-08] 공용 handler 요청 전후 메인 Chat Completion source·모델이 같고, CMR 설정·이벤트·진단에는 Connection Profile ID·API 키·전체 endpoint가 나타나지 않는다.**
- [ ] **[조건부][INT-09] hook 소유 provider UI 루트가 `data-cmr-provider-hook-owned`로 표시되어 기존 DOM 모델 브리지가 같은 모델을 중복 주입하지 않는다.**

## 7. 용도별 Routing API 1.0.0

- [ ] **[필수][ROUTE-UI-01] 관리 팝업에 용도별 route 등록·해제·시험 컨트롤이 없다.**

아래 API 항목은 일반 사용자가 `해당 없음`으로 표시할 수 있습니다. 다른 확장 또는 개발자가 공개 API를 명시적으로 사용할 때만 확인합니다.

- [ ] **[선택][ROUTE-API-01] `CustomModelRouter.routing.apiVersion`이 `1.0.0`이다.**
- [ ] **[조건부][ROUTE-01] API 시험에 사용할 제공업체의 사용자 모델과 Connection Profile ID를 준비한다.**
- [ ] **[조건부][ROUTE-02] `routing.setRoute()`로 provider·model ID·adapter ID·같은 제공업체 profile ID를 저장한다.**
- [ ] **[조건부][ROUTE-03] `routing.getRoute()`와 새로고침 뒤 조회에서 실제 provider·model ID·profile ID가 그대로 유지된다.**
- [ ] **[조건부][ROUTE-04] `routing.execute()`가 지정 모델로 성공하고 호출 확장이 결과를 받는다.**
- [ ] **[조건부][ROUTE-05] route 실행 전후 메인 Chat Completion source와 모델이 동일하다.**
- [ ] **[조건부][ROUTE-06] 다른 provider의 profile로 실행하면 명확한 불일치 오류가 난다.**
- [ ] **[조건부][ROUTE-07] route가 참조하는 모델을 삭제하거나 profile을 비활성화하면 실행이 명확히 실패한다.**
- [ ] **[조건부][ROUTE-08] 실패 시 다른 route·등록 모델·메인 모델로 자동 대체되지 않는다.**
- [ ] **[조건부][ROUTE-09] `routing.removeRoute()`는 해당 용도만 삭제하고 Registry 모델은 남긴다.**
- [ ] **[선택][ROUTE-API-02] 외부 adapter 등록·해제 뒤 목록과 실행 가능 상태가 정확히 바뀐다.**

## 8. 호환성 진단

- [ ] **[필수][DIAG-01] 호환성 진단 및 CMR 설정 백업 섹션에서 `진단 실행`을 누른다.**
- [ ] **[필수][DIAG-01A] `진단 복사` JSON의 `schemaVersion`이 `2`이고 `status`·`summary`·`counts`가 `checks`의 상태 합계와 일치한다.**
- [ ] **[필수][DIAG-02] SillyTavern 1.18.0이면 버전 계약이 통과로 표시된다.**
- [ ] **[필수][DIAG-03] 현재 화면의 공개 context·event·provider control 결과에 설명 없는 실패가 없다.**
- [ ] **[필수][DIAG-04] 런처·observer·listener·사용자 모델 그룹 중복이 없다고 표시된다. 서로 다른 모델 선택기에 같은 제공업체 그룹이 하나씩 있는 것은 중복으로 오인하지 않는다.**
- [ ] **[필수][DIAG-04A] 복사 JSON에서 외부 브리지 observer·listener·target 수, 활성 Registry 모델 수, 예상·실제 CMR option 수와 연결 정책·사용자 제외·비채팅·비호환 제외 수를 확인하고 설명 없는 증가가 없다. provider/source 선택기는 모델 `targetCount`에 포함되지 않는다.**
- [ ] **[필수][DIAG-04B] provider/source 선택기를 제외한 외부 모델 칸 집계가 `후보 = 연결 정책 + 사용자 제외 + 비채팅·비호환 제외` 및 `연결 정책 = 연결됨 + 등록 모델 없음 + 연결 실패`로 일치하며 observer·listener·binding 불일치가 통과로 표시되지 않는다.**
- [ ] **[조건부][DIAG-04C] 공개 provider hook 소비 확장이 있으면 `providerIntegrations`의 consumer·pending·ready·failed·published model 개수가 실제 binding 상태와 일치하고 profile ID·endpoint·API 키는 포함하지 않는다.**
- [ ] **[필수][DIAG-05] 경고가 있다면 `진단 복사` JSON의 check ID·코드와 사유를 결과 메모에 기록한다. 화면 목록에 별도 코드가 보이지 않으면 복사 JSON을 기준으로 한다.**
- [ ] **[필수][DIAG-06] `진단 복사` 결과를 텍스트 편집기에서 열어 API 키·endpoint·project/account ID·Service Account가 없는지 확인한다.**
- [ ] **[권장][DIAG-07] 1.18.0보다 새 버전에서는 미검증 경고가 표시되고 확장이 무조건 호환이라고 단정하지 않는다.**
- [ ] **[필수][DIAG-08] source·profile 전환 표본이 0개 또는 1개이면 장시간 계측이 오류·주의가 아닌 `pending` 미실시로 표시되고 전체 진단 합계를 올리지 않는다.**
- [ ] **[필수][DIAG-09] source 또는 profile을 바꾼 직후 `진단 복사`를 누르면 이전 JSON이 아니라 현재 source·표본·외부 대상 개수가 반영된다.**
- [ ] **[조건부][DIAG-10] 복사 JSON의 `repair`와 `settings-repair` check에서 손실 없는 `settings_migrated`는 `notices`, `invalid_records_removed`는 `warnings`, 미래 스키마 거부는 `errors`로 분리된다. `details.items`의 사유 코드·`action`·안전한 경로 범주·개수를 `beforeCounts`·`afterCounts`와 비교해 어떤 모델·선택·route 레코드를 왜 제거·병합·정규화했는지 구체적으로 알 수 있다.**
- [ ] **[필수][DIAG-10A] 복구 상세에는 원래 모델 ID·외부 target ID·Connection Profile ID·임의 저장값과 비밀정보가 복제되지 않는다.**
- [ ] **[조건부][DIAG-11] 복구 주의 또는 오류 뒤 정상 `SETTINGS_UPDATED`가 발생해도 마지막 의미 있는 `repair` 코드가 다음 진단 복사에 남고, 원래 저장 객체의 임의 필드·값은 복사되지 않는다.**

## 9. 반복 전환 안정성

- [ ] **[권장][STAB-00] 첫 진단 JSON을 기준값으로 저장한다. `activeSampleCount` 0·1은 미실시이며 2개 이상부터 판정된다는 점을 확인한다.**
- [ ] **[권장][STAB-01] source를 두 제공업체 사이에서 20회 왕복한 뒤 진단을 다시 실행한다.**
- [ ] **[권장][STAB-02] Connection Profile A/B를 20회 왕복한 뒤 진단을 다시 실행한다.**
- [ ] **[권장][STAB-03] 동적 모델 목록을 사용하는 source에서 연결·목록 갱신을 10회 반복한다.**
- [ ] **[필수][STAB-04] 반복 뒤 관리 아이콘·팝업·각 provider의 CMR 그룹이 하나씩만 존재한다.**
- [ ] **[필수][STAB-05] 반복 뒤 선택 이벤트가 한 번의 클릭에 한 번만 발생하고 화면이 멈추지 않는다.**
- [ ] **[권장][STAB-06] 진단의 observer·listener·binding·group 개수가 최초 기준보다 계속 증가하지 않는다.**
- [ ] **[권장][STAB-07] 외부 확장 provider 전환과 모델 목록 재렌더를 20회 반복해도 provider/source 선택기의 native option·값은 유지되고 실제 model control의 CMR group·option·listener가 중복되지 않는다.**

## 10. 확장 전용 백업·복구

- [ ] **[필수][BKP-01] `백업 내보내기`로 `custom-model-router-backup-v0.6.14.json`을 저장한다. 최대 허용 범위인 UTF-8 8,000,000바이트·모델 5,000개·route 256개 안에서 성공한 백업은 다시 가져올 수 있다.**
- [ ] **[필수][BKP-02] JSON 최상위에 `format`, `schemaVersion`, `createdAt`, `registry`, `purposeRoutes`, `externalIntegrations`만 있고 portable schemaVersion이 `2`인지 확인한다.**
- [ ] **[필수][BKP-03] Registry에는 provider·model ID·protocol·enabled·선택 상태만 있는지 확인한다.**
- [ ] **[필수][BKP-04] route에는 provider·model ID·adapter ID·Connection Profile ID만 있는지 확인한다.**
- [ ] **[필수][BKP-04A] `externalIntegrations.schemaVersion`이 `2`이고 빈 `mappings`, target별 마지막 CMR model·provider 식별자인 `selectedModels`, 사용자가 명시적으로 제외한 target만 `true`인 `excludedTargets`가 있는지 확인한다. 대상별 mode나 provider 고정 mapping은 없어야 한다.**
- [ ] **[필수][BKP-05] 백업에 API 키·endpoint·리전·project/account ID·Service Account·profile 본문이 없는지 확인한다.**
- [ ] **[필수][BKP-06] 모델·선택·route·외부 설정을 변경한 뒤 원본 백업을 가져오면 즉시 적용되지 않고 추가·충돌·삭제 개수와 안전한 변경 설명이 미리보기에 나타난다. `취소`를 누르면 아무 설정도 바뀌지 않는다.**
- [ ] **[필수][BKP-06A] 현재 설정과 같은 백업의 미리보기는 변경 없음으로 표시되고 `변경 적용` 버튼이 비활성화된다.**
- [ ] **[필수][BKP-06B] 현재 사용 중인 select형 custom-only 모델을 삭제하게 되는 백업은 `model_in_use` 사유를 표시하고 `변경 적용`을 허용하지 않는다.**
- [ ] **[조건부][BKP-06C] 미리보기를 연 뒤 다른 창이나 공개 API로 설정을 바꾸면 오래된 미리보기 적용을 중단하고 새 변경 내역을 다시 확인하도록 안내한다.**
- [ ] **[필수][BKP-07] 원본 백업의 미리보기에서 `변경 적용`을 누르면 표시된 추가·충돌·삭제와 일치하게 Registry·개발자 route, 외부 target별 provider 모델 선택과 schema v2 사용자 제외가 내보내기 당시 상태로 복원된다.**
- [ ] **[필수][BKP-08] 가져오기 전후 API key·endpoint·리전과 profile 내용이 바뀌지 않는다.**
- [ ] **[권장][BKP-09] 잘못된 JSON 파일을 가져오면 명확히 거부되고 현재 설정은 유지된다.**
- [ ] **[권장][BKP-10] 복사본에 알 수 없는 최상위 필드를 추가하면 거부되고 현재 설정은 유지된다.**
- [ ] **[권장][BKP-11] 복사본의 schemaVersion을 미래 값으로 올리면 업데이트 안내와 함께 거부된다.**
- [ ] **[조건부][BKP-12] 존재하지 않는 profile ID를 참조하는 정상 route 백업은 보존되지만 실행 시 profile 오류가 난다.**
- [ ] **[조건부][BKP-13] v0.5.0에서 만든 portable schema v1 백업을 가져오면 Registry·route가 보존되고 빈 externalIntegrations를 가진 schema v2 상태로 이관된다.**
- [ ] **[권장][BKP-14] 외부 연결 schema를 미래 값으로 올리거나 위험한 target key를 넣은 백업은 기존 설정 무변경 상태로 거부된다.**
- [ ] **[조건부][BKP-15] 외부 schema v1 또는 v0.6.0~v0.6.5 백업의 provider·`manual`·`disabled` mapping은 가져오기 뒤 제거되고 정상 `selectedModels`는 보존된다. 과거 `disabled`와 schema v1의 임의 제외 필드는 v2 `excludedTargets`로 변환되지 않는다.**

## 11. 비활성화·재활성화·보안

- [ ] **[필수][LIFE-01] 확장을 비활성화하면 런처·팝업·CMR optgroup과 `globalThis.CustomModelRouter`가 제거된다.**
- [ ] **[필수][LIFE-01A] 비활성화하면 다른 확장의 CMR group/option과 외부 observer/listener가 제거되고 native option·기존 input 값·기존 datalist 연결은 보존된다. 제거된 CMR option을 선택 중이던 `select`는 브라우저 또는 외부 확장의 native 기본값으로 전환될 수 있다.**
- [ ] **[조건부][LIFE-01B] 공개 provider hook 소비 확장이 있으면 비활성화 시 게시 모델을 먼저, 요청 handler를 다음으로 한 번씩 정리하고 진행 중 실행을 중단하며 hookless 확장 UI는 건드리지 않는다.**
- [ ] **[필수][LIFE-02] select형 현재 사용자 모델은 가능한 기본 모델로 안전하게 전환되고 인증 설정은 유지된다.**
- [ ] **[조건부][LIFE-03] Custom 자유 입력값과 endpoint는 비활성화해도 삭제되지 않는다.**
- [ ] **[필수][LIFE-04] 다시 활성화하면 UI와 API가 하나씩만 생성되고 등록 설정이 복원된다.**
- [ ] **[필수][LIFE-04A] 다시 활성화하면 사용자 제외가 아닌 안전한 외부 target에 CMR option이 한 번만 나타난다. schema v2 사용자 제외는 유지되고, 동일 target의 control 값이 비어 있을 때만 저장 선택을 복원하며 유효한 외부 현재값은 유지한다.**
- [ ] **[권장][LIFE-05] 활성화·비활성화를 5회 반복해도 이벤트 중복, 잔여 dialog 또는 콘솔 오류가 없다.**
- [ ] **[필수][SEC-01] 확장 설정과 백업에 API 키·Service Account·전체 endpoint가 저장되지 않는다.**
- [ ] **[필수][SEC-02] 진단 결과와 오류 메시지에 사용자가 입력한 비밀값 자체가 노출되지 않는다.**
- [ ] **[필수][SEC-03] HTML처럼 보이는 모델 ID가 거부되고 등록 모델 표시는 실행되지 않는 일반 텍스트다.**
- [ ] **[필수][SEC-04] Azure OpenAI deployment와 CometAPI를 지원한다고 잘못 표시하지 않는다.**
- [ ] **[필수][SEC-05] Provider Integration API의 공개 provider·model descriptor, 이벤트와 진단에는 Connection Profile ID·API 키·전체 endpoint가 없고 임의 endpoint override 요청은 허용되지 않는다.**

## 결과 보고 양식

```text
제목: [v0.6.14][제공업체 또는 기능][항목 ID] 짧은 증상

SillyTavern 버전:
Custom Model Router 버전: v0.6.14
OS / 브라우저:
신규 설치 또는 업데이트:
이전 CMR 버전:
제공업체 / source:
endpoint 모드 이름(비밀 URL 제외):
모델 ID:
Connection Profile 사용 여부와 비밀이 아닌 이름:
Provider Integration hook/slot/strategy 사용 여부:
일반 / 스트리밍:
실패 항목 ID:
기대 결과:
실제 결과:
재현 순서:
source/Profile 반복 횟수:
진단 상태·경고 코드:
백업 가져오기 결과:
외부 target 선택지 주입/사용자 제외/비채팅·비호환 제외 상태:
외부 provider/source 선택기 native option·값 보존 상태:
고급 목록의 확장 이름과 control 이름:
외부 control 종류(select/input/datalist/기타):
Network payload의 model 확인 결과:
Caption /caption-image payload의 model 확인 결과:
민감정보를 제거한 오류 메시지:
민감정보를 제거한 스크린샷:
```

실패 항목이 있어도 데이터 손실·무한 반복·비밀 노출이 아니라면 나머지 독립 항목은 계속 확인해도 됩니다. 결과를 모으면 같은 v0.6 범위의 후속 수정은 `v0.6.15`, `v0.6.16`, ...로 반영합니다.
