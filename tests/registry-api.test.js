import test from 'node:test';
import assert from 'node:assert/strict';

import {
    REGISTRY_API_GLOBAL_NAME,
    REGISTRY_API_VERSION,
    REGISTRY_EVENT_TYPES,
    RegistryApiError,
    createRegistryApi,
    installRegistryApi,
    isRegistryApiCompatible,
} from '../src/registry-api.js';
import { addModel, normalizeSettings, setSelectedModel } from '../src/registry.js';

function createHarness(initialSettings, options = {}) {
    let settings = normalizeSettings(initialSettings);
    const writes = [];
    const subscriberErrors = [];
    const controller = createRegistryApi({
        extensionVersion: '0.3.0',
        readSettings: () => settings,
        writeSettings: next => {
            writes.push(next);
            settings = normalizeSettings(next);
        },
        onSubscriberError: (error, event) => subscriberErrors.push([error, event]),
        ...options,
    });
    return {
        controller,
        api: controller.api,
        writes,
        subscriberErrors,
        get settings() {
            return settings;
        },
        set settings(next) {
            settings = normalizeSettings(next);
        },
    };
}

test('공개 계약 버전과 기능 메타데이터를 불변 객체로 제공한다', () => {
    const { api } = createHarness();

    assert.equal(api.name, REGISTRY_API_GLOBAL_NAME);
    assert.equal(api.apiVersion, REGISTRY_API_VERSION);
    assert.equal(api.extensionVersion, '0.3.0');
    assert.equal(api.capabilities.compoundModelKeys, true);
    assert.equal(api.capabilities.providerSelections, true);
    assert.equal(api.capabilities.selectionScope, 'registry');
    assert.equal(api.capabilities.purposeRouting, false);
    assert.equal(api.capabilities.providerIntegrations, false);
    assert.equal(api.routing, null);
    assert.equal(api.integrations, null);
    assert.equal(api.capabilities.immutableSnapshots, true);
    assert.deepEqual(api.capabilities.mutations, ['registerModel', 'unregisterModel', 'selectModel']);
    assert.deepEqual(api.capabilities.events, Object.values(REGISTRY_EVENT_TYPES));
    assert.equal(api.isCompatible('1.0.0'), true);
    assert.equal(api.isCompatible('2.0.0', '2.0.0'), false);
    assert.equal(Object.isFrozen(api), true);
    assert.equal(Object.isFrozen(api.capabilities), true);
    assert.equal(Object.isFrozen(api.events), true);
});

test('같은 major의 최소 API 버전만 호환된다고 판정한다', () => {
    assert.equal(isRegistryApiCompatible('1.0.0'), true);
    assert.equal(isRegistryApiCompatible('1.0.1'), true);
    assert.equal(isRegistryApiCompatible('1.1.1'), true);
    assert.equal(isRegistryApiCompatible('1.2.0'), true);
    assert.equal(isRegistryApiCompatible('1.2.1'), false);
    assert.equal(isRegistryApiCompatible('1.3.0'), false);
    assert.equal(isRegistryApiCompatible('0.9.9'), false);
    assert.equal(isRegistryApiCompatible('2.0.0'), false);
    assert.equal(isRegistryApiCompatible('1'), false);
});

test('provider integrations API를 추가 계약으로 그대로 노출하고 누락 시 null로 유지한다', () => {
    const integrationsApi = Object.freeze({
        apiVersion: '1.0.0',
        registerConsumer() {},
    });
    const { api } = createHarness(undefined, { integrationsApi });

    assert.equal(api.apiVersion, '1.2.0');
    assert.equal(api.capabilities.providerIntegrations, true);
    assert.equal(api.integrations, integrationsApi);
    assert.equal(Object.isFrozen(api.integrations), true);
    assert.throws(() => {
        api.integrations = null;
    });

    const withoutIntegrations = createHarness().api;
    assert.equal(withoutIntegrations.capabilities.providerIntegrations, false);
    assert.equal(withoutIntegrations.integrations, null);
});

