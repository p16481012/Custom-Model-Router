# 공개 Registry 및 Provider Integration API

Custom Model Router v0.6.15는 다른 SillyTavern 확장이 내부 파일 경로에 의존하지 않고 등록 모델, 공용 provider 연동과 용도별 라우팅을 사용할 수 있도록 `globalThis.CustomModelRouter`를 제공합니다. Registry API 계약 버전은 `1.2.0`, `CustomModelRouter.integrations`의 Provider Integration API 계약 버전은 `1.0.0`, Routing API 계약 버전은 `1.0.0`입니다. Registry `1.2.0`은 Integration API를 추가한 하위 호환 minor 갱신이며 Routing API는 v0.5.0의 `1.0.0` 계약을 유지합니다.

v0.6.0의 범용 DOM 모델 브리지, v0.6.15의 hookless native provider option 재사용, 호환성 진단과 설정 백업·복구, v0.6.7의 Playwright UI 회귀 검사 인프라는 Registry/Routing 호출 계약에 포함되지 않습니다. v0.6.14의 Provider Integration API는 공개 hook을 명시적으로 등록한 소비 확장에만 적용되며 hookless native 재사용과 별도 경로입니다. 대상별 제외·복구와 기존 UI 선택지 주입 상태는 진단 섹션의 고급 외부 연결 관리에 있고, 실제 요청 반영은 별도로 확인해야 합니다. 외부 저장 schema v2 역시 공개 API 호출 계약과 별개입니다. Routing API는 개발자 또는 연동 확장이 명시적으로 사용하는 opt-in 계약이며 일반 라우팅 UI는 없습니다. 용도별 경로에는 Connection Profile ID만 저장되고 프로필 본문·API 키·endpoint는 복제되지 않습니다.

## 호환성 확인

```js
const registry = globalThis.CustomModelRouter;
if (!registry?.isCompatible('1.2.0')) {
    throw new Error('Custom Model Router Registry API 1.2.0 이상이 필요합니다.');
}

if (!registry.integrations?.isCompatible('1.0.0')) {
    throw new Error('Custom Model Router Provider Integration API 1.0.0이 필요합니다.');
}
```

호환성은 같은 major 안에서 요청한 최소 버전을 충족할 때만 참입니다. 확장 자체 버전은 `extensionVersion`, API 계약 버전은 `apiVersion`으로 구분합니다.

## 조회

- `getProviders()`: 공개 가능한 제공업체 ID, 이름, 종류, protocol 목록
- `getSnapshot()`: revision, 모델 목록, 제공업체별 Registry 선택 상태의 불변 스냅샷
- `listModels(provider?, { enabledOnly? })`: 전체 또는 제공업체별 모델 목록
- `getModel(provider, modelId)`, `hasModel(provider, modelId)`
- `getSelectedModelId(provider)`, `getSelectedModel(provider)`
- `createModelKey(provider, modelId)`: 충돌 없는 `(provider, model ID)` 복합키

반환 객체와 배열은 깊게 동결되어 있습니다. selector, 설정 키, 인증·엔드포인트 같은 내부 정보는 공개하지 않습니다.

## 변경

- `registerModel(provider, modelId)`
- `unregisterModel(provider, modelId)`
- `selectModel(provider, modelId | null)`

`selectModel()`은 Registry의 제공업체별 저장 선택 상태만 바꿉니다. SillyTavern의 현재 API source, 기본 selector, 메인 채팅 모델을 직접 전환하지 않습니다. 이 경계는 `capabilities.selectionScope === 'registry'`로 확인할 수 있습니다.

`unregisterModel()`은 SillyTavern `select`형 연결의 현재 설정값과 같은 custom-only 모델을 등록 해제하지 않습니다. 해당 요청은 `ModelRegistryError`의 `model_in_use` 코드로 거부되며 Registry와 SillyTavern 선택은 유지됩니다. SillyTavern 기존 선택기에서 native 모델로 전환한 뒤 다시 호출하면 등록 해제됩니다. 자유 입력형 연결은 기존 입력값을 지우지 않는 계약을 유지합니다.

