# 개발 로드맵과 현재 진행 상태

마지막 업데이트: **2026-08-18**

현재 릴리스: **v0.3.0**

현재 단계: **공개 Registry API 구현·자동 검사 완료, v0.4.0 용도별 라우팅 구현 진행 예정**

## 상태 범례

| 표시 | 의미 |
|---|---|
| ✅ 완료 | 코드와 자동 검증 근거가 저장소에 반영됨 |
| 🧪 검증 대기/중 | 구현은 완료됐고 실제 사용자 계정·화면의 확인을 기다리거나 진행 중임 |
| 🚧 진행 중 | 현재 코드나 문서를 작업 중임 |
| 📝 예정 | 범위만 정했으며 아직 구현을 시작하지 않음 |
| ⏸ 보류 | 선행 조건이나 외부 변경을 기다림 |

실제 API 호출에는 사용자 자격 증명, 모델 권한, 지역별 제공 여부가 필요합니다. 따라서 자동 테스트 통과와 실제 계정 검증은 항상 별도 상태로 기록합니다.

## 지금 어디까지 진행됐나

| 단계 | 상태 | 결과 또는 다음 행동 |
|---|---|---|
| SillyTavern 1.18 Chat Completion 조사 | ✅ 완료 | 26개 source 중 모델 값으로 연결되는 24개와 구조적 제외 2개를 확인 |
| provider descriptor | ✅ 완료 | selector, 설정 키, 요청 규격, 적용 이벤트, fallback을 24개 연결별로 정의 |
| schema v2 Registry | ✅ 완료 | 제공업체+모델 ID 복합키, 제공업체별 선택 상태, v1 Vertex 데이터 자동 이관 구현 |
| 공통 관리 UI | ✅ 완료 | 제공업체 그룹 선택, 동적 입력 안내, 압축 모델 목록, 연결 상태 안내 구현 |
| 기본 컨트롤 연동 | ✅ 완료 | select형 23개와 input형 Custom의 native change/input 흐름 연동 |
| 목록 재생성·Profile 대응 | ✅ 완료 | 원격 목록 재렌더링, source 전환, Connection Profile 변경 뒤 재주입·복원 구현 |
| 자동 검사 | ✅ 완료 | 단위·통합·수명주기·버전 일치 검사 38개 통과 |
| 사용자 체크리스트 | ✅ 완료 | 공통 항목, 24개 제공업체 조건부 매트릭스, Z.AI (GLM) 특별 항목 제공 |
| 공개 Registry API | ✅ 완료 | 전역 1.0.0 계약, 복합키 조회·변경, 불변 스냅샷, 이벤트와 종료 동작 구현 |
| 실제 제공업체 계정 검증 | 🧪 대기 | 사용자가 쓰는 연결부터 일반·스트리밍·복원 요청 확인 |
| v0.2 안정화 | 🧪 대기 | 실제 실패가 확인되면 `v0.2.2+` 패치로 수정 |

## v0.2.0 구현 범위

### 등록 가능한 24개 연결

| 그룹 | 제공업체 또는 연결 |
|---|---|
| 모델 개발사 API 14개 | OpenAI, Anthropic, AI21, Cohere, DeepSeek, Google AI Studio, Google Vertex AI, Groq, Mistral AI, MiniMax, Moonshot AI (Kimi), Perplexity, xAI, Z.AI (GLM) |
| 라우터·호스팅 9개 | AI/ML API, Chutes, Cloudflare Workers AI, ElectronHub, Fireworks AI, NanoGPT, OpenRouter, Pollinations, SiliconFlow |
| 사용자 지정 1개 | Custom OpenAI-compatible |

Z.AI (GLM), DeepSeek, Moonshot AI (Kimi), MiniMax, SiliconFlow는 v0.2.0의 명시적 지원 대상입니다. `Custom OpenAI-compatible`은 별도 업체·지역 endpoint나 사용자가 직접 운영하는 OpenAI-compatible 서버의 모델 ID를 기존 Custom 연결에 적용하는 용도입니다.

