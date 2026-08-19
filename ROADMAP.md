# 개발 로드맵과 현재 진행 상태

마지막 업데이트: **2026-08-19**

현재 릴리스: **v0.6.7**

현재 단계: **v0.6.7에서 SillyTavern 1.18.0 CSS 기반 Chromium UI 회귀 검사 6개를 자동화하고 실제 사용자 환경 검증 대기 중**

## 상태 범례

| 표시 | 의미 |
|---|---|
| ✅ 완료 | 코드와 자동 검증 근거가 저장소에 반영됨 |
| 🧪 검증 대기/중 | 실제 사용자 계정·화면 확인이 필요함 |
| 🚧 진행 중 | 현재 작업 중임 |
| 📝 예정 | 범위만 정했으며 아직 구현하지 않음 |

실제 API 호출에는 자격 증명, 모델 권한과 지역별 제공 여부가 필요하므로 자동 검사·샌드박스와 사용자 계정 검증을 분리해 기록합니다.

## 현재 위치

| 단계 | 상태 | 결과 또는 다음 행동 |
|---|---|---|
| SillyTavern 1.18.0 계약 조사 | ✅ 완료 | 활성 Chat Completion source 25개 중 등록 가능한 24개와 구조적 제외를 확인 |
| 다중 provider Registry | ✅ 완료 | `(provider, model ID)` 복합키, 제공업체별 선택, v1 Vertex 이관 |
| 관리 팝업과 기본 컨트롤 | ✅ 완료 | 24개 제공업체 모델 등록·삭제, 전체 provider 목록 기본 표시, 6개 초과 숨은 스크롤, 공식 Popup 닫기 하나와 작은 추가 버튼 |
| 공개 Registry API | ✅ 완료 | API `1.1.0`, 불변 스냅샷·mutation·이벤트·수명주기, 현재 custom-only 모델 삭제 보호 |
| 용도별 라우팅 | ✅ 완료 | 일반 UI 없이 Routing API `1.0.0`, Connection Profile 어댑터, route·backup 보존 |
| 호환성 진단 | ✅ 완료 | ST 버전, context·이벤트·provider 컨트롤과 동일 option host 단위 런타임 자원 중복 진단 |
| 범용 외부 확장 브리지 | ✅ 완료 | 표준 select/input/datalist 탐지, 모든 provider 모델을 표시하는 단일 직접 연결, 재렌더·선택 복원 |
| 설정 백업·복구 | ✅ 완료 | Registry·route·외부 선택을 portable schema v2로 처리, legacy mapping 제거, v1 이관·미래 schema 거부 |
| 안정성 계측 | ✅ 완료 | source·profile 전환 표본의 observer·listener·group 누적 판정 |
| 자동 검사 | ✅ 완료 | 단위·통합·수명주기·보안 경계·버전 일치 검사 148개 통과 |
| DOM·공개 API 샌드박스 | ✅ 완료 | 기본 24개·native 선택·외부 모델 컨트롤·개발자 route API와 정리 수명주기 확인 |
| Chromium UI 회귀 검사 | ✅ 완료 | 실제 `settings.html`과 SillyTavern 1.18.0 고정 CSS를 결합해 4개 화면 폭·목록 경계·상호작용 검사 6개 통과 |
| 사용자 실제 계정 검증 | 🧪 대기 | [통합 체크리스트](./USER_CHECKLIST.md)를 사용하는 연결에서 한 번 수행 |

## 지원 기준

| SillyTavern 버전 | 판정 | 정책 |
|---|---|---|
| `1.18.0` | ✅ 자동 계약 검증 기준 | provider selector·setting·event·Connection Manager API 검사 |
| `1.18.0` 미만 | ❌ 비지원 | manifest 최소 버전과 진단에서 중단 |
| `1.18.0` 초과 | ⚠️ 최소 버전 충족·미검증 | 진단을 실행하고 실제 요청을 체크리스트로 확인 |

샌드박스와 UI 회귀 검사는 DOM·공개 API 계약, 실제 설정 마크업과 SillyTavern CSS의 배치·상호작용을 확인합니다. 전체 SillyTavern 런타임이나 실제 제공업체 인증·네트워크 요청 성공을 대신하지 않습니다.

