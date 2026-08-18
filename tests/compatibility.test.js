import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MINIMUM_SILLYTAVERN_VERSION,
    VALIDATED_SILLYTAVERN_VERSIONS,
    compareVersions,
    createStabilityMonitor,
    diagnoseCompatibility,
    diagnoseRuntimeResources,
    getMostSevereCheck,
    normalizeSillyTavernVersion,
} from '../src/compatibility.js';
import { getProviders } from '../src/providers.js';

function createContext(overrides = {}) {
    const eventTypes = {
        APP_INITIALIZED: 'app_initialized',
        SETTINGS_UPDATED: 'settings_updated',
        CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed',
        CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed',
        MAIN_API_CHANGED: 'main_api_changed',
        OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
        CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
    };
    return {
        extensionSettings: {},
        saveSettingsDebounced() {},
        eventSource: {
            on() {},
            removeListener() {},
        },
        eventTypes,
        chatCompletionSettings: {
            chat_completion_source: 'vertexai',
            vertexai_model: 'gemini-test',
        },
        Popup: class {},
        POPUP_TYPE: { TEXT: 1 },
        ChatCompletionService: { processRequest() {} },
        ConnectionManagerRequestService: {
            getProfile() {},
            validateProfile() {},
            sendRequest() {},
        },
        CONNECT_API_MAP: {},
        ...overrides,
    };
}

function createDocument(options = {}) {
    const controls = new Map(getProviders().map(provider => [provider.selector, {
        tagName: provider.controlType === 'select' ? 'SELECT' : 'INPUT',
    }]));
    for (const selector of options.missingSelectors ?? []) {
        controls.delete(selector);
    }
    for (const [selector, tagName] of Object.entries(options.wrongTags ?? {})) {
        controls.set(selector, { tagName });
    }

    const lists = new Map([
        ['#cmr_open_manager', Array.from({ length: options.launcherCount ?? 1 }, () => ({}))],
        ['#cmr_manager_dialog', Array.from({ length: options.panelCount ?? 0 }, () => ({}))],
        ['optgroup[data-cmr-provider]', options.modelGroups ?? []],
    ]);
    return {
        querySelector(selector) {
            if (selector === '#version_display') {
                return options.versionText ? { textContent: options.versionText } : null;
            }
            return controls.get(selector) ?? lists.get(selector)?.[0] ?? null;
        },
        querySelectorAll(selector) {
            if (lists.has(selector)) {
                return lists.get(selector);
            }
            const control = controls.get(selector);
            return control ? [control] : [];
        },
    };
}

test('SillyTavern 버전 표기를 정규화하고 의미 버전 순서를 비교한다', () => {
    assert.equal(MINIMUM_SILLYTAVERN_VERSION, '1.18.0');
    assert.deepEqual(VALIDATED_SILLYTAVERN_VERSIONS, ['1.18.0']);
    assert.equal(normalizeSillyTavernVersion('SillyTavern:1.18.0:Cohee#1207'), '1.18.0');
    assert.equal(normalizeSillyTavernVersion('SillyTavern v2.0.3'), '2.0.3');
    assert.equal(normalizeSillyTavernVersion('unknown'), null);
    assert.equal(compareVersions('1.17.9', '1.18.0'), -1);
    assert.equal(compareVersions('1.18.0', '1.18.0'), 0);
    assert.equal(compareVersions('1.18.1', '1.18.0'), 1);
    assert.equal(compareVersions('unknown', '1.18.0'), null);
});

test('SillyTavern 1.18 공개 context·DOM·요청 계약을 구조화된 한국어 결과로 통과시킨다', () => {
    const context = createContext({
        serviceAccount: '절대-노출하면-안-되는-값',
        apiKey: 'SUPER_SECRET',
    });
    const result = diagnoseCompatibility({
        context,
        clientVersion: 'SillyTavern 1.18.0',
        documentRef: createDocument(),
        MutationObserverClass: class {},
        runtimeState: {
            phase: 'active',
            observerCount: 1,
            listenerCount: 7,
            boundControlCount: 24,
            pendingTaskCount: 0,
        },
    });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.status, 'ok');
    assert.match(result.summary, /모두 통과/);
    assert.equal(result.environment.sillyTavernVersion, '1.18.0');
    assert.ok(result.checks.every(check => check.status === 'passed'));
    assert.doesNotMatch(JSON.stringify(result), /SUPER_SECRET|절대-노출/);
});

test('낮은 버전과 현재 제공업체 계약 변경은 오류, 미래 버전은 주의로 구분한다', () => {
    const oldResult = diagnoseCompatibility({
        context: createContext(),
        clientVersion: '1.17.9',
        documentRef: createDocument({ missingSelectors: ['#model_vertexai_select'] }),
        MutationObserverClass: class {},
    });
    assert.equal(oldResult.status, 'error');
    assert.ok(oldResult.checks.some(check => check.id === 'st-version-too-old' && check.status === 'failed'));
    assert.ok(oldResult.checks.some(check => check.id === 'active-provider-contract' && check.status === 'failed'));

    const futureResult = diagnoseCompatibility({
        context: createContext(),
        clientVersion: '1.19.0',
        documentRef: createDocument(),
        MutationObserverClass: class {},
    });
    assert.equal(futureResult.status, 'warning');
    assert.ok(futureResult.checks.some(check => check.id === 'st-version-unverified'));
});

