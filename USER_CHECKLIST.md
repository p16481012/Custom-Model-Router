# v0.6.2 통합 사용자 검증 체크리스트

대상 버전: **v0.6.2**

이 문서는 v0.1~v0.6 기능을 한 번에 확인하는 최종 수동 검증 순서입니다. 위에서 아래로 진행하고, 사용하지 않는 제공업체·외부 확장·개발자 API 항목은 `해당 없음`으로 표시하세요.

## 판정 기준

- **필수**: 모든 사용자가 확인합니다.
- **조건부**: 해당 계정·프로필·기능을 사용하는 경우 확인합니다.
- **권장**: 안정성 판단에 도움이 되므로 가능하면 확인합니다.
- **선택**: 개발자 도구나 특수 환경이 있을 때 확인합니다.

각 항목에는 `통과 / 실패 / 해당 없음`과 짧은 메모를 남깁니다. API 키, Service Account, 전체 endpoint URL, project/account ID와 Connection Profile 본문은 스크린샷·로그·이슈에 포함하지 마세요.

데이터 손실, 인증 설정 변경, 반복 요청, 브라우저 멈춤 또는 비밀정보 노출이 보이면 즉시 검증을 중단하고 `치명`으로 기록하세요.

## 0. 환경 기록과 사전 준비

```text
검증 날짜:
SillyTavern 버전:
Custom Model Router 버전: v0.6.2
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

- [ ] **[필수][MIG-01] API Connections 도구행에 사용자 모델 관리 아이콘이 정확히 하나 표시된다.**
- [ ] **[필수][MIG-02] 관리 팝업에 `v0.6.2` 배지가 표시된다.**
- [ ] **[필수][MIG-03] Extensions 설정 영역에 이전의 큰 CMR inline 패널이 남지 않는다.**
- [ ] **[조건부][MIG-04] v0.1.x의 Vertex 등록 모델이 Google Vertex AI 목록에 보존된다.**
- [ ] **[조건부][MIG-05] v0.2.x의 여러 제공업체 등록 모델과 선택 상태가 모두 보존된다.**
- [ ] **[조건부][MIG-06] v0.4.0의 용도별 route가 같은 모델과 profile ID를 가리킨다.**
- [ ] **[조건부][MIG-06A] v0.5.0에서 업데이트했다면 Registry와 route가 보존되고 외부 연결 설정은 빈 상태로 안전하게 시작한다.**
- [ ] **[필수][MIG-07] 새로고침을 두 번 반복해도 런처·팝업·사용자 모델 그룹이 중복되지 않는다.**
- [ ] **[필수][MIG-08] 브라우저 콘솔에 처리되지 않은 CMR 초기화 오류가 없다.**

## 2. 팝업 UI·접근성·대량 목록

- [ ] **[필수][UI-01] 관리 아이콘을 누르면 팝업 하나가 열리고 아이콘의 펼침 상태가 갱신된다.**
- [ ] **[필수][UI-02] 닫기 버튼과 `Escape`가 각각 팝업을 닫는다.**
- [ ] **[필수][UI-03] 팝업을 닫으면 키보드 초점이 관리 아이콘으로 돌아온다.**
- [ ] **[필수][UI-04] 제공업체 선택기에 지원 연결 24개가 그룹별로 표시된다.**
- [ ] **[필수][UI-05] 제공업체를 바꾸면 설명·ID 규칙·호환 상태·목록이 해당 업체 값으로 바뀐다.**
- [ ] **[필수][UI-06] 한 업체의 모델은 다른 업체의 목록에 섞이지 않는다.**
- [ ] **[필수][UI-07] 등록 모델 수 배지와 `이 제공업체 N개 · 전체 M개`가 실제 개수와 일치한다.**
- [ ] **[권장][UI-08] 모델 20개 이상에서 목록만 제한 높이 안에서 스크롤되고 팝업 전체가 끝없이 길어지지 않는다.**
- [ ] **[권장][UI-09] 긴 계층형 모델 ID가 행 밖으로 넘치거나 버튼을 가리지 않는다.**
- [ ] **[권장][UI-10] 좁은 창 또는 모바일 폭에서 입력·버튼·route·진단 섹션을 사용할 수 있다.**
- [ ] **[필수][UI-11] Tab 키만으로 제공업체, 입력, 추가, 모델 행, route, 진단과 닫기 컨트롤에 접근한다.**
- [ ] **[필수][UI-12] 현재 source가 아닌 제공업체의 모델 적용 버튼은 비활성 또는 명확한 안내를 보인다.**

## 3. 모델 등록·적용·삭제 공통 경로

- [ ] **[필수][REG-01] 정확한 새 모델 ID를 등록하면 성공 메시지와 목록 행이 나타난다.**
- [ ] **[필수][REG-02] 같은 제공업체에 같은 ID를 다시 등록하면 중복 오류가 나타난다.**
- [ ] **[필수][REG-03] 같은 ID를 다른 제공업체에 등록하면 서로 독립된 레코드로 저장된다.**
- [ ] **[필수][REG-04] URL, 공백, 개행, `?`, `#`, `%`가 포함된 잘못된 입력을 거부한다.**
- [ ] **[조건부][REG-05] OpenRouter·Workers AI·Fireworks 등에서 `/`, `:`, `@`가 들어간 공식 계층형 ID를 등록한다.**
- [ ] **[필수][REG-06] 목록의 선택 버튼으로 적용하면 기본 selector 또는 Custom 입력값도 정확한 ID가 된다.**
- [ ] **[필수][REG-07] 기본 selector의 CMR 그룹에서 직접 모델을 선택하면 팝업의 선택 상태도 갱신된다.**
- [ ] **[필수][REG-08] 새로고침 뒤 등록 목록과 마지막 사용자 선택이 복원된다.**
- [ ] **[필수][REG-09] source를 다른 업체로 왕복해도 각 제공업체 선택이 섞이지 않는다.**
- [ ] **[조건부][REG-10] 원격 모델 목록 새로고침 뒤 CMR 그룹과 선택이 한 번만 복원된다.**
- [ ] **[필수][REG-11] 현재 사용 중인 select형 사용자 모델 삭제가 거부되고 기본 모델 전환 뒤 삭제된다.**
- [ ] **[조건부][REG-12] Custom 등록 삭제는 Registry 행만 지우고 현재 Custom model·endpoint는 지우지 않는다.**

