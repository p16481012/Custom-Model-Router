import {
    ModelRegistryError,
    addModel,
    createModelKey,
    normalizeSettings,
    removeModel,
    setSelectedModel,
} from './registry.js';
import {
    getProvider,
    getProviders,
    normalizeProviderId,
    normalizeProviderModelId,
    validateProviderModelId,
} from './providers.js';

export const REGISTRY_API_GLOBAL_NAME = 'CustomModelRouter';
export const REGISTRY_API_VERSION = '1.1.0';

export const REGISTRY_EVENT_TYPES = Object.freeze({
    MODEL_REGISTERED: 'model:registered',
    MODEL_UNREGISTERED: 'model:unregistered',
    MODEL_CHANGED: 'model:changed',
    SELECTION_CHANGED: 'selection:changed',
    REGISTRY_CHANGED: 'registry:changed',
});

const ALL_EVENTS = '*';
const EVENT_TYPE_SET = new Set(Object.values(REGISTRY_EVENT_TYPES));
const API_INSTANCES = new WeakSet();

export class RegistryApiError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'RegistryApiError';
        this.code = code;
    }
}

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!isObject(value) || seen.has(value)) {
        return value;
    }

    seen.add(value);
    for (const child of Object.values(value)) {
        deepFreeze(child, seen);
    }
    return Object.freeze(value);
}

function createPublicProvider(provider) {
    return deepFreeze({
        id: provider.id,
        label: provider.label,
        kind: provider.kind,
        protocol: provider.protocol,
    });
}

const PUBLIC_PROVIDERS = Object.freeze(getProviders().map(createPublicProvider));
const PUBLIC_PROVIDERS_BY_ID = new Map(PUBLIC_PROVIDERS.map(provider => [provider.id, provider]));

function createPublicModel(model) {
    return deepFreeze({
        key: createModelKey(model.provider, model.id),
        provider: model.provider,
        id: model.id,
        protocol: model.protocol,
        enabled: model.enabled,
    });
}

function createState(settings) {
    const normalized = normalizeSettings(settings);
    return {
        schemaVersion: normalized.schemaVersion,
        models: normalized.models.map(model => ({ ...model })),
        selectedModels: { ...normalized.selectedModels },
    };
}

function createComparableState(state) {
    return JSON.stringify({
        schemaVersion: state.schemaVersion,
        models: state.models,
        selectedModels: state.selectedModels,
    });
}

function createSnapshot(state, revision) {
    return deepFreeze({
        schemaVersion: state.schemaVersion,
        revision,
        models: state.models.map(createPublicModel),
        selectedModels: { ...state.selectedModels },
    });
}

function parseVersion(value) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ''));
    return match ? match.slice(1).map(Number) : null;
}

/**
 * 현재 API가 같은 major의 최소 버전 요구사항을 충족하는지 확인한다.
 * 버전 범위 문자열 대신 명시적인 `major.minor.patch`만 받는다.
 */
export function isRegistryApiCompatible(requiredVersion, actualVersion = REGISTRY_API_VERSION) {
    const required = parseVersion(requiredVersion);
    const actual = parseVersion(actualVersion);
    if (!required || !actual || required[0] !== actual[0]) {
        return false;
    }

    for (let index = 1; index < actual.length; index += 1) {
        if (actual[index] !== required[index]) {
            return actual[index] > required[index];
        }
    }
    return true;
}

function normalizeSource(value) {
    const source = String(value ?? '').trim();
    return source || 'external';
}

