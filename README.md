# Custom Model Router

SillyTavern 코어 파일을 수정하지 않고 Chat Completion 연결에 사용자 모델 ID를 추가하는 UI 확장입니다. 기존 API 키·엔드포인트·프로젝트·리전 설정은 그대로 두고 모델 값만 등록하고 적용합니다.

현재 버전은 **v0.4.0**이며, SillyTavern 1.18.0의 Chat Completion 연결 24개, 공개 Registry API와 별칭 없는 용도별 보조 모델 라우팅을 지원합니다. Z.AI의 GLM, DeepSeek, Moonshot AI의 Kimi, MiniMax, SiliconFlow 모델도 각각의 전용 연결에서 등록할 수 있습니다.

## 현재 진행 상태

| 항목 | 상태 |
|---|---|
| 현재 릴리스 | `v0.4.0` |
| 다중 제공업체·공개 API·용도별 라우팅 | ✅ 구현·자동 검사 완료 |
| v0.1 설정 이관 | ✅ schema v1의 Vertex 등록값을 v2로 자동 이관 |
| 실제 제공업체 계정 검증 | 🧪 사용자 계정별 결과 보고 대기 |
| 사용자가 할 일 | [사용자 검증 체크리스트](./USER_CHECKLIST.md)의 공통 항목과 사용하는 제공업체 행 확인 |
| 다음 단계 | `v0.5.0` 호환성 진단·설정 복구·장시간 안정화 |

전체 진행 위치와 버전별 완료 조건은 [개발 로드맵](./ROADMAP.md)에서 계속 갱신합니다.

## v0.4.0에서 할 수 있는 일

- 한 관리 팝업에서 제공업체를 바꾸며 사용자 모델을 등록·선택·삭제할 수 있습니다.
- 등록 모델을 각 SillyTavern 기본 모델 선택기의 `사용자 지정 모델 · Custom Model Router` 그룹에 표시합니다.
- 같은 모델 ID도 제공업체가 다르면 별도로 등록할 수 있습니다.
- 새로고침, API source 변경, 원격 모델 목록 재생성, Connection Profile 전환 뒤 사용자 옵션과 선택 상태를 복원합니다.
- v0.1의 Vertex 모델과 선택 상태를 제공업체별 schema v2로 자동 이관합니다.
- API 키, Service Account, 프로젝트 ID, Account ID, 리전, 엔드포인트 URL, 필터 설정을 읽거나 저장하지 않습니다.
- 확장을 비활성화할 때 확장이 추가한 옵션만 제거하고, 필요한 경우 사용 가능한 기본 모델로 전환합니다.
- 다른 확장은 `globalThis.CustomModelRouter`에서 등록 모델과 제공업체별 Registry 선택 상태를 조회하고 변경 이벤트를 구독할 수 있습니다.
- 공개 API의 스냅샷은 읽기 전용이며, `(provider, model ID)` 복합키로 같은 이름의 모델을 연결별로 구분합니다.
- 번역·요약·검색 보조·이미지 설명 등의 용도에 Registry의 `(provider, model ID)`와 Connection Profile을 직접 연결할 수 있습니다.
- 보조 요청은 SillyTavern의 공개 Connection Manager 요청 API를 사용하므로 현재 메인 채팅 source와 모델을 변경하지 않습니다.
- 프로필 제공업체 불일치, 삭제된 모델·프로필, 미등록 어댑터는 다른 모델로 대체하지 않고 구조화 오류로 중단합니다.

## 공개 Registry API

공개 API 계약 버전은 `1.1.0`이며 `routing` 계약은 `1.0.0`입니다. 내부 `src` 파일을 직접 import하지 않고 확장 초기화 뒤 전역 객체를 사용합니다.

```js
const registry = globalThis.CustomModelRouter;
if (!registry?.isCompatible('1.1.0')) {
    throw new Error('Custom Model Router Registry API 1.1.0이 필요합니다.');
}

const glmModels = registry.listModels('zai');
const unsubscribe = registry.subscribe('registry:changed', event => {
    console.log(event.revision, event.snapshot.models);
});
```