## 이벤트

`subscribe(listener)`는 전체 이벤트를, `subscribe(type, listener)`는 지정 이벤트만 구독합니다. 반환 함수를 호출하면 구독을 해제합니다.

- `model:registered`
- `model:unregistered`
- `model:changed`
- `selection:changed`
- `registry:changed`

각 이벤트는 `type`, `revision`, `source`, `detail`, `snapshot`을 포함하는 불변 객체입니다. 한 구독자의 예외는 다른 구독자 알림을 중단하지 않습니다.

## 생명주기

확장이 비활성화되면 전역 API가 제거되고 기존 참조는 `destroyed` 오류를 냅니다. 소비 확장은 API 참조를 영구 캐시하지 말고, 자신의 활성화 시점에 존재 여부와 호환성을 다시 확인해야 합니다.

## Provider Integration API 1.0.0

`CustomModelRouter.integrations`는 외부 확장이 공개 provider registry 또는 hook을 제공할 때 사용하는 opt-in 계약입니다. CMR은 외부 확장의 비공개 provider 배열, 요청 함수, 전역 `fetch` 또는 `XMLHttpRequest`를 추측해 patch하지 않습니다. 공개 hook이 없거나 계약이 맞지 않는 확장의 provider UI는 변경하지 않습니다.

### 세 가지 공용 연동 경계

1. **선택된 SillyTavern 연결 상속** (`sillytavern-inherited`): 현재 선택된 Connection Manager 프로필이 Chat Completion 프로필이고 source가 CMR Registry provider와 일치할 때, 해당 비-Custom provider의 활성 Registry 모델과 요청 handler를 준비합니다.
2. **선택된 Custom OpenAI-compatible 특화** (`openai-compatible`): 현재 선택된 Connection Manager 프로필 source가 `Custom`일 때만 `custom` Registry 모델과 OpenAI-compatible 요청 handler를 준비합니다.
3. **버전이 명시된 공개 provider registry/hook**: 외부 확장이 Integration API `1.0.0`의 descriptor와 `installHandler`·`publishModels` hook을 등록해 위 handler와 모델을 자신의 provider UI·요청 경로에 수용합니다.

앞의 두 항목은 공개 hook 소비 확장에 제공하는 공용 backend 전략입니다. CMR이 hookless 확장 화면에 자동으로 provider를 삽입한다는 의미가 아닙니다. 기존 v0.6 DOM 모델 브리지와 v0.6.15 native provider option 재사용은 별도 계층으로 계속 동작하므로 hookless 확장이라도 안전하게 감지된 표준 모델 `select`·텍스트 `input`·`datalist`에는 모델 선택지가 표시될 수 있습니다. 이 경로는 `installHandler`·`publishModels`를 호출하지 않습니다.

### 검색과 capability

CMR 초기화가 끝난 뒤 전역 API를 확인합니다. CMR보다 먼저 로드되는 소비 확장은 `document`의 `custom-model-router:provider-integrations-ready` 이벤트 `detail`에서 같은 Integration API 객체를 받을 수 있습니다.

`integrations.capabilities`에는 다음 경계를 선언합니다.

- `strategies`: `sillytavern-inherited`, `openai-compatible`
- `inputSchema`: `cmr.chat-completion/1`
- `atomicHandlerBeforeModels: true`
- `selectedConnectionProfileOnly: true`
- `credentials: 'connection-manager-owned'`
- `mainChatMutation: false`
- `unknownConsumersUntouched: true`
- `ownedControlAttribute: 'data-cmr-provider-hook-owned'`
- `consumerRequirements`: 소비 확장이 정확히 선언해야 하는 `1.0.0` capability 집합