### 구조적 제외 2개

- **Azure OpenAI**: 실제 요청 대상은 `deployment name`이 결정하고 model 값은 대상 선택에 쓰이지 않으므로 ID-only 구조에서 제외합니다.
- **CometAPI**: SillyTavern 1.18.0 코어에서 provider 요청이 비활성화되어 있어 제외합니다.

두 항목은 단순 미구현이 아니라 현재 SillyTavern 요청 구조를 근거로 회계 처리하며, 코어 계약이 바뀌면 다시 조사합니다.

### 저장과 이관

- schema v2는 각 모델을 `provider + model ID` 복합키로 구분합니다.
- 선택 상태는 `selectedModels[provider]`에 제공업체별로 분리합니다.
- schema v1 또는 기존 `selectedModelId`의 Vertex 데이터는 `vertexai` 레코드로 자동 이관합니다.
- 잘못된 provider, 허용되지 않는 ID, 중복 레코드, 손상된 protocol은 정규화 과정에서 제거하거나 descriptor 값으로 복구합니다.
- 미래 버전 schema를 v1로 잘못 해석하지 않습니다.

### 변경하지 않는 설정

확장은 모델 값과 자체 Registry만 다룹니다. 다음 값은 읽거나 자체 설정으로 저장하지 않습니다.

- API 키와 Service Account
- endpoint URL과 지역별 endpoint 선택
- 프로젝트 ID, Account ID, 리전
- 프록시와 연결 필터
- Connection Profile의 다른 생성 설정

### 요청 계약 제한

v0.2.0은 새 API 구현이 아니라 기존 SillyTavern Chat Completion source에 모델 ID를 전달하는 계층입니다. 등록 모델은 해당 source의 현재 인증·요청·응답 규격과 호환되어야 합니다.

- 새 endpoint, API 버전, deployment name 또는 인증 방식은 자동 지원하지 않습니다.
- 신모델 전용 thinking, tool, 이미지, prefill 또는 응답 변환 규칙은 별도 어댑터가 필요할 수 있습니다.
- 원격 카탈로그에 없는 모델은 context, 가격, 멀티모달 capability metadata가 없을 수 있습니다.
- 제공업체별 이름 기반 파라미터 보정은 신모델에서 실제 요청을 확인해야 합니다.

## v0.2.x 현재 게이트

### 구현·자동 검증 게이트

- [x] 24개 지원 provider descriptor 작성
- [x] Azure OpenAI와 CometAPI 구조적 제외를 코드와 문서에 기록
- [x] Z.AI (GLM), DeepSeek, Moonshot AI (Kimi), MiniMax, SiliconFlow 포함
- [x] 제공업체별 모델 ID 검증 규칙 분리
- [x] schema v1→v2 무손실 이관
- [x] 제공업체별 등록·선택·삭제 상태 격리
- [x] select형 모델 컨트롤의 사용자 optgroup 멱등 주입
- [x] Custom input형 연결의 input 이벤트 적용
- [x] source·Connection Profile·원격 목록 재생성 뒤 선택 복원
- [x] API Connections 공식 팝업과 압축 목록 유지
- [x] 확장 비활성화 시 옵션·이벤트·팝업 정리
- [x] 민감한 연결 설정 비저장 원칙 유지
- [x] 자동 검사 전체 통과
- [x] 한글 README·로드맵·사용자 검증 체크리스트 갱신

### 실제 계정 검증 게이트

- [ ] Z.AI (GLM) Common 또는 Coding endpoint에서 일반 요청 통과
- [ ] Z.AI (GLM) 스트리밍 요청과 새로고침 복원 통과
- [ ] DeepSeek 사용자 모델 실제 요청 통과
- [ ] Moonshot AI (Kimi) 사용자 모델 실제 요청 통과
- [ ] MiniMax Global 또는 CN endpoint 실제 요청 통과
- [ ] SiliconFlow Global 또는 CN endpoint 실제 요청 통과
- [ ] 사용자가 실제 사용하는 나머지 제공업체 조건부 행 통과
- [ ] Connection Profile 전환과 원격 목록 재생성 환경 통과
- [ ] 발견된 치명·높은 우선순위 결함 해결
- [ ] 실제 검증 결과와 알려진 제한을 문서 또는 Issues에 기록

