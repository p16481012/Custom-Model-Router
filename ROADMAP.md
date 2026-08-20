# 개발 로드맵과 현재 진행 상태

마지막 업데이트: **2026-08-20**

현재 릴리스: **v0.6.15**

현재 단계: **v0.6.15의 hookless native Custom·SillyTavern 현재 연결 모델 projection을 구현하고 실제 외부 확장 handler 검증 대기 중**

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
| 관리 팝업과 기본 컨트롤 | ✅ 완료 | 숫자 배지 없는 단일 런처, 24개 제공업체 모델 등록·삭제, 단일·여러 줄 공용 textarea와 아이콘 버튼 하나, 핵심 한 줄 안내와 native popover 도움말 5곳, 전체 provider 목록, 12개 초과 조건부 검색, 최대 200줄 원자 등록, 삭제 실행 취소와 6개 초과 숨은 스크롤 |
| 공개 Registry API | ✅ 완료 | API `1.2.0`, 불변 스냅샷·mutation·이벤트·수명주기, Provider Integration API 노출, 현재 custom-only 모델 삭제 보호 |
| 공용 provider 연동 | ✅ 완료 | Integration API `1.0.0`, 선택된 일반·Custom Connection Profile 전략, 공개 hook의 handler 설치→모델 게시 2단계 준비 계약 |
| hookless native provider 재사용 | ✅ 완료 | 기존 exact Custom/OpenAI-compatible에는 `custom` 모델만, exact SillyTavern 현재 연결에는 활성 ST provider 모델만 투영; provider option·연결 설정·요청 handler 불변 |
| 용도별 라우팅 | ✅ 완료 | 일반 UI 없이 Routing API `1.0.0`, Connection Profile 어댑터, route·backup 보존 |
| 호환성 진단 | ✅ 완료 | ST·context·provider·런타임 진단, native Custom·현재 연결·projection·확인 불가 집계, 복구 상세와 target별 native 중복 제외 후보 512개·전체 예상/실제 option 합계 2,048개 주의 |
| 범용 외부 확장 브리지 | ✅ 완료 | 표준 select/input/datalist 모델 target 탐지, provider/source 선택기 비대상 판별·metadata 감시, 안전 대상 자동 주입, 실패·사용자 제외 기본 목록, 정상 대상 명시적 제외 선택기, 위험 대상 진단 집계 |
| 설정 백업·복구 | ✅ 완료 | Registry·route·외부 선택·사용자 제외 portable schema v2, 적용 전 추가·충돌·삭제 미리보기, legacy 이관·미래 schema 거부 |
| 안정성 계측 | ✅ 완료 | source·profile 전환 표본의 core 자원과 외부 observer 제한 판정; 외부 target·binding·listener는 현재 진단 스냅샷에서 교차 확인 |
| 자동 검사 | ✅ 완료 | 단위·통합·수명주기·보안 경계·버전 일치 검사 240개 통과 |
| DOM·공개 API 샌드박스 | ✅ 완료 | 기본 24개·native 선택·외부 모델 컨트롤, provider/source 선택기 보존·개발자 route API와 정리 수명주기 확인 |
| Chromium UI 회귀 검사 | ✅ 완료 | 실제 `settings.html`, SillyTavern 1.18.0 고정 CSS, 브라우저 native 재사용과 공용 provider hook fixture를 확인하는 Playwright Chromium UI 회귀 검사 15개 통과 |
| 사용자 실제 계정 검증 | 🧪 대기 | [통합 체크리스트](./USER_CHECKLIST.md)를 사용하는 연결에서 한 번 수행 |

## 지원 기준

| SillyTavern 버전 | 판정 | 정책 |
|---|---|---|
| `1.18.0` | ✅ 자동 계약 검증 기준 | provider selector·setting·event·Connection Manager API 검사 |
| `1.18.0` 미만 | ❌ 비지원 | manifest 최소 버전과 진단에서 중단 |
| `1.18.0` 초과 | ⚠️ 최소 버전 충족·미검증 | 진단을 실행하고 실제 요청을 체크리스트로 확인 |

샌드박스와 UI 회귀 검사는 DOM·공개 API 계약, 실제 설정 마크업과 SillyTavern CSS의 배치·상호작용을 확인합니다. v0.6.15 native reuse fixture는 기존 provider option의 정확한 분류와 provider별 모델 projection만 검증하며 실제 외부 handler를 실행하지 않습니다. 공개 hook fixture는 별도로 실제 제품 모듈과 wiring을 사용하지만 Connection Manager 서비스와 네트워크는 가짜 구현입니다. 전체 SillyTavern 런타임, 실제 외부 확장 코드, 제공업체 인증·원격 네트워크 요청 성공을 대신하지 않습니다.

### 검증 상태별 외부 확장 목록

