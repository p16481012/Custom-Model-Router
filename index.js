import {
    ModelRegistryError,
    addModel,
    getEnabledModels,
    hasEnabledModel,
    normalizeModelId,
    normalizeSettings,
    removeModel,
    setSelectedModel,
} from './src/registry.js';
import {
    getNativeModelIds,
    isNativeModelOption,
    removeCustomGroup,
    selectVertexModel,
    syncVertexOptions,
} from './src/vertex-select.js';

const SETTINGS_KEY = 'customModelRouter';
const VERTEX_SELECT_SELECTOR = '#model_vertexai_select';
const VERTEX_OBSERVER_ROOT_SELECTOR = '#rm_api_block';
const SETTINGS_ROOT_SELECTOR = '#cmr_settings';
const EXTENSION_SETTINGS_TARGETS = ['#extensions_settings2', '#extensions_settings'];
const DEFAULT_VERTEX_MODEL = 'gemini-2.5-pro';

let context = null;
let settings = null;
let initialized = false;
let initializationPromise = null;
let lifecycleGeneration = 0;
let boundSelect = null;
let observer = null;
let observedContainer = null;
let syncScheduled = false;
let settingsRoot = null;
const subscribedEvents = [];

function getSillyTavernContext() {
    const api = globalThis.SillyTavern;
    if (!api || typeof api.getContext !== 'function') {
        throw new Error('SillyTavern.getContext()를 찾을 수 없습니다.');
    }

    const value = api.getContext();
    const required = [
        ['extensionSettings', value?.extensionSettings],
        ['saveSettingsDebounced', value?.saveSettingsDebounced],
        ['eventSource', value?.eventSource],
        ['eventTypes', value?.eventTypes ?? value?.event_types],
        ['chatCompletionSettings', value?.chatCompletionSettings],
    ];
    const missing = required.filter(([, item]) => !item).map(([name]) => name);

    if (missing.length) {
        throw new Error(`필수 SillyTavern API가 없습니다: ${missing.join(', ')}`);
    }

    return {
        ...value,
        eventTypes: value.eventTypes ?? value.event_types,
    };
}

function persistSettings() {
    context.extensionSettings[SETTINGS_KEY] = settings;
    context.saveSettingsDebounced();
}

function updateSelectedModel(modelId, save = true) {
    const next = setSelectedModel(settings, modelId);
    if (next.selectedModelId === settings.selectedModelId) {
        return false;
    }

    settings = next;
    if (save) {
        persistSettings();
    }
    return true;
}

function getVertexSelect() {
    const element = document.querySelector(VERTEX_SELECT_SELECTOR);
    return element?.tagName === 'SELECT' ? element : null;
}

function announce(message, state = 'ok') {
    const feedback = settingsRoot?.querySelector('#cmr_feedback');
    if (!feedback) {
        return;
    }

    feedback.dataset.state = state;
    feedback.textContent = message;
}

function renderCompatibilityStatus() {
    const status = settingsRoot?.querySelector('#cmr_compatibility');
    if (!status) {
        return;
    }

    const select = getVertexSelect();
    status.dataset.state = select ? 'ok' : 'error';
    status.textContent = select
        ? '호환됨: Google Vertex AI 모델 선택기를 찾았습니다.'
        : '호환성 오류: Google Vertex AI 모델 선택기를 찾지 못했습니다.';
}

function createBadge(text, kind) {
    const badge = document.createElement('span');
    badge.className = 'cmr-badge';
    badge.dataset.kind = kind;
    badge.textContent = text;
    return badge;
}