Connection Profile ID, 프로필 본문, API 키와 endpoint는 provider·model descriptor, Integration 이벤트와 진단에 포함되지 않습니다. CMR은 선택된 Connection Manager 프로필을 불투명한 참조로 사용하며 endpoint override를 받지 않습니다.

### 소비 확장 등록

소비 확장은 자신의 provider slot과 지원 전략을 선언하고 두 hook을 함께 등록합니다.

```js
const integrations = globalThis.CustomModelRouter?.integrations;
if (!integrations?.isCompatible('1.0.0')) {
    throw new Error('Provider Integration API 1.0.0이 필요합니다.');
}

const registration = integrations.registerConsumer({
    consumerId: 'example-extension',
    label: 'Example Extension',
    contractVersion: '1.0.0',
    capabilities: { ...integrations.capabilities.consumerRequirements },
    slots: [{
        slotId: 'chat',
        strategies: ['sillytavern-inherited', 'openai-compatible'],
    }],
}, {
    async installHandler({ slotId, strategy, provider, capabilities, execute, signal }) {
        const handlerToken = installIntoPublicProviderRegistry({
            slotId,
            strategy,
            provider,
            execute,
            signal,
        });
        return {
            requestHandlerBound: true,
            handlerToken,
            dispose: () => removeHandler(handlerToken),
        };
    },
    async publishModels({ handlerToken, provider, models, signal }) {
        const publicationToken = publishProviderAndModels({
            handlerToken,
            provider,
            models,
            signal,
        });
        return {
            modelsPublished: true,
            publicationToken,
            updateModels: nextModels => updatePublishedModels(publicationToken, nextModels),
            dispose: () => removePublishedModels(publicationToken),
        };
    },
});

const state = await registration.ready;
// 소비 확장 종료 시 registration.dispose()
```

descriptor 요구사항은 다음과 같습니다.

- `consumerId`: 다른 소비 확장과 충돌하지 않는 소문자 ID
- `contractVersion`: `1.0.0`과 같은 major의 호환 버전
- `capabilities`: `integrations.capabilities.consumerRequirements`와 키·값이 정확히 일치해야 함
- `slots`: 1~16개의 고유 `slotId`와 하나 이상의 지원 `strategies`
- hook: `installHandler`와 `publishModels`를 모두 제공

`consumerRequirements`는 input schema, handler-before-model-publish, provider 단위 모델, AbortSignal·streaming, 불투명 자격 증명 참조, endpoint override 금지, 메인 채팅 무변경, silent fallback 금지와 명시적 dispose를 요구합니다. 일부만 지원하거나 추가 capability로 계약을 모호하게 만드는 소비 확장은 fail closed로 등록을 거부합니다.

### handler 설치와 모델 게시 순서

binding은 다음 순서를 모두 통과해야만 `ready`가 됩니다.

1. CMR이 `installHandler()`에 동결된 provider descriptor, 안전 capability, `execute`와 binding `signal`을 전달합니다.
2. 소비 확장이 `requestHandlerBound: true`, 고유 `handlerToken`, `dispose()`가 있는 영수증을 반환합니다.
3. CMR이 그 `handlerToken`과 현재 provider의 활성 Registry 모델을 `publishModels()`에 전달합니다.
4. 소비 확장이 `modelsPublished: true`, 고유 `publicationToken`, `updateModels()`, `dispose()`가 있는 영수증을 반환합니다.
5. 두 영수증이 유효하고 binding이 아직 활성일 때만 상태와 모델 수가 `ready`로 공개됩니다.

handler 설치가 확인되기 전에는 `publishModels()`를 호출하지 않습니다. 모델 게시가 실패하면 handler도 정리하고 provider UI를 준비 상태로 남기지 않습니다. Registry 모델이 바뀌면 게시 영수증의 `updateModels()`가 `true`를 반환해야 계속 유지합니다. 소비 확장 해제, profile 변경, CMR 비활성화, AbortSignal 또는 늦게 도착한 영수증에서도 확보한 게시·handler 자원을 각각 한 번만 정리합니다.