## 4. 다른 확장 모델 연결

먼저 CMR Registry에 외부 확장에서 시험할 제공업체의 사용자 모델을 하나 등록합니다. 관리 팝업의 **다른 확장 모델 연결**을 열고, 실제로 사용하는 외부 확장의 Chat Completion 모델 컨트롤을 확인합니다.

- [ ] **[조건부][EXT-01] 표준 Chat Completion `select`를 가진 외부 확장이 자동 감지되고, 제공업체가 확실하면 `자동` 상태로 표시된다.**
- [ ] **[조건부][EXT-02] 자동 연결된 `select`에 같은 제공업체의 CMR 모델만 별도 그룹으로 표시되고 native option과 현재 값은 유지된다.**
- [ ] **[조건부][EXT-03] 텍스트 `input` 또는 `datalist` 기반 외부 모델 컨트롤에서 CMR 모델 제안이 나타나며 기존 입력값과 기존 datalist option은 유지된다.**
- [ ] **[필수][EXT-04] 제공업체를 확정하지 못한 모호한 모델 컨트롤은 `확인 필요`로 표시되고 CMR 옵션을 임의로 주입하지 않는다.**
- [ ] **[조건부][EXT-05] `확인 필요` 대상에서 제공업체를 수동 연결하면 해당 provider의 모델만 나타나고 자동 추론보다 수동 mapping이 우선한다.**
- [ ] **[조건부][EXT-06] 수동 연결 → 사용 안 함 → 자동으로 되돌리기 순서로 전환하면 CMR 옵션이 제거됐다가 안전한 자동 판별 상태로 돌아오며 mapping 상태가 각각 정확히 표시된다.**
- [ ] **[조건부][EXT-07] Caption의 Multimodal provider/model control이 감지되며 `Anthropic→claude`, `Google AI Studio→makersuite`, `Mistral→mistralai` 같은 provider alias가 올바른 Registry와 연결된다.**
- [ ] **[조건부][EXT-08] Caption처럼 option `data-type`을 쓰는 확장에서 CMR option에도 외부 provider 값이 유지되고 다른 provider로 전환했을 때 잘못된 모델이 섞이지 않는다.**
- [ ] **[조건부][EXT-09] 외부 확장에서 CMR 모델을 선택하면 그 확장의 기존 `input` 또는 `change` 저장 동작이 실행되고, 기능을 다시 열어도 선택이 남는다.**
- [ ] **[조건부][EXT-10] 외부 확장 기능을 한 번 실행하고 Network 요청 JSON의 `model`이 선택한 정확한 ID인지 확인한다. 인증 header와 전체 URL은 기록하지 않는다.**
- [ ] **[조건부][EXT-10A] Caption에서 CMR 모델을 선택해 이미지 설명을 한 번 실행하고, 실제 `/caption-image` Network 요청 JSON의 `model`이 선택한 정확한 ID인지 확인한다. 모델이 목록에 보이는 것만으로 통과 처리하지 않는다.**
- [ ] **[조건부][EXT-11] 페이지 새로고침 뒤 DOM 표식이 같은 외부 target의 provider mapping이 복원된다. 새 control 값이 비어 있으면 provider별 마지막 CMR 선택도 복원되고, 외부 확장이 둔 유효한 현재값은 덮어쓰지 않는다.**
- [ ] **[조건부][EXT-11A] 외부 확장 업데이트로 control ID·name·label 또는 상위 구조가 바뀌어 새 target으로 표시되면 이전 mapping을 잘못 적용하지 않으며 필요한 provider를 다시 수동 연결한다.**
- [ ] **[조건부][EXT-12] 외부 확장의 새로고침 버튼 또는 설정 전환으로 모델 `select`가 다시 렌더링되어도 CMR option이 한 번만 복원된다. 새 control이 빈 값일 때만 저장된 CMR 선택을 복원하고 유효한 외부 현재값은 유지한다.**
- [ ] **[필수][EXT-13] Vectors·embedding·rerank 모델 컨트롤이 자동 연결되지 않는다.**
- [ ] **[필수][EXT-14] TTS·voice·speech 모델 컨트롤이 자동 연결되지 않는다.**
- [ ] **[필수][EXT-15] Stable Diffusion·이미지 생성 모델 컨트롤이 자동 연결되지 않는다.**
- [ ] **[권장][EXT-16] 관리 팝업과 진단의 감지·연결·자동·수동·확인 필요·제외 개수가 실제 화면과 일치한다.**
- [ ] **[필수][EXT-17] 외부 확장 연결 전후 메인 Chat Completion source·모델·API 키·endpoint가 바뀌지 않는다.**
- [ ] **[선택][EXT-18] React 자체 위젯, iframe, 닫힌 Shadow DOM 또는 모델 control 없는 확장이 자동 지원 대상으로 잘못 표시되지 않으며 전용 opt-in이 필요하다는 안내를 확인한다. 용도를 드러내지 않는 일반적인 비채팅 모델 control이 잘못 감지되면 사용 안 함으로 지정한다.**