| 외부 확장·기능 | 자동 검증 상태 | 사용자 검증 게이트 |
|---|---|---|
| Caption | ✅ 실제 1.18.0 `.caption_settings` 경계와 `caption_multimodal_api`/`caption_multimodal_model`, native 상태 보존, Custom exact projection, `data-type` metadata, 선택 이벤트·재렌더 계약 자동 검증 | 🧪 실제 `/caption-image` handler의 Custom 모델 사용, payload의 `model`, 계정 권한과 모델 멀티모달 호환 확인 대기 |
| Vectors | ✅ embedding·벡터화 모델 컨트롤을 비채팅 위험 대상으로 안전 제외하고 진단에만 집계 | 해당 안전 제외는 Chat Completion 또는 Vectors API 호환 인증이 아님 |
| Stable Diffusion | ✅ 이미지 생성 모델 컨트롤을 위험 대상으로 안전 제외하고 진단에만 집계 | 해당 안전 제외는 Chat Completion 또는 이미지 생성 API 호환 인증이 아님 |

이 표는 DOM 계약 또는 안전 제외 검증의 근거를 관리합니다. 실제 외부 확장 API와의 호환 인증 목록이 아니며, Caption의 실제 요청 성공은 사용자 검증 전까지 완료로 표시하지 않습니다.

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
- [x] 진단에는 외부 직접 연결과 비채팅·비호환 제외를 구분하되 일반 관리 화면에는 정상 감지 상태를 노출하지 않음

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

## v0.6.8 — 외부 target 식별 안정화와 진단 정합성

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 환경 검증 대기**

### 수정 배경

같은 외부 확장 영역에 ID 없이 동일한 name·label을 쓰는 모델 칸이 여러 개 있으면 이전 target ID 계산이 같은 값을 만들 수 있었습니다. 이 경우 두 기능의 마지막 선택과 CMR 소유 datalist가 서로 섞일 수 있었습니다. 또한 장시간 안정성 표본이 아직 없다는 상태가 전체 진단을 주의로 올리고, 안정성 결과가 상세 `checks`와 합계에는 포함되지 않으며, 진단 복사가 오래된 결과를 재사용하는 정합성 문제가 있었습니다.

### 반영 결과

- [x] 동일 구조 외부 모델 칸의 첫 target ID는 하위 호환으로 유지하고 후속 대상은 구조 경로와 순서로 고유하게 구분
- [x] 동일 plain input마다 고유한 CMR datalist를 생성하고 재렌더 뒤에도 target별 마지막 선택을 독립 복원
- [x] DOM에 남은 `select`가 disabled·비대상 상태로 빠지면 native fallback과 외부 `change`를 함께 전달하고, readonly input은 현재 값을 보존하며, 분리된 이전 DOM에는 불필요한 이벤트를 보내지 않음
- [x] 장시간 안정성 활성 표본 0·1개를 오류·주의가 아닌 `pending` 계측 대기로 표시
- [x] 표본 2개 이상에서 평가한 안정성 결과를 정식 check와 합계에 포함해 `status`, `summary`, `counts`, `checks` 일치
- [x] 외부 모델 칸을 `후보 = 직접 연결 + 비채팅·비호환 제외`로 설명하고 observer·target·listener·binding 집계 불일치를 실패로 진단
- [x] 진단 복사 시 현재 런타임을 항상 다시 검사해 source·profile·외부 화면 변경 전의 오래된 JSON 재사용 방지
- [x] 진단 JSON schema v2로 `pending`·평가 여부·복구 check 계약을 명시하고 합계와 동기화
- [x] 손실 없는 스키마 이관은 통과 정보, 레코드 제외는 주의, 미래 스키마 거부는 오류로 분류하며 마지막 의미 있는 복구 보고서를 정상 설정 이벤트 뒤에도 비식별 코드로 보존
- [x] 정규화된 v2 설정의 비열거 `selectedModelId` 호환 getter를 실제 중복 선택으로 오진하지 않도록 고유 선택만 계수
- [x] `Popup.show()`의 동기 예외·non-Promise 반환을 정리해 고아 dialog와 열린 상태 고착 방지
- [x] 개발 검사 Node.js를 24로 갱신하고 GitHub Actions checkout·setup-node·upload-artifact를 Node 24 런타임 공식 버전의 full commit SHA로 고정하며 checkout 자격 증명을 작업 단계에 남기지 않음
- [x] Node 자동 검사 160개와 Playwright Chromium UI 회귀 검사 6개 통과

### 사용자 검증 초점

- [ ] 같은 외부 확장 화면에 이름이 같은 모델 칸 두 개가 있을 때 서로 다른 CMR 모델 선택이 재렌더 뒤에도 독립적으로 유지됨
- [ ] 확장 실행 직후 진단의 장시간 계측이 오류·주의가 아니라 미실시 상태로 표시되고, 두 번 이상 전환한 뒤 실제 판정으로 바뀜
- [ ] `진단 복사`를 누르기 직전에 바꾼 source·profile·외부 대상 개수가 복사 JSON에 반영됨
- [ ] 외부 모델 칸 후보 수가 직접 연결과 비채팅·비호환 제외 수의 합과 일치함
- [ ] 손실 없는 이관은 통과, 레코드 제외는 주의, 미래 스키마는 오류로 표시되고 마지막 경고·오류가 다음 정상 설정 이벤트에도 유지됨
- [ ] 같은 표식의 여러 외부 컨트롤을 모두 새 객체로 교체하며 순서까지 바꾸는 확장은 안정된 ID·name·label 또는 구조 표식 없이는 이전 선택 대응을 보장하지 않는다는 제한을 확인함