각 hook은 성공 영수증을 반환하기 전에 만든 자체 side effect가 있다면 reject 또는 throw 전에 스스로 원복해야 합니다. CMR은 실제로 전달받은 영수증의 `dispose()`만 호출할 수 있으며, 반환되지 않은 token이나 소비 확장 내부 UI를 추측해 정리하지 않습니다. 영수증 `dispose()`가 응답하지 않더라도 CMR 비활성화·재초기화가 무기한 멈추지는 않습니다.

소비 확장이 provider/model DOM을 만들면 그 소유 루트에 `data-cmr-provider-hook-owned="true"`를 지정해야 합니다. 기존 DOM 모델 브리지는 이 표식이 있는 하위 컨트롤을 건너뛰어 같은 CMR 모델을 중복 주입하지 않습니다.

### 공용 요청 schema

설치 hook에 전달된 `execute(request, { signal? })`는 binding이 `ready`인 동안에만 사용할 수 있습니다. request는 다음 값만 허용합니다.

- `modelId`: 게시된 provider의 현재 활성 Registry 모델 ID
- `prompt` 문자열 또는 `messages` 배열 중 정확히 하나
- `maxTokens`: 1 이상의 정수
- 선택 `stream`, `extractData`: boolean

임의 endpoint, API 키, header, profile ID, preset·instruct override와 알 수 없는 필드는 거부합니다. 실행 직전에도 선택된 Connection Profile과 provider가 binding 생성 시점과 같은지 다시 확인합니다. profile이 바뀌었거나 모델이 비활성화되면 명시적으로 실패하며 다른 provider·모델 또는 메인 채팅 요청으로 대체하지 않습니다.

`stream: false`이거나 생략한 요청은 `execute()`의 Promise가 일반 응답 값을 반환합니다. `stream: true` 요청은 Promise가 **한 번만 호출할 수 있는 `() => AsyncIterator` factory**를 반환합니다. 소비 확장은 factory를 호출한 뒤 `for await...of`로 끝까지 읽거나, 조기 종료할 때 iterator의 `return()`을 호출해야 합니다. `for await...of`의 `break`는 이 정리를 자동으로 수행합니다.

stream factory를 아직 호출하지 않았거나 반복 중이더라도 소비 확장 해제, CMR 비활성화 또는 전달한 `AbortSignal` 취소가 발생하면 이후 factory·`next()`는 고정된 `AbortError`로 실패합니다. profile 변경은 재조정 전에 감지되면 `backend_stale`, binding이 이미 해제 중이면 `AbortError`로 중단됩니다. factory 재사용, 올바르지 않은 iterator, factory·반복기 내부 예외도 비식별 고정 오류로 바뀌며 외부 backend의 원문 오류를 전달하지 않습니다.

`getConsumers()`는 소비 확장별 slot·strategy의 `pending`, `ready`, `failed` 상태와 공개 provider ID·모델 개수만 반환합니다. `refresh()`는 실패 binding 재시도와 현재 선택 profile·Registry 모델 재조정을 요청합니다. `subscribe(listener)`는 비밀정보 없는 수명주기 이벤트를 제공하고 반환 함수로 해제합니다.

## Hookless native provider option 재사용

이 기능은 새 provider·요청 handler·credential bridge를 설치하는 API가 아닙니다. 외부 확장에 이미 존재하고 현재 선택된 native provider option을 보수적으로 분류해, 연결된 model control에 투영할 Registry 모델 집합만 좁힙니다.

| 선택된 native provider option | 투영 모델 | 변경하지 않는 항목 |
|---|---|---|
| 정확한 Custom/OpenAI-compatible 선택 | provider가 `custom`인 활성 Registry 모델만 | provider option·선택값, endpoint·API 키, 외부 handler |
| 정확한 SillyTavern/current-connection 후보 | 현재 활성 SillyTavern provider와 같은 활성 Registry 모델만 | provider option·선택값, 메인 source·모델·Connection Profile |

