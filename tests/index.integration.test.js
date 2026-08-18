import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { destroy, init } from '../index.js';
import { getCustomGroup } from '../src/model-select.js';
import { getProvider, getProviders } from '../src/providers.js';

const VERTEX_MODEL_ID = 'gemini-3.5-pro-preview';
const SETTINGS_HTML = '<div id="cmr_settings"></div>';

class FakeEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options.bubbles);
        this.key = options.key;
        this.isTrusted = options.isTrusted;
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
        this.placeholder = '';
        this.maxLength = -1;
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
        if (children.length) {
            this.ownerDocument?.notifyMutation?.(this);
        }
    }

    prepend(child) {
        child.remove();
        child.parentElement = this;
        this.children.unshift(child);
        this.ownerDocument?.notifyMutation?.(this);
    }

    replaceChildren(...children) {
        for (const child of this.children) {
            child.parentElement = null;
        }
        this.children = [];
        for (const child of children) {
            child.remove();
            child.parentElement = this;
            this.children.push(child);
        }
        this.ownerDocument?.notifyMutation?.(this);
    }

    remove() {
        if (!this.parentElement) {
            return;
        }
        const formerParent = this.parentElement;
        formerParent.children = formerParent.children.filter(child => child !== this);
        this.parentElement = null;
        this.ownerDocument?.notifyMutation?.(formerParent);
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
        for (let current = this; current; current = current.parentElement) {
            if (current.matches(selector)) {
                return current;
            }
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

        const provider = this.createElement('select');
        provider.id = 'cmr_provider';
        const providerHelp = this.createElement('small');
        providerHelp.id = 'cmr_provider_help';
        const compatibility = this.createElement('div');
        compatibility.id = 'cmr_compatibility';

        const addForm = this.createElement('form');
        addForm.id = 'cmr_add_form';
        const modelLabel = this.createElement('label');
        modelLabel.id = 'cmr_model_label';
        const input = this.createElement('input');
        input.id = 'cmr_model_id';
        const modelHelp = this.createElement('small');
        modelHelp.id = 'cmr_model_help';
        addForm.append(modelLabel, input, modelHelp);

        const feedback = this.createElement('div');
        feedback.id = 'cmr_feedback';
        const listTitle = this.createElement('h3');
        listTitle.id = 'cmr_list_title';
        const count = this.createElement('span');
        count.id = 'cmr_model_count';
        const modelList = this.createElement('ul');
        modelList.id = 'cmr_model_list';

        root.append(
            provider,
            providerHelp,
            compatibility,
            addForm,
            feedback,
            listTitle,
            count,
            modelList,
        );
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

    emit(eventName, ...args) {
        for (const listener of [...(this.listeners.get(eventName) ?? [])]) {
            listener(...args);
        }
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
    return { ok: true, text: async () => SETTINGS_HTML };
}

function createModelRecord(providerId, id) {
    const provider = getProvider(providerId);
    return { id, provider: provider.id, protocol: provider.protocol, enabled: true };
}

function createHarness({
    fetchImplementation = async () => createResponse(),
    models = [createModelRecord('vertexai', VERTEX_MODEL_ID)],
    selectedModels = { vertexai: VERTEX_MODEL_ID },
    storedSettings,
    configuredModels = {},
    activeSource = 'vertexai',
    mainApi = 'openai',
    includeConnectionProfiles = true,
    popupShowError = null,
    ignoredModelChangeProviders = [],
} = {}) {
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
    apiConnections.append(apiTitle);
    if (includeConnectionProfiles) {
        apiConnections.append(profileTools);
    }

    const controls = new Map();
    const nativeListeners = new Map();
    const nativeEventCounts = new Map();
    const chatCompletionSettings = { chat_completion_source: activeSource };

    for (const provider of getProviders()) {
        const control = documentRef.createElement(provider.controlType === 'select' ? 'select' : 'input');
        control.id = provider.selector.slice(1);
        const configured = String(configuredModels[provider.id] ?? '');
        chatCompletionSettings[provider.settingKey] = configured;

        if (provider.controlType === 'select') {
            const nativeOption = documentRef.createElement('option');
            nativeOption.value = provider.fallbackModelIds[0] ?? `${provider.id}-native`;
            nativeOption.textContent = nativeOption.value;
            control.append(nativeOption);
            if (configured === nativeOption.value) {
                control.value = configured;
            }
        } else {
            control.value = configured;
        }

        const nativeListener = () => {
            nativeEventCounts.set(provider.id, (nativeEventCounts.get(provider.id) ?? 0) + 1);
            if (!ignoredModelChangeProviders.includes(provider.id)) {
                chatCompletionSettings[provider.settingKey] = control.value;
            }
        };
        control.addEventListener(provider.applyEvent, nativeListener);
        nativeListeners.set(provider.id, nativeListener);
        nativeEventCounts.set(provider.id, 0);
        controls.set(provider.id, control);

        const form = documentRef.createElement('form');
        form.id = `${provider.id}_form`;
        form.append(control);
        apiConnections.append(form);
    }
    documentRef.body.append(apiConnections);

    const eventSource = new FakeEventSource();
    const extensionSettings = {
        customModelRouter: storedSettings ?? { schemaVersion: 2, models, selectedModels },
    };
    let saveCallCount = 0;
    const eventTypes = {
        APP_INITIALIZED: 'app_initialized',
        SETTINGS_UPDATED: 'settings_updated',
        CHATCOMPLETION_SOURCE_CHANGED: 'source_changed',
        CHATCOMPLETION_MODEL_CHANGED: 'model_changed',
        MAIN_API_CHANGED: 'main_api_changed',
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

    const context = {
        mainApi,
        extensionSettings,
        saveSettingsDebounced() {
            saveCallCount += 1;
        },
        eventSource,
        eventTypes,
        chatCompletionSettings,
        Popup: FakePopup,
        POPUP_TYPE: { DISPLAY: 'display' },
    };

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
                if (records.length) {
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
        controls,
        nativeListeners,
        nativeEventCounts,
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
        observerRoot: apiConnections,
        setActiveSource(source) {
            context.chatCompletionSettings.chat_completion_source = source;
            eventSource.emit(eventTypes.CHATCOMPLETION_SOURCE_CHANGED);
        },
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

function findActionButton(root, action, modelId, providerId) {
    return findElement(root, element => (
        element.dataset.cmrAction === action
        && element.dataset.modelId === modelId
        && (providerId === undefined || element.dataset.provider === providerId)
    ));
}

async function flushMicrotasks(count = 5) {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
}

function openPanel(harness) {
    const launcher = harness.documentRef.querySelector('#cmr_open_manager');
    launcher.dispatchEvent(new FakeEvent('click'));
    return harness.documentRef.querySelector('#cmr_settings');
}

function choosePanelProvider(panel, providerId) {
    const providerSelect = panel.querySelector('#cmr_provider');
    providerSelect.value = providerId;
    providerSelect.dispatchEvent(new FakeEvent('change'));
}

test('init은 24개 제공업체를 연결하고 API Connections Popup을 한 개씩 열고 닫는다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const vertexSelect = harness.controls.get('vertexai');
    try {
        await init();
        const customGroup = getCustomGroup(vertexSelect, 'vertexai');
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        assert.equal(getProviders().length, 24);
        assert.ok(customGroup);
        assert.deepEqual(customGroup.children.map(option => option.value), [VERTEX_MODEL_ID]);
        assert.equal(vertexSelect.value, VERTEX_MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, VERTEX_MODEL_ID);
        assert.equal(launcher.parentElement, harness.profileTools);
        assert.equal(launcher.disabled, false);
        assert.equal(launcher.getAttribute('aria-haspopup'), 'dialog');
        assert.equal(launcher.getAttribute('aria-expanded'), 'false');
        assert.match(launcher.getAttribute('aria-label'), /1개 등록됨/);
        assert.equal(launcher.querySelector('.cmr-launcher-count')?.textContent, '1');
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.fetchCallCount, 1);
        assert.equal(harness.eventSource.onCalls.length, 7);
        assert.equal(harness.eventSource.listenerCount, 7);
        assert.equal(harness.observers.length, 1);
        assert.equal(harness.observers[0].target, harness.observerRoot);
        assert.equal(globalThis.CustomModelRouter.apiVersion, '1.0.0');
        assert.equal(globalThis.CustomModelRouter.extensionVersion, '0.3.0');
        assert.equal(globalThis.CustomModelRouter.getSnapshot().models.length, 1);

        const panel = openPanel(harness);
        const popup = harness.popupInstances[0];
        assert.equal(harness.popupInstances.length, 1);
        assert.equal(popup.popupType, harness.context.POPUP_TYPE.DISPLAY);
        assert.equal(popup.options.wider, true);
        assert.equal(popup.options.allowEscapeClose, true);
        assert.equal(popup.dlg.id, 'cmr_manager_dialog');
        assert.ok(popup.dlg.classList.contains('cmr-manager-dialog'));
        assert.ok(popup.dlg.contains(panel));
        assert.equal(harness.context.mainApi, 'openai');
        assert.equal(harness.context.chatCompletionSettings.chat_completion_source, 'vertexai');
        assert.equal(panel.querySelector('#cmr_provider').options.length, 24);
        assert.equal(panel.querySelector('#cmr_provider').value, 'vertexai');
        assert.equal(panel.querySelector('#cmr_model_label').textContent, 'Google Vertex AI 모델 ID');
        assert.match(panel.querySelector('#cmr_model_help').textContent, /모델 경로 한 구간/);
        assert.equal(panel.querySelector('#cmr_list_title').textContent, 'Google Vertex AI 등록 모델');
        assert.equal(panel.querySelector('#cmr_model_list').children.length, 1);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '이 제공업체 1개 · 전체 1개');
        assert.equal(panel.querySelector('#cmr_compatibility').dataset.state, 'ok');
        assert.equal(
            panel.querySelector('#cmr_compatibility').textContent,
            'Google Vertex AI 모델 선택기 감지됨 · 현재 연결',
        );
        assert.equal(launcher.getAttribute('aria-expanded'), 'true');

        launcher.dispatchEvent(new FakeEvent('click'));
        assert.equal(harness.popupInstances.length, 1);
        assert.equal(popup.setAutoFocusCallCount, 1);
        await popup.completeCancelled();
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_manager_dialog'), null);
        assert.equal(launcher.getAttribute('aria-expanded'), 'false');
        assert.equal(harness.documentRef.activeElement, launcher);

        await destroy();
        assert.equal(globalThis.CustomModelRouter, undefined);
        assert.equal(getCustomGroup(vertexSelect, 'vertexai'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.eventSource.removeCalls.length, 7);
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.observers[0].target, null);
        for (const provider of getProviders()) {
            const control = harness.controls.get(provider.id);
            assert.deepEqual(
                control.listeners.get(provider.applyEvent),
                [harness.nativeListeners.get(provider.id)],
                `${provider.id}의 SillyTavern native listener를 보존해야 한다`,
            );
            if (provider.controlType === 'select') {
                assert.equal(getCustomGroup(control, provider.id), null);
            }
        }
        assert.equal(vertexSelect.options[0].value, 'gemini-2.5-pro');
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.vertexai, undefined);

        await init();
        const refreshedNativeOption = harness.documentRef.createElement('option');
        refreshedNativeOption.value = 'gemini-2.5-pro';
        refreshedNativeOption.textContent = refreshedNativeOption.value;
        vertexSelect.replaceChildren(refreshedNativeOption);
        vertexSelect.value = refreshedNativeOption.value;
        vertexSelect.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(8);
        assert.equal(vertexSelect.value, 'gemini-2.5-pro');
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, 'gemini-2.5-pro');
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.vertexai, undefined);

        const restoredGroup = getCustomGroup(vertexSelect, 'vertexai');
        vertexSelect.value = VERTEX_MODEL_ID;
        vertexSelect.dispatchEvent(new FakeEvent('change', { isTrusted: true }));
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.vertexai, VERTEX_MODEL_ID);
        vertexSelect.replaceChildren(restoredGroup);
        await destroy();
        assert.equal(getCustomGroup(vertexSelect, 'vertexai'), null);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.vertexai, VERTEX_MODEL_ID);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('런처 숫자 변경은 MutationObserver 자기 반복 없이 한 번만 복구한다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const count = harness.documentRef.querySelector('#cmr_open_manager').querySelector('.cmr-launcher-count');
        assert.equal(harness.mutationCallbackCount, 0);
        count.textContent = '999';
        await flushMicrotasks();
        assert.equal(count.textContent, '1');
        assert.equal(harness.mutationCallbackCount, 1);
        assert.equal(harness.observers[0].target, harness.observerRoot);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Connection Profile 도구행이 늦게 생기면 fallback 런처 하나를 이동한다', async () => {
    const harness = createHarness({ includeConnectionProfiles: false });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        const apiTitle = harness.documentRef.querySelector('#title_api');
        assert.equal(launcher.parentElement, apiTitle);
        harness.observerRoot.prepend(harness.profileTools);
        await flushMicrotasks();
        assert.equal(launcher.parentElement, harness.profileTools);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), launcher);
        assert.equal(apiTitle.querySelector('#cmr_open_manager'), null);
        assert.equal(launcher.listeners.get('click').length, 1);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Popup show 실패는 고아 dialog와 열린 상태를 남기지 않는다', async () => {
    const harness = createHarness({ popupShowError: new Error('show 실패') });
    const restoreGlobals = installBrowserGlobals(harness);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        launcher.dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks();
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

