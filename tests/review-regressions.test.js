import test from 'node:test';
import assert from 'node:assert/strict';
import { addModel, createModelKey, normalizeSettings, setModelEnabled, setSelectedModel, REGISTRY_MODEL_LIMIT } from '../src/registry.js';
import { inspectPortableSettings, parsePortableSettings } from '../src/portable-settings.js';
import { createRegistryApi } from '../src/registry-api.js';
import { PurposeRouter } from '../src/purpose-router.js';
import { createSillyTavernConnectionProfileAdapter } from '../src/connection-profile-adapter.js';
import { createProviderIntegrationController, PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES } from '../src/provider-integrations.js';
import { mergeRegistryModels, snapshotSettingsBundle, findNativeRegisteredModels, removeNativeRegistrations } from '../src/settings-operations.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const registry = () => addModel(undefined, 'openai', 'model-test');
function registryHarness() {
    let state = normalizeSettings();
    const controller = createRegistryApi({ readSettings: () => state, writeSettings: next => { state = next; } });
    return { controller, get state() { return state; }, set state(value) { state = value; } };
}

test('falsy JSON 루트는 빈 백업으로 승인하지 않는다', () => {
    for (const input of ['null', 'false', '0', '""', '[]', 'true', '1']) {
        assert.equal(inspectPortableSettings(input).ok, false);
        assert.throws(() => parsePortableSettings(input), { code: 'backup_root_invalid' });
    }
});

test('Registry 재진입 이벤트는 batch 순서와 revision을 유지한다', () => {
    const { controller } = registryHarness();
    const events = [];
    controller.api.subscribe(event => {
        if (event.type === 'model:registered' && event.detail.model.id === 'first') controller.api.registerModel('openai', 'second');
    });
    controller.api.subscribe(event => events.push(event));
    controller.api.registerModel('openai', 'first');
    assert.deepEqual(controller.api.listModels().map(model => model.id), ['first', 'second']);
    assert.deepEqual(events.map(event => event.revision), [1, 1, 2, 2]);
    assert.ok(events.every(event => event.revision === event.snapshot.revision));
    controller.destroy();
});

test('미동기화 Registry 변경 알림의 재진입 등록도 덮어쓰지 않는다', () => {
    const harness = registryHarness();
    harness.state = addModel(harness.state, 'openai', 'external');
    harness.controller.api.subscribe(event => {
        if (event.type === 'model:registered' && event.detail.model.id === 'external') harness.controller.api.registerModel('openai', 'subscriber');
    });
    harness.controller.api.registerModel('openai', 'outer');
    assert.deepEqual(harness.controller.api.listModels().map(model => model.id).sort(), ['external', 'outer', 'subscriber']);
    harness.controller.destroy();
});

function streamHarness(factory) {
    let signal;
    const router = new PurposeRouter({ getRegistrySettings: registry });
    const adapter = createSillyTavernConnectionProfileAdapter(() => ({
        extensionSettings: { disabledExtensions: [] },
        ConnectionManagerRequestService: {
            getProfile: () => ({ id: 'test-profile' }),
            validateProfile: () => ({ selected: 'openai', source: 'openai' }),
            sendRequest: async (_profile, _prompt, _max, options) => { signal = options.signal; return factory; },
        },
    }));
    router.registerAdapter(adapter);
    router.setRoute('summary', { provider: 'openai', modelId: 'model-test', adapterId: adapter.id, connectionProfileId: 'test-profile' });
    return { router, get signal() { return signal; } };
}

test('Connection Profile 스트림 factory를 받은 뒤에도 caller abort가 전달된다', async () => {
    const harness = streamHarness(async function* () { yield 'late'; });
    const caller = new AbortController();
    const factory = await harness.router.execute('summary', { prompt: 'test', stream: true, maxTokens: 10 }, { signal: caller.signal });
    caller.abort();
    assert.equal(harness.signal.aborted, true);
    assert.throws(() => factory(), { name: 'AbortError' });
    harness.router.destroy();
});

test('Routing 종료는 진행 중인 next를 중단하고 iterator를 한 번 닫는다', async () => {
    const pending = deferred();
    let closed = 0;
    const harness = streamHarness(() => ({ next: () => pending.promise, return: () => { closed += 1; return { done: true }; } }));
    const factory = await harness.router.execute('summary', { prompt: 'test', stream: true, maxTokens: 10 });
    const iterator = factory();
    const next = iterator.next();
    const rejected = assert.rejects(next, { name: 'AbortError' });
    harness.router.destroy();
    await rejected;
    pending.resolve({ value: 'late', done: false });
    await tick();
    assert.equal(closed, 1);
    assert.equal(harness.signal.aborted, true);
});

test('정상 종료된 Routing 스트림은 caller abort 구독을 해제한다', async () => {
    const harness = streamHarness(async function* () { yield 'only'; });
    const caller = new AbortController();
    const factory = await harness.router.execute('summary', { prompt: 'test', stream: true, maxTokens: 10 }, { signal: caller.signal });
    const values = [];
    for await (const value of factory()) values.push(value);
    assert.deepEqual(values, ['only']);
    caller.abort();
    harness.router.destroy();
    assert.equal(harness.signal.aborted, false);
});

