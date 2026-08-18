# Custom Model Router

SillyTavern 코어 파일을 수정하지 않고 기존 Chat Completion 연결에 사용자 모델 ID를 등록하는 UI 확장입니다. API 키·엔드포인트·프로젝트·리전은 그대로 두고 모델 값만 적용합니다.

현재 버전은 **v0.5.0**이며, SillyTavern 1.18.0의 등록 가능한 Chat Completion 연결 24개, 공개 Registry API, Connection Profile 기반 보조 요청 라우팅, 호환성 진단과 비밀정보를 제외한 설정 백업·복구를 제공합니다.

## 현재 진행 상태

| 항목 | 상태 |
|---|---|
| 현재 릴리스 | `v0.5.0` |
| v0.3 공개 Registry API | ✅ 구현·자동 검사 완료 |
| v0.4 용도별 라우팅 | ✅ 구현·자동 검사 완료 |
| v0.5 진단·복구·안정성 계측 | ✅ 구현·자동 검사 완료 |
| DOM·공개 API 샌드박스 | ✅ 24개 컨트롤·팝업·GLM·라우팅·진단·반복 수명주기 통과 |
| 실제 제공업체 계정 검증 | 🧪 사용자 환경별 확인 대기 |
| 사용자가 할 일 | [통합 사용자 체크리스트](./USER_CHECKLIST.md)를 한 번 순서대로 확인 |

진행 위치와 완료 근거는 [개발 로드맵](./ROADMAP.md)에서 계속 갱신합니다.

## 주요 기능

- 한 관리 팝업에서 24개 제공업체의 사용자 모델을 등록·선택·삭제합니다.
- 등록 모델을 SillyTavern 기본 모델 선택기의 `사용자 지정 모델 · Custom Model Router` 그룹에 표시합니다.
- 원격 모델 목록 재생성, source 변경, 새로고침과 Connection Profile 전환 뒤 옵션과 선택을 복원합니다.
- v0.1의 Vertex 설정을 제공업체별 schema v2로 자동 이관합니다.
- `globalThis.CustomModelRouter`로 다른 확장에 읽기 전용 Registry 스냅샷, mutation, 이벤트와 용도별 라우팅 API를 제공합니다.
- 보조 기능은 Registry의 `(provider, model ID)`와 같은 제공업체의 Connection Profile을 직접 연결합니다.
- 보조 요청은 메인 채팅 source·모델을 바꾸지 않고 Connection Profile의 인증과 endpoint를 재사용합니다.
- SillyTavern 버전, 공개 context, 제공업체 컨트롤과 런타임 자원 누적을 구조화된 진단으로 확인합니다.
- Registry와 용도별 경로만 JSON으로 내보내고, 가져오기 전 형식·스키마·허용 필드를 검사합니다.
- 삭제된 모델·프로필, 제공업체 불일치와 미등록 어댑터는 다른 모델로 대체하지 않고 명시적으로 중단합니다.

## 지원 연결 24개

| 구분 | 연결 |
|---|---|
| 모델 개발사 API 14개 | OpenAI, Anthropic, AI21, Cohere, DeepSeek, Google AI Studio, Google Vertex AI, Groq, Mistral AI, MiniMax, Moonshot AI (Kimi), Perplexity, xAI, Z.AI (GLM) |
| 라우터·호스팅 9개 | AI/ML API, Chutes, Cloudflare Workers AI, ElectronHub, Fireworks AI, NanoGPT, OpenRouter, Pollinations, SiliconFlow |
| 사용자 지정 연결 1개 | Custom OpenAI-compatible |

GLM은 `Z.AI (GLM)`, Kimi는 `Moonshot AI (Kimi)` 연결에서 등록합니다. 별도 업체·지역 API 또는 사용자가 운영하는 OpenAI 호환 서버는 SillyTavern의 `Custom` 연결을 먼저 구성한 뒤 `Custom OpenAI-compatible`에서 모델 ID를 등록합니다.

다음 두 source는 구조상 등록 대상에서 제외합니다.

- **Azure OpenAI**: 실제 요청 대상은 모델 값이 아니라 deployment name으로 결정됩니다.
- **CometAPI**: SillyTavern 1.18.0 코어에서 해당 provider 요청이 비활성화되어 있습니다.

## 설치

1. SillyTavern에서 **Extensions → Install Extension**을 엽니다.
2. **Install Extension**에 다음 Git 저장소 URL을 입력합니다.

```text
https://github.com/p16481012/Custom-Model-Router
```

3. 설치가 끝나면 SillyTavern 페이지를 새로고침합니다.

`manifest.json`의 최소 버전은 SillyTavern `1.18.0`입니다. 이 버전은 자동 계약 검사 기준이며, 더 새로운 버전은 진단 결과를 확인한 뒤 사용해야 합니다.