CMR은 전역 `fetch`나 `XMLHttpRequest`를 monkey patch하지 않습니다. 모델이 목록에 보이는 것과 실제 요청 반영은 별도 항목이며, `EXT-10`과 Caption 전용 `EXT-10A`에서 반드시 구분해 확인합니다. 저장소의 브라우저 샌드박스는 DOM option과 이벤트 전달만 확인하며 실제 `/caption-image` 요청을 대신하지 않습니다.

## 5. 실제 제공업체 요청

아래 공통 절차를 사용할 수 있는 계정마다 반복합니다.

1. 확장 설치 전 해당 연결의 기본 모델 요청 성공을 확인합니다.
2. 코어 목록에 없는 정확한 공식 모델 ID를 등록·적용합니다.
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

## 6. 공개 Registry API 1.1.0

브라우저 콘솔을 사용할 수 있을 때 확인합니다.

- [ ] **[선택][API-01] `CustomModelRouter.apiVersion`이 `1.1.0`이고 `isCompatible('1.1.0')`이 true다.**
- [ ] **[선택][API-02] `getProviders()`가 비밀정보 없이 provider metadata만 반환한다.**
- [ ] **[선택][API-03] `getSnapshot()`과 `listModels()` 반환 객체를 수정할 수 없고 내부 설정도 바뀌지 않는다.**
- [ ] **[선택][API-04] 같은 model ID를 두 provider에 등록해도 `createModelKey()` 결과가 다르다.**
- [ ] **[선택][API-05] `subscribe()`가 등록·선택·삭제 이벤트를 revision 순서로 받고 해제 뒤에는 받지 않는다.**
- [ ] **[선택][API-06] `selectModel()`이 Registry 상태만 바꾸고 현재 메인 source·selector·모델은 바꾸지 않는다.**

## 7. 용도별 Routing API 1.0.0