test('필수 context와 보조 요청 계약 누락을 오류와 주의로 나눠 보고한다', () => {
    const context = createContext({
        saveSettingsDebounced: null,
        eventTypes: null,
        ChatCompletionService: null,
        ConnectionManagerRequestService: null,
        CONNECT_API_MAP: null,
    });
    const result = diagnoseCompatibility({
        context,
        clientVersion: '1.18.0',
        documentRef: createDocument(),
        MutationObserverClass: undefined,
    });

    assert.equal(result.status, 'error');
    assert.ok(result.checks.some(check => (
        check.id === 'context-required-capabilities'
        && check.status === 'failed'
        && check.message.includes('설정 저장 함수')
        && check.message.includes('이벤트 유형')
    )));
    assert.ok(result.checks.some(check => (
        check.id === 'context-request-contract'
        && check.status === 'warning'
        && check.details.missing.length === 5
    )));
});

test('런처·옵저버·동일 핸들러·모델 그룹 중복과 비활성화 잔여 자원을 찾는다', () => {
    const handler = () => {};
    const documentRef = createDocument({
        launcherCount: 2,
        modelGroups: [
            { dataset: { cmrProvider: 'vertexai' } },
            { dataset: { cmrProvider: 'vertexai' } },
        ],
    });
    const activeChecks = diagnoseRuntimeResources({
        phase: 'active',
        observerCount: 2,
        subscriptions: [
            { eventName: 'settings_updated', handler },
            { eventName: 'settings_updated', handler },
        ],
        controlBindings: [
            { providerId: 'vertexai' },
            { providerId: 'vertexai' },
        ],
    }, documentRef);
    const duplicate = activeChecks.find(check => check.id === 'runtime-duplicate-resources');
    assert.equal(duplicate.status, 'failed');
    assert.equal(duplicate.details.duplicateListeners[0].eventName, 'settings_updated');
    assert.deepEqual(duplicate.details.duplicateBindings, [{ key: 'vertexai', count: 2 }]);
    assert.deepEqual(duplicate.details.duplicateModelGroups, [{ key: 'vertexai', count: 2 }]);

    const destroyedChecks = diagnoseRuntimeResources({
        phase: 'destroyed',
        observerCount: 1,
        listenerCount: 2,
    }, createDocument({ launcherCount: 0 }));
    assert.equal(
        destroyedChecks.find(check => check.id === 'runtime-destroy-cleanup').status,
        'failed',
    );
    assert.equal(getMostSevereCheck(destroyedChecks).status, 'failed');
});

test('100회 동일 자원 표본과 표본 수 제한을 안정 상태로 판정한다', () => {
    const stable = createStabilityMonitor({ sampleLimit: 128 });
    for (let index = 0; index < 100; index += 1) {
        stable.record('프로필 전환', {
            launcherCount: 1,
            panelCount: 0,
            observerCount: 1,
            listenerCount: 7,
            boundControlCount: 24,
            modelGroupCount: 24,
            pendingTaskCount: 0,
        });
    }
    assert.equal(stable.size, 100);
    assert.equal(stable.getSamples()[0].sequence, 1);
    assert.equal(stable.analyze().status, 'ok');

    const capped = createStabilityMonitor({ sampleLimit: 4 });
    for (let index = 0; index < 8; index += 1) {
        capped.record('프로필 전환', { launcherCount: 1, observerCount: 1, listenerCount: 7 });
    }
    assert.equal(capped.size, 4);
    assert.equal(capped.getSamples()[0].sequence, 5);
});

test('정상 패널 열림·닫힘과 초기 자원 구성 및 일시 작업을 누수로 오진하지 않는다', () => {
    const monitor = createStabilityMonitor();
    monitor.record('초기화 시작', {
        launcherCount: 0,
        panelCount: 0,
        observerCount: 0,
        listenerCount: 0,
        boundControlCount: 0,
        modelGroupCount: 0,
        pendingTaskCount: 0,
    });
    monitor.record('초기화 완료', {
        launcherCount: 1,
        panelCount: 0,
        observerCount: 1,
        listenerCount: 7,
        boundControlCount: 12,
        modelGroupCount: 12,
        pendingTaskCount: 3,
    });
    monitor.record('패널 열림', {
        launcherCount: 1,
        panelCount: 1,
        observerCount: 1,
        listenerCount: 7,
        boundControlCount: 24,
        modelGroupCount: 24,
        pendingTaskCount: 1,
    });
    monitor.record('패널 닫힘', {
        launcherCount: 1,
        panelCount: 0,
        observerCount: 1,
        listenerCount: 7,
        boundControlCount: 24,
        modelGroupCount: 24,
        pendingTaskCount: 0,
    });

    const report = monitor.analyze();
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.drift, []);
    assert.deepEqual(report.transient.pendingTaskCount, { maximum: 3, last: 0 });
});

test('실제 리스너·옵저버·바인딩·모델 그룹 누적은 오류로 판정한다', () => {
    const leaking = createStabilityMonitor();
    leaking.record('시작', {
        launcherCount: 1,
        observerCount: 1,
        listenerCount: 7,
        boundControlCount: 24,
        modelGroupCount: 24,
    });
    leaking.record('누적 1회', {
        launcherCount: 1,
        observerCount: 2,
        listenerCount: 8,
        boundControlCount: 25,
        modelGroupCount: 25,
    });
    leaking.record('누적 2회', {
        launcherCount: 1,
        observerCount: 3,
        listenerCount: 9,
        boundControlCount: 26,
        modelGroupCount: 26,
    });
    const report = leaking.analyze();
    assert.equal(report.status, 'error');
    assert.deepEqual(
        report.drift.map(item => item.metric),
        ['observerCount', 'listenerCount', 'boundControlCount', 'modelGroupCount'],
    );
    assert.ok(report.drift.every(item => item.growthStepCount === 2));

    leaking.clear();
    assert.equal(leaking.size, 0);
    assert.equal(leaking.analyze().status, 'warning');
});
