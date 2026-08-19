# Custom Model Router

SillyTavern 코어 파일을 수정하지 않고 기존 Chat Completion 연결에 사용자 모델 ID를 등록하는 UI 확장입니다. 관리 팝업의 기본 목록은 등록한 모든 모델을 제공업체별로 보여주며, 실제 모델은 SillyTavern의 기존 모델 선택기 또는 입력란에서 선택합니다. 범용 외부 확장 브리지는 자동 연결, 전체 모델을 제공업체별로 보여주는 직접 연결, 연결 안 함을 대상별로 선택할 수 있으며 외부 요청 본문을 직접 바꾸지 않습니다.

현재 버전은 **v0.6.5**이며, SillyTavern 1.18.0의 등록 가능한 Chat Completion 연결 24개, 공개 Registry API, 개발자 opt-in Routing API, 범용 DOM 모델 브리지, 호환성 진단과 비밀정보를 제외한 설정 백업·복구를 제공합니다. v0.6.5는 전체 등록 모델을 기본으로 보여주는 관리 화면과 간결한 버튼·간격·줄바꿈·스크롤을 적용하고, v0.6.3~v0.6.4에서 제거되었던 외부 대상별 직접 연결과 연결 안 함을 복구한 패치입니다. 직접 연결은 하나의 제공업체를 고정하지 않고 Registry의 모든 제공업체 모델을 제공업체별로 표시합니다.

v0.5.0까지의 공개 API와 용도별 라우팅은 다른 확장이 스스로 연동해야 사용할 수 있었으며, 이미 설치된 다른 확장의 모델 선택기에 CMR 모델을 자동 표시하지는 않았습니다. v0.6.0은 이 누락을 보완해 표준 `select`, 텍스트 `input`, `datalist` 기반 Chat Completion 모델 컨트롤을 탐지했습니다. 자동 연결은 제공업체를 충분히 확실하게 판별한 대상에 같은 제공업체의 모델만 추가합니다. 자동 판별할 수 없는 Chat Completion 대상은 사용자가 직접 연결을 선택하면 모든 제공업체의 등록 모델을 볼 수 있습니다.

## 현재 진행 상태

| 항목 | 상태 |
|---|---|
| 현재 릴리스 | `v0.6.5` |
| v0.3 공개 Registry API | ✅ 구현·자동 검사 완료 |
| v0.4 용도별 라우팅 | ✅ 구현·자동 검사 완료 |
| v0.5 진단·복구·안정성 계측 | ✅ 구현·자동 검사 완료 |
| v0.6 범용 DOM 모델 브리지 | ✅ 구현·자동 검사 완료 |
| DOM·공개 API 샌드박스 | ✅ 기본 24개와 외부 select/input/datalist·재렌더·정리 수명주기 통과 |
| 실제 제공업체 계정 검증 | 🧪 사용자 환경별 확인 대기 |
| 사용자가 할 일 | [통합 사용자 체크리스트](./USER_CHECKLIST.md)를 한 번 순서대로 확인 |

진행 위치와 완료 근거는 [개발 로드맵](./ROADMAP.md)에서 계속 갱신합니다.

## 주요 기능