function integrationHarness(timeout = 30) {
    return createProviderIntegrationController({
        readRegistrySettings: registry,
        hookTimeoutMs: timeout,
        getContext: () => ({
            extensionSettings: { disabledExtensions: [], connectionManager: { selectedProfile: 'test-profile' } },
            ConnectionManagerRequestService: {
                getProfile: () => ({ id: 'test-profile' }),
                validateProfile: () => ({ selected: 'openai', source: 'openai' }),
                sendRequest: async () => ({ content: 'test' }),
            },
        }),
    });
}
const descriptor = consumerId => ({ consumerId, label: consumerId, contractVersion: '1.0.0',
    capabilities: PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES,
    slots: [{ slotId: 'chat', strategies: ['sillytavern-inherited'] }],
});
const handlerReceipt = dispose => ({ requestHandlerBound: true, handlerToken: 'token', dispose: dispose ?? (() => {}) });
const publicationReceipt = () => ({ modelsPublished: true, publicationToken: 'publication', updateModels: () => true, dispose() {} });

test('응답 없는 hook과 정상 consumer의 준비는 서로 격리되고 timeout 뒤 재시도된다', async () => {
    const controller = integrationHarness();
    const late = deferred();
    let closed = 0;
    let slow = true;
    const first = controller.api.registerConsumer(descriptor('slow'), {
        installHandler: () => slow ? late.promise : handlerReceipt(), publishModels: publicationReceipt,
    });
    const second = controller.api.registerConsumer(descriptor('healthy'), {
        installHandler: () => handlerReceipt(), publishModels: publicationReceipt,
    });
    assert.equal((await second.ready).bindings[0].status, 'ready');
    assert.equal((await first.ready).bindings[0].code, 'consumer_hook_timeout');
    late.resolve(handlerReceipt(() => { closed += 1; }));
    await tick();
    assert.equal(closed, 1);
    slow = false;
    await controller.api.refresh('slow');
    assert.equal(controller.getMetrics().readyCount, 2);
    await controller.destroy();
});

test('대기 중 consumer를 해제하면 ready가 끝나고 다른 consumer를 막지 않는다', async () => {
    const controller = integrationHarness(10_000);
    const registration = controller.api.registerConsumer(descriptor('slow'), {
        installHandler: () => new Promise(() => {}), publishModels: publicationReceipt,
    });
    await tick();
    registration.dispose();
    await registration.ready;
    assert.equal(controller.getMetrics().consumerCount, 0);
    await controller.destroy();
});

test('모델 게시 timeout은 handler와 늦게 반환된 publication을 한 번만 정리한다', async () => {
    const controller = integrationHarness();
    const late = deferred();
    let handlersClosed = 0;
    let publicationsClosed = 0;
    const registration = controller.api.registerConsumer(descriptor('publication-timeout'), {
        installHandler: () => handlerReceipt(() => { handlersClosed += 1; }),
        publishModels: () => late.promise,
    });
    assert.equal((await registration.ready).bindings[0].code, 'consumer_hook_timeout');
    assert.equal(handlersClosed, 1);
    late.resolve({ ...publicationReceipt(), dispose() { publicationsClosed += 1; } });
    await tick();
    await controller.destroy();
    assert.equal(handlersClosed, 1);
    assert.equal(publicationsClosed, 1);
});

test('모델 병합은 선택한 항목만 추가하고 충돌·연결 설정의 현재 값을 기본 보존한다', () => {
    const current = snapshotSettingsBundle({ registrySettings: registry() });
    let incoming = setModelEnabled(registry(), 'openai', 'model-test', false);
    incoming = addModel(incoming, 'claude', 'model-new');
    const imported = snapshotSettingsBundle({ registrySettings: incoming });
    const result = mergeRegistryModels(current, imported);
    assert.equal(result.registrySettings.models[0].enabled, true);
    assert.equal(result.registrySettings.models.length, 2);
    assert.deepEqual(result.purposeRoutes, current.purposeRoutes);
    assert.deepEqual(result.externalSettings, current.externalSettings);
    const chosen = new Set([createModelKey('openai', 'model-test')]);
    const conflict = mergeRegistryModels(current, imported, chosen);
    assert.equal(conflict.registrySettings.models.length, 1);
    assert.equal(conflict.registrySettings.models[0].enabled, false);
    assert.equal(current.registrySettings.models[0].enabled, true);
});

test('모델 활성 토글은 비활성 선택을 정리하고 재활성화 시 임의 선택하지 않는다', () => {
    const current = setSelectedModel(registry(), 'openai', 'model-test');
    const disabled = setModelEnabled(current, 'openai', 'model-test', false);
    assert.deepEqual(disabled.selectedModels, {});
    const enabled = setModelEnabled(disabled, 'openai', 'model-test', true);
    assert.equal(enabled.models[0].enabled, true);
    assert.deepEqual(enabled.selectedModels, {});
});

test('총 등록 한도는 백업 한도와 같고 병합도 부분 적용 없이 거부한다', () => {
    const full = { schemaVersion: 2, models: Array.from({ length: REGISTRY_MODEL_LIMIT }, (_, i) => ({ provider: 'openai', id: `model-${i}`, enabled: true })) };
    assert.throws(() => addModel(full, 'openai', 'one-more'), { code: 'too_many_models' });
    assert.throws(() => mergeRegistryModels({ registrySettings: full }, { registrySettings: registry() }), { code: 'too_many_models' });
});

test('기본 모델 중복 정리는 적용 시 native 여부를 다시 확인하고 원본 snapshot은 보존한다', () => {
    const current = snapshotSettingsBundle({ registrySettings: addModel(registry(), 'openai', 'native') });
    const native = (_provider, id) => id === 'native';
    assert.equal(findNativeRegisteredModels(current.registrySettings, native).length, 1);
    const keys = new Set([createModelKey('openai', 'native'), createModelKey('openai', 'model-test')]);
    assert.equal(removeNativeRegistrations(current, keys, () => false).registrySettings.models.length, 2);
    assert.deepEqual(removeNativeRegistrations(current, keys, native).registrySettings.models.map(model => model.id), ['model-test']);
    assert.equal(current.registrySettings.models.length, 2);
});