## v0.2.0 — 여러 제공업체의 사용자 모델 등록

상태: **✅ 구현·자동 검사 완료, 실제 계정별 검증은 계속 대기**

### 등록 가능한 24개 연결

| 그룹 | 제공업체 또는 연결 |
|---|---|
| 모델 개발사 API 14개 | OpenAI, Anthropic, AI21, Cohere, DeepSeek, Google AI Studio, Google Vertex AI, Groq, Mistral AI, MiniMax, Moonshot AI (Kimi), Perplexity, xAI, Z.AI (GLM) |
| 라우터·호스팅 9개 | AI/ML API, Chutes, Cloudflare Workers AI, ElectronHub, Fireworks AI, NanoGPT, OpenRouter, Pollinations, SiliconFlow |
| 사용자 지정 1개 | Custom OpenAI-compatible |

Z.AI (GLM), DeepSeek, Moonshot AI (Kimi), MiniMax와 SiliconFlow도 전용 연결에서 정확한 모델 ID를 등록합니다. 다른 업체·지역 endpoint는 SillyTavern `Custom` 연결을 사용합니다.

### 구조적 제외

- **Azure OpenAI**: 요청 대상은 model이 아니라 deployment name으로 결정됩니다.
- **CometAPI**: SillyTavern 1.18.0에서 provider 요청이 비활성화되어 있습니다.

### 완료 근거

- [x] 24개 descriptor의 source·selector·setting key 검증
- [x] select형 23개와 input형 Custom 적용
- [x] v1 Vertex → schema v2 이관
- [x] 원격 목록 재생성·source·profile 변경 뒤 복원
- [x] 인증·endpoint·project·region·filter 비변경
- [x] 다른 모델로 무음 대체하지 않음

## v0.3.0 — 공개 Registry API

상태: **✅ 구현·자동 검사 완료**

### 목표

- 다른 확장이 내부 파일 경로 대신 안정된 전역 계약으로 Registry를 사용합니다.
- 등록 모델과 제공업체별 선택 상태를 직접 조회합니다.
- UI와 외부 API에서 생긴 변경을 구조화 이벤트로 구독합니다.

### 구현 결과

- [x] `globalThis.CustomModelRouter`와 Registry API `1.1.0`
- [x] `(provider, model ID)` 복합키 조회·등록·선택·삭제
- [x] 깊게 동결된 스냅샷과 반환 객체
- [x] revision을 포함한 변경 이벤트와 구독 해제
- [x] 이름 충돌 비덮어쓰기와 disable 뒤 전역 정리
- [x] Registry 선택이 메인 채팅 모델을 바꾸지 않는 계약

## v0.4.0 — 확장 어댑터와 용도별 라우팅

상태: **✅ 구현·자동 검사 완료**

### 목표

- 번역·요약·검색 보조·이미지 설명 등 각 용도가 실제 `(provider, model ID)`를 직접 참조합니다.
- 기존 Connection Profile 인증·endpoint를 사용하되 메인 채팅 상태는 변경하지 않습니다.

### 구현 결과

- [x] Routing API `1.0.0`
- [x] `{ provider, modelId, adapterId, connectionProfileId }` 경로 계약
- [x] SillyTavern `ConnectionManagerRequestService` 기본 어댑터
- [x] route provider와 profile source 일치 검증
- [x] 요청의 model만 경로 ID로 지정하고 profile 설정은 복제하지 않음
- [x] 삭제 모델·프로필·미등록 adapter 구조화 오류
- [x] 다른 route나 메인 모델로 fallback하지 않음
- [x] 등록·해제·시험 UI와 외부 adapter 등록 API

## v0.5.0 — 호환성과 운영 안정화

상태: **✅ 구현·자동 검사·DOM/공개 API 샌드박스 완료, 사용자 환경 검증 대기**

### 목표

- 업데이트 뒤 SillyTavern 공개 계약과 확장 자원 상태를 사용자가 확인할 수 있게 합니다.
- 설정 손상은 안전 범위에서 복구하고 미래 schema는 조용히 낮추지 않습니다.
- 인증정보 없는 Registry·route 백업으로 업데이트와 재설치를 준비합니다.

