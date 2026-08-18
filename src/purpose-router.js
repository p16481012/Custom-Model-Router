import {
    hasEnabledModel,
} from './registry.js';
import {
    normalizeProviderId,
    validateProviderModelId,
} from './providers.js';

export const PURPOSE_ROUTES_SCHEMA_VERSION = 1;
export const PURPOSE_ROUTING_API_VERSION = '1.0.0';
export const BUILTIN_PURPOSES = Object.freeze([
    'translation',
    'summary',
    'search',
    'captioning',
    'custom',
]);

const PURPOSE_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const CONNECTION_PROFILE_ID_MAX_LENGTH = 256;

export class PurposeRouterError extends Error {
    constructor(code, message, options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = 'PurposeRouterError';
        this.code = code;
        this.details = options.details ?? null;
    }
}

export function normalizePurposeId(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function validatePurposeId(value) {
    const id = normalizePurposeId(value);
    if (!id) {
        return {
            ok: false,
            code: 'purpose_empty',
            message: '용도를 입력해 주세요.',
        };
    }

    if (!PURPOSE_ID_PATTERN.test(id)) {
        return {
            ok: false,
            code: 'purpose_invalid',
            message: '용도는 영문 소문자로 시작하고 영문 소문자, 숫자, 마침표, 밑줄, 하이픈만 사용할 수 있습니다.',
        };
    }

    return { ok: true, id };
}

export function normalizeAdapterId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function validateAdapterId(value) {
    const id = normalizeAdapterId(value);
    if (!id) {
        return {
            ok: false,
            code: 'adapter_not_selected',
            message: '이 용도에 사용할 어댑터를 선택해 주세요.',
        };
    }

    if (!ADAPTER_ID_PATTERN.test(id)) {
        return {
            ok: false,
            code: 'adapter_id_invalid',
            message: '어댑터 ID 형식이 올바르지 않습니다.',
        };
    }

    return { ok: true, id };
}

function normalizeConnectionProfileId(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    return String(value).trim();
}

function validateConnectionProfileId(value) {
    const id = normalizeConnectionProfileId(value);
    if (id === null) {
        return { ok: true, id: null };
    }

    if (!id || id.length > CONNECTION_PROFILE_ID_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(id)) {
        return {
            ok: false,
            code: 'connection_profile_id_invalid',
            message: '연결 프로필 ID 형식이 올바르지 않습니다.',
        };
    }

    return { ok: true, id };
}

/**
 * 별칭을 만들지 않고 제공업체와 실제 모델 ID를 그대로 검사한다.
 * `registrySettings`를 넘긴 경우 현재 Registry에 활성 모델로 등록되어 있는지도 확인한다.
 */
export function validatePurposeRoute(value, options = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
            ok: false,
            code: 'route_invalid',
            message: '용도별 경로 형식이 올바르지 않습니다.',
        };
    }

    const provider = normalizeProviderId(value.provider);
    const modelValidation = validateProviderModelId(provider, value.modelId);
    if (!modelValidation.ok) {
        return {
            ok: false,
            code: modelValidation.code,
            message: modelValidation.message,
        };
    }

    const adapterValidation = validateAdapterId(value.adapterId);
    if (!adapterValidation.ok) {
        return adapterValidation;
    }

    const profileValidation = validateConnectionProfileId(value.connectionProfileId);
    if (!profileValidation.ok) {
        return profileValidation;
    }

    if (options.registrySettings !== undefined && !hasEnabledModel(
        options.registrySettings,
        provider,
        modelValidation.id,
    )) {
        return {
            ok: false,
            code: 'model_not_registered',
            message: '이 경로가 가리키는 모델이 Registry에 활성 모델로 등록되어 있지 않습니다.',
        };
    }

    const route = {
        provider,
        modelId: modelValidation.id,
        adapterId: adapterValidation.id,
    };
    if (profileValidation.id !== null) {
        route.connectionProfileId = profileValidation.id;
    }

    return { ok: true, route };
}

/**
 * 저장값의 문법만 복구한다. Registry에서 사라진 모델 경로는 삭제하지 않는다.
 * 실행 시 `model_not_registered` 오류를 내므로 모델을 재등록하면 경로를 복구할 수 있다.
 */