`main`, `current`, `inherit`, `openai`, `st` 같은 단독 토큰과 서로 충돌하는 값·표시명은 native 재사용으로 분류하지 않습니다. 이처럼 모호한 provider option은 일반 DOM 브리지의 안전 판정이 별도로 성립하면 종전의 best-effort 선택지 주입을 유지할 수 있지만, native 재사용 특화라고 보고하지 않습니다.

반대로 provider option 자체는 정확한 SillyTavern/current-connection 후보인데 현재 활성 SillyTavern provider가 없거나 CMR 지원 provider로 확정되지 않으면 `sillytavern-current` 분류를 유지한 채 `current-connection-unavailable` 실패로 표시합니다. 이 경우 모델을 투영하지 않으며 전체 provider, `custom` 또는 임의 provider 모델로 fallback하지 않습니다. 사용자가 현재 ST Chat Completion 연결을 확인해야 합니다.

분류 결과는 모델 projection에만 사용합니다. CMR은 provider option을 추가·삭제하거나 해당 control 값을 바꾸지 않고, endpoint·API 키를 읽거나 복제하지 않으며, 전역 `fetch`·`XMLHttpRequest`, 외부 확장의 요청 함수 또는 SillyTavern main settings를 patch하지 않습니다. DOM option은 외부 확장의 실제 handler 구현을 증명하지 않으므로 소비 기능을 실행한 뒤 요청 payload의 `model`과 성공 결과를 직접 확인해야 합니다.

## 용도별 Routing API

`CustomModelRouter.routing`은 모델 별칭 없이 `{ provider, modelId, adapterId, connectionProfileId }`를 저장합니다.

v0.6.3부터 일반 관리 팝업에는 route 등록·해제·시험 UI가 없습니다. 기존 route 저장값과 portable backup은 유지되며, 소비 확장은 아래 API로 경로를 관리해야 합니다.

- `getRoutes()`, `getRoute(purpose)`
- `setRoute(purpose, route)`, `removeRoute(purpose)`
- `listAdapters()`, `registerAdapter(adapter)`, `unregisterAdapter(id)`
- `execute(purpose, request, { signal? })`
- `subscribe(listener)`

기본 용도는 `translation`, `summary`, `search`, `captioning`, `custom`입니다. 다른 확장은 고유한 소문자 네임스페이스 용도를 사용할 수 있습니다. 경로·모델·어댑터가 없거나 profile 제공업체가 다르면 명시적인 오류를 내며 현재 모델로 대체하지 않습니다.

내장 `sillytavern.connection-profile` 어댑터는 SillyTavern 1.18.0의 공개 `ConnectionManagerRequestService`를 사용합니다. 메인 `chatCompletionSettings`를 수정하지 않으며 Connection Profile의 인증과 endpoint를 재사용하고 `model`만 경로 값으로 지정합니다.

## v0.6 범용 DOM 모델 브리지

v0.5.0의 Registry/Routing API는 소비 확장이 직접 호출해야 하는 opt-in 계약이었습니다. 그 API만으로는 기존 다른 확장의 모델 목록에 CMR 모델이 나타나지 않습니다. v0.6.0은 별도의 DOM 브리지로 표준 Chat Completion 모델 컨트롤을 best-effort 연결합니다.

브리지는 다음 순서로 동작합니다.