### 구현 결과

- [x] ST 버전·context·event·provider control 호환성 진단
- [x] 런처·observer·listener·optgroup 중복 및 비활성 잔여 자원 진단
- [x] profile·source 변경 표본의 자원 증가 감시
- [x] 민감정보 값이 없는 구조화 진단 복사
- [x] Registry·route 휴대용 JSON 내보내기
- [x] 허용 필드·크기·ID·provider·schema 전체 검증 뒤 가져오기
- [x] 알 수 없는 필드와 미래 schema를 기존 설정 무변경 상태로 거부
- [x] 이전 설정 이관과 손상·중복 레코드 안전 정규화
- [x] Connection Profile ID만 저장하고 프로필 본문·키·endpoint 제외

### 완료 조건

- [x] 자동 검사 전체 통과
- [x] 브라우저 DOM·공개 API 샌드박스 결과 기록
- [ ] 사용자가 통합 체크리스트를 한 번 수행
- [ ] 사용 중인 provider의 일반·스트리밍·복원 결과 기록

### 범위 정정

v0.5.0의 공개 Registry API와 Routing API는 다른 확장이 API를 직접 호출하는 opt-in 계약이었습니다. CMR에 등록한 모델을 기존 다른 확장의 모델 선택기에 자동 표시하거나 그 확장의 요청에 자동 적용하는 기능은 v0.5.0에 없었습니다. 당시 로드맵의 "확장 어댑터"와 "사용자 실제 계정 통합" 표현이 이 차이를 충분히 분명하게 설명하지 못했습니다.

이 누락은 v0.6.0의 범용 DOM 모델 브리지에서 처음 구현합니다. v0.5.0을 기존 외부 확장 자동 연동 완료 버전으로 간주하지 않습니다.

## v0.6.0 — 범용 외부 확장 모델 브리지

상태: **✅ 구현·자동 검사 완료, 실제 외부 확장 요청 검증 대기**

아래 수동 mapping과 대상별 설정은 v0.6.0 당시 구현 이력입니다. v0.6.3에서는 일반 UI와 legacy mapping 적용을 제거하고 안전한 자동 provider 추론만 유지합니다.

### 목표

- 다른 확장이 표준 DOM Chat Completion 모델 컨트롤을 제공하면 CMR 등록 모델을 표시합니다.
- 제공업체를 자동 추론하되 모호하거나 위험한 대상은 사용자가 결정하기 전까지 변경하지 않습니다.
- 외부 확장의 저장 이벤트와 요청 경로를 그대로 사용하고 전역 네트워크 API를 가로채지 않습니다.

### 구현 결과

- [x] `select`, 텍스트 `input`, `datalist` 기반 모델 컨트롤 자동 탐지
- [x] control ID·name·label, provider/source select, option `data-type`과 provider alias를 조합한 추론
- [x] 자동 추론보다 우선하는 수동 provider mapping과 대상별 자동 연결 해제
- [x] 제공업체별 CMR option 주입, native option·현재 값·외부 data attribute 보존
- [x] 늦은 로드와 외부 확장 재렌더 뒤 옵션 복원, 동일 target의 새 컨트롤이 빈 값일 때만 provider별 마지막 CMR 선택 복원
- [x] 외부 target·observer·listener·자동/수동/제외/확인 필요 개수 진단
- [x] 비활성화 시 외부 CMR option·observer·listener 제거, 예약 작업 재생성 차단
- [x] 외부 연결 설정 schema v1과 최대 512 target, 손상·미래 schema·prototype pollution 방어
- [x] portable backup schema v2에 외부 mapping·선택 추가 및 v1 백업 안전 이관
- [x] Registry 및 route와 마찬가지로 API 키·endpoint·외부 요청 본문 비저장

### 의도적 제외와 한계