`selectModel()`은 Registry의 저장 선택 상태만 바꾸며 SillyTavern의 현재 연결이나 메인 채팅 모델을 전환하지 않습니다. 라우팅은 `registry.routing.execute()`로 명시적으로 opt-in합니다. 전체 계약은 [공개 API 문서](./API.md), 예제는 [Registry 연동](./examples/registry-integration.js)과 [라우팅 연동](./examples/routing-integration.js)을 참고하세요.

## 보조 기능별 라우팅

관리 팝업의 **보조 기능별 모델 라우팅**에서 용도, 등록 모델, 같은 제공업체의 Connection Profile을 고릅니다. 저장 경로에는 모델 참조와 프로필 ID만 들어가며 프로필 본문·키·endpoint는 복제하지 않습니다.

```js
const result = await CustomModelRouter.routing.execute('translation', {
    prompt: 'Translate this sentence into Korean.',
    maxTokens: 256,
});
console.log(result.content);
```

기본 어댑터는 Connection Profile의 인증·endpoint·preset을 재사용하고 요청 payload의 `model`만 경로의 실제 ID로 덮어씁니다. profile source와 route provider가 정확히 같아야 합니다. 현재 연결을 자동 사용하거나 메인 모델로 무음 대체하지 않습니다.

동작 경로는 다음과 같습니다.

```text
기존 Chat Completion 연결 설정
    ↓
사용자 모델 관리에서 제공업체와 모델 ID 등록
    ↓
해당 제공업체의 기본 모델 컨트롤에 옵션 주입·적용
    ↓
SillyTavern의 기존 change/input 흐름
    ↓
기존 인증·엔드포인트·리전 유지 + 사용자 model 값으로 요청
```

## 지원 연결 24개

| 구분 | 연결 |
|---|---|
| 모델 개발사 API 14개 | OpenAI, Anthropic, AI21, Cohere, DeepSeek, Google AI Studio, Google Vertex AI, Groq, Mistral AI, MiniMax, Moonshot AI (Kimi), Perplexity, xAI, Z.AI (GLM) |
| 라우터·호스팅 9개 | AI/ML API, Chutes, Cloudflare Workers AI, ElectronHub, Fireworks AI, NanoGPT, OpenRouter, Pollinations, SiliconFlow |
| 사용자 지정 연결 1개 | Custom OpenAI-compatible |

여기서 Z.AI (GLM), DeepSeek, Moonshot AI (Kimi), MiniMax, SiliconFlow는 각각 독립된 지원 연결입니다. 사용자가 말하는 “로컬 모델”이 GLM·Kimi처럼 특정 지역이나 업체에서 주로 제공되는 모델이라는 뜻이라면 해당 전용 연결을 선택하면 됩니다. PC에서 직접 실행하는 서버나 별도 업체의 OpenAI-compatible API는 SillyTavern의 `Custom` 연결을 먼저 설정한 뒤 `Custom OpenAI-compatible`에서 모델 ID를 등록할 수 있습니다.

다음 두 Chat Completion source는 구조상 등록 대상에서 제외합니다.

- **Azure OpenAI**: 실제 요청 대상은 모델 값이 아니라 deployment name으로 결정되므로 모델 ID만 바꾸는 이 확장의 계약과 맞지 않습니다.
- **CometAPI**: SillyTavern 1.18.0 코어에서 해당 provider 요청이 비활성화되어 있습니다.

Text Completion의 Generic/Ooba 연결과 다른 확장이 자체 보관하는 모델 목록은 v0.2.x 범위가 아닙니다.

## 설치

1. SillyTavern에서 **Extensions** 패널을 엽니다.
2. **Install Extension**을 선택합니다.
3. 다음 Git 저장소 URL을 입력합니다.

```text
https://github.com/p16481012/Custom-Model-Router
```

4. 설치가 끝나면 SillyTavern 페이지를 새로고침합니다.

v0.1.x에서 업데이트하면 기존 Vertex 모델 등록값은 자동으로 보존·이관됩니다. 중요한 설정은 업데이트 전에 별도로 백업하는 것을 권장합니다.

## 사용 방법