구현 게이트가 완료됐다고 해서 위 실제 계정 항목까지 통과한 것으로 간주하지 않습니다. 사용자 결과를 받으면 [USER_CHECKLIST.md](./USER_CHECKLIST.md)의 항목 ID를 근거로 상태를 갱신합니다.

## 제공업체 실제 검증 진행판

상태: **모두 결과 보고 대기**

| 연결 | 등록·적용 | 일반 응답 | 스트리밍 | 새로고침·Profile | 종합 상태 |
|---|---|---|---|---|---|
| Z.AI (GLM) | ⬜ | ⬜ | ⬜ | ⬜ | 🧪 대기 |
| DeepSeek | ⬜ | ⬜ | ⬜ | ⬜ | 🧪 대기 |
| Moonshot AI (Kimi) | ⬜ | ⬜ | ⬜ | ⬜ | 🧪 대기 |
| MiniMax | ⬜ | ⬜ | ⬜ | ⬜ | 🧪 대기 |
| SiliconFlow | ⬜ | ⬜ | ⬜ | ⬜ | 🧪 대기 |
| Google Vertex AI | ⬜ | ⬜ | ⬜ | ⬜ | 🧪 v0.2 재검증 대기 |
| 기타 지원 연결 | ⬜ | ⬜ | ⬜ | ⬜ | 🧪 사용하는 연결부터 확인 |

`⬜`는 실패가 아니라 미확인입니다. 결과는 `✅ 통과`, `❌ 실패`, `⏸ 차단`, `해당 없음` 중 하나로 갱신하고, 인증 값·전체 프로젝트 ID·Account ID는 기록하지 않습니다.

## 버전별 계획

### v0.1.x — Vertex Gemini 기반 확립

상태: **✅ 완료**

- `v0.1.0` ✅ Vertex Gemini 사용자 모델 Registry와 기본 선택기 연동
- `v0.1.1` ✅ 사용자 검증 체크리스트와 진행 로드맵
- `v0.1.2` ✅ API Connections 모델 관리 아이콘, 공식 팝업, 압축 목록

v0.1의 등록값과 선택 상태는 v0.2 schema로 자동 이관합니다. 기존 사용자의 기본 동작 확인은 완료됐지만, 실제 인증 방식별 과거 미확인 결과를 소급해 통과로 표시하지 않습니다.

### v0.2.0 — 여러 제공업체의 사용자 모델 등록

상태: **🧪 구현·자동 검사 완료, 실제 계정 검증 대기**

- 24개 Chat Completion provider descriptor
- 공통 Registry UI와 제공업체별 선택 상태
- provider별 모델 ID 검증
- v1→v2 저장 설정 마이그레이션
- 원격 목록 재생성·source·Connection Profile 대응
- Z.AI (GLM), DeepSeek, Kimi, MiniMax, SiliconFlow 명시적 지원

완료 판단은 두 층으로 관리합니다.

1. 구현 완료: 코드, 자동 테스트, 문서가 일치하고 치명적 정적 결함이 없음 — ✅ 완료
2. 안정화 완료: 실제 사용하는 제공업체에서 필수 요청·복원 항목이 통과하고 높은 우선순위 결함이 없음 — 🧪 대기

실제 검증에서 확인되는 버그와 세부 호환성 수정은 `v0.2.2`, `v0.2.3`, ... 패치 버전으로 반영합니다.

### v0.3.0 — 공개 Registry API

상태: **✅ 구현·자동 검사 완료**

- 다른 확장이 `(provider, model ID)` 복합키와 제공업체별 선택 상태를 조회할 수 있는 안정 API
- capability metadata와 버전이 있는 계약
- 등록·변경 이벤트와 하위 호환 정책
- 직접 내부 파일 import 없이 사용하는 연동 예제