- Vectors·embedding·rerank, TTS·음성, Stable Diffusion·이미지 생성 모델 컨트롤은 Chat Completion 모델과 종류가 달라 자동 연결하지 않습니다.
- Caption처럼 표준 provider/model control과 `data-type`을 사용하는 확장은 best-effort로 지원하지만, 모델의 실제 멀티모달 능력과 계정 권한은 판별하지 않습니다.
- React 등 자체 위젯만 제공하는 확장, iframe 내부, 닫힌 Shadow DOM, 모델 컨트롤 없이 직접 요청하는 확장은 자동 탐지할 수 없습니다.
- 전역 `fetch`·`XMLHttpRequest` monkey patch를 사용하지 않습니다. 모델 값이 실제 request body에 들어가는지는 외부 확장의 기존 `input`/`change` 저장 구현에 달려 있습니다.
- 자동 탐지가 불가능한 확장은 공개 Registry/Routing API를 직접 사용하는 전용 opt-in 연동이 필요합니다.
- 외부 확장이 둔 유효한 현재 모델 값은 덮어쓰지 않습니다. v0.6.0 당시에는 control의 ID·name·label 또는 상위 확장 구조가 바뀌어 target ID가 달라지면 수동 provider 연결을 다시 지정했습니다.
- 비대상 판별도 DOM 표식 기반 best-effort입니다. v0.6.0 당시에는 잘못 감지된 대상을 **사용 안 함**으로 지정했지만, v0.6.3은 provider를 확실하게 자동 판별할 수 없는 대상을 처음부터 변경하지 않습니다.

### 완료 조건

- [x] 자동 탐지·수동 mapping·빈 컨트롤 선택 복원·재렌더·정리 단위/통합 검사
- [x] 비대상 제외, 모호한 provider, 오염 설정과 portable v1→v2 검사
- [ ] 사용자 환경에서 Caption 또는 사용 중인 외부 확장 모델 목록에 CMR 모델 표시
- [ ] 실제 기능 실행 Network payload에서 정확한 `model` 확인
- [ ] 새로고침·재렌더·비활성화/재활성화 결과 기록

## v0.6.1 — 관리 팝업 UI·UX 재구성 시도

상태: **↩️ 사용자 피드백에 따라 롤백**

### 이력

- [x] 카드형 정보 구조, 외부 대상별 단일 연결 메뉴와 일반 사용자용 설명을 시도
- [x] 버튼 정렬·여백·좁은 화면 대응과 진단·백업 그룹화를 시도
- [x] 사용자 검토에서 기능 역할이 여전히 과도하고 관리 팝업이 실제 선택·외부 예외 설정·라우팅까지 맡는 문제가 확인됨
- [x] 변경 기록은 보존하고 v0.6.2에서 v0.6.0 UI로 롤백

## v0.6.2 — v0.6.1 UI 롤백과 방향 재논의

상태: **✅ 롤백 완료, 🧭 다음 설계 논의 중**

### 반영 결과

- [x] v0.6.1의 카드형 관리 팝업·단일 외부 연결 메뉴·용어 변경을 v0.6.0 상태로 복원
- [x] Git 기록은 보존하고 버전은 역행하지 않도록 롤백 릴리스를 v0.6.2로 게시
- [x] Registry·범용 DOM 브리지·Routing API·백업 schema 등 v0.6.0 기능 계층은 유지
- [x] 등록 목록은 등록·삭제만 담당하고 실제 선택은 SillyTavern native 컨트롤을 사용하기로 합의
- [x] 외부 브리지는 확실한 provider 자동 추론만 사용하고 대상별 수동 예외 UI를 제거하기로 합의
- [x] 기능별 라우팅 일반 UI를 제거하고 개발자 opt-in API·route·backup은 유지하기로 합의

이 합의는 v0.6.3에 반영합니다.

## v0.6.3 — 일반 UI와 자동 브리지 역할 단순화

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 검증 대기**

### 반영 결과

- [x] 등록 목록에서 선택 버튼·현재 사용 상태를 제거하고 모델 ID와 삭제 동작만 유지
- [x] 실제 모델 선택은 SillyTavern의 기존 모델 선택기 또는 입력란에서 수행
- [x] 정상 모델 컨트롤 감지 상태는 숨기고 실제 컨트롤 누락 오류만 표시
- [x] 외부 브리지는 provider를 충분히 확실하게 자동 판별한 target에만 provider별 Registry 모델을 주입
- [x] provider를 판별할 수 없는 target과 비채팅 모델 컨트롤은 변경하지 않음
- [x] 외부 target별 수동·자동·확인 필요·사용 안 함 UI와 일반 화면의 대상 목록 제거
- [x] v0.6.2 이하 legacy external `mappings`를 자동 정리하고 provider별 `selectedModels`는 보존
- [x] 기능별 라우팅 일반 UI 제거, Routing API `1.0.0`·기존 route·Connection Profile 어댑터·backup 유지
- [x] 진단에는 외부 자동 판별 성공·판별 불가·안전상 건너뜀을 구분하되 일반 관리 화면에는 정상 감지 상태를 노출하지 않음