function diffStates(previous, next) {
    const changes = [];
    const previousModels = new Map(previous.models.map(model => [
        createModelKey(model.provider, model.id),
        model,
    ]));
    const nextModels = new Map(next.models.map(model => [
        createModelKey(model.provider, model.id),
        model,
    ]));

    for (const [key, model] of previousModels) {
        if (!nextModels.has(key)) {
            changes.push({
                type: REGISTRY_EVENT_TYPES.MODEL_UNREGISTERED,
                provider: model.provider,
                modelId: model.id,
                previousModel: createPublicModel(model),
                model: null,
            });
        }
    }

    for (const [key, model] of nextModels) {
        const previousModel = previousModels.get(key);
        if (!previousModel) {
            changes.push({
                type: REGISTRY_EVENT_TYPES.MODEL_REGISTERED,
                provider: model.provider,
                modelId: model.id,
                previousModel: null,
                model: createPublicModel(model),
            });
        } else if (JSON.stringify(previousModel) !== JSON.stringify(model)) {
            changes.push({
                type: REGISTRY_EVENT_TYPES.MODEL_CHANGED,
                provider: model.provider,
                modelId: model.id,
                previousModel: createPublicModel(previousModel),
                model: createPublicModel(model),
            });
        }
    }

    const providers = new Set([
        ...Object.keys(previous.selectedModels),
        ...Object.keys(next.selectedModels),
    ]);
    for (const provider of providers) {
        const previousModelId = previous.selectedModels[provider] ?? null;
        const modelId = next.selectedModels[provider] ?? null;
        if (previousModelId !== modelId) {
            changes.push({
                type: REGISTRY_EVENT_TYPES.SELECTION_CHANGED,
                provider,
                previousModelId,
                modelId,
            });
        }
    }

    return changes;
}

function validateDependencies(options) {
    if (typeof options?.readSettings !== 'function') {
        throw new RegistryApiError('invalid_reader', 'Registry API에는 동기 readSettings 함수가 필요합니다.');
    }
    if (typeof options?.writeSettings !== 'function') {
        throw new RegistryApiError('invalid_writer', 'Registry API에는 동기 writeSettings 함수가 필요합니다.');
    }
    if (options.onSubscriberError !== undefined && typeof options.onSubscriberError !== 'function') {
        throw new RegistryApiError('invalid_error_handler', 'onSubscriberError는 함수여야 합니다.');
    }
}

function assertValidEventType(eventType) {
    if (eventType !== ALL_EVENTS && !EVENT_TYPE_SET.has(eventType)) {
        throw new RegistryApiError('unknown_event', `알 수 없는 Registry 이벤트입니다: ${eventType}`);
    }
}

function validatePublicModelKey(providerId, modelId) {
    const validation = validateProviderModelId(providerId, modelId);
    if (!validation.ok) {
        throw new ModelRegistryError(validation.code, validation.message);
    }
    return {
        provider: validation.provider.id,
        id: validation.id,
        key: createModelKey(validation.provider.id, validation.id),
    };
}

/**
 * 공개 API와 내부 생명주기 제어기를 함께 만든다.
 * `api`만 전역에 노출하고, 기존 UI에서 설정을 바꾼 뒤에는
 * `synchronize(source)`를 호출해 구독자에게 같은 계약으로 알린다.
 */