test('Vertex Popup 위임 이벤트는 모델 추가·선택·삭제와 열린 패널 destroy를 처리한다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const vertexSelect = harness.controls.get('vertexai');
    try {
        await init();
        const panel = openPanel(harness);
        const input = panel.querySelector('#cmr_model_id');
        const feedback = panel.querySelector('#cmr_feedback');
        const addedModelId = 'gemini-4-flash-preview';

        input.value = addedModelId;
        const submitEvent = new FakeEvent('submit');
        panel.querySelector('#cmr_add_form').dispatchEvent(submitEvent);
        assert.equal(submitEvent.defaultPrevented, true);
        assert.equal(input.value, '');
        assert.equal(input.getAttribute('aria-invalid'), 'false');
        assert.match(feedback.textContent, /Google Vertex AI에 gemini-4-flash-preview 모델을 등록/);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '이 제공업체 2개 · 전체 2개');
        assert.deepEqual(
            getCustomGroup(vertexSelect, 'vertexai').children.map(option => option.value),
            [VERTEX_MODEL_ID, addedModelId],
        );

        let modelList = panel.querySelector('#cmr_model_list');
        const selectButton = findActionButton(modelList, 'select', addedModelId, 'vertexai');
        assert.equal(selectButton.getAttribute('aria-label'), `Google Vertex AI에 ${addedModelId} 모델 적용`);
        selectButton.dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(vertexSelect.value, addedModelId);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, addedModelId);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.vertexai, addedModelId);
        assert.match(feedback.textContent, /gemini-4-flash-preview 모델을 Google Vertex AI에 적용/);

        modelList = panel.querySelector('#cmr_model_list');
        findActionButton(modelList, 'delete', VERTEX_MODEL_ID, 'vertexai')
            .dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '이 제공업체 1개 · 전체 1개');
        assert.equal(findActionButton(panel, 'delete', VERTEX_MODEL_ID, 'vertexai'), null);
        assert.deepEqual(
            getCustomGroup(vertexSelect, 'vertexai').children.map(option => option.value),
            [addedModelId],
        );
        assert.match(feedback.textContent, /Google Vertex AI에서 .* 모델 등록을 삭제/);

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