### 사용자 검증 초점

- [ ] 등록 목록에는 모델 ID와 삭제 버튼만 보이고 실제 선택이 SillyTavern native 컨트롤에서 동작함
- [ ] provider 컨트롤이 정상일 때 감지 성공 문구가 없고 실제 누락 오류만 표시됨
- [ ] 자동 판별 가능한 외부 컨트롤에만 같은 provider의 모델이 나타나고 unknown target은 그대로 유지됨
- [ ] v0.6.2 이하 설정·백업 이관 뒤 legacy mapping은 제거되고 provider별 마지막 선택은 유지됨
- [ ] 일반 UI에 라우팅 설정이 없지만 개발자 API의 route 조회·설정·실행과 backup round trip이 유지됨

## v0.6.4 — 삭제 안전성·외부 선택 저장 회복

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 검증 대기**

### 반영 결과

- [x] 공개 `unregisterModel()`이 SillyTavern `select`에서 현재 사용 중인 custom-only 모델을 `model_in_use`로 거부
- [x] SillyTavern native 모델로 전환한 뒤 같은 공개 API 등록 해제를 허용
- [x] SillyTavern 실행 설정의 자동 모드 이관에서 legacy mapping 512개가 한도를 채워도 `selectedModels`를 우선 보존
- [x] stale 외부 선택 512개로 포화된 저장은 현재 DOM에서 감지되지 않은 가장 오래된 target 하나만 교체해 새 선택 저장을 회복
- [x] 추가 회귀 검사를 포함한 자동 검사 133개 통과

### 사용자 검증 초점

- [ ] 현재 custom-only 모델을 공개 API로 지우면 `model_in_use`이며 Registry와 SillyTavern 선택이 유지됨
- [ ] native 모델로 전환한 뒤에는 공개 API 등록 해제가 성공함
- [ ] 512개 legacy mapping 이관에서도 별도 target의 provider별 선택 기록이 보존됨
- [ ] stale 외부 선택 포화 상태에서 현재 감지 target의 새 선택이 저장됨

## v0.6.5 — UI 정리와 직접 연결 회귀 복구

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 검증 대기**

### 수정 배경

v0.6.3에서 일반 UI를 단순화하면서 특정 provider를 고르는 수동 mapping뿐 아니라, 자동 판별할 수 없는 표준 Chat Completion 대상을 사용자가 연결하는 경로까지 함께 제거했습니다. 그 결과 CMR에 등록한 모델이 일부 외부 확장에서 보이지 않는 회귀가 v0.6.3~v0.6.4에 존재했습니다. v0.6.5는 provider 하나를 지정하던 예전 방식 대신, 직접 연결한 대상에 Registry의 모든 provider 모델을 provider별로 보여주는 방식으로 이 경로를 복구합니다.

### 반영 결과