### 다음 자동화 보완 후보

현재 Playwright 검사는 제품 `settings.html`과 SillyTavern CSS를 사용하지만 동적 데이터와 Popup 수명주기는 검사용 fixture가 구성합니다. 실제 `index.js` 초기화·렌더 함수까지 실행하는 브라우저 통합 harness는 별도 후속 범위로 남기며, v0.6.8의 완료 근거를 전체 SillyTavern 런타임 E2E로 확대해 표현하지 않습니다.

## v0.6.9 — 외부 연결 예외 중심 UI와 schema v2

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 환경 검증 대기**

### 수정 배경

v0.6.6~v0.6.8의 관리 팝업은 안전한 외부 모델 칸을 모두 직접 연결하면서도 정상 대상 목록을 항상 노출했습니다. 사용자가 평상시에 결정할 것이 없는 상태 목록이 기본 UI를 복잡하게 만들었고, 목록의 연결 표시는 선택지 주입과 실제 요청 사용을 혼동하게 할 수 있었습니다. 반대로 특정 확장에서 CMR 주입이 문제를 일으킬 때 그 target만 제외하는 고급 예외 경로는 필요했습니다.

### 반영 결과

- [x] 기본 화면의 **다른 확장 모델 연결** 목록 제거; 모든 안전 대상은 별도 모드 선택 없이 자동 주입 유지
- [x] 선택지 bridge 실패 또는 observer·binding 런타임 불일치가 있을 때만 조건부 문제 경고 카드 표시
- [x] 경고 카드 아이콘에서 **호환성 진단 및 CMR 설정 백업 → 고급: 외부 연결 관리**를 열도록 연결
- [x] 고급 목록에 외부 확장 이름과 모델 control 이름을 함께 표시하고 `선택지 연결됨`, `연결 제외`, `안전상 제외`, `선택지 연결 실패`를 구분
- [x] `선택지 연결됨` 옆에 `실제 요청 확인 필요`를 명시해 best-effort UI 주입과 request body 검증을 분리
- [x] 안전 target을 아이콘으로 사용자 제외·복구하고 native option·현재 입력값·외부 인증 설정은 보존
- [x] 사용자 제외와 Vectors·embedding·TTS·Stable Diffusion 등 비채팅·비호환 위험 제외를 별도 상태·진단 수치로 유지
- [x] 외부 설정 schema v2에 명시적 `excludedTargets` 추가; 선택·제외 target 합집합 512개 제한과 오염 키·미래 schema 방어
- [x] schema v1 및 legacy provider·`manual`·`disabled` mapping은 폐기하고 과거 비활성을 사용자 제외로 되살리지 않으며 정상 `selectedModels`만 보존
- [x] portable backup schema v2가 외부 `selectedModels`와 schema v2 `excludedTargets`를 함께 round trip
- [x] 모델 추가 버튼을 텍스트 없는 `+` 아이콘으로 축소하고 `title`·`aria-label` 유지
- [x] Playwright Chromium UI 회귀 검사 8개로 320·360·420·720px 배치, 숨은 스크롤, 조건부 경고→고급 관리 이동, 문제 대상 제외·복구 포커스와 아이콘 전용 동작 검증

### 사용자 검증 초점

- [ ] 정상 상태에서 기본 팝업에 외부 대상 목록·문제 카드가 나타나지 않고 외부 안전 모델 칸에는 CMR 선택지가 표시됨
- [ ] 실제 bridge 또는 런타임 불일치에서만 문제 카드가 나타나며 아이콘을 누르면 해당 상태를 확인할 고급 관리가 열림
- [ ] 고급 목록의 확장·control 이름이 실제 대상과 일치하고 `선택지 연결됨`을 실제 요청 성공으로 오인하지 않음
- [ ] 한 안전 target을 제외하면 그 대상의 CMR 선택지만 정리되고 다른 target과 native 값은 유지되며, 다시 연결하면 선택지가 복원됨
- [ ] 비채팅·비호환 위험 제외는 사용자 제외와 별도로 표시되고 강제 복구 버튼이 나타나지 않음
- [ ] v0.6.8 이하 설정·백업 이관 뒤 정상 선택은 유지되지만 legacy `disabled`가 사용자 제외로 되살아나지 않음
- [ ] v0.6.9 백업 round trip 뒤 명시적 사용자 제외와 target별 마지막 provider 모델 선택이 함께 복원됨
- [ ] 외부 확장 기능을 실제로 실행해 Network payload의 `model`이 선택한 ID인지 별도로 확인함

## v0.6.10 — 대량 모델 관리·안전한 복구와 외부 UI 정리

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 환경 검증 대기**

### 수정 배경

