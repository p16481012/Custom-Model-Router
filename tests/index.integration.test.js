import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { destroy, init } from '../index.js';
import { getCustomGroup } from '../src/vertex-select.js';

const MODEL_ID = 'gemini-3.5-pro-preview';
const SETTINGS_HTML = '<div id="cmr_settings"></div>';

class FakeEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options.bubbles);
        this.key = options.key;
        this.defaultPrevented = false;
        this.target = null;
        this.currentTarget = null;
        this.propagationStopped = false;
    }

    preventDefault() {
        this.defaultPrevented = true;
    }

    stopPropagation() {
        this.propagationStopped = true;
    }
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = String(tagName).toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.dataset = {};
        this.parentElement = null;
        this.id = '';
        this.className = '';
        this._textContent = '';
        this.value = '';
        this.disabled = false;
        this.hidden = false;
        this.title = '';
        this.type = '';
        this.focusCallCount = 0;
        this.scrollIntoViewCallCount = 0;
        this.listeners = new Map();
        this.attributes = new Map();
        this.classList = {
            add: (...tokens) => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                for (const token of tokens) {
                    classes.add(token);
                }
                this.className = [...classes].join(' ');
            },
            contains: token => this.className.split(/\s+/).includes(token),
        };
    }

    get textContent() {
        return this._textContent;
    }

    set textContent(value) {
        const next = String(value ?? '');
        if (this._textContent === next) {
            return;
        }

        this._textContent = next;
        this.ownerDocument?.notifyMutation?.(this);
    }

    append(...children) {
        for (const child of children) {
            child.remove();
            child.parentElement = this;
            this.children.push(child);
        }
    }

    prepend(child) {
        child.remove();
        child.parentElement = this;
        this.children.unshift(child);
    }

    replaceChildren(...children) {
        for (const child of this.children) {
            child.parentElement = null;
        }
        this.children = [];
        this.append(...children);
    }

    remove() {
        if (!this.parentElement) {
            return;
        }

        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
    }

    dispatchEvent(event) {
        event.target ??= this;
        event.currentTarget = this;
        for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
            listener.call(this, event);
        }

        if (event.bubbles && !event.propagationStopped && this.parentElement) {
            this.parentElement.dispatchEvent(event);
        }
        return !event.defaultPrevented;
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
        return this.attributes.get(String(name)) ?? null;
    }

    focus() {
        this.focusCallCount += 1;
        this.ownerDocument.activeElement = this;
    }

    scrollIntoView() {
        this.scrollIntoViewCallCount += 1;
    }

    contains(element) {
        return element === this || this.children.some(child => child.contains(element));
    }

    matches(selector) {
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }

        if (selector.startsWith('.')) {
            return this.classList.contains(selector.slice(1));
        }

        const dataMatch = selector.match(/^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/i);
        if (dataMatch) {
            const key = dataMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            return Object.hasOwn(this.dataset, key)
                && (dataMatch[2] === undefined || this.dataset[key] === dataMatch[2]);
        }

        return false;
    }

    querySelector(selector) {
        if (this.matches(selector)) {
            return this;
        }

        for (const child of this.children) {
            const match = child.querySelector(selector);
            if (match) {
                return match;
            }
        }

        return null;
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }
}

class FakeSelect extends FakeElement {
    constructor(ownerDocument) {
        super('select', ownerDocument);
        this._value = '';
    }

    get options() {
        return this.children.flatMap(child => (
            child.tagName === 'OPTGROUP' ? child.children : [child]
        )).filter(child => child.tagName === 'OPTION');
    }

    get value() {
        return this.options.some(option => String(option.value) === this._value)
            ? this._value
            : '';
    }

    set value(value) {
        this._value = String(value ?? '');
    }
}

class FakeTemplate extends FakeElement {
    constructor(ownerDocument) {
        super('template', ownerDocument);
        this.content = { firstElementChild: null };
        this._innerHTML = '';
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.content.firstElementChild = this.ownerDocument.createSettingsRoot();
    }
}