1. 표준 `select`, 텍스트 `input`, `datalist` 중 model/LLM 의미를 가진 외부 컨트롤을 찾습니다.
2. ID·name·label, 상위 확장 표식과 모델 control 구조를 조합해 Chat Completion 모델 칸인지 판별합니다.
3. 외부 provider/source 선택기는 이름에 `model`이 포함되어도 모델 target으로 세지 않고 CMR option을 넣지 않습니다. native provider option과 현재 값은 보존하며 실제 모델 control의 metadata·change/input 감시에만 사용합니다.
4. 같은 외부 확장 경계에 provider 후보가 여러 개면 첫 후보를 임의로 모델 control에 연결하지 않습니다.
5. 안전한 모델 대상에는 native option과 중복되지 않는 Registry provider 모델을 target별 최대 512개까지 provider별 optgroup으로 추가합니다. 사용자가 schema v2에서 명시적으로 제외한 target은 주입하지 않습니다.
6. Vectors·embedding 등 위험 분류로 제외한 대상과 사용자가 제외한 대상은 서로 다른 상태로 유지합니다.
7. 연결이 확인된 외부 provider select와 option의 `data-type`이 있으면 실제 모델 control의 CMR option에도 provider alias를 보존해 외부 확장의 자체 필터가 동작하게 합니다.
8. 외부 확장이 컨트롤을 다시 렌더링하면 CMR option을 다시 추가합니다. 동일 target의 새 컨트롤 값이 비어 있을 때만 마지막 CMR 선택을 provider 식별자와 함께 복원하며, 외부 확장이 둔 유효한 현재값은 덮어쓰지 않습니다.
9. 비활성화 시 CMR이 추가한 option, observer와 listener만 제거합니다.

대표 provider alias는 다음과 같습니다.

| 외부 확장 값 | Registry provider |
|---|---|
| `anthropic`, `claude` | `claude` |
| `google`, `Google AI Studio`, `gemini` | `makersuite` |
| `vertex`, `vertexai` | `vertexai` |
| `mistral`, `MistralAI` | `mistralai` |
| `zai`, `Z.AI`, `GLM` | `zai` |
| `openai-compatible`, `LM Studio`, `Ollama`, `local api` | `custom` |

Caption처럼 provider/source 선택기와 별도 model select가 있거나 하나의 model select에 provider별 option이 함께 들어 있고 `data-type`으로 구분하는 경우에는 확인된 외부 provider 값을 실제 model control의 CMR option에도 보존합니다. SillyTavern 1.18.0 Caption은 `.caption_settings` 경계의 `#caption_multimodal_api`와 `#caption_multimodal_model` 조합으로 검증합니다. provider/source 선택기 자체에는 CMR option을 추가하지 않고 native option·현재 값을 유지합니다. target별 512개 한도 안에서 주입한 provider 모델은 `제공업체 이름 · 사용자 모델` optgroup으로 구분합니다. 단, CMR Registry는 모델의 vision 능력을 저장하지 않으므로 실제 Caption handler·요청과 멀티모달 호환성은 모델과 계정에서 확인해야 합니다.

### 네트워크 경계

DOM 브리지는 전역 `fetch` 또는 `XMLHttpRequest`를 monkey patch하지 않습니다. 외부 확장의 API 키, endpoint와 요청 본문을 읽거나 수정하지 않고, 그 확장이 이미 등록한 `input`/`change` 이벤트를 통해 선택값을 저장하도록 합니다. 고급 관리의 **선택지 연결됨**은 CMR option 주입 성공만 뜻하며 실제 요청 호환성을 인증하지 않습니다. 목록 표시와 실제 요청 반영은 서로 다른 검증 단계이므로 기능을 실행한 뒤 Network 요청 JSON의 `model`이 선택한 ID인지 확인해야 합니다.

### 관리 UI와 option 한도

고급 외부 연결 관리의 기본 목록에는 bridge 실패 대상과 schema v2에서 사용자가 제외한 대상만 나타납니다. 정상 direct 대상은 사용자가 **문제가 생긴 모델 칸 제외**를 펼쳤을 때만 선택기에 표시합니다. Vectors·embedding·TTS·Stable Diffusion 같은 위험 대상은 두 관리 목록 모두에 행을 만들지 않고 진단 집계에만 포함합니다. provider/source 선택기는 모델 target이 아니므로 두 목록과 진단 `targetCount` 모두에 포함하지 않습니다.

