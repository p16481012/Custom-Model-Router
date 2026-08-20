import test from 'node:test';
import assert from 'node:assert/strict';

import { destroy, init } from '../index.js';
import { getCustomGroup } from '../src/model-select.js';
import { getProvider, getProviders } from '../src/providers.js';
import {
    EXTERNAL_INJECTED_OPTION_LIMIT,
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

class FakeCustomEvent extends FakeEvent {
    constructor(type, options = {}) {
        super(type, options);
        this.detail = options.detail;
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
        const descendantParts = String(selector).trim().split(/\s+/).filter(Boolean);
        if (descendantParts.length > 1) {
            const [ancestorSelector, ...rest] = descendantParts;
            const descendantSelector = rest.join(' ');
            for (const ancestor of this.querySelectorAll(ancestorSelector)) {
                const match = ancestor.querySelector(descendantSelector);
                if (match && match !== ancestor) {
                    return match;
                }
            }
            return null;
        }
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
        const descendantParts = String(selector).trim().split(/\s+/).filter(Boolean);
        if (descendantParts.length > 1) {
            const [ancestorSelector, ...rest] = descendantParts;
            const descendantSelector = rest.join(' ');
            return this.querySelectorAll(ancestorSelector).flatMap(ancestor => (
                ancestor.querySelectorAll(descendantSelector).filter(match => match !== ancestor)
            ));
        }
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
        this.defaultView = { Event: FakeEvent, CustomEvent: FakeCustomEvent };
        this.body = new FakeElement('body', this);
        this.documentElement = this.body;
        this.activeElement = null;
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event) {
        event.target = this;
        event.currentTarget = this;
        for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
            listener.call(this, event);
        }
        return !event.defaultPrevented;
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
        const input = this.createElement('textarea');
        input.id = 'cmr_model_id';
        const addButton = this.createElement('button');
        addButton.type = 'submit';
        addButton.className = 'menu_button cmr-add-button cmr-icon-button';
        addButton.title = '모델 등록';
        addButton.setAttribute('aria-label', '입력한 모델 ID 등록');
        const addIcon = this.createElement('i');
        addIcon.className = 'fa-solid fa-plus';
        addIcon.setAttribute('aria-hidden', 'true');
        addButton.append(addIcon);
        const modelHelp = this.createElement('small');
        modelHelp.id = 'cmr_model_help';
        addForm.append(modelLabel, input, addButton, modelHelp);

        const feedback = this.createElement('div');
        feedback.id = 'cmr_feedback';
        const undoDelete = this.createElement('button');
        undoDelete.id = 'cmr_undo_delete';
        undoDelete.hidden = true;
        const listTitle = this.createElement('h3');
        listTitle.id = 'cmr_list_title';
        listTitle.textContent = '전체 등록 모델';
        const count = this.createElement('span');
        count.id = 'cmr_model_count';
        const modelSearchRegion = this.createElement('div');
        modelSearchRegion.id = 'cmr_model_search_region';
        modelSearchRegion.hidden = true;
        const modelSearch = this.createElement('input');
        modelSearch.id = 'cmr_model_search';
        const modelSearchStatus = this.createElement('span');
        modelSearchStatus.id = 'cmr_model_search_status';
        modelSearchRegion.append(modelSearch, modelSearchStatus);
        const modelList = this.createElement('ul');
        modelList.id = 'cmr_model_list';

        const externalWarning = this.createElement('aside');
        externalWarning.id = 'cmr_external_warning';
        externalWarning.hidden = true;
        const externalWarningText = this.createElement('span');
        externalWarningText.id = 'cmr_external_warning_text';
        const externalWarningOpen = this.createElement('button');
        externalWarningOpen.id = 'cmr_external_warning_open';
        externalWarning.append(externalWarningText, externalWarningOpen);

        const operationsSection = this.createElement('details');
        operationsSection.id = 'cmr_operations_section';
        const operationsSummary = this.createElement('summary');
        operationsSummary.textContent = '호환성 진단 및 CMR 설정 백업';
        const externalAdvanced = this.createElement('details');
        externalAdvanced.id = 'cmr_external_advanced';
        const externalAdvancedSummary = this.createElement('summary');
        externalAdvancedSummary.textContent = '고급: 외부 연결 관리';
        const externalCount = this.createElement('span');
        externalCount.id = 'cmr_external_count';
        const externalStatus = this.createElement('div');
        externalStatus.id = 'cmr_external_status';
        const externalList = this.createElement('ul');
        externalList.id = 'cmr_external_list';
        const externalPicker = this.createElement('details');
        externalPicker.id = 'cmr_external_picker';
        const externalPickerSummary = this.createElement('summary');
        externalPickerSummary.textContent = '문제가 있는 연결 직접 제외';
        const externalPickerList = this.createElement('ul');
        externalPickerList.id = 'cmr_external_picker_list';
        externalPicker.append(externalPickerSummary, externalPickerList);
        externalAdvanced.append(
            externalAdvancedSummary,
            externalCount,
            externalStatus,
            externalList,
            externalPicker,
        );

        const runDiagnostics = this.createElement('button');
        runDiagnostics.id = 'cmr_run_diagnostics';
        const copyDiagnostics = this.createElement('button');
        copyDiagnostics.id = 'cmr_copy_diagnostics';
        const exportBackup = this.createElement('button');
        exportBackup.id = 'cmr_export_backup';
        const importBackup = this.createElement('input');
        importBackup.id = 'cmr_import_backup';
        const importBackupButton = this.createElement('button');
        importBackupButton.id = 'cmr_import_backup_button';
        const importPreview = this.createElement('section');
        importPreview.id = 'cmr_import_preview';
        importPreview.hidden = true;
        const importPreviewSummary = this.createElement('div');
        importPreviewSummary.id = 'cmr_import_preview_summary';
        const importPreviewList = this.createElement('ul');
        importPreviewList.id = 'cmr_import_preview_list';
        const importPreviewCancel = this.createElement('button');
        importPreviewCancel.id = 'cmr_import_preview_cancel';
        const importPreviewApply = this.createElement('button');
        importPreviewApply.id = 'cmr_import_preview_apply';
        importPreview.append(
            importPreviewSummary,
            importPreviewList,
            importPreviewCancel,
            importPreviewApply,
        );
        const diagnosticSummary = this.createElement('div');
        diagnosticSummary.id = 'cmr_diagnostic_summary';
        const diagnosticList = this.createElement('ul');
        diagnosticList.id = 'cmr_diagnostic_list';
        operationsSection.append(
            operationsSummary,
            runDiagnostics,
            copyDiagnostics,
            exportBackup,
            importBackupButton,
            importBackup,
            importPreview,
            diagnosticSummary,
            diagnosticList,
            externalAdvanced,
        );
        root.append(
            provider,
            providerHelp,
            compatibility,
            addForm,
            feedback,
            undoDelete,
            listTitle,
            count,
            modelSearchRegion,
            modelList,
            externalWarning,
            operationsSection,
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

function createProviderConsumerDescriptor(consumerId, strategies = ['sillytavern-inherited']) {
    return {
        consumerId,
        contractVersion: '1.0.0',
        capabilities: {
            inputSchema: 'cmr.chat-completion/1',
            handlerInstall: 'before-model-publish',
            providerScopedModels: true,
            abortSignal: true,
            streaming: true,
            credentialMode: 'opaque-reference',
            endpointOverride: false,
            mainChatMutation: false,
            silentFallback: false,
            dispose: true,
        },
        slots: [{ slotId: 'chat', strategies }],
    };
}

function createPortableBackup(modelId) {
    return JSON.stringify({
        format: 'custom-model-router-portable-settings',
        schemaVersion: 1,
        createdAt: '2026-08-18T00:00:00.000Z',
        registry: {
            schemaVersion: 2,
            models: [
                createModelRecord('vertexai', VERTEX_MODEL_ID),
                createModelRecord('vertexai', modelId),
            ],
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
    excludedTargets = {},
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
            schemaVersion: 2,
            mappings: {},
            selectedModels: { [targetId]: { [providerId]: modelId } },
            excludedTargets,
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
    popupShowMode = 'promise',
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
        CONNECTION_PROFILE_CREATED: 'profile_created',
        CONNECTION_PROFILE_LOADED: 'profile_loaded',
        CONNECTION_PROFILE_UPDATED: 'profile_updated',
        CONNECTION_PROFILE_DELETED: 'profile_deleted',
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
            this.closeButton = documentRef.createElement('button');
            this.closeButton.className = 'popup-button-close';
            this.closeButton.setAttribute('aria-label', '닫기');
            this.closeButton.addEventListener('click', () => {
                void this.completeCancelled();
            });
            const popupContent = documentRef.createElement('div');
            popupContent.className = 'popup-content';
            popupContent.append(content);
            this.dlg.append(this.closeButton, popupContent);
            this.completion = createDeferred();
            popupInstances.push(this);
        }

        show() {
            this.showCallCount += 1;
            documentRef.body.append(this.dlg);
            if (popupShowError) {
                if (popupShowMode === 'throw') {
                    throw popupShowError;
                }
                return Promise.reject(popupShowError);
            }
            if (popupShowMode === 'non-promise') {
                return undefined;
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

function appendExternalModelInput(harness, {
    containerId = 'third_party_input_extension',
    inputId = 'third_party_model_input',
    label = '외부 확장 모델 입력란',
} = {}) {
    const container = harness.documentRef.createElement('section');
    container.id = containerId;
    container.className = 'extension_container';
    const labelElement = harness.documentRef.createElement('label');
    labelElement.textContent = label;
    labelElement.setAttribute('for', inputId);
    const input = harness.documentRef.createElement('input');
    input.id = inputId;
    input.type = 'text';
    input.setAttribute('name', 'model');
    const extensionState = { model: '' };
    let inputCount = 0;
    input.addEventListener('input', () => {
        inputCount += 1;
        extensionState.model = input.value;
    });
    container.append(labelElement, input);
    harness.documentRef.body.append(container);
    return { container, input, extensionState, get inputCount() { return inputCount; } };
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
        assert.equal(launcher.children.length, 1);
        assert.equal(launcher.children[0].className, 'fa-solid fa-route');
        assert.equal(launcher.children[0].getAttribute('aria-hidden'), 'true');
        assert.equal(launcher.querySelector('.cmr-launcher-count'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.fetchCallCount, 1);
        assert.equal(harness.eventSource.onCalls.length, 10);
        assert.equal(harness.eventSource.listenerCount, 10);
        assert.equal(harness.observers.length, 2);
        assert.ok(harness.observers.some(observer => observer.target === harness.observerRoot));
        assert.ok(harness.observers.some(observer => observer.target === harness.documentRef.body));
        assert.equal(globalThis.CustomModelRouter.apiVersion, '1.2.0');
        assert.equal(globalThis.CustomModelRouter.extensionVersion, '0.6.16');
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
        assert.equal(popup.dlg.querySelectorAll('.popup-button-close').length, 1);
        assert.equal(popup.closeButton.parentElement, popup.dlg);
        assert.equal(panel.querySelector('.popup-button-close'), null);
        assert.equal(popup.closeButton.getAttribute('role'), 'button');
        assert.equal(popup.closeButton.getAttribute('tabindex'), '0');
        assert.equal(popup.closeButton.getAttribute('aria-label'), '모델 관리 닫기');
        assert.equal(harness.context.mainApi, 'openai');
        assert.equal(harness.context.chatCompletionSettings.chat_completion_source, 'vertexai');
        assert.equal(panel.querySelector('#cmr_provider').options.length, 24);
        assert.equal(panel.querySelector('#cmr_provider').value, 'vertexai');
        assert.equal(panel.querySelector('#cmr_model_label').textContent, 'Google Vertex AI 모델 ID');
        assert.match(panel.querySelector('#cmr_model_help').textContent, /모델 경로 한 구간/);
        assert.match(panel.querySelector('#cmr_model_help').textContent, /\.\n\S/, '동적 제공업체 도움말도 문장 종결부호 뒤에서 줄을 바꾼다');
        assert.equal(panel.querySelector('#cmr_list_title').textContent, '전체 등록 모델');
        assert.equal(panel.querySelector('#cmr_model_list').children.length, 1);
        assert.equal(panel.querySelector('#cmr_model_list').children[0].className, 'cmr-provider-group');
        assert.equal(panel.querySelectorAll('.cmr-model-row').length, 1);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 1곳 · 모델 1개');
        assert.equal(panel.querySelector('#cmr_model_list').dataset.scrollable, 'false');
        assert.equal(panel.querySelector('#cmr_model_list').getAttribute('tabindex'), null);
        assert.equal(panel.querySelector('#cmr_compatibility').hidden, true);
        assert.equal(panel.querySelector('#cmr_compatibility').textContent, '');
        assert.equal(findActionButton(panel, 'select', VERTEX_MODEL_ID, 'vertexai'), null);
        assert.ok(findActionButton(panel, 'delete', VERTEX_MODEL_ID, 'vertexai'));
        assert.ok(!panel.querySelector('#cmr_external_section'));
        assert.equal(panel.querySelector('#cmr_external_warning').hidden, true);
        assert.ok(panel.querySelector('#cmr_operations_section'));
        assert.ok(panel.querySelector('#cmr_external_advanced'));
        const addButton = panel.querySelector('.cmr-add-button');
        assert.equal(addButton.textContent, '');
        assert.equal(addButton.getAttribute('aria-label'), '입력한 모델 ID 등록');
        assert.equal(addButton.querySelector('.fa-plus')?.getAttribute('aria-hidden'), 'true');
        assert.equal(panel.querySelector('#cmr_routing_section'), null);
        assert.equal(launcher.getAttribute('aria-expanded'), 'true');

        launcher.dispatchEvent(new FakeEvent('click'));
        assert.equal(harness.popupInstances.length, 1);
        assert.equal(popup.setAutoFocusCallCount, 1);
        assert.equal(panel.querySelector('#cmr_panel_close'), null);
        assert.equal(popup.closeButton.hidden, false);
        assert.notEqual(popup.closeButton.getAttribute('aria-hidden'), 'true');
        const closeKeyEvent = new FakeEvent('keydown', { key: 'Enter' });
        popup.closeButton.dispatchEvent(closeKeyEvent);
        await flushMicrotasks();
        assert.equal(closeKeyEvent.defaultPrevented, true);
        assert.equal(closeKeyEvent.propagationStopped, true);
        assert.equal(popup.completeCancelledCallCount, 1);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_manager_dialog'), null);
        assert.equal(launcher.getAttribute('aria-expanded'), 'false');
        assert.equal(harness.documentRef.activeElement, launcher);

        openPanel(harness);
        const reopenedPopup = harness.popupInstances[1];
        const closeGate = createDeferred();
        const completeCancelled = reopenedPopup.completeCancelled.bind(reopenedPopup);
        reopenedPopup.completeCancelled = async () => {
            await closeGate.promise;
            return completeCancelled();
        };
        const overlappingDestroy = destroy();
        const overlappingInit = init();
        closeGate.resolve();
        await Promise.all([overlappingDestroy, overlappingInit]);
        assert.ok(globalThis.CustomModelRouter);
        assert.ok(harness.documentRef.querySelector('#cmr_open_manager'));
        assert.equal(harness.eventSource.listenerCount, 10);
        assert.ok(getCustomGroup(vertexSelect, 'vertexai'));

        await destroy();
        assert.equal(globalThis.CustomModelRouter, undefined);
        assert.equal(getCustomGroup(vertexSelect, 'vertexai'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.equal(harness.eventSource.removeCalls.length, 20);
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
        const panel = openPanel(harness);
        assert.equal(vertexSelect.value, VERTEX_MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, VERTEX_MODEL_ID);

        assert.throws(
            () => globalThis.CustomModelRouter.unregisterModel('vertexai', VERTEX_MODEL_ID),
            error => error?.code === 'model_in_use',
        );
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', VERTEX_MODEL_ID));
        assert.equal(vertexSelect.value, VERTEX_MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, VERTEX_MODEL_ID);

        harness.context.extensionSettings.customModelRouter = {
            schemaVersion: 2,
            models: [],
            selectedModels: {},
        };
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', VERTEX_MODEL_ID));
        assert.ok(harness.context.extensionSettings.customModelRouter.models.some(model => (
            model.provider === 'vertexai' && model.id === VERTEX_MODEL_ID
        )));
        assert.equal(vertexSelect.value, VERTEX_MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, VERTEX_MODEL_ID);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /model_in_use/);

        const emptyBackup = JSON.stringify({
            format: 'custom-model-router-portable-settings',
            schemaVersion: 1,
            createdAt: '2026-08-19T00:00:00.000Z',
            registry: { schemaVersion: 2, models: [], selectedModels: {} },
            purposeRoutes: { schemaVersion: 1, routes: {} },
        });
        const importInput = panel.querySelector('#cmr_import_backup');
        importInput.files = [{ size: emptyBackup.length, text: async () => emptyBackup }];
        importInput.value = 'empty-registry-backup.json';
        importInput.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(12);
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', VERTEX_MODEL_ID));
        assert.equal(vertexSelect.value, VERTEX_MODEL_ID);
        assert.equal(harness.context.chatCompletionSettings.vertexai_model, VERTEX_MODEL_ID);
        assert.equal(panel.querySelector('#cmr_import_preview').hidden, false);
        assert.match(panel.querySelector('#cmr_import_preview_summary').textContent, /model_in_use/);
        assert.equal(panel.querySelector('#cmr_import_preview_apply').disabled, true);
        assert.ok(
            harness.documentRef.activeElement === panel.querySelector('#cmr_import_preview_cancel'),
        );
        assert.match(panel.querySelector('#cmr_feedback').textContent, /model_in_use/);

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

test('런처는 모델 수가 바뀌어도 숫자 배지 없이 아이콘 하나와 접근 가능한 개수를 유지한다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        assert.equal(launcher.children.length, 1);
        assert.equal(launcher.querySelector('.cmr-launcher-count'), null);
        assert.match(launcher.getAttribute('aria-label'), /1개 등록됨/);

        globalThis.CustomModelRouter.registerModel('zai', 'glm-launcher-accessibility');
        await flushMicrotasks(8);
        assert.equal(launcher.children.length, 1);
        assert.equal(launcher.children[0].className, 'fa-solid fa-route');
        assert.equal(launcher.querySelector('.cmr-launcher-count'), null);
        assert.match(launcher.getAttribute('aria-label'), /2개 등록됨/);
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

test('Popup show 동기 예외도 고아 dialog와 열린 상태를 남기지 않는다', async () => {
    const harness = createHarness({
        popupShowError: new Error('show 동기 실패'),
        popupShowMode: 'throw',
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        launcher.dispatchEvent(new FakeEvent('click'));
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

test('Popup show가 Promise를 반환하지 않아도 열린 상태와 닫기 동작을 유지한다', async () => {
    const harness = createHarness({ popupShowMode: 'non-promise' });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        launcher.dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks();
        const popup = harness.popupInstances[0];
        assert.equal(popup.showCallCount, 1);
        assert.ok(harness.documentRef.querySelector('#cmr_manager_dialog'));
        assert.ok(harness.documentRef.querySelector('#cmr_settings'));
        assert.equal(launcher.getAttribute('aria-expanded'), 'true');

        popup.closeButton.dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks();
        assert.equal(harness.documentRef.querySelector('#cmr_manager_dialog'), null);
        assert.equal(harness.documentRef.querySelector('#cmr_settings'), null);
        assert.equal(launcher.getAttribute('aria-expanded'), 'false');
        assert.equal(harness.documentRef.activeElement, launcher);
    } finally {
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
        const addForm = panel.querySelector('#cmr_add_form');
        const feedback = panel.querySelector('#cmr_feedback');
        const addedModelId = 'gemini-4-flash-preview';
        const currentModelBefore = vertexSelect.value;
        const configuredModelBefore = harness.context.chatCompletionSettings.vertexai_model;
        const selectedModelBefore = harness.context.extensionSettings.customModelRouter.selectedModels.vertexai;

        assert.equal(input.tagName, 'TEXTAREA');
        assert.equal(input.maxLength, 65_536);
        assert.equal(panel.querySelector('#cmr_bulk_add_form'), null);
        assert.equal(panel.querySelector('#cmr_bulk_model_ids'), null);
        const submitButtons = addForm.querySelectorAll('button').filter(button => button.type === 'submit');
        assert.equal(submitButtons.length, 1);
        assert.equal(submitButtons[0].title, '모델 등록');
        assert.equal(submitButtons[0].getAttribute('aria-label'), '입력한 모델 ID 등록');

        input.value = addedModelId;
        const submitEvent = new FakeEvent('submit');
        addForm.dispatchEvent(submitEvent);
        assert.equal(submitEvent.defaultPrevented, true);
        assert.equal(input.value, '');
        assert.equal(input.getAttribute('aria-invalid'), 'false');
        assert.match(feedback.textContent, /Google Vertex AI에 gemini-4-flash-preview 모델을 등록/);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 1곳 · 모델 2개');
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
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 1곳 · 모델 1개');
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

test('등록 모델 검색은 12개까지 숨고 13개부터 provider와 모델 ID를 필터링한다', async () => {
    const initialModels = Array.from({ length: 12 }, (_, index) => (
        createModelRecord('vertexai', `gemini-search-${String(index + 1).padStart(2, '0')}`)
    ));
    const harness = createHarness({ models: initialModels, selectedModels: {} });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const region = panel.querySelector('#cmr_model_search_region');
        const input = panel.querySelector('#cmr_model_search');
        const status = panel.querySelector('#cmr_model_search_status');
        assert.equal(region.hidden, true);
        assert.equal(panel.querySelectorAll('.cmr-model-row').length, 12);

        globalThis.CustomModelRouter.registerModel('zai', 'glm-search-special');
        await flushMicrotasks(10);
        assert.equal(region.hidden, false);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 2곳 · 모델 13개');

        input.value = 'Z.AI';
        input.dispatchEvent(new FakeEvent('input'));
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '검색 1/13개');
        assert.equal(status.textContent, '등록 모델 13개 중 1개를 표시합니다.');
        assert.equal(panel.querySelectorAll('.cmr-model-row').length, 1);
        assert.ok(findActionButton(panel, 'delete', 'glm-search-special', 'zai'));

        input.value = 'gemini-search-02';
        input.dispatchEvent(new FakeEvent('input'));
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '검색 1/13개');
        assert.ok(findActionButton(panel, 'delete', 'gemini-search-02', 'vertexai'));

        input.value = 'no-such-model';
        input.dispatchEvent(new FakeEvent('input'));
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '검색 0/13개');
        assert.equal(panel.querySelector('#cmr_model_list').children.length, 1);
        assert.equal(
            panel.querySelector('#cmr_model_list').children[0].textContent,
            '검색 조건과 일치하는 등록 모델이 없습니다.',
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('비활성 등록 모델도 런처·전체 목록·검색에 남고 주입 없이 삭제와 실행 취소가 가능하다', async () => {
    const disabledModelId = 'gemini-disabled-record';
    const enabledModels = [
        createModelRecord('vertexai', VERTEX_MODEL_ID),
        ...Array.from({ length: 11 }, (_, index) => (
            createModelRecord('vertexai', `gemini-enabled-${String(index + 1).padStart(2, '0')}`)
        )),
    ];
    const harness = createHarness({
        models: [
            ...enabledModels,
            { ...createModelRecord('vertexai', disabledModelId), enabled: false },
        ],
        selectedModels: { vertexai: VERTEX_MODEL_ID },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const launcher = harness.documentRef.querySelector('#cmr_open_manager');
        const injectedIds = getCustomGroup(harness.controls.get('vertexai'), 'vertexai')
            .children.map(option => option.value);
        assert.equal(launcher.querySelector('.cmr-launcher-count'), null);
        assert.match(launcher.getAttribute('aria-label'), /13개 등록됨/);
        assert.equal(injectedIds.length, enabledModels.length);
        assert.equal(injectedIds.includes(disabledModelId), false);

        const panel = openPanel(harness);
        const searchRegion = panel.querySelector('#cmr_model_search_region');
        const searchInput = panel.querySelector('#cmr_model_search');
        assert.equal(searchRegion.hidden, false);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 1곳 · 모델 13개');

        searchInput.value = disabledModelId;
        searchInput.dispatchEvent(new FakeEvent('input'));
        const deleteButton = findActionButton(panel, 'delete', disabledModelId, 'vertexai');
        const disabledRow = deleteButton?.closest('.cmr-model-row');
        assert.ok(deleteButton);
        assert.equal(disabledRow?.dataset.enabled, 'false');
        assert.equal(disabledRow?.querySelector('.cmr-model-state')?.textContent, '비활성');
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '검색 1/13개');

        deleteButton.click();
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', disabledModelId), null);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 1곳 · 모델 12개');
        const undoButton = panel.querySelector('#cmr_undo_delete');
        assert.equal(undoButton.hidden, false);
        undoButton.click();

        const restored = globalThis.CustomModelRouter.getModel('vertexai', disabledModelId);
        assert.equal(restored?.enabled, false);
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 1곳 · 모델 13개');
        assert.equal(
            getCustomGroup(harness.controls.get('vertexai'), 'vertexai')
                .children.some(option => option.value === disabledModelId),
            false,
        );
        assert.equal(
            findActionButton(panel, 'delete', disabledModelId, 'vertexai')
                ?.closest('.cmr-model-row')
                ?.querySelector('.cmr-model-state')
                ?.textContent,
            '비활성',
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('통합 모델 등록 입력은 여러 줄 오류를 원자적으로 중단하고 중복·native 모델만 건너뛴다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const form = panel.querySelector('#cmr_add_form');
        const input = panel.querySelector('#cmr_model_id');
        const saveCountBefore = harness.saveCallCount;

        assert.equal(input.tagName, 'TEXTAREA');
        assert.equal(panel.querySelector('#cmr_bulk_add_form'), null);
        assert.equal(panel.querySelector('#cmr_bulk_model_ids'), null);

        input.value = 'gemini-bulk-valid\nbad/model\ngemini-bulk-never-applied';
        const invalidSubmit = new FakeEvent('submit');
        form.dispatchEvent(invalidSubmit);
        assert.equal(invalidSubmit.defaultPrevented, true);
        assert.equal(input.getAttribute('aria-invalid'), 'true');
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', 'gemini-bulk-valid'), null);
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', 'gemini-bulk-never-applied'), null);
        assert.equal(harness.saveCallCount, saveCountBefore);
        assert.equal(input.value, 'gemini-bulk-valid\nbad/model\ngemini-bulk-never-applied');
        assert.match(panel.querySelector('#cmr_feedback').textContent, /아무 모델도 등록하지 않았습니다/);

        const nativeModelId = getProvider('vertexai').fallbackModelIds[0];
        input.value = [
            VERTEX_MODEL_ID,
            'gemini-bulk-one',
            'gemini-bulk-one',
            nativeModelId,
            'gemini-bulk-two',
        ].join('\n');
        form.dispatchEvent(new FakeEvent('submit'));
        await flushMicrotasks(8);

        assert.equal(input.getAttribute('aria-invalid'), 'false');
        assert.equal(input.value, '');
        assert.equal(harness.documentRef.activeElement, input);
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', 'gemini-bulk-one'));
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', 'gemini-bulk-two'));
        assert.equal(harness.saveCallCount, saveCountBefore + 1);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /모델 2개를 등록/);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /중복 3개/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('모델 삭제 직후 실행 취소는 원래 레코드를 복구하고 버튼 초점을 되돌린다', async () => {
    const removableModelId = 'gemini-delete-undo';
    const harness = createHarness({
        models: [
            createModelRecord('vertexai', VERTEX_MODEL_ID),
            createModelRecord('vertexai', removableModelId),
        ],
        selectedModels: { vertexai: VERTEX_MODEL_ID },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const undoButton = panel.querySelector('#cmr_undo_delete');
        const deleteButton = findActionButton(panel, 'delete', removableModelId, 'vertexai');
        assert.ok(deleteButton);
        assert.equal(undoButton.hidden, true);

        deleteButton.click();
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', removableModelId), null);
        assert.equal(undoButton.hidden, false);
        assert.ok(harness.documentRef.activeElement === undoButton);
        assert.match(undoButton.getAttribute('aria-label'), /삭제 실행 취소/);

        const addInput = panel.querySelector('#cmr_model_id');
        addInput.value = 'bad/model';
        panel.querySelector('#cmr_add_form').dispatchEvent(new FakeEvent('submit'));
        assert.equal(addInput.getAttribute('aria-invalid'), 'true');
        assert.equal(undoButton.hidden, false);
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', removableModelId), null);

        undoButton.click();
        const restoredModel = globalThis.CustomModelRouter.getModel('vertexai', removableModelId);
        assert.ok(restoredModel);
        assert.equal(restoredModel.enabled, true);
        assert.equal(undoButton.hidden, true);
        const restoredDeleteButton = findActionButton(panel, 'delete', removableModelId, 'vertexai');
        assert.ok(restoredDeleteButton);
        assert.ok(harness.documentRef.activeElement === restoredDeleteButton);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /모델 등록을 복구/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('진단은 서로 다른 모델 선택기의 동일 제공업체 그룹을 중복 자원으로 판정하지 않는다', async () => {
    const harness = createHarness();
    const firstExternal = appendExternalModelSelect(harness, {
        containerId: 'first_vertex_extension',
        selectId: 'first_vertex_model',
        label: '첫 번째 Vertex 모델',
        attributes: { 'data-provider': 'vertexai' },
    });
    const secondExternal = appendExternalModelSelect(harness, {
        containerId: 'second_vertex_extension',
        selectId: 'second_vertex_model',
        label: '두 번째 Vertex 모델',
        attributes: { 'data-provider': 'vertexai' },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let copiedDiagnostics = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async writeText(value) {
                    copiedDiagnostics = value;
                },
            },
        },
    });
    try {
        await init();
        assert.ok(firstExternal.select.querySelector('optgroup[data-cmr-provider]'));
        assert.ok(secondExternal.select.querySelector('optgroup[data-cmr-provider]'));
        assert.equal(
            harness.documentRef.querySelectorAll('optgroup[data-cmr-provider]')
                .filter(group => group.dataset.cmrProvider === 'vertexai').length,
            3,
        );

        const panel = openPanel(harness);
        panel.querySelector('#cmr_run_diagnostics').dispatchEvent(new FakeEvent('click'));
        const pendingStabilityItem = panel.querySelector('#cmr_diagnostic_list').children.find(item => (
            item.textContent.includes('장시간 계측')
        ));
        assert.ok(pendingStabilityItem);
        assert.equal(pendingStabilityItem.dataset.status, 'pending');
        assert.equal(panel.querySelector('#cmr_diagnostic_summary').dataset.state, 'warning');
        const duplicateResourceItem = panel.querySelector('#cmr_diagnostic_list').children.find(item => (
            item.textContent.includes('중복 런처·패널·옵저버·이벤트 구독')
        ));
        assert.ok(duplicateResourceItem);
        assert.equal(duplicateResourceItem.dataset.status, 'passed');

        harness.setActiveSource('openai');
        await flushMicrotasks();
        const thirdExternal = appendExternalModelSelect(harness, {
            containerId: 'third_openai_extension',
            selectId: 'third_openai_model',
            label: '세 번째 OpenAI 모델',
            attributes: { 'data-provider': 'openai' },
        });
        assert.equal(thirdExternal.select.querySelector('optgroup[data-cmr-provider]'), null);
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks();
        assert.ok(thirdExternal.select.querySelector('optgroup[data-cmr-provider]'));
        let report = JSON.parse(copiedDiagnostics);
        assert.equal(report.status, 'warning');
        const pendingWarningCount = report.counts.warning;
        assert.equal(report.stability.status, 'pending');
        assert.equal(report.stability.evaluated, false);
        assert.equal(report.stability.activeSampleCount, 1);
        assert.equal(report.checks.some(check => check.id === 'runtime-stability'), false);
        assert.equal(
            report.counts.passed + report.counts.warning + report.counts.failed,
            report.checks.length,
        );
        assert.match(
            report.checks.find(check => check.id === 'external-model-controls').message,
            /후보 3개 = 연결 정책 3개 \+ 사용자 제외 0개 \+ 비채팅·비호환 제외 0개/,
        );

        harness.setActiveSource('vertexai');
        await flushMicrotasks();
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks();
        report = JSON.parse(copiedDiagnostics);
        assert.equal(report.status, 'warning');
        assert.equal(report.counts.warning, pendingWarningCount);
        assert.equal(report.stability.evaluated, true);
        assert.equal(report.stability.activeSampleCount, 2);
        assert.ok(report.checks.some(check => (
            check.id === 'runtime-stability' && check.status === 'passed'
        )));
        assert.equal(
            report.counts.passed + report.counts.warning + report.counts.failed,
            report.checks.length,
        );
    } finally {
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }
        await destroy();
        restoreGlobals();
    }
});

test('복구 경고는 정식 진단 항목에 합산되고 이후 정상 설정 이벤트에도 보존된다', async () => {
    const harness = createHarness({
        storedSettings: {
            schemaVersion: 1,
            models: [
                { id: 'gemini-legacy' },
                { id: 'gemini-legacy' },
                { id: 'bad/model' },
            ],
            selectedModelId: 'gemini-legacy',
        },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let copiedDiagnostics = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async writeText(value) {
                    copiedDiagnostics = value;
                },
            },
        },
    });
    try {
        await init();
        assert.deepEqual(harness.context.extensionSettings.customModelRouter, {
            schemaVersion: 2,
            models: [createModelRecord('vertexai', 'gemini-legacy')],
            selectedModels: { vertexai: 'gemini-legacy' },
        });
        const panel = openPanel(harness);
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks(8);
        let repair = JSON.parse(copiedDiagnostics).repair;
        assert.deepEqual(repair.notices.map(issue => issue.code), ['settings_migrated']);
        assert.deepEqual(repair.warnings.map(issue => issue.code), ['invalid_records_removed']);
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);

        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks(8);

        const report = JSON.parse(copiedDiagnostics);
        const repairCheck = report.checks.find(check => check.id === 'settings-repair');
        assert.equal(report.schemaVersion, 2);
        assert.equal(report.status, 'warning');
        assert.equal(repairCheck.status, 'warning');
        assert.deepEqual(repairCheck.details.noticeCodes, ['settings_migrated']);
        assert.deepEqual(repairCheck.details.warningCodes, ['invalid_records_removed']);
        assert.ok(repairCheck.details.repairItems.some(item => (
            item.code === 'model_invalid_removed'
            && item.action === 'removed'
            && item.pathCategory === 'registry.models'
            && item.count === 1
        )));
        assert.ok(repairCheck.details.repairItems.some(item => (
            item.code === 'model_duplicate_merged'
            && item.action === 'removed'
            && item.count === 1
        )));
        const repairItem = panel.querySelector('#cmr_diagnostic_list').children.find(item => (
            item.textContent.includes('잘못된 모델 레코드')
        ));
        assert.ok(repairItem);
        assert.match(repairItem.textContent, /잘못된 모델 레코드 1개를 제거/);
        assert.match(repairItem.textContent, /중복된 모델 레코드 1개를 하나로 합쳤습니다/);
        assert.deepEqual(report.repair.beforeCounts, { models: 3, selections: 1, routes: 0 });
        assert.deepEqual(report.repair.afterCounts, { models: 1, selections: 1, routes: 0 });
        assert.deepEqual(report.repair.errors, []);
        assert.equal(
            report.counts.passed + report.counts.warning + report.counts.failed,
            report.checks.length,
        );
        assert.doesNotMatch(copiedDiagnostics, /bad\/model|selectedModelId/);
        assert.doesNotMatch(repairItem.textContent, /bad\/model|selectedModelId/);
    } finally {
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }
        await destroy();
        restoreGlobals();
    }
});

test('손실 없는 저장 스키마 이관은 진단 주의가 아니라 통과 정보로 표시된다', async () => {
    const harness = createHarness({
        storedSettings: {
            schemaVersion: 1,
            models: [{ id: 'gemini-migrated' }],
            selectedModelId: 'gemini-migrated',
        },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let copiedDiagnostics = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async writeText(value) {
                    copiedDiagnostics = value;
                },
            },
        },
    });
    try {
        await init();
        const panel = openPanel(harness);
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks(8);

        const repairItem = panel.querySelector('#cmr_diagnostic_list').children.find(item => (
            item.textContent.includes('현재 스키마로 안전하게 이관')
        ));
        assert.ok(repairItem);
        assert.equal(repairItem.dataset.status, 'passed');
        const report = JSON.parse(copiedDiagnostics);
        const repairCheck = report.checks.find(check => check.id === 'settings-repair');
        assert.equal(report.repair.status, 'ok');
        assert.deepEqual(report.repair.notices, [{
            severity: 'info',
            code: 'settings_migrated',
            message: '이전 저장 스키마를 현재 버전으로 이관했습니다.',
        }]);
        assert.deepEqual(report.repair.warnings, []);
        assert.deepEqual(repairCheck.details.noticeCodes, ['settings_migrated']);
        assert.deepEqual(repairCheck.details.warningCodes, []);
    } finally {
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }
        await destroy();
        restoreGlobals();
    }
});

test('빈 첫 설치는 스키마 이관 기록 없이 현재 기본값만 저장한다', async () => {
    const harness = createHarness();
    delete harness.context.extensionSettings.customModelRouter;
    delete harness.context.extensionSettings.customModelRouterRouting;
    const restoreGlobals = installBrowserGlobals(harness);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let copiedDiagnostics = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async writeText(value) {
                    copiedDiagnostics = value;
                },
            },
        },
    });
    try {
        await init();
        assert.deepEqual(harness.context.extensionSettings.customModelRouter, {
            schemaVersion: 2,
            models: [],
            selectedModels: {},
        });
        assert.deepEqual(harness.context.extensionSettings.customModelRouterRouting, {
            schemaVersion: 1,
            routes: {},
        });

        const panel = openPanel(harness);
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks(8);
        const report = JSON.parse(copiedDiagnostics);
        assert.equal(report.repair, null);
        assert.equal(report.checks.some(check => check.id === 'settings-repair'), false);
        assert.doesNotMatch(copiedDiagnostics, /settings_migrated|schema_migrated/);
    } finally {
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }
        await destroy();
        restoreGlobals();
    }
});

test('삭제 없는 정규화는 고정 코드·문구로만 진단하고 원래 값을 노출하지 않는다', async () => {
    const harness = createHarness({
        storedSettings: {
            schemaVersion: 2,
            models: [{
                id: 'MODEL_VALUE_SECRET',
                provider: 'OpenAI',
                protocol: 'WRONG_PROTOCOL_SECRET',
                enabled: 'yes',
            }],
            selectedModels: { OpenAI: 'MODEL_VALUE_SECRET' },
        },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let copiedDiagnostics = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async writeText(value) {
                    copiedDiagnostics = value;
                },
            },
        },
    });
    try {
        await init();
        const panel = openPanel(harness);
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks(8);

        const report = JSON.parse(copiedDiagnostics);
        const repairCheck = report.checks.find(check => check.id === 'settings-repair');
        assert.deepEqual(report.repair.notices, []);
        assert.deepEqual(report.repair.warnings, [{
            severity: 'warning',
            code: 'settings_normalized',
            message: '저장된 모델·선택·경로 값을 현재 규칙에 맞게 정규화했습니다.',
        }]);
        assert.equal(report.repair.details.totals.removed, 0);
        assert.equal(report.repair.details.totals.changed, 2);
        assert.deepEqual(repairCheck.details.warningCodes, ['settings_normalized']);
        assert.match(repairCheck.message, /모델 레코드 1개의 provider·protocol·활성 상태를 정규화/);
        assert.match(repairCheck.message, /모델 선택 기록 1개의 제공업체·모델 ID를 정규화/);
        assert.doesNotMatch(
            copiedDiagnostics,
            /MODEL_VALUE_SECRET|WRONG_PROTOCOL_SECRET|OpenAI|invalid_records_removed|schema_migrated/,
        );
    } finally {
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }
        await destroy();
        restoreGlobals();
    }
});

test('복구 오류 코드는 비식별 진단 실패로 남고 이후 정상 설정 이벤트가 덮지 않는다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalConsoleError = console.error;
    let copiedDiagnostics = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async writeText(value) {
                    copiedDiagnostics = value;
                },
            },
        },
    });
    console.error = () => {};
    try {
        await init();
        harness.context.extensionSettings.customModelRouter = {
            schemaVersion: 999,
            models: [],
            selectedModels: {},
            sensitiveRawValue: 'SHOULD_NOT_BE_COPIED',
        };
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);

        harness.context.extensionSettings.customModelRouter = {
            schemaVersion: 2,
            models: [createModelRecord('vertexai', VERTEX_MODEL_ID)],
            selectedModels: { vertexai: VERTEX_MODEL_ID },
        };
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);

        const panel = openPanel(harness);
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks(8);

        const report = JSON.parse(copiedDiagnostics);
        const repairCheck = report.checks.find(check => check.id === 'settings-repair');
        assert.equal(report.status, 'error');
        assert.equal(repairCheck.status, 'failed');
        assert.deepEqual(repairCheck.details.errorCodes, ['future_registry_schema']);
        assert.deepEqual(report.repair.notices, []);
        assert.deepEqual(report.repair.warnings, []);
        assert.deepEqual(report.repair.errors, [{
            severity: 'error',
            code: 'future_registry_schema',
            message: '현재 확장보다 새로운 Registry 스키마라 저장값 적용을 중단했습니다.',
        }]);
        assert.equal(
            report.counts.passed + report.counts.warning + report.counts.failed,
            report.checks.length,
        );
        assert.doesNotMatch(copiedDiagnostics, /999|SHOULD_NOT_BE_COPIED|sensitiveRawValue/);
    } finally {
        console.error = originalConsoleError;
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }
        await destroy();
        restoreGlobals();
    }
});