등록 모델이 많아지면 전체 목록을 훑기 어렵지만 소량 사용자에게 항상 검색창을 노출할 필요는 없었습니다. 여러 ID 등록과 삭제 복원 경로가 없어 반복 작업도 컸습니다. 백업 가져오기는 적용될 변경을 충분히 보여주지 않았고, 설정 복구 경고는 무엇을 왜 제거했는지 설명이 부족했습니다. 외부 고급 관리에는 Vectors의 여러 벡터화 모델 칸 같은 안전상 제외 대상까지 행으로 나타나 정작 사용자가 조치할 예외를 찾기 어려웠으며, 외부 target과 Registry 모델이 함께 늘 때 생성되는 DOM option 규모도 알려주지 않았습니다.

### 반영 결과

- [x] 등록 모델이 12개를 넘을 때만 제공업체 이름·ID·모델 ID 검색 표시
- [x] 한 줄에 모델 ID 하나씩 최대 200개 일괄 등록; 빈 줄·중복은 건너뛰고 한 줄이라도 유효하지 않으면 전체 묶음을 적용하지 않는 원자적 검증
- [x] 모델 삭제 직후 실행 취소 버튼으로 방금 삭제한 provider·model 레코드 복원
- [x] portable backup 적용 전에 모델·선택·route·외부 설정의 추가·충돌·삭제 미리보기와 취소·명시적 적용 제공
- [x] 미리보기 이후 설정이 달라진 stale 적용과 현재 사용 중인 custom-only 모델 삭제를 차단
- [x] 설정 복구 상세에 제거·병합·정규화·미래 schema 거부의 사유 코드, action, 안전한 경로 범주와 개수 기록
- [x] 고급 외부 관리 기본 목록은 bridge 실패와 사용자 제외만 표시하고, 정상 direct 대상은 사용자가 **문제가 생긴 모델 칸 제외**를 펼쳤을 때만 선택기에 표시
- [x] Vectors·embedding·TTS·Stable Diffusion 등 위험 대상은 관리 행에서 숨기고 진단의 사유별 집계에만 유지
- [x] 외부 target 하나당 native 중복을 제외한 표시 가능 CMR 후보를 최대 512개까지 주입하고, target별 후보가 이를 넘으면 용량 주의 표시
- [x] 모든 direct target의 예상 CMR option 합계 또는 실제 CMR option 합계가 2,048개를 넘으면 성능 경고와 진단 주의 표시
- [x] README와 로드맵에 Caption DOM 계약 검증, Vectors·Stable Diffusion 안전 제외 검증과 실제 API 호환 인증의 경계를 표로 관리

### 사용자 검증 초점

- [ ] 모델 12개까지 검색이 숨고 13개부터 나타나며 제공업체와 모델 ID 검색 결과·개수가 정확함
- [ ] 최대 200줄 일괄 등록이 한 번에 저장되고 잘못된 한 줄이 있으면 일부 모델도 추가되지 않음
- [ ] 삭제 직후 실행 취소가 모델을 복원하며 다른 provider의 같은 ID와 섞이지 않음
- [ ] 백업 미리보기의 추가·충돌·삭제가 실제 적용 결과와 일치하고 취소 전후 현재 설정이 유지됨
- [ ] 복구 진단에서 제거된 레코드의 종류·사유·개수를 알 수 있으나 모델 ID·target ID·profile ID·비밀정보는 노출되지 않음
- [ ] 평상시 고급 기본 목록은 비어 있고 문제 target 제외 선택기를 직접 펼쳤을 때만 정상 연결 대상이 보임
- [ ] Vectors와 Stable Diffusion의 여러 모델 칸은 고급 관리 행에 나타나지 않지만 진단의 위험 제외 개수에는 포함됨
- [ ] 각 target에서 native 중복을 제외한 표시 가능 CMR 후보가 512개를 넘을 때만 용량 주의가 나타나고, 전체 예상 또는 실제 CMR option 합계가 2,048개를 넘을 때 성능 주의가 나타나며 native option은 유지됨

## v0.6.11 — 단일·여러 줄 모델 등록 UI 통합

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 환경 검증 대기**

### 수정 배경

모델 ID 하나를 등록하는 입력란과 여러 모델을 등록하는 접이식 입력란이 같은 목적을 중복해서 보여 주었습니다. 사용자는 어느 입력란을 사용해야 하는지 판단해야 했고, 같은 제공업체 규칙과 등록 동작이 두 경로로 나뉘어 있었습니다.

### 반영 결과

- [x] 단일 모델과 여러 모델 ID를 `#cmr_model_id` textarea 하나에서 입력
- [x] `#cmr_add_form` submit과 접근 가능한 `+` 아이콘 버튼 하나만 유지
- [x] 한 줄 입력과 최대 200줄 입력에 같은 중복 건너뛰기·원자 검증 적용
- [x] 별도 `cmr_bulk_*` 접이식 UI·폼·입력·텍스트 버튼 제거
- [x] 320·360·420·720px에서 textarea·아이콘 정렬과 가로 넘침을 기존 Playwright 회귀 검사로 확인

### 사용자 검증 초점