진단의 외부 bridge details는 `nativeCustomTargetCount`, `nativeCurrentTargetCount`, `nativeReuseProjectedTargetCount`, `nativeReuseUnavailableTargetCount`로 native 재사용 분류·projection·현재 연결 확인 불가 상태를 집계합니다. 이 집계에는 provider option 원문, endpoint와 API 키가 포함되지 않습니다.

외부 target 하나에는 native option과 중복되는 항목을 제외한 표시 가능한 CMR 후보 중 최대 512개만 주입합니다. 이 target별 후보가 512개를 넘으면 용량 주의를 표시합니다. 모든 direct target의 예상 CMR option 합계 또는 실제 CMR option 합계가 2,048개를 넘으면 별도의 성능 주의를 표시합니다. 위험 분류 대상과 native option은 CMR option 예산에서 제외합니다. 이 한도와 경고는 DOM 브리지 구현 계약이며 `CustomModelRouter.listModels()` 결과를 줄이지 않습니다. 따라서 활성 Registry 모델 총수가 512개를 넘는다는 사실만으로 target별 용량 경고가 발생하지는 않습니다.

### 의도적 제외

- 외부 provider/source 선택기. 실제 모델 control의 metadata·변경 감시에는 사용할 수 있지만 모델 target으로 등록하거나 CMR option을 주입하지 않습니다.
- Vectors·embedding·rerank 모델
- TTS·voice·speech 모델
- Stable Diffusion·이미지 생성 모델
- endpoint·URL·API 키·deployment·account·project·region 같은 민감 설정 입력란
- React 등 자체 위젯만 있는 확장, iframe 내부, 닫힌 Shadow DOM
- 모델 컨트롤 없이 직접 요청하는 확장

자체 위젯, iframe, 닫힌 Shadow DOM 또는 모델 컨트롤 없는 요청은 DOM 브리지로 연결할 수 없으며 이 문서의 Registry, Provider Integration 또는 Routing API를 사용하는 opt-in 연동이 필요합니다. 공개 hook을 제공하지 않는 임의 확장에는 provider handler나 provider UI를 강제로 추가하지 않습니다. 비대상 판별도 DOM의 이름·레이블·속성·상위 확장 표식에 의존하는 best-effort입니다.

## 외부 연결 저장 계약

DOM 브리지 내부 저장 schema v2는 다음 구조입니다. target ID는 외부 컨트롤의 ID·name·label과 상위 확장 구조 등 DOM 표식을 조합해 만든 식별자이며 endpoint나 비밀값을 포함하지 않습니다. 같은 확장 영역에서 이 표식까지 같은 모델 칸이 여러 개면 첫 대상의 기존 ID를 유지하고 후속 대상에는 구조 위치를 더해 서로 구분합니다. 같은 live DOM 객체가 재정렬될 때는 기존 target ID를 유지하지만, 동일한 ID·name·label·구조의 컨트롤을 외부 확장이 모두 새 객체로 만들고 순서까지 뒤집으면 이전 target과 새 컨트롤을 대응할 안정 표식이 없습니다. 이 경우 선택 복원을 보장하려면 외부 확장이 고유 ID·name·label 또는 안정된 상위 구조 표식을 제공해야 합니다.

`mappings`는 빈 호환 필드로만 직렬화합니다. `selectedModels`에는 target의 마지막 CMR 선택과 provider 식별자를 저장하고, `excludedTargets`에는 사용자가 고급 메뉴에서 명시적으로 제외한 schema v2 target만 `true`로 저장합니다. 동일 값이 여러 provider에 존재하는 입력란에서는 오연결을 피하기 위해 후보 provider가 함께 저장될 수 있습니다.

