import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXTERNAL_INJECTED_OPTION_LIMIT,
    EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD,
    EXTERNAL_MAPPING_DISABLED,
    EXTERNAL_MAPPING_MANUAL,
    EXTERNAL_TARGET_LIMIT,
    assessExternalTargetRisk,
    createExternalIntegrationController,
    createExternalTargetId,
    discoverExternalModelTargets,
    inferExternalProvider,
    isExternalModelControl,
    mutationNeedsExternalRescan,
    normalizeExternalMappings,
    removeExternalTargetModels,
    resolveExternalTargetProvider,
    syncExternalTarget,
    syncExternalTargetProviders,
    summarizeRiskBlockedTargets,
} from '../src/external-integrations.js';

function dataKey(name) {
    return name.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.attributes = {};
        this.listeners = new Map();
        this.id = '';
        this.name = '';
        this.className = '';
        this.textContent = '';
        this.placeholder = '';
        this.title = '';
        this.type = '';
        this.label = '';
        this.disabled = false;
        this.selected = false;
        this._value = '';
    }

    get value() {
        return this._value;
    }

    set value(value) {
        this._value = String(value ?? '');
    }

    get options() {
        if (!['SELECT', 'DATALIST', 'OPTGROUP'].includes(this.tagName)) {
            return undefined;
        }
        return this.children.flatMap(child => child.tagName === 'OPTGROUP' ? child.children : [child])
            .filter(child => child.tagName === 'OPTION');
    }

    get selectedOptions() {
        return (this.options ?? []).filter(option => option.selected || option.value === this.value);
    }

    append(...children) {
        for (const child of children) {
            child.remove();
            child.parentElement = this;
            this.children.push(child);
        }
    }

    prepend(...children) {
        for (const child of [...children].reverse()) {
            child.remove();
            child.parentElement = this;
            this.children.unshift(child);
        }
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }
    }

    setAttribute(name, value) {
        const stringValue = String(value);
        this.attributes[name] = stringValue;
        if (name === 'id' || name === 'name' || name === 'class' || name === 'type' || name === 'list') {
            this[name === 'class' ? 'className' : name] = stringValue;
        }
        if (name.startsWith('data-')) {
            this.dataset[dataKey(name)] = stringValue;
        }
    }

    getAttribute(name) {
        if (name.startsWith('data-')) {
            return this.dataset[dataKey(name)] ?? this.attributes[name] ?? null;
        }
        if (name === 'class') {
            return this.className || null;
        }
        if (['id', 'name', 'type', 'list'].includes(name)) {
            return this[name] || this.attributes[name] || null;
        }
        return this.attributes[name] ?? null;
    }

    hasAttribute(name) {
        if (name.startsWith('data-')) {
            return this.dataset[dataKey(name)] !== undefined || Object.hasOwn(this.attributes, name);
        }
        if (name === 'class') {
            return Boolean(this.className) || Object.hasOwn(this.attributes, name);
        }
        return Object.hasOwn(this.attributes, name);
    }

    removeAttribute(name) {
        delete this.attributes[name];
        if (name.startsWith('data-')) {
            delete this.dataset[dataKey(name)];
        }
        if (name === 'class') {
            this.className = '';
        } else if (['id', 'name', 'type', 'list'].includes(name)) {
            this[name] = '';
        }
    }

    addEventListener(name, handler) {
        const handlers = this.listeners.get(name) ?? [];
        handlers.push(handler);
        this.listeners.set(name, handlers);
    }

    removeEventListener(name, handler) {
        this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== handler));
    }

    dispatchEvent(event) {
        event.target ??= this;
        event.currentTarget = this;
        for (const handler of this.listeners.get(event.type) ?? []) {
            handler(event);
        }
        return true;
    }

    querySelectorAll(selector) {
        const selectors = selector.split(',').map(item => item.trim().toUpperCase());
        const result = [];
        const visit = element => {
            for (const child of element.children) {
                if (selectors.includes(child.tagName)) {
                    result.push(child);
                }
                visit(child);
            }
        };
        visit(this);
        return result;
    }
}

class FakeSelect extends FakeElement {
    constructor(ownerDocument) {
        super('select', ownerDocument);
    }

    get value() {
        return this.options.some(option => option.value === this._value) ? this._value : '';
    }

    set value(value) {
        this._value = String(value ?? '');
    }
}

class FakeDocument extends FakeElement {
    constructor() {
        super('#document', null);
        this.ownerDocument = this;
        this.nodeType = 9;
        this.documentElement = this;
        this.defaultView = { Event: class { constructor(type) { this.type = type; this.isTrusted = false; } } };
    }

    createElement(tagName) {
        return tagName.toLowerCase() === 'select'
            ? new FakeSelect(this)
            : new FakeElement(tagName, this);
    }

    getElementById(id) {
        return this.querySelectorAll('select,input,datalist,section,div,label,optgroup,option')
            .find(element => element.id === id) ?? null;
    }
}

function option(documentRef, value, attributes = {}) {
    const element = documentRef.createElement('option');
    element.value = value;
    element.textContent = value;
    for (const [name, attributeValue] of Object.entries(attributes)) {
        element.setAttribute(name, attributeValue);
    }
    return element;
}

function labeledModelSelect(documentRef, id, labelText = 'Model') {
    const wrapper = documentRef.createElement('div');
    const label = documentRef.createElement('label');
    const select = documentRef.createElement('select');
    select.id = id;
    label.setAttribute('for', id);
    label.textContent = labelText;
    wrapper.append(label, select);
    documentRef.append(wrapper);
    return select;
}

test('외부 모델 control을 찾되 CMR·SillyTavern core control은 제외한다', () => {
    const documentRef = new FakeDocument();
    const caption = labeledModelSelect(documentRef, 'caption_multimodal_model', 'Caption multimodal model');
    caption.setAttribute('data-provider', 'anthropic');
    const core = labeledModelSelect(documentRef, 'model_openai_select', 'Model');
    const ownPanel = documentRef.createElement('section');
    ownPanel.id = 'cmr_settings';
    const own = documentRef.createElement('select');
    own.id = 'third_party_model';
    ownPanel.append(own);
    documentRef.append(ownPanel);

    const targets = discoverExternalModelTargets(documentRef, { documentRef });

    assert.deepEqual(targets.map(target => target.control.id), ['caption_multimodal_model']);
    assert.equal(targets[0].inference.providerId, 'claude');
    assert.equal(targets[0].risk.level, 'none');
    assert.equal(core.children.length, 0);
});

test('embedding·이미지 생성·음성 모델은 위험 대상으로 분류하고 자동 연결하지 않는다', () => {
    const documentRef = new FakeDocument();
    const ids = ['vectors_openai_model', 'sd_generation_model', 'tts_voice_model'];
    const expectedReasons = ['embedding-model', 'image-generation-model', 'speech-model'];
    ids.forEach(id => {
        const control = labeledModelSelect(documentRef, id, `${id} model`);
        control.setAttribute('data-provider', 'openai');
    });
    const targets = discoverExternalModelTargets(documentRef, { documentRef });

    assert.deepEqual(targets.map(target => target.risk.excludedReason), expectedReasons);
    targets.forEach(target => {
        assert.equal(resolveExternalTargetProvider(target, {}).source, 'risk-blocked');
        assert.equal(resolveExternalTargetProvider(target, { [target.targetId]: 'openai' }).source, 'risk-blocked');
    });
    assert.equal(assessExternalTargetRisk(targets[0].control).level, 'blocked');
});

test('안전 제외 요약은 확장 이름과 제한된 개수만 제공하고 target 식별 정보는 노출하지 않는다', () => {
    const targets = [
        {
            extensionLabel: 'Vectors',
            targetId: 'cmr-ext-secret-1',
            label: 'SECRET_VECTOR_MODEL',
            control: { value: 'SECRET_CURRENT_VALUE' },
            resolution: { source: 'risk-blocked', excludedReason: 'embedding-model' },
        },
        {
            extensionLabel: ' vectors ',
            targetId: 'cmr-ext-secret-2',
            resolution: { source: 'risk-blocked', excludedReason: 'embedding-model' },
        },
        {
            extensionLabel: '__proto__',
            targetId: 'cmr-ext-secret-3',
            resolution: { source: 'risk-blocked', excludedReason: 'image-generation-model' },
        },
        {
            extensionLabel: 'Ignored Direct',
            targetId: 'cmr-ext-secret-4',
            resolution: { source: 'direct' },
        },
    ];

    const summary = summarizeRiskBlockedTargets(targets);
    assert.deepEqual(summary.find(item => item.extensionLabel === 'Vectors'), {
        extensionLabel: 'Vectors',
        count: 2,
    });
    assert.deepEqual(summary.find(item => item.extensionLabel === '__proto__'), {
        extensionLabel: '__proto__',
        count: 1,
    });
    assert.equal(summary.some(item => item.extensionLabel === 'Ignored Direct'), false);
    assert.equal(summary.every(item => Object.keys(item).sort().join(',') === 'count,extensionLabel'), true);
    assert.doesNotMatch(JSON.stringify(summary), /SECRET_|cmr-ext|embedding-model|image-generation-model/);

    const capped = summarizeRiskBlockedTargets(Array.from(
        { length: EXTERNAL_TARGET_LIMIT + 4 },
        () => ({ extensionLabel: 'Vectors', resolution: { source: 'risk-blocked' } }),
    ));
    assert.deepEqual(capped, [{ extensionLabel: 'Vectors', count: EXTERNAL_TARGET_LIMIT }]);
    assert.deepEqual(summarizeRiskBlockedTargets([
        ...Array.from({ length: EXTERNAL_TARGET_LIMIT }, () => ({ resolution: { source: 'direct' } })),
        { extensionLabel: 'Out of cap', resolution: { source: 'risk-blocked' } },
    ]), []);
});