- [x] 등록 모델 목록은 선택한 등록 provider와 무관하게 모든 provider의 모델을 그룹별로 기본 표시
- [x] 모델 행의 삭제 버튼을 작은 아이콘 버튼으로 축소하고, 총 6개를 넘을 때 목록 영역만 스크롤
- [x] 목록·진단·외부 대상의 스크롤 기능은 유지하면서 시각적 스크롤바 숨김
- [x] UI 버전 배지를 제거하고 닫기 버튼을 패널 헤더 안에 배치
- [x] 호환성 진단·설정 복구와 지원 범위·개인정보 펼침 영역의 안쪽·아래쪽 여백 보강
- [x] 일반 문구는 `word-break: keep-all`을 사용하고, 문장 종결부호 뒤의 문장 경계를 별도 줄로 표현
- [x] SillyTavern과 외부 모델 optgroup 라벨을 짧은 `사용자 모델`로 정리
- [x] 모든 패널 버튼의 아이콘과 텍스트를 가로·세로 중앙 정렬
- [x] 외부 대상별 `자동 연결`, `직접 연결`, `연결 안 함` UI 복구
- [x] 직접 연결은 특정 provider를 고정하지 않고 등록된 모든 provider 모델을 provider별 optgroup으로 표시
- [x] legacy provider mapping을 `manual` 직접 연결로 이관하고 기존 `disabled`·provider별 마지막 선택 보존
- [x] stale 선택·mapping 포화 시 감지되지 않은 target 하나만 정리하고 선택 기록을 mapping-only 기록보다 우선 보존
- [x] 기능별 라우팅 일반 UI는 다시 추가하지 않고 Routing API `1.0.0`과 기존 route·backup만 유지
- [x] 추가 회귀 검사를 포함한 자동 검사 146개 통과

### 사용자 검증 초점

- [ ] 팝업을 열면 선택한 등록 provider와 상관없이 전체 등록 모델이 provider별로 보임
- [ ] 7개 이상 모델에서 숨은 스크롤을 사용해 목록 끝까지 이동할 수 있고 작은 삭제 버튼을 누를 수 있음
- [ ] 닫기·여백·단어 경계·문장 단위 줄바꿈과 모든 버튼 정렬이 좁은 화면에서도 유지됨
- [ ] 자동 연결은 판별한 provider 모델만, 직접 연결은 모든 provider 모델을 provider별로 표시함
- [ ] 연결 안 함은 해당 모델 칸에 CMR 선택지를 표시하지 않고 새로고침 뒤에도 유지됨. CMR option을 선택 중이었다면 native 기본값으로 전환될 수 있음
- [ ] v0.6.0~v0.6.2 provider mapping이 직접 연결로 이관되고 v0.6.3~v0.6.4 선택 기록도 보존됨
- [ ] 외부 확장에서 선택한 모델 ID가 실제 Network 요청의 `model`로 전달됨

## v0.6.6 — 외부 연결 단일화와 진단·버튼 수정

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 검증 대기**

### 수정 배경

v0.6.5 사용자 검증에서 자동 연결과 직접 연결의 차이가 일반 사용자에게 불필요하게 복잡하고, 수동 새로고침 버튼의 역할도 불명확하다는 피드백을 받았습니다. 또한 기본 Vertex 선택기와 여러 외부 확장 선택기에 정상적으로 존재하는 Vertex 사용자 모델 그룹을 진단기가 전역 합계로 세어 중복 자원 오류로 잘못 보고했습니다. 관리 팝업에서는 SillyTavern 기본 닫기와 CMR 닫기가 동시에 보였고 모델 추가 버튼도 과도하게 컸습니다.

### 반영 결과

- [x] 안전하게 감지한 외부 Chat Completion 모델 컨트롤은 별도 모드 없이 Registry 전체 모델을 provider별로 직접 표시
- [x] 자동·직접·연결 안 함 선택기와 수동 모델 새로고침 버튼 제거
- [x] 외부 화면 변경은 기존 MutationObserver가 자동 감지하며 상태 목록은 읽기 전용으로 유지
- [x] v0.6.0~v0.6.5 legacy mapping은 제거하고 target별 provider 모델 선택 기록은 보존
- [x] 중복 모델 그룹은 전역 provider 합계가 아니라 같은 option host 안의 같은 provider 그룹만 오류로 판정
- [x] 안정성 계측의 core 모델 그룹 수에서 외부 확장용 표시 그룹 제외
- [x] CMR 자체 닫기 버튼과 SillyTavern 기본 닫기 숨김 처리를 제거해 공식 Popup 닫기 하나만 사용
- [x] 모델 추가 버튼의 높이·글자 크기·좌우 여백 축소
- [x] 자동 검사 148개와 정적 UI 샌드박스 갱신

### 사용자 검증 초점