- [ ] **[조건부][ROUTE-01] 시험할 제공업체의 사용자 모델과 Connection Profile을 준비한다.**
- [ ] **[조건부][ROUTE-02] 관리 팝업에서 용도·등록 모델·같은 제공업체 profile을 선택해 저장한다.**
- [ ] **[조건부][ROUTE-03] 저장 내용을 다시 열면 실제 provider·model ID·profile ID가 그대로 표시된다.**
- [ ] **[조건부][ROUTE-04] route 시험 요청이 지정 모델로 성공하고 결과가 표시된다.**
- [ ] **[조건부][ROUTE-05] route 시험 전후 메인 Chat Completion source와 모델이 동일하다.**
- [ ] **[조건부][ROUTE-06] 다른 provider의 profile로 저장하려 하면 명확한 불일치 오류가 난다.**
- [ ] **[조건부][ROUTE-07] route가 참조하는 모델을 삭제하거나 profile을 비활성화하면 실행이 명확히 실패한다.**
- [ ] **[조건부][ROUTE-08] 실패 시 다른 route·등록 모델·메인 모델로 자동 대체되지 않는다.**
- [ ] **[조건부][ROUTE-09] route 해제를 누르면 해당 용도만 삭제되고 Registry 모델은 남는다.**
- [ ] **[선택][ROUTE-API-01] `CustomModelRouter.routing.apiVersion`이 `1.0.0`이다.**
- [ ] **[선택][ROUTE-API-02] 외부 adapter 등록·해제 뒤 목록과 실행 가능 상태가 정확히 바뀐다.**

## 8. 호환성 진단

- [ ] **[필수][DIAG-01] 호환성 진단 및 설정 복구 섹션에서 `진단 실행`을 누른다.**
- [ ] **[필수][DIAG-02] SillyTavern 1.18.0이면 버전 계약이 통과로 표시된다.**
- [ ] **[필수][DIAG-03] 현재 화면의 공개 context·event·provider control 결과에 설명 없는 실패가 없다.**
- [ ] **[필수][DIAG-04] 런처·observer·listener·사용자 모델 그룹 중복이 없다고 표시된다.**
- [ ] **[필수][DIAG-04A] 외부 브리지 observer·listener·target 수와 자동/수동/확인 필요/제외 수가 표시되고 설명 없는 증가가 없다.**
- [ ] **[필수][DIAG-05] 경고가 있다면 코드와 사유를 결과 메모에 기록한다.**
- [ ] **[필수][DIAG-06] `진단 복사` 결과를 텍스트 편집기에서 열어 API 키·endpoint·project/account ID·Service Account가 없는지 확인한다.**
- [ ] **[권장][DIAG-07] 1.18.0보다 새 버전에서는 미검증 경고가 표시되고 확장이 무조건 호환이라고 단정하지 않는다.**

## 9. 반복 전환 안정성

- [ ] **[권장][STAB-01] source를 두 제공업체 사이에서 20회 왕복한 뒤 진단을 다시 실행한다.**
- [ ] **[권장][STAB-02] Connection Profile A/B를 20회 왕복한 뒤 진단을 다시 실행한다.**
- [ ] **[권장][STAB-03] 동적 모델 목록을 사용하는 source에서 연결·목록 갱신을 10회 반복한다.**
- [ ] **[필수][STAB-04] 반복 뒤 관리 아이콘·팝업·각 provider의 CMR 그룹이 하나씩만 존재한다.**
- [ ] **[필수][STAB-05] 반복 뒤 선택 이벤트가 한 번의 클릭에 한 번만 발생하고 화면이 멈추지 않는다.**
- [ ] **[권장][STAB-06] 진단의 observer·listener·binding·group 개수가 최초 기준보다 계속 증가하지 않는다.**
- [ ] **[권장][STAB-07] 외부 확장 provider 전환과 모델 목록 재렌더를 20회 반복해도 외부 CMR group·option·listener가 중복되지 않는다.**

## 10. 확장 전용 백업·복구

