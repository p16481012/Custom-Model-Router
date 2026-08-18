import test from 'node:test';
import assert from 'node:assert/strict';

import { addModel, removeModel } from '../src/registry.js';
import {
    BUILTIN_PURPOSES,
    PURPOSE_ROUTING_API_VERSION,
    PURPOSE_ROUTES_SCHEMA_VERSION,
    PurposeRouter,
    PurposeRouterError,
    createPurposeRoutingApi,
    getPurposeRoute,
    isPurposeRoutingApiCompatible,
    normalizePurposeRoutes,
    removePurposeRoute,
    setPurposeRoute,
    validatePurposeId,
    validatePurposeRoute,
} from '../src/purpose-router.js';

const TEST_ADAPTER_ID = 'example.translation';

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function makeRoute(overrides = {}) {
    return {
        provider: 'openai',
        modelId: 'gpt-auxiliary',
        adapterId: TEST_ADAPTER_ID,
        connectionProfileId: 'profile-openai',
        ...overrides,
    };
}

function makeRegistry() {
    return addModel(undefined, 'openai', 'gpt-auxiliary');
}

test('기본 용도와 사용자 정의 네임스페이스를 허용하되 위험한 키는 거부한다', () => {
    assert.deepEqual(BUILTIN_PURPOSES, [
        'translation',
        'summary',
        'search',
        'captioning',
        'custom',
    ]);
    assert.equal(validatePurposeId(' Translation ').id, 'translation');
    assert.equal(validatePurposeId('custom.my-extension').ok, true);
    assert.equal(validatePurposeId('__proto__').code, 'purpose_invalid');
    assert.equal(validatePurposeId('custom/unsafe').code, 'purpose_invalid');
});

test('저장 경로는 provider+modelId를 직접 보존하고 별칭이나 알 수 없는 필드를 만들지 않는다', () => {
    const normalized = normalizePurposeRoutes({
        schemaVersion: 999,
        routes: {
            Translation: {
                ...makeRoute(),
                modelAlias: 'FAST',
                apiKey: 'secret-must-not-survive',
            },
            'bad/purpose': makeRoute(),
            summary: makeRoute({ provider: 'unknown' }),
        },
    });

    assert.deepEqual(normalized, {
        schemaVersion: PURPOSE_ROUTES_SCHEMA_VERSION,
        routes: {
            translation: makeRoute(),
        },
    });
    assert.equal(JSON.stringify(normalized).includes('FAST'), false);
    assert.equal(JSON.stringify(normalized).includes('secret-must-not-survive'), false);
});

test('Registry에 활성 모델로 등록된 경로만 새로 설정한다', () => {
    const registry = makeRegistry();
    const configured = setPurposeRoute(undefined, 'summary', makeRoute(), {
        registrySettings: registry,
    });
    assert.deepEqual(getPurposeRoute(configured, 'summary'), makeRoute());

    assert.throws(
        () => setPurposeRoute(configured, 'search', makeRoute({ modelId: 'gpt-not-registered' }), {
            registrySettings: registry,
        }),
        error => error instanceof PurposeRouterError && error.code === 'model_not_registered',
    );

    assert.equal(removePurposeRoute(configured, 'summary').routes.summary, undefined);
});

test('정규화는 사라진 모델 경로를 보존하고 실행 검증에서 명시적으로 중단한다', () => {
    const stored = {
        schemaVersion: 1,
        routes: { summary: makeRoute() },
    };
    const normalized = normalizePurposeRoutes(stored);
    assert.deepEqual(normalized, stored);
    assert.equal(validatePurposeRoute(makeRoute(), { registrySettings: undefined }).ok, true);
    assert.equal(validatePurposeRoute(makeRoute(), { registrySettings: {} }).code, 'model_not_registered');
});

test('어댑터 등록·해제와 이벤트를 제공하고 같은 ID 덮어쓰기를 막는다', () => {
    const router = new PurposeRouter();
    const events = [];
    const unsubscribe = router.subscribe(event => events.push(event.type));
    const adapter = { id: TEST_ADAPTER_ID, label: '번역', execute: async () => 'ok' };
    const dispose = router.registerAdapter(adapter);

    assert.deepEqual(router.listAdapters(), [{ id: TEST_ADAPTER_ID, label: '번역' }]);
    assert.throws(
        () => router.registerAdapter(adapter),
        error => error instanceof PurposeRouterError && error.code === 'adapter_duplicate',
    );
    assert.equal(dispose(), true);
    assert.equal(dispose(), false);
    assert.equal(unsubscribe(), true);
    assert.deepEqual(events, ['adapter-registered', 'adapter-unregistered']);
});