test('비활성 제공업체의 모델 적용 버튼은 disabled이고 설정을 바꾸지 않는다', async () => {
    const zaiModel = 'glm-5.3-preview';
    const harness = createHarness({
        models: [
            createModelRecord('vertexai', VERTEX_MODEL_ID),
            createModelRecord('zai', zaiModel),
        ],
        selectedModels: { vertexai: VERTEX_MODEL_ID },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        choosePanelProvider(panel, 'zai');
        assert.equal(panel.querySelector('#cmr_model_label').textContent, 'Z.AI (GLM) 모델 ID');
        assert.match(panel.querySelector('#cmr_compatibility').textContent, /현재 연결로 선택하면 적용/);
        const selectButton = findActionButton(panel, 'select', zaiModel, 'zai');
        assert.equal(selectButton.disabled, true);
        selectButton.dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(harness.context.chatCompletionSettings.zai_model, '');
        assert.match(panel.querySelector('#cmr_feedback').textContent, /Z\.AI \(GLM\) 연결을 먼저 선택/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('SillyTavern이 모델 변경을 거절하면 이전 설정과 selector 상태를 되살린다', async () => {
    const previousModel = 'vendor/not-present-in-selector';
    const rejectedModel = 'vendor/rejected-chat-model';
    const harness = createHarness({
        models: [createModelRecord('openrouter', rejectedModel)],
        selectedModels: {},
        configuredModels: { openrouter: previousModel },
        activeSource: 'openrouter',
        ignoredModelChangeProviders: ['openrouter'],
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const select = harness.controls.get('openrouter');
    try {
        await init();
        const panel = openPanel(harness);
        const previousControlValue = select.value;
        assert.equal(previousControlValue, '');
        findActionButton(panel, 'select', rejectedModel, 'openrouter')
            .dispatchEvent(new FakeEvent('click', { bubbles: true }));

        assert.equal(select.value, previousControlValue);
        assert.equal(harness.context.chatCompletionSettings.openrouter_model, previousModel);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.openrouter, undefined);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /모델 변경을 수락하지 않았습니다/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Z.AI를 활성화하면 GLM 모델을 등록·선택하고 native 모델 전환 뒤 삭제한다', async () => {
    const glmModel = 'glm-5.3-preview';
    const harness = createHarness({ models: [], selectedModels: {} });
    const restoreGlobals = installBrowserGlobals(harness);
    const zaiSelect = harness.controls.get('zai');
    try {
        await init();
        harness.setActiveSource('zai');
        await flushMicrotasks();
        const panel = openPanel(harness);
        assert.equal(panel.querySelector('#cmr_provider').value, 'zai');
        assert.equal(panel.querySelector('#cmr_compatibility').dataset.state, 'ok');

        const input = panel.querySelector('#cmr_model_id');
        input.value = glmModel;
        panel.querySelector('#cmr_add_form').dispatchEvent(new FakeEvent('submit'));
        const selectButton = findActionButton(panel, 'select', glmModel, 'zai');
        assert.equal(selectButton.disabled, false);
        selectButton.dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(zaiSelect.value, glmModel);
        assert.equal(harness.context.chatCompletionSettings.zai_model, glmModel);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.zai, glmModel);

        zaiSelect.value = 'glm-4.6';
        zaiSelect.dispatchEvent(new FakeEvent('change', { isTrusted: true }));
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.zai, undefined);
        findActionButton(panel, 'delete', glmModel, 'zai')
            .dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(findActionButton(panel, 'delete', glmModel, 'zai'), null);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '이 제공업체 0개 · 전체 0개');
        assert.match(panel.querySelector('#cmr_feedback').textContent, /Z\.AI \(GLM\)에서 .* 등록을 삭제/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Custom OpenAI-compatible 모델 적용은 native input 이벤트를 정확히 한 번 사용한다', async () => {
    const customModel = 'vendor/glm-5:fast';
    const harness = createHarness({ models: [], selectedModels: {}, activeSource: 'custom' });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        assert.equal(panel.querySelector('#cmr_provider').value, 'custom');
        const input = panel.querySelector('#cmr_model_id');
        input.value = customModel;
        panel.querySelector('#cmr_add_form').dispatchEvent(new FakeEvent('submit'));
        const selectButton = findActionButton(panel, 'select', customModel, 'custom');
        assert.equal(selectButton.disabled, false);
        const before = harness.nativeEventCounts.get('custom');
        selectButton.dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(harness.nativeEventCounts.get('custom'), before + 1);
        assert.equal(harness.controls.get('custom').value, customModel);
        assert.equal(harness.context.chatCompletionSettings.custom_model, customModel);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.custom, customModel);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /Custom OpenAI-compatible에 적용/);

        findActionButton(panel, 'delete', customModel, 'custom')
            .dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(harness.controls.get('custom').value, customModel);
        assert.equal(harness.context.chatCompletionSettings.custom_model, customModel);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.custom, undefined);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /등록만 삭제.*입력값은 유지/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('동적 모델 목록이 사용자 옵션을 지우고 native fallback을 선택해도 저장 모델을 복원한다', async () => {
    const customModel = 'deepseek-v5-preview';
    const harness = createHarness({
        models: [createModelRecord('deepseek', customModel)],
        selectedModels: { deepseek: customModel },
        activeSource: 'deepseek',
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const select = harness.controls.get('deepseek');
    try {
        await init();
        assert.equal(select.value, customModel);
        assert.ok(getCustomGroup(select, 'deepseek'));

        const nativeOption = harness.documentRef.createElement('option');
        nativeOption.value = 'deepseek-v4-flash';
        nativeOption.textContent = nativeOption.value;
        select.replaceChildren(nativeOption);
        select.value = nativeOption.value;
        select.dispatchEvent(new FakeEvent('change'));
        assert.equal(harness.context.chatCompletionSettings.deepseek_model, nativeOption.value);

        await flushMicrotasks(8);
        assert.equal(select.value, customModel);
        assert.equal(harness.context.chatCompletionSettings.deepseek_model, customModel);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.deepseek, customModel);
        assert.deepEqual(
            getCustomGroup(select, 'deepseek').children.map(option => option.value),
            [customModel],
        );

        // `/model`은 jQuery synthetic change로 core 설정과 eventSource만 갱신하므로
        // native addEventListener가 실행되지 않는 경로도 별도로 재현한다.
        select.value = nativeOption.value;
        harness.context.chatCompletionSettings.deepseek_model = nativeOption.value;
        harness.eventSource.emit(harness.context.eventTypes.CHATCOMPLETION_MODEL_CHANGED);
        await flushMicrotasks(8);
        assert.equal(select.value, nativeOption.value);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.deepseek, undefined);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('v0.1 Vertex 설정은 v2 provider record와 selectedModels로 한 번만 마이그레이션한다', async () => {
    const harness = createHarness({
        storedSettings: {
            schemaVersion: 1,
            models: [{
                id: VERTEX_MODEL_ID,
                provider: 'vertexai',
                protocol: 'vertex-gemini',
                enabled: true,
            }],
            selectedModelId: VERTEX_MODEL_ID,
        },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const migrated = harness.context.extensionSettings.customModelRouter;
        assert.equal(migrated.schemaVersion, 2);
        assert.deepEqual(migrated.models, [createModelRecord('vertexai', VERTEX_MODEL_ID)]);
        assert.deepEqual(migrated.selectedModels, { vertexai: VERTEX_MODEL_ID });
        assert.equal(Object.keys(migrated).includes('selectedModelId'), false);
        assert.equal(harness.saveCallCount, 1);
        assert.equal(harness.controls.get('vertexai').value, VERTEX_MODEL_ID);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('설정 UI fetch 지연 중 destroy해도 런처와 provider 옵션이 되살아나지 않는다', async () => {
    const deferredResponse = createDeferred();
    const harness = createHarness({ fetchImplementation: () => deferredResponse.promise });
    const restoreGlobals = installBrowserGlobals(harness);
    let initPromise;
    try {
        initPromise = init();
        assert.equal(harness.fetchCallCount, 1);
        assert.ok(getCustomGroup(harness.controls.get('vertexai'), 'vertexai'));
        assert.equal(harness.eventSource.listenerCount, 7);
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        assert.equal(launcher.disabled, true);
        launcher.dispatchEvent(new FakeEvent('click'));
        assert.equal(harness.popupInstances.length, 0);

        await destroy();
        assert.equal(getCustomGroup(harness.controls.get('vertexai'), 'vertexai'), null);
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);

        deferredResponse.resolve(createResponse());
        await initPromise;
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.popupInstances.length, 0);
        assert.equal(harness.eventSource.listenerCount, 0);
    } finally {
        deferredResponse.resolve(createResponse());
        await initPromise?.catch(() => undefined);
        await destroy();
        restoreGlobals();
    }
});

test('모델 100개는 런처에 99+로 축약하고 Popup의 provider별 압축 목록에 모두 렌더링한다', async () => {
    const modelIds = Array.from({ length: 100 }, (_, index) => (
        `gemini-bulk-${String(index + 1).padStart(3, '0')}`
    ));
    const harness = createHarness({
        models: modelIds.map(id => createModelRecord('vertexai', id)),
        selectedModels: { vertexai: modelIds[0] },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        assert.equal(launcher.querySelector('.cmr-launcher-count').textContent, '99+');
        assert.match(launcher.getAttribute('aria-label'), /100개 등록됨/);

        const panel = openPanel(harness);
        const modelList = panel.querySelector('#cmr_model_list');
        assert.equal(harness.popupInstances.length, 1);
        assert.equal(modelList.children.length, 100);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '이 제공업체 100개 · 전체 100개');
        assert.ok(modelList.children.every(row => row.className === 'cmr-model-row'));

        const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
        assert.match(css, /\.cmr-model-list\s*\{[\s\S]*?max-block-size:\s*min\(42dvh,\s*22rem\);/);
        assert.match(css, /\.cmr-model-list\s*\{[\s\S]*?overflow-y:\s*auto;/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});