test('제공업체와 모델 ID 복합키로 같은 ID를 서로 구분해 조회한다', () => {
    let settings = addModel(undefined, 'openai', 'shared-model');
    settings = addModel(settings, 'custom', 'shared-model');
    const { api } = createHarness(settings);

    assert.notEqual(
        api.createModelKey('openai', 'shared-model'),
        api.createModelKey('custom', 'shared-model'),
    );
    assert.equal(api.getModel('openai', 'shared-model').provider, 'openai');
    assert.equal(api.getModel('custom', 'shared-model').provider, 'custom');
    assert.equal(api.hasModel('OPENAI', ' shared-model '), true);
    assert.equal(api.getModel('xai', 'shared-model'), null);
    assert.equal(api.listModels('openai').length, 1);
    assert.equal(api.listModels('unknown').length, 0);
});

test('제공업체 목록에는 공개 계약에 필요한 메타데이터만 노출한다', () => {
    const { api } = createHarness();
    const providers = api.getProviders();
    const vertex = api.getProvider('VERTEXAI');

    assert.equal(providers.length, 24);
    assert.deepEqual(vertex, {
        id: 'vertexai',
        label: 'Google Vertex AI',
        kind: 'remote',
        protocol: 'vertex-gemini',
    });
    assert.equal('selector' in vertex, false);
    assert.equal('settingKey' in vertex, false);
    assert.equal(Object.isFrozen(providers), true);
    assert.equal(Object.isFrozen(vertex), true);
});

test('스냅샷과 반환 레코드를 깊게 동결하고 원본 설정과 분리한다', () => {
    let settings = addModel(undefined, 'openai', 'future-model');
    settings = setSelectedModel(settings, 'openai', 'future-model');
    const { api } = createHarness(settings);
    const snapshot = api.getSnapshot();

    assert.equal(snapshot.revision, 0);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.models), true);
    assert.equal(Object.isFrozen(snapshot.models[0]), true);
    assert.equal(Object.isFrozen(snapshot.selectedModels), true);
    assert.throws(() => snapshot.models.push({}));
    assert.throws(() => {
        snapshot.selectedModels.openai = 'tampered';
    });
    assert.equal(api.getSelectedModelId('openai'), 'future-model');
    assert.deepEqual(api.getSelectedModel('openai'), snapshot.models[0]);
});

test('등록·선택·삭제 mutation을 저장하고 구조화 이벤트를 순서대로 보낸다', () => {
    const harness = createHarness();
    const events = [];
    harness.api.subscribe(event => events.push(event));

    const registered = harness.api.registerModel('xai', 'grok-next');
    const selected = harness.api.selectModel('xai', 'grok-next');
    const removed = harness.api.unregisterModel('xai', 'grok-next');

    assert.equal(registered.key, '["xai","grok-next"]');
    assert.equal(selected.id, 'grok-next');
    assert.equal(removed, true);
    assert.equal(harness.api.unregisterModel('xai', 'missing'), false);
    assert.equal(harness.writes.length, 3);
    assert.deepEqual(events.map(event => event.type), [
        REGISTRY_EVENT_TYPES.MODEL_REGISTERED,
        REGISTRY_EVENT_TYPES.REGISTRY_CHANGED,
        REGISTRY_EVENT_TYPES.SELECTION_CHANGED,
        REGISTRY_EVENT_TYPES.REGISTRY_CHANGED,
        REGISTRY_EVENT_TYPES.MODEL_UNREGISTERED,
        REGISTRY_EVENT_TYPES.SELECTION_CHANGED,
        REGISTRY_EVENT_TYPES.REGISTRY_CHANGED,
    ]);
    assert.deepEqual(events.map(event => event.revision), [1, 1, 2, 2, 3, 3, 3]);
    assert.equal(events.every(event => event.source === 'api'), true);
    assert.equal(Object.isFrozen(events[0]), true);
    assert.equal(Object.isFrozen(events[0].detail), true);
    assert.equal(Object.isFrozen(events[0].snapshot), true);
});