export function createRegistryApi(options) {
    validateDependencies(options);

    const listeners = new Map([[ALL_EVENTS, new Set()]]);
    for (const eventType of EVENT_TYPE_SET) {
        listeners.set(eventType, new Set());
    }

    const extensionVersion = String(options.extensionVersion ?? 'unknown');
    const onSubscriberError = options.onSubscriberError ?? (() => {});
    let active = true;
    let revision = 0;
    let lastNotifiedState = createState(options.readSettings());

    function assertActive() {
        if (!active) {
            throw new RegistryApiError('destroyed', '종료된 Registry API 인스턴스입니다.');
        }
    }

    function readCurrentState() {
        assertActive();
        return createState(options.readSettings());
    }

    function getSnapshot() {
        return createSnapshot(readCurrentState(), revision);
    }

    function notify(event) {
        for (const eventType of [event.type, ALL_EVENTS]) {
            for (const listener of [...listeners.get(eventType)]) {
                try {
                    listener(event);
                } catch (error) {
                    try {
                        onSubscriberError(error, event);
                    } catch {
                        // 한 구독자의 오류 처리기가 다른 구독자의 알림을 중단하면 안 된다.
                    }
                }
            }
        }
    }

    function publishChanges(previous, next, source) {
        const changes = diffStates(previous, next);
        lastNotifiedState = next;
        if (changes.length === 0) {
            return 0;
        }

        revision += 1;
        const snapshot = createSnapshot(next, revision);
        const publicChanges = changes.map(change => deepFreeze({ ...change }));

        for (const change of publicChanges) {
            notify(deepFreeze({
                type: change.type,
                revision,
                source,
                detail: change,
                snapshot,
            }));
        }
        notify(deepFreeze({
            type: REGISTRY_EVENT_TYPES.REGISTRY_CHANGED,
            revision,
            source,
            detail: { changes: publicChanges },
            snapshot,
        }));
        return publicChanges.length;
    }

    function commit(nextSettings, source) {
        const previous = readCurrentState();
        if (createComparableState(lastNotifiedState) !== createComparableState(previous)) {
            publishChanges(lastNotifiedState, previous, 'external');
        }
        const expected = createState(nextSettings);
        if (createComparableState(previous) === createComparableState(expected)) {
            return previous;
        }

        const writeResult = options.writeSettings(nextSettings);
        if (writeResult && typeof writeResult.then === 'function') {
            throw new RegistryApiError('async_writer', 'writeSettings는 설정을 즉시 반영하는 동기 함수여야 합니다.');
        }

        const next = readCurrentState();
        if (createComparableState(next) !== createComparableState(expected)) {
            throw new RegistryApiError('write_not_applied', 'writeSettings가 요청한 Registry 설정을 즉시 반영하지 않았습니다.');
        }

        // 통합 코드가 writeSettings 안에서 synchronize를 호출했더라도
        // 이미 알린 상태를 다시 발행하지 않는다.
        if (createComparableState(lastNotifiedState) !== createComparableState(next)) {
            publishChanges(lastNotifiedState, next, source);
        }
        return next;
    }

    function listModels(providerId, queryOptions = {}) {
        const normalizedProvider = providerId === undefined || providerId === null
            ? null
            : normalizeProviderId(providerId);
        if (normalizedProvider !== null && !getProvider(normalizedProvider)) {
            return Object.freeze([]);
        }

        const enabledOnly = queryOptions?.enabledOnly !== false;
        const models = readCurrentState().models
            .filter(model => (
                (normalizedProvider === null || model.provider === normalizedProvider)
                && (!enabledOnly || model.enabled)
            ))
            .map(createPublicModel);
        return Object.freeze(models);
    }

    function getModel(providerId, modelId) {
        const provider = normalizeProviderId(providerId);
        const id = normalizeProviderModelId(modelId);
        const model = readCurrentState().models.find(candidate => (
            candidate.provider === provider && candidate.id === id
        ));
        return model ? createPublicModel(model) : null;
    }

    function getSelectedModelId(providerId) {
        const provider = normalizeProviderId(providerId);
        return readCurrentState().selectedModels[provider] ?? null;
    }

    function getSelectedModel(providerId) {
        const provider = normalizeProviderId(providerId);
        const modelId = getSelectedModelId(provider);
        return modelId === null ? null : getModel(provider, modelId);
    }

    function registerModel(providerId, modelId) {
        assertActive();
        const key = validatePublicModelKey(providerId, modelId);
        const nextSettings = addModel(readCurrentState(), key.provider, key.id);
        const next = commit(nextSettings, 'api');
        return createPublicModel(next.models.find(model => (
            model.provider === key.provider && model.id === key.id
        )));
    }

    function unregisterModel(providerId, modelId) {
        assertActive();
        const provider = normalizeProviderId(providerId);
        const id = normalizeProviderModelId(modelId);
        const current = readCurrentState();
        if (!current.models.some(model => model.provider === provider && model.id === id)) {
            return false;
        }

        commit(removeModel(current, provider, id), 'api');
        return true;
    }

    /**
     * Registry의 제공업체별 선택 상태만 바꾼다.
     * SillyTavern의 현재 연결, 모델 컨트롤, 채팅용 주 모델은 변경하지 않는다.
     */
    function selectModel(providerId, modelId) {
        assertActive();
        const provider = normalizeProviderId(providerId);
        const id = modelId === null || modelId === undefined || modelId === ''
            ? null
            : normalizeProviderModelId(modelId);
        const next = commit(setSelectedModel(readCurrentState(), provider, id), 'api');
        if (id === null) {
            return null;
        }
        return createPublicModel(next.models.find(model => (
            model.provider === provider && model.id === id
        )));
    }

    function subscribe(eventTypeOrListener, maybeListener) {
        assertActive();
        const eventType = typeof eventTypeOrListener === 'function'
            ? ALL_EVENTS
            : String(eventTypeOrListener);
        const listener = typeof eventTypeOrListener === 'function'
            ? eventTypeOrListener
            : maybeListener;
        assertValidEventType(eventType);
        if (typeof listener !== 'function') {
            throw new RegistryApiError('invalid_listener', 'Registry 이벤트 구독자는 함수여야 합니다.');
        }

        listeners.get(eventType).add(listener);
        let subscribed = true;
        return Object.freeze(() => {
            if (!subscribed) {
                return false;
            }
            subscribed = false;
            return listeners.get(eventType)?.delete(listener) ?? false;
        });
    }

    const capabilities = deepFreeze({
        compoundModelKeys: true,
        providerSelections: true,
        selectionScope: 'registry',
        purposeRouting: Boolean(options.routingApi),
        immutableSnapshots: true,
        mutations: Object.freeze(['registerModel', 'unregisterModel', 'selectModel']),
        events: Object.freeze(Object.values(REGISTRY_EVENT_TYPES)),
    });

    const api = Object.freeze({
        name: REGISTRY_API_GLOBAL_NAME,
        apiVersion: REGISTRY_API_VERSION,
        extensionVersion,
        capabilities,
        events: REGISTRY_EVENT_TYPES,
        isCompatible(requiredVersion) {
            return isRegistryApiCompatible(requiredVersion);
        },
        createModelKey(providerId, modelId) {
            return validatePublicModelKey(providerId, modelId).key;
        },
        getProviders() {
            assertActive();
            return PUBLIC_PROVIDERS;
        },
        getProvider(providerId) {
            assertActive();
            return PUBLIC_PROVIDERS_BY_ID.get(normalizeProviderId(providerId)) ?? null;
        },
        getSnapshot,
        listModels,
        getModel,
        hasModel(providerId, modelId) {
            return getModel(providerId, modelId) !== null;
        },
        getSelectedModelId,
        getSelectedModel,
        registerModel,
        unregisterModel,
        selectModel,
        subscribe,
        routing: options.routingApi ?? null,
    });
    API_INSTANCES.add(api);

    const controller = Object.freeze({
        api,
        synchronize(source = 'external') {
            assertActive();
            const next = readCurrentState();
            if (createComparableState(lastNotifiedState) === createComparableState(next)) {
                return 0;
            }
            return publishChanges(lastNotifiedState, next, normalizeSource(source));
        },
        destroy() {
            if (!active) {
                return false;
            }
            active = false;
            for (const subscribers of listeners.values()) {
                subscribers.clear();
            }
            return true;
        },
    });

    return controller;
}