test('명시 속성·연결 provider select·식별자와 option data-type에서 제공업체를 추론한다', () => {
    const documentRef = new FakeDocument();
    const explicit = labeledModelSelect(documentRef, 'external_model');
    explicit.setAttribute('data-model-provider', 'vertexai');
    assert.equal(inferExternalProvider(explicit).providerId, 'vertexai');

    const wrapper = documentRef.createElement('div');
    const provider = documentRef.createElement('select');
    provider.id = 'caption_provider';
    provider.setAttribute('aria-label', 'API provider');
    provider.append(option(documentRef, 'anthropic'));
    provider.value = 'anthropic';
    const model = documentRef.createElement('select');
    model.id = 'caption_model';
    model.setAttribute('data-provider-select', provider.id);
    model.append(option(documentRef, 'native', { 'data-type': 'anthropic' }));
    wrapper.append(provider, model);
    documentRef.append(wrapper);
    const connected = inferExternalProvider(model);
    assert.equal(connected.providerId, 'claude');
    assert.equal(connected.externalProviderValue, 'anthropic');
    assert.ok(connected.confidence >= 0.91);

    const glm = labeledModelSelect(documentRef, 'glm_llm_model');
    assert.equal(inferExternalProvider(glm).providerId, 'zai');
});

test('암시적 provider 탐색은 가장 가까운 확장 패널을 벗어나 이웃 control을 사용하지 않는다', () => {
    const documentRef = new FakeDocument();
    const commonRoot = documentRef.createElement('main');
    const captionPanel = documentRef.createElement('section');
    captionPanel.id = 'caption_container';
    const provider = documentRef.createElement('select');
    provider.id = 'caption_api_provider';
    provider.setAttribute('aria-label', 'API provider');
    provider.append(option(documentRef, 'openai'));
    provider.value = 'openai';
    const captionModel = documentRef.createElement('select');
    captionModel.id = 'caption_model';
    captionModel.setAttribute('aria-label', 'Caption model');
    captionPanel.append(provider, captionModel);

    const unrelatedPanel = documentRef.createElement('section');
    unrelatedPanel.id = 'summary_panel';
    const unrelatedModel = documentRef.createElement('select');
    unrelatedModel.id = 'summary_model';
    unrelatedModel.setAttribute('aria-label', 'Model');
    unrelatedPanel.append(unrelatedModel);
    commonRoot.append(captionPanel, unrelatedPanel);
    documentRef.append(commonRoot);

    assert.equal(inferExternalProvider(captionModel).providerId, 'openai');
    assert.equal(inferExternalProvider(unrelatedModel).providerId, null);
});

test('provider 전환 직후에는 과거 selected model의 data-type보다 현재 provider control을 우선한다', () => {
    const documentRef = new FakeDocument();
    const panel = documentRef.createElement('section');
    panel.id = 'caption_container';
    const provider = documentRef.createElement('select');
    provider.id = 'caption_multimodal_api';
    provider.setAttribute('aria-label', 'Caption API provider');
    const openaiOption = option(documentRef, 'openai');
    const anthropicOption = option(documentRef, 'anthropic');
    anthropicOption.selected = true;
    provider.append(openaiOption, anthropicOption);
    provider.value = 'anthropic';
    const model = documentRef.createElement('select');
    model.id = 'caption_multimodal_model';
    model.setAttribute('aria-label', 'Caption multimodal model');
    const staleModel = option(documentRef, 'gpt-native', { 'data-type': 'openai' });
    staleModel.selected = true;
    model.append(staleModel);
    panel.append(provider, model);
    documentRef.append(panel);

    const inference = inferExternalProvider(model);
    assert.equal(inference.providerId, 'claude');
    assert.equal(inference.source, 'connected-provider-select');
    assert.equal(inference.externalProviderValue, 'anthropic');
});

test('target ID는 동일한 extension 구조의 DOM 재생성 후에도 안정적이다', () => {
    const firstDocument = new FakeDocument();
    const firstContainer = firstDocument.createElement('section');
    firstContainer.setAttribute('data-extension-id', 'caption');
    const first = firstDocument.createElement('select');
    first.id = 'caption_multimodal_model';
    firstContainer.append(first);
    firstDocument.append(firstContainer);

    const secondDocument = new FakeDocument();
    const secondContainer = secondDocument.createElement('section');
    secondContainer.setAttribute('data-extension-id', 'caption');
    const second = secondDocument.createElement('select');
    second.id = 'caption_multimodal_model';
    secondContainer.append(second);
    secondDocument.append(secondContainer);

    assert.equal(createExternalTargetId(first), createExternalTargetId(second));
    assert.match(createExternalTargetId(first), /^cmr-ext-[a-f0-9]{8}$/);
});

test('동일 구조 target 충돌은 첫 ID를 유지하고 후속 input의 선택과 datalist를 안정적으로 분리한다', () => {
    function createDuplicateInputs() {
        const documentRef = new FakeDocument();
        const panel = documentRef.createElement('section');
        panel.setAttribute('data-extension-id', 'duplicate-model-fields');
        const first = documentRef.createElement('input');
        const second = documentRef.createElement('input');
        first.name = 'model';
        second.name = 'model';
        panel.append(first, second);
        documentRef.append(panel);
        return { documentRef, first, second };
    }

    const firstRuntime = createDuplicateInputs();
    const legacyTargetId = createExternalTargetId(firstRuntime.first, {
        documentRef: firstRuntime.documentRef,
    });
    assert.equal(
        legacyTargetId,
        createExternalTargetId(firstRuntime.second, { documentRef: firstRuntime.documentRef }),
    );
    const selections = [];
    const controller = createExternalIntegrationController({
        root: firstRuntime.documentRef,
        documentRef: firstRuntime.documentRef,
        getModels: providerId => providerId === 'openai'
            ? [
                { provider: 'openai', id: 'gpt-first' },
                { provider: 'openai', id: 'gpt-second' },
            ]
            : [],
        onSelectionChanged: selection => selections.push(selection),
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });

    const started = controller.start();
    assert.equal(started.length, 2);
    assert.equal(started[0].targetId, legacyTargetId);
    assert.notEqual(started[1].targetId, legacyTargetId);
    assert.match(started[1].targetId, /^cmr-ext-[a-f0-9]{8}$/);
    const firstListId = firstRuntime.first.getAttribute('list');
    const secondListId = firstRuntime.second.getAttribute('list');
    assert.notEqual(firstListId, secondListId);
    assert.equal(firstRuntime.documentRef.getElementById(firstListId), started[0].optionHost);
    assert.equal(firstRuntime.documentRef.getElementById(secondListId), started[1].optionHost);
    firstRuntime.first.value = 'gpt-first';
    firstRuntime.first.dispatchEvent({ type: 'input', isTrusted: true });
    firstRuntime.second.value = 'gpt-second';
    firstRuntime.second.dispatchEvent({ type: 'input', isTrusted: true });
    assert.deepEqual(selections.map(selection => [selection.targetId, selection.modelId]), [
        [started[0].targetId, 'gpt-first'],
        [started[1].targetId, 'gpt-second'],
    ]);

    const rescanned = controller.rescan();
    assert.deepEqual(
        rescanned.map(target => target.targetId),
        started.map(target => target.targetId),
    );
    assert.equal(firstRuntime.first.getAttribute('list'), firstListId);
    assert.equal(firstRuntime.second.getAttribute('list'), secondListId);

    firstRuntime.first.readOnly = true;
    const secondOnly = controller.rescan();
    assert.equal(secondOnly.length, 1);
    assert.equal(secondOnly[0].control, firstRuntime.second);
    assert.equal(secondOnly[0].targetId, started[1].targetId);
    firstRuntime.first.parentElement.append(firstRuntime.first);
    const secondOnlyAfterMove = controller.rescan();
    assert.equal(secondOnlyAfterMove.length, 1);
    assert.equal(secondOnlyAfterMove[0].targetId, started[1].targetId);
    firstRuntime.first.readOnly = false;
    const restoredAfterMove = controller.rescan();
    assert.equal(
        restoredAfterMove.find(target => target.control === firstRuntime.first).targetId,
        started[0].targetId,
    );
    assert.equal(
        restoredAfterMove.find(target => target.control === firstRuntime.second).targetId,
        started[1].targetId,
    );

    const originalTargetIdByControl = new Map(started.map(target => [target.control, target.targetId]));
    firstRuntime.first.parentElement.prepend(firstRuntime.first);
    const reordered = controller.rescan();
    assert.deepEqual(reordered.map(target => target.control), [firstRuntime.first, firstRuntime.second]);
    assert.equal(
        reordered.find(target => target.control === firstRuntime.first).targetId,
        originalTargetIdByControl.get(firstRuntime.first),
    );
    assert.equal(
        reordered.find(target => target.control === firstRuntime.second).targetId,
        originalTargetIdByControl.get(firstRuntime.second),
    );
    selections.length = 0;
    firstRuntime.second.value = 'gpt-first';
    firstRuntime.second.dispatchEvent({ type: 'input', isTrusted: true });
    firstRuntime.first.value = 'gpt-second';
    firstRuntime.first.dispatchEvent({ type: 'input', isTrusted: true });
    assert.deepEqual(selections.map(selection => [selection.targetId, selection.modelId]), [
        [originalTargetIdByControl.get(firstRuntime.second), 'gpt-first'],
        [originalTargetIdByControl.get(firstRuntime.first), 'gpt-second'],
    ]);

    firstRuntime.first.parentElement.append(firstRuntime.first);
    controller.rescan();
    controller.destroy();
    firstRuntime.first.value = '';
    firstRuntime.second.value = '';
    const inserted = firstRuntime.documentRef.createElement('input');
    inserted.name = 'model';
    firstRuntime.first.parentElement.prepend(inserted);
    const liveRecreatedController = createExternalIntegrationController({
        root: firstRuntime.documentRef,
        documentRef: firstRuntime.documentRef,
        getModels: providerId => providerId === 'openai'
            ? [
                { provider: 'openai', id: 'gpt-first' },
                { provider: 'openai', id: 'gpt-second' },
            ]
            : [],
        getPreferredModels: targetId => {
            if (targetId === originalTargetIdByControl.get(firstRuntime.first)) {
                return { openai: 'gpt-second' };
            }
            if (targetId === originalTargetIdByControl.get(firstRuntime.second)) {
                return { openai: 'gpt-first' };
            }
            return {};
        },
        observerFactory: () => ({ observe() {}, disconnect() {} }),
        eventFactory: type => ({ type, isTrusted: false }),
    });
    const liveRecreatedTargets = liveRecreatedController.start();
    assert.deepEqual(
        liveRecreatedTargets.map(target => target.control),
        [inserted, firstRuntime.second, firstRuntime.first],
    );
    assert.equal(
        liveRecreatedTargets.find(target => target.control === firstRuntime.first).targetId,
        originalTargetIdByControl.get(firstRuntime.first),
    );
    assert.equal(
        liveRecreatedTargets.find(target => target.control === firstRuntime.second).targetId,
        originalTargetIdByControl.get(firstRuntime.second),
    );
    assert.equal(firstRuntime.first.value, 'gpt-second');
    assert.equal(firstRuntime.second.value, 'gpt-first');
    assert.equal(inserted.value, '');
    assert.notEqual(
        liveRecreatedTargets.find(target => target.control === inserted).targetId,
        originalTargetIdByControl.get(firstRuntime.first),
    );
    assert.notEqual(
        liveRecreatedTargets.find(target => target.control === inserted).targetId,
        originalTargetIdByControl.get(firstRuntime.second),
    );

    const secondRuntime = createDuplicateInputs();
    const recreatedController = createExternalIntegrationController({
        root: secondRuntime.documentRef,
        documentRef: secondRuntime.documentRef,
        getModels: providerId => providerId === 'openai'
            ? [
                { provider: 'openai', id: 'gpt-first' },
                { provider: 'openai', id: 'gpt-second' },
            ]
            : [],
        getPreferredModels: targetId => targetId === started[0].targetId
            ? { openai: 'gpt-first' }
            : { openai: 'gpt-second' },
        observerFactory: () => ({ observe() {}, disconnect() {} }),
        eventFactory: type => ({ type, isTrusted: false }),
    });
    const recreatedTargets = recreatedController.start();
    assert.deepEqual(
        recreatedTargets.map(target => target.targetId),
        started.map(target => target.targetId),
    );
    assert.equal(secondRuntime.first.value, 'gpt-first');
    assert.equal(secondRuntime.second.value, 'gpt-second');

    liveRecreatedController.destroy();
    recreatedController.destroy();
    assert.equal(firstRuntime.first.getAttribute('list'), null);
    assert.equal(firstRuntime.second.getAttribute('list'), null);
    assert.equal(firstRuntime.documentRef.getElementById(firstListId), null);
    assert.equal(firstRuntime.documentRef.getElementById(secondListId), null);
});