function renderModelList() {
    const list = settingsRoot?.querySelector('#cmr_model_list');
    if (!list || !settings) {
        return;
    }

    const models = getEnabledModels(settings);
    const select = getVertexSelect();
    const currentModel = normalizeModelId(context?.chatCompletionSettings?.vertexai_model);
    const nativeIds = select ? getNativeModelIds(select) : new Set();
    list.replaceChildren();

    if (models.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cmr-empty';
        empty.textContent = '아직 등록된 모델이 없습니다.';
        list.append(empty);
        return;
    }

    for (const model of models) {
        const row = document.createElement('div');
        row.className = 'cmr-model-row';

        const info = document.createElement('div');
        info.className = 'cmr-model-info';

        const modelId = document.createElement('code');
        modelId.className = 'cmr-model-id';
        modelId.textContent = model.id;

        const badges = document.createElement('div');
        badges.className = 'cmr-model-badges';
        if (currentModel === model.id) {
            badges.append(createBadge('현재 선택', 'selected'));
        }
        if (nativeIds.has(model.id)) {
            badges.append(createBadge('SillyTavern 기본 지원', 'core'));
        } else {
            badges.append(createBadge('사용자 등록', 'custom'));
        }

        info.append(modelId, badges);

        const actions = document.createElement('div');
        actions.className = 'cmr-model-actions';

        const selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.className = 'menu_button menu_button_icon';
        selectButton.dataset.cmrAction = 'select';
        selectButton.dataset.modelId = model.id;
        selectButton.disabled = currentModel === model.id || !select;
        selectButton.title = select ? '이 모델을 Vertex AI 모델로 선택' : 'Vertex AI 모델 선택기를 찾을 수 없음';
        const selectIcon = document.createElement('i');
        selectIcon.className = 'fa-solid fa-check';
        selectIcon.setAttribute('aria-hidden', 'true');
        const selectText = document.createElement('span');
        selectText.textContent = '선택';
        selectButton.append(selectIcon, selectText);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'menu_button menu_button_icon';
        deleteButton.dataset.cmrAction = 'delete';
        deleteButton.dataset.modelId = model.id;
        deleteButton.title = '등록 목록에서 삭제';
        const deleteIcon = document.createElement('i');
        deleteIcon.className = 'fa-solid fa-trash-can';
        deleteIcon.setAttribute('aria-hidden', 'true');
        const deleteText = document.createElement('span');
        deleteText.textContent = '삭제';
        deleteButton.append(deleteIcon, deleteText);

        actions.append(selectButton, deleteButton);
        row.append(info, actions);
        list.append(row);
    }
}

function renderUi() {
    renderCompatibilityStatus();
    renderModelList();
}

function onVertexSelectChange(event) {
    const value = normalizeModelId(event.currentTarget?.value);

    if (hasEnabledModel(settings, value)) {
        updateSelectedModel(value);
    } else if (value) {
        updateSelectedModel(null);
    } else {
        scheduleSync();
    }

    renderModelList();
}

function bindVertexSelect(select) {
    if (boundSelect === select) {
        return;
    }

    boundSelect?.removeEventListener('change', onVertexSelectChange);
    boundSelect = select;
    boundSelect?.addEventListener('change', onVertexSelectChange);
}

function connectObserver(select) {
    if (typeof MutationObserver !== 'function') {
        return;
    }

    const container = document.querySelector(VERTEX_OBSERVER_ROOT_SELECTOR)
        ?? document.body
        ?? select?.parentElement;
    if (!container) {
        return;
    }

    if (!observer) {
        observer = new MutationObserver(() => scheduleSync());
    }

    observer.disconnect();
    observedContainer = container;
    observer.observe(observedContainer, { childList: true, subtree: true });
}

function synchronize() {
    if (!context || !settings) {
        return;
    }

    observer?.disconnect();
    const select = getVertexSelect();
    bindVertexSelect(select);

    if (!select) {
        connectObserver(null);
        renderUi();
        return;
    }

    syncVertexOptions(select, getEnabledModels(settings));

    const configuredModel = normalizeModelId(context.chatCompletionSettings.vertexai_model);
    const selectedModel = settings.selectedModelId;

    if (configuredModel && hasEnabledModel(settings, configuredModel)) {
        updateSelectedModel(configuredModel);
        select.value = configuredModel;
    } else if (configuredModel) {
        updateSelectedModel(null);
        if (Array.from(select.options).some(option => String(option.value) === configuredModel)) {
            select.value = configuredModel;
        }
    } else if (selectedModel && hasEnabledModel(settings, selectedModel)) {
        selectVertexModel(select, selectedModel);
    }

    connectObserver(select);
    renderUi();
}