- [ ] 외부 연결 대상에 별도 모드 조작 없이 모든 provider 등록 모델이 provider별로 보임
- [ ] 외부 확장 화면이 다시 렌더되어도 별도 새로고침 없이 모델 선택지가 복원됨
- [ ] 진단에서 서로 다른 선택기의 같은 Vertex 그룹을 중복 자원으로 보고하지 않음
- [ ] 같은 선택기 안에 동일 provider CMR 그룹이 실제로 중복될 때는 계속 오류로 보고함
- [ ] 관리 팝업 닫기 버튼이 하나만 보이고 모델 추가 버튼이 입력란 옆에서 과도한 면적을 차지하지 않음

## v0.6.7 — 실제 UI 회귀 검사 자동화

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 환경 검증 대기**

### 수정 배경

기존 `ui-sandbox.html`과 정적 CSS 계약은 좁은 화면의 실제 브라우저 배치, SillyTavern 전역 스타일 충돌, 숨긴 스크롤바의 조작 가능 여부를 자동으로 판정하지 못했습니다. v0.6.7은 제품 마크업과 검증 기준 SillyTavern CSS를 Chromium에 함께 올려, 이후 UI 수정이 이미 확인한 배치를 다시 깨뜨리는지 지속적으로 확인합니다.

### 반영 결과

- [x] 제품 `settings.html`을 fixture에 직접 주입해 복제 마크업과 제품 UI의 불일치 방지
- [x] SillyTavern 1.18.0 고정 commit의 core `style.css`와 `popup.css`를 CMR `style.css`보다 먼저 적용
- [x] 320×568, 360×640, 420×800, 720×900 Chromium viewport에서 가로 넘침·버튼 기하·공백 단위 줄바꿈 검사
- [x] 모델 0·6개는 펼친 목록, 7·100개는 숨은 내부 스크롤을 사용하는 경계 검사
- [x] SillyTavern 공식 닫기 하나, 클릭·`Escape` 닫기와 Popup modal 상태 검사
- [x] 모델·외부 대상·진단의 보이지 않는 스크롤바를 마우스 휠과 키보드로, Popup 본문을 마우스 휠로 실제 조작
- [x] 외부 대상이 읽기 전용 단일 직접 연결 UI만 표시하고 자동·연결 안 함·수동 새로고침을 다시 만들지 않는지 검사
- [x] Node 자동 검사 148개와 Playwright Chromium UI 회귀 검사 6개 통과
- [x] GitHub Actions에서 성공·실패 PNG, HTML report와 실패 trace를 `ui-regression-evidence-*` artifact로 14일 보관

### 검증 경계와 사용자 확인

이 harness는 실제 제품 마크업과 SillyTavern 1.18.0 CSS를 사용하지만 전체 SillyTavern JavaScript 런타임, 외부 확장 코드 또는 실제 API를 기동하지 않습니다. API 키와 Service Account는 필요하지 않으며, 모델 선택이 실제 요청 JSON에 저장·전달되는지는 계속 사용자 환경에서 확인합니다.

- [ ] 설치된 SillyTavern의 실제 Popup이 자동 검사 PNG와 같은 정보 구조·정렬을 유지함
- [ ] 실제 마우스·키보드·터치 환경에서 숨은 스크롤과 닫기 조작이 동작함
- [ ] 외부 확장에서 선택한 모델 ID가 실제 Network 요청의 `model`로 전달됨

## 실제 사용자 검증 게이트

다음 조건은 자동 검사만으로 완료 처리하지 않습니다.