## 모델 등록과 적용

1. **API Connections**에서 사용할 Chat Completion 제공업체의 인증·endpoint·리전을 먼저 설정합니다.
2. Connection Profile 도구행의 `사용자 모델 관리` 아이콘을 누릅니다.
3. 제공업체를 선택하고 업체가 공개한 정확한 모델 ID를 등록합니다.
4. 목록의 선택 버튼이나 기본 모델 선택기의 사용자 지정 그룹에서 모델을 적용합니다.
5. 일반 요청과 스트리밍 요청을 각각 확인합니다.

등록은 해당 source가 비활성 상태여도 가능합니다. 실제 적용은 해당 제공업체를 현재 Chat Completion source로 선택했을 때만 허용합니다.

### Z.AI GLM 예

1. API Connections에서 `Z.AI`를 선택합니다.
2. 기존 UI에서 Common 또는 Coding endpoint와 API 키를 설정합니다.
3. 관리 팝업의 `Z.AI (GLM)`에서 정확한 `glm-...` ID를 등록하고 적용합니다.
4. 일반·스트리밍 요청과 새로고침 뒤 복원을 확인합니다.

확장은 endpoint 종류와 API 키를 바꾸지 않습니다.

## 모델 ID 규칙

- Google AI Studio와 Vertex AI: 영문자·숫자로 시작하고 `.`, `_`, `-`를 허용하며 최대 128자입니다.
- 단일 ID형 연결: 영문자·숫자로 시작하고 `.`, `_`, `:`, `+`, `-`를 허용하며 최대 128자입니다.
- 계층형 카탈로그와 Custom: `/`, `:`, `+`, `@`를 포함할 수 있으며 최대 256자입니다.
- 모든 연결에서 URL, 공백, 제어문자, `?`, `#`, `%`, 역슬래시와 HTML 구분자는 거부합니다.

형식 검사는 모델의 존재, 계정 권한 또는 현재 요청 규격과의 호환을 보증하지 않습니다.

## 공개 API

Registry API 계약은 `1.1.0`, Routing API 계약은 `1.0.0`입니다. 내부 `src` 파일을 직접 import하지 말고 확장 초기화 뒤 전역 객체를 사용합니다.

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

`selectModel()`은 Registry 선택 상태만 변경하며 SillyTavern의 현재 source나 메인 모델을 전환하지 않습니다. 전체 계약은 [공개 API 문서](./API.md), 예제는 [Registry 연동](./examples/registry-integration.js)과 [라우팅 연동](./examples/routing-integration.js)을 참고하세요.

## 용도별 보조 요청 라우팅

관리 팝업의 **보조 기능별 모델 라우팅**에서 용도, 등록 모델과 같은 제공업체의 Connection Profile을 고릅니다. 저장 경로에는 provider·model ID·adapter ID·profile ID만 들어가며 프로필 본문이나 인증정보는 복제하지 않습니다.

```js
const result = await CustomModelRouter.routing.execute('translation', {
    prompt: 'Translate this sentence into Korean.',
    maxTokens: 256,
});

console.log(result.content);
```

기본 어댑터는 SillyTavern `ConnectionManagerRequestService`를 사용하고 요청의 `model`만 등록 ID로 지정합니다. route provider와 profile source가 정확히 일치해야 하며, 현재 연결이나 메인 모델로 무음 대체하지 않습니다.

## 호환성 진단

관리 팝업에서 **호환성 진단 및 설정 복구 → 진단 실행**을 누르면 다음을 확인합니다.

- SillyTavern 최소·검증 기준 버전
- 공개 context와 이벤트 계약
- 24개 provider 컨트롤과 런타임 바인딩 상태
- 런처, MutationObserver, 이벤트 구독과 사용자 모델 그룹 중복
- source·profile 전환 표본에서 자원이 증가하는지 여부

**진단 복사**는 코드·상태·개수로 구성된 JSON을 복사합니다. API 키, endpoint URL, project ID, Service Account와 Connection Profile 본문은 포함하지 않습니다. 오류를 보고할 때도 복사한 내용을 검토한 뒤 민감정보가 없는지 한 번 더 확인하세요.

## 설정 백업과 복구

**백업 내보내기**는 다음 두 항목만 JSON으로 저장합니다.

- Registry의 제공업체·모델 ID·선택 상태
- 용도별 route의 provider·model ID·adapter ID·Connection Profile ID

API 키, endpoint, 리전, project/account ID, Service Account, 프로필 본문과 생성 설정은 저장하지 않습니다.

**백업 가져오기**는 적용 전에 JSON 형식, 최대 크기, 알려진 필드, provider·모델 ID, route와 schema 버전을 검사하고 사용자 확인을 받습니다. 알 수 없는 필드나 미래 schema가 있으면 기존 설정을 바꾸지 않고 거부합니다. 가져온 profile ID가 현재 존재하지 않으면 route는 보존되지만 실행 시 명시 오류가 발생합니다.