- [ ] 모델 ID 하나를 입력하고 `+` 아이콘을 누르면 한 모델만 등록됨
- [ ] 같은 입력란에 여러 ID를 한 줄에 하나씩 넣으면 최대 200개까지 한 번에 등록됨
- [ ] 잘못된 행이 하나라도 있으면 유효한 행까지 포함해 아무 모델도 등록되지 않음
- [ ] 별도 `여러 모델 한꺼번에 등록` 접이식 UI나 두 번째 등록 버튼이 나타나지 않음
- [ ] 좁은 화면에서도 textarea와 `+` 아이콘이 겹치거나 가로로 넘치지 않음

## v0.6.12 — 런처 배지 제거와 설명 정보 구조 정리

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 환경 검증 대기**

### 수정 배경

Connection Profile 도구행의 관리 아이콘 옆 숫자 배지는 기능을 설명하지 않으면서 작은 화면에서 별도 상태처럼 보였습니다. 관리 팝업은 각 기능의 보조 설명을 모두 본문에 펼쳐 두어 개별 문구는 이해할 수 있어도 전체 화면의 정보 밀도가 높았습니다.

### 반영 결과

- [x] 런처의 보이는 모델 수 배지를 제거하고 관리 아이콘 하나만 표시
- [x] 스크린 리더용 런처 이름에는 등록 모델 수와 지원 모델 컨트롤 감지 오류를 유지
- [x] 제공업체·모델 ID·등록 목록·진단 및 백업·외부 연결의 보조 설명을 native popover 정보 아이콘 5곳으로 이동
- [x] 각 정보 아이콘에 고유한 접근 가능한 이름과 연결된 도움말 ID를 제공
- [x] 등록 위치, 한 줄당 모델 ID 하나·최대 200개·오류 시 전체 취소, 비밀정보 제외와 실제 외부 요청 확인 등 핵심 안내는 상시 표시
- [x] `지원 범위 및 개인정보`를 표준 Chat Completion 지원, 비채팅·자체 위젯 제외, 저장·백업하지 않는 비밀정보의 3문장으로 축약
- [x] 320·360·420·720px에서 popover와 아이콘이 잘리거나 가로로 넘치지 않는지 기존 UI 회귀 검사에 포함

### 사용자 검증 초점

- [ ] Connection Profile 도구행에 숫자 배지 없이 관리 아이콘 하나만 보임
- [ ] 스크린 리더는 관리 아이콘에서 등록 모델 수를 계속 안내함
- [ ] 정보 아이콘 5곳을 마우스·터치·Tab과 Enter 또는 Space로 열고 Escape로 닫을 수 있음
- [ ] 좁은 화면과 Popup 스크롤 위치에서도 열린 도움말이 화면 밖으로 잘리거나 컨트롤을 영구적으로 가리지 않음
- [ ] 도움말을 열지 않아도 등록 단위·200개 한도·전체 취소, 비밀정보 제외와 실제 요청 확인 안내를 볼 수 있음
- [ ] 오류·주의·백업 충돌·복구 상세 같은 동적 상태가 popover 안으로 숨지 않음

## v0.6.13 — 외부 provider/source 선택기 오탐 차단

상태: **✅ 구현·자동 검사 완료, 🧪 사용자 환경 검증 대기**

### 수정 배경

외부 확장의 provider/source 선택기 이름에 `model`이 포함되면 이를 실제 모델 control로 오인해 등록 모델 option을 주입할 수 있었습니다. 이 경우 사용자가 모델 ID를 provider 값처럼 선택하게 되어 외부 확장의 native provider 계약을 깨뜨릴 수 있었습니다.

### 반영 결과

- [x] 외부 provider/source 선택기는 이름에 `model`이 포함되어도 모델 target으로 분류하지 않음
- [x] provider/source 선택기에 CMR option과 모델 선택 listener를 추가하지 않고 native option·현재 값·기존 이벤트를 보존
- [x] 실제 모델 control에서는 연결된 provider/source 선택기를 provider metadata와 change/input 재동기화 감시에만 사용
- [x] 같은 외부 확장 경계에 provider 후보가 여러 개면 첫 후보를 임의로 연결하지 않음
- [x] provider/source 선택기를 진단 `targetCount`와 외부 모델 후보 partition에 포함하지 않음
- [x] Node 자동 검사 209개와 Playwright Chromium UI 회귀 검사 11개로 provider 선택기 비오염과 실제 model control 주입을 검증

### 사용자 검증 초점

- [ ] `Model Provider`처럼 이름에 `model`이 있는 provider/source 선택기에도 native provider option만 보임
- [ ] provider/source 선택의 현재 값이 CMR 활성화·재탐지 전후에 바뀌지 않음
- [ ] 실제 model control에는 등록 모델이 표시되고 provider 전환 뒤 metadata·필터가 정상 갱신됨
- [ ] provider 후보가 여러 개여도 임의 후보의 값이나 option이 변경되지 않음
- [ ] 진단의 외부 `targetCount`가 provider/source 선택기를 모델 target으로 세지 않음

## v0.6.14 — 선택된 Connection Profile 기반 공용 provider 연동

상태: **✅ 구현·자동 검사 완료, 🧪 공개 hook을 제공하는 실제 외부 확장 검증 대기**

### 수정 배경