test('등록 제공업체를 바꿔도 전체 provider 그룹과 기존 모델을 유지한다', async () => {
    const vertexModel = 'gemini-provider-group';
    const openaiModel = 'gpt-provider-group';
    const zaiModel = 'glm-provider-group';
    const harness = createHarness({
        models: [
            createModelRecord('vertexai', vertexModel),
            createModelRecord('openai', openaiModel),
        ],
        selectedModels: { vertexai: vertexModel },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const providerSelect = panel.querySelector('#cmr_provider');
        const modelList = panel.querySelector('#cmr_model_list');
        assert.deepEqual(modelList.children.map(group => group.dataset.provider), ['openai', 'vertexai']);
        assert.deepEqual(
            modelList.querySelectorAll('.cmr-model-id').map(element => element.textContent),
            [openaiModel, vertexModel],
        );

        providerSelect.value = 'zai';
        providerSelect.dispatchEvent(new FakeEvent('change'));
        assert.equal(panel.querySelector('#cmr_model_label').textContent, 'Z.AI (GLM) 모델 ID');
        assert.deepEqual(modelList.children.map(group => group.dataset.provider), ['openai', 'vertexai']);

        panel.querySelector('#cmr_model_id').value = zaiModel;
        panel.querySelector('#cmr_add_form').dispatchEvent(new FakeEvent('submit'));
        assert.deepEqual(modelList.children.map(group => group.dataset.provider), ['openai', 'vertexai', 'zai']);
        assert.deepEqual(
            modelList.querySelectorAll('.cmr-model-id').map(element => element.textContent),
            [openaiModel, vertexModel, zaiModel],
        );
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 3곳 · 모델 3개');
        assert.equal(modelList.dataset.scrollable, 'false');
        assert.equal(modelList.getAttribute('tabindex'), null);
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
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 0곳 · 모델 0개');
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
        assert.equal(globalThis.CustomModelRouter.apiVersion, '1.2.0');
        assert.equal(harness.eventSource.listenerCount, 10);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 2);
        assert.deepEqual(harness.context.extensionSettings.customModelRouterExternalIntegrations, {
            schemaVersion: 2,
            mappings: {},
            selectedModels: {},
            excludedTargets: {},
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
            models: [
                createModelRecord('vertexai', VERTEX_MODEL_ID),
                createModelRecord('vertexai', nextModelId),
            ],
            selectedModels: { vertexai: VERTEX_MODEL_ID },
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
            [VERTEX_MODEL_ID, nextModelId],
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
            models: [
                createModelRecord('vertexai', VERTEX_MODEL_ID),
                createModelRecord('vertexai', nextModelId),
            ],
            selectedModels: { vertexai: VERTEX_MODEL_ID },
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

        assert.deepEqual(
            globalThis.CustomModelRouter.getSnapshot().models.map(model => model.id),
            [VERTEX_MODEL_ID, nextModelId],
        );
        assert.equal(globalThis.CustomModelRouter.routing.getRoute('summary').modelId, nextModelId);
        assert.deepEqual(harness.context.extensionSettings.customModelRouterExternalIntegrations, {
            schemaVersion: 2,
            mappings: {},
            selectedModels: { [targetId]: { vertexai: nextModelId } },
            excludedTargets: {},
        });
        assert.deepEqual(
            external.select.querySelector('[data-cmr-external-group="true"]').children.map(option => option.value),
            [VERTEX_MODEL_ID, nextModelId],
        );
        assert.ok(harness.saveCallCount > initialSaveCallCount);
    } finally {
        console.error = originalConsoleError;
        await destroy();
        restoreGlobals();
    }
});

test('백업 미리보기는 추가·충돌·삭제를 적용 전에 보여주고 취소·적용·동일 설정을 구분한다', async () => {
    const sharedModelId = 'gemini-preview-shared';
    const deletedModelId = 'gemini-preview-delete';
    const addedModelId = 'gemini-preview-add';
    const importedRegistry = {
        schemaVersion: 2,
        models: [
            { ...createModelRecord('vertexai', sharedModelId), enabled: false },
            createModelRecord('vertexai', addedModelId),
        ],
        selectedModels: { vertexai: addedModelId },
    };
    const backup = JSON.stringify({
        format: 'custom-model-router-portable-settings',
        schemaVersion: 2,
        createdAt: '2026-08-20T00:00:00.000Z',
        registry: importedRegistry,
        purposeRoutes: { schemaVersion: 1, routes: {} },
        externalIntegrations: {
            schemaVersion: 2,
            mappings: {},
            selectedModels: {},
            excludedTargets: {},
        },
    });
    const harness = createHarness({
        models: [
            createModelRecord('vertexai', sharedModelId),
            createModelRecord('vertexai', deletedModelId),
        ],
        selectedModels: {},
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const input = panel.querySelector('#cmr_import_backup');
        const loadBackup = async () => {
            input.files = [{ size: backup.length, text: async () => backup }];
            input.value = 'preview-backup.json';
            input.dispatchEvent(new FakeEvent('change'));
            await flushMicrotasks(16);
        };

        await loadBackup();
        const preview = panel.querySelector('#cmr_import_preview');
        const summary = panel.querySelector('#cmr_import_preview_summary');
        const previewItems = panel.querySelector('#cmr_import_preview_list').children;
        assert.equal(preview.hidden, false);
        assert.match(summary.textContent, /추가 [1-9]\d*건/);
        assert.match(summary.textContent, /변경 충돌 [1-9]\d*건/);
        assert.match(summary.textContent, /삭제 [1-9]\d*건/);
        assert.ok(previewItems.some(item => item.dataset.change === 'addition'));
        assert.ok(previewItems.some(item => item.dataset.change === 'conflict'));
        assert.ok(previewItems.some(item => item.dataset.change === 'deletion'));
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', deletedModelId));
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', addedModelId), null);

        panel.querySelector('#cmr_import_preview_cancel').click();
        assert.equal(preview.hidden, true);
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', deletedModelId));
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', addedModelId), null);
        assert.match(panel.querySelector('#cmr_feedback').textContent, /취소했습니다/);

        await loadBackup();
        panel.querySelector('#cmr_import_preview_apply').click();
        await flushMicrotasks(16);
        assert.equal(preview.hidden, true);
        assert.ok(
            harness.documentRef.activeElement === panel.querySelector('#cmr_import_backup_button'),
        );
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', deletedModelId), null);
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', addedModelId));
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', sharedModelId).enabled, false);

        await loadBackup();
        assert.equal(preview.hidden, false);
        assert.equal(panel.querySelector('#cmr_import_preview_apply').disabled, true);
        assert.equal(summary.dataset.state, 'ok');
        assert.equal(summary.textContent, '현재 CMR 설정과 동일한 백업입니다.');
        assert.equal(panel.querySelector('#cmr_import_preview_list').children.length, 1);
        assert.equal(
            panel.querySelector('#cmr_import_preview_list').children[0].textContent,
            '적용할 변경이 없습니다.',
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('백업 미리보기 뒤 현재 route 값이 바뀌면 비식별 변경 모양이 같아도 첫 적용을 중단한다', async () => {
    const currentProfileId = 'PROFILE_CURRENT_SECRET';
    const changedProfileId = 'PROFILE_CHANGED_SECRET';
    const importedProfileId = 'PROFILE_IMPORTED_SECRET';
    const createRoute = connectionProfileId => ({
        provider: 'vertexai',
        modelId: VERTEX_MODEL_ID,
        adapterId: 'sillytavern.connection-profile',
        connectionProfileId,
    });
    const harness = createHarness();
    harness.context.extensionSettings.customModelRouterRouting = {
        schemaVersion: 1,
        routes: { summary: createRoute(currentProfileId) },
    };
    const backup = JSON.stringify({
        format: 'custom-model-router-portable-settings',
        schemaVersion: 2,
        createdAt: '2026-08-20T00:00:00.000Z',
        registry: {
            schemaVersion: 2,
            models: [createModelRecord('vertexai', VERTEX_MODEL_ID)],
            selectedModels: { vertexai: VERTEX_MODEL_ID },
        },
        purposeRoutes: {
            schemaVersion: 1,
            routes: { summary: createRoute(importedProfileId) },
        },
        externalIntegrations: {
            schemaVersion: 2,
            mappings: {},
            selectedModels: {},
            excludedTargets: {},
        },
    });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const input = panel.querySelector('#cmr_import_backup');
        input.files = [{ size: backup.length, text: async () => backup }];
        input.value = 'route-preview.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(12);

        const preview = panel.querySelector('#cmr_import_preview');
        const applyButton = panel.querySelector('#cmr_import_preview_apply');
        const previewList = panel.querySelector('#cmr_import_preview_list');
        const visiblePreviewText = () => [
            panel.querySelector('#cmr_import_preview_summary').textContent,
            ...previewList.children.map(item => item.textContent),
            panel.querySelector('#cmr_feedback').textContent,
        ].join(' ');
        assert.equal(preview.hidden, false);
        assert.match(visiblePreviewText(), /기능 경로 변경/);
        assert.doesNotMatch(visiblePreviewText(), /PROFILE_(?:CURRENT|CHANGED|IMPORTED)_SECRET/);

        harness.context.extensionSettings.customModelRouterRouting = {
            schemaVersion: 1,
            routes: { summary: createRoute(changedProfileId) },
        };
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);
        assert.equal(
            globalThis.CustomModelRouter.routing.getRoute('summary').connectionProfileId,
            changedProfileId,
        );

        applyButton.click();
        await flushMicrotasks(8);
        assert.equal(preview.hidden, false);
        assert.equal(
            globalThis.CustomModelRouter.routing.getRoute('summary').connectionProfileId,
            changedProfileId,
        );
        assert.match(panel.querySelector('#cmr_feedback').textContent, /다시 계산했습니다[\s\S]*다시 확인/);
        assert.doesNotMatch(visiblePreviewText(), /PROFILE_(?:CURRENT|CHANGED|IMPORTED)_SECRET/);

        applyButton.click();
        await flushMicrotasks(8);
        assert.equal(preview.hidden, true);
        assert.equal(
            globalThis.CustomModelRouter.routing.getRoute('summary').connectionProfileId,
            importedProfileId,
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('같은 파일 입력에서 느린 이전 읽기는 더 최근 백업 미리보기를 덮지 않는다', async () => {
    const staleModelId = 'gemini-stale-first-file';
    const currentModelId = 'gemini-current-second-file';
    const staleFileText = createDeferred();
    const staleBackup = createPortableBackup(staleModelId);
    const currentBackup = createPortableBackup(currentModelId);
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const input = panel.querySelector('#cmr_import_backup');
        input.files = [{ size: staleBackup.length, text: () => staleFileText.promise }];
        input.value = 'slow-first.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(2);

        input.files = [{ size: currentBackup.length, text: async () => currentBackup }];
        input.value = 'fast-second.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(12);

        const previewList = panel.querySelector('#cmr_import_preview_list');
        const visiblePreviewText = () => previewList.children.map(item => item.textContent).join(' ');
        assert.match(visiblePreviewText(), new RegExp(currentModelId));
        assert.doesNotMatch(visiblePreviewText(), new RegExp(staleModelId));

        staleFileText.resolve(staleBackup);
        await flushMicrotasks(12);
        assert.match(visiblePreviewText(), new RegExp(currentModelId));
        assert.doesNotMatch(visiblePreviewText(), new RegExp(staleModelId));

        panel.querySelector('#cmr_import_preview_apply').click();
        await flushMicrotasks(8);
        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', currentModelId));
        assert.equal(globalThis.CustomModelRouter.getModel('vertexai', staleModelId), null);
    } finally {
        staleFileText.resolve(staleBackup);
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

test('백업 미리보기 뒤 비활성화하면 이전 적용 버튼이 다음 runtime을 덮지 않는다', async () => {
    const importedModelId = 'gemini-stale-preview-import';
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const oldPanel = openPanel(harness);
        const input = oldPanel.querySelector('#cmr_import_backup');
        input.files = [{ text: async () => createPortableBackup(importedModelId) }];
        input.value = 'stale-preview-backup.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(12);

        const staleApplyButton = oldPanel.querySelector('#cmr_import_preview_apply');
        assert.equal(oldPanel.querySelector('#cmr_import_preview').hidden, false);
        assert.equal(staleApplyButton.disabled, false);
        assert.equal(
            globalThis.CustomModelRouter.getSnapshot().models.some(model => model.id === importedModelId),
            false,
        );

        await destroy();
        await init();
        const newPanel = openPanel(harness);
        assert.ok(newPanel !== oldPanel);
        staleApplyButton.click();
        await flushMicrotasks(8);

        assert.ok(globalThis.CustomModelRouter.getModel('vertexai', VERTEX_MODEL_ID));
        assert.equal(
            globalThis.CustomModelRouter.getSnapshot().models.some(model => model.id === importedModelId),
            false,
        );
        assert.equal(
            harness.context.extensionSettings.customModelRouter.models.some(model => model.id === importedModelId),
            false,
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('백업 schema v2는 routing·외부 선택을 보존하고 legacy mapping을 제거해 복구한다', async () => {
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

        const preview = panel.querySelector('#cmr_import_preview');
        assert.equal(preview.hidden, false);
        assert.equal(panel.querySelector('#cmr_import_preview_apply').disabled, false);
        assert.ok(globalThis.CustomModelRouter.getModel('openrouter', exportedModelId));
        assert.equal(globalThis.CustomModelRouter.routing.getRoute('summary'), null);

        panel.querySelector('#cmr_import_preview_apply').click();
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
        assert.match(panel.querySelector('#cmr_feedback').textContent, /적용했습니다/);
    } finally {
        await destroy();
        download.restore();
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
        assert.equal(globalThis.CustomModelRouter, undefined);
        assert.ok(getCustomGroup(harness.controls.get('vertexai'), 'vertexai'));
        assert.equal(harness.eventSource.listenerCount, 10);
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

test('공용 provider integration API는 최종 초기화 뒤 공개되고 동기화·진단·종료를 원자적으로 처리한다', async () => {
    const harness = createHarness();
    harness.context.extensionSettings.connectionManager.selectedProfile = 'profile-vertex';
    const restoreGlobals = installBrowserGlobals(harness);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let copiedDiagnostics = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async writeText(value) {
                    copiedDiagnostics = value;
                },
            },
        },
    });
    let readyEventCount = 0;
    let announcedApi = null;
    harness.documentRef.addEventListener('custom-model-router:provider-integrations-ready', event => {
        readyEventCount += 1;
        announcedApi = event.detail;
    });
    const phases = [];
    const publishedModels = [];
    const modelUpdates = [];
    let boundExecute = null;
    let handlerDisposeCount = 0;
    let publicationDisposeCount = 0;
    try {
        await init();
        const integrations = globalThis.CustomModelRouter.integrations;
        assert.ok(integrations);
        assert.equal(integrations.apiVersion, '1.0.0');
        assert.equal(readyEventCount, 1);
        assert.equal(announcedApi, integrations);
        assert.equal(integrations.capabilities.selectedConnectionProfileOnly, true);
        assert.equal(integrations.capabilities.credentials, 'connection-manager-owned');
        assert.equal(integrations.capabilities.mainChatMutation, false);

        const registration = integrations.registerConsumer(
            createProviderConsumerDescriptor('index.integration.success'),
            {
                async installHandler(binding) {
                    phases.push('handler');
                    boundExecute = binding.execute;
                    assert.equal(binding.provider.id, 'cmr.sillytavern.vertexai');
                    assert.equal(binding.signal.aborted, false);
                    return {
                        requestHandlerBound: true,
                        handlerToken: 'handler-private-token',
                        async dispose() {
                            handlerDisposeCount += 1;
                        },
                    };
                },
                async publishModels(publication) {
                    phases.push('models');
                    publishedModels.push(...publication.models.map(model => model.id));
                    return {
                        modelsPublished: true,
                        publicationToken: 'publication-private-token',
                        async updateModels(models) {
                            modelUpdates.push(models.map(model => model.id));
                            return true;
                        },
                        async dispose() {
                            publicationDisposeCount += 1;
                        },
                    };
                },
            },
        );
        const ready = await registration.ready;
        assert.deepEqual(phases, ['handler', 'models']);
        assert.deepEqual(publishedModels, [VERTEX_MODEL_ID]);
        assert.equal(ready.bindings.length, 1);
        assert.equal(ready.bindings[0].status, 'ready');
        assert.equal(ready.bindings[0].providerId, 'cmr.sillytavern.vertexai');
        assert.equal(ready.bindings[0].modelCount, 1);

        const result = await boundExecute({
            modelId: VERTEX_MODEL_ID,
            prompt: 'provider integration request',
            maxTokens: 32,
        });
        assert.deepEqual(result, { content: 'CMR_OK' });
        assert.equal(harness.routingCalls.length, 1);
        assert.equal(harness.routingCalls[0][0], 'profile-vertex');
        assert.equal(harness.routingCalls[0][4].model, VERTEX_MODEL_ID);

        const additionalModelId = 'gemini-provider-integration-sync';
        globalThis.CustomModelRouter.registerModel('vertexai', additionalModelId);
        await flushMicrotasks(8);
        await integrations.refresh();
        assert.ok(modelUpdates.length >= 1);
        assert.deepEqual(modelUpdates.at(-1), [VERTEX_MODEL_ID, additionalModelId]);

        const panel = openPanel(harness);
        panel.querySelector('#cmr_copy_diagnostics').dispatchEvent(new FakeEvent('click'));
        await flushMicrotasks(8);
        const report = JSON.parse(copiedDiagnostics);
        const integrationCheck = report.checks.find(check => (
            check.id === 'external-provider-integrations'
        ));
        assert.deepEqual(report.providerIntegrations, {
            consumerCount: 1,
            pendingCount: 0,
            readyCount: 1,
            failedCount: 0,
            publishedModelCount: 2,
        });
        assert.deepEqual(integrationCheck.details, report.providerIntegrations);
        assert.equal(integrationCheck.status, 'passed');
        assert.doesNotMatch(copiedDiagnostics, /profile-vertex|handler-private-token|publication-private-token/);

        const lateInstall = createDeferred();
        let lateSignal = null;
        let latePublishCount = 0;
        let lateHandlerDisposeCount = 0;
        const lateRegistration = integrations.registerConsumer(
            createProviderConsumerDescriptor('index.integration.late'),
            {
                installHandler(binding) {
                    lateSignal = binding.signal;
                    return lateInstall.promise;
                },
                async publishModels() {
                    latePublishCount += 1;
                    throw new Error('종료 뒤에는 모델 게시에 도달하면 안 됩니다.');
                },
            },
        );
        await flushMicrotasks(8);
        assert.equal(lateSignal?.aborted, false);

        await destroy();
        assert.equal(globalThis.CustomModelRouter, undefined);
        assert.equal(lateSignal.aborted, true);
        assert.equal(handlerDisposeCount, 1);
        assert.equal(publicationDisposeCount, 1);
        lateInstall.resolve({
            requestHandlerBound: true,
            handlerToken: 'late-private-token',
            async dispose() {
                lateHandlerDisposeCount += 1;
            },
        });
        await lateRegistration.ready;
        assert.equal(latePublishCount, 0);
        assert.equal(lateHandlerDisposeCount, 1);
        await assert.rejects(
            boundExecute({ modelId: VERTEX_MODEL_ID, prompt: 'late', maxTokens: 8 }),
            error => error?.code === 'binding_not_ready',
        );
    } finally {
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        } else {
            delete globalThis.navigator;
        }
        await destroy();
        restoreGlobals();
    }
});

test('provider integration 전역 API는 초기화 최종 단계가 실패하면 공개되지 않고 런타임을 롤백한다', async () => {
    const harness = createHarness({
        fetchImplementation: async () => ({ ok: false, status: 503 }),
    });
    harness.context.extensionSettings.connectionManager.selectedProfile = 'profile-vertex';
    const restoreGlobals = installBrowserGlobals(harness);
    let readyEventCount = 0;
    harness.documentRef.addEventListener('custom-model-router:provider-integrations-ready', () => {
        readyEventCount += 1;
    });
    try {
        await assert.rejects(init(), /HTTP 503/);
        assert.equal(globalThis.CustomModelRouter, undefined);
        assert.equal(readyEventCount, 0);
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.documentRef.querySelector('#cmr_open_manager'), null);
        assert.ok(harness.observers.every(observer => observer.target === null));
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('Connection Profile 생성·갱신·삭제 이벤트는 공용 provider binding을 즉시 해제하고 복구한다', async () => {
    const harness = createHarness();
    harness.context.extensionSettings.connectionManager.selectedProfile = 'profile-vertex';
    const restoreGlobals = installBrowserGlobals(harness);
    let installCount = 0;
    let publishCount = 0;
    let handlerDisposeCount = 0;
    let publicationDisposeCount = 0;
    try {
        await init();
        const integrations = globalThis.CustomModelRouter.integrations;
        const registration = integrations.registerConsumer(
            createProviderConsumerDescriptor('index.integration.profile-events'),
            {
                async installHandler() {
                    installCount += 1;
                    return Object.freeze({
                        requestHandlerBound: true,
                        handlerToken: `handler-${installCount}`,
                        async dispose() {
                            handlerDisposeCount += 1;
                        },
                    });
                },
                async publishModels() {
                    publishCount += 1;
                    return Object.freeze({
                        modelsPublished: true,
                        publicationToken: `publication-${publishCount}`,
                        async updateModels() {
                            return true;
                        },
                        async dispose() {
                            publicationDisposeCount += 1;
                        },
                    });
                },
            },
        );
        await registration.ready;
        assert.equal(integrations.getConsumers()[0].bindings[0].status, 'ready');
        assert.equal(installCount, 1);

        const profile = harness.context.extensionSettings.connectionManager.profiles[0];
        profile.api = 'unsupported';
        harness.eventSource.emit(harness.context.eventTypes.CONNECTION_PROFILE_UPDATED);
        await flushMicrotasks(8);
        await integrations.refresh();
        assert.equal(integrations.getConsumers()[0].bindings.length, 0);
        assert.equal(handlerDisposeCount, 1);
        assert.equal(publicationDisposeCount, 1);

        profile.api = 'vertexai';
        harness.eventSource.emit(harness.context.eventTypes.CONNECTION_PROFILE_CREATED);
        await flushMicrotasks(8);
        await integrations.refresh();
        assert.equal(integrations.getConsumers()[0].bindings[0].status, 'ready');
        assert.equal(installCount, 2);
        assert.equal(publishCount, 2);

        harness.context.extensionSettings.connectionManager.profiles.splice(0, 1);
        harness.eventSource.emit(harness.context.eventTypes.CONNECTION_PROFILE_DELETED);
        await flushMicrotasks(8);
        await integrations.refresh();
        assert.equal(integrations.getConsumers()[0].bindings.length, 0);
        assert.equal(handlerDisposeCount, 2);
        assert.equal(publicationDisposeCount, 2);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('모델 100개는 런처에 숫자 배지 없이 안내하고 Popup의 provider별 압축 목록에 모두 렌더링한다', async () => {
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
        assert.equal(launcher.querySelector('.cmr-launcher-count'), null);
        assert.match(launcher.getAttribute('aria-label'), /100개 등록됨/);

        const panel = openPanel(harness);
        const modelList = panel.querySelector('#cmr_model_list');
        assert.equal(harness.popupInstances.length, 1);
        assert.equal(modelList.children.length, 1);
        assert.equal(modelList.children[0].className, 'cmr-provider-group');
        assert.equal(panel.querySelector('#cmr_model_count').textContent, '제공업체 1곳 · 모델 100개');
        const rows = modelList.querySelectorAll('.cmr-model-row');
        assert.equal(rows.length, 100);
        assert.ok(rows.every(row => {
            const actions = row.querySelector('.cmr-model-actions');
            return actions?.children.length === 1
                && actions.children[0].dataset.cmrAction === 'delete';
        }));
        assert.equal(modelList.dataset.scrollable, 'true');
        assert.equal(modelList.getAttribute('tabindex'), '0');
        assert.match(modelList.getAttribute('aria-label'), /등록 모델 100개/);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('범용 연결은 안전한 외부 모델 select에 등록 모델을 직접 노출하고 native 이벤트를 보존한다', async () => {
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
        assert.equal(targets[0].resolution.providerId, null);
        assert.equal(targets[0].resolution.source, 'direct');
        assert.equal(external.select.value, 'native-external-model');
        assert.ok(!unrelated.querySelector('[data-cmr-external-group="true"]'));

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

    // 실제 index wiring도 현재 SillyTavern Chat Completion source를 매 scan에
    // 다시 읽어 native current-connection target에 해당 provider 모델만 투영한다.
    const wiredModels = [
        createModelRecord('vertexai', 'gemini-wired-current'),
        createModelRecord('openai', 'gpt-wired-current'),
        createModelRecord('custom', 'custom-wired-compatible'),
    ];
    const wiredHarness = createHarness({
        models: wiredModels,
        selectedModels: { vertexai: 'gemini-wired-current' },
        activeSource: 'vertexai',
    });
    const appendNativeReusePanel = ({
        panelId,
        providerId,
        providerValue,
        providerLabel,
        modelId: nativeModelId,
    }) => {
        const panel = wiredHarness.documentRef.createElement('section');
        panel.id = panelId;
        panel.className = 'extension_container';
        const providerLabelElement = wiredHarness.documentRef.createElement('label');
        providerLabelElement.textContent = 'Model provider';
        providerLabelElement.setAttribute('for', providerId);
        const provider = wiredHarness.documentRef.createElement('select');
        provider.id = providerId;
        provider.setAttribute('aria-label', 'Model provider');
        const providerOption = wiredHarness.documentRef.createElement('option');
        providerOption.value = providerValue;
        providerOption.textContent = providerLabel;
        providerOption.setAttribute('label', providerLabel);
        provider.append(providerOption);
        provider.value = providerValue;
        const modelLabelElement = wiredHarness.documentRef.createElement('label');
        modelLabelElement.textContent = 'Chat model';
        modelLabelElement.setAttribute('for', `${panelId}_model`);
        const model = wiredHarness.documentRef.createElement('select');
        model.id = `${panelId}_model`;
        model.setAttribute('data-provider-select', providerId);
        const nativeOption = wiredHarness.documentRef.createElement('option');
        nativeOption.value = nativeModelId;
        nativeOption.textContent = nativeModelId;
        nativeOption.setAttribute('data-type', providerValue);
        model.append(nativeOption);
        model.value = nativeModelId;
        panel.append(providerLabelElement, provider, modelLabelElement, model);
        wiredHarness.documentRef.body.append(panel);
        return { provider, model };
    };
    const wiredCustom = appendNativeReusePanel({
        panelId: 'wired_custom_panel',
        providerId: 'wired_custom_provider',
        providerValue: 'custom',
        providerLabel: 'Custom OpenAI-compatible',
        modelId: 'native-custom',
    });
    const wiredCurrent = appendNativeReusePanel({
        panelId: 'wired_current_panel',
        providerId: 'wired_current_provider',
        providerValue: 'current_st',
        providerLabel: 'Current SillyTavern Settings',
        modelId: 'native-current',
    });
    const wiredCustomTargetId = createExternalTargetId(wiredCustom.model, {
        documentRef: wiredHarness.documentRef,
    });
    const wiredCurrentTargetId = createExternalTargetId(wiredCurrent.model, {
        documentRef: wiredHarness.documentRef,
    });
    const customProviderValues = wiredCustom.provider.options.map(option => option.value);
    const currentProviderValues = wiredCurrent.provider.options.map(option => option.value);
    const restoreGlobals = installBrowserGlobals(wiredHarness);
    try {
        await init();
        await flushMicrotasks();
        assert.deepEqual(
            wiredCustom.model.querySelectorAll('[data-cmr-external-model="true"]')
                .map(option => [option.value, option.dataset.cmrProvider, option.dataset.type]),
            [['custom-wired-compatible', 'custom', 'custom']],
        );
        assert.deepEqual(
            wiredCurrent.model.querySelectorAll('[data-cmr-external-model="true"]')
                .map(option => [option.value, option.dataset.cmrProvider, option.dataset.type]),
            [['gemini-wired-current', 'vertexai', 'current_st']],
        );
        assert.deepEqual(wiredCustom.provider.options.map(option => option.value), customProviderValues);
        assert.deepEqual(wiredCurrent.provider.options.map(option => option.value), currentProviderValues);
        assert.equal(wiredCustom.provider.value, 'custom');
        assert.equal(wiredCurrent.provider.value, 'current_st');

        const panel = openPanel(wiredHarness);
        const getPickerRow = targetId => panel.querySelector('#cmr_external_picker_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        const getProblemRow = targetId => panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        let customRow = getPickerRow(wiredCustomTargetId);
        let currentRow = getPickerRow(wiredCurrentTargetId);
        assert.ok(customRow);
        assert.equal(
            customRow.querySelector('.cmr-external-state').textContent,
            '기존 OpenAI 호환 경로에 모델 표시',
        );
        assert.equal(
            customRow.querySelector('.cmr-external-verification').textContent,
            '실제 요청 확인 필요',
        );
        assert.ok(currentRow);
        assert.equal(
            currentRow.querySelector('.cmr-external-state').textContent,
            '현재 SillyTavern 연결 경로에 모델 표시',
        );
        assert.equal(
            currentRow.querySelector('.cmr-external-verification').textContent,
            '실제 요청 확인 필요',
        );

        wiredHarness.setActiveSource('unsupported-native-provider');
        await flushMicrotasks(8);
        assert.equal(
            wiredCurrent.model.querySelectorAll('[data-cmr-external-model="true"]').length,
            0,
        );
        assert.ok(!getPickerRow(wiredCurrentTargetId));
        currentRow = getProblemRow(wiredCurrentTargetId);
        assert.ok(currentRow);
        assert.equal(
            currentRow.querySelector('.cmr-external-state').textContent,
            '현재 SillyTavern 연결 확인 필요',
        );
        assert.equal(
            currentRow.querySelector('.cmr-external-verification').textContent,
            '다른 공급자 모델로 대체하지 않음',
        );
        assert.deepEqual(
            wiredCustom.model.querySelectorAll('[data-cmr-external-model="true"]')
                .map(option => option.value),
            ['custom-wired-compatible'],
        );

        wiredHarness.setActiveSource('openai');
        await flushMicrotasks(8);
        assert.deepEqual(
            wiredCurrent.model.querySelectorAll('[data-cmr-external-model="true"]')
                .map(option => [option.value, option.dataset.cmrProvider, option.dataset.type]),
            [['gpt-wired-current', 'openai', 'current_st']],
        );
        assert.deepEqual(
            wiredCustom.model.querySelectorAll('[data-cmr-external-model="true"]')
                .map(option => option.value),
            ['custom-wired-compatible'],
        );
        assert.equal(wiredCustom.provider.value, 'custom');
        assert.equal(wiredCurrent.provider.value, 'current_st');
        assert.ok(!getProblemRow(wiredCurrentTargetId));
        currentRow = getPickerRow(wiredCurrentTargetId);
        assert.ok(currentRow);
        assert.equal(
            currentRow.querySelector('.cmr-external-state').textContent,
            '현재 SillyTavern 연결 경로에 모델 표시',
        );
        assert.equal(
            currentRow.querySelector('.cmr-external-verification').textContent,
            '실제 요청 확인 필요',
        );
        customRow = getPickerRow(wiredCustomTargetId);
        assert.ok(customRow);
        assert.equal(
            customRow.querySelector('.cmr-external-state').textContent,
            '기존 OpenAI 호환 경로에 모델 표시',
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
    assert.equal(wiredCustom.model.querySelector('[data-cmr-external-model="true"]'), null);
    assert.equal(wiredCurrent.model.querySelector('[data-cmr-external-model="true"]'), null);
});

test('범용 연결은 외부 provider 전환과 무관하게 모든 등록 제공업체 그룹을 유지한다', () => {
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
        assert.equal(target.resolution.providerId, null);
        assert.equal(target.resolution.source, 'direct');
        assert.deepEqual(external.select.querySelectorAll('[data-cmr-external-group="true"]')
            .map(group => [group.dataset.cmrProvider, group.children.map(option => option.value)]), [
            ['openai', [openaiModel]],
            ['zai', [zaiModel]],
        ]);

        external.select.setAttribute('data-provider', 'zai');
        [target] = controller.rescan();
        assert.equal(target.resolution.providerId, null);
        assert.equal(target.resolution.source, 'direct');
        assert.deepEqual(external.select.querySelectorAll('[data-cmr-external-group="true"]')
            .map(group => [group.dataset.cmrProvider, group.children.map(option => option.value)]), [
            ['openai', [openaiModel]],
            ['zai', [zaiModel]],
        ]);
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
    assert.ok(!first.select.querySelector('[data-cmr-external-group="true"]'));
    assert.ok(replacement.select.querySelector('[data-cmr-external-group="true"]'));

    const pending = appendExternalModelSelect(harness, {
        containerId: 'pending_caption_extension',
        selectId: 'pending_model',
        label: 'Gemini 보조 모델',
    });
    controller.destroy();
    await flushMicrotasks(8);
    assert.ok(!replacement.select.querySelector('[data-cmr-external-group="true"]'));
    assert.ok(!pending.select.querySelector('[data-cmr-external-group="true"]'));
    assert.equal(controller.getTargets().length, 0);
    assert.ok(harness.observers.every(observer => observer.target === null));
});

test('init 범용 직접 연결은 기본 예외 목록에서 숨기고 명시적 picker와 재렌더 복원을 제공한다', async () => {
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
        assert.ok(!panel.querySelector('#cmr_external_section'));
        assert.equal(panel.querySelector('#cmr_external_warning').hidden, true);
        assert.ok(panel.querySelector('#cmr_external_advanced'));
        assert.ok(panel.querySelector('#cmr_external_list'));
        assert.equal(
            panel.querySelector('#cmr_external_status').textContent,
            '현재 조치가 필요한 외부 연결 문제가 없습니다.',
        );
        assert.equal(panel.querySelector('#cmr_external_count').textContent, '설정 없음');
        assert.ok(!panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`));
        assert.ok(
            panel.querySelector('#cmr_external_picker_list').querySelector(`[data-target-id="${targetId}"]`),
        );
        assert.deepEqual(
            external.select.querySelector('[data-cmr-external-group="true"]').children.map(option => option.value),
            [modelId],
        );
        assert.equal(external.select.value, 'native-external-model');

        const temporary = appendExternalModelSelect(harness, {
            containerId: 'temporary_translator_extension',
            selectId: 'temporary_translator_model',
            label: '임시 번역 모델',
        });
        const temporaryTargetId = createExternalTargetId(
            temporary.select,
            { documentRef: harness.documentRef },
        );
        await flushMicrotasks(10);
        assert.equal(
            panel.querySelector('#cmr_external_status').textContent,
            '현재 조치가 필요한 외부 연결 문제가 없습니다.',
        );
        assert.ok(
            panel.querySelector('#cmr_external_picker_list')
                .querySelector(`[data-target-id="${temporaryTargetId}"]`),
        );
        temporary.container.remove();
        await flushMicrotasks(10);
        assert.equal(
            panel.querySelector('#cmr_external_status').textContent,
            '현재 조치가 필요한 외부 연결 문제가 없습니다.',
        );
        assert.ok(!panel.querySelector('#cmr_external_picker_list')
            .querySelector(`[data-target-id="${temporaryTargetId}"]`));

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

test('외부 선택지의 대상당 용량과 전체 DOM 예산을 함께 넘으면 두 경고를 모두 알린다', async () => {
    const models = Array.from(
        { length: EXTERNAL_INJECTED_OPTION_LIMIT + 1 },
        (_, index) => createModelRecord('openai', `gpt-capacity-${index}`),
    );
    const harness = createHarness({ models, selectedModels: {} });
    const external = appendExternalModelSelect(harness, {
        containerId: 'capacity_warning_extension',
        selectId: 'capacity_warning_model',
        label: '대량 모델 칸',
    });
    for (let index = 1; index < 5; index += 1) {
        appendExternalModelSelect(harness, {
            containerId: `capacity_warning_extension_${index}`,
            selectId: `capacity_warning_model_${index}`,
            label: `대량 모델 칸 ${index + 1}`,
        });
    }
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const warning = panel.querySelector('#cmr_external_warning');
        assert.equal(warning.hidden, false);
        assert.match(
            panel.querySelector('#cmr_external_warning_text').textContent,
            new RegExp(`외부 모델 칸 5곳.*CMR 선택지가 ${EXTERNAL_INJECTED_OPTION_LIMIT}개를 넘어 일부만 표시`),
        );
        assert.match(
            panel.querySelector('#cmr_external_warning_text').textContent,
            new RegExp(`외부 모델 선택지 ${EXTERNAL_INJECTED_OPTION_LIMIT * 5}개.*권장 한도`),
        );
        assert.equal(panel.querySelector('#cmr_external_count').textContent, '성능 주의');
        assert.equal(
            external.select.querySelectorAll('[data-cmr-external-model="true"]').length,
            EXTERNAL_INJECTED_OPTION_LIMIT,
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('unknown 외부 target도 직접 연결하고 provider별 선택을 재렌더에 복원한다', async () => {
    const openaiModel = 'gpt-direct-helper';
    const zaiModel = 'glm-direct-helper';
    const sharedModel = 'shared-direct-helper';
    const harness = createHarness({
        models: [
            createModelRecord('openai', openaiModel),
            createModelRecord('zai', zaiModel),
            createModelRecord('openai', sharedModel),
            createModelRecord('zai', sharedModel),
        ],
        selectedModels: {},
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'manual_summary_extension',
        selectId: 'manual_summary_model',
        label: '요약 모델',
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    const externalInput = appendExternalModelInput(harness, {
        containerId: 'manual_input_extension',
        inputId: 'manual_model_input',
        label: '요약 모델 입력란',
    });
    const inputTargetId = createExternalTargetId(externalInput.input, { documentRef: harness.documentRef });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const externalList = panel.querySelector('#cmr_external_picker_list');
        const row = externalList.querySelector(`[data-target-id="${targetId}"]`);
        assert.ok(row.querySelector('.cmr-external-heading'));
        assert.equal(row.querySelector('.cmr-external-name').textContent, 'Manual Summary');
        assert.equal(row.querySelector('.cmr-external-control').textContent, '요약 모델');
        assert.equal(row.querySelector('[data-cmr-external-mode]'), null);
        assert.equal(row.querySelector('.cmr-external-state').textContent, '선택지 연결됨');
        assert.equal(row.querySelector('.cmr-external-verification').textContent, '실제 요청 확인 필요');
        assert.equal(row.querySelector('[data-cmr-external-action="exclude"]')?.dataset.targetId, targetId);
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.mappings,
            {},
        );
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.excludedTargets,
            {},
        );
        const groups = external.select.querySelectorAll('[data-cmr-external-group="true"]');
        assert.deepEqual(groups.map(group => [group.dataset.cmrProvider, group.label]), [
            ['openai', 'OpenAI · 사용자 모델'],
            ['zai', 'Z.AI (GLM) · 사용자 모델'],
        ]);

        const zaiOption = external.select.querySelector(
            `[data-cmr-external-model="true"][data-cmr-provider="zai"]`,
        );
        // Fake DOM의 selector는 복합 data selector를 지원하지 않으므로 실제 option 집합에서도 확인한다.
        const selectedZaiOption = zaiOption ?? external.select.options.find(option => (
            option.dataset.cmrExternalModel === 'true' && option.dataset.cmrProvider === 'zai'
        ));
        selectedZaiOption.selected = true;
        external.select.value = zaiModel;
        external.select.dispatchEvent(new FakeEvent('change', { bubbles: true, isTrusted: true }));
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels[targetId],
            { zai: zaiModel },
        );

        const inputRow = externalList.querySelector(`[data-target-id="${inputTargetId}"]`);
        assert.equal(inputRow.querySelector('[data-cmr-external-mode]'), null);
        externalInput.input.value = sharedModel;
        externalInput.input.dispatchEvent(new FakeEvent('input', { bubbles: true, isTrusted: true }));
        assert.equal(externalInput.extensionState.model, sharedModel);
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels[inputTargetId],
            { openai: sharedModel, zai: sharedModel },
        );

        external.container.remove();
        const replacement = appendExternalModelSelect(harness, {
            containerId: 'manual_summary_extension',
            selectId: 'manual_summary_model',
            label: '요약 모델',
        });
        replacement.select.value = '';
        await flushMicrotasks(10);
        assert.equal(replacement.select.value, zaiModel);
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels[targetId],
            { zai: zaiModel },
        );
        assert.ok(replacement.select.querySelector('[data-cmr-external-group="true"]'));
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('init은 legacy provider mapping을 제거하고 unknown target에 전체 모델을 직접 표시한다', async () => {
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
        assert.ok(!panel.querySelector('#cmr_external_section'));
        assert.ok(panel.querySelector('#cmr_external_advanced'));
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations,
            {
                schemaVersion: 2,
                mappings: {},
                selectedModels: { [targetId]: { zai: modelId } },
                excludedTargets: {},
            },
        );
        assert.ok(external.select.querySelector('[data-cmr-external-group="true"]'));
        assert.ok(harness.saveCallCount >= 1);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('legacy mapping이 한도를 채워도 모두 제거하고 선택 기록을 보존한다', async () => {
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
        const migrated = harness.context.extensionSettings.customModelRouterExternalIntegrations;
        assert.equal(migrated.schemaVersion, 2);
        assert.deepEqual(migrated.mappings, {});
        assert.deepEqual(migrated.selectedModels, {
            [selectedTarget]: { vertexai: 'gemini-future' },
        });
        assert.deepEqual(migrated.excludedTargets, {});
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

test('오래된 외부 mapping 512개는 제거하고 현재 target 선택을 직접 저장한다', async () => {
    const modelId = 'glm-direct-capacity';
    const harness = createHarness({
        models: [createModelRecord('zai', modelId)],
        selectedModels: { zai: modelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'capacity_manual_extension',
        selectId: 'capacity_manual_model',
        label: '요약 모델',
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    const staleMappings = {};
    for (let index = 0; Object.keys(staleMappings).length < EXTERNAL_SETTINGS_MAX_TARGETS; index += 1) {
        const candidate = `cmr-ext-${index.toString(16).padStart(8, '0')}`;
        if (candidate !== targetId) {
            staleMappings[candidate] = 'manual';
        }
    }
    const oldestStaleTarget = Object.keys(staleMappings)[0];
    harness.context.extensionSettings.customModelRouterExternalIntegrations = {
        schemaVersion: 1,
        mappings: staleMappings,
        selectedModels: {
            [oldestStaleTarget]: { zai: modelId },
        },
    };
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        external.select.value = modelId;
        external.select.dispatchEvent(new FakeEvent('change', { bubbles: true, isTrusted: true }));

        const stored = harness.context.extensionSettings.customModelRouterExternalIntegrations;
        assert.deepEqual(stored.mappings, {});
        assert.deepEqual(stored.selectedModels[targetId], { zai: modelId });
        assert.ok(external.select.querySelector('[data-cmr-external-group="true"]'));
        assert.ok(harness.saveCallCount >= 1);
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('SETTINGS_UPDATED는 외부 대상 제외와 복원을 controller·DOM에 즉시 반영한다', async () => {
    const modelId = 'glm-settings-exclusion-sync';
    const harness = createHarness({
        models: [createModelRecord('zai', modelId)],
        selectedModels: { zai: modelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'settings_exclusion_extension',
        selectId: 'settings_exclusion_model',
        label: '설정 동기화 모델',
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        external.select.value = modelId;
        external.select.dispatchEvent(new FakeEvent('change', { bubbles: true, isTrusted: true }));
        assert.ok(external.select.querySelector('[data-cmr-external-group="true"]'));

        const selectedModels = structuredClone(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels,
        );
        harness.context.extensionSettings.customModelRouterExternalIntegrations = {
            schemaVersion: 2,
            mappings: {},
            selectedModels,
            excludedTargets: { [targetId]: true },
        };
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);

        assert.ok(!external.select.querySelector('[data-cmr-external-group="true"]'));
        assert.equal(external.select.value, 'native-external-model');
        assert.equal(external.extensionState.model, 'native-external-model');
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels,
            selectedModels,
        );

        harness.context.extensionSettings.customModelRouterExternalIntegrations = {
            schemaVersion: 2,
            mappings: {},
            selectedModels,
            excludedTargets: {},
        };
        harness.eventSource.emit(harness.context.eventTypes.SETTINGS_UPDATED);
        await flushMicrotasks(8);

        const restoredGroup = external.select.querySelector('[data-cmr-external-group="true"]');
        assert.ok(restoredGroup);
        assert.deepEqual(restoredGroup.children.map(option => option.value), [modelId]);
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.excludedTargets,
            {},
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('portable backup 가져오기는 외부 대상 제외와 복원을 controller·DOM에 즉시 반영한다', async () => {
    const modelId = 'glm-backup-exclusion-sync';
    const harness = createHarness({
        models: [createModelRecord('zai', modelId)],
        selectedModels: { zai: modelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'backup_exclusion_extension',
        selectId: 'backup_exclusion_model',
        label: '백업 동기화 모델',
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const input = panel.querySelector('#cmr_import_backup');
        assert.ok(external.select.querySelector('[data-cmr-external-group="true"]'));

        const excludedBackup = createPortableV2Backup({
            providerId: 'zai',
            modelId,
            targetId,
            excludedTargets: { [targetId]: true },
        });
        input.files = [{ size: excludedBackup.length, text: async () => excludedBackup }];
        input.value = 'cmr-excluded-backup.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(16);

        assert.equal(panel.querySelector('#cmr_import_preview').hidden, false);
        assert.equal(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.excludedTargets[targetId],
            undefined,
        );
        panel.querySelector('#cmr_import_preview_apply').click();
        await flushMicrotasks(16);

        assert.ok(!external.select.querySelector('[data-cmr-external-group="true"]'));
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.excludedTargets,
            { [targetId]: true },
        );

        const restoredBackup = createPortableV2Backup({
            providerId: 'zai',
            modelId,
            targetId,
            excludedTargets: {},
        });
        input.files = [{ size: restoredBackup.length, text: async () => restoredBackup }];
        input.value = 'cmr-restored-backup.json';
        input.dispatchEvent(new FakeEvent('change'));
        await flushMicrotasks(16);

        assert.equal(panel.querySelector('#cmr_import_preview').hidden, false);
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.excludedTargets,
            { [targetId]: true },
        );
        panel.querySelector('#cmr_import_preview_apply').click();
        await flushMicrotasks(16);

        const restoredGroup = external.select.querySelector('[data-cmr-external-group="true"]');
        assert.ok(restoredGroup);
        assert.deepEqual(restoredGroup.children.map(option => option.value), [modelId]);
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.excludedTargets,
            {},
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('고급 외부 연결 관리는 대상 제외를 schema v2에 보존하고 재초기화 후 복원한다', async () => {
    const modelId = 'glm-exclusion-roundtrip';
    const harness = createHarness({
        models: [createModelRecord('zai', modelId)],
        selectedModels: { zai: modelId },
    });
    const external = appendExternalModelSelect(harness, {
        containerId: 'exclusion_roundtrip_extension',
        selectId: 'exclusion_roundtrip_model',
        label: '외부 요약 모델',
    });
    external.container.setAttribute('data-extension-name', 'Shared Tool');
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        let panel = openPanel(harness);
        let row = panel.querySelector('#cmr_external_picker_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        assert.equal(panel.querySelector('#cmr_external_warning').hidden, true);
        assert.ok(!panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`));
        assert.equal(row.querySelector('.cmr-external-state').textContent, '선택지 연결됨');

        const cmrOption = external.select.options.find(option => (
            option.dataset.cmrExternalModel === 'true' && option.dataset.cmrProvider === 'zai'
        ));
        cmrOption.selected = true;
        external.select.value = modelId;
        external.select.dispatchEvent(new FakeEvent('change', { bubbles: true, isTrusted: true }));
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.selectedModels[targetId],
            { zai: modelId },
        );

        const excludeButton = row.querySelector('[data-cmr-external-action="exclude"]');
        assert.equal(
            excludeButton.getAttribute('aria-label'),
            'Shared Tool · 외부 요약 모델 연결에서 제외',
        );
        excludeButton.focus();
        excludeButton.click();
        await flushMicrotasks();
        const excludedSettings = harness.context.extensionSettings.customModelRouterExternalIntegrations;
        assert.equal(excludedSettings.schemaVersion, 2);
        assert.deepEqual(excludedSettings.excludedTargets, { [targetId]: true });
        assert.deepEqual(excludedSettings.selectedModels[targetId], { zai: modelId });
        assert.ok(!external.select.querySelector('[data-cmr-external-group="true"]'));
        assert.equal(external.select.value, 'native-external-model');
        assert.equal(external.extensionState.model, 'native-external-model');
        assert.equal(panel.querySelector('#cmr_external_warning').hidden, true);
        row = panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        assert.equal(row.querySelector('.cmr-external-state').textContent, '사용자 제외');
        assert.ok(!panel.querySelector('#cmr_external_picker_list')
            .querySelector(`[data-target-id="${targetId}"]`));
        let restoreButton = row.querySelector('[data-cmr-external-action="restore"]');
        assert.ok(restoreButton);
        assert.ok(harness.documentRef.activeElement === restoreButton);
        assert.equal(
            restoreButton.getAttribute('aria-label'),
            'Shared Tool · 외부 요약 모델 다시 연결',
        );

        await destroy();
        assert.ok(!external.select.querySelector('[data-cmr-external-group="true"]'));
        await init();
        panel = openPanel(harness);
        row = panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        assert.equal(row.querySelector('.cmr-external-state').textContent, '사용자 제외');
        assert.deepEqual(
            harness.context.extensionSettings.customModelRouterExternalIntegrations.excludedTargets,
            { [targetId]: true },
        );
        assert.ok(!external.select.querySelector('[data-cmr-external-group="true"]'));

        restoreButton = row.querySelector('[data-cmr-external-action="restore"]');
        restoreButton.focus();
        restoreButton.click();
        await flushMicrotasks();
        const restoredSettings = harness.context.extensionSettings.customModelRouterExternalIntegrations;
        assert.deepEqual(restoredSettings.excludedTargets, {});
        assert.deepEqual(restoredSettings.selectedModels[targetId], { zai: modelId });
        assert.ok(external.select.querySelector('[data-cmr-external-group="true"]'));
        // 유효한 외부 native 값은 제외 해제 시 자동으로 덮어쓰지 않는다.
        assert.equal(external.select.value, 'native-external-model');
        assert.equal(panel.querySelector('#cmr_external_warning').hidden, true);
        assert.ok(!panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`));
        row = panel.querySelector('#cmr_external_picker_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        assert.ok(
            harness.documentRef.activeElement === row.querySelector('[data-cmr-external-action="exclude"]'),
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('외부 bridge 실패만 경고 카드를 노출하고 버튼으로 진단의 고급 관리를 연다', async () => {
    const harness = createHarness();
    const external = appendExternalModelSelect(harness, {
        containerId: 'broken_bridge_extension',
        selectId: 'broken_bridge_model',
        label: '깨진 외부 모델',
    });
    const targetId = createExternalTargetId(external.select, { documentRef: harness.documentRef });
    // 외부 비표준 DOM이 CMR optgroup 삽입을 거부하는 경우를 대상별로 격리한다.
    external.select.append = () => {
        throw new Error('external option host rejected insertion');
    };
    const restoreGlobals = installBrowserGlobals(harness);
    try {
        await init();
        const panel = openPanel(harness);
        const warning = panel.querySelector('#cmr_external_warning');
        const operations = panel.querySelector('#cmr_operations_section');
        const advanced = panel.querySelector('#cmr_external_advanced');

        assert.ok(!panel.querySelector('#cmr_external_section'));
        assert.equal(warning.hidden, false);
        assert.match(panel.querySelector('#cmr_external_warning_text').textContent, /1개 모델 칸/);
        assert.equal(operations.open, undefined);
        assert.equal(advanced.open, undefined);

        panel.querySelector('#cmr_external_warning_open').click();
        assert.equal(operations.open, true);
        assert.equal(advanced.open, true);
        assert.equal(advanced.scrollIntoViewCallCount, 1);
        let failedRow = panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        assert.equal(failedRow.querySelector('.cmr-external-state').textContent, '선택지 연결 실패');
        assert.equal(failedRow.querySelector('.cmr-external-verification').textContent, '이 대상 제외 가능');

        const excludeButton = failedRow.querySelector('[data-cmr-external-action="exclude"]');
        assert.ok(excludeButton);
        assert.ok(harness.documentRef.activeElement === excludeButton);
        excludeButton.focus();
        excludeButton.click();
        await flushMicrotasks();
        assert.equal(warning.hidden, true);
        let excludedRow = panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        assert.equal(excludedRow.querySelector('.cmr-external-state').textContent, '사용자 제외');
        const restoreButton = excludedRow.querySelector('[data-cmr-external-action="restore"]');
        assert.ok(harness.documentRef.activeElement === restoreButton);

        restoreButton.click();
        await flushMicrotasks();
        assert.equal(warning.hidden, false);
        assert.match(panel.querySelector('#cmr_external_warning_text').textContent, /1개 모델 칸/);
        failedRow = panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${targetId}"]`);
        assert.equal(failedRow.querySelector('.cmr-external-state').textContent, '선택지 연결 실패');
        assert.ok(
            harness.documentRef.activeElement
                === failedRow.querySelector('[data-cmr-external-action="exclude"]'),
        );
    } finally {
        await destroy();
        restoreGlobals();
    }
});

test('unknown target도 직접 연결하고 비대상과 수명주기를 안전하게 처리한다', async () => {
    const harness = createHarness();
    const restoreGlobals = installBrowserGlobals(harness);
    let autoTarget;
    try {
        await init();
        let panel = openPanel(harness);
        assert.ok(!panel.querySelector('#cmr_external_section'));
        assert.equal(panel.querySelector('#cmr_external_warning').hidden, true);
        assert.ok(panel.querySelector('#cmr_external_advanced'));
        assert.equal(harness.eventSource.listenerCount, 10);
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
        const riskTargetId = createExternalTargetId(
            excludedTarget.select,
            { documentRef: harness.documentRef },
        );
        const directTargetId = createExternalTargetId(
            autoTarget.select,
            { documentRef: harness.documentRef },
        );
        const ambiguousTargetId = createExternalTargetId(
            ambiguousTarget.select,
            { documentRef: harness.documentRef },
        );
        await init();
        panel = openPanel(harness);
        assert.ok(!panel.querySelector('#cmr_external_section'));
        assert.equal(panel.querySelector('#cmr_external_warning').hidden, true);
        assert.ok(!panel.querySelector('#cmr_external_list')
            .querySelector(`[data-target-id="${riskTargetId}"]`));
        assert.ok(!panel.querySelector('#cmr_external_picker_list')
            .querySelector(`[data-target-id="${riskTargetId}"]`));
        assert.ok(
            panel.querySelector('#cmr_external_picker_list').querySelector(`[data-target-id="${directTargetId}"]`),
        );
        assert.ok(
            panel.querySelector('#cmr_external_picker_list')
                .querySelector(`[data-target-id="${ambiguousTargetId}"]`),
        );
        assert.equal(panel.querySelector('#cmr_external_count').textContent, '설정 없음');
        assert.equal(globalThis.pwned, undefined);
        assert.equal(harness.eventSource.listenerCount, 10);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 2);
        assert.equal(autoTarget.select.listeners.get('change').length, 2);
        assert.ok(autoTarget.select.querySelector('[data-cmr-external-group="true"]'));
        assert.ok(ambiguousTarget.select.querySelector('[data-cmr-external-group="true"]'));
        assert.ok(!excludedTarget.select.querySelector('[data-cmr-external-group="true"]'));
    } finally {
        await destroy();
        if (autoTarget) {
            assert.equal(autoTarget.select.listeners.get('change').length, 1);
            assert.ok(!autoTarget.select.querySelector('[data-cmr-external-group="true"]'));
        }
        assert.equal(harness.eventSource.listenerCount, 0);
        assert.equal(harness.observers.filter(candidate => candidate.target).length, 0);
        delete globalThis.pwned;
        restoreGlobals();
    }
});