class FakeDocument {
    constructor() {
        this.defaultView = { Event: FakeEvent };
        this.body = new FakeElement('body', this);
        this.activeElement = null;
    }

    createElement(tagName) {
        switch (String(tagName).toLowerCase()) {
            case 'select':
                return new FakeSelect(this);
            case 'template':
                return new FakeTemplate(this);
            default:
                return new FakeElement(tagName, this);
        }
    }

    querySelector(selector) {
        return this.body.querySelector(selector);
    }

    createSettingsRoot() {
        const root = this.createElement('div');
        root.id = 'cmr_settings';

        const compatibility = this.createElement('div');
        compatibility.id = 'cmr_compatibility';

        const addForm = this.createElement('form');
        addForm.id = 'cmr_add_form';
        const input = this.createElement('input');
        input.id = 'cmr_model_id';
        addForm.append(input);

        const feedback = this.createElement('div');
        feedback.id = 'cmr_feedback';

        const count = this.createElement('span');
        count.id = 'cmr_model_count';

        const modelList = this.createElement('ul');
        modelList.id = 'cmr_model_list';

        root.append(compatibility, addForm, feedback, count, modelList);
        return root;
    }
}

class FakeEventSource {
    constructor() {
        this.listeners = new Map();
        this.onCalls = [];
        this.removeCalls = [];
    }

    on(eventName, listener) {
        const listeners = this.listeners.get(eventName) ?? new Set();
        listeners.add(listener);
        this.listeners.set(eventName, listeners);
        this.onCalls.push({ eventName, listener });
    }

    removeListener(eventName, listener) {
        this.listeners.get(eventName)?.delete(listener);
        this.removeCalls.push({ eventName, listener });
    }

    get listenerCount() {
        return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
    }
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createResponse() {
    return {
        ok: true,
        text: async () => SETTINGS_HTML,
    };
}

function createHarness(
    fetchImplementation = async () => createResponse(),
    modelIds = [MODEL_ID],
    selectedModelId = modelIds[0] ?? null,
    includeConnectionProfiles = true,
    popupShowError = null,
) {
    const documentRef = new FakeDocument();
    const apiConnections = documentRef.createElement('section');
    apiConnections.id = 'rm_api_block';
    const apiTitle = documentRef.createElement('div');
    apiTitle.id = 'title_api';
    const profileTools = documentRef.createElement('div');
    profileTools.className = 'flex-container';
    const connectionProfiles = documentRef.createElement('select');
    connectionProfiles.id = 'connection_profiles';
    profileTools.append(connectionProfiles);
    const vertexObserverRoot = apiConnections;
    const vertexForm = documentRef.createElement('form');
    vertexForm.id = 'vertexai_form';
    const vertexSelect = documentRef.createElement('select');
    vertexSelect.id = 'model_vertexai_select';
    const nativeOption = documentRef.createElement('option');
    nativeOption.value = 'gemini-2.5-pro';
    nativeOption.textContent = nativeOption.value;
    vertexSelect.append(nativeOption);
    vertexForm.append(vertexSelect);
    apiConnections.append(apiTitle);
    if (includeConnectionProfiles) {
        apiConnections.append(profileTools);
    }
    apiConnections.append(vertexForm);
    documentRef.body.append(apiConnections);

    const eventSource = new FakeEventSource();
    const chatCompletionSettings = { vertexai_model: '' };
    const extensionSettings = {
        customModelRouter: {
            schemaVersion: 1,
            models: modelIds.map(id => ({
                id,
                provider: 'vertexai',
                protocol: 'vertex-gemini',
                enabled: true,
            })),
            selectedModelId,
        },
    };
    let saveCallCount = 0;
    const eventTypes = {
        APP_INITIALIZED: 'app_initialized',
        SETTINGS_UPDATED: 'settings_updated',
        CHATCOMPLETION_SOURCE_CHANGED: 'source_changed',
        CHATCOMPLETION_MODEL_CHANGED: 'model_changed',
        OAI_PRESET_CHANGED_AFTER: 'preset_changed',
        CONNECTION_PROFILE_LOADED: 'profile_loaded',
    };
    const popupInstances = [];
    class FakePopup {
        constructor(content, popupType, message, options = {}) {
            this.content = content;
            this.popupType = popupType;
            this.message = message;
            this.options = options;
            this.showCallCount = 0;
            this.setAutoFocusCallCount = 0;
            this.completeCancelledCallCount = 0;
            this.closed = false;
            this.dlg = documentRef.createElement('dialog');
            const popupContent = documentRef.createElement('div');
            popupContent.className = 'popup-content';
            popupContent.append(content);
            this.dlg.append(popupContent);
            this.completion = createDeferred();
            popupInstances.push(this);
        }

        show() {
            this.showCallCount += 1;
            documentRef.body.append(this.dlg);
            if (popupShowError) {
                return Promise.reject(popupShowError);
            }
            return this.completion.promise;
        }

        setAutoFocus() {
            this.setAutoFocusCallCount += 1;
            this.content.focus?.();
        }

        async completeCancelled() {
            this.completeCancelledCallCount += 1;
            if (this.closed) {
                return;
            }

            this.closed = true;
            this.options.onClose?.();
            this.dlg.remove();
            this.completion.resolve(false);
        }
    }
    const POPUP_TYPE = { DISPLAY: 'display' };
    const context = {
        extensionSettings,
        saveSettingsDebounced() {
            saveCallCount += 1;
        },
        eventSource,
        eventTypes,
        chatCompletionSettings,
        Popup: FakePopup,
        POPUP_TYPE,
    };

    const nativeChangeListener = () => {
        chatCompletionSettings.vertexai_model = vertexSelect.value;
    };
    vertexSelect.addEventListener('change', nativeChangeListener);

    const observers = [];
    let mutationCallbackCount = 0;
    let mutationDeliveryScheduled = false;
    const pendingMutationTargets = new Set();
    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.target = null;
            this.options = null;
            this.disconnectCalls = 0;
            observers.push(this);
        }