1. SillyTavern의 **API Connections**에서 사용할 Chat Completion 제공업체를 선택하고 인증·엔드포인트·리전 설정을 먼저 완료합니다.
2. Connection Profile 도구행의 `사용자 모델 관리` 아이콘을 누릅니다.
3. 팝업에서 모델을 등록할 제공업체 또는 연결 방식을 선택합니다.
4. 해당 업체가 공개한 정확한 모델 ID를 입력하고 **추가**를 누릅니다.
5. 목록의 선택 아이콘을 누르거나 기본 모델 선택기의 사용자 지정 그룹에서 모델을 선택합니다.
6. 테스트 메시지를 보내 현재 계정·리전·요청 규격에서 실제로 사용할 수 있는지 확인합니다.

등록은 연결이 현재 활성 상태가 아니어도 가능합니다. 모델 적용은 해당 제공업체를 현재 Chat Completion source로 선택한 상태에서만 가능합니다. 팝업은 닫기 버튼 또는 `Escape` 키로 닫을 수 있고, 닫은 뒤 초점은 관리 아이콘으로 돌아갑니다.

### GLM 모델 등록 예

1. API Connections에서 `Z.AI`를 선택합니다.
2. Z.AI의 Common 또는 Coding 엔드포인트와 API 키를 기존 SillyTavern UI에서 설정합니다.
3. 사용자 모델 관리에서 `Z.AI (GLM)`을 선택합니다.
4. Z.AI가 공개한 정확한 `glm-...` 모델 ID를 등록하고 적용합니다.
5. 일반·스트리밍 요청을 각각 확인합니다.

이 확장은 Z.AI 엔드포인트 종류나 API 키를 바꾸지 않습니다.

## 모델 ID 입력 규칙

모델 ID만 입력하며 URL은 입력하지 않습니다. 제공업체에 따라 다음 규칙을 적용합니다.

- Google AI Studio와 Vertex AI: URL 경로 한 구간으로 안전한 영문자, 숫자, `.`, `_`, `-`를 허용하며 최대 128자입니다.
- OpenAI, Anthropic, xAI, Z.AI, DeepSeek, Moonshot AI, MiniMax 등 단일 ID형 연결: 영문자, 숫자, `.`, `_`, `:`, `-`를 허용하며 최대 128자입니다.
- OpenRouter, SiliconFlow, Workers AI, Fireworks 등 카탈로그형 연결과 Custom: 계층형 ID에 `/`, `:`, `+`, `@`를 추가로 허용하며 최대 256자입니다.
- 모든 연결에서 URL, 공백, `?`, `#`, `%`, HTML과 중복 등록은 허용하지 않습니다.

모델 ID 형식이 유효하다는 것은 해당 모델이 실제로 존재하거나 현재 계정에서 이용 가능하다는 뜻이 아닙니다.

## 중요한 호환성 제한

v0.2.x는 **모델 ID만 기존 제공업체 요청 경로로 전달**합니다. 따라서 등록 모델은 SillyTavern 1.18.0이 해당 source에 사용하는 현재 요청·응답 규격과 호환되어야 합니다.

- 새 인증 방식, 별도 API 버전, 다른 endpoint 또는 deployment name이 필요한 모델은 ID 등록만으로 지원되지 않습니다.
- 새 요청 필드, 응답 형식, thinking 규칙, tool 호출 규칙, 이미지 생성 규칙이 필요한 모델은 추가 어댑터가 필요할 수 있습니다.
- 원격 카탈로그에 없는 모델은 context 크기, 가격, 멀티모달 같은 metadata가 없으므로 관련 자동 판단이 부정확할 수 있습니다.
- SillyTavern 코어가 모델 이름으로 특정 파라미터를 조정하는 제공업체는 신모델에서 실제 요청 검증이 필요합니다.
- 확장은 존재하지 않거나 권한이 없는 모델을 다른 모델로 자동 대체하지 않습니다.

## 문제 해결

### 제공업체 모델 컨트롤을 찾지 못했다는 메시지가 표시됨

API Connections에서 해당 Chat Completion source를 한 번 열고 연결 상태를 확인한 뒤 팝업을 다시 열어 주세요. 등록은 가능하지만 컨트롤이 없거나 다른 source가 활성 상태이면 즉시 적용할 수 없습니다.