- 한 관리 팝업에서 24개 제공업체의 사용자 모델을 등록·삭제하고, 기본 목록에는 모든 등록 모델을 제공업체별로 표시합니다.
- 제공업체 선택은 등록 폼에만 적용되며 아래의 전체 등록 목록을 필터링하지 않습니다.
- 등록 모델을 SillyTavern 기본 모델 선택기의 `사용자 모델` 그룹에 표시합니다.
- 실제 모델 선택은 SillyTavern의 기존 모델 선택기 또는 입력란에서 수행합니다.
- 정상적인 모델 컨트롤 감지 상태는 숨기고, 등록 모델을 표시할 수 없는 실제 오류만 관리 팝업에 알립니다.
- 다른 확장의 표준 Chat Completion 모델 컨트롤을 자동 탐지해 제공업체를 확실하게 판별한 대상에만 해당 제공업체의 CMR 모델을 추가합니다.
- 외부 대상마다 자동 연결, 직접 연결, 연결 안 함을 선택할 수 있습니다. 직접 연결은 특정 업체를 고정하지 않고 등록된 모든 제공업체 모델을 제공업체별 그룹으로 추가합니다.
- 제공업체를 판별할 수 없는 대상은 직접 연결하기 전까지 변경하지 않으며, 채팅 모델이 아닌 대상은 연결 후보에서 제외합니다.
- 외부 확장이 선택기를 다시 렌더링하면 CMR 옵션을 다시 추가하고, 동일 target의 새 컨트롤 값이 비어 있을 때만 provider별 마지막 CMR 선택을 복원합니다. 외부 확장이 둔 유효한 현재값은 덮어쓰지 않습니다.
- 원격 모델 목록 재생성, source 변경, 새로고침과 Connection Profile 전환 뒤 옵션과 선택을 복원합니다.
- v0.1의 Vertex 설정을 제공업체별 schema v2로 자동 이관합니다.
- `globalThis.CustomModelRouter`로 다른 확장에 읽기 전용 Registry 스냅샷, mutation, 이벤트와 용도별 라우팅 API를 제공합니다.
- 공개 API도 SillyTavern `select`에서 현재 사용 중인 custom-only 모델은 `model_in_use`로 등록 해제를 거부하고, native 모델로 전환한 뒤에만 삭제합니다.
- 개발자 opt-in Routing API는 Registry의 `(provider, model ID)`와 같은 제공업체의 Connection Profile을 직접 연결합니다. 일반 사용자용 라우팅 설정 UI는 제공하지 않습니다.
- 보조 요청은 메인 채팅 source·모델을 바꾸지 않고 Connection Profile의 인증과 endpoint를 재사용합니다.
- SillyTavern 버전, 공개 context, 제공업체 컨트롤과 런타임 자원 누적을 구조화된 진단으로 확인합니다.
- Registry, 개발자용 용도별 경로, 외부 컨트롤의 직접 연결·연결 안 함 상태와 provider별 마지막 선택을 portable schema v2 JSON으로 내보내고, 가져오기 전 형식·스키마·허용 필드를 검사합니다.
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

## 모델 등록과 선택

1. **API Connections**에서 사용할 Chat Completion 제공업체의 인증·endpoint·리전을 먼저 설정합니다.
2. Connection Profile 도구행의 `사용자 모델 관리` 아이콘을 누릅니다.
3. 제공업체를 선택하고 업체가 공개한 정확한 모델 ID를 등록합니다.
4. 전체 등록 모델 목록에서 제공업체별 등록 결과를 확인합니다. 등록 폼의 제공업체를 바꿔도 이 목록은 전체 상태를 유지합니다.
5. 관리 팝업을 닫고 SillyTavern의 기존 모델 선택기 또는 입력란에서 등록 모델을 선택합니다.
6. 일반 요청과 스트리밍 요청을 각각 확인합니다.

등록은 해당 source가 비활성 상태여도 가능합니다. 관리 팝업의 등록 목록에는 제공업체 이름, 모델 ID와 작은 삭제 버튼만 있으며, 선택 버튼이나 현재 모델 상태는 없습니다. 모델이 6개를 넘으면 목록 영역만 스크롤되고 스크롤바는 보이지 않지만 휠·터치·키보드 스크롤은 그대로 동작합니다. 실제 선택 상태는 SillyTavern의 기존 컨트롤을 기준으로 합니다.

### Z.AI GLM 예

1. API Connections에서 `Z.AI`를 선택합니다.
2. 기존 UI에서 Common 또는 Coding endpoint와 API 키를 설정합니다.
3. 관리 팝업의 `Z.AI (GLM)`에서 정확한 `glm-...` ID를 등록합니다.
4. SillyTavern의 Z.AI 모델 선택기에서 등록한 ID를 선택합니다.
5. 일반·스트리밍 요청과 새로고침 뒤 복원을 확인합니다.

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