1. 설치 전 기존 provider 연결이 정상 동작합니다.
2. 등록 ID가 실제 요청의 `model`로 전달됩니다.
3. 일반·스트리밍 요청이 모두 성공하거나 제공업체 오류가 그대로 표시됩니다.
4. 새로고침, source 전환, 원격 목록 갱신과 profile 왕복 뒤 선택이 정확합니다.
5. 개발자 Routing API의 보조 route 실행 전후 메인 source·모델이 같습니다.
6. 20회 이상 source·profile 전환 뒤 진단에서 자원 증가가 없습니다.
7. 백업 round trip 뒤 Registry·route·외부 target별 마지막 CMR 선택과 provider 식별자가 복원되고 연결 비밀은 남지 않습니다.
8. 외부 확장 모델 컨트롤에서는 등록 ID가 표시될 뿐 아니라 실제 요청의 `model`에 전달됩니다.
9. 비대상 모델 컨트롤은 변경되지 않고, 감지된 안전한 표준 Chat Completion 대상은 단일 직접 연결로 동작합니다.
10. 공개 API도 현재 사용 중인 select형 custom-only 모델을 native 전환 전에 지우지 못합니다.
11. 외부 선택 저장이 512개 한계에 도달해도 유효한 이관 선택과 현재 감지 target의 새 선택은 보존됩니다.
12. 관리 목록은 전체 provider 모델을 기본 표시하며 6개 초과 숨은 스크롤, 작은 삭제 버튼, 공식 닫기 하나와 문장 단위 줄바꿈을 유지합니다.
13. 외부 대상은 모드 선택과 수동 새로고침 없이 재렌더 뒤에도 단일 직접 연결을 유지합니다.
14. GitHub Actions의 UI 회귀 검사 증거와 실제 설치 화면을 비교해 SillyTavern 런타임에서만 생기는 차이가 없는지 확인합니다.

실제 검증에서 발견되는 v0.6 범위의 후속 결함은 `v0.6.8`, `v0.6.9`, ... 패치 버전으로 수정합니다.

## 업데이트 규칙

1. 기능 범위 변경은 `v0.n.0`, 같은 범위의 수정은 `v0.n.n`을 사용합니다.
2. 코드·자동 검사 완료와 실제 계정 검증 완료를 별도로 표시합니다.
3. 버전은 manifest, package, 초기화 로그, README, API 문서, 체크리스트와 로드맵에서 함께 갱신합니다. 관리 팝업에는 버전 배지를 표시하지 않습니다.
4. 라이선스 파일은 사용자 요청에 따라 추가하지 않습니다.

## 릴리스 기록

| 버전 | 상태 | 결과 |
|---|---|---|
| v0.1.0 | ✅ 게시 | Vertex 사용자 모델 등록·선택·복원 |
| v0.1.1 | ✅ 게시 | 사용자 체크리스트와 진행 로드맵 |
| v0.1.2 | ✅ 게시 | API Connections 관리 아이콘·공식 팝업·압축 목록 |
| v0.2.0 | ✅ 게시 | 24개 Chat Completion 연결과 schema v2 |
| v0.2.1 | ✅ 게시 | 이후 기능 단계를 직접 모델 ID 계약으로 단순화 |
| v0.3.0 | ✅ 구현 완료 | 공개 Registry API `1.1.0` |
| v0.4.0 | ✅ 구현 완료 | Connection Profile 어댑터와 용도별 라우팅 |
| v0.5.0 | ✅ 완료·범위 정정 | 진단·설정 복구·백업·안정성 검증; 기존 외부 확장 자동 연동은 포함하지 않았음 |
| v0.6.0 | ✅ 구현 완료·🧪 사용자 검증 대기 | 범용 DOM 모델 브리지, 수동 mapping, 외부 연결 portable schema v2 |
| v0.6.1 | ↩️ 롤백 | 관리 팝업 UI·UX 재구성은 사용자 피드백에 따라 철회 |
| v0.6.2 | ✅ 롤백 릴리스 | v0.6.0 UI 복원, 기능 역할·정보 구조 재논의와 v0.6.3 합의 확정 |
| v0.6.3 | ✅ 완료 | 등록·삭제 전용 UI, native 선택, 외부 자동 추론, 개발자 Routing API 유지 |
| v0.6.4 | ✅ 완료 | 공개 API 삭제 안전성, legacy mapping 선택 우선 이관, stale 외부 선택 저장 회복 |
| v0.6.5 | ✅ 완료 | 전체 등록 목록·UI 정리, 외부 직접 연결과 연결 안 함 회귀 복구 |
| v0.6.6 | ✅ 완료·🧪 사용자 검증 대기 | 외부 연결 단일화, 중복 자원 진단 오탐·중복 닫기·추가 버튼 수정 |
| v0.6.7 | ✅ 현재 릴리스·🧪 사용자 검증 대기 | SillyTavern 1.18.0 CSS 기반 Chromium UI 회귀 검사 6개와 CI 증거 보관 |