        observe(target, options) {
            this.target = target;
            this.options = options;
        }

        disconnect() {
            this.disconnectCalls += 1;
            this.target = null;
            this.options = null;
        }
    }

    documentRef.notifyMutation = (target) => {
        if (!observers.some(candidate => candidate.target?.contains(target))) {
            return;
        }

        pendingMutationTargets.add(target);
        if (mutationDeliveryScheduled) {
            return;
        }

        mutationDeliveryScheduled = true;
        queueMicrotask(() => {
            mutationDeliveryScheduled = false;
            const targets = [...pendingMutationTargets];
            pendingMutationTargets.clear();

            for (const candidate of observers) {
                const records = targets
                    .filter(target => candidate.target?.contains(target))
                    .map(target => ({ type: 'childList', target }));
                if (records.length > 0) {
                    mutationCallbackCount += 1;
                    candidate.callback(records);
                }
            }
        });
    };

    let fetchCallCount = 0;
    const fetch = (...args) => {
        fetchCallCount += 1;
        return fetchImplementation(...args);
    };

    return {
        apiConnections,
        context,
        documentRef,
        eventSource,
        fetch,
        get fetchCallCount() {
            return fetchCallCount;
        },
        get saveCallCount() {
            return saveCallCount;
        },
        get mutationCallbackCount() {
            return mutationCallbackCount;
        },
        MutationObserver: FakeMutationObserver,
        observers,
        popupInstances,
        profileTools,
        vertexForm,
        vertexObserverRoot,
        vertexSelect,
        nativeChangeListener,
    };
}

function installBrowserGlobals(harness) {
    const keys = ['document', 'fetch', 'MutationObserver', 'SillyTavern'];
    const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

    Object.defineProperties(globalThis, {
        document: { configurable: true, writable: true, value: harness.documentRef },
        fetch: { configurable: true, writable: true, value: harness.fetch },
        MutationObserver: { configurable: true, writable: true, value: harness.MutationObserver },
        SillyTavern: {
            configurable: true,
            writable: true,
            value: { getContext: () => harness.context },
        },
    });

    return () => {
        for (const [key, descriptor] of descriptors) {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor);
            } else {
                delete globalThis[key];
            }
        }
    };
}