`selectModel()`은 Registry 선택 상태만 변경하며 SillyTavern의 현재 source나 메인 모델을 전환하지 않습니다. `unregisterModel()`은 SillyTavern `select`형 연결에서 현재 값인 custom-only 모델을 지우려 하면 `model_in_use`를 내며, 기존 native 모델로 전환한 뒤에는 정상적으로 등록 해제합니다. 전체 계약은 [공개 API 문서](./API.md), 예제는 [Registry 연동](./examples/registry-integration.js)과 [라우팅 연동](./examples/routing-integration.js)을 참고하세요.

## 다른 확장 모델 연결

범용 브리지는 페이지에 나타난 표준 Chat Completion 모델 `select`, 텍스트 `input`, `datalist`를 자동 탐지합니다. 관리 팝업의 **다른 확장 모델 연결**에서 대상마다 다음 모드를 선택합니다.

- **자동 연결**: 외부 확장의 명시 provider 값과 주변 DOM 정보로 제공업체를 충분히 확실하게 판별했을 때 같은 제공업체의 Registry 모델만 추가합니다. 판별하지 못하면 변경하지 않습니다.
- **직접 연결**: 특정 제공업체를 지정하지 않습니다. Registry에 등록된 모든 제공업체 모델을 제공업체별 `사용자 모델` 그룹으로 추가합니다.
- **연결 안 함**: 해당 모델 칸에 CMR 모델 선택지를 표시하지 않습니다. 이미 CMR option을 선택한 `select`에서 이 모드로 바꾸면 option이 제거되면서 외부 확장 또는 브라우저의 native 기본값으로 전환될 수 있습니다.

Caption처럼 provider 선택기와 model 선택기, option의 `data-type`을 사용하는 확장은 외부 provider 값을 보존한 채 연결합니다. 외부 대상 목록의 새로고침은 현재 DOM을 다시 탐지할 뿐 API 요청을 보내지 않습니다.

v0.6.0~v0.6.2의 수동 provider mapping은 v0.6.5에서 직접 연결로 이관됩니다. 예전에 특정 provider를 저장했더라도 이제는 그 업체 하나에 고정하지 않고 등록된 모든 provider 모델을 표시합니다. 기존 `disabled`는 연결 안 함으로 보존하고 provider별 마지막 CMR 모델 선택도 보존합니다. v0.6.3~v0.6.4에서 수동 UI를 제거하면서 직접 연결이 사라졌던 회귀는 v0.6.5에서 복구했습니다.

외부 확장이 모델 컨트롤을 다시 만들면 CMR 옵션을 다시 추가합니다. 저장된 provider별 CMR 선택은 동일 target으로 다시 감지된 새 컨트롤의 값이 비어 있을 때만 복원하고, 외부 확장이 이미 설정한 유효한 현재값은 덮어쓰지 않습니다. 외부 확장 업데이트로 control의 ID·name·label 또는 상위 확장 구조가 바뀌면 새 target으로 인식될 수 있습니다. 새 대상은 자동 연결로 시작하며 provider 판별에 실패하면 사용자가 직접 연결을 다시 선택할 수 있습니다.

v0.6.5 이관은 legacy mapping 512개가 한도를 먼저 채워도 `selectedModels`를 우선 보존하며, 유효한 legacy provider mapping은 직접 연결로 바꿉니다. 오래된 외부 선택 또는 mapping 기록 512개로 저장소가 포화된 경우에는 현재 DOM에서 감지되지 않은 target 기록 하나만 교체합니다. 이때 재렌더 복구용 선택 기록을 우선 보존하기 위해 mapping만 있는 기록을 먼저 정리합니다.

이 브리지는 외부 확장의 기존 선택 이벤트와 저장 경로를 사용합니다. 전역 `fetch`나 `XMLHttpRequest`를 교체하지 않고, API 키·endpoint 또는 외부 확장의 요청 본문을 직접 읽거나 덮어쓰지 않습니다. 따라서 실제 요청 반영 여부는 해당 확장이 표준 컨트롤의 `input` 또는 `change` 이벤트로 모델을 저장하는지에 달려 있으며, Network 요청의 `model` 값으로 최종 확인해야 합니다.