## 호환성 제한

이 확장은 **모델 ID만 기존 SillyTavern 요청 경로에 전달**합니다.

- 새 endpoint, 인증 방식, API 버전 또는 deployment name이 필요한 모델은 ID 등록만으로 지원되지 않습니다.
- 새 thinking·tool·image·prefill·응답 변환 계약은 SillyTavern 코어나 별도 어댑터 지원이 필요할 수 있습니다.
- 원격 카탈로그에 없는 모델은 context·가격·멀티모달 metadata 자동 판단이 제한될 수 있습니다.
- 실제 제공업체 계정, 권한, 지역별 제공 여부는 자동 검사할 수 없습니다.
- Text Completion 전용 연결과 다른 확장이 자체 보관하는 모델 목록은 지원 범위가 아닙니다.

## 문제 해결

### 모델 컨트롤을 찾지 못함

API Connections에서 해당 Chat Completion source를 열고 연결 상태를 확인한 뒤 팝업을 다시 여세요. 등록은 가능하지만 컨트롤이 없거나 source가 비활성이면 즉시 적용할 수 없습니다.

### 원격 모델 목록 갱신 뒤 사용자 모델이 사라짐

일부 제공업체는 연결할 때 선택기를 다시 만듭니다. 확장은 변경을 감지해 사용자 옵션과 저장 선택을 복원합니다. 연결 완료 뒤에도 복원되지 않으면 새로고침하고 체크리스트의 환경 정보와 함께 보고하세요.

### 등록 모델 삭제가 거부됨

select형 연결에서 현재 사용 중인 모델은 기본 모델로 먼저 전환한 뒤 삭제합니다. 자유 입력형 `Custom`은 Registry에서 삭제해도 SillyTavern의 현재 `custom_model` 입력값을 지우지 않습니다.

### 라우팅 시험이 실패함

모델이 Registry에 남아 있는지, Connection Profile이 존재하는지, profile source와 route provider가 같은지 확인하세요. 실패 시 다른 모델이나 메인 연결로 자동 대체하지 않습니다.

### 백업 가져오기가 거부됨

파일을 직접 편집했다면 알 수 없는 필드, 잘못된 model ID, 중복 모델, 미래 schema 또는 크기 제한 오류를 확인하세요. 거부 시 현재 설정은 유지됩니다.

## 개발 및 검사

런타임 의존성과 빌드 과정은 없습니다. Node.js 20 이상에서 실행합니다.

```bash
npm test
npm run check
```

현재 자동 검사 89개는 24개 provider 회계, schema 이관, 동적 옵션 복원, 팝업 수명주기, 공개 API, 라우팅 격리, 무음 대체 금지, 호환성 진단, 자원 누적 판정, 안전한 백업·복구와 버전·문서 일치를 검증합니다. 실제 계정과 브라우저 조작이 필요한 결과는 [통합 사용자 체크리스트](./USER_CHECKLIST.md)에서 별도로 확인합니다.

추가로 실제 브라우저 DOM 샌드박스에서 24개 컨트롤 감지, GLM 등록·적용, Connection Profile 라우팅, source/profile 이벤트 60회, 375px 폭, 비활성화·재활성화, 초점 복귀와 오류 로그 0건을 확인했습니다. 이 결과는 실제 제공업체 자격 증명과 네트워크 요청 성공을 대신하지 않습니다.

## 버전 정책

- 새 기능 범위는 `v0.n.0`으로 올립니다.
- 같은 기능 범위의 버그 수정과 세부 문서 변경은 `v0.n.n`으로 올립니다.
- 작은 수정 때문에 다음 기능 버전으로 건너뛰지 않습니다.
- 버전 변경 시 manifest, package, UI 배지, 초기화 로그, README, 체크리스트와 로드맵을 함께 맞춥니다.

## 로드맵 요약

| 버전 | 목표 | 상태 |
|---|---|---|
| `v0.1.x` | Vertex 기반 Registry와 관리 UI | ✅ 완료 |
| `v0.2.x` | 24개 Chat Completion 연결 | ✅ 구현·자동 검사 완료 |
| `v0.3.0` | 공개 Registry API | ✅ 완료 |
| `v0.4.0` | Connection Profile 어댑터와 용도별 직접 라우팅 | ✅ 완료 |
| `v0.5.0` | 호환성 진단·비밀정보 제외 백업·운영 안정성 계측 | ✅ 현재 |

문제가 있으면 [GitHub Issues](https://github.com/p16481012/Custom-Model-Router/issues)에 SillyTavern 버전, 제공업체, 체크리스트 항목 ID와 민감정보를 제거한 오류를 남겨 주세요.