기존 DOM 브리지는 외부 확장의 표준 모델 컨트롤에 모델 선택지를 표시할 수 있지만, 그 확장에 없던 provider 요청 handler까지 만들 수는 없습니다. 구조가 알려진 특정 확장의 비공개 배열·handler를 강제로 수정하는 전용 어댑터는 이번 범위에서 제외하고, 여러 확장이 명시적으로 채택할 수 있는 세 가지 공용 경계만 추가합니다.

### 반영 결과

- [x] 공개 Registry API를 하위 호환 `1.2.0`으로 올리고 `CustomModelRouter.integrations`에 Provider Integration API `1.0.0`을 노출
- [x] **SillyTavern 연결 상속**: 현재 선택된 Connection Manager Chat Completion 프로필의 source가 CMR Registry provider와 일치할 때 비-Custom provider handler와 해당 provider의 활성 모델만 준비
- [x] **OpenAI-compatible 특화**: 현재 선택된 Connection Manager 프로필이 `Custom` source일 때만 `custom` Registry 모델과 OpenAI-compatible handler를 준비
- [x] **공개 provider registry/hook**: 외부 확장이 버전·capability·slot과 `installHandler`·`publishModels` hook을 명시적으로 등록하는 공용 계약 제공
- [x] handler 설치 영수증을 먼저 확인한 뒤 모델 게시를 호출하고, 게시 영수증까지 확인된 경우에만 provider binding을 `ready`로 공개
- [x] handler 설치·모델 게시·갱신 실패, 소비 확장 해제, CMR 비활성화와 늦은 응답에서 확보한 외부 자원을 한 번씩 정리하고 준비되지 않은 UI를 공개하지 않음
- [x] 요청 입력을 Registry의 해당 provider 활성 모델과 단순 Chat Completion allowlist로 제한하고 실패 시 다른 provider·모델 또는 메인 채팅으로 자동 대체하지 않음
- [x] API 키와 endpoint는 CMR에 복제하지 않고 선택된 Connection Manager 프로필이 계속 소유하며 메인 Chat Completion source·모델을 변경하지 않음
- [x] 공개 hook이 없거나 계약·capability가 맞지 않는 임의 확장의 provider UI에는 provider나 모델을 강제로 삽입하지 않음
- [x] 기존 v0.6 DOM 모델 브리지는 유지하고, hook 소유 provider UI는 `data-cmr-provider-hook-owned` 표식으로 중복 DOM 주입을 피함
- [x] Node 자동 검사 232개와 Playwright Chromium UI 회귀 검사 14개로 두 Connection Profile 전략, 2단계 ACK, 실패·취소·종료 정리와 hookless 비변경 경계를 검증

### 사용자 검증 초점

- [ ] 공개 Provider Integration API `1.0.0`에 opt-in한 확장에서 handler 설치 확인 전에는 CMR provider·모델 UI가 나타나지 않음
- [ ] handler 설치와 모델 게시 확인이 모두 성공하면 선택된 일반 Connection Profile source의 CMR 모델만 나타나고 실제 요청이 그 프로필로 전달됨
- [ ] 선택된 `Custom` Connection Profile에서는 OpenAI-compatible provider와 `custom` Registry 모델만 나타나고 endpoint·API 키를 CMR에 다시 입력하지 않아도 요청됨
- [ ] 선택된 Connection Profile을 바꾸거나 없애면 이전 binding·provider UI·진행 중 요청이 정리되고 새 조건이 충족될 때만 다시 준비됨
- [ ] 공개 hook이 없는 외부 확장의 provider UI는 변경되지 않지만, 기존 DOM 브리지 대상인 표준 모델 컨트롤에는 종전과 같은 CMR 모델 선택지가 유지됨
- [ ] 진단 JSON에는 consumer·pending·ready·failed·published model 개수만 보이고 profile ID·endpoint·API 키는 나타나지 않음

## v0.6.15 — Hookless native provider option 모델 재사용

상태: **✅ 구현·자동 검사 완료, 🧪 실제 외부 확장 handler·요청 검증 대기**

### 수정 배경

공개 hook이 없는 확장이라도 자체 Custom/OpenAI-compatible 또는 SillyTavern 현재 연결 option을 이미 제공하는 경우가 있습니다. 이때 새 provider handler나 credential bridge를 강제로 설치할 필요는 없지만, 기존 v0.6 DOM 브리지가 모든 provider 모델을 함께 표시하면 그 native handler와 맞지 않는 선택지가 생길 수 있습니다. DOM option은 실제 요청 구현을 증명하지 않으므로, 이번 범위는 확인 가능한 exact 선택에 맞는 Registry 모델만 보수적으로 투영하는 데 한정합니다.

### 반영 결과