export function normalizePurposeRoutes(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const candidates = source.routes && typeof source.routes === 'object' && !Array.isArray(source.routes)
        ? source.routes
        : {};
    const routes = {};

    for (const [candidatePurpose, candidateRoute] of Object.entries(candidates)) {
        const purposeValidation = validatePurposeId(candidatePurpose);
        const routeValidation = validatePurposeRoute(candidateRoute);
        if (!purposeValidation.ok || !routeValidation.ok) {
            continue;
        }

        routes[purposeValidation.id] = routeValidation.route;
    }

    return {
        schemaVersion: PURPOSE_ROUTES_SCHEMA_VERSION,
        routes,
    };
}

export function getPurposeRoute(value, purpose) {
    const purposeValidation = validatePurposeId(purpose);
    if (!purposeValidation.ok) {
        return null;
    }

    const route = normalizePurposeRoutes(value).routes[purposeValidation.id];
    return route ? { ...route } : null;
}

export function setPurposeRoute(value, purpose, route, options = {}) {
    const purposeValidation = validatePurposeId(purpose);
    if (!purposeValidation.ok) {
        throw new PurposeRouterError(purposeValidation.code, purposeValidation.message);
    }

    const routeValidation = validatePurposeRoute(route, options);
    if (!routeValidation.ok) {
        throw new PurposeRouterError(routeValidation.code, routeValidation.message);
    }

    const normalized = normalizePurposeRoutes(value);
    return {
        schemaVersion: PURPOSE_ROUTES_SCHEMA_VERSION,
        routes: {
            ...normalized.routes,
            [purposeValidation.id]: routeValidation.route,
        },
    };
}

export function removePurposeRoute(value, purpose) {
    const normalized = normalizePurposeRoutes(value);
    const purposeValidation = validatePurposeId(purpose);
    if (!purposeValidation.ok || !Object.hasOwn(normalized.routes, purposeValidation.id)) {
        return normalized;
    }

    const routes = { ...normalized.routes };
    delete routes[purposeValidation.id];
    return {
        schemaVersion: PURPOSE_ROUTES_SCHEMA_VERSION,
        routes,
    };
}

function cloneRoutes(value) {
    return normalizePurposeRoutes(value);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) {
        return value;
    }

    seen.add(value);
    for (const child of Object.values(value)) {
        deepFreeze(child, seen);
    }
    return Object.freeze(value);
}

function freezeRoute(route) {
    return Object.freeze({ ...route });
}

function throwIfAborted(signal) {
    if (!signal?.aborted) {
        return;
    }

    if (typeof signal.throwIfAborted === 'function') {
        signal.throwIfAborted();
    }

    if (signal.reason instanceof Error) {
        throw signal.reason;
    }

    const error = new Error('요청이 취소되었습니다.');
    error.name = 'AbortError';
    throw error;
}

function isAbortSignal(value) {
    return value === null
        || value === undefined
        || (
            typeof value === 'object'
            && typeof value.aborted === 'boolean'
            && typeof value.addEventListener === 'function'
        );
}

/**
 * 다른 확장이 명시적으로 opt-in할 수 있는 용도별 라우터다.
 * 어댑터를 찾지 못했을 때 다른 모델이나 어댑터로 자동 대체하지 않는다.
 */
export class PurposeRouter {
    #routes;
    #adapters = new Map();
    #listeners = new Set();
    #getRegistrySettings;
    #onRoutesChanged;
    #active = true;

    constructor(options = {}) {
        this.#routes = cloneRoutes(options.routes);
        this.#getRegistrySettings = typeof options.getRegistrySettings === 'function'
            ? options.getRegistrySettings
            : () => undefined;
        this.#onRoutesChanged = typeof options.onRoutesChanged === 'function'
            ? options.onRoutesChanged
            : null;
    }

    getRoutesSnapshot() {
        this.#assertActive();
        return cloneRoutes(this.#routes);
    }

    replaceRoutes(value) {
        this.#assertActive();
        const next = cloneRoutes(value);
        this.#commitRoutes(next, 'routes-replaced', null);
        return this.getRoutesSnapshot();
    }

    setRoute(purpose, route) {
        this.#assertActive();
        const next = setPurposeRoute(this.#routes, purpose, route, {
            registrySettings: this.#getRegistrySettings(),
        });
        const normalizedPurpose = normalizePurposeId(purpose);
        this.#commitRoutes(next, 'route-set', normalizedPurpose);
        return getPurposeRoute(next, normalizedPurpose);
    }