- [ ] **[필수][BKP-01] `백업 내보내기`로 `custom-model-router-backup-v0.6.2.json`을 저장한다.**
- [ ] **[필수][BKP-02] JSON 최상위에 `format`, `schemaVersion`, `createdAt`, `registry`, `purposeRoutes`, `externalIntegrations`만 있고 portable schemaVersion이 `2`인지 확인한다.**
- [ ] **[필수][BKP-03] Registry에는 provider·model ID·protocol·enabled·선택 상태만 있는지 확인한다.**
- [ ] **[필수][BKP-04] route에는 provider·model ID·adapter ID·Connection Profile ID만 있는지 확인한다.**
- [ ] **[필수][BKP-04A] externalIntegrations에는 schemaVersion, target ID별 provider mapping과 provider별 CMR model 선택만 있는지 확인한다.**
- [ ] **[필수][BKP-05] 백업에 API 키·endpoint·리전·project/account ID·Service Account·profile 본문이 없는지 확인한다.**
- [ ] **[필수][BKP-06] 모델과 route 하나를 변경한 뒤 원본 백업을 가져오고 확인 대화상자에서 취소하면 아무 설정도 바뀌지 않는다.**
- [ ] **[필수][BKP-07] 다시 원본 백업을 가져와 확인하면 Registry·route·외부 mapping과 선택이 내보내기 당시 상태로 복원된다.**
- [ ] **[필수][BKP-08] 가져오기 전후 API key·endpoint·리전과 profile 내용이 바뀌지 않는다.**
- [ ] **[권장][BKP-09] 잘못된 JSON 파일을 가져오면 명확히 거부되고 현재 설정은 유지된다.**
- [ ] **[권장][BKP-10] 복사본에 알 수 없는 최상위 필드를 추가하면 거부되고 현재 설정은 유지된다.**
- [ ] **[권장][BKP-11] 복사본의 schemaVersion을 미래 값으로 올리면 업데이트 안내와 함께 거부된다.**
- [ ] **[조건부][BKP-12] 존재하지 않는 profile ID를 참조하는 정상 route 백업은 보존되지만 실행 시 profile 오류가 난다.**
- [ ] **[조건부][BKP-13] v0.5.0에서 만든 portable schema v1 백업을 가져오면 Registry·route가 보존되고 빈 externalIntegrations를 가진 schema v2 상태로 이관된다.**
- [ ] **[권장][BKP-14] 외부 연결 schema를 미래 값으로 올리거나 위험한 target key를 넣은 백업은 기존 설정 무변경 상태로 거부된다.**

## 11. 비활성화·재활성화·보안

- [ ] **[필수][LIFE-01] 확장을 비활성화하면 런처·팝업·CMR optgroup과 `globalThis.CustomModelRouter`가 제거된다.**
- [ ] **[필수][LIFE-01A] 비활성화하면 다른 확장의 CMR group/option과 외부 observer/listener가 제거되고 native option·기존 input 값·기존 datalist 연결은 보존된다. 제거된 CMR option을 선택 중이던 `select`는 브라우저 또는 외부 확장의 native 기본값으로 전환될 수 있다.**
- [ ] **[필수][LIFE-02] select형 현재 사용자 모델은 가능한 기본 모델로 안전하게 전환되고 인증 설정은 유지된다.**
- [ ] **[조건부][LIFE-03] Custom 자유 입력값과 endpoint는 비활성화해도 삭제되지 않는다.**
- [ ] **[필수][LIFE-04] 다시 활성화하면 UI와 API가 하나씩만 생성되고 등록 설정이 복원된다.**
- [ ] **[필수][LIFE-04A] 다시 활성화하면 외부 target과 mapping, CMR option이 한 번만 복원된다. 동일 target의 control 값이 비어 있을 때만 저장 선택을 복원하고 유효한 외부 현재값은 유지한다.**
- [ ] **[권장][LIFE-05] 활성화·비활성화를 5회 반복해도 이벤트 중복, 잔여 dialog 또는 콘솔 오류가 없다.**
- [ ] **[필수][SEC-01] 확장 설정과 백업에 API 키·Service Account·전체 endpoint가 저장되지 않는다.**
- [ ] **[필수][SEC-02] 진단 결과와 오류 메시지에 사용자가 입력한 비밀값 자체가 노출되지 않는다.**
- [ ] **[필수][SEC-03] HTML처럼 보이는 모델 ID가 거부되고 등록 모델 표시는 실행되지 않는 일반 텍스트다.**
- [ ] **[필수][SEC-04] Azure OpenAI deployment와 CometAPI를 지원한다고 잘못 표시하지 않는다.**

## 결과 보고 양식

```text
제목: [v0.6.2][제공업체 또는 기능][항목 ID] 짧은 증상

SillyTavern 버전:
Custom Model Router 버전: v0.6.2
OS / 브라우저:
신규 설치 또는 업데이트:
이전 CMR 버전:
제공업체 / source:
endpoint 모드 이름(비밀 URL 제외):
모델 ID:
Connection Profile 사용 여부와 비밀이 아닌 이름:
일반 / 스트리밍:
실패 항목 ID:
기대 결과:
실제 결과:
재현 순서:
source/Profile 반복 횟수:
진단 상태·경고 코드:
백업 가져오기 결과:
외부 target 자동/수동/확인 필요 상태:
외부 control 종류(select/input/datalist/기타):
Network payload의 model 확인 결과:
Caption /caption-image payload의 model 확인 결과:
민감정보를 제거한 오류 메시지:
민감정보를 제거한 스크린샷:
```

실패 항목이 있어도 데이터 손실·무한 반복·비밀 노출이 아니라면 나머지 독립 항목은 계속 확인해도 됩니다. 결과를 모으면 같은 v0.6 범위의 후속 수정은 `v0.6.3`, `v0.6.4`, ...로 반영합니다.