function findElement(root, predicate) {
    if (predicate(root)) {
        return root;
    }

    for (const child of root.children) {
        const match = findElement(child, predicate);
        if (match) {
            return match;
        }
    }

    return null;
}

function findActionButton(root, action, modelId) {
    return findElement(root, element => (
        element.dataset.cmrAction === action
        && element.dataset.modelId === modelId
    ));
}

test('init은 API Connections에 실행 버튼만 두고 Popup을 한 개씩 열고 닫는다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);

    try {
        await init();

        const customGroup = getCustomGroup(harness.vertexSelect);
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');

        assert.ok(customGroup, '사용자 모델 optgroup이 주입되어야 한다');
        assert.deepEqual(customGroup.children.map(option => option.value), [MODEL_ID]);
        assert.equal(harness.vertexSelect.value, MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, MODEL_ID);
        assert.ok(launcher, 'API Connections 실행 버튼이 마운트되어야 한다');
        assert.equal(launcher.parentElement, harness.profileTools);
        assert.equal(launcher.disabled, false);
        assert.equal(launcher.getAttribute('aria-haspopup'), 'dialog');
        assert.equal(launcher.getAttribute('aria-expanded'), 'false');
        assert.match(launcher.getAttribute('aria-label'), /1개 등록됨/);
        assert.equal(launcher.querySelector('.cmr-launcher-count')?.textContent, '1');
        assert.equal(harness.documentRef.querySelector('#extensions_settings2'), null);
        assert.equal(
            harness.documentRef.querySelector('#cmr_settings'),
            null,
            '패널을 열기 전에는 큰 설정 UI가 DOM에 없어야 한다',
        );
        assert.equal(harness.fetchCallCount, 1);
        assert.equal(harness.eventSource.onCalls.length, 6);
        assert.equal(harness.eventSource.listenerCount, 6);
        assert.equal(harness.observers.length, 1);
        assert.equal(harness.observers[0].target, harness.vertexObserverRoot);

        launcher.dispatchEvent(new FakeEvent('click'));

        const settingsRoot = harness.documentRef.querySelector('#cmr_settings');
        const modelList = settingsRoot?.querySelector('#cmr_model_list');
        const compatibility = settingsRoot?.querySelector('#cmr_compatibility');
        const modelCount = settingsRoot?.querySelector('#cmr_model_count');
        const popup = harness.popupInstances[0];

        assert.equal(harness.popupInstances.length, 1);
        assert.ok(popup);
        assert.equal(popup.popupType, harness.context.POPUP_TYPE.DISPLAY);
        assert.equal(popup.options.wider, true);
        assert.equal(popup.options.allowEscapeClose, true);
        assert.equal(popup.dlg.parentElement, harness.documentRef.body);
        assert.equal(popup.dlg.id, 'cmr_manager_dialog');
        assert.ok(popup.dlg.classList.contains('cmr-manager-dialog'));
        assert.ok(settingsRoot, '버튼을 누르면 Popup 안에 설정 패널이 생겨야 한다');
        assert.ok(popup.dlg.contains(settingsRoot));
        assert.equal(modelList.children.length, 1);
        assert.equal(modelCount.textContent, '1개');
        assert.equal(compatibility.dataset.state, 'ok');
        assert.equal(compatibility.textContent, 'Vertex 모델 선택기 연결됨');
        assert.equal(launcher.getAttribute('aria-expanded'), 'true');

        launcher.dispatchEvent(new FakeEvent('click'));
        assert.equal(harness.popupInstances.length, 1, '연속 클릭으로 Popup이 중복 생성되면 안 된다');
        assert.equal(popup.setAutoFocusCallCount, 1);

        await popup.completeCancelled();
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_manager_dialog'), null);
        assert.equal(launcher.getAttribute('aria-expanded'), 'false');
        assert.equal(harness.documentRef.activeElement, launcher);

        await destroy();

        assert.equal(getCustomGroup(harness.vertexSelect), null);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.eventSource.removeCalls.length, 6);
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.observers[0].target, null);
        assert.ok(harness.observers[0].disconnectCalls >= 2);
        assert.deepEqual(
            harness.vertexSelect.listeners.get('change'),
            [harness.nativeChangeListener],
            'SillyTavern의 기존 change listener는 보존해야 한다',
        );
        assert.equal(harness.vertexSelect.options[0].value, 'gemini-2.5-pro');
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('런처 숫자 변경을 감지해도 MutationObserver가 자기 변경을 무한 반복하지 않는다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);

    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        const count = launcher.querySelector('.cmr-launcher-count');
        assert.equal(harness.mutationCallbackCount, 0);

        count.textContent = '999';
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(count.textContent, '1');
        assert.equal(
            harness.mutationCallbackCount,
            1,
            '한 번의 외부 변경은 한 번만 동기화되고 확장 자신의 렌더를 다시 감지하면 안 된다',
        );
        assert.equal(harness.observers[0].target, harness.vertexObserverRoot);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Connection Profile 도구행이 늦게 생기면 기존 런처 하나를 fallback 위치에서 이동한다', async () => {
    const harness = createHarness(undefined, [MODEL_ID], MODEL_ID, false);
    const restoreGlobals = installBrowserGlobals(harness);

    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        const apiTitle = harness.documentRef.querySelector('#title_api');
        assert.equal(launcher.parentElement, apiTitle);

        harness.vertexObserverRoot.prepend(harness.profileTools);
        harness.observers[0].callback([{ type: 'childList', target: harness.vertexObserverRoot }]);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(launcher.parentElement, harness.profileTools);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), launcher);
        assert.equal(apiTitle.querySelector('#cmr_open_manager'), null);
        assert.equal(launcher.listeners.get('click').length, 1);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Popup show가 실패하면 고아 dialog와 열린 상태를 남기지 않는다', async () => {
    const harness = createHarness(undefined, [MODEL_ID], MODEL_ID, true, new Error('show 실패'));
    const restoreGlobals = installBrowserGlobals(harness);
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        launcher.dispatchEvent(new FakeEvent('click'));
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(harness.popupInstances.length, 1);
        assert.equal(harness.documentRef.querySelector('#cmr_manager_dialog'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(launcher.getAttribute('aria-expanded'), 'false');
        assert.equal(harness.documentRef.activeElement, launcher);
    } finally {
        console.error = originalConsoleError;
        await destroy();
        restoreGlobals();
    }
});