- [x] hookless native 재사용을 Provider Integration API의 공개 hook·handler 경로와 분리
- [x] 정확한 Custom/OpenAI-compatible provider 선택에는 활성 `custom` Registry 모델만 model control에 투영
- [x] 정확한 SillyTavern/current-connection provider 선택에는 현재 활성 SillyTavern provider와 같은 Registry 모델만 투영
- [x] `main`, `current`, `inherit`, `openai`, `st` 같은 단독·모호한 토큰과 충돌하는 값·라벨은 native 재사용으로 분류하지 않음
- [x] exact 현재 연결 option인데 활성 ST provider가 없거나 지원 provider로 확정되지 않으면 `sillytavern-current` 분류를 유지한 `current-connection-unavailable` 실패로 표시하고, 모델을 넣거나 전체 provider·`custom`으로 fallback하지 않음
- [x] 외부 확장의 native provider option·option value·현재 선택, endpoint·API 키와 기존 모델 값을 보존
- [x] 전역 `fetch`·`XMLHttpRequest`, 외부 요청 함수와 SillyTavern 메인 source·모델·Connection Profile을 patch하거나 전환하지 않음
- [x] 분류 결과를 새 handler·provider 지원 또는 요청 호환성으로 보고하지 않고 실제 기능 실행과 request payload 확인을 사용자 검증 게이트로 유지
- [x] 진단에 native Custom·현재 연결 대상, projection 성공과 현재 연결 확인 불가 개수를 불변식과 함께 집계하고 option 원문·endpoint·API 키는 제외
- [x] Node 자동 검사 240개와 Playwright Chromium UI 회귀 검사 15개로 exact 분류·provider별 projection·모호성 거부·불변 경계를 검증

### 사용자 검증 초점

- [ ] 외부 확장의 exact Custom/OpenAI-compatible option을 선택하면 Custom Registry 모델만 표시되고 다른 provider 모델은 나타나지 않음
- [ ] 외부 확장의 exact SillyTavern 현재 연결 option을 선택하면 현재 메인 provider와 같은 Registry 모델만 표시됨
- [ ] provider option·값, endpoint·API 키와 메인 Chat Completion source·모델이 모델 투영 전후에 동일함
- [ ] `main`, `current`, `inherit`, `openai`, `st` 단독 표식은 native 재사용 특화 대상으로 오인되지 않음
- [ ] exact 현재 연결 option에서 활성 ST provider를 확인할 수 없으면 확인 필요 실패로 나타나고 어떤 Registry 모델도 표시되지 않으며, provider가 다시 유효해진 뒤 해당 provider 모델만 복원됨
- [ ] 표시된 모델을 선택해 외부 기능을 실행한 뒤 실제 request payload의 `model`과 성공·실패 결과를 직접 확인함
- [ ] 공개 hook 소비 확장의 `installHandler`→`publishModels` 준비·정리 계약은 native 재사용과 섞이지 않고 계속 동작함

## 실제 사용자 검증 게이트

다음 조건은 자동 검사만으로 완료 처리하지 않습니다.

1. 설치 전 기존 provider 연결이 정상 동작합니다.
2. 등록 ID가 실제 요청의 `model`로 전달됩니다.
3. 일반·스트리밍 요청이 모두 성공하거나 제공업체 오류가 그대로 표시됩니다.
4. 새로고침, source 전환, 원격 목록 갱신과 profile 왕복 뒤 선택이 정확합니다.
5. 개발자 Routing API의 보조 route 실행 전후 메인 source·모델이 같습니다.
6. 20회 이상 source·profile 전환 뒤 진단에서 자원 증가가 없습니다.
7. 백업 round trip 뒤 Registry·route·외부 target별 마지막 CMR 선택·provider 식별자와 schema v2 사용자 제외가 복원되고 연결 비밀은 남지 않습니다.
8. 외부 확장 모델 컨트롤에서는 등록 ID가 표시될 뿐 아니라 실제 요청의 `model`에 전달됩니다.
9. 비대상 모델 컨트롤은 변경되지 않고, 감지된 안전한 표준 Chat Completion 대상은 별도 모드 없이 자동 주입되며 사용자 제외 target만 건너뜁니다.
10. 공개 API도 현재 사용 중인 select형 custom-only 모델을 native 전환 전에 지우지 못합니다.
11. 외부 선택 저장이 512개 한계에 도달해도 유효한 이관 선택과 현재 감지 target의 새 선택은 보존됩니다.
12. 관리 목록은 전체 provider 모델을 기본 표시하며 단일·여러 줄 공용 입력, 6개 초과 숨은 스크롤, 12개 초과 조건부 검색, 최대 200줄 원자 등록, 삭제 실행 취소, 작은 삭제 버튼과 공식 닫기 하나를 유지합니다.
13. 정상 외부 대상은 기본 고급 목록에 나타나지 않고 명시적으로 펼친 제외 대상 선택기에만 표시되며, 위험 대상은 관리 UI가 아니라 진단 집계에서 확인합니다.
14. 백업은 적용 전에 추가·충돌·삭제 미리보기를 제공하고 설정 복구는 무엇을 왜 제거·병합·정규화했는지 안전한 코드와 개수로 설명합니다.
15. target별 native 중복 제외 후보 512개·전체 예상 또는 실제 CMR option 합계 2,048개 경고가 각각의 대량 조건에서 정확히 나타나며 native 선택지는 유지됩니다.
16. 관리 런처에는 보이는 숫자 배지가 없고 스크린 리더용 등록 개수는 유지되며, 정보 아이콘 5곳은 키보드·터치·Escape로 조작할 수 있습니다.
17. GitHub Actions의 UI 회귀 검사 증거와 실제 설치 화면을 비교해 SillyTavern 런타임에서만 생기는 차이가 없는지 확인합니다.
18. 외부 provider/source 선택기는 이름에 `model`이 포함되어도 모델 target으로 세지 않고 native option·현재 값을 유지하며, 실제 model control의 metadata·변경 감시에만 사용합니다.
19. 공개 provider hook 소비 확장은 handler 설치와 모델 게시를 모두 확인한 뒤에만 준비 상태를 표시하고, 둘 중 하나라도 실패하면 provider UI를 공개하지 않습니다.
20. SillyTavern 연결 상속은 선택된 비-Custom Connection Profile과 같은 Registry provider에만, OpenAI-compatible 특화는 선택된 `Custom` 프로필과 `custom` Registry 모델에만 적용됩니다.
21. hookless 임의 확장 provider UI는 변경되지 않고 기존 DOM 모델 브리지는 계속 독립적으로 동작하며, CMR 설정·진단·이벤트에는 API 키와 endpoint가 복제되지 않습니다.
22. hookless exact Custom/OpenAI-compatible 선택에는 `custom` Registry 모델만, exact SillyTavern 현재 연결 선택에는 현재 활성 ST provider 모델만 투영됩니다.
23. native 재사용 전후 provider option·값·endpoint·API 키·전역 요청 함수·메인 설정은 바뀌지 않고, 외부 handler의 실제 `model` 사용은 기능 실행으로 별도 확인합니다.

