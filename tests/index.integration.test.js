import test from 'node:test';
import assert from 'node:assert/strict';

import { destroy, init } from '../index.js';
import { getCustomGroup } from '../src/vertex-select.js';

const MODEL_ID = 'gemini-3.5-pro-preview';
const SETTINGS_HTML = '<div id="cmr_settings"></div>';

class FakeEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options.bubbles);
        this.defaultPrevented = false;
        this.target = null;
        this.currentTarget = null;
    }

    preventDefault() {
        this.defaultPrevented = true;
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
        this.textContent = '';
        this.value = '';
        this.listeners = new Map();
        this.attributes = new Map();
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
        event.target = this;
        event.currentTarget = this;
        for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
            listener.call(this, event);
        }
        return !event.defaultPrevented;
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    contains(element) {
        return element === this || this.children.some(child => child.contains(element));
    }

    matches(selector) {
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }

        if (selector === '[data-cmr-action]') {
            return Object.hasOwn(this.dataset, 'cmrAction');
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

        const modelList = this.createElement('div');
        modelList.id = 'cmr_model_list';

        root.append(compatibility, addForm, feedback, modelList);
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

function createHarness(fetchImplementation = async () => createResponse()) {
    const documentRef = new FakeDocument();
    const vertexObserverRoot = documentRef.createElement('div');
    vertexObserverRoot.id = 'rm_api_block';
    const vertexForm = documentRef.createElement('form');
    vertexForm.id = 'vertexai_form';
    const vertexSelect = documentRef.createElement('select');
    vertexSelect.id = 'model_vertexai_select';
    const nativeOption = documentRef.createElement('option');
    nativeOption.value = 'gemini-2.5-pro';
    nativeOption.textContent = nativeOption.value;
    vertexSelect.append(nativeOption);
    vertexForm.append(vertexSelect);
    vertexObserverRoot.append(vertexForm);

    const settingsTarget = documentRef.createElement('div');
    settingsTarget.id = 'extensions_settings2';
    documentRef.body.append(vertexObserverRoot, settingsTarget);

    const eventSource = new FakeEventSource();
    const chatCompletionSettings = { vertexai_model: '' };
    const extensionSettings = {
        customModelRouter: {
            schemaVersion: 1,
            models: [{
                id: MODEL_ID,
                provider: 'vertexai',
                protocol: 'vertex-gemini',
                enabled: true,
            }],
            selectedModelId: MODEL_ID,
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
    const context = {
        extensionSettings,
        saveSettingsDebounced() {
            saveCallCount += 1;
        },
        eventSource,
        eventTypes,
        chatCompletionSettings,
    };

    const nativeChangeListener = () => {
        chatCompletionSettings.vertexai_model = vertexSelect.value;
    };
    vertexSelect.addEventListener('change', nativeChangeListener);

    const observers = [];
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

    let fetchCallCount = 0;
    const fetch = (...args) => {
        fetchCallCount += 1;
        return fetchImplementation(...args);
    };

    return {
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
        MutationObserver: FakeMutationObserver,
        observers,
        settingsTarget,
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

test('init은 저장 모델과 UI를 복원하고 destroy는 확장 자원만 정리한다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);

    try {
        await init();

        const customGroup = getCustomGroup(harness.vertexSelect);
        const settingsRoot = harness.documentRef.querySelector('#cmr_settings');
        const modelList = settingsRoot?.querySelector('#cmr_model_list');
        const compatibility = settingsRoot?.querySelector('#cmr_compatibility');

        assert.ok(customGroup, '사용자 모델 optgroup이 주입되어야 한다');
        assert.deepEqual(customGroup.children.map(option => option.value), [MODEL_ID]);
        assert.equal(harness.vertexSelect.value, MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, MODEL_ID);
        assert.ok(settingsRoot, '설정 UI가 마운트되어야 한다');
        assert.equal(settingsRoot.parentElement, harness.settingsTarget);
        assert.equal(modelList.children.length, 1);
        assert.match(compatibility.textContent, /^호환됨:/);
        assert.equal(harness.fetchCallCount, 1);
        assert.equal(harness.eventSource.onCalls.length, 6);
        assert.equal(harness.eventSource.listenerCount, 6);
        assert.equal(harness.observers.length, 1);
        assert.equal(harness.observers[0].target, harness.vertexObserverRoot);

        destroy();

        assert.equal(getCustomGroup(harness.vertexSelect), null);
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
        destroy();
        restoreGlobals();
    }
});

test('설정 UI fetch가 지연되는 동안 destroy해도 늦은 UI가 다시 마운트되지 않는다', async () => {
    const deferredResponse = createDeferred();
    const harness = createHarness(() => deferredResponse.promise);
    const restoreGlobals = installBrowserGlobals(harness);
    let initPromise;

    try {
        initPromise = init();
        assert.equal(harness.fetchCallCount, 1);
        assert.ok(getCustomGroup(harness.vertexSelect));
        assert.equal(harness.eventSource.listenerCount, 6);

        destroy();

        assert.equal(getCustomGroup(harness.vertexSelect), null);
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);

        deferredResponse.resolve(createResponse());
        await initPromise;

        assert.equal(
            harness.documentRef.querySelector('#cmr_settings'),
            null,
            'destroy 뒤 완료된 fetch가 UI를 되살리면 안 된다',
        );
        assert.equal(getCustomGroup(harness.vertexSelect), null);
        assert.equal(harness.eventSource.listenerCount, 0);
    } finally {
        deferredResponse.resolve(createResponse());
        await initPromise?.catch(() => undefined);
        destroy();
        restoreGlobals();
    }
});