test('Popup의 위임 이벤트로 모델을 추가·선택·삭제하고 destroy가 열린 패널도 정리한다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);

    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        launcher.dispatchEvent(new FakeEvent('click'));

        const panel = harness.documentRef.querySelector('#cmr_settings');
        const input = panel.querySelector('#cmr_model_id');
        const form = panel.querySelector('#cmr_add_form');
        const feedback = panel.querySelector('#cmr_feedback');
        const addedModelId = 'gemini-4-flash-preview';

        input.value = addedModelId;
        const submitEvent = new FakeEvent('submit');
        form.dispatchEvent(submitEvent);

        assert.equal(submitEvent.defaultPrevented, true);
        assert.equal(input.value, '');
        assert.equal(input.getAttribute('aria-invalid'), 'false');
        assert.match(feedback.textContent, new RegExp(`${addedModelId} 모델을 등록`));
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '2개');
        assert.deepEqual(
            getCustomGroup(harness.vertexSelect).children.map(option => option.value),
            [MODEL_ID, addedModelId],
        );

        let modelList = panel.querySelector('#cmr_model_list');
        const selectButton = findActionButton(modelList, 'select', addedModelId);
        assert.ok(selectButton);
        assert.equal(selectButton.getAttribute('aria-label'), `${addedModelId} 모델을 Vertex 모델로 적용`);
        selectButton.dispatchEvent(new FakeEvent('click', { bubbles: true }));

        assert.equal(harness.vertexSelect.value, addedModelId);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, addedModelId);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModelId, addedModelId);
        assert.match(feedback.textContent, new RegExp(`${addedModelId} 모델을 Vertex AI 모델로 선택`));

        modelList = panel.querySelector('#cmr_model_list');
        const deleteButton = findActionButton(modelList, 'delete', MODEL_ID);
        assert.ok(deleteButton);
        deleteButton.dispatchEvent(new FakeEvent('click', { bubbles: true }));

        assert.equal(panel.querySelector('#cmr_model_count').textContent, '1개');
        assert.equal(findActionButton(panel, 'delete', MODEL_ID), null);
        assert.deepEqual(
            getCustomGroup(harness.vertexSelect).children.map(option => option.value),
            [addedModelId],
        );
        assert.match(feedback.textContent, new RegExp(`${MODEL_ID} 모델을 삭제`));
        assert.ok(harness.saveCallCount >= 3);

        const popup = harness.popupInstances[0];
        await destroy();
        assert.equal(popup.completeCancelledCallCount, 1);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_manager_dialog'), null);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('설정 UI fetch가 지연되는 동안 destroy해도 실행 버튼과 패널이 되살아나지 않는다', async () => {
    const deferredResponse = createDeferred();
    const harness = createHarness(() => deferredResponse.promise);
    const restoreGlobals = installBrowserGlobals(harness);
    let initPromise;

    try {
        initPromise = init();
        assert.equal(harness.fetchCallCount, 1);
        assert.ok(getCustomGroup(harness.vertexSelect));
        assert.equal(harness.eventSource.listenerCount, 6);
        const loadingLauncher = harness.documentRef.querySelector('#cmr_open_manager');
        assert.ok(loadingLauncher);
        assert.equal(loadingLauncher.disabled, true);
        loadingLauncher.dispatchEvent(new FakeEvent('click'));
        assert.equal(harness.popupInstances.length, 0);

        await destroy();

        assert.equal(getCustomGroup(harness.vertexSelect), null);
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);

        deferredResponse.resolve(createResponse());
        await initPromise;

        assert.equal(
            harness.documentRef.querySelector('#cmr_settings'),
            null,
            'destroy 뒤 완료된 fetch가 UI를 되살리면 안 된다',
        );
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.popupInstances.length, 0);
        assert.equal(getCustomGroup(harness.vertexSelect), null);
        assert.equal(harness.eventSource.listenerCount, 0);
    } finally {
        deferredResponse.resolve(createResponse());
        await initPromise?.catch(() => undefined);
        await destroy();
        restoreGlobals();
    }
});

