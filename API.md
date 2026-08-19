# 공개 Registry API

Custom Model Router v0.6.6은 다른 SillyTavern 확장이 내부 파일 경로에 의존하지 않고 등록 모델과 용도별 라우팅을 사용할 수 있도록 `globalThis.CustomModelRouter`를 제공합니다. Registry API 계약 버전은 `1.1.0`, Routing API 계약 버전은 `1.0.0`이며 v0.5.0과 동일합니다.

v0.6.0의 범용 DOM 모델 브리지, 호환성 진단과 설정 백업·복구는 이 전역 API 계약에 포함되지 않습니다. v0.6.6 일반 UI의 모델 목록은 등록·삭제만 담당하고, 외부 대상 목록은 단일 직접 연결 상태만 읽기 전용으로 표시합니다. Routing API는 개발자 또는 연동 확장이 명시적으로 사용하는 opt-in 계약이며 일반 라우팅 UI는 없습니다. 용도별 경로에는 Connection Profile ID만 저장되고 프로필 본문·API 키·endpoint는 복제되지 않습니다.

## 호환성 확인

```js
const registry = globalThis.CustomModelRouter;
if (!registry?.isCompatible('1.1.0')) {
    throw new Error('Custom Model Router Registry API 1.1.0 이상이 필요합니다.');
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
3. 안전한 대상에는 Registry의 모든 provider 모델을 provider별 optgroup으로 추가합니다.
4. 외부 provider select와 option의 `data-type`이 있으면 CMR option에도 provider alias를 보존해 외부 확장의 자체 필터가 동작하게 합니다.
5. 외부 확장이 컨트롤을 다시 렌더링하면 CMR option을 다시 추가합니다. 동일 target의 새 컨트롤 값이 비어 있을 때만 마지막 CMR 선택을 provider 식별자와 함께 복원하며, 외부 확장이 둔 유효한 현재값은 덮어쓰지 않습니다.
6. 비활성화 시 CMR이 추가한 option, observer와 listener만 제거합니다.

대표 provider alias는 다음과 같습니다.

| 외부 확장 값 | Registry provider |
|---|---|
| `anthropic`, `claude` | `claude` |
| `google`, `Google AI Studio`, `gemini` | `makersuite` |
| `vertex`, `vertexai` | `vertexai` |
| `mistral`, `MistralAI` | `mistralai` |
| `zai`, `Z.AI`, `GLM` | `zai` |
| `openai-compatible`, `LM Studio`, `Ollama`, `local api` | `custom` |

Caption처럼 하나의 model select에 provider별 option이 함께 들어 있고 `data-type`으로 구분하는 경우에는 외부 provider 값을 CMR option에도 보존합니다. 모든 provider 모델은 `제공업체 이름 · 사용자 모델` optgroup으로 구분합니다. 단, CMR Registry는 모델의 vision 능력을 저장하지 않으므로 실제 Caption 호환성은 모델과 계정에서 확인해야 합니다.

### 네트워크 경계

DOM 브리지는 전역 `fetch` 또는 `XMLHttpRequest`를 monkey patch하지 않습니다. 외부 확장의 API 키, endpoint와 요청 본문을 읽거나 수정하지 않고, 그 확장이 이미 등록한 `input`/`change` 이벤트를 통해 선택값을 저장하도록 합니다. 따라서 목록 표시와 실제 요청 반영은 서로 다른 검증 단계입니다. 기능을 실행한 뒤 Network 요청 JSON의 `model`이 선택한 ID인지 확인해야 합니다.

### 의도적 제외

- Vectors·embedding·rerank 모델
- TTS·voice·speech 모델
- Stable Diffusion·이미지 생성 모델
- endpoint·URL·API 키·deployment·account·project·region 같은 민감 설정 입력란
- React 등 자체 위젯만 있는 확장, iframe 내부, 닫힌 Shadow DOM
- 모델 컨트롤 없이 직접 요청하는 확장

자체 위젯, iframe, 닫힌 Shadow DOM 또는 모델 컨트롤 없는 요청은 DOM 브리지로 연결할 수 없으며 이 문서의 Registry 또는 Routing API를 사용하는 전용 opt-in 연동이 필요합니다. 비대상 판별도 DOM의 이름·레이블·속성·상위 확장 표식에 의존하는 best-effort입니다.

## 외부 연결 저장 계약

DOM 브리지 내부 저장 schema v1은 다음 구조입니다. target ID는 외부 컨트롤의 ID·name·label과 상위 확장 구조 등 DOM 표식을 조합해 만든 식별자이며 endpoint나 비밀값을 포함하지 않습니다. `mappings`는 과거 설정을 읽기 위한 빈 호환 필드로만 남고, `selectedModels`에는 target의 마지막 CMR 선택과 provider 식별자를 저장합니다. 동일 값이 여러 provider에 존재하는 입력란에서는 오연결을 피하기 위해 후보 provider가 함께 저장될 수 있습니다.

```json
{
  "schemaVersion": 1,
  "mappings": {},
  "selectedModels": {
    "cmr-ext-1234abcd": {
      "vertexai": "gemini-새로운-모델"
    }
  }
}
```

v0.6.0~v0.6.5 설정·백업에 남은 provider 고정·`manual`·`disabled` mapping은 읽은 뒤 제거합니다. `selectedModels`는 target의 마지막 CMR 모델 ID와 provider 식별자를 저장합니다. 새 CMR 모델을 선택하면 그 target의 이전 선택 기록을 현재 선택으로 교체합니다. 선택 target은 최대 512개까지 보존합니다. 재렌더된 동일 target의 새 컨트롤이 빈 값일 때만 이 선택을 복원하고 유효한 외부 현재값은 유지합니다. 손상된 값과 알 수 없는 필드는 정규화 과정에서 제거하며, 미래 schema는 명시 오류로 거부합니다.

## Portable backup schema v2

portable backup 최상위는 `format`, `schemaVersion`, `createdAt`, `registry`, `purposeRoutes`, `externalIntegrations`만 가집니다. `externalIntegrations.mappings`는 빈 호환 필드이고, `selectedModels`에는 target의 마지막 CMR 선택과 provider 식별자가 포함됩니다. 개발자용 `purposeRoutes`는 일반 라우팅 UI가 없어도 보존됩니다. API 키, endpoint, provider 계정 설정, 외부 요청 본문과 Connection Profile 본문은 포함되지 않습니다.

v0.5.0에서 내보낸 portable schema v1 백업은 `registry`와 `purposeRoutes`를 보존하고 빈 `externalIntegrations`를 추가해 schema v2로 이관합니다. v0.6.0~v0.6.5 백업은 Registry·route·정상 형식의 `selectedModels`를 보존하고 legacy mapping을 제거합니다. 선택 target이 schema 한도 512개를 넘는 백업은 일부 기록을 조용히 버리지 않고 가져오기를 거부합니다. 알 수 없는 필드나 미래 portable/Registry/route/external schema는 기존 설정을 변경하지 않고 거부합니다.