test('용도 실행은 정확한 경로와 AbortSignal만 어댑터에 넘기고 메인 설정을 바꾸지 않는다', async () => {
    const registry = makeRegistry();
    const mainSettings = {
        chat_completion_source: 'xai',
        xai_model: 'grok-main',
        openai_model: 'gpt-main',
    };
    const mainSettingsBefore = structuredClone(mainSettings);
    const calls = [];
    const controller = new AbortController();
    const router = new PurposeRouter({
        routes: { routes: { translation: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    router.registerAdapter({
        id: TEST_ADAPTER_ID,
        supports: execution => execution.provider === 'openai',
        execute: async execution => {
            calls.push(execution);
            return { content: '번역됨' };
        },
    });

    const request = Object.freeze({ prompt: 'hello', maxTokens: 64 });
    const result = await router.execute('translation', request, { signal: controller.signal });

    assert.deepEqual(result, { content: '번역됨' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, 'openai');
    assert.equal(calls[0].modelId, 'gpt-auxiliary');
    assert.equal(calls[0].route.modelId, 'gpt-auxiliary');
    assert.equal(calls[0].request, request);
    assert.notEqual(calls[0].signal, controller.signal);
    assert.equal(calls[0].signal.aborted, false);
    assert.equal(Object.isFrozen(calls[0].route), true);
    assert.deepEqual(mainSettings, mainSettingsBefore);
});

test('경로·모델·어댑터 문제가 있으면 다른 모델로 무음 대체하지 않는다', async () => {
    const registry = makeRegistry();
    const noRoute = new PurposeRouter({ getRegistrySettings: () => registry });
    let fallbackCalls = 0;
    noRoute.registerAdapter({
        id: 'fallback.adapter',
        execute: async () => { fallbackCalls += 1; },
    });
    await assert.rejects(
        noRoute.execute('summary', {}),
        error => error instanceof PurposeRouterError && error.code === 'route_not_configured',
    );

    const noAdapter = new PurposeRouter({
        routes: { routes: { summary: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    noAdapter.registerAdapter({
        id: 'fallback.adapter',
        execute: async () => { fallbackCalls += 1; },
    });
    await assert.rejects(
        noAdapter.execute('summary', {}),
        error => error instanceof PurposeRouterError && error.code === 'adapter_unavailable',
    );

    const removedRegistry = removeModel(registry, 'openai', 'gpt-auxiliary');
    const missingModel = new PurposeRouter({
        routes: { routes: { summary: makeRoute() } },
        getRegistrySettings: () => removedRegistry,
    });
    missingModel.registerAdapter({ id: TEST_ADAPTER_ID, execute: async () => 'must-not-run' });
    await assert.rejects(
        missingModel.execute('summary', {}),
        error => error instanceof PurposeRouterError && error.code === 'model_not_registered',
    );
    assert.equal(fallbackCalls, 0);
});

test('supports 거절 사유와 일반 실행 실패를 구분하고 라우터 오류는 보존한다', async () => {
    const registry = makeRegistry();
    const router = new PurposeRouter({
        routes: { routes: { search: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    const dispose = router.registerAdapter({
        id: TEST_ADAPTER_ID,
        supports: () => ({ ok: false, code: 'profile_mismatch', message: '프로필 불일치' }),
        execute: async () => 'must-not-run',
    });
    await assert.rejects(
        router.execute('search', {}),
        error => (
            error instanceof PurposeRouterError
            && error.code === 'adapter_unsupported'
            && error.details.reasonCode === 'profile_mismatch'
        ),
    );

    dispose();
    const cause = new Error('network down');
    router.registerAdapter({ id: TEST_ADAPTER_ID, execute: async () => { throw cause; } });
    await assert.rejects(
        router.execute('search', {}),
        error => (
            error instanceof PurposeRouterError
            && error.code === 'adapter_execution_failed'
            && error.cause === cause
        ),
    );
});

test('이미 취소된 signal은 어댑터를 호출하기 전에 같은 취소 사유로 중단한다', async () => {
    const registry = makeRegistry();
    const controller = new AbortController();
    const reason = new Error('사용자 취소');
    controller.abort(reason);
    let calls = 0;
    const router = new PurposeRouter({
        routes: { routes: { captioning: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    router.registerAdapter({
        id: TEST_ADAPTER_ID,
        execute: async () => { calls += 1; },
    });

    await assert.rejects(router.execute('captioning', {}, { signal: controller.signal }), error => error === reason);
    assert.equal(calls, 0);
    await assert.rejects(
        router.execute('captioning', {}, { signal: {} }),
        error => error instanceof PurposeRouterError && error.code === 'signal_invalid',
    );
});

test('호출자 signal 취소를 내부 실행 signal에 전달하고 늦은 성공값을 반환하지 않는다', async () => {
    const registry = makeRegistry();
    const controller = new AbortController();
    const adapterStarted = createDeferred();
    const adapterResult = createDeferred();
    const reason = new Error('호출자 취소');
    let executionSignal;
    const router = new PurposeRouter({
        routes: { routes: { translation: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    router.registerAdapter({
        id: TEST_ADAPTER_ID,
        execute: async execution => {
            executionSignal = execution.signal;
            adapterStarted.resolve();
            return adapterResult.promise;
        },
    });

    const pending = router.execute('translation', {}, { signal: controller.signal });
    await adapterStarted.promise;
    controller.abort(reason);
    assert.equal(executionSignal.aborted, true);
    assert.equal(executionSignal.reason, reason);
    adapterResult.resolve('취소 뒤 성공값');

    await assert.rejects(pending, error => error === reason);
});

test('supports 대기 중 destroy하면 실행 signal을 중단하고 execute로 진행하지 않는다', async () => {
    const registry = makeRegistry();
    const supportsStarted = createDeferred();
    const supportsResult = createDeferred();
    let executionSignal;
    let executeCalls = 0;
    const router = new PurposeRouter({
        routes: { routes: { summary: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    router.registerAdapter({
        id: TEST_ADAPTER_ID,
        supports: async execution => {
            executionSignal = execution.signal;
            supportsStarted.resolve();
            return supportsResult.promise;
        },
        execute: async () => {
            executeCalls += 1;
            return '실행되면 안 됨';
        },
    });

    const pending = router.execute('summary', {});
    await supportsStarted.promise;
    assert.equal(router.destroy(), true);
    assert.equal(executionSignal.aborted, true);
    assert.equal(executionSignal.reason.code, 'router_destroyed');
    supportsResult.resolve(true);

    await assert.rejects(
        pending,
        error => error instanceof PurposeRouterError && error.code === 'router_destroyed',
    );
    assert.equal(executeCalls, 0);
});

test('adapter 대기 중 destroy하면 나중에 완료된 성공값도 router_destroyed로 거부한다', async () => {
    const registry = makeRegistry();
    const adapterStarted = createDeferred();
    const adapterResult = createDeferred();
    let executionSignal;
    const router = new PurposeRouter({
        routes: { routes: { search: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    router.registerAdapter({
        id: TEST_ADAPTER_ID,
        execute: async execution => {
            executionSignal = execution.signal;
            adapterStarted.resolve();
            return adapterResult.promise;
        },
    });

    const pending = router.execute('search', {});
    await adapterStarted.promise;
    assert.equal(router.destroy(), true);
    assert.equal(executionSignal.aborted, true);
    adapterResult.resolve('종료 뒤 성공값');

    await assert.rejects(
        pending,
        error => error instanceof PurposeRouterError && error.code === 'router_destroyed',
    );
    assert.equal(router.destroy(), false);
});

test('경로 변경 콜백 실패 시 메모리 상태를 커밋하지 않는다', () => {
    const registry = makeRegistry();
    const router = new PurposeRouter({
        getRegistrySettings: () => registry,
        onRoutesChanged: () => { throw new Error('저장 실패'); },
    });

    assert.throws(() => router.setRoute('custom.test', makeRoute()), /저장 실패/);
    assert.equal(router.getRoute('custom.test'), null);
});

test('다른 확장용 routing facade는 계약과 스냅샷을 동결하고 opt-in 실행을 제공한다', async () => {
    const registry = makeRegistry();
    const router = new PurposeRouter({
        routes: { routes: { translation: makeRoute() } },
        getRegistrySettings: () => registry,
    });
    const routing = createPurposeRoutingApi(router);
    let calls = 0;
    const dispose = routing.registerAdapter({
        id: TEST_ADAPTER_ID,
        execute: async ({ provider, modelId }) => {
            calls += 1;
            return `${provider}:${modelId}`;
        },
    });

    assert.equal(routing.apiVersion, PURPOSE_ROUTING_API_VERSION);
    assert.equal(routing.isCompatible('1.0.0'), true);
    assert.equal(isPurposeRoutingApiCompatible('1.0.1'), false);
    assert.equal(isPurposeRoutingApiCompatible('2.0.0'), false);
    assert.equal(Object.isFrozen(routing), true);
    assert.equal(Object.isFrozen(routing.capabilities), true);
    assert.equal(routing.capabilities.routeIdentity, 'provider-model');
    assert.equal(routing.capabilities.silentFallback, false);
    assert.equal(routing.capabilities.routerMutatesMainChatModel, false);
    const snapshot = routing.getRoutes();
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.routes), true);
    assert.equal(Object.isFrozen(snapshot.routes.translation), true);
    assert.equal(await routing.execute('translation', {}), 'openai:gpt-auxiliary');
    assert.equal(calls, 1);
    assert.equal(dispose(), true);
});

test('destroy는 어댑터와 구독자를 정리하고 기존 공개 facade 접근을 차단한다', () => {
    const router = new PurposeRouter({ getRegistrySettings: () => makeRegistry() });
    const routing = createPurposeRoutingApi(router);
    const dispose = router.registerAdapter({ id: TEST_ADAPTER_ID, execute: async () => 'unused' });

    assert.equal(router.destroy(), true);
    assert.equal(router.destroy(), false);
    assert.equal(dispose(), false);
    assert.equal(dispose(), false);
    assert.throws(
        () => routing.getRoutes(),
        error => error instanceof PurposeRouterError && error.code === 'router_destroyed',
    );
    assert.throws(
        () => routing.listAdapters(),
        error => error instanceof PurposeRouterError && error.code === 'router_destroyed',
    );
});