test('legacy provider mapping은 제거되고 안전한 target은 모두 직접 연결된다', () => {
    const target = {
        targetId: 'cmr-ext-deadbeef',
        inference: { providerId: 'openai', confidence: 0.9, source: 'id-name-label' },
        risk: { level: 'none' },
    };
    const mappings = normalizeExternalMappings({
        'cmr-ext-deadbeef': ' CLAUDE ',
        'cmr-ext-12345678': EXTERNAL_MAPPING_DISABLED,
        unsafe: 'openai',
        'cmr-ext-aaaaaaaa': 'not-real',
    });
    assert.deepEqual(mappings, {});
    assert.deepEqual(resolveExternalTargetProvider(target, mappings), {
        providerId: null, confidence: 1, source: 'direct',
    });
});

test('select에 provider별 CMR option을 멱등 주입하며 기존 값·option·외부 data-type을 보존한다', () => {
    const documentRef = new FakeDocument();
    const select = labeledModelSelect(documentRef, 'caption_multimodal_model');
    select.append(
        option(documentRef, 'native-claude', { 'data-type': 'anthropic' }),
        option(documentRef, 'shared', { 'data-type': 'anthropic' }),
    );
    select.value = 'native-claude';
    const target = {
        control: select,
        optionHost: select,
        inference: { externalProviderValue: 'anthropic' },
    };
    const models = [
        { provider: 'claude', id: 'claude-next', enabled: true },
        { provider: 'claude', id: 'shared', enabled: true },
        { provider: 'openai', id: 'gpt-next', enabled: true },
    ];

    syncExternalTarget(target, 'claude', models, { documentRef });
    syncExternalTarget(target, 'claude', models, { documentRef });

    const managed = select.options.filter(item => item.dataset.cmrExternalModel === 'true');
    assert.deepEqual(managed.map(item => item.value), ['claude-next']);
    assert.equal(managed[0].getAttribute('data-type'), 'anthropic');
    assert.equal(select.value, 'native-claude');
    assert.equal(select.options.filter(item => item.value === 'shared').length, 1);
    assert.equal(removeExternalTargetModels(target), 1);
    assert.deepEqual(select.options.map(item => item.value), ['native-claude', 'shared']);
});

test('직접 연결 select는 제공업체별 optgroup과 multiplex alias를 유지한다', () => {
    const documentRef = new FakeDocument();
    const select = labeledModelSelect(documentRef, 'helper_model');
    select.append(
        option(documentRef, 'native-openai', { 'data-type': 'openai' }),
        option(documentRef, 'native-claude', { 'data-type': 'anthropic' }),
    );
    select.value = 'native-openai';
    const target = { control: select, optionHost: select, inference: {} };

    const result = syncExternalTargetProviders(target, [
        { providerId: 'openai', label: 'OpenAI', models: [{ provider: 'openai', id: 'shared-next' }] },
        { providerId: 'claude', label: 'Anthropic', models: [{ provider: 'claude', id: 'shared-next' }] },
    ], { documentRef });

    const groups = select.children.filter(child => child.tagName === 'OPTGROUP');
    assert.deepEqual(groups.map(group => group.label), [
        'OpenAI · 사용자 모델',
        'Anthropic · 사용자 모델',
    ]);
    const managed = select.options.filter(item => item.dataset.cmrExternalModel === 'true');
    assert.deepEqual(managed.map(item => [item.value, item.dataset.cmrProvider]), [
        ['shared-next', 'openai'],
        ['shared-next', 'claude'],
    ]);
    assert.deepEqual(managed.map(item => item.getAttribute('data-type')), ['openai', 'anthropic']);
    assert.equal(result.injectedModels.length, 2);
    assert.equal(select.value, 'native-openai');
});

test('직접 연결 input 제안은 실제 모델 ID와 제공업체가 보이는 label을 함께 보존한다', () => {
    const documentRef = new FakeDocument();
    const wrapper = documentRef.createElement('div');
    const input = documentRef.createElement('input');
    input.id = 'helper_model';
    input.value = 'typed-value';
    wrapper.append(input);
    documentRef.append(wrapper);
    const target = {
        targetId: createExternalTargetId(input, { documentRef }),
        control: input,
        optionHost: null,
        inference: {},
    };

    syncExternalTargetProviders(target, [
        { providerId: 'openai', label: 'OpenAI', models: [{ provider: 'openai', id: 'gpt-next' }] },
        { providerId: 'zai', label: 'Z.AI (GLM)', models: [{ provider: 'zai', id: 'glm-next' }] },
    ], { documentRef });

    assert.deepEqual(target.optionHost.options.map(item => [item.value, item.label]), [
        ['gpt-next', 'OpenAI · gpt-next'],
        ['glm-next', 'Z.AI (GLM) · glm-next'],
    ]);
    assert.equal(input.value, 'typed-value');
    removeExternalTargetModels(target, null, { removeOwnedHost: true });
    assert.equal(input.getAttribute('list'), null);

    const selections = [];
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => ['openai', 'claude'].includes(providerId)
            ? [{ provider: providerId, id: 'shared-model' }]
            : [],
        onSelectionChanged: selection => selections.push(selection),
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });
    controller.start();
    input.value = 'shared-model';
    input.dispatchEvent({ type: 'input', isTrusted: true });
    assert.deepEqual(selections.at(-1), {
        targetId: target.targetId,
        providerId: null,
        providerIds: ['openai', 'claude'],
        modelId: 'shared-model',
        mode: 'direct',
        userInitiated: true,
    });
    controller.destroy();
});