function scheduleSync() {
    if (syncScheduled) {
        return;
    }

    syncScheduled = true;
    queueMicrotask(() => {
        syncScheduled = false;
        synchronize();
    });
}

function onSettingsUpdated() {
    if (!context) {
        return;
    }

    const storedSettings = context.extensionSettings[SETTINGS_KEY];
    if (storedSettings !== settings) {
        settings = normalizeSettings(storedSettings);
        context.extensionSettings[SETTINGS_KEY] = settings;
    }

    scheduleSync();
}

function subscribeToSillyTavernEvents() {
    const bindings = [
        [context.eventTypes.APP_INITIALIZED, scheduleSync],
        [context.eventTypes.SETTINGS_UPDATED, onSettingsUpdated],
        [context.eventTypes.CHATCOMPLETION_SOURCE_CHANGED, scheduleSync],
        [context.eventTypes.CHATCOMPLETION_MODEL_CHANGED, scheduleSync],
        [context.eventTypes.OAI_PRESET_CHANGED_AFTER, scheduleSync],
        [context.eventTypes.CONNECTION_PROFILE_LOADED, scheduleSync],
    ];
    const seen = new Set();

    for (const [eventName, handler] of bindings) {
        if (typeof eventName !== 'string' || !eventName || seen.has(eventName)) {
            continue;
        }

        seen.add(eventName);
        context.eventSource.on(eventName, handler);
        subscribedEvents.push({ eventName, handler });
    }
}

async function mountSettingsUi(generation) {
    if (generation !== lifecycleGeneration) {
        return false;
    }

    const existing = document.querySelector(SETTINGS_ROOT_SELECTOR);
    if (existing) {
        settingsRoot = existing;
        return true;
    }

    const target = EXTENSION_SETTINGS_TARGETS
        .map(selector => document.querySelector(selector))
        .find(Boolean);

    if (!target) {
        throw new Error('확장 설정 패널을 찾을 수 없습니다.');
    }

    const response = await fetch(new URL('./settings.html', import.meta.url));
    if (!response.ok) {
        throw new Error(`설정 UI를 불러오지 못했습니다. HTTP ${response.status}`);
    }

    const html = (await response.text()).trim();
    if (generation !== lifecycleGeneration) {
        return false;
    }

    const template = document.createElement('template');
    template.innerHTML = html;
    const root = template.content.firstElementChild;
    if (!root) {
        throw new Error('설정 UI가 비어 있습니다.');
    }

    target.append(root);
    settingsRoot = root;
    settingsRoot.querySelector('#cmr_add_form')?.addEventListener('submit', onAddModel);
    settingsRoot.querySelector('#cmr_model_list')?.addEventListener('click', onModelListClick);
    return true;
}

function onAddModel(event) {
    event.preventDefault();
    const input = settingsRoot?.querySelector('#cmr_model_id');

    try {
        const id = normalizeModelId(input?.value);
        const select = getVertexSelect();
        if (select && isNativeModelOption(select, id)) {
            throw new ModelRegistryError('core_duplicate', '이미 SillyTavern 기본 목록에 있는 모델입니다.');
        }

        settings = addModel(settings, id);
        persistSettings();
        if (input) {
            input.value = '';
        }
        synchronize();
        announce(`${id} 모델을 등록했습니다.`);
    } catch (error) {
        const message = error instanceof ModelRegistryError
            ? error.message
            : '모델을 등록하지 못했습니다.';
        announce(message, 'error');
    }
}