다음은 자동 연결하지 않습니다.

- Vectors·embedding·rerank 모델
- TTS·음성 합성 모델
- Stable Diffusion·이미지 생성 모델
- 제공업체를 안전하게 판별할 수 없고 사용자가 직접 연결하지 않은 컨트롤
- React 등에서 표준 컨트롤을 노출하지 않는 사용자 위젯, iframe 내부, 닫힌 Shadow DOM

표준 모델 컨트롤이 없거나 자체 위젯만 사용하는 확장은 CMR의 Registry 또는 Routing API를 사용하는 전용 opt-in 연동이 필요합니다. 자동 탐지와 비대상 판별은 DOM의 이름·레이블·속성·상위 확장 표식을 사용하는 best-effort 호환 기능이며 모든 외부 확장의 요청 규격을 보증하지 않습니다. 알 수 없는 표준 Chat Completion 대상에는 자동으로 모델을 넣지 않지만, 사용자가 대상과 용도를 확인한 뒤 직접 연결할 수 있습니다.

## 용도별 보조 요청 라우팅

용도별 라우팅은 다른 확장 또는 개발자가 명시적으로 사용하는 opt-in API입니다. v0.6.3부터 일반 관리 팝업에는 라우팅 설정·해제·시험 UI가 없지만, 기존 route 저장값, Routing API, Connection Profile 어댑터와 portable backup 계약은 유지합니다. 저장 경로에는 provider·model ID·adapter ID·profile ID만 들어가며 프로필 본문이나 인증정보는 복제하지 않습니다.

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
- 외부 모델 컨트롤의 자동·직접 연결·판별 불가·안전상 건너뜀 개수
- 런처, MutationObserver, 이벤트 구독과 사용자 모델 그룹 중복
- source·profile 전환 표본에서 자원이 증가하는지 여부

**진단 복사**는 코드·상태·개수로 구성된 JSON을 복사합니다. API 키, endpoint URL, project ID, Service Account와 Connection Profile 본문은 포함하지 않습니다. 오류를 보고할 때도 복사한 내용을 검토한 뒤 민감정보가 없는지 한 번 더 확인하세요.

## 설정 백업과 복구

**백업 내보내기**는 다음 세 항목만 portable schema v2 JSON으로 저장합니다.

- Registry의 제공업체·모델 ID·선택 상태
- 용도별 route의 provider·model ID·adapter ID·Connection Profile ID
- 외부 모델 컨트롤의 DOM 표식 기반 target ID, `manual` 직접 연결 또는 `disabled` 연결 안 함 상태와 provider별 마지막 CMR 모델 선택. 자동 연결 target은 `mappings`에 별도 값을 저장하지 않습니다.

API 키, endpoint, 리전, project/account ID, Service Account, 프로필 본문과 생성 설정은 저장하지 않습니다.

**백업 가져오기**는 적용 전에 JSON 형식, 최대 크기, 알려진 필드, provider·모델 ID, route와 schema 버전을 검사하고 사용자 확인을 받습니다. v0.5의 portable schema v1 백업은 외부 연결이 비어 있는 schema v2로 이관합니다. v0.6.0~v0.6.2 백업의 legacy provider mapping은 `manual` 직접 연결로 이관하고 `disabled`와 정상 형식의 `selectedModels`는 보존합니다. v0.6.3~v0.6.4 백업의 빈 mapping과 선택 기록도 그대로 읽습니다. mapping과 선택을 합친 고유 target이 schema 한도 512개를 넘으면 일부를 조용히 버리지 않고 가져오기를 거부합니다. 알 수 없는 필드나 미래 schema가 있으면 기존 설정을 바꾸지 않고 거부합니다. 가져온 profile ID가 현재 존재하지 않으면 route는 보존되지만 실행 시 명시 오류가 발생합니다.

