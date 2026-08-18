# 공개 Registry API

Custom Model Router v0.3.0은 다른 SillyTavern 확장이 내부 파일 경로에 의존하지 않고 등록 모델을 사용할 수 있도록 `globalThis.CustomModelRouter`를 제공합니다. API 계약 버전은 `1.0.0`입니다.

## 호환성 확인

```js
const registry = globalThis.CustomModelRouter;
if (!registry?.isCompatible('1.0.0')) {
    throw new Error('Custom Model Router Registry API 1.0.0 이상이 필요합니다.');
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

v0.4.0에서 추가될 용도별 라우팅은 이 Registry 선택 상태와 별개로 `(provider, model ID)`를 직접 참조합니다. 모델 별칭은 계약에 포함하지 않습니다.