test('multiplex select의 native 중복은 provider와 model ID가 모두 같은 경우에만 제외한다', () => {
    const documentRef = new FakeDocument();
    const provider = documentRef.createElement('select');
    provider.id = 'caption_multimodal_api';
    provider.setAttribute('aria-label', 'API provider');
    provider.append(option(documentRef, 'anthropic'), option(documentRef, 'openai'), option(documentRef, 'custom'));
    provider.value = 'anthropic';
    const select = labeledModelSelect(documentRef, 'caption_multimodal_model', 'Caption multimodal model');
    select.setAttribute('data-provider-select', provider.id);
    select.append(option(documentRef, 'shared-model', { 'data-type': 'openai' }));
    select.parentElement.prepend(provider);
    const target = discoverExternalModelTargets(documentRef, { documentRef })
        .find(candidate => candidate.control === select);

    let result = syncExternalTarget(target, 'claude', [
        { provider: 'claude', id: 'shared-model' },
    ], { documentRef });
    assert.deepEqual(result.injectedIds, ['shared-model']);
    assert.equal(
        select.options.find(item => item.dataset.cmrExternalModel === 'true').getAttribute('data-type'),
        'anthropic',
    );

    select.append(option(documentRef, 'shared-model', { 'data-type': 'anthropic' }));
    result = syncExternalTarget(target, 'claude', [
        { provider: 'claude', id: 'shared-model' },
    ], { documentRef });
    assert.deepEqual(result.injectedIds, []);
    assert.equal(select.options.some(item => item.dataset.cmrExternalModel === 'true'), false);
});

test('비채팅 모델과 민감 설정은 제외하고 안전한 Chat Completion target만 직접 연결한다', () => {
    const documentRef = new FakeDocument();
    const risks = [
        ['openai_image_model', 'image-generation-model'],
        ['openai_transcription_model', 'speech-model'],
        ['openai_audio_model', 'audio-model'],
        ['openai_reranker_model', 'rerank-model'],
        ['openai_classifier_model', 'classifier-model'],
        ['openai_tokenizer_model', 'tokenizer-model'],
        ['openai_checkpoint_model', 'image-asset-model'],
        ['openai_vae_model', 'image-asset-model'],
        ['openai_lora_model', 'image-asset-model'],
    ];
    for (const [id] of risks) {
        labeledModelSelect(documentRef, id, id);
    }
    const targets = discoverExternalModelTargets(documentRef, { documentRef });
    for (const [id, reason] of risks) {
        const target = targets.find(candidate => candidate.control.id === id);
        assert.equal(target.inference.providerId, 'openai');
        assert.equal(target.risk.excludedReason, reason);
        assert.equal(resolveExternalTargetProvider(target, {}).source, 'risk-blocked');
    }

    for (const id of ['azure_openai_model', 'model_endpoint', 'model_api_key', 'account_project_model', 'region_model_url']) {
        const input = documentRef.createElement('input');
        input.id = id;
        assert.equal(isExternalModelControl(input, { documentRef }), false, id);
    }

    const caption = labeledModelSelect(documentRef, 'caption_multimodal_model', 'Caption image model');
    caption.setAttribute('data-provider', 'openai');
    const captionTarget = discoverExternalModelTargets(documentRef, { documentRef })
        .find(candidate => candidate.control === caption);
    assert.equal(captionTarget.risk.level, 'none');
    assert.equal(resolveExternalTargetProvider(captionTarget, {}).source, 'direct');

    caption.setAttribute('data-provider', 'custom');
    const customCaption = discoverExternalModelTargets(documentRef, { documentRef })
        .find(candidate => candidate.control === caption);
    assert.equal(customCaption.risk.excludedReason, 'caption-special-provider');
    caption.setAttribute('data-provider', 'ollama');
    const ollamaCaption = discoverExternalModelTargets(documentRef, { documentRef })
        .find(candidate => candidate.control === caption);
    assert.equal(ollamaCaption.inference.providerId, null);

    const captionCustomInput = documentRef.createElement('input');
    captionCustomInput.id = 'caption_custom_model';
    documentRef.append(captionCustomInput);
    const captionOllamaInput = documentRef.createElement('input');
    captionOllamaInput.id = 'caption_ollama_custom_model';
    documentRef.append(captionOllamaInput);
    const captionInputs = discoverExternalModelTargets(documentRef, { documentRef });
    const customInputTarget = captionInputs.find(candidate => candidate.control === captionCustomInput);
    const ollamaInputTarget = captionInputs.find(candidate => candidate.control === captionOllamaInput);
    assert.equal(resolveExternalTargetProvider(customInputTarget, {}).source, 'direct');
    assert.equal(ollamaInputTarget.inference.providerId, 'custom');
    assert.equal(ollamaInputTarget.risk.excludedReason, 'caption-ollama-model');
    assert.equal(resolveExternalTargetProvider(ollamaInputTarget, {}).source, 'risk-blocked');

    const azurePanel = documentRef.createElement('section');
    azurePanel.id = 'deployment_panel';
    const azureProvider = documentRef.createElement('select');
    azureProvider.id = 'deployment_provider';
    azureProvider.setAttribute('aria-label', 'API provider');
    azureProvider.append(option(documentRef, 'azure_openai'));
    azureProvider.value = 'azure_openai';
    const azureModel = documentRef.createElement('select');
    azureModel.id = 'generic_model';
    azureModel.setAttribute('data-provider-select', azureProvider.id);
    azurePanel.append(azureProvider, azureModel);
    documentRef.append(azurePanel);
    const azureTarget = discoverExternalModelTargets(documentRef, { documentRef })
        .find(candidate => candidate.control === azureModel);
    assert.equal(azureTarget.risk.excludedReason, 'azure-deployment');
    assert.equal(resolveExternalTargetProvider(azureTarget, {}).source, 'risk-blocked');
});

test('disabled·readonly·multiple control을 제외하고 target과 주입 option 수를 제한한다', () => {
    const documentRef = new FakeDocument();
    for (const [id, property] of [
        ['disabled_model', 'disabled'],
        ['readonly_model', 'readOnly'],
        ['multiple_model', 'multiple'],
    ]) {
        const control = documentRef.createElement(property === 'readOnly' ? 'input' : 'select');
        control.id = id;
        control[property] = true;
        documentRef.append(control);
        assert.equal(isExternalModelControl(control, { documentRef }), false);
    }
    const boundedControls = [];
    for (let index = 0; index < EXTERNAL_TARGET_LIMIT + 3; index += 1) {
        const control = documentRef.createElement('select');
        control.id = `bounded_model_${index}`;
        control.setAttribute('data-provider', 'openai');
        boundedControls.push(control);
    }
    const targetRoot = {
        ownerDocument: documentRef,
        querySelectorAll: () => boundedControls,
    };
    const targets = discoverExternalModelTargets(targetRoot, { documentRef });
    assert.equal(targets.length, EXTERNAL_TARGET_LIMIT);

    const target = targets[0];
    const models = Array.from({ length: EXTERNAL_INJECTED_OPTION_LIMIT + 3 }, (_, index) => ({
        provider: 'openai', id: `bounded-${index}`,
    }));
    const result = syncExternalTarget(target, 'openai', models, { documentRef });
    assert.equal(result.injectedIds.length, EXTERNAL_INJECTED_OPTION_LIMIT);

    const manualSelect = labeledModelSelect(documentRef, 'manual_bounded_model');
    const manualTarget = { control: manualSelect, optionHost: manualSelect, inference: {} };
    const manualResult = syncExternalTargetProviders(manualTarget, [
        {
            providerId: 'openai',
            label: 'OpenAI',
            models: Array.from({ length: 300 }, (_, index) => ({ provider: 'openai', id: `gpt-${index}` })),
        },
        {
            providerId: 'claude',
            label: 'Anthropic',
            models: Array.from({ length: 300 }, (_, index) => ({ provider: 'claude', id: `claude-${index}` })),
        },
    ], { documentRef });
    assert.equal(manualResult.injectedModels.length, EXTERNAL_INJECTED_OPTION_LIMIT);
    assert.equal(manualResult.eligibleModelCount, 600);
    assert.equal(manualResult.expectedManagedOptionCount, EXTERNAL_INJECTED_OPTION_LIMIT);
    assert.equal(manualResult.capacityLimited, true);
    assert.equal(manualSelect.options.filter(item => item.dataset.cmrExternalModel === 'true').length,
        EXTERNAL_INJECTED_OPTION_LIMIT);

    const nativeBudgetSelect = labeledModelSelect(documentRef, 'native_budget_model');
    nativeBudgetSelect.append(option(documentRef, 'gpt-0'));
    const nativeBudgetResult = syncExternalTargetProviders({
        control: nativeBudgetSelect,
        optionHost: nativeBudgetSelect,
        inference: {},
    }, [
        {
            providerId: 'openai',
            label: 'OpenAI',
            models: Array.from({ length: EXTERNAL_INJECTED_OPTION_LIMIT + 1 }, (_, index) => ({
                provider: 'openai', id: `gpt-${index}`,
            })),
        },
    ], { documentRef });
    assert.equal(nativeBudgetResult.eligibleModelCount, EXTERNAL_INJECTED_OPTION_LIMIT);
    assert.equal(nativeBudgetResult.capacityLimited, false);
    assert.equal(nativeBudgetResult.injectedModels.length, EXTERNAL_INJECTED_OPTION_LIMIT);
    assert.equal(nativeBudgetResult.injectedModels.at(-1).modelId, `gpt-${EXTERNAL_INJECTED_OPTION_LIMIT}`);
});