## 호환성 제한

이 확장은 **모델 ID만 기존 SillyTavern 요청 경로에 전달**합니다.

- 새 endpoint, 인증 방식, API 버전 또는 deployment name이 필요한 모델은 ID 등록만으로 지원되지 않습니다.
- 새 thinking·tool·image·prefill·응답 변환 계약은 SillyTavern 코어나 별도 어댑터 지원이 필요할 수 있습니다.
- 원격 카탈로그에 없는 모델은 context·가격·멀티모달 metadata 자동 판단이 제한될 수 있습니다.
- 실제 제공업체 계정, 권한, 지역별 제공 여부는 자동 검사할 수 없습니다.
- 범용 브리지는 표준 DOM Chat Completion 컨트롤에만 선택지를 추가합니다. 자체 위젯·iframe·닫힌 Shadow DOM이나 컨트롤 없는 요청은 직접 연결할 수 없으며 전용 연동이 필요합니다.
- 외부 확장의 provider alias, `data-type`과 선택 이벤트는 보존하지만 그 확장의 실제 request body 생성 로직까지 통제하지 않습니다.
- Vectors·embedding·TTS·Stable Diffusion·이미지 생성 모델은 Chat Completion Registry와 모델 종류가 달라 의도적으로 제외합니다.

## 문제 해결

### 모델 컨트롤을 찾지 못함

정상적으로 찾은 모델 컨트롤은 관리 팝업에 별도 상태로 표시하지 않습니다. 오류가 표시되면 API Connections에서 해당 Chat Completion source를 열고 연결 상태를 확인한 뒤 팝업을 다시 여세요. 모델 ID 등록은 가능하지만 SillyTavern 컨트롤을 찾지 못하면 등록 모델이 기존 모델 목록에 나타나지 않습니다.

### 원격 모델 목록 갱신 뒤 사용자 모델이 사라짐

일부 제공업체는 연결할 때 선택기를 다시 만듭니다. 확장은 변경을 감지해 사용자 옵션을 다시 추가하고, 동일 target의 새 컨트롤이 빈 값일 때 저장 선택을 복원합니다. 외부 확장이 설정한 유효한 현재값은 그대로 둡니다. 연결 완료 뒤에도 옵션이 복원되지 않으면 새로고침하고 체크리스트의 환경 정보와 함께 보고하세요.

### 다른 확장에서 모델이 보이지 않음

관리 팝업의 **다른 확장 모델 연결**에서 해당 대상을 찾습니다. 제공업체 선택기가 있거나 자동 판별에 성공한 대상은 자동 연결을 사용합니다. 제공업체 선택기가 없거나 자동 판별하지 못하는 표준 Chat Completion 대상은 직접 연결을 선택하면 모든 provider의 등록 모델이 provider별로 나타납니다. 연결 안 함이면 CMR 모델이 나타나지 않습니다. 목록에 대상 자체가 없으면 그 확장이 자체 위젯, iframe, 닫힌 Shadow DOM 또는 모델 컨트롤 없는 요청 방식을 쓰는지 확인하세요.

### 등록 모델 삭제가 거부됨

select형 연결에서 현재 사용 중인 custom-only 모델은 관리 UI와 공개 `unregisterModel()` API 모두 등록 해제를 거부합니다. SillyTavern의 기존 모델 선택기에서 native 모델로 먼저 전환한 뒤 삭제하세요. 공개 API 오류 코드는 `model_in_use`입니다. 자유 입력형 `Custom`은 Registry에서 삭제해도 SillyTavern의 현재 `custom_model` 입력값을 지우지 않습니다.

### 라우팅 시험이 실패함

일반 관리 팝업에는 라우팅 시험 UI가 없습니다. Routing API를 사용하는 확장 또는 개발자는 모델이 Registry에 남아 있는지, Connection Profile이 존재하는지, profile source와 route provider가 같은지 확인하세요. 실패 시 다른 모델이나 메인 연결로 자동 대체하지 않습니다.

### 백업 가져오기가 거부됨