### 원격 모델 목록을 불러온 뒤 사용자 모델이 사라짐

일부 제공업체는 연결할 때 모델 선택기를 다시 만듭니다. 확장은 이를 감지해 옵션과 저장 선택을 복원합니다. 연결 완료 후에도 복원되지 않으면 페이지를 새로고침하고 체크리스트의 환경 정보와 함께 문제를 보고해 주세요.

### API 요청 오류가 발생함

모델 ID 오타, 계정 권한, 지역별 제공 여부, endpoint 종류, 현재 source의 요청 규격 호환성을 확인해 주세요. Google Vertex AI는 프로젝트·리전, Workers AI는 Account ID, Z.AI·MiniMax·SiliconFlow는 선택한 지역 endpoint도 함께 확인해야 합니다.

### 등록 모델을 삭제할 수 없음

선택형 연결에서 현재 사용 중인 사용자 모델은 다른 기본 모델을 먼저 선택한 뒤 삭제할 수 있습니다. 이는 선택기가 존재하지 않는 값에 남는 상황을 막기 위한 동작입니다.

`Custom OpenAI-compatible`은 자유 입력형이므로 Registry 등록을 삭제해도 SillyTavern의 현재 `custom_model` 입력값은 지우지 않습니다. 실제 사용 모델도 바꾸려면 API Connections의 Custom 모델 입력값을 변경하세요.

## 개발 및 검사

런타임 의존성이나 빌드 과정은 없습니다. Node.js 20 이상에서 다음 검사를 실행할 수 있습니다.

```bash
npm test
npm run check
```

현재 자동 검사 68개는 24개 provider descriptor 회계, schema 이관, 옵션 재주입·복원, 관리 팝업 수명주기, 공개 API 계약, 용도별 경로 검증, Connection Profile 제공업체 일치, 무음 대체 금지, 메인 모델 비변경과 버전·문서 일치를 확인합니다. 실제 API 계정과 화면 조작이 필요한 결과는 [사용자 검증 체크리스트](./USER_CHECKLIST.md)에서 별도로 관리합니다.

## 버전 정책

- Vertex Gemini 최초 범위: `v0.1.0`
- v0.1의 UI/UX와 세부 수정: `v0.1.1`, `v0.1.2`, `v0.1.3`, ...
- 여러 Chat Completion 제공업체로 범위를 확장한 버전: `v0.2.0`
- v0.2의 버그 수정과 세부 호환성 개선: `v0.2.1`, `v0.2.2`, ...
- 공개 Registry API나 확장 어댑터처럼 범위가 새로 확장될 때만 다음 기능 버전으로 이동

작은 수정 때문에 바로 다음 기능 버전으로 올리지 않습니다. 버전을 바꿀 때는 manifest, package, UI 배지, 초기화 로그, README, 체크리스트와 로드맵을 함께 맞춥니다.

## 로드맵 요약

| 버전 | 목표 | 상태 |
|---|---|---|
| `v0.1.x` | Vertex Gemini 기반 확립 | ✅ 완료 |
| `v0.2.0` | 24개 Chat Completion 연결의 사용자 모델 등록 | ✅ 구현·자동 검사 완료 |
| `v0.2.1` | 로드맵 간소화 | ✅ 완료 |
| `v0.2.2+` | 실제 검증에서 발견된 제공업체별 호환성 보완 | 📝 결과 대기 |
| `v0.3.0` | 다른 확장이 사용할 수 있는 공개 Registry API | ✅ 완료 |
| `v0.4.0` | Connection Profile 어댑터와 용도별 직접 모델 라우팅 | ✅ 현재 |
| `v0.5.0` | 호환성과 운영 안정화 | 📝 예정 |

업데이트 전 중요한 설정을 백업하고, 문제가 있으면 [GitHub Issues](https://github.com/p16481012/Custom-Model-Router/issues)에 SillyTavern 버전, 제공업체, 실패 항목 ID와 민감정보를 제거한 오류 메시지를 남겨 주세요.