실제 검증에서 발견되는 v0.6 범위의 후속 결함은 `v0.6.16`, `v0.6.17`, ... 패치 버전으로 수정합니다.

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
| v0.3.0 | ✅ 구현 완료 | 공개 Registry API 도입; 현재 계약은 `1.2.0` |
| v0.4.0 | ✅ 구현 완료 | Connection Profile 어댑터와 용도별 라우팅 |
| v0.5.0 | ✅ 완료·범위 정정 | 진단·설정 복구·백업·안정성 검증; 기존 외부 확장 자동 연동은 포함하지 않았음 |
| v0.6.0 | ✅ 구현 완료·🧪 사용자 검증 대기 | 범용 DOM 모델 브리지, 수동 mapping, 외부 연결 portable schema v2 |
| v0.6.1 | ↩️ 롤백 | 관리 팝업 UI·UX 재구성은 사용자 피드백에 따라 철회 |
| v0.6.2 | ✅ 롤백 릴리스 | v0.6.0 UI 복원, 기능 역할·정보 구조 재논의와 v0.6.3 합의 확정 |
| v0.6.3 | ✅ 완료 | 등록·삭제 전용 UI, native 선택, 외부 자동 추론, 개발자 Routing API 유지 |
| v0.6.4 | ✅ 완료 | 공개 API 삭제 안전성, legacy mapping 선택 우선 이관, stale 외부 선택 저장 회복 |
| v0.6.5 | ✅ 완료 | 전체 등록 목록·UI 정리, 외부 직접 연결과 연결 안 함 회귀 복구 |
| v0.6.6 | ✅ 완료·🧪 사용자 검증 대기 | 외부 연결 단일화, 중복 자원 진단 오탐·중복 닫기·추가 버튼 수정 |
| v0.6.7 | ✅ 완료 | SillyTavern 1.18.0 CSS 기반 Chromium UI 회귀 검사 6개와 CI 증거 보관 |
| v0.6.8 | ✅ 완료 | 외부 target 식별 안정화, 진단 정합성, Popup 실패 정리와 CI Action 갱신 |
| v0.6.9 | ✅ 완료·🧪 사용자 검증 대기 | 정상 외부 목록 숨김, 조건부 문제 카드, 고급 제외·복구, 외부 설정 schema v2와 아이콘 전용 추가 버튼 |
| v0.6.10 | ✅ 완료·🧪 사용자 검증 대기 | 대량 모델 관리, 삭제 실행 취소, 백업 미리보기·복구 상세, 예외 중심 외부 관리와 DOM option 경고 |
| v0.6.11 | ✅ 완료·🧪 사용자 검증 대기 | 단일·여러 줄 모델 등록을 공용 textarea와 아이콘 버튼 하나로 통합 |
| v0.6.12 | ✅ 완료·🧪 사용자 검증 대기 | 런처 숫자 배지 제거, 핵심 한 줄 안내와 native popover 정보 아이콘 5곳, 지원·개인정보 문구 축약 |
| v0.6.13 | ✅ 완료·🧪 사용자 검증 대기 | 외부 provider/source 선택기 오탐 차단, native option·값 보존, 모호한 provider 후보 임의 연결 방지 |
| v0.6.14 | ✅ 완료·🧪 사용자 검증 대기 | 선택된 Connection Manager 프로필 기반 일반·Custom 공용 handler, Provider Integration API `1.0.0`, 2단계 준비·정리 계약 |
| v0.6.15 | ✅ 현재 릴리스·🧪 사용자 검증 대기 | hookless 기존 Custom·SillyTavern 현재 연결 provider option의 보수적인 provider별 모델 projection |
