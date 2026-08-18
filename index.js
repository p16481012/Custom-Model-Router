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
const CONNECTION_PROFILE_SELECTOR = '#connection_profiles';
const API_TITLE_SELECTOR = '#title_api';
const LAUNCHER_SELECTOR = '#cmr_open_manager';
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
let settingsTemplateHtml = '';
let launcherButton = null;
let launcherCount = null;
let activePopup = null;
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
        ['Popup', value?.Popup],
        ['POPUP_TYPE', value?.POPUP_TYPE],
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

function getLauncherHost() {
    const profiles = document.querySelector(CONNECTION_PROFILE_SELECTOR);
    return profiles?.parentElement ?? document.querySelector(API_TITLE_SELECTOR);
}

function renderLauncher() {
    if (!launcherButton || !settings) {
        return;
    }

    const modelCount = getEnabledModels(settings).length;
    const hasVertexSelect = Boolean(getVertexSelect());
    launcherButton.disabled = !settingsTemplateHtml;
    launcherButton.dataset.state = hasVertexSelect ? 'ready' : 'warning';
    launcherButton.setAttribute('aria-expanded', String(Boolean(activePopup)));
    launcherButton.setAttribute(
        'aria-label',
        `사용자 지정 Vertex 모델 관리, ${modelCount}개 등록됨${hasVertexSelect ? '' : ', Vertex 선택기 연결 안 됨'}`,
    );
    launcherButton.title = settingsTemplateHtml
        ? '사용자 지정 Vertex 모델 관리'
        : '모델 관리 패널을 불러오는 중';

    if (launcherCount) {
        const countText = String(modelCount);
        if (launcherCount.textContent !== countText) {
            launcherCount.textContent = countText;
        }
        launcherCount.hidden = modelCount === 0;
    }
}

function ensureLauncher() {
    const host = getLauncherHost();
    if (!host) {
        return;
    }

    if (!launcherButton) {
        const existing = document.querySelector(LAUNCHER_SELECTOR);
        if (existing) {
            existing.remove();
        }

        launcherButton = document.createElement('button');
        launcherButton.id = LAUNCHER_SELECTOR.slice(1);
        launcherButton.type = 'button';
        launcherButton.className = 'menu_button cmr-launcher';
        launcherButton.setAttribute('aria-haspopup', 'dialog');
        launcherButton.setAttribute('aria-controls', 'cmr_manager_dialog');
        launcherButton.setAttribute('aria-expanded', 'false');

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-route';
        icon.setAttribute('aria-hidden', 'true');

        launcherCount = document.createElement('span');
        launcherCount.className = 'cmr-launcher-count';
        launcherCount.setAttribute('aria-hidden', 'true');

        launcherButton.append(icon, launcherCount);
        launcherButton.addEventListener('click', openSettingsPanel);
    }

    if (launcherButton.parentElement !== host) {
        host.append(launcherButton);
    }

    renderLauncher();
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
        ? 'Vertex 모델 선택기 연결됨'
        : 'Vertex 모델 선택기를 찾지 못했습니다.';
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
    const count = settingsRoot?.querySelector('#cmr_model_count');
    if (count) {
        count.textContent = `${models.length}개`;
    }
    list.replaceChildren();

    if (models.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'cmr-empty';
        empty.textContent = '등록한 모델이 없습니다. 위 입력란에서 모델 ID를 추가하세요.';
        list.append(empty);
        return;
    }

    for (const model of models) {
        const isCurrent = currentModel === model.id;
        const row = document.createElement('li');
        row.className = 'cmr-model-row';
        row.dataset.current = String(isCurrent);
        if (isCurrent) {
            row.setAttribute('aria-current', 'true');
        }

        const info = document.createElement('div');
        info.className = 'cmr-model-summary';

        const modelId = document.createElement('code');
        modelId.className = 'cmr-model-id';
        modelId.textContent = model.id;
        modelId.title = model.id;

        const badges = document.createElement('div');
        badges.className = 'cmr-model-badges';
        if (isCurrent) {
            badges.append(createBadge('현재', 'selected'));
        }
        if (nativeIds.has(model.id)) {
            badges.append(createBadge('기본 지원', 'core'));
        }

        info.append(modelId, badges);

        const actions = document.createElement('div');
        actions.className = 'cmr-model-actions';

        const selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.className = 'menu_button cmr-icon-button';
        selectButton.dataset.cmrAction = 'select';
        selectButton.dataset.modelId = model.id;
        selectButton.disabled = isCurrent || !select;
        selectButton.title = isCurrent
            ? '현재 선택된 모델'
            : (select ? 'Vertex 모델로 적용' : 'Vertex AI 모델 선택기를 찾을 수 없음');
        selectButton.setAttribute(
            'aria-label',
            isCurrent ? `${model.id}, 현재 선택된 모델` : `${model.id} 모델을 Vertex 모델로 적용`,
        );
        const selectIcon = document.createElement('i');
        selectIcon.className = 'fa-solid fa-check';
        selectIcon.setAttribute('aria-hidden', 'true');
        selectButton.append(selectIcon);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'menu_button cmr-icon-button cmr-delete-button';
        deleteButton.dataset.cmrAction = 'delete';
        deleteButton.dataset.modelId = model.id;
        const deleteRequiresModelChange = isCurrent && !nativeIds.has(model.id);
        deleteButton.title = deleteRequiresModelChange
            ? '다른 Vertex 모델을 선택한 뒤 삭제할 수 있습니다.'
            : '등록 삭제';
        deleteButton.setAttribute('aria-disabled', String(deleteRequiresModelChange));
        deleteButton.setAttribute('aria-label', `${model.id} 모델 등록 삭제`);
        const deleteIcon = document.createElement('i');
        deleteIcon.className = 'fa-solid fa-trash-can';
        deleteIcon.setAttribute('aria-hidden', 'true');
        deleteButton.append(deleteIcon);

        actions.append(selectButton, deleteButton);
        row.append(info, actions);
        list.append(row);
    }
}