/**
 * 전역에 공개 API를 설치한다. 다른 스크립트가 같은 이름을 사용 중이면
 * 덮어쓰지 않고 명시적인 충돌 오류를 낸다.
 */
export function installRegistryApi(target, api, globalName = REGISTRY_API_GLOBAL_NAME) {
    if (!isObject(target) && typeof target !== 'function') {
        throw new RegistryApiError('invalid_global_target', 'Registry API 전역 대상이 올바르지 않습니다.');
    }
    if (!API_INSTANCES.has(api)) {
        throw new RegistryApiError('invalid_api', 'createRegistryApi로 만든 API만 설치할 수 있습니다.');
    }

    const name = String(globalName ?? '').trim();
    if (!name) {
        throw new RegistryApiError('invalid_global_name', 'Registry API 전역 이름이 비어 있습니다.');
    }
    if (Object.hasOwn(target, name)) {
        if (target[name] === api) {
            return Object.freeze(() => false);
        }
        throw new RegistryApiError('global_conflict', `${name} 전역 이름이 이미 사용 중입니다.`);
    }

    Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        writable: false,
        value: api,
    });
    let installed = true;
    return Object.freeze(() => {
        if (!installed || target[name] !== api) {
            return false;
        }
        installed = false;
        return delete target[name];
    });
}
