import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { destroy, init } from '../index.js';
import { getCustomGroup } from '../src/model-select.js';
import { getProvider, getProviders } from '../src/providers.js';
import {
    createExternalIntegrationController,
    createExternalTargetId,
} from '../src/external-integrations.js';
import { EXTERNAL_SETTINGS_MAX_TARGETS } from '../src/external-settings.js';

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
        this.clickCallCount = 0;
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
            this.ownerDocument?.notifyMutation?.(this, { addedNodes: children, removedNodes: [] });
        }
    }

    prepend(child) {
        child.remove();
        child.parentElement = this;
        this.children.unshift(child);
        this.ownerDocument?.notifyMutation?.(this, { addedNodes: [child], removedNodes: [] });
    }

    replaceChildren(...children) {
        const removedChildren = [...this.children];
        for (const child of removedChildren) {
            child.parentElement = null;
        }
        this.children = [];
        for (const child of children) {
            child.remove();
            child.parentElement = this;
            this.children.push(child);
        }
        this.ownerDocument?.notifyMutation?.(this, { addedNodes: children, removedNodes: removedChildren });
    }

    remove() {
        if (!this.parentElement) {
            return;
        }
        const formerParent = this.parentElement;
        formerParent.children = formerParent.children.filter(child => child !== this);
        this.parentElement = null;
        this.ownerDocument?.notifyMutation?.(formerParent, { addedNodes: [], removedNodes: [this] });
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
        const attributeName = String(name);
        const attributeValue = String(value);
        this.attributes.set(attributeName, attributeValue);
        const dataMatch = attributeName.match(/^data-([a-z0-9-]+)$/i);
        if (dataMatch) {
            const key = dataMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            this.dataset[key] = attributeValue;
        }
    }

    getAttribute(name) {
        const attributeName = String(name);
        const dataMatch = attributeName.match(/^data-([a-z0-9-]+)$/i);
        if (dataMatch) {
            const key = dataMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            if (Object.hasOwn(this.dataset, key)) {
                return this.dataset[key];
            }
        }
        return this.attributes.get(attributeName) ?? null;
    }

    removeAttribute(name) {
        const attributeName = String(name);
        this.attributes.delete(attributeName);
        const dataMatch = attributeName.match(/^data-([a-z0-9-]+)$/i);
        if (dataMatch) {
            const key = dataMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            delete this.dataset[key];
        }
    }

    focus() {
        this.focusCallCount += 1;
        this.ownerDocument.activeElement = this;
    }

    scrollIntoView() {
        this.scrollIntoViewCallCount += 1;
    }

    click() {
        this.clickCallCount += 1;
        this.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    }

    contains(element) {
        return element === this || this.children.some(child => child.contains(element));
    }

    matches(selector) {
        const selectors = String(selector).split(',').map(item => item.trim()).filter(Boolean);
        if (selectors.length > 1) {
            return selectors.some(item => this.matches(item));
        }
        selector = selectors[0] ?? '';
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }
        if (selector.startsWith('.')) {
            return this.classList.contains(selector.slice(1));
        }
        const dataMatch = selector.match(/^(?:([a-z][a-z0-9-]*))?\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/i);
        if (dataMatch) {
            if (dataMatch[1] && this.tagName !== dataMatch[1].toUpperCase()) {
                return false;
            }
            const key = dataMatch[2].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            return Object.hasOwn(this.dataset, key)
                && (dataMatch[3] === undefined || this.dataset[key] === dataMatch[3]);
        }
        const attributeMatch = selector.match(/^(?:([a-z][a-z0-9-]*))?\[([a-z][a-z0-9_-]*)(?:="([^"]*)")?\]$/i);
        if (attributeMatch) {
            if (attributeMatch[1] && this.tagName !== attributeMatch[1].toUpperCase()) {
                return false;
            }
            const value = this.getAttribute(attributeMatch[2]);
            return value !== null && (attributeMatch[3] === undefined || value === attributeMatch[3]);
        }
        return /^[a-z][a-z0-9-]*$/i.test(selector) && this.tagName === selector.toUpperCase();
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

    querySelectorAll(selector) {
        const matches = [];
        if (this.matches(selector)) {
            matches.push(this);
        }
        for (const child of this.children) {
            matches.push(...child.querySelectorAll(selector));
        }
        return matches;
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
        this.nodeType = 9;
        this.defaultView = { Event: FakeEvent };
        this.body = new FakeElement('body', this);
        this.documentElement = this.body;
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

    querySelectorAll(selector) {
        return this.body.querySelectorAll(selector);
    }

    getElementById(id) {
        return this.querySelector(`#${id}`);
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
        compatibility.hidden = true;

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

        const runDiagnostics = this.createElement('button');
        runDiagnostics.id = 'cmr_run_diagnostics';
        const copyDiagnostics = this.createElement('button');
        copyDiagnostics.id = 'cmr_copy_diagnostics';
        const exportBackup = this.createElement('button');
        exportBackup.id = 'cmr_export_backup';
        const importBackup = this.createElement('input');
        importBackup.id = 'cmr_import_backup';
        const diagnosticSummary = this.createElement('div');
        diagnosticSummary.id = 'cmr_diagnostic_summary';
        const diagnosticList = this.createElement('ul');
        diagnosticList.id = 'cmr_diagnostic_list';
        root.append(
            provider,
            providerHelp,
            compatibility,
            addForm,
            feedback,
            listTitle,
            count,
            modelList,
            runDiagnostics,
            copyDiagnostics,
            exportBackup,
            importBackup,
            diagnosticSummary,
            diagnosticList,
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

function createPortableBackup(modelId) {
    return JSON.stringify({
        format: 'custom-model-router-portable-settings',
        schemaVersion: 1,
        createdAt: '2026-08-18T00:00:00.000Z',
        registry: {
            schemaVersion: 2,
            models: [createModelRecord('vertexai', modelId)],
            selectedModels: { vertexai: modelId },
        },
        purposeRoutes: { schemaVersion: 1, routes: {} },
    });
}

function createPortableV2Backup({
    providerId,
    modelId,
    targetId,
    purposeRoutes = { schemaVersion: 1, routes: {} },
}) {
    return JSON.stringify({
        format: 'custom-model-router-portable-settings',
        schemaVersion: 2,
        createdAt: '2026-08-18T00:00:00.000Z',
        registry: {
            schemaVersion: 2,
            models: [createModelRecord(providerId, modelId)],
            selectedModels: { [providerId]: modelId },
        },
        purposeRoutes,
        externalIntegrations: {
            schemaVersion: 1,
            mappings: { [targetId]: providerId },
            selectedModels: { [targetId]: { [providerId]: modelId } },
        },
    });
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
        customModelRouterRouting: { schemaVersion: 1, routes: {} },
        disabledExtensions: [],
        connectionManager: {
            profiles: [{ id: 'profile-vertex', name: 'Vertex 보조', api: 'vertexai', model: 'native' }],
        },
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
    const routingCalls = [];

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
        CONNECT_API_MAP: {
            vertexai: { selected: 'openai', source: 'vertexai' },
        },
        ConnectionManagerRequestService: {
            getProfile(profileId) {
                const profile = extensionSettings.connectionManager.profiles.find(item => item.id === profileId);
                if (!profile) {
                    throw new Error('profile not found');
                }
                return profile;
            },
            validateProfile(profile) {
                return context.CONNECT_API_MAP[profile.api];
            },
            async sendRequest(...args) {
                routingCalls.push(args);
                return { content: 'CMR_OK' };
            },
        },
    };

    const observers = [];
    let mutationCallbackCount = 0;
    let mutationDeliveryScheduled = false;
    const pendingMutationRecords = [];
    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.callbackCount = 0;
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

    documentRef.notifyMutation = (target, details = {}) => {
        if (!observers.some(candidate => candidate.target?.contains(target))) {
            return;
        }
        pendingMutationRecords.push({
            type: details.type ?? 'childList',
            target,
            addedNodes: details.addedNodes ?? [],
            removedNodes: details.removedNodes ?? [],
        });
        if (mutationDeliveryScheduled) {
            return;
        }
        mutationDeliveryScheduled = true;
        queueMicrotask(() => {
            mutationDeliveryScheduled = false;
            const recordsToDeliver = pendingMutationRecords.splice(0);
            for (const candidate of observers) {
                const records = recordsToDeliver.filter(record => candidate.target?.contains(record.target));
                if (records.length) {
                    mutationCallbackCount += 1;
                    candidate.callbackCount += 1;
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
        routingCalls,
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

function installConfirm(implementation) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'confirm');
    Object.defineProperty(globalThis, 'confirm', {
        configurable: true,
        writable: true,
        value: implementation,
    });
    return () => {
        if (descriptor) {
            Object.defineProperty(globalThis, 'confirm', descriptor);
        } else {
            delete globalThis.confirm;
        }
    };
}

function installDownloadEnvironment() {
    const keys = ['Blob', 'URL'];
    const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const blobs = [];
    const revokedUrls = [];
    class FakeBlob {
        constructor(parts, options = {}) {
            this.parts = [...parts];
            this.type = options.type ?? '';
            this.size = this.parts.reduce((total, part) => total + String(part).length, 0);
            blobs.push(this);
        }

        async text() {
            return this.parts.map(part => String(part)).join('');
        }
    }
    const OriginalURL = globalThis.URL;
    class FakeURL extends OriginalURL {}
    FakeURL.createObjectURL = (blob) => {
        return `blob:cmr-test-${blobs.indexOf(blob)}`;
    };
    FakeURL.revokeObjectURL = (url) => {
        revokedUrls.push(url);
    };
    Object.defineProperties(globalThis, {
        Blob: { configurable: true, writable: true, value: FakeBlob },
        URL: { configurable: true, writable: true, value: FakeURL },
    });
    return {
        blobs,
        revokedUrls,
        restore() {
            for (const [key, descriptor] of descriptors) {
                if (descriptor) {
                    Object.defineProperty(globalThis, key, descriptor);
                } else {
                    delete globalThis[key];
                }
            }
        },
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

function appendExternalModelSelect(harness, {
    containerId = 'third_party_extension',
    selectId = 'third_party_model',
    label = '외부 확장 모델',
    options = ['native-external-model'],
    attributes = {},
} = {}) {
    const container = harness.documentRef.createElement('section');
    container.id = containerId;
    container.className = 'extension_container';
    const labelElement = harness.documentRef.createElement('label');
    labelElement.textContent = label;
    labelElement.setAttribute('for', selectId);
    const select = harness.documentRef.createElement('select');
    select.id = selectId;
    select.setAttribute('name', 'model');
    for (const [name, value] of Object.entries(attributes)) {
        select.setAttribute(name, value);
    }
    for (const value of options) {
        const option = harness.documentRef.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
    }
    select.value = options[0] ?? '';
    const eventCounts = { input: 0, change: 0 };
    const extensionState = { model: select.value };
    for (const eventName of ['input', 'change']) {
        select.addEventListener(eventName, () => {
            eventCounts[eventName] += 1;
            extensionState.model = select.value;
        });
    }
    container.append(labelElement, select);
    harness.documentRef.body.append(container);
    return { container, select, eventCounts, extensionState };
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
        assert.equal(harness.observers.length, 2);
        assert.ok(harness.observers.some(observer => observer.target === harness.observerRoot));
        assert.ok(harness.observers.some(observer => observer.target === harness.documentRef.body));
        assert.equal(globalThis.CustomModelRouter.apiVersion, '1.1.0');
        assert.equal(globalThis.CustomModelRouter.extensionVersion, '0.6.4');
        assert.equal(globalThis.CustomModelRouter.routing.apiVersion, '1.0.0');
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
        assert.equal(panel.querySelector('#cmr_compatibility').hidden, true);
        assert.equal(panel.querySelector('#cmr_compatibility').textContent, '');
        assert.equal(findActionButton(panel, 'select', VERTEX_MODEL_ID, 'vertexai'), null);
        assert.ok(findActionButton(panel, 'delete', VERTEX_MODEL_ID, 'vertexai'));
        assert.equal(panel.querySelector('#cmr_external_section'), null);
        assert.equal(panel.querySelector('#cmr_routing_section'), null);
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
        assert.ok(harness.observers.every(observer => observer.target === null));
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

test('공개 API도 SillyTavern select에서 현재 사용 중인 사용자 모델 등록 해제를 막는다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const vertexSelect = harness.controls.get('vertexai');
    try {
        await init();
        assert.equal(vertexSelect.value, VERTEX_MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, VERTEX_MODEL_ID);

        assert.throws(
            () => globalThis.CustomModelRouter.unregisterModel('vertexai', VERTEX_MODEL_ID),
            error => error?.code === 'model_in_use',
        );
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', VERTEX_MODEL_ID));
        assert.equal(vertexSelect.value, VERTEX_MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, VERTEX_MODEL_ID);

        const nativeModelId = getProvider('vertexai').fallbackModelIds[0];
        vertexSelect.value = nativeModelId;
        vertexSelect.dispatchEvent(new FakeEvent('change', { bubbles: true, isTrusted: true }));
        await flushMicrotasks(8);
        assert.equal(globalThis.CustomModelRouter.unregisterModel('vertexai', VERTEX_MODEL_ID), true);
        await flushMicrotasks(8);
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', VERTEX_MODEL_ID), null);
        assert.equal(vertexSelect.value, nativeModelId);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, nativeModelId);
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
        const coreObserver = harness.observers.find(observer => observer.target === harness.observerRoot);
        assert.ok(coreObserver);
        const initialCoreCallbacks = coreObserver.callbackCount;
        count.textContent = '999';
        await flushMicrotasks();
        assert.equal(count.textContent, '1');
        assert.ok(coreObserver.callbackCount <= initialCoreCallbacks + 2);
        const settledCoreCallbacks = coreObserver.callbackCount;
        await flushMicrotasks(8);
        assert.equal(coreObserver.callbackCount, settledCoreCallbacks);
        assert.equal(coreObserver.target, harness.observerRoot);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('일반 라우팅 UI를 제거해도 저장 경로와 공개 API 실행은 보존되고 메인 모델을 바꾸지 않는다', async () => {
    const harness = createHarness();
    harness.context.extensionSettings.customModelRouterRouting = {
        schemaVersion: 1,
        routes: {
            translation: {
                provider: 'vertexai',
                modelId: VERTEX_MODEL_ID,
                adapterId: 'sillytavern.connection-profile',
                connectionProfileId: 'profile-vertex',
            },
        },
    };
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const mainSettingsBefore = structuredClone(harness.context.chatCompletionSettings);

        assert.equal(panel.querySelector('#cmr_routing_section'), null);
        assert.equal(panel.querySelector('#cmr_route_form'), null);
        panel.querySelector('#cmr_run_diagnostics').dispatchEvent(new FakeEvent('click'));
        assert.ok(panel.querySelector('#cmr_diagnostic_list').children.length >= 5);
        assert.match(panel.querySelector('#cmr_diagnostic_summary').textContent, /호환성 검사/);

        assert.deepEqual(globalThis.CustomModelRouter.routing.getRoute('translation'), {
            provider: 'vertexai',
            modelId: VERTEX_MODEL_ID,
            adapterId: 'sillytavern.connection-profile',
            connectionProfileId: 'profile-vertex',
        });
        assert.equal(harness.context.extensionSettings.customModelRouterRouting.routes.translation.modelId, VERTEX_MODEL_ID);

        assert.deepEqual(await globalThis.CustomModelRouter.routing.execute('translation', {
            prompt: 'Reply with exactly CMR_OK.',
            maxTokens: 24,
            stream: false,
        }), { content: 'CMR_OK' });
        assert.equal(harness.routingCalls.length, 1);
        assert.equal(harness.routingCalls[0][0], 'profile-vertex');
        assert.deepEqual(harness.routingCalls[0][4], { model: VERTEX_MODEL_ID });
        assert.deepEqual(harness.context.chatCompletionSettings, mainSettingsBefore);
        assert.equal(globalThis.CustomModelRouter.routing.getRoute('translation').modelId, VERTEX_MODEL_ID);
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

test('Vertex 모델 카드는 등록과 삭제만 제공하며 등록만으로 현재 모델을 바꾸지 않는다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const vertexSelect = harness.controls.get('vertexai');
    try {
        await init();
        const panel = openPanel(harness);
        const input = panel.querySelector('#cmr_model_id');
        const feedback = panel.querySelector('#cmr_feedback');
        const addedModelId = 'gemini-4-flash-preview';
        const currentModelBefore = vertexSelect.value;
        const configuredModelBefore = harness.context.chatCompletionSettings.vertexai_model;
        const selectedModelBefore = harness.context.extensionSettings.customModelRouter.selectedModels.vertexai;

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
        assert.equal(findActionButton(modelList, 'select', addedModelId, 'vertexai'), null);
        assert.ok(findActionButton(modelList, 'delete', addedModelId, 'vertexai'));
        assert.equal(vertexSelect.value, currentModelBefore);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, configuredModelBefore);
        assert.equal(
            harness.context.extensionSettings.customModelRouter.selectedModels.vertexai,
            selectedModelBefore,
        );

        findActionButton(modelList, 'delete', addedModelId, 'vertexai')
            .dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '이 제공업체 1개 · 전체 1개');
        assert.equal(findActionButton(panel, 'delete', addedModelId, 'vertexai'), null);
        assert.deepEqual(
            getCustomGroup(vertexSelect, 'vertexai').children.map(option => option.value),
            [VERTEX_MODEL_ID],
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

test('호환되는 현재·비활성 연결 안내는 숨기고 모델 컨트롤 누락 오류만 구분해 표시한다', async () => {
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
        const status = panel.querySelector('#cmr_compatibility');
        assert.equal(status.hidden, true);
        assert.equal(status.textContent, '');

        choosePanelProvider(panel, 'zai');
        assert.equal(panel.querySelector('#cmr_model_label').textContent, 'Z.AI (GLM) 모델 ID');
        assert.equal(status.hidden, true);
        assert.equal(status.textContent, '');
        assert.equal(findActionButton(panel, 'select', zaiModel, 'zai'), null);
        assert.equal(harness.context.chatCompletionSettings.zai_model, '');

        harness.controls.get('zai').remove();
        choosePanelProvider(panel, 'zai');
        assert.equal(status.hidden, false);
        assert.equal(status.dataset.state, 'error');
        assert.match(status.textContent, /Z\.AI \(GLM\) 모델 선택기를 찾지 못했습니다\./);

        harness.controls.get('custom').remove();
        choosePanelProvider(panel, 'custom');
        assert.equal(status.hidden, false);
        assert.equal(status.dataset.state, 'error');
        assert.match(status.textContent, /Custom OpenAI-compatible 모델 입력란을 찾지 못했습니다\./);

        choosePanelProvider(panel, 'vertexai');
        assert.equal(status.hidden, true);
        assert.equal(status.textContent, '');
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('등록 모델 카드는 활성 연결에서도 모델 적용 동작을 노출하지 않는다', async () => {
    const previousModel = 'vendor/not-present-in-selector';
    const rejectedModel = 'vendor/rejected-chat-model';
    const harness = createHarness({
        models: [createModelRecord('openrouter', rejectedModel)],
        selectedModels: {},
        configuredModels: { openrouter: previousModel },
        activeSource: 'openrouter',
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const select = harness.controls.get('openrouter');
    try {
        await init();
        const panel = openPanel(harness);
        const previousControlValue = select.value;
        assert.equal(previousControlValue, '');
        assert.equal(findActionButton(panel, 'select', rejectedModel, 'openrouter'), null);
        assert.ok(findActionButton(panel, 'delete', rejectedModel, 'openrouter'));

        assert.equal(select.value, previousControlValue);
        assert.equal(harness.context.chatCompletionSettings.openrouter_model, previousModel);
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.openrouter, undefined);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Z.AI 모델 등록은 native 선택을 바꾸지 않고 native 전환 추적과 삭제는 유지한다', async () => {
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
        assert.equal(panel.querySelector('#cmr_compatibility').hidden, true);

        const input = panel.querySelector('#cmr_model_id');
        input.value = glmModel;
        panel.querySelector('#cmr_add_form').dispatchEvent(new FakeEvent('submit'));
        assert.equal(findActionButton(panel, 'select', glmModel, 'zai'), null);
        assert.ok(findActionButton(panel, 'delete', glmModel, 'zai'));
        assert.equal(zaiSelect.value, '');
        assert.equal(harness.context.chatCompletionSettings.zai_model, '');
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.zai, undefined);

        zaiSelect.value = glmModel;
        zaiSelect.dispatchEvent(new FakeEvent('change', { isTrusted: true }));
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

test('Custom OpenAI-compatible 모델 등록은 native input 값과 이벤트를 건드리지 않는다', async () => {
    const customModel = 'vendor/glm-5:fast';
    const harness = createHarness({ models: [], selectedModels: {}, activeSource: 'custom' });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        assert.equal(panel.querySelector('#cmr_provider').value, 'custom');
        const input = panel.querySelector('#cmr_model_id');
        input.value = customModel;
        const before = harness.nativeEventCounts.get('custom');
        panel.querySelector('#cmr_add_form').dispatchEvent(new FakeEvent('submit'));
        assert.equal(findActionButton(panel, 'select', customModel, 'custom'), null);
        assert.ok(findActionButton(panel, 'delete', customModel, 'custom'));
        assert.equal(harness.nativeEventCounts.get('custom'), before);
        assert.equal(harness.controls.get('custom').value, '');
        assert.equal(harness.context.chatCompletionSettings.custom_model, '');
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.custom, undefined);

        findActionButton(panel, 'delete', customModel, 'custom')
            .dispatchEvent(new FakeEvent('click', { bubbles: true }));
        assert.equal(harness.controls.get('custom').value, '');
        assert.equal(harness.context.chatCompletionSettings.custom_model, '');
        assert.equal(harness.context.extensionSettings.customModelRouter.selectedModels.custom, undefined);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /등록을 삭제/);
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

test('미래 Registry 스키마는 자동 하향 변환하지 않고 초기화를 안전하게 중단한다', async () => {
    const storedSettings = { schemaVersion: 999, models: [], selectedModels: {} };
    const harness = createHarness({ storedSettings });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await assert.rejects(init(), /미래 스키마 저장값/);
        assert.equal(harness.context.extensionSettings.customModelRouter, storedSettings);
        assert.equal(globalThis.CustomModelRouter, undefined);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('미래 외부 연결 스키마는 초기화를 원자적으로 중단하고 정상 설정 교체 뒤 재시도할 수 있다', async () => {
    const futureExternal = { schemaVersion: 999, mappings: {}, selectedModels: {} };
    const harness = createHarness();
    harness.context.extensionSettings.customModelRouterExternalIntegrations = futureExternal;
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await assert.rejects(init(), /외부 확장 연결 설정 schema v999/);
        assert.equal(harness.context.extensionSettings.customModelRouterExternalIntegrations, futureExternal);
        assert.equal(globalThis.CustomModelRouter, undefined);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 0);

        harness.context.extensionSettings.customModelRouterExternalIntegrations = {
            schemaVersion: 1,
            mappings: {},
            selectedModels: {},
        };
        await init();
        assert.equal(globalThis.CustomModelRouter.apiVersion, '1.1.0');
        assert.equal(harness.eventSource.listenerCount, 7);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 2);
        assert.deepEqual(harness.context.extensionSettings.customModelRouterExternalIntegrations, {
            schemaVersion: 1,
            mappings: {},
            selectedModels: {},
        });
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('SETTINGS_UPDATED는 미래 스키마를 원자적으로 거부하고 다음 정상 설정은 반영한다', async () => {
    const nextModelId = 'gemini-4-pro-preview';
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await init();
        const panel = openPanel(harness);
        const initialSaveCallCount = harness.saveCallCount;
        const futureSettings = harness.context.extensionSettings.customModelRouter;
        futureSettings.schemaVersion = 999;
        const rejectedRoutes = {
            schemaVersion: 1,
            routes: {
                translation: {
                    provider: 'vertexai',
                    modelId: nextModelId,
                    adapterId: 'sillytavern.connection-profile',
                    connectionProfileId: 'profile-vertex',
                },
            },
        };
        harness.context.extensionSettings.customModelRouterRouting = rejectedRoutes;

        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks();

        assert.equal(harness.context.extensionSettings.customModelRouter, futureSettings);
        assert.equal(harness.context.extensionSettings.customModelRouter.schemaVersion, 999);
        assert.equal(harness.context.extensionSettings.customModelRouterRouting, rejectedRoutes);
        assert.equal(harness.saveCallCount, initialSaveCallCount);
        assert.deepEqual(
            globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id),
            [VERTEX_MODEL_ID],
        );
        assert.equal(globalThis.CustomModelRouter.routing.getRoute('translation'), null);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /future_registry_schema/);

        const acceptedSettings = {
            schemaVersion: 2,
            models: [createModelRecord('vertexai', nextModelId)],
            selectedModels: { vertexai: nextModelId },
        };
        const futureRoutes = { schemaVersion: 999, routes: {} };
        harness.context.extensionSettings.customModelRouter = acceptedSettings;
        harness.context.extensionSettings.customModelRouterRouting = futureRoutes;
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks();

        assert.equal(harness.context.extensionSettings.customModelRouter, acceptedSettings);
        assert.equal(harness.context.extensionSettings.customModelRouterRouting, futureRoutes);
        assert.equal(harness.saveCallCount, initialSaveCallCount);
        assert.deepEqual(
            globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id),
            [VERTEX_MODEL_ID],
        );
        assert.equal(globalThis.CustomModelRouter.routing.getRoute('translation'), null);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /future_routes_schema/);

        const acceptedRoutes = structuredClone(rejectedRoutes);
        harness.context.extensionSettings.customModelRouter = acceptedSettings;
        harness.context.extensionSettings.customModelRouterRouting = acceptedRoutes;
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks();

        assert.deepEqual(
            globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id),
            [nextModelId],
        );
        assert.deepEqual(globalThis.CustomModelRouter.routing.getRoute('translation'), {
            provider: 'vertexai',
            modelId: nextModelId,
            adapterId: 'sillytavern.connection-profile',
            connectionProfileId: 'profile-vertex',
        });
        assert.equal(harness.context.extensionSettings.customModelRouter.schemaVersion, 2);
        assert.equal(harness.context.extensionSettings.customModelRouterRouting.schemaVersion, 1);
        assert.equal(harness.saveCallCount, initialSaveCallCount + 1);
    } finally {
        console.error = originalConsoleError;
        await destroy();
        restoreGlobals();
    }
});

test('SETTINGS_UPDATED는 미래 외부 연결 스키마와 함께 온 변경을 모두 거부하고 다음 정상 묶음에서 회복한다', async () => {
    const nextModelId = 'gemini-4-pro-preview';
    const harness = createHarness();
    const external = appendExternalModelSelect(harness, {
        containerId: 'schema_external_extension',
        selectId: 'schema_external_model',
        label: '외부 모델',
        attributes: { 'data-provider': 'vertexai' },
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    harness.context.extensionSettings.customModelRouterExternalIntegrations = {
        schemaVersion: 1,
        mappings: { [targetId]: 'vertexai' },
        selectedModels: {},
    };
    const restoreGlobals = installBrowserGlobals(harness);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await init();
        const panel = openPanel(harness);
        const initialSaveCallCount = harness.saveCallCount;
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.mappings,
            {},
        );
        assert.ok(external.select.querySelector('[data-cmr-external-group="true"]'));

        const nextRegistry = {
            schemaVersion: 2,
            models: [createModelRecord('vertexai', nextModelId)],
            selectedModels: { vertexai: nextModelId },
        };
        const nextRoutes = {
            schemaVersion: 1,
            routes: {
                summary: {
                    provider: 'vertexai',
                    modelId: nextModelId,
                    adapterId: 'sillytavern.connection-profile',
                    connectionProfileId: 'profile-vertex',
                },
            },
        };
        const futureExternal = { schemaVersion: 999, mappings: {}, selectedModels: {} };
        harness.context.extensionSettings.customModelRouter = nextRegistry;
        harness.context.extensionSettings.customModelRouterRouting = nextRoutes;
        harness.context.extensionSettings.customModelRouterExternalIntegrations = futureExternal;
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);

        assert.equal(harness.context.extensionSettings.customModelRouter, nextRegistry);
        assert.equal(harness.context.extensionSettings.customModelRouterRouting, nextRoutes);
        assert.equal(harness.context.extensionSettings.customModelRouterExternalIntegrations, futureExternal);
        assert.deepEqual(globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id), [VERTEX_MODEL_ID]);
        assert.equal(globalThis.CustomModelRouter.routing.getRoute('summary'), null);
        assert.deepEqual(
            external.select.querySelector('[data-cmr-external-group="true"]').children.map(option => option.value),
            [VERTEX_MODEL_ID],
        );
        assert.equal(harness.saveCallCount, initialSaveCallCount);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /future_schema/);

        const acceptedExternal = {
            schemaVersion: 1,
            mappings: { [targetId]: 'zai' },
            selectedModels: { [targetId]: { vertexai: nextModelId } },
        };
        harness.context.extensionSettings.customModelRouterExternalIntegrations = acceptedExternal;
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);

        assert.deepEqual(globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id), [nextModelId]);
        assert.equal(globalThis.CustomModelRouter.routing.getRoute('summary').modelId, nextModelId);
        assert.deepEqual(harness.context.extensionSettings.customModelRouterExternalIntegrations, {
            schemaVersion: 1,
            mappings: {},
            selectedModels: { [targetId]: { vertexai: nextModelId } },
        });
        assert.deepEqual(
            external.select.querySelector('[data-cmr-external-group="true"]').children.map(option => option.value),
            [nextModelId],
        );
        assert.ok(harness.saveCallCount > initialSaveCallCount);
    } finally {
        console.error = originalConsoleError;
        await destroy();
        restoreGlobals();
    }
});

test('백업 파일 읽기 중 재활성화하면 이전 input 작업이 새 runtime을 덮지 않는다', async () => {
    const importedModelId = 'gemini-stale-file-import';
    const fileText = createDeferred();
    let confirmCallCount = 0;
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const restoreConfirm = installConfirm(() => {
        confirmCallCount += 1;
        return true;
    });
    try {
        await init();
        const oldPanel = openPanel(harness);
        const oldInput = oldPanel.querySelector('#cmr_import_backup');
        oldInput.files = [{ text: () => fileText.promise }];
        oldInput.value = 'stale-backup.json';
        oldInput.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks();

        await destroy();
        await init();
        const newPanel = openPanel(harness);
        assert.notEqual(newPanel.querySelector('#cmr_import_backup'), oldInput);

        fileText.resolve(createPortableBackup(importedModelId));
        await flushMicrotasks(12);

        assert.equal(confirmCallCount, 0);
        assert.equal(oldInput.value, '');
        assert.deepEqual(
            globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id),
            [VERTEX_MODEL_ID],
        );
        assert.equal(
            harness.context.extensionSettings.customModelRouter.models.some(model => model.id === importedModelId),
            false,
        );
    } finally {
        fileText.resolve(createPortableBackup(importedModelId));
        restoreConfirm();
        await destroy();
        restoreGlobals();
    }
});

test('백업 확인창에서 비활성화하면 확인 뒤의 이전 작업이 다음 runtime을 덮지 않는다', async () => {
    const importedModelId = 'gemini-stale-confirm-import';
    let confirmCallCount = 0;
    let destroyPromise = null;
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const restoreConfirm = installConfirm(() => {
        confirmCallCount += 1;
        destroyPromise = destroy();
        return true;
    });
    try {
        await init();
        const panel = openPanel(harness);
        const input = panel.querySelector('#cmr_import_backup');
        input.files = [{ text: async () => createPortableBackup(importedModelId) }];
        input.value = 'confirm-race-backup.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(12);

        assert.equal(confirmCallCount, 1);
        await destroyPromise;
        await init();

        assert.deepEqual(
            globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id),
            [VERTEX_MODEL_ID],
        );
        assert.equal(
            harness.context.extensionSettings.customModelRouter.models.some(model => model.id === importedModelId),
            false,
        );
    } finally {
        restoreConfirm();
        await destroyPromise?.catch(() => undefined);
        await destroy();
        restoreGlobals();
    }
});

test('백업 schema v2는 routing·외부 선택을 보존하되 legacy mapping은 비우고 자동 추론으로 복구한다', async () => {
    const exportedModelId = 'openrouter/exported-helper';
    const importedModelId = 'glm-5-air';
    const harness = createHarness({
        models: [
            createModelRecord('openrouter', exportedModelId),
            createModelRecord('zai', importedModelId),
        ],
        selectedModels: { openrouter: exportedModelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'backup_external_extension',
        selectId: 'backup_external_model',
        label: '외부 모델',
        attributes: { 'data-provider': 'openrouter' },
    });
    external.select.value = '';
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    harness.context.extensionSettings.customModelRouterExternalIntegrations = {
        schemaVersion: 1,
        mappings: { [targetId]: 'openrouter' },
        selectedModels: { [targetId]: { openrouter: exportedModelId } },
    };
    const restoreGlobals = installBrowserGlobals(harness);
    const restoreConfirm = installConfirm(() => true);
    const download = installDownloadEnvironment();
    try {
        await init();
        const panel = openPanel(harness);
        assert.equal(external.select.value, exportedModelId);

        panel.querySelector('#cmr_export_backup').dispatchEvent(new FakeEvent('click'));
        assert.equal(download.blobs.length, 1);
        assert.deepEqual(download.revokedUrls, ['blob:cmr-test-0']);
        const exported = JSON.parse(await download.blobs[0].text());
        assert.equal(exported.schemaVersion, 2);
        assert.deepEqual(exported.externalIntegrations.mappings, {});
        assert.equal(
            exported.externalIntegrations.selectedModels[targetId].openrouter,
            exportedModelId,
        );

        const content = createPortableV2Backup({
            providerId: 'zai',
            modelId: importedModelId,
            targetId,
            purposeRoutes: {
                schemaVersion: 1,
                routes: {
                    summary: {
                        provider: 'zai',
                        modelId: importedModelId,
                        adapterId: 'example.summary',
                        connectionProfileId: 'profile-zai',
                    },
                },
            },
        });
        external.select.value = '';
        external.select.setAttribute('data-provider', 'zai');
        const input = panel.querySelector('#cmr_import_backup');
        input.files = [{ size: content.length, text: async () => content }];
        input.value = 'cmr-v2-backup.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(16);

        const importedExternal = harness.context.extensionSettings.customModelRouterExternalIntegrations;
        assert.deepEqual(importedExternal.mappings, {});
        assert.equal(importedExternal.selectedModels[targetId].zai, importedModelId);
        assert.deepEqual(
            globalThis.CustomModelRouter.getSnapshot().models.map(model => `${model.provider}:${model.id}`),
            [`zai:${importedModelId}`],
        );
        assert.equal(external.select.value, importedModelId);
        const managedGroup = external.select.querySelector('[data-cmr-external-group="true"]');
        assert.equal(managedGroup.dataset.cmrProvider, 'zai');
        assert.deepEqual(managedGroup.children.map(option => option.value), [importedModelId]);
        assert.deepEqual(globalThis.CustomModelRouter.routing.getRoute('summary'), {
            provider: 'zai',
            modelId: importedModelId,
            adapterId: 'example.summary',
            connectionProfileId: 'profile-zai',
        });
        assert.equal(input.value, '');
        assert.match(panel.querySelector('#cmr_feedback').textContent, /복구했습니다/);
    } finally {
        await destroy();
        download.restore();
        restoreConfirm();
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
        assert.ok(modelList.children.every(row => {
            const actions = row.querySelector('.cmr-model-actions');
            return actions?.children.length === 1
                && actions.children[0].dataset.cmrAction === 'delete';
        }));

        const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
        assert.match(css, /\.cmr-model-list\s*\{[\s\S]*?max-block-size:\s*min\(42dvh,\s*22rem\);/);
        assert.match(css, /\.cmr-model-list\s*\{[\s\S]*?overflow-y:\s*auto;/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('범용 연결은 외부 모델 select만 찾아 provider를 자동 추론하고 native 이벤트로 확장 설정을 갱신한다', async () => {
    const harness = createHarness();
    const external = appendExternalModelSelect(harness, {
        containerId: 'translator_extension',
        selectId: 'translator_model',
        label: 'OpenRouter 번역 모델',
        attributes: { 'data-provider': 'openrouter' },
    });
    const unrelated = harness.documentRef.createElement('select');
    unrelated.id = 'translator_theme';
    unrelated.setAttribute('name', 'theme');
    const themeOption = harness.documentRef.createElement('option');
    themeOption.value = 'dark';
    unrelated.append(themeOption);
    harness.documentRef.body.append(unrelated);
    const modelId = 'openrouter/custom-latest';
    const snapshots = [];
    const controller = createExternalIntegrationController({
        root: harness.documentRef,
        documentRef: harness.documentRef,
        observerFactory: callback => new harness.MutationObserver(callback),
        getModels: providerId => providerId === 'openrouter'
            ? [createModelRecord('openrouter', modelId)]
            : [],
        onTargetsChanged: targets => snapshots.push(targets),
    });

    try {
        const targets = controller.start();
        assert.equal(targets.length, 1);
        assert.equal(targets[0].control, external.select);
        assert.equal(targets[0].resolution.providerId, 'openrouter');
        assert.match(targets[0].resolution.source, /^auto:/);
        assert.equal(external.select.value, 'native-external-model');
        assert.equal(unrelated.querySelector('[data-cmr-external-group="true"]'), null);

        const managedGroup = external.select.querySelector('[data-cmr-external-group="true"]');
        assert.ok(managedGroup);
        assert.equal(managedGroup.dataset.cmrProvider, 'openrouter');
        assert.deepEqual(managedGroup.children.map(option => option.value), [modelId]);

        external.select.value = modelId;
        external.select.dispatchEvent(new FakeEvent('input', { bubbles: true }));
        external.select.dispatchEvent(new FakeEvent('change', { bubbles: true }));
        assert.deepEqual(external.eventCounts, { input: 1, change: 1 });
        assert.equal(external.extensionState.model, modelId);
        assert.ok(snapshots.length >= 1);
    } finally {
        controller.destroy();
    }
});

test('범용 연결은 별도 설정 UI 없이 추론한 provider 전환을 따라 관리 옵션을 교체한다', () => {
    const harness = createHarness();
    const external = appendExternalModelSelect(harness, {
        selectId: 'summarizer_model',
        label: 'OpenAI 요약 모델',
        attributes: { 'data-provider': 'openai' },
    });
    const zaiModel = 'glm-5-plus';
    const openaiModel = 'gpt-6-mini';
    const controller = createExternalIntegrationController({
        root: harness.documentRef,
        documentRef: harness.documentRef,
        observerFactory: callback => new harness.MutationObserver(callback),
        getModels: providerId => ({
            zai: [createModelRecord('zai', zaiModel)],
            openai: [createModelRecord('openai', openaiModel)],
        })[providerId] ?? [],
    });

    try {
        let [target] = controller.start();
        assert.equal(target.resolution.providerId, 'openai');
        assert.match(target.resolution.source, /^auto:/);
        assert.deepEqual(
            external.select.querySelector('[data-cmr-external-group="true"]').children.map(option => option.value),
            [openaiModel],
        );

        external.select.setAttribute('data-provider', 'zai');
        [target] = controller.rescan();
        assert.equal(target.resolution.providerId, 'zai');
        assert.match(target.resolution.source, /^auto:/);
        assert.deepEqual(
            external.select.querySelector('[data-cmr-external-group="true"]').children.map(option => option.value),
            [zaiModel],
        );
    } finally {
        controller.destroy();
    }
});

test('범용 연결은 늦은 load와 외부 확장 재렌더를 복구하고 destroy 뒤 예약 작업으로 되살아나지 않는다', async () => {
    const harness = createHarness();
    const modelId = 'gemini-4-flash-preview';
    const controller = createExternalIntegrationController({
        root: harness.documentRef,
        documentRef: harness.documentRef,
        observerFactory: callback => new harness.MutationObserver(callback),
        getModels: providerId => providerId === 'makersuite'
            ? [createModelRecord('makersuite', modelId)]
            : [],
    });

    controller.start();
    assert.equal(controller.getTargets().length, 0);
    const first = appendExternalModelSelect(harness, {
        containerId: 'late_caption_extension',
        selectId: 'caption_model',
        label: 'Gemini 이미지 설명 모델',
    });
    await flushMicrotasks(8);
    assert.equal(controller.getTargets().length, 1);
    assert.ok(first.select.querySelector('[data-cmr-external-group="true"]'));

    first.container.remove();
    const replacement = appendExternalModelSelect(harness, {
        containerId: 'late_caption_extension',
        selectId: 'caption_model',
        label: 'Gemini 이미지 설명 모델',
    });
    await flushMicrotasks(8);
    assert.equal(controller.getTargets().length, 1);
    assert.equal(controller.getTargets()[0].control, replacement.select);
    assert.equal(first.select.querySelector('[data-cmr-external-group="true"]'), null);
    assert.ok(replacement.select.querySelector('[data-cmr-external-group="true"]'));

    const pending = appendExternalModelSelect(harness, {
        containerId: 'pending_caption_extension',
        selectId: 'pending_model',
        label: 'Gemini 보조 모델',
    });
    controller.destroy();
    await flushMicrotasks(8);
    assert.equal(replacement.select.querySelector('[data-cmr-external-group="true"]'), null);
    assert.equal(pending.select.querySelector('[data-cmr-external-group="true"]'), null);
    assert.equal(controller.getTargets().length, 0);
    assert.ok(harness.observers.every(observer => observer.target === null));
});

test('init 범용 자동 연결은 관리 UI 없이 옵션을 주입하고 trusted 선택을 재렌더 target에 복원한다', async () => {
    const modelId = 'openrouter/translator-latest';
    const harness = createHarness({
        models: [createModelRecord('openrouter', modelId)],
        selectedModels: { openrouter: modelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'auto_translator_extension',
        selectId: 'auto_translator_model',
        label: 'OpenRouter 번역 모델',
        attributes: { 'data-provider': 'openrouter' },
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        assert.equal(panel.querySelector('#cmr_external_section'), null);
        assert.equal(panel.querySelector('#cmr_external_list'), null);
        assert.deepEqual(
            external.select.querySelector('[data-cmr-external-group="true"]').children.map(option => option.value),
            [modelId],
        );
        assert.equal(external.select.value, 'native-external-model');

        external.select.value = modelId;
        external.select.dispatchEvent(new FakeEvent('change', { bubbles: true, isTrusted: true }));
        assert.equal(external.extensionState.model, modelId);
        assert.equal(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels[targetId].openrouter,
            modelId,
        );

        external.container.remove();
        const replacement = appendExternalModelSelect(harness, {
            containerId: 'auto_translator_extension',
            selectId: 'auto_translator_model',
            label: 'OpenRouter 번역 모델',
            attributes: { 'data-provider': 'openrouter' },
        });
        replacement.select.value = '';
        await flushMicrotasks(10);

        assert.equal(createExternalTargetId(replacement.select, { documentRef: harness.documentRef }), targetId);
        assert.equal(replacement.select.value, modelId);
        assert.equal(replacement.extensionState.model, modelId);
        assert.equal(replacement.eventCounts.change, 1);
        assert.ok(replacement.select.querySelector('[data-cmr-external-group="true"]'));
        assert.equal(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels[targetId].openrouter,
            modelId,
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('init은 legacy 외부 mapping을 비우고 선택 기록은 보존하며 unknown target은 건너뛴다', async () => {
    const modelId = 'glm-5-air';
    const harness = createHarness({
        models: [createModelRecord('zai', modelId)],
        selectedModels: { zai: modelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'generic_summary_extension',
        selectId: 'summary_model',
        label: '요약 모델',
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    harness.context.extensionSettings.customModelRouterExternalIntegrations = {
        schemaVersion: 1,
        mappings: { [targetId]: 'zai' },
        selectedModels: { [targetId]: { zai: modelId } },
    };
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        assert.equal(panel.querySelector('#cmr_external_section'), null);
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations,
            {
                schemaVersion: 1,
                mappings: {},
                selectedModels: { [targetId]: { zai: modelId } },
            },
        );
        assert.equal(external.select.querySelector('[data-cmr-external-group="true"]'), null);
        assert.ok(harness.saveCallCount >= 1);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('legacy mapping이 한도를 채워도 자동 연결 이관은 선택 기록을 보존한다', async () => {
    const harness = createHarness();
    const mappings = {};
    for (let index = 0; index < EXTERNAL_SETTINGS_MAX_TARGETS; index += 1) {
        mappings[`cmr-ext-${index.toString(16).padStart(8, '0')}`] = 'openai';
    }
    const selectedTarget = 'cmr-ext-00000200';
    harness.context.extensionSettings.customModelRouterExternalIntegrations = {
        schemaVersion: 1,
        mappings,
        selectedModels: {
            [selectedTarget]: { vertexai: 'gemini-future' },
        },
    };
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations,
            {
                schemaVersion: 1,
                mappings: {},
                selectedModels: {
                    [selectedTarget]: { vertexai: 'gemini-future' },
                },
            },
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('오래된 외부 선택 512개가 차도 현재 감지 target 선택을 정리 후 저장한다', async () => {
    const modelId = 'openrouter/translator-latest';
    const harness = createHarness({
        models: [createModelRecord('openrouter', modelId)],
        selectedModels: { openrouter: modelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'capacity_translator_extension',
        selectId: 'capacity_translator_model',
        label: 'OpenRouter 번역 모델',
        attributes: { 'data-provider': 'openrouter' },
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    const staleSelections = {};
    for (let index = 0; Object.keys(staleSelections).length < EXTERNAL_SETTINGS_MAX_TARGETS; index += 1) {
        const candidate = `cmr-ext-${index.toString(16).padStart(8, '0')}`;
        if (candidate !== targetId) {
            staleSelections[candidate] = { openrouter: modelId };
        }
    }
    harness.context.extensionSettings.customModelRouterExternalIntegrations = {
        schemaVersion: 1,
        mappings: {},
        selectedModels: staleSelections,
    };
    const oldestStaleTarget = Object.keys(staleSelections)[0];
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        external.select.value = modelId;
        external.select.dispatchEvent(new FakeEvent('change', { bubbles: true, isTrusted: true }));

        const stored = harness.context.extensionSettings.customModelRouterExternalIntegrations;
        assert.equal(stored.selectedModels[targetId].openrouter, modelId);
        assert.equal(Object.keys(stored.selectedModels).length, EXTERNAL_SETTINGS_MAX_TARGETS);
        assert.equal(stored.selectedModels[oldestStaleTarget], undefined);
        assert.ok(harness.saveCallCount >= 1);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('unknown·비대상 target은 UI 없이 건너뛰고 inferred target과 재활성화 자원만 유지한다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    let autoTarget;
    try {
        await init();
        let panel = openPanel(harness);
        assert.equal(panel.querySelector('#cmr_external_section'), null);
        assert.equal(harness.eventSource.listenerCount, 7);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 2);

        await destroy();
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 0);
        assert.equal(globalThis.CustomModelRouter, undefined);

        autoTarget = appendExternalModelSelect(harness, {
            containerId: 'lifecycle_vertex_extension',
            selectId: 'lifecycle_vertex_model',
            label: 'Vertex AI 외부 모델',
            attributes: { 'data-provider': 'vertexai' },
        });
        const ambiguousText = '모델 <img src=x onerror=globalThis.pwned=true> OpenAI Claude';
        const ambiguousTarget = appendExternalModelSelect(harness, {
            containerId: 'ambiguous_external_extension',
            selectId: 'ambiguous_model',
            label: ambiguousText,
        });
        const excludedTarget = appendExternalModelSelect(harness, {
            containerId: 'image_external_extension',
            selectId: 'image_generation_model',
            label: 'Stable Diffusion 이미지 생성 모델',
        });
        await init();
        panel = openPanel(harness);
        assert.equal(panel.querySelector('#cmr_external_section'), null);
        assert.equal(globalThis.pwned, undefined);
        assert.equal(harness.eventSource.listenerCount, 7);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 2);
        assert.equal(autoTarget.select.listeners.get('change').length, 2);
        assert.ok(autoTarget.select.querySelector('[data-cmr-external-group="true"]'));
        assert.equal(ambiguousTarget.select.querySelector('[data-cmr-external-group="true"]'), null);
        assert.equal(excludedTarget.select.querySelector('[data-cmr-external-group="true"]'), null);
    } finally {
        await destroy();
        if (autoTarget) {
            assert.equal(autoTarget.select.listeners.get('change').length, 1);
            assert.equal(autoTarget.select.querySelector('[data-cmr-external-group="true"]'), null);
        }
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 0);
        delete globalThis.pwned;
        restoreGlobals();
    }
});