    removeRoute(purpose) {
        this.#assertActive();
        const normalizedPurpose = normalizePurposeId(purpose);
        const before = getPurposeRoute(this.#routes, normalizedPurpose);
        if (!before) {
            return false;
        }

        const next = removePurposeRoute(this.#routes, normalizedPurpose);
        this.#commitRoutes(next, 'route-removed', normalizedPurpose);
        return true;
    }

    getRoute(purpose) {
        this.#assertActive();
        return getPurposeRoute(this.#routes, purpose);
    }

    registerAdapter(adapter) {
        this.#assertActive();
        if (!adapter || typeof adapter !== 'object') {
            throw new PurposeRouterError('adapter_invalid', '어댑터 형식이 올바르지 않습니다.');
        }

        const adapterValidation = validateAdapterId(adapter.id);
        if (!adapterValidation.ok) {
            throw new PurposeRouterError(adapterValidation.code, adapterValidation.message);
        }
        if (typeof adapter.execute !== 'function') {
            throw new PurposeRouterError('adapter_execute_missing', '어댑터에 execute 함수가 없습니다.');
        }
        if (adapter.supports !== undefined && typeof adapter.supports !== 'function') {
            throw new PurposeRouterError('adapter_supports_invalid', '어댑터의 supports는 함수여야 합니다.');
        }
        if (this.#adapters.has(adapterValidation.id)) {
            throw new PurposeRouterError('adapter_duplicate', '같은 ID의 어댑터가 이미 등록되어 있습니다.');
        }

        const registered = Object.freeze({
            id: adapterValidation.id,
            label: String(adapter.label ?? adapterValidation.id),
            supports: adapter.supports,
            execute: adapter.execute,
        });
        this.#adapters.set(registered.id, registered);
        this.#emit({ type: 'adapter-registered', adapterId: registered.id });

        let disposed = false;
        return () => {
            if (disposed) {
                return false;
            }
            disposed = true;
            return this.unregisterAdapter(registered.id, registered);
        };
    }

    unregisterAdapter(adapterId, expectedAdapter = null) {
        this.#assertActive();
        const id = normalizeAdapterId(adapterId);
        const current = this.#adapters.get(id);
        if (!current || (expectedAdapter && current !== expectedAdapter)) {
            return false;
        }

        this.#adapters.delete(id);
        this.#emit({ type: 'adapter-unregistered', adapterId: id });
        return true;
    }

    listAdapters() {
        this.#assertActive();
        return [...this.#adapters.values()].map(adapter => ({
            id: adapter.id,
            label: adapter.label,
        }));
    }

    subscribe(listener) {
        this.#assertActive();
        if (typeof listener !== 'function') {
            throw new PurposeRouterError('listener_invalid', '이벤트 구독자는 함수여야 합니다.');
        }

        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    async execute(purpose, request, options = {}) {
        this.#assertActive();
        const signal = options.signal ?? null;
        if (!isAbortSignal(signal)) {
            throw new PurposeRouterError('signal_invalid', 'signal은 AbortSignal이어야 합니다.');
        }
        throwIfAborted(signal);

        const purposeValidation = validatePurposeId(purpose);
        if (!purposeValidation.ok) {
            throw new PurposeRouterError(purposeValidation.code, purposeValidation.message);
        }

        const route = getPurposeRoute(this.#routes, purposeValidation.id);
        if (!route) {
            throw new PurposeRouterError(
                'route_not_configured',
                `용도 '${purposeValidation.id}'에 설정된 모델 경로가 없습니다.`,
            );
        }

        const routeValidation = validatePurposeRoute(route, {
            registrySettings: this.#getRegistrySettings(),
        });
        if (!routeValidation.ok) {
            throw new PurposeRouterError(routeValidation.code, routeValidation.message, {
                details: { purpose: purposeValidation.id },
            });
        }

        const adapter = this.#adapters.get(routeValidation.route.adapterId);
        if (!adapter) {
            throw new PurposeRouterError(
                'adapter_unavailable',
                `어댑터 '${routeValidation.route.adapterId}'가 등록되어 있지 않습니다.`,
                { details: { purpose: purposeValidation.id, adapterId: routeValidation.route.adapterId } },
            );
        }

        const execution = Object.freeze({
            purpose: purposeValidation.id,
            route: freezeRoute(routeValidation.route),
            provider: routeValidation.route.provider,
            modelId: routeValidation.route.modelId,
            request,
            signal,
        });

        if (adapter.supports) {
            let support;
            try {
                support = await adapter.supports(execution);
            } catch (error) {
                if (error instanceof PurposeRouterError) {
                    throw error;
                }
                throw new PurposeRouterError('adapter_support_check_failed', '어댑터 지원 여부를 확인하지 못했습니다.', {
                    cause: error,
                    details: { adapterId: adapter.id, purpose: purposeValidation.id },
                });
            }

            const supported = typeof support === 'object' ? support?.ok === true : support === true;
            if (!supported) {
                const message = typeof support === 'object' && support?.message
                    ? String(support.message)
                    : `어댑터 '${adapter.id}'가 이 모델 경로를 지원하지 않습니다.`;
                throw new PurposeRouterError('adapter_unsupported', message, {
                    details: {
                        adapterId: adapter.id,
                        purpose: purposeValidation.id,
                        reasonCode: typeof support === 'object' ? support?.code ?? null : null,
                    },
                });
            }
        }

        throwIfAborted(signal);
        try {
            return await adapter.execute(execution);
        } catch (error) {
            if (error instanceof PurposeRouterError || signal?.aborted || error?.name === 'AbortError') {
                throw error;
            }
            throw new PurposeRouterError('adapter_execution_failed', '어댑터 요청 실행에 실패했습니다.', {
                cause: error,
                details: { adapterId: adapter.id, purpose: purposeValidation.id },
            });
        }
    }

    #commitRoutes(next, eventType, purpose) {
        const snapshot = cloneRoutes(next);
        if (this.#onRoutesChanged) {
            this.#onRoutesChanged(cloneRoutes(snapshot));
        }
        this.#routes = snapshot;
        this.#emit({ type: eventType, purpose });
    }

    #emit(event) {
        const frozenEvent = Object.freeze({ ...event });
        for (const listener of [...this.#listeners]) {
            try {
                listener(frozenEvent);
            } catch (error) {
                console.error('[Custom Model Router] 용도별 라우터 이벤트 처리 실패', error);
            }
        }
    }

    destroy() {
        if (!this.#active) {
            return false;
        }
        this.#active = false;
        this.#adapters.clear();
        this.#listeners.clear();
        this.#onRoutesChanged = null;
        return true;
    }

    #assertActive() {
        if (!this.#active) {
            throw new PurposeRouterError('router_destroyed', '종료된 용도별 라우터 인스턴스입니다.');
        }
    }
}

function parseRoutingApiVersion(value) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ''));
    return match ? match.slice(1).map(Number) : null;
}