function onModelListClick(event) {
    const button = event.target?.closest?.('[data-cmr-action]');
    if (!button || !settingsRoot?.contains(button)) {
        return;
    }

    const modelId = normalizeModelId(button.dataset.modelId);
    const action = button.dataset.cmrAction;

    if (action === 'select') {
        synchronize();
        const select = getVertexSelect();
        if (!select || !selectVertexModel(select, modelId)) {
            announce('Vertex AI 모델 선택기에 모델을 적용하지 못했습니다.', 'error');
            return;
        }

        updateSelectedModel(modelId);
        renderModelList();
        announce(`${modelId} 모델을 Vertex AI 모델로 선택했습니다.`);
        return;
    }

    if (action === 'delete') {
        const select = getVertexSelect();
        const currentModel = normalizeModelId(context.chatCompletionSettings.vertexai_model);
        const hasNativeReplacement = select && isNativeModelOption(select, modelId);

        if (currentModel === modelId && !hasNativeReplacement) {
            announce('현재 선택 중인 모델입니다. 먼저 다른 Vertex 모델을 선택해 주세요.', 'error');
            return;
        }

        settings = removeModel(settings, modelId);
        persistSettings();
        synchronize();
        announce(`${modelId} 모델을 삭제했습니다.`);
    }
}

function getNativeFallbackModel(select) {
    const nativeIds = getNativeModelIds(select);
    if (nativeIds.has(DEFAULT_VERTEX_MODEL)) {
        return DEFAULT_VERTEX_MODEL;
    }

    const option = Array.from(select?.options ?? []).find(candidate => (
        !candidate.disabled
        && normalizeModelId(candidate.value)
        && nativeIds.has(String(candidate.value))
    ));
    return option ? String(option.value) : null;
}

function teardownRuntime({ applyNativeFallback = false } = {}) {
    observer?.disconnect();
    observer = null;
    observedContainer = null;

    let removeGroup = true;
    if (applyNativeFallback && boundSelect && context && settings) {
        const configuredModel = normalizeModelId(
            context.chatCompletionSettings.vertexai_model || boundSelect.value,
        );
        const isCustomOnly = hasEnabledModel(settings, configuredModel)
            && !isNativeModelOption(boundSelect, configuredModel);

        if (isCustomOnly) {
            const fallbackModel = getNativeFallbackModel(boundSelect);
            removeGroup = Boolean(fallbackModel && selectVertexModel(boundSelect, fallbackModel));
        }
    }

    boundSelect?.removeEventListener('change', onVertexSelectChange);
    if (removeGroup) {
        removeCustomGroup(boundSelect);
    }
    boundSelect = null;

    if (context) {
        for (const { eventName, handler } of subscribedEvents.splice(0)) {
            context.eventSource.removeListener(eventName, handler);
        }
    } else {
        subscribedEvents.length = 0;
    }

    settingsRoot?.remove();
    settingsRoot = null;
    context = null;
    settings = null;
    syncScheduled = false;
    initialized = false;
}

async function initialize(generation) {
    context = getSillyTavernContext();
    const storedSettings = context.extensionSettings[SETTINGS_KEY];
    settings = normalizeSettings(storedSettings);
    const settingsChanged = JSON.stringify(storedSettings) !== JSON.stringify(settings);

    context.extensionSettings[SETTINGS_KEY] = settings;
    subscribeToSillyTavernEvents();
    synchronize();

    const mounted = await mountSettingsUi(generation);
    if (!mounted || generation !== lifecycleGeneration) {
        return;
    }
    renderUi();

    if (settingsChanged) {
        persistSettings();
    }

    initialized = true;
    console.info('[Custom Model Router] v0.1.0 초기화 완료');
}

export function init() {
    if (initialized) {
        return Promise.resolve();
    }

    if (initializationPromise) {
        return initializationPromise;
    }

    const generation = ++lifecycleGeneration;
    const runPromise = initialize(generation).catch(error => {
        if (generation === lifecycleGeneration) {
            teardownRuntime({ applyNativeFallback: true });
        }
        throw error;
    });
    const trackedPromise = runPromise.finally(() => {
        if (initializationPromise === trackedPromise) {
            initializationPromise = null;
        }
    });
    initializationPromise = trackedPromise;
    return trackedPromise;
}

export function destroy() {
    lifecycleGeneration += 1;
    initializationPromise = null;
    teardownRuntime({ applyNativeFallback: true });
}