test('이벤트 종류 구독과 해제를 지원하고 한 구독자 오류를 격리한다', () => {
    const harness = createHarness();
    const selections = [];
    const unsubscribe = harness.api.subscribe(
        REGISTRY_EVENT_TYPES.SELECTION_CHANGED,
        event => selections.push(event.detail.modelId),
    );
    harness.api.subscribe(REGISTRY_EVENT_TYPES.MODEL_REGISTERED, () => {
        throw new Error('subscriber failed');
    });

    harness.api.registerModel('openai', 'future-model');
    harness.api.selectModel('openai', 'future-model');
    assert.deepEqual(selections, ['future-model']);
    assert.equal(harness.subscriberErrors.length, 1);
    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false);
    harness.api.selectModel('openai', null);
    assert.deepEqual(selections, ['future-model']);
    assert.throws(
        () => harness.api.subscribe('unknown:event', () => {}),
        error => error instanceof RegistryApiError && error.code === 'unknown_event',
    );
});

test('기존 UI가 바꾼 설정도 synchronize로 동일한 변경 이벤트를 발행한다', () => {
    const harness = createHarness();
    const events = [];
    harness.api.subscribe(event => events.push(event));

    let external = addModel(harness.settings, 'zai', 'glm-next');
    external = setSelectedModel(external, 'zai', 'glm-next');
    harness.settings = external;

    assert.equal(harness.controller.synchronize('settings-ui'), 2);
    assert.equal(harness.controller.synchronize('settings-ui'), 0);
    assert.deepEqual(events.map(event => event.type), [
        REGISTRY_EVENT_TYPES.MODEL_REGISTERED,
        REGISTRY_EVENT_TYPES.SELECTION_CHANGED,
        REGISTRY_EVENT_TYPES.REGISTRY_CHANGED,
    ]);
    assert.equal(events.every(event => event.source === 'settings-ui'), true);
    assert.equal(events[2].detail.changes.length, 2);
});

test('저장 실패에는 성공 이벤트를 발행하지 않는다', () => {
    let settings = normalizeSettings();
    const controller = createRegistryApi({
        readSettings: () => settings,
        writeSettings: () => {},
    });
    const events = [];
    controller.api.subscribe(event => events.push(event));

    assert.throws(
        () => controller.api.registerModel('openai', 'future-model'),
        error => error instanceof RegistryApiError && error.code === 'write_not_applied',
    );
    assert.equal(events.length, 0);
    assert.equal(settings.models.length, 0);
});

test('writer가 synchronize를 호출해도 변경 이벤트를 중복 발행하지 않는다', () => {
    let settings = normalizeSettings();
    let controller;
    controller = createRegistryApi({
        readSettings: () => settings,
        writeSettings: next => {
            settings = normalizeSettings(next);
            controller.synchronize('writer');
        },
    });
    const events = [];
    controller.api.subscribe(event => events.push(event));

    controller.api.registerModel('openai', 'future-model');

    assert.deepEqual(events.map(event => event.type), [
        REGISTRY_EVENT_TYPES.MODEL_REGISTERED,
        REGISTRY_EVENT_TYPES.REGISTRY_CHANGED,
    ]);
    assert.deepEqual(events.map(event => event.revision), [1, 1]);
    assert.equal(events.every(event => event.source === 'writer'), true);
});

test('전역 설치는 이름 충돌을 덮지 않고 제거 시 자기 인스턴스만 지운다', () => {
    const first = createHarness().controller;
    const second = createHarness().controller;
    const target = {};
    const uninstall = installRegistryApi(target, first.api);

    assert.equal(target.CustomModelRouter, first.api);
    assert.equal(installRegistryApi(target, first.api)(), false);
    assert.throws(
        () => installRegistryApi(target, second.api),
        error => error instanceof RegistryApiError && error.code === 'global_conflict',
    );
    assert.equal(uninstall(), true);
    assert.equal('CustomModelRouter' in target, false);
    assert.equal(uninstall(), false);
});

test('destroy 이후 구독자와 API 접근을 종료하되 반복 destroy는 안전하다', () => {
    const controller = createHarness().controller;

    assert.equal(controller.destroy(), true);
    assert.equal(controller.destroy(), false);
    assert.throws(
        () => controller.api.getSnapshot(),
        error => error instanceof RegistryApiError && error.code === 'destroyed',
    );
});