export function isPurposeRoutingApiCompatible(requiredVersion, actualVersion = PURPOSE_ROUTING_API_VERSION) {
    const required = parseRoutingApiVersion(requiredVersion);
    const actual = parseRoutingApiVersion(actualVersion);
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

/**
 * 다른 SillyTavern 확장이 전역 Registry API를 통해 opt-in할 때 노출할 최소 facade다.
 * 내부 라우터 인스턴스나 변경 가능한 저장 객체는 노출하지 않는다.
 */
export function createPurposeRoutingApi(router) {
    if (!(router instanceof PurposeRouter)) {
        throw new PurposeRouterError('router_invalid', 'PurposeRouter 인스턴스가 필요합니다.');
    }

    const capabilities = deepFreeze({
        directModelRoutes: true,
        routeIdentity: 'provider-model',
        explicitAdapters: true,
        abortSignal: true,
        silentFallback: false,
        routerMutatesMainChatModel: false,
        builtInPurposes: [...BUILTIN_PURPOSES],
    });

    return Object.freeze({
        apiVersion: PURPOSE_ROUTING_API_VERSION,
        capabilities,
        isCompatible(requiredVersion) {
            return isPurposeRoutingApiCompatible(requiredVersion);
        },
        getRoutes() {
            return deepFreeze(router.getRoutesSnapshot());
        },
        getRoute(purpose) {
            const route = router.getRoute(purpose);
            return route ? deepFreeze(route) : null;
        },
        setRoute(purpose, route) {
            return deepFreeze(router.setRoute(purpose, route));
        },
        removeRoute(purpose) {
            return router.removeRoute(purpose);
        },
        listAdapters() {
            return deepFreeze(router.listAdapters());
        },
        registerAdapter(adapter) {
            return router.registerAdapter(adapter);
        },
        unregisterAdapter(adapterId) {
            return router.unregisterAdapter(adapterId);
        },
        execute(purpose, request, options) {
            return router.execute(purpose, request, options);
        },
        subscribe(listener) {
            return router.subscribe(listener);
        },
    });
}