test('datalist 동기화와 cleanup은 외부 option 및 input 값을 변경하지 않는다', () => {
    const documentRef = new FakeDocument();
    const input = documentRef.createElement('input');
    input.id = 'helper_model';
    input.value = 'typed-by-user';
    const datalist = documentRef.createElement('datalist');
    datalist.id = 'helper_models';
    input.setAttribute('list', datalist.id);
    datalist.append(option(documentRef, 'native'));
    documentRef.append(input, datalist);
    const target = { control: input, optionHost: datalist, inference: {} };

    syncExternalTarget(target, 'openai', [{ provider: 'openai', id: 'gpt-next' }], { documentRef });
    assert.deepEqual(datalist.options.map(item => item.value), ['native', 'gpt-next']);
    assert.equal(input.value, 'typed-by-user');
    removeExternalTargetModels(target);
    assert.deepEqual(datalist.options.map(item => item.value), ['native']);
});

test('plain input에는 CMR 소유 datalist를 만들고 cleanup 시 원래 list 속성을 복원한다', () => {
    const documentRef = new FakeDocument();
    const wrapper = documentRef.createElement('div');
    const input = documentRef.createElement('input');
    input.id = 'translator_model';
    input.setAttribute('data-provider', 'openai');
    input.setAttribute('list', 'missing-original-list');
    input.value = 'typed-by-user';
    wrapper.append(input);
    documentRef.append(wrapper);
    const originalTargetId = createExternalTargetId(input, { documentRef });
    const target = {
        targetId: originalTargetId,
        control: input,
        optionHost: null,
        inference: { providerId: 'openai', externalProviderValue: 'openai' },
    };

    const result = syncExternalTarget(target, 'openai', [
        { provider: 'openai', id: 'gpt-next' },
    ], { documentRef });

    assert.deepEqual(result.injectedIds, ['gpt-next']);
    assert.ok(target.optionHost);
    assert.equal(target.optionHost.tagName, 'DATALIST');
    assert.equal(target.optionHost.getAttribute('data-cmr-external-datalist'), 'true');
    assert.equal(input.getAttribute('list'), target.optionHost.id);
    assert.equal(input.value, 'typed-by-user');
    assert.equal(createExternalTargetId(input, { documentRef }), originalTargetId);

    removeExternalTargetModels(target, null, { removeOwnedHost: true });
    assert.equal(input.getAttribute('list'), 'missing-original-list');
    assert.equal(target.optionHost, null);
    assert.equal(wrapper.children.some(child => child.tagName === 'DATALIST'), false);
});

test('기존 datalist는 native option과 list 연결을 보존하고 CMR option만 정리한다', () => {
    const documentRef = new FakeDocument();
    const wrapper = documentRef.createElement('div');
    const input = documentRef.createElement('input');
    input.id = 'summary_model';
    input.setAttribute('list', 'existing_models');
    const datalist = documentRef.createElement('datalist');
    datalist.id = 'existing_models';
    datalist.append(option(documentRef, 'native-model'));
    wrapper.append(input, datalist);
    documentRef.append(wrapper);
    const [target] = discoverExternalModelTargets(documentRef, { documentRef });

    syncExternalTarget(target, 'openai', [
        { provider: 'openai', id: 'gpt-next' },
    ], { documentRef });
    removeExternalTargetModels(target, null, { removeOwnedHost: true });

    assert.equal(input.getAttribute('list'), 'existing_models');
    assert.equal(datalist.parentElement, wrapper);
    assert.deepEqual(datalist.options.map(item => item.value), ['native-model']);
});

test('controller 재스캔은 plain input target ID를 유지하고 destroy 시 생성 list를 제거한다', () => {
    const documentRef = new FakeDocument();
    const wrapper = documentRef.createElement('div');
    const input = documentRef.createElement('input');
    input.id = 'plain_openai_model';
    input.setAttribute('data-provider', 'openai');
    wrapper.append(input);
    documentRef.append(wrapper);
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: () => [{ provider: 'openai', id: 'gpt-next' }],
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });

    const [started] = controller.start();
    const generatedListId = input.getAttribute('list');
    assert.ok(generatedListId.startsWith('cmr_external_models_'));
    assert.equal(documentRef.getElementById(generatedListId)?.tagName, 'DATALIST');

    const [rescanned] = controller.rescan();
    assert.equal(rescanned.targetId, started.targetId);
    assert.equal(input.getAttribute('list'), generatedListId);

    controller.destroy();
    assert.equal(input.getAttribute('list'), null);
    assert.equal(documentRef.getElementById(generatedListId), null);
});

test('plain input이 외부 datalist로 retarget되면 이전 CMR host를 정리하고 destroy 후 외부 list만 남긴다', () => {
    const documentRef = new FakeDocument();
    const wrapper = documentRef.createElement('div');
    const input = documentRef.createElement('input');
    input.id = 'retarget_openai_model';
    input.setAttribute('data-provider', 'openai');
    wrapper.append(input);
    documentRef.append(wrapper);
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: () => [{ provider: 'openai', id: 'gpt-next' }],
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });

    controller.start();
    const originalTargetId = controller.getTargets()[0].targetId;
    const ownedListId = input.getAttribute('list');
    const ownedList = documentRef.getElementById(ownedListId);
    assert.equal(ownedList.getAttribute('data-cmr-external-datalist'), 'true');

    const externalList = documentRef.createElement('datalist');
    externalList.id = 'extension_owned_models';
    externalList.append(option(documentRef, 'native-model'));
    wrapper.append(externalList);
    input.setAttribute('list', externalList.id);
    controller.rescan();

    assert.equal(ownedList.parentElement, null);
    assert.equal(documentRef.getElementById(ownedListId), null);
    assert.equal(input.getAttribute('list'), externalList.id);
    assert.equal(controller.getTargets()[0].targetId, originalTargetId);
    assert.deepEqual(externalList.options.map(item => item.value), ['native-model', 'gpt-next']);

    controller.destroy();
    assert.equal(input.getAttribute('list'), externalList.id);
    assert.equal(externalList.parentElement, wrapper);
    assert.deepEqual(externalList.options.map(item => item.value), ['native-model']);
});

test('CMR UI와 core CMR option mutation은 무시하고 실제 외부 target mutation만 재탐지한다', () => {
    const documentRef = new FakeDocument();
    const cmrPanel = documentRef.createElement('section');
    cmrPanel.id = 'cmr_settings';
    const cmrList = documentRef.createElement('ul');
    const cmrRow = documentRef.createElement('li');
    cmrPanel.append(cmrList);
    documentRef.append(cmrPanel);

    assert.equal(mutationNeedsExternalRescan([{
        type: 'childList',
        target: cmrList,
        addedNodes: [cmrRow],
        removedNodes: [],
    }]), false);

    const coreSelect = documentRef.createElement('select');
    coreSelect.id = 'model_openai_select';
    const coreGroup = documentRef.createElement('optgroup');
    coreGroup.dataset.cmrProvider = 'openai';
    const coreOption = option(documentRef, 'gpt-next');
    coreOption.dataset.cmrModel = 'true';
    coreOption.dataset.cmrProvider = 'openai';
    coreGroup.append(coreOption);
    coreSelect.append(coreGroup);
    documentRef.append(coreSelect);

    assert.equal(mutationNeedsExternalRescan([{
        type: 'childList',
        target: coreSelect,
        addedNodes: [coreGroup],
        removedNodes: [],
    }]), false);
    assert.equal(mutationNeedsExternalRescan([{
        type: 'childList',
        target: coreGroup,
        addedNodes: [coreOption],
        removedNodes: [],
    }]), false);

    const external = labeledModelSelect(documentRef, 'translator_model', 'OpenAI translation model');
    const nativeOption = option(documentRef, 'native-model');
    assert.equal(mutationNeedsExternalRescan([{
        type: 'childList',
        target: external,
        addedNodes: [nativeOption],
        removedNodes: [],
    }]), true);
});

test('무관한 메시지 mutation은 무시하고 외부 control 생성·삭제·option·추론 속성 변경만 재탐지한다', () => {
    const documentRef = new FakeDocument();
    const message = documentRef.createElement('div');
    message.className = 'mes_text';
    message.textContent = '일반 채팅 메시지';
    assert.equal(mutationNeedsExternalRescan([{
        type: 'childList', target: documentRef, addedNodes: [message], removedNodes: [],
    }], { root: documentRef, documentRef }), false);

    const unrelatedInput = documentRef.createElement('input');
    unrelatedInput.id = 'message_search';
    assert.equal(mutationNeedsExternalRescan([{
        type: 'childList', target: message, addedNodes: [unrelatedInput], removedNodes: [],
    }], { root: documentRef, documentRef }), false);

    const model = documentRef.createElement('select');
    model.id = 'translation_model';
    model.setAttribute('data-provider', 'openai');
    const createRecord = { type: 'childList', target: documentRef, addedNodes: [model], removedNodes: [] };
    const removeRecord = { type: 'childList', target: documentRef, addedNodes: [], removedNodes: [model] };
    assert.equal(mutationNeedsExternalRescan([createRecord], { root: documentRef, documentRef }), true);
    assert.equal(mutationNeedsExternalRescan([removeRecord], { root: documentRef, documentRef }), true);

    documentRef.append(model);
    const native = option(documentRef, 'native');
    assert.equal(mutationNeedsExternalRescan([{
        type: 'childList', target: model, addedNodes: [native], removedNodes: [],
    }], { root: documentRef, documentRef, knownControls: new Set([model]) }), true);
    assert.equal(mutationNeedsExternalRescan([{
        type: 'attributes', target: model, attributeName: 'data-provider', addedNodes: [], removedNodes: [],
    }], { root: documentRef, documentRef }), true);
});