test('모델 100개도 한 Popup의 압축 목록으로 렌더링하고 목록 높이는 CSS로 제한한다', async () => {
    const modelIds = Array.from({ length: 100 }, (_, index) => (
        `gemini-bulk-${String(index + 1).padStart(3, '0')}`
    ));
    const harness = createHarness(undefined, modelIds, modelIds[0]);
    const restoreGlobals = installBrowserGlobals(harness);

    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        assert.equal(launcher.querySelector('.cmr-launcher-count').textContent, '100');

        launcher.dispatchEvent(new FakeEvent('click'));
        const panel = harness.documentRef.querySelector('#cmr_settings');
        const modelList = panel.querySelector('#cmr_model_list');
        assert.equal(harness.popupInstances.length, 1);
        assert.equal(modelList.children.length, 100);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '100개');
        assert.ok(modelList.children.every(row => row.className === 'cmr-model-row'));

        const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
        assert.match(
            css,
            /\.cmr-model-list\s*\{[\s\S]*?max-block-size:\s*min\(42dvh,\s*22rem\);/,
            '등록 모델 목록은 화면을 계속 밀어내지 않도록 최대 높이가 있어야 한다',
        );
        assert.match(
            css,
            /\.cmr-model-list\s*\{[\s\S]*?overflow-y:\s*auto;/,
            '등록 모델 목록 자체가 세로 스크롤을 제공해야 한다',
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});