파일을 직접 편집했다면 알 수 없는 필드, 잘못된 model ID, 중복 모델, 미래 schema 또는 크기 제한 오류를 확인하세요. 거부 시 현재 설정은 유지됩니다.

## 개발 및 검사

런타임 의존성과 빌드 과정은 없습니다. Node.js 20 이상에서 실행합니다.

```bash
npm test
npm run check
```

현재 자동 검사 146개는 24개 provider 회계, 전체 등록 모델 UI와 SillyTavern native 선택 경계, 공개 API의 `model_in_use` 보호, schema 이관, 동적 옵션 복원, 팝업 수명주기, 개발자용 라우팅 격리, 외부 select/input/datalist 자동·직접·연결 안 함, provider별 그룹 주입·재렌더·정리, 512개 legacy mapping 이관 시 선택 우선 보존, stale 선택·mapping 포화 회복, 비대상 제외, 호환성 진단, 자원 누적 판정, portable schema v1→v2 이관과 버전·문서 일치를 검증합니다. 실제 계정과 브라우저 조작이 필요한 결과는 [통합 사용자 체크리스트](./USER_CHECKLIST.md)에서 별도로 확인합니다.

추가로 실제 브라우저 DOM 샌드박스에서 24개 컨트롤 감지, GLM 등록과 SillyTavern native 선택, 개발자 API 라우팅, 외부 자동 추론, source/profile 이벤트 반복, 비활성화·재활성화와 정리 수명주기를 확인합니다. 이 결과는 실제 제공업체 자격 증명과 네트워크 요청 성공을 대신하지 않습니다.

## 버전 정책

- 새 기능 범위는 `v0.n.0`으로 올립니다.
- 같은 기능 범위의 버그 수정과 세부 문서 변경은 `v0.n.n`으로 올립니다.
- 작은 수정 때문에 다음 기능 버전으로 건너뛰지 않습니다.
- 버전 변경 시 manifest, package, 초기화 로그, README, API 문서, 체크리스트와 로드맵을 함께 맞춥니다. 관리 팝업에는 버전 배지를 표시하지 않습니다.

## 로드맵 요약

| 버전 | 목표 | 상태 |
|---|---|---|
| `v0.1.x` | Vertex 기반 Registry와 관리 UI | ✅ 완료 |
| `v0.2.x` | 24개 Chat Completion 연결 | ✅ 구현·자동 검사 완료 |
| `v0.3.0` | 공개 Registry API | ✅ 완료 |
| `v0.4.0` | Connection Profile 어댑터와 용도별 직접 라우팅 | ✅ 완료 |
| `v0.5.0` | 호환성 진단·비밀정보 제외 백업·운영 안정성 계측 | ✅ 완료; 기존 외부 확장 자동 표시는 미구현이었음 |
| `v0.6.0` | 범용 DOM 모델 브리지와 외부 연결 portable backup | ✅ 구현·자동 검사 완료, 사용자 검증 대기 |
| `v0.6.1` | 관리 팝업 UI·UX 재구성 | ↩️ 사용자 피드백에 따라 롤백 |
| `v0.6.2` | v0.6.1 UI 변경 롤백·제품 방향 재논의 | ✅ 롤백 릴리스 |
| `v0.6.3` | 등록·삭제 전용 UI, native 선택, 외부 자동 추론, 개발자용 라우팅 API로 역할 단순화 | ✅ 완료 |
| `v0.6.4` | 공개 API 삭제 안전성, 512개 legacy mapping 선택 우선 이관, stale 외부 선택 저장 회복 | ✅ 완료 |
| `v0.6.5` | 전체 등록 목록·UI 정리, 외부 직접 연결과 연결 안 함 회귀 복구 | ✅ 현재 릴리스 |

문제가 있으면 [GitHub Issues](https://github.com/p16481012/Custom-Model-Router/issues)에 SillyTavern 버전, 제공업체, 체크리스트 항목 ID와 민감정보를 제거한 오류를 남겨 주세요.