test('controller observer는 관련 mutation을 한 frame으로 묶고 추론 관련 attribute를 모두 관찰한다', () => {
    const documentRef = new FakeDocument();
    const model = labeledModelSelect(documentRef, 'batched_model', 'OpenAI model');
    model.setAttribute('data-provider', 'openai');
    const scheduled = [];
    let observerCallback;
    let observerOptions;
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: () => [{ provider: 'openai', id: 'gpt-next' }],
        schedule: callback => scheduled.push(callback),
        observerFactory(callback) {
            observerCallback = callback;
            return { observe(_target, value) { observerOptions = value; }, disconnect() {} };
        },
    });
    controller.start();
    const record = { type: 'attributes', target: model, attributeName: 'data-provider', addedNodes: [], removedNodes: [] };
    observerCallback([record]);
    observerCallback([record]);
    observerCallback([record]);

    assert.equal(scheduled.length, 1);
    assert.equal(observerOptions.characterData, true);
    for (const attribute of [
        'disabled', 'readonly', 'multiple', 'aria-label', 'data-api-provider',
        'data-provider-select', 'data-source-select', 'data-extension-id',
    ]) {
        assert.ok(observerOptions.attributeFilter.includes(attribute), attribute);
    }
    scheduled.shift()();
    controller.destroy();
});

test('controller는 모든 안전 target을 직접 연결하고 재렌더·선호 선택·destroy를 정리한다', () => {
    const documentRef = new FakeDocument();
    const wrapper = documentRef.createElement('section');
    wrapper.setAttribute('data-extension-id', 'caption');
    const provider = documentRef.createElement('select');
    provider.id = 'caption_api_provider';
    provider.setAttribute('aria-label', 'API provider');
    provider.append(option(documentRef, 'anthropic'), option(documentRef, 'openai'), option(documentRef, 'custom'));
    provider.value = '';
    const model = documentRef.createElement('select');
    model.id = 'caption_multimodal_model';
    model.setAttribute('data-provider-select', provider.id);
    model.append(option(documentRef, 'native'));
    wrapper.append(provider, model);
    documentRef.append(wrapper);
    const targetId = createExternalTargetId(model);
    const scheduled = [];
    const selections = [];
    let observerCallback;
    let disconnected = false;
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => [{ provider: providerId, id: providerId === 'claude' ? 'claude-next' : 'gpt-next' }],
        getPreferredModels: id => id === targetId ? { claude: 'claude-next' } : {},
        onSelectionChanged: selection => selections.push(selection),
        observerFactory(callback) {
            observerCallback = callback;
            return { observe() {}, disconnect() { disconnected = true; } };
        },
        schedule: callback => scheduled.push(callback),
        eventFactory: type => ({ type, isTrusted: false }),
    });

    let targets = controller.start();
    assert.equal(targets[0].resolution.source, 'direct');
    assert.equal(model.options.some(item => item.dataset.cmrExternalModel === 'true'), true);
    assert.deepEqual(controller.getMetrics(), {
        observerCount: 1, targetCount: 1, boundCount: 1, directCount: 1,
        userExcludedCount: 0, activeRegistryModelCount: 24,
        eligibleManagedOptionCount: 24,
        expectedManagedOptionCount: 24, actualManagedOptionCount: 24,
        capacityLimitedTargetCount: 0,
        connectedCount: 1, idleCount: 0, failedCount: 0, listenerCount: 3,
    });

    model.value = '';
    provider.value = 'anthropic';
    provider.dispatchEvent({ type: 'change', isTrusted: true });
    assert.equal(scheduled.length, 1);
    scheduled.shift()();
    targets = controller.getTargets();
    assert.equal(targets[0].restoredModelId, 'claude-next');
    assert.equal(model.value, 'claude-next');
    assert.deepEqual(controller.getMetrics(), {
        observerCount: 1, targetCount: 1, boundCount: 1, directCount: 1,
        userExcludedCount: 0, activeRegistryModelCount: 24,
        eligibleManagedOptionCount: 24,
        expectedManagedOptionCount: 24, actualManagedOptionCount: 24,
        capacityLimitedTargetCount: 0,
        connectedCount: 1, idleCount: 0, failedCount: 0, listenerCount: 3,
    });

    model.value = 'native';
    model.dispatchEvent({ type: 'change', isTrusted: true });
    assert.equal(selections.at(-1).modelId, null);

    provider.value = 'custom';
    provider.dispatchEvent({ type: 'change', isTrusted: true });
    assert.equal(scheduled.length, 1);
    scheduled.shift()();
    assert.equal(controller.getTargets()[0].resolution.source, 'risk-blocked');
    assert.equal(model.options.some(item => item.dataset.cmrExternalModel === 'true'), false);

    provider.value = 'openai';
    provider.dispatchEvent({ type: 'change', isTrusted: true });
    assert.equal(scheduled.length, 1);
    scheduled.shift()();
    assert.equal(model.options.some(item => item.value === 'gpt-next'), true);

    observerCallback([{ type: 'childList', target: documentRef, addedNodes: [documentRef.createElement('div')], removedNodes: [] }]);
    assert.equal(scheduled.length, 0);
    const pendingModel = documentRef.createElement('select');
    pendingModel.id = 'pending_model';
    observerCallback([{ type: 'childList', target: documentRef, addedNodes: [pendingModel], removedNodes: [] }]);
    assert.equal(scheduled.length, 1);
    controller.destroy();
    scheduled.shift()();
    assert.equal(disconnected, true);
    assert.equal(model.options.some(item => item.dataset.cmrExternalModel === 'true'), false);
    assert.deepEqual(controller.getMetrics(), {
        observerCount: 0, targetCount: 0, boundCount: 0, directCount: 0,
        userExcludedCount: 0, activeRegistryModelCount: 0,
        eligibleManagedOptionCount: 0,
        expectedManagedOptionCount: 0, actualManagedOptionCount: 0,
        capacityLimitedTargetCount: 0,
        connectedCount: 0, idleCount: 0, failedCount: 0, listenerCount: 0,
    });
});

test('managed option 계측은 direct와 활성 Registry 모델만 예상하고 risk target과 native 중복을 제외한다', () => {
    const documentRef = new FakeDocument();
    const first = labeledModelSelect(documentRef, 'first_chat_model', 'First chat model');
    first.append(option(documentRef, 'gpt-a'));
    const second = labeledModelSelect(documentRef, 'second_chat_model', 'Second chat model');
    const vectorControls = [];
    for (let index = 0; index < 13; index += 1) {
        const vector = labeledModelSelect(
            documentRef,
            `vectors_${index}_model`,
            'Vectorization Model',
        );
        vector.parentElement.setAttribute('data-extension-name', 'Vectors');
        vectorControls.push(vector);
    }
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => providerId === 'openai'
            ? [
                { provider: 'openai', id: 'gpt-a' },
                { provider: 'openai', id: 'gpt-b' },
            ]
            : [],
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });

    controller.start();
    const metrics = controller.getMetrics();
    assert.equal(EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD, EXTERNAL_INJECTED_OPTION_LIMIT * 4);
    assert.equal(metrics.targetCount, 15);
    assert.equal(metrics.directCount, 2);
    assert.equal(metrics.activeRegistryModelCount, 2);
    assert.equal(metrics.eligibleManagedOptionCount, 3);
    assert.equal(metrics.expectedManagedOptionCount, 3);
    assert.equal(metrics.actualManagedOptionCount, 3);
    assert.equal(metrics.capacityLimitedTargetCount, 0);
    assert.deepEqual(controller.getRiskBlockedSummary(), [{ extensionLabel: 'Vectors', count: 13 }]);
    assert.equal(vectorControls.flatMap(control => control.options)
        .some(item => item.dataset.cmrExternalModel === 'true'), false);
    controller.destroy();
});