function renderUi() {
    renderLauncher();
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
    ensureLauncher();
    bindVertexSelect(select);

    if (!select) {
        renderUi();
        connectObserver(null);
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

    renderUi();
    connectObserver(select);
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

async function loadSettingsTemplate(generation) {
    if (generation !== lifecycleGeneration) {
        return false;
    }

    if (settingsTemplateHtml) {
        return true;
    }

    const response = await fetch(new URL('./settings.html', import.meta.url));
    if (!response.ok) {
        throw new Error(`설정 UI를 불러오지 못했습니다. HTTP ${response.status}`);
    }

    const html = (await response.text()).trim();
    if (generation !== lifecycleGeneration) {
        return false;
    }

    if (!html) {
        throw new Error('설정 UI가 비어 있습니다.');
    }

    settingsTemplateHtml = html;
    renderLauncher();
    return true;
}

function createSettingsPanel() {
    if (!settingsTemplateHtml) {
        throw new Error('설정 UI가 아직 준비되지 않았습니다.');
    }

    const template = document.createElement('template');
    template.innerHTML = settingsTemplateHtml;
    const root = template.content.firstElementChild;
    if (!root) {
        throw new Error('설정 UI가 비어 있습니다.');
    }

    settingsRoot = root;
    settingsRoot.querySelector('#cmr_add_form')?.addEventListener('submit', onAddModel);
    settingsRoot.querySelector('#cmr_model_list')?.addEventListener('click', onModelListClick);
    settingsRoot.addEventListener('keydown', onPanelKeyDown);
    return root;
}

function onPanelKeyDown(event) {
    if (event.key === 'Enter') {
        event.stopPropagation();
    }
}

function handlePopupClosed(popup, root) {
    if (activePopup === popup) {
        activePopup = null;
    }
    if (settingsRoot === root) {
        settingsRoot = null;
    }

    renderLauncher();
    if (launcherButton?.parentElement) {
        launcherButton.focus?.();
    }
}

function handlePopupShowFailure(popup, root, error) {
    popup?.dlg?.remove?.();
    const popupList = context?.Popup?.util?.popups;
    if (Array.isArray(popupList)) {
        const popupIndex = popupList.indexOf(popup);
        if (popupIndex >= 0) {
            popupList.splice(popupIndex, 1);
        }
    }

    handlePopupClosed(popup, root);
    console.error('[Custom Model Router] 모델 관리 패널을 열지 못했습니다.', error);
}

function openSettingsPanel() {
    if (!context || !settingsTemplateHtml) {
        return;
    }

    if (activePopup) {
        activePopup.setAutoFocus?.();
        return;
    }

    let root;
    let popup;
    try {
        root = createSettingsPanel();
        popup = new context.Popup(root, context.POPUP_TYPE.DISPLAY, '', {
            wider: true,
            leftAlign: true,
            allowVerticalScrolling: true,
            allowHorizontalScrolling: false,
            allowEscapeClose: true,
            animation: 'fast',
            onClose: () => handlePopupClosed(popup, root),
        });
        popup.dlg.id = 'cmr_manager_dialog';
        popup.dlg.classList?.add('cmr-manager-dialog');
        popup.dlg.setAttribute?.('aria-labelledby', 'cmr_panel_title');
        activePopup = popup;
        renderUi();

        void popup.show().catch(error => {
            handlePopupShowFailure(popup, root, error);
        });
    } catch (error) {
        settingsRoot = null;
        console.error('[Custom Model Router] 모델 관리 패널을 만들지 못했습니다.', error);
        renderLauncher();
    }
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
            input.setAttribute('aria-invalid', 'false');
            input.focus?.();
        }
        synchronize();
        announce(`${id} 모델을 등록했습니다.`);
    } catch (error) {
        const message = error instanceof ModelRegistryError
            ? error.message
            : '모델을 등록하지 못했습니다.';
        input?.setAttribute('aria-invalid', 'true');
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
    activePopup = null;
    launcherButton?.removeEventListener('click', openSettingsPanel);
    launcherButton?.remove();
    launcherButton = null;
    launcherCount = null;
    settingsTemplateHtml = '';
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

    const loaded = await loadSettingsTemplate(generation);
    if (!loaded || generation !== lifecycleGeneration) {
        return;
    }
    renderUi();

    if (settingsChanged) {
        persistSettings();
    }

    initialized = true;
    console.info('[Custom Model Router] v0.1.2 초기화 완료');
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

export async function destroy() {
    lifecycleGeneration += 1;
    initializationPromise = null;

    const popup = activePopup;
    if (popup && typeof popup.completeCancelled === 'function') {
        try {
            await popup.completeCancelled();
        } catch (error) {
            console.warn('[Custom Model Router] 모델 관리 패널을 닫는 중 오류가 발생했습니다.', error);
        }
    }

    teardownRuntime({ applyNativeFallback: true });
}