구현 결과:

- `globalThis.CustomModelRouter` 전역과 API 계약 `1.0.0`
- `(provider, model ID)` 복합키, 불변 snapshot과 revision
- 등록·삭제·Registry 선택 변경 및 구조화 이벤트
- 이름 충돌 방지, 구독자 오류 격리와 disable 시 API 제거
- [공개 API 문서](./API.md)와 독립 연동 예제

완료 조건: 공개 API 계약 문서, 변경 이벤트, 연동 예제와 독립 계약 테스트를 제공합니다. — ✅ 충족

### v0.4.0 — 확장 어댑터와 용도별 라우팅

상태: **📝 예정**

- 번역·요약·검색·captioning 등 보조 기능별 모델 선택
- 각 기능이 Registry의 `(provider, model ID)`를 직접 선택하는 명시적 설정
- 주요 API 사용 확장별 어댑터
- 어댑터가 없을 때 안전한 기본 동작
- 주 채팅 모델을 바꾸지 않는 보조 요청 라우팅

완료 조건: 지원 대상으로 명시한 확장에서 통합 검증을 통과하고 보조 요청 실패가 주 모델 설정을 바꾸지 않음을 확인합니다.

### v0.5.0 — 호환성과 운영 안정화

상태: **📝 예정**

- SillyTavern UI·이벤트 변경에 대한 호환 계층
- provider 요청 계약 변화 감지와 명확한 오류
- 설정 마이그레이션·복구·진단 도구
- 장시간 사용, 반복 프로필 전환, 확장 간 충돌 회귀 테스트

완료 조건: 지원 SillyTavern 버전별 회귀표, 설정 마이그레이션, 비활성화 복구와 알려진 제한 문서화를 완료합니다.

## 로드맵 업데이트 규칙

1. 기능·지원 범위·완료 조건이 바뀌는 커밋은 이 문서의 날짜, 현재 단계와 상태를 함께 갱신합니다.
2. 버그 수정이나 세부 문서 변경은 `v0.n.n` 패치 버전을 사용하고 새로운 기능 범위에서만 다음 `v0.n.0`으로 이동합니다.
3. 코드·자동 검사 완료와 실제 계정 검증 완료를 서로 다른 상태로 표시합니다.
4. API 자격 증명이 필요한 검증은 자동 검사와 분리해 `🧪`로 유지합니다.
5. 체크리스트 실패는 항목 ID로 Issues에 연결하고 수정 버전과 재검증 결과를 기록합니다.
6. 버전 변경 시 manifest, package, UI, 초기화 로그, README, 체크리스트와 로드맵 표기를 함께 맞춥니다.
7. 자동 테스트 개수가 바뀌면 README와 이 문서의 검사 개수도 함께 갱신합니다.
8. provider를 추가하거나 제외하면 지원 24개와 구조적 제외 2개의 회계 근거를 함께 갱신합니다.

## 릴리스 기록

| 버전 | 상태 | 핵심 내용 |
|---|---|---|
| v0.1.0 | ✅ 게시 | Vertex Gemini 사용자 모델 등록·선택·복원 최초 구현 |
| v0.1.1 | ✅ 게시 | 사용자 체크리스트와 진행 로드맵 추가 |
| v0.1.2 | ✅ 게시 | API Connections 관리 아이콘, 공식 팝업, 압축 목록 |
| v0.2.0 | ✅ 게시 | 24개 Chat Completion 연결 구현·자동 검사 완료 |
| v0.2.1 | ✅ 현재 | 불필요한 중간 기능 단계를 제거하고 이후 기능 버전을 재정렬 |
| v0.3.0 | ✅ 현재 | 공개 Registry API 1.0.0, 불변 스냅샷과 변경 이벤트 제공 |

이후 진행 상태는 이 파일을 단일 로드맵으로 계속 갱신합니다.