test('활성 Registry 모델 수는 risk-only와 user-excluded-only 화면에서도 독립적으로 계측한다', () => {
    const modelsByProvider = {
        openai: [
            { provider: 'openai', id: 'gpt-metric-a' },
            { provider: 'openai', id: 'gpt-metric-b' },
        ],
        claude: [{ provider: 'claude', id: 'claude-metric-a' }],
    };
    const createController = (documentRef, excludedTargetIds = []) => (
        createExternalIntegrationController({
            root: documentRef,
            documentRef,
            excludedTargetIds,
            getModels: providerId => modelsByProvider[providerId] ?? [],
            observerFactory: () => ({ observe() {}, disconnect() {} }),
        })
    );

    const riskDocument = new FakeDocument();
    labeledModelSelect(riskDocument, 'vectors_metric_model', 'Vectorization Model');
    const riskController = createController(riskDocument);
    riskController.start();
    assert.deepEqual(
        {
            activeRegistryModelCount: riskController.getMetrics().activeRegistryModelCount,
            directCount: riskController.getMetrics().directCount,
            eligibleManagedOptionCount: riskController.getMetrics().eligibleManagedOptionCount,
        },
        { activeRegistryModelCount: 3, directCount: 0, eligibleManagedOptionCount: 0 },
    );
    riskController.destroy();

    const excludedDocument = new FakeDocument();
    const excludedSelect = labeledModelSelect(
        excludedDocument,
        'excluded_metric_chat_model',
        'Excluded chat model',
    );
    const excludedTargetId = createExternalTargetId(excludedSelect, { documentRef: excludedDocument });
    const excludedController = createController(excludedDocument, [excludedTargetId]);
    excludedController.start();
    assert.deepEqual(
        {
            activeRegistryModelCount: excludedController.getMetrics().activeRegistryModelCount,
            directCount: excludedController.getMetrics().directCount,
            userExcludedCount: excludedController.getMetrics().userExcludedCount,
            expectedManagedOptionCount: excludedController.getMetrics().expectedManagedOptionCount,
        },
        {
            activeRegistryModelCount: 3,
            directCount: 0,
            userExcludedCount: 1,
            expectedManagedOptionCount: 0,
        },
    );
    excludedController.destroy();
});

test('여러 provider의 표시 후보가 cap을 넘어도 bridge는 512개를 유지하고 용량 제한을 계측한다', () => {
    const documentRef = new FakeDocument();
    labeledModelSelect(documentRef, 'large_registry_chat_model', 'Large registry chat model');
    const modelsByProvider = {
        openai: Array.from({ length: 300 }, (_, index) => ({
            provider: 'openai', id: `gpt-budget-${index}`,
        })),
        claude: Array.from({ length: 300 }, (_, index) => ({
            provider: 'claude', id: `claude-budget-${index}`,
        })),
    };
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => modelsByProvider[providerId] ?? [],
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });

    controller.start();
    const metrics = controller.getMetrics();
    assert.equal(metrics.activeRegistryModelCount, 600);
    assert.equal(metrics.eligibleManagedOptionCount, 600);
    assert.equal(metrics.expectedManagedOptionCount, EXTERNAL_INJECTED_OPTION_LIMIT);
    assert.equal(metrics.actualManagedOptionCount, EXTERNAL_INJECTED_OPTION_LIMIT);
    assert.equal(metrics.capacityLimitedTargetCount, 1);
    assert.equal(controller.getTargets()[0].bridge.status, 'connected');
    controller.destroy();
});

test('DOM에 남은 비활성 target은 native fallback을 알리고 분리된 target은 조용히 정리한다', () => {
    const documentRef = new FakeDocument();
    const panel = documentRef.createElement('section');
    panel.setAttribute('data-extension-id', 'lifecycle-targets');
    const disabledSelect = documentRef.createElement('select');
    disabledSelect.id = 'disabled_later_model';
    disabledSelect.append(option(documentRef, 'native-disabled'));
    disabledSelect.value = 'native-disabled';
    const detachedSelect = documentRef.createElement('select');
    detachedSelect.id = 'detached_later_model';
    detachedSelect.append(option(documentRef, 'native-detached'));
    detachedSelect.value = 'native-detached';
    panel.append(disabledSelect, detachedSelect);
    documentRef.append(panel);

    const disabledEvents = [];
    const detachedEvents = [];
    const invalidations = [];
    disabledSelect.addEventListener('change', event => {
        if (event.isTrusted === false) {
            disabledEvents.push(disabledSelect.value);
        }
    });
    detachedSelect.addEventListener('change', event => {
        if (event.isTrusted === false) {
            detachedEvents.push(detachedSelect.value);
        }
    });
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => providerId === 'openai'
            ? [{ provider: 'openai', id: 'gpt-next' }]
            : [],
        onSelectionInvalidated: invalidation => invalidations.push(invalidation),
        observerFactory: () => ({ observe() {}, disconnect() {} }),
        eventFactory: type => ({ type, isTrusted: false }),
    });
    controller.start();

    for (const select of [disabledSelect, detachedSelect]) {
        const managed = select.options.find(item => item.dataset.cmrExternalModel === 'true');
        assert.ok(managed);
        for (const optionItem of select.options) {
            optionItem.selected = optionItem === managed;
        }
        select.value = 'gpt-next';
    }
    disabledSelect.disabled = true;
    detachedSelect.remove();

    assert.deepEqual(controller.rescan(), []);
    assert.equal(disabledSelect.value, 'native-disabled');
    assert.deepEqual(disabledEvents, ['native-disabled']);
    assert.deepEqual(detachedEvents, []);
    assert.equal(disabledSelect.options.some(item => item.dataset.cmrExternalModel === 'true'), false);
    assert.equal(detachedSelect.options.some(item => item.dataset.cmrExternalModel === 'true'), false);
    assert.equal(invalidations.length, 1);
    assert.equal(invalidations[0].reason, 'target-unavailable');

    controller.destroy();
});

test('직접 연결 controller는 중복 모델 ID도 실제 selected option metadata로 제공업체를 구분한다', () => {
    const documentRef = new FakeDocument();
    const select = labeledModelSelect(documentRef, 'unknown_chat_model', 'Chat model');
    select.setAttribute('data-provider', 'claude');
    select.append(option(documentRef, 'native-model'));
    select.value = 'native-model';
    documentRef.append(select);
    const targetId = createExternalTargetId(select, { documentRef });
    const selections = [];
    const externalSavedValues = [];
    const invalidations = [];
    let modelsAvailable = true;
    select.addEventListener('change', event => {
        if (event.isTrusted !== true) {
            externalSavedValues.push(select.value);
        }
    });
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => modelsAvailable && ['openai', 'claude'].includes(providerId)
            ? [{ provider: providerId, id: 'shared-model' }]
            : [],
        onSelectionChanged: selection => selections.push(selection),
        onSelectionInvalidated: invalidation => invalidations.push(invalidation),
        observerFactory: () => ({ observe() {}, disconnect() {} }),
        eventFactory: type => ({ type, isTrusted: false }),
    });

    controller.start();
    const managed = select.options.filter(item => item.dataset.cmrExternalModel === 'true');
    assert.deepEqual(managed.map(item => item.dataset.cmrProvider), ['openai', 'claude']);
    managed[0].selected = false;
    managed[1].selected = true;
    select.value = 'shared-model';
    select.dispatchEvent({ type: 'change', isTrusted: true });

    assert.deepEqual(selections.at(-1), {
        targetId,
        providerId: 'claude',
        modelId: 'shared-model',
        mode: 'direct',
        userInitiated: true,
    });
    controller.sync();
    const selectedAfterSync = select.options.find(option => option.selected);
    assert.equal(selectedAfterSync?.dataset.cmrProvider, 'claude');
    assert.equal(select.value, 'shared-model');

    controller.setMappings({});
    assert.equal(controller.getMetrics().directCount, 1);
    assert.equal(select.options.find(option => option.selected)?.dataset.cmrProvider, 'claude');
    assert.equal(select.value, 'shared-model');

    controller.setMappings({ [targetId]: EXTERNAL_MAPPING_MANUAL });
    assert.equal(select.options.find(option => option.selected)?.dataset.cmrProvider, 'claude');
    assert.equal(select.value, 'shared-model');
    assert.equal(controller.getMetrics().directCount, 1);

    modelsAvailable = false;
    controller.sync();
    assert.equal(select.value, 'native-model');
    assert.equal(externalSavedValues.at(-1), 'native-model');
    assert.equal(select.options.some(item => item.dataset.cmrExternalModel === 'true'), false);
    assert.equal(invalidations.at(-1).reason, 'models-updated');

    modelsAvailable = true;
    controller.setMappings({ [targetId]: EXTERNAL_MAPPING_DISABLED });
    assert.equal(controller.getMetrics().directCount, 1);
    const selectedBeforeDestroy = select.options.find(option => (
        option.dataset.cmrExternalModel === 'true' && option.dataset.cmrProvider === 'claude'
    ));
    for (const optionItem of select.options) {
        optionItem.selected = optionItem === selectedBeforeDestroy;
    }
    select.value = 'shared-model';
    controller.destroy();
    assert.equal(select.value, 'native-model');
    assert.equal(externalSavedValues.at(-1), 'native-model');
    assert.equal(invalidations.at(-1).reason, 'destroy');
    assert.equal(select.options.some(item => item.dataset.cmrExternalModel === 'true'), false);

    const collisionSelect = labeledModelSelect(documentRef, 'collision_chat_model', 'Chat model');
    collisionSelect.append(option(documentRef, 'shared-model', { 'data-type': 'openai' }));
    collisionSelect.value = 'shared-model';
    documentRef.append(collisionSelect);
    const collisionTargetId = createExternalTargetId(collisionSelect, { documentRef });
    const collisionSelections = [];
    const collisionController = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => providerId === 'claude'
            ? [{ provider: 'claude', id: 'shared-model' }]
            : [],
        onSelectionChanged: selection => collisionSelections.push(selection),
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });
    collisionController.start();
    const nativeCollision = collisionSelect.options.find(option => option.dataset.cmrExternalModel !== 'true');
    const cmrCollision = collisionSelect.options.find(option => option.dataset.cmrExternalModel === 'true');
    nativeCollision.selected = true;
    cmrCollision.selected = false;
    collisionSelect.value = 'shared-model';
    collisionSelect.dispatchEvent({ type: 'change', isTrusted: true });
    assert.deepEqual(collisionSelections.at(-1), {
        targetId: collisionTargetId,
        providerId: null,
        modelId: null,
        mode: 'direct',
        userInitiated: true,
    });
    collisionController.destroy();
});