```json
{
  "schemaVersion": 2,
  "mappings": {},
  "selectedModels": {
    "cmr-ext-1234abcd": {
      "vertexai": "gemini-새로운-모델"
    }
  },
  "excludedTargets": {
    "cmr-ext-2345bcde": true
  }
}
```

schema v1과 v0.6.0~v0.6.5 설정·백업에 남은 provider 고정·`manual`·`disabled` mapping은 읽은 뒤 제거합니다. schema v1에 임의의 `excludedTargets`가 있거나 mapping 값이 `disabled`여도 v2 사용자 제외로 되살리지 않습니다. 정상 `selectedModels`만 보존하고, v2에서 사용자가 새로 제외한 target부터 `excludedTargets`에 저장합니다.

새 CMR 모델을 선택하면 해당 target·provider의 이전 선택 기록을 현재 선택으로 교체합니다. 선택 또는 제외 target의 합집합은 최대 512개까지 보존하며, 같은 target에 선택과 제외가 함께 있어도 한 개로 계수합니다. 재렌더된 동일 target의 새 컨트롤이 빈 값일 때만 선택을 복원하고 유효한 외부 현재값은 유지합니다. 손상된 값과 알 수 없는 필드는 정규화 과정에서 제거하며, 미래 schema는 명시 오류로 거부합니다.

## Portable backup schema v2

portable backup 최상위는 `format`, `schemaVersion`, `createdAt`, `registry`, `purposeRoutes`, `externalIntegrations`만 가집니다. `externalIntegrations`는 내부 schema v2의 빈 `mappings`, target별 `selectedModels`와 명시적 `excludedTargets`를 포함해 내보내기·가져오기 round trip 합니다. 개발자용 `purposeRoutes`는 일반 라우팅 UI가 없어도 보존됩니다. API 키, endpoint, provider 계정 설정, 외부 요청 본문과 Connection Profile 본문은 포함되지 않습니다.

portable JSON은 UTF-8 기준 최대 8,000,000바이트, 모델 5,000개, route 256개입니다. 생성·직렬화·파싱 단계가 같은 상한을 사용하므로 성공한 내보내기 결과는 다시 가져올 수 있습니다.

v0.6.10 관리 UI는 가져온 설정을 곧바로 적용하지 않고 현재 설정과 비교한 모델·선택·route·외부 target의 추가·충돌·삭제 요약을 먼저 표시합니다. 사용자가 적용하기 전에 설정 revision이 달라지면 미리보기를 다시 만들도록 중단하며, 현재 사용 중인 custom-only 모델을 삭제하는 변경은 `model_in_use`로 차단합니다. 이 미리보기는 UI 안전장치이고 portable schema 자체를 변경하지 않습니다.

저장값 복구 보고서의 `details`는 schema 버전, 안전한 범주와 모델·선택·route 레코드의 제거·병합·정규화·거부 사유 코드 및 개수를 포함합니다. 원래 레코드 값, target ID, Connection Profile ID와 비밀정보는 상세 보고에 복제하지 않습니다.

v0.5.0에서 내보낸 portable schema v1 백업은 `registry`와 `purposeRoutes`를 보존하고 빈 `externalIntegrations`를 추가해 portable schema v2로 이관합니다. 외부 연결 schema v1과 v0.6.0~v0.6.5 백업은 Registry·route·정상 형식의 `selectedModels`를 보존하고 legacy mapping·`disabled`를 제거하며, 이를 v2 사용자 제외로 변환하지 않습니다. v2 백업의 `excludedTargets`는 정상 `selectedModels`와 함께 복원됩니다. 선택·제외 target 합집합이 외부 schema 한도 512개를 넘는 백업은 일부 기록을 조용히 버리지 않고 가져오기를 거부합니다. 알 수 없는 필드나 미래 portable/Registry/route/external schema는 기존 설정을 변경하지 않고 거부합니다.