test('명시적 제외는 target을 남기고 native fallback하며 선호 모델을 삭제하지 않는다', () => {
    const documentRef = new FakeDocument();
    const panel = documentRef.createElement('section');
    panel.setAttribute('data-extension-name', 'Example Bridge');
    const select = labeledModelSelect(documentRef, 'example_chat_model', 'Chat model');
    panel.append(select.parentElement);
    documentRef.append(panel);
    select.append(option(documentRef, 'native-model'));
    select.value = 'native-model';
    const targetId = createExternalTargetId(select, { documentRef });
    const externalValues = [];
    const invalidations = [];
    select.addEventListener('change', event => {
        if (event.isTrusted !== true) {
            externalValues.push(select.value);
        }
    });
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => providerId === 'openai'
            ? [{ provider: 'openai', id: 'gpt-next' }]
            : [],
        getPreferredModels: id => id === targetId ? { openai: 'gpt-next' } : {},
        onSelectionInvalidated: value => invalidations.push(value),
        observerFactory: () => ({ observe() {}, disconnect() {} }),
        eventFactory: type => ({ type, isTrusted: false }),
    });

    controller.start();
    const managed = select.options.find(item => item.dataset.cmrExternalModel === 'true');
    for (const item of select.options) {
        item.selected = item === managed;
    }
    select.value = 'gpt-next';

    controller.setTargetExcluded(targetId, true);
    const excluded = controller.getTargets()[0];
    assert.equal(excluded.resolution.source, 'user-excluded');
    assert.deepEqual(excluded.bridge, {
        status: 'idle', issueCode: 'user-excluded', injectedCount: 0,
    });
    assert.equal(select.value, 'native-model');
    assert.deepEqual(externalValues, ['native-model']);
    assert.deepEqual(invalidations, []);
    assert.equal(select.options.some(item => item.dataset.cmrExternalModel === 'true'), false);
    assert.deepEqual(controller.getExcludedTargetIds(), [targetId]);
    assert.equal(controller.getMetrics().userExcludedCount, 1);
    assert.equal(controller.getMetrics().idleCount, 0);
    assert.deepEqual(controller.getTargetDetails()[0], {
        targetId,
        extensionLabel: 'Example Bridge',
        label: 'Chat model',
        controlType: 'select',
        status: 'idle',
        resolutionSource: 'user-excluded',
        excludedReason: 'user-excluded',
        bridge: { status: 'idle', issueCode: 'user-excluded', injectedCount: 0 },
    });

    controller.setTargetExcluded(targetId, false);
    assert.equal(controller.getTargets()[0].resolution.source, 'direct');
    assert.equal(controller.getTargets()[0].bridge.status, 'connected');
    assert.equal(select.options.some(item => item.value === 'gpt-next'), true);
    // 재연결은 선택지만 복구하고 외부 확장의 현재 native 선택을 강제로 덮지 않는다.
    assert.equal(select.value, 'native-model');
    assert.deepEqual(controller.getExcludedTargetIds(), []);
    controller.destroy();
});

test('제외 대상 API는 ID를 정규화하고 512개 한도와 prototype pollution을 방어한다', () => {
    const polluted = {};
    Object.defineProperty(polluted, '__proto__', { enumerable: true, value: true });
    for (let index = 0; index < EXTERNAL_TARGET_LIMIT + 4; index += 1) {
        polluted[`cmr-ext-${index.toString(16).padStart(8, '0')}`] = true;
    }
    const controller = createExternalIntegrationController({ excludedTargetIds: polluted });
    assert.equal(controller.getExcludedTargetIds().length, EXTERNAL_TARGET_LIMIT);
    assert.equal(Object.hasOwn(Object.fromEntries(controller.getExcludedTargetIds().map(id => [id, true])), '__proto__'), false);
    assert.throws(() => controller.setTargetExcluded('unsafe', true), TypeError);
    assert.throws(() => controller.setTargetExcluded('cmr-ext-ffffffff', true), RangeError);

    controller.setExcludedTargetIds([' CMR-EXT-1234ABCD ', 'unsafe', '__proto__']);
    assert.deepEqual(controller.getExcludedTargetIds(), ['cmr-ext-1234abcd']);
});

test('초기 제외 목록을 비우면 생성 옵션의 오래된 값이 대상을 다시 막지 않는다', () => {
    const documentRef = new FakeDocument();
    const select = labeledModelSelect(documentRef, 'restored_chat_model', 'Restored model');
    documentRef.append(select.parentElement);
    const targetId = createExternalTargetId(select, { documentRef });
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        excludedTargetIds: [targetId],
        getModels: providerId => providerId === 'openai'
            ? [{ provider: 'openai', id: 'gpt-restored' }]
            : [],
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });

    controller.start();
    assert.equal(controller.getTargets()[0].resolution.source, 'user-excluded');
    controller.setExcludedTargetIds([]);
    assert.equal(controller.getTargets()[0].resolution.source, 'direct');
    assert.equal(select.options.some(item => item.value === 'gpt-restored'), true);
    controller.destroy();
});

test('확장 label은 공통 root를 건너뛰고 가까운 확장 경계를 humanize한다', () => {
    const documentRef = new FakeDocument();
    const commonRoot = documentRef.createElement('div');
    commonRoot.id = 'extensions_settings2';
    const captionPanel = documentRef.createElement('section');
    captionPanel.id = 'caption_settings';
    const caption = labeledModelSelect(documentRef, 'caption_multimodal_model', 'Caption model');
    captionPanel.append(caption.parentElement);
    commonRoot.append(captionPanel);
    documentRef.append(commonRoot);

    const [target] = discoverExternalModelTargets(documentRef, { documentRef });
    assert.equal(target.extensionLabel, 'Caption');
});

test('bridge 상태는 registry 빈 값·native 중복·target별 동기화 실패를 구분한다', () => {
    const emptyDocument = new FakeDocument();
    const emptySelect = labeledModelSelect(emptyDocument, 'empty_chat_model', 'Chat model');
    emptySelect.append(option(emptyDocument, 'native'));
    emptySelect.value = 'native';
    const emptyController = createExternalIntegrationController({
        root: emptyDocument,
        documentRef: emptyDocument,
        getModels: () => [],
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });
    assert.deepEqual(emptyController.start()[0].bridge, {
        status: 'idle', issueCode: 'registry-empty', injectedCount: 0,
        eligibleModelCount: 0, expectedManagedOptionCount: 0, capacityLimited: false,
    });
    emptyController.destroy();

    const documentRef = new FakeDocument();
    const bad = labeledModelSelect(documentRef, 'broken_chat_model', 'Broken chat model');
    bad.append(option(documentRef, 'native'));
    bad.value = 'native';
    const good = labeledModelSelect(documentRef, 'good_chat_model', 'Good chat model');
    // Registry model이 native에 이미 있어 주입 0개여도 bridge는 정상 연결이다.
    good.append(option(documentRef, 'gpt-next'));
    good.value = 'gpt-next';
    const silent = labeledModelSelect(documentRef, 'silent_chat_model', 'Silent chat model');
    silent.append(option(documentRef, 'native'));
    silent.value = 'native';
    const originalBadAppend = bad.append.bind(bad);
    bad.append = (...children) => {
        if (children.some(child => child.tagName === 'OPTGROUP')) {
            throw new Error('third-party DOM rejected injection');
        }
        return originalBadAppend(...children);
    };
    const originalSilentAppend = silent.append.bind(silent);
    silent.append = (...children) => {
        if (children.some(child => child.tagName === 'OPTGROUP')) {
            return undefined;
        }
        return originalSilentAppend(...children);
    };
    const controller = createExternalIntegrationController({
        root: documentRef,
        documentRef,
        getModels: providerId => providerId === 'openai'
            ? [{ provider: 'openai', id: 'gpt-next' }]
            : [],
        observerFactory: () => ({ observe() {}, disconnect() {} }),
    });
    const targets = controller.start();
    const badTarget = targets.find(target => target.control === bad);
    const goodTarget = targets.find(target => target.control === good);
    const silentTarget = targets.find(target => target.control === silent);
    assert.deepEqual(badTarget.bridge, {
        status: 'failed', issueCode: 'sync-failed', injectedCount: 0,
    });
    assert.deepEqual(goodTarget.bridge, {
        status: 'connected', issueCode: null, injectedCount: 0,
        eligibleModelCount: 0, expectedManagedOptionCount: 0, capacityLimited: false,
    });
    assert.deepEqual(silentTarget.bridge, {
        status: 'failed', issueCode: 'models-not-injected', injectedCount: 0,
        eligibleModelCount: 1, expectedManagedOptionCount: 1, capacityLimited: false,
    });
    assert.equal(controller.getMetrics().failedCount, 2);
    assert.equal(controller.getMetrics().connectedCount, 1);
    controller.destroy();
});
