import {
    ModelRegistryError,
    addModel,
    getEnabledModels,
    getSelectedModel,
    hasEnabledModel,
    normalizeModelId,
    normalizeSettings,
    removeModel,
    setSelectedModel,
} from './src/registry.js';
import {
    CATALOG_MODEL_ID_MAX_LENGTH,
    MODEL_ID_MAX_LENGTH,
    PROVIDER_IDS,
    getProvider,
    getProviders,
} from './src/providers.js';
import {
    getCustomGroup,
    getNativeFallbackModel,
    hasModelOption,
    isNativeModelOption,
    removeCustomGroup,
    selectModel,
    syncModelOptions,
} from './src/model-select.js';
import {
    createRegistryApi,
    installRegistryApi,
} from './src/registry-api.js';
import {
    PurposeRouter,
    createPurposeRoutingApi,
    normalizePurposeRoutes,
} from './src/purpose-router.js';
import { createSillyTavernConnectionProfileAdapter } from './src/connection-profile-adapter.js';
import {
    createStabilityMonitor,
    diagnoseCompatibility,
} from './src/compatibility.js';
import {
    PORTABLE_SETTINGS_MAX_LENGTH,
    PortableSettingsError,
    parsePortableSettings,
    repairSettingsBundle,
    stringifyPortableSettings,
} from './src/portable-settings.js';
import {
    createExternalIntegrationController,
} from './src/external-integrations.js';
import {
    ExternalSettingsError,
    normalizeAutomaticExternalSettings,
    removeExternalSelectedModel,
    removeExternalTargetSelections,
    setExternalSelectedModel,
} from './src/external-settings.js';

const EXTENSION_VERSION = '0.6.7';
const SETTINGS_KEY = 'customModelRouter';
const ROUTES_SETTINGS_KEY = 'customModelRouterRouting';
const EXTERNAL_SETTINGS_KEY = 'customModelRouterExternalIntegrations';
const OBSERVER_ROOT_SELECTOR = '#rm_api_block';
const CONNECTION_PROFILE_SELECTOR = '#connection_profiles';
const API_TITLE_SELECTOR = '#title_api';
const LAUNCHER_SELECTOR = '#cmr_open_manager';
const MODEL_LIST_SCROLL_THRESHOLD = 6;
const PROVIDER_GROUPS = [
    {
        label: '모델 개발사 API',
        ids: [
            'openai', 'claude', 'ai21', 'cohere', 'deepseek', 'makersuite', 'vertexai',
            'groq', 'mistralai', 'minimax', 'moonshot', 'perplexity', 'xai', 'zai',
        ],
    },
    {
        label: '라우터·호스팅 플랫폼',
        ids: [
            'aimlapi', 'chutes', 'workers_ai', 'electronhub', 'fireworks', 'nanogpt',
            'openrouter', 'pollinations', 'siliconflow',
        ],
    },
    {
        label: '사용자 지정 연결',
        ids: ['custom'],
    },
];

let context = null;
let settings = null;
let initialized = false;
let initializationPromise = null;
let destructionPromise = null;
let lifecycleGeneration = 0;
let observer = null;
let observedContainer = null;
let syncScheduled = false;
let settingsRoot = null;
let settingsTemplateHtml = '';
let launcherButton = null;
let launcherCount = null;
let activePopup = null;
let activeProviderId = null;
let registryApiController = null;
let uninstallRegistryApi = null;
let routingSettings = null;
let externalSettings = null;
let externalIntegrationController = null;
let purposeRouter = null;
let unregisterConnectionProfileAdapter = null;
let stabilityMonitor = null;
let lastDiagnosticReport = null;
let lastRepairReport = null;
let acceptedSettingsSnapshot = null;
let acceptedRoutingSnapshot = null;
let acceptedExternalSnapshot = null;
const boundControls = new Map();
const pendingRestores = new Set();
const pendingNativeChecks = new Map();
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

function getLiveContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? context;
    } catch {
        return context;
    }
}

function getConfiguredModel(provider) {
    return normalizeModelId(context?.chatCompletionSettings?.[provider.settingKey]);
}

function getProviderControl(provider) {
    const element = document.querySelector(provider.selector);
    const expectedTag = provider.controlType === 'select' ? 'SELECT' : 'INPUT';
    return element?.tagName === expectedTag ? element : null;
}

function isProtectedConfiguredModel(provider, modelId) {
    if (provider.controlType !== 'select' || getConfiguredModel(provider) !== modelId) {
        return false;
    }
    const control = getProviderControl(provider);
    return !control || !isNativeModelOption(control, modelId);
}

function isProviderActive(provider) {
    const liveContext = getLiveContext();
    return liveContext?.mainApi === provider.mainApi
        && context?.chatCompletionSettings?.chat_completion_source === provider.source;
}

function findActiveProvider() {
    return getProviders().find(isProviderActive) ?? null;
}

function findInitialProviderId() {
    return findActiveProvider()?.id ?? PROVIDER_IDS.VERTEXAI;
}

function rememberAcceptedSettings() {
    acceptedSettingsSnapshot = normalizeSettings(settings);
    acceptedRoutingSnapshot = normalizePurposeRoutes(routingSettings);
    acceptedExternalSnapshot = normalizeAutomaticExternalSettings(externalSettings);
}

function assertRegistryReplacementSafe(nextSettings) {
    const normalized = normalizeSettings(nextSettings);
    for (const model of getEnabledModels(settings)) {
        if (hasEnabledModel(normalized, model.provider, model.id)) {
            continue;
        }
        const provider = getProvider(model.provider);
        if (provider && isProtectedConfiguredModel(provider, model.id)) {
            throw new ModelRegistryError(
                'model_in_use',
                `${provider.label}에서 현재 사용 중인 모델은 다른 모델을 선택하기 전에 등록 해제할 수 없습니다.`,
            );
        }
    }
    return normalized;
}

function persistSettings(source = 'runtime') {
    context.extensionSettings[SETTINGS_KEY] = settings;
    acceptedSettingsSnapshot = normalizeSettings(settings);
    context.saveSettingsDebounced();
    registryApiController?.synchronize(source);
}

function writeRegistryApiSettings(nextSettings) {
    const normalized = assertRegistryReplacementSafe(nextSettings);

    settings = normalized;
    context.extensionSettings[SETTINGS_KEY] = settings;
    acceptedSettingsSnapshot = normalizeSettings(settings);
    context.saveSettingsDebounced();
    scheduleSync();
}

function persistRoutingSettings(nextRoutes) {
    routingSettings = normalizePurposeRoutes(nextRoutes);
    context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
    acceptedRoutingSnapshot = normalizePurposeRoutes(routingSettings);
    context.saveSettingsDebounced();
}

function getRuntimeMetrics(phase = 'active') {
    const externalMetrics = externalIntegrationController?.getMetrics?.() ?? {};
    const coreModelGroupCount = Array.from(
        document.querySelectorAll?.('optgroup[data-cmr-provider]') ?? [],
    ).filter(group => group?.dataset?.cmrExternalGroup !== 'true').length;
    return {
        phase,
        launcherCount: launcherButton?.parentElement ? 1 : 0,
        panelCount: activePopup ? 1 : 0,
        observerCount: observer && observedContainer ? 1 : 0,
        listenerCount: subscribedEvents.length,
        boundControlCount: boundControls.size,
        modelGroupCount: coreModelGroupCount,
        externalObserverCount: externalMetrics.observerCount ?? 0,
        externalListenerCount: externalMetrics.listenerCount ?? 0,
        externalTargetCount: externalMetrics.targetCount ?? 0,
        externalDirectCount: externalMetrics.directCount ?? 0,
        pendingTaskCount: pendingRestores.size + pendingNativeChecks.size + (syncScheduled ? 1 : 0),
    };
}

function recordStabilitySample(reason) {
    stabilityMonitor?.record(reason, getRuntimeMetrics());
}

function updateSelectedModel(providerId, modelId, save = true) {
    const before = getSelectedModel(settings, providerId);
    const next = setSelectedModel(settings, providerId, modelId);
    const after = getSelectedModel(next, providerId);
    if (before === after) {
        return false;
    }

    settings = next;
    if (save) {
        persistSettings('model-selection');
    }
    return true;
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
    const detectedCount = getProviders().filter(provider => getProviderControl(provider)).length;
    launcherButton.disabled = !settingsTemplateHtml;
    launcherButton.dataset.state = detectedCount > 0 ? 'ready' : 'warning';
    launcherButton.setAttribute('aria-expanded', String(Boolean(activePopup)));
    launcherButton.setAttribute(
        'aria-label',
        `사용자 모델 관리, ${modelCount}개 등록됨${detectedCount ? '' : ', 지원 모델 컨트롤을 찾지 못함'}`,
    );
    launcherButton.title = settingsTemplateHtml ? '사용자 모델 관리' : '모델 관리 패널을 불러오는 중';

    if (launcherCount) {
        const countText = modelCount > 99 ? '99+' : String(modelCount);
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
        document.querySelector(LAUNCHER_SELECTOR)?.remove();
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
    feedback.textContent = formatUiSentences(message);
}

function formatUiSentences(value) {
    return String(value ?? '').replace(/([.!?])\s+(?=\S)/g, '$1\n');
}

function createOption(provider) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    return option;
}

function populateProviderSelect() {
    const select = settingsRoot?.querySelector('#cmr_provider');
    if (!select) {
        return;
    }

    const providers = new Map(getProviders().map(provider => [provider.id, provider]));
    const groups = [];
    for (const definition of PROVIDER_GROUPS) {
        const group = document.createElement('optgroup');
        group.label = definition.label;
        for (const providerId of definition.ids) {
            const provider = providers.get(providerId);
            if (provider) {
                group.append(createOption(provider));
                providers.delete(providerId);
            }
        }
        if (group.children.length) {
            groups.push(group);
        }
    }

    if (providers.size) {
        const group = document.createElement('optgroup');
        group.label = '기타';
        for (const provider of providers.values()) {
            group.append(createOption(provider));
        }
        groups.push(group);
    }

    select.replaceChildren(...groups);
    select.value = activeProviderId;
}

function getProviderHelp(provider) {
    if (provider.validator === 'path-segment') {
        return 'Google 모델 경로 한 구간만 입력합니다. 영문자, 숫자, 마침표, 밑줄, 하이픈만 허용합니다.';
    }
    if (provider.validator === 'catalog') {
        return '공식 모델 ID를 입력합니다. 계층형 ID의 /, :, +, @를 허용하지만 URL·공백은 허용하지 않습니다.';
    }
    return '공식 모델 ID를 입력합니다. 영문자, 숫자, 마침표, 밑줄, 콜론, 하이픈을 사용할 수 있습니다.';
}

function renderProviderFields() {
    const provider = getProvider(activeProviderId);
    if (!settingsRoot || !provider) {
        return;
    }

    const providerSelect = settingsRoot.querySelector('#cmr_provider');
    if (providerSelect && providerSelect.value !== provider.id) {
        providerSelect.value = provider.id;
    }
    const label = settingsRoot.querySelector('#cmr_model_label');
    if (label) {
        label.textContent = `${provider.label} 모델 ID`;
    }
    const input = settingsRoot.querySelector('#cmr_model_id');
    if (input) {
        input.placeholder = provider.placeholder;
        input.maxLength = provider.validator === 'catalog'
            ? CATALOG_MODEL_ID_MAX_LENGTH
            : MODEL_ID_MAX_LENGTH;
    }
    const help = settingsRoot.querySelector('#cmr_model_help');
    if (help) {
        help.textContent = formatUiSentences(getProviderHelp(provider));
    }
}

function renderCompatibilityStatus() {
    const status = settingsRoot?.querySelector('#cmr_compatibility');
    const provider = getProvider(activeProviderId);
    if (!status || !provider) {
        return;
    }

    const control = getProviderControl(provider);
    const controlObject = provider.controlType === 'select' ? '모델 선택기를' : '모델 입력란을';
    if (!control) {
        status.hidden = false;
        status.dataset.state = 'error';
        status.textContent = `SillyTavern의 ${provider.label} ${controlObject} 찾지 못했습니다.\n등록 모델을 목록에 표시할 수 없습니다.`;
    } else {
        status.hidden = true;
        status.dataset.state = '';
        status.textContent = '';
    }
}

function renderModelList() {
    const list = settingsRoot?.querySelector('#cmr_model_list');
    if (!list || !settings) {
        return;
    }

    const providers = getProviders();
    const models = getEnabledModels(settings);
    const modelsByProvider = new Map(providers.map(provider => [
        provider.id,
        models.filter(model => model.provider === provider.id),
    ]));
    const populatedProviderCount = [...modelsByProvider.values()].filter(items => items.length).length;
    const total = models.length;
    const count = settingsRoot.querySelector('#cmr_model_count');
    if (count) {
        count.textContent = `제공업체 ${populatedProviderCount}곳 · 모델 ${total}개`;
    }
    list.dataset.scrollable = String(total > MODEL_LIST_SCROLL_THRESHOLD);
    if (total > MODEL_LIST_SCROLL_THRESHOLD) {
        list.setAttribute('tabindex', '0');
        list.setAttribute('aria-label', `등록 모델 ${total}개. 스크롤하여 모두 확인할 수 있습니다.`);
    } else {
        list.removeAttribute('tabindex');
        list.removeAttribute('aria-label');
    }
    list.replaceChildren();

    if (!total) {
        const empty = document.createElement('li');
        empty.className = 'cmr-empty';
        empty.textContent = '등록한 모델이 없습니다.';
        list.append(empty);
        return;
    }

    for (const provider of providers) {
        const providerModels = modelsByProvider.get(provider.id) ?? [];
        if (!providerModels.length) {
            continue;
        }

        const group = document.createElement('li');
        group.className = 'cmr-provider-group';
        group.dataset.provider = provider.id;
        const header = document.createElement('div');
        header.className = 'cmr-provider-group-header';
        const providerLabel = document.createElement('span');
        providerLabel.className = 'cmr-provider-group-label';
        providerLabel.textContent = provider.label;
        const providerCount = document.createElement('span');
        providerCount.className = 'cmr-provider-group-count';
        providerCount.textContent = `${providerModels.length}개`;
        header.append(providerLabel, providerCount);

        const providerList = document.createElement('ul');
        providerList.className = 'cmr-provider-model-list';
        providerList.setAttribute('aria-label', `${provider.label} 등록 모델`);
        for (const model of providerModels) {
            const row = document.createElement('li');
            row.className = 'cmr-model-row';
            row.dataset.provider = provider.id;

            const info = document.createElement('div');
            info.className = 'cmr-model-summary';
            const modelId = document.createElement('code');
            modelId.className = 'cmr-model-id';
            modelId.textContent = model.id;
            modelId.title = model.id;
            modelId.setAttribute('dir', 'ltr');
            info.append(modelId);

            const actions = document.createElement('div');
            actions.className = 'cmr-model-actions';
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'menu_button cmr-icon-button cmr-delete-button';
            deleteButton.dataset.cmrAction = 'delete';
            deleteButton.dataset.provider = provider.id;
            deleteButton.dataset.modelId = model.id;
            deleteButton.title = '등록 삭제';
            deleteButton.setAttribute('aria-label', `${provider.label} ${model.id} 모델 등록 삭제`);
            const deleteIcon = document.createElement('i');
            deleteIcon.className = 'fa-solid fa-trash-can';
            deleteIcon.setAttribute('aria-hidden', 'true');
            deleteButton.append(deleteIcon);
            actions.append(deleteButton);
            row.append(info, actions);
            providerList.append(row);
        }
        group.append(header, providerList);
        list.append(group);
    }
}

function getExternalTargetDescription() {
    return '등록된 모든 제공업체 모델을 직접 표시합니다.';
}

function renderExternalIntegrations() {
    const list = settingsRoot?.querySelector('#cmr_external_list');
    const count = settingsRoot?.querySelector('#cmr_external_count');
    if (!list || !count || !externalSettings) {
        return;
    }

    const targets = externalIntegrationController?.getTargets?.() ?? [];
    const actionable = targets.filter(target => target.resolution?.source !== 'risk-blocked');
    const connectedCount = actionable.filter(target => target.resolution?.source === 'direct').length;
    count.textContent = `연결 대상 ${actionable.length}개 · 연결 ${connectedCount}개`;
    list.replaceChildren();

    if (!actionable.length) {
        const empty = document.createElement('li');
        empty.className = 'cmr-empty';
        empty.textContent = '연결할 수 있는 다른 확장의 Chat Completion 모델 칸을 찾지 못했습니다.';
        list.append(empty);
    }

    for (const target of actionable) {
        const row = document.createElement('li');
        row.className = 'cmr-model-row cmr-external-row';
        row.dataset.targetId = target.targetId;
        row.title = `문제 해결용 대상 식별자: ${target.targetId}`;

        const info = document.createElement('div');
        info.className = 'cmr-model-summary';
        const text = document.createElement('span');
        text.className = 'cmr-external-heading';
        const name = document.createElement('strong');
        name.className = 'cmr-external-name';
        name.textContent = target.label;
        const description = document.createElement('small');
        description.className = 'cmr-sentence-text';
        description.textContent = getExternalTargetDescription();
        text.append(name, document.createElement('br'), description);
        info.append(text);
        row.append(info);
        list.append(row);
    }

    const status = settingsRoot.querySelector('#cmr_external_status');
    if (status) {
        status.dataset.state = 'ok';
        status.textContent = `${connectedCount}개 모델 칸에 등록 모델을 직접 연결했습니다.`;
    }
}

function renderUi() {
    renderLauncher();
    renderProviderFields();
    renderCompatibilityStatus();
    renderModelList();
    renderExternalIntegrations();
    renderDiagnosticReport();
}

function isWithin(node, ancestor) {
    for (let current = node; current; current = current.parentElement) {
        if (current === ancestor) {
            return true;
        }
    }
    return false;
}

function mutationNodeTouchesProvider(node, provider, control) {
    if (!node) {
        return false;
    }
    if (node === control || isWithin(node, control)) {
        return true;
    }
    const selectorId = provider.selector.startsWith('#') ? provider.selector.slice(1) : '';
    return (selectorId && node.id === selectorId)
        || Boolean(node.querySelector?.(provider.selector));
}

function onObservedMutations(records = []) {
    const provider = findActiveProvider();
    const control = provider && getProviderControl(provider);
    const selected = provider && getSelectedModel(settings, provider.id);
    if (provider?.controlType === 'select' && control && selected) {
        const touchedControl = records.some(record => (
            isWithin(record.target, control)
            || Array.from(record.addedNodes ?? []).some(node => mutationNodeTouchesProvider(node, provider, control))
            || Array.from(record.removedNodes ?? []).some(node => mutationNodeTouchesProvider(node, provider, control))
        ));
        if (touchedControl) {
            pendingRestores.add(provider.id);
        }
    }
    scheduleSync();
}

function scheduleNativeChoiceCheck(provider, value) {
    pendingNativeChecks.set(provider.id, value);
    queueMicrotask(() => queueMicrotask(() => {
        if (!context || !settings || pendingNativeChecks.get(provider.id) !== value) {
            return;
        }
        pendingNativeChecks.delete(provider.id);
        if (pendingRestores.has(provider.id)) {
            return;
        }
        const configured = getConfiguredModel(provider);
        if (configured === value && !hasEnabledModel(settings, provider.id, value)) {
            updateSelectedModel(provider.id, null);
            if (activeProviderId === provider.id) {
                renderModelList();
            }
        }
    }));
}

function onProviderControlEvent(provider, event) {
    const control = event.currentTarget;
    const value = normalizeModelId(control?.value);
    if (hasEnabledModel(settings, provider.id, value)) {
        pendingRestores.delete(provider.id);
        pendingNativeChecks.delete(provider.id);
        updateSelectedModel(provider.id, value);
    } else if (provider.controlType === 'input' || event.isTrusted === true) {
        pendingRestores.delete(provider.id);
        pendingNativeChecks.delete(provider.id);
        updateSelectedModel(provider.id, null);
    } else if (!value || !getCustomGroup(control, provider.id)) {
        pendingRestores.add(provider.id);
        pendingNativeChecks.delete(provider.id);
        scheduleSync();
    } else {
        scheduleNativeChoiceCheck(provider, value);
    }

    if (activeProviderId === provider.id) {
        renderModelList();
    }
}

function unbindProviderControl(providerId) {
    const binding = boundControls.get(providerId);
    if (binding) {
        binding.control.removeEventListener(binding.eventName, binding.handler);
        boundControls.delete(providerId);
    }
}

function bindProviderControl(provider, control) {
    const previous = boundControls.get(provider.id);
    if (previous?.control === control) {
        return;
    }
    unbindProviderControl(provider.id);
    if (!control) {
        return;
    }

    const eventName = provider.applyEvent;
    const handler = event => onProviderControlEvent(provider, event);
    control.addEventListener(eventName, handler);
    boundControls.set(provider.id, { control, eventName, handler });
}

function dispatchControlEvent(control, eventName) {
    const EventClass = control.ownerDocument?.defaultView?.Event ?? globalThis.Event;
    control.dispatchEvent(new EventClass(eventName, { bubbles: true }));
}

function applyProviderModel(provider, control, modelId) {
    if (!control) {
        return false;
    }
    if (provider.controlType === 'select') {
        return selectModel(control, modelId);
    }

    control.value = modelId;
    if (normalizeModelId(control.value) !== modelId) {
        return false;
    }
    dispatchControlEvent(control, provider.applyEvent);
    return true;
}

function synchronizeProvider(provider) {
    const control = getProviderControl(provider);
    bindProviderControl(provider, control);
    if (!control) {
        return;
    }

    const models = getEnabledModels(settings, provider.id);
    const selected = getSelectedModel(settings, provider.id);
    const active = isProviderActive(provider);
    if (provider.controlType === 'select') {
        syncModelOptions(control, provider.id, models, {
            preferredModelId: active ? selected : null,
        });
    }
    if (!active) {
        return;
    }

    const configured = getConfiguredModel(provider);
    if (configured && hasEnabledModel(settings, provider.id, configured)) {
        pendingRestores.delete(provider.id);
        updateSelectedModel(provider.id, configured);
        if (provider.controlType === 'select' && hasModelOption(control, configured)) {
            control.value = configured;
        } else if (provider.controlType === 'input' && control.value !== configured) {
            control.value = configured;
        }
        return;
    }

    if (provider.controlType === 'input') {
        if (configured) {
            updateSelectedModel(provider.id, null);
            control.value = configured;
        } else if (selected) {
            applyProviderModel(provider, control, selected);
        }
        return;
    }

    const restore = pendingRestores.delete(provider.id);
    if ((restore || !configured) && selected && hasEnabledModel(settings, provider.id, selected)) {
        applyProviderModel(provider, control, selected);
    } else if (configured && hasModelOption(control, configured)) {
        control.value = configured;
    }
}

function connectObserver() {
    if (typeof MutationObserver !== 'function') {
        return;
    }
    const container = document.querySelector(OBSERVER_ROOT_SELECTOR) ?? document.body;
    if (!container) {
        return;
    }
    if (!observer) {
        observer = new MutationObserver(onObservedMutations);
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
    ensureLauncher();
    for (const provider of getProviders()) {
        synchronizeProvider(provider);
    }
    externalIntegrationController?.sync?.();
    renderUi();
    connectObserver();
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

function reconcileActiveProvider({ clearEmpty = true } = {}) {
    const provider = findActiveProvider();
    if (!provider) {
        return;
    }
    const configured = getConfiguredModel(provider);
    if (configured && hasEnabledModel(settings, provider.id, configured)) {
        updateSelectedModel(provider.id, configured);
    } else if (configured || clearEmpty) {
        updateSelectedModel(provider.id, null);
    }
}

function onSettingsUpdated() {
    if (!context) {
        return;
    }
    const storedSettings = context.extensionSettings[SETTINGS_KEY];
    const storedRoutes = context.extensionSettings[ROUTES_SETTINGS_KEY];
    const storedExternal = context.extensionSettings[EXTERNAL_SETTINGS_KEY];
    let nextExternal;
    try {
        nextExternal = normalizeAutomaticExternalSettings(storedExternal);
    } catch (error) {
        settings = normalizeSettings(acceptedSettingsSnapshot ?? settings);
        routingSettings = normalizePurposeRoutes(acceptedRoutingSnapshot ?? routingSettings);
        externalSettings = normalizeAutomaticExternalSettings(acceptedExternalSnapshot ?? externalSettings);
        const message = error instanceof ExternalSettingsError
            ? `${error.code}: ${error.message}`
            : '외부 확장 연결 설정을 읽지 못했습니다.';
        console.error(`[Custom Model Router] 외부 설정을 적용하지 않았습니다. ${message}`);
        announce(message, 'error');
        scheduleSync();
        return;
    }
    const repairReport = repairSettingsBundle({
        registrySettings: storedSettings,
        purposeRoutes: storedRoutes,
    });
    lastRepairReport = repairReport;

    if (!repairReport.ok) {
        settings = normalizeSettings(acceptedSettingsSnapshot ?? settings);
        routingSettings = normalizePurposeRoutes(acceptedRoutingSnapshot ?? routingSettings);
        externalSettings = normalizeAutomaticExternalSettings(acceptedExternalSnapshot ?? externalSettings);
        registryApiController?.synchronize('external-settings-rejected');
        const issue = repairReport.errors[0];
        const message = issue
            ? `${issue.code}: ${issue.message}`
            : repairReport.summary;
        console.error(`[Custom Model Router] 외부 설정을 적용하지 않았습니다. ${message}`);
        announce(message, 'error');
        scheduleSync();
        return;
    }

    let nextSettings;
    try {
        nextSettings = assertRegistryReplacementSafe(repairReport.registrySettings);
    } catch (error) {
        settings = normalizeSettings(acceptedSettingsSnapshot ?? settings);
        routingSettings = normalizePurposeRoutes(acceptedRoutingSnapshot ?? routingSettings);
        externalSettings = normalizeAutomaticExternalSettings(acceptedExternalSnapshot ?? externalSettings);
        context.extensionSettings[SETTINGS_KEY] = settings;
        context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
        context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
        registryApiController?.synchronize('model-in-use-settings-rejected');
        context.saveSettingsDebounced();
        const message = error instanceof ModelRegistryError
            ? `${error.code}: ${error.message}`
            : '현재 모델을 보호하기 위해 외부 설정을 적용하지 않았습니다.';
        console.error(`[Custom Model Router] 외부 설정을 적용하지 않았습니다. ${message}`);
        announce(message, 'error');
        scheduleSync();
        return;
    }
    const nextRoutes = normalizePurposeRoutes(repairReport.purposeRoutes);
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(nextSettings);
    const routesChanged = JSON.stringify(routingSettings) !== JSON.stringify(nextRoutes);
    const externalChanged = JSON.stringify(externalSettings) !== JSON.stringify(nextExternal);
    const storedSettingsRepaired = JSON.stringify(storedSettings) !== JSON.stringify(nextSettings);
    const storedRoutesRepaired = JSON.stringify(storedRoutes) !== JSON.stringify(nextRoutes);
    const storedExternalRepaired = JSON.stringify(storedExternal) !== JSON.stringify(nextExternal);

    settings = nextSettings;
    if (routesChanged && purposeRouter) {
        purposeRouter.replaceRoutes(nextRoutes);
    } else {
        routingSettings = nextRoutes;
    }
    externalSettings = nextExternal;
    context.extensionSettings[SETTINGS_KEY] = settings;
    context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
    context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
    rememberAcceptedSettings();

    if (settingsChanged) {
        registryApiController?.synchronize('external-settings');
    }
    if ((storedSettingsRepaired || storedRoutesRepaired || storedExternalRepaired) && !routesChanged) {
        context.saveSettingsDebounced();
    }
    scheduleSync();
}

function onSourceChanged() {
    reconcileActiveProvider({ clearEmpty: false });
    scheduleSync();
    queueMicrotask(() => recordStabilitySample('Chat Completion source 변경'));
}

function onModelChanged() {
    const provider = findActiveProvider();
    if (provider) {
        queueMicrotask(() => queueMicrotask(() => {
            if (!context || !settings || !isProviderActive(provider) || pendingRestores.has(provider.id)) {
                return;
            }
            const configured = getConfiguredModel(provider);
            if (configured && hasEnabledModel(settings, provider.id, configured)) {
                updateSelectedModel(provider.id, configured);
            } else if (configured) {
                updateSelectedModel(provider.id, null);
            }
            if (activeProviderId === provider.id) {
                renderModelList();
            }
        }));
    }
    scheduleSync();
}

function onConnectionStateChanged() {
    reconcileActiveProvider({ clearEmpty: true });
    scheduleSync();
    queueMicrotask(() => recordStabilitySample('Connection Profile 또는 preset 변경'));
}

function subscribeToSillyTavernEvents() {
    const bindings = [
        [context.eventTypes.APP_INITIALIZED, scheduleSync],
        [context.eventTypes.SETTINGS_UPDATED, onSettingsUpdated],
        [context.eventTypes.CHATCOMPLETION_SOURCE_CHANGED, onSourceChanged],
        [context.eventTypes.CHATCOMPLETION_MODEL_CHANGED, onModelChanged],
        [context.eventTypes.MAIN_API_CHANGED, scheduleSync],
        [context.eventTypes.OAI_PRESET_CHANGED_AFTER, onConnectionStateChanged],
        [context.eventTypes.CONNECTION_PROFILE_LOADED, onConnectionStateChanged],
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

function onProviderChange(event) {
    const provider = getProvider(event.currentTarget?.value);
    if (!provider) {
        return;
    }
    activeProviderId = provider.id;
    settingsRoot?.querySelector('#cmr_model_id')?.setAttribute('aria-invalid', 'false');
    announce('');
    renderUi();
}

function recoverExternalTargetCapacity(value, targetId) {
    const normalized = normalizeAutomaticExternalSettings(value);
    const detectedTargetIds = new Set(
        (externalIntegrationController?.getTargets?.() ?? []).map(target => target.targetId),
    );
    const staleTargetId = Object.keys(normalized.selectedModels).find(candidateTargetId => (
        candidateTargetId !== targetId && !detectedTargetIds.has(candidateTargetId)
    ));
    if (!staleTargetId) {
        return null;
    }
    const selectedModels = { ...normalized.selectedModels };
    delete selectedModels[staleTargetId];
    return { ...normalized, selectedModels };
}

function withExternalTargetCapacityRecovery(value, targetId, operation) {
    try {
        return operation(value);
    } catch (error) {
        if (!(error instanceof ExternalSettingsError) || error.code !== 'target_limit') {
            throw error;
        }
        const recovered = recoverExternalTargetCapacity(value, targetId);
        if (!recovered) {
            throw error;
        }
        return operation(recovered);
    }
}

function setExternalSelectedModelWithRecovery(value, targetId, providerId, modelId) {
    return withExternalTargetCapacityRecovery(value, targetId, candidate => (
        setExternalSelectedModel(candidate, targetId, providerId, modelId)
    ));
}

function onExternalSelectionChanged({ targetId, providerId, providerIds = [], modelId }) {
    if (!context || !externalSettings) {
        return;
    }
    try {
        externalSettings = removeExternalTargetSelections(externalSettings, targetId);
        const selectedProviderIds = [...new Set([
            ...(Array.isArray(providerIds) ? providerIds : []),
            providerId,
        ].filter(candidate => Boolean(getProvider(candidate))))];
        if (modelId) {
            for (const selectedProviderId of selectedProviderIds) {
                externalSettings = setExternalSelectedModelWithRecovery(
                    externalSettings,
                    targetId,
                    selectedProviderId,
                    modelId,
                );
            }
        }
        context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
        acceptedExternalSnapshot = normalizeAutomaticExternalSettings(externalSettings);
        context.saveSettingsDebounced();
    } catch (error) {
        console.error('[Custom Model Router] 외부 확장 모델 선택을 저장하지 못했습니다.', error);
    }
}

function onExternalSelectionInvalidated({ targetId, providerId, modelId, reason }) {
    // 일시적인 외부 컨트롤 정리에는 마지막 선택을 보존한다.
    // Registry에서 실제 모델이 사라진 경우에만 더는 복원할 수 없는 provider 선택을 정리한다.
    if (!context || !externalSettings || reason !== 'models-updated' || !providerId
        || hasEnabledModel(settings, providerId, modelId)) {
        return;
    }
    const next = removeExternalSelectedModel(externalSettings, targetId, providerId);
    if (JSON.stringify(next) === JSON.stringify(externalSettings)) {
        return;
    }
    externalSettings = next;
    context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
    acceptedExternalSnapshot = normalizeAutomaticExternalSettings(externalSettings);
    context.saveSettingsDebounced();
    renderExternalIntegrations();
}

function createDiagnosticReport() {
    const compatibility = diagnoseCompatibility({
        context,
        documentRef: document,
        runtimeState: {
            ...getRuntimeMetrics(),
            subscriptions: subscribedEvents,
            controlBindings: [...boundControls.keys()].map(providerId => ({ providerId })),
        },
    });
    const externalMetrics = externalIntegrationController?.getMetrics?.() ?? {
        observerCount: 0,
        targetCount: 0,
        boundCount: 0,
        directCount: 0,
        listenerCount: 0,
    };
    const externalTargets = externalIntegrationController?.getTargets?.() ?? [];
    const externalExcludedCount = externalTargets.filter(target => (
        target.resolution?.source === 'risk-blocked'
    )).length;
    const externalCheck = {
        id: 'external-model-controls',
        status: 'passed',
        message: `외부 모델 컨트롤 ${externalMetrics.targetCount}개 감지 · 직접 연결 ${externalMetrics.directCount}개 · 안전상 제외 ${externalExcludedCount}개`,
        details: {
            ...externalMetrics,
            excludedCount: externalExcludedCount,
        },
    };
    const stability = stabilityMonitor?.analyze() ?? null;
    const status = compatibility.status === 'error' || stability?.status === 'error'
        ? 'error'
        : (compatibility.status === 'warning' || stability?.status === 'warning'
            ? 'warning'
            : 'ok');
    const compatibilitySummary = stability?.status === 'error'
        ? `${compatibility.summary} 장시간 계측에서 자원 증가를 발견했습니다.`
        : (stability?.status === 'warning' && compatibility.status === 'ok'
            ? `${compatibility.summary} ${stability.summary}`
            : compatibility.summary);
    const checks = [...compatibility.checks, externalCheck];
    const counts = checks.reduce((result, check) => {
        if (Object.hasOwn(result, check.status)) {
            result[check.status] += 1;
        }
        return result;
    }, { passed: 0, warning: 0, failed: 0 });
    return {
        ...compatibility,
        checks,
        counts,
        status,
        summary: compatibilitySummary,
        extensionVersion: EXTENSION_VERSION,
        externalIntegrations: externalCheck.details,
        stability,
        repair: lastRepairReport ? {
            status: lastRepairReport.status,
            summary: lastRepairReport.summary,
            beforeCounts: lastRepairReport.beforeCounts,
            afterCounts: lastRepairReport.afterCounts,
            warnings: lastRepairReport.warnings,
        } : null,
    };
}

function renderDiagnosticReport() {
    const list = settingsRoot?.querySelector('#cmr_diagnostic_list');
    const summary = settingsRoot?.querySelector('#cmr_diagnostic_summary');
    if (!list || !summary) {
        return;
    }
    list.replaceChildren();
    if (!lastDiagnosticReport) {
        summary.dataset.state = 'ok';
        summary.textContent = '진단을 실행하면 버전·이벤트·모델 컨트롤·중복 자원을 확인합니다.';
        return;
    }
    summary.dataset.state = lastDiagnosticReport.status;
    summary.textContent = formatUiSentences(lastDiagnosticReport.summary);
    for (const check of lastDiagnosticReport.checks) {
        const item = document.createElement('li');
        item.dataset.status = check.status;
        item.textContent = formatUiSentences(`${check.status === 'passed' ? '통과' : (check.status === 'warning' ? '주의' : '오류')} · ${check.message}`);
        list.append(item);
    }
    if (lastDiagnosticReport.stability) {
        const item = document.createElement('li');
        item.dataset.status = lastDiagnosticReport.stability.status === 'error'
            ? 'failed'
            : (lastDiagnosticReport.stability.status === 'warning' ? 'warning' : 'passed');
        item.textContent = formatUiSentences(`장시간 계측 · ${lastDiagnosticReport.stability.summary}`);
        list.append(item);
    }
}

function onRunDiagnostics() {
    lastDiagnosticReport = createDiagnosticReport();
    renderDiagnosticReport();
}

async function onCopyDiagnostics() {
    try {
        lastDiagnosticReport ??= createDiagnosticReport();
        const clipboard = globalThis.navigator?.clipboard;
        if (typeof clipboard?.writeText !== 'function') {
            throw new Error('clipboard unavailable');
        }
        await clipboard.writeText(JSON.stringify(lastDiagnosticReport, null, 2));
        renderDiagnosticReport();
        announce('민감한 연결 값을 제외한 진단 결과를 복사했습니다.');
    } catch {
        announce('브라우저가 진단 결과 복사를 허용하지 않았습니다.', 'error');
    }
}

function onExportBackup() {
    try {
        const content = stringifyPortableSettings({
            registrySettings: settings,
            purposeRoutes: routingSettings,
            externalSettings,
        });
        const BlobClass = globalThis.Blob;
        const URLApi = globalThis.URL;
        if (typeof BlobClass !== 'function' || typeof URLApi?.createObjectURL !== 'function') {
            throw new Error('download unavailable');
        }
        const url = URLApi.createObjectURL(new BlobClass([content], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `custom-model-router-backup-v${EXTENSION_VERSION}.json`;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URLApi.revokeObjectURL(url);
        announce('Registry, 용도별 경로와 외부 확장 연결 백업을 내보냈습니다.');
    } catch {
        announce('이 브라우저에서는 백업 파일을 내보내지 못했습니다.', 'error');
    }
}

function isCurrentImportOperation(operation) {
    return operation.generation === lifecycleGeneration
        && context === operation.context
        && purposeRouter === operation.purposeRouter
        && settingsRoot?.querySelector('#cmr_import_backup') === operation.input;
}

async function onImportBackup(event) {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    if (!file) {
        return;
    }
    const operation = {
        generation: lifecycleGeneration,
        context,
        purposeRouter,
        input,
    };
    try {
        if (!isCurrentImportOperation(operation)) {
            return;
        }
        if (Number.isFinite(file.size) && file.size > PORTABLE_SETTINGS_MAX_LENGTH) {
            throw new PortableSettingsError(
                'backup_too_large',
                `백업 파일은 ${PORTABLE_SETTINGS_MAX_LENGTH.toLocaleString('ko-KR')}바이트 이하여야 합니다.`,
            );
        }
        const content = await file.text();
        if (!isCurrentImportOperation(operation)) {
            return;
        }
        const parsed = parsePortableSettings(content);
        const parsedRegistrySettings = assertRegistryReplacementSafe(parsed.registrySettings);
        if (!isCurrentImportOperation(operation)) {
            return;
        }
        const confirmation = globalThis.confirm?.(
            '현재 Custom Model Router 모델 Registry, 용도별 경로와 외부 확장 연결을 이 백업으로 교체할까요?',
        );
        if (!isCurrentImportOperation(operation)) {
            return;
        }
        if (confirmation !== true) {
            announce('백업 가져오기를 취소했습니다.', 'error');
            return;
        }
        settings = parsedRegistrySettings;
        externalSettings = normalizeAutomaticExternalSettings(parsed.externalSettings);
        operation.context.extensionSettings[SETTINGS_KEY] = settings;
        operation.context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
        operation.purposeRouter.replaceRoutes(parsed.purposeRoutes);
        acceptedExternalSnapshot = normalizeAutomaticExternalSettings(externalSettings);
        persistSettings('backup-import');
        synchronize();
        announce(parsed.report.status === 'warning'
            ? `백업을 가져왔습니다. ${parsed.report.summary}`
            : '백업에서 Registry, 용도별 경로와 외부 확장 연결을 복구했습니다.');
    } catch (error) {
        if (isCurrentImportOperation(operation)) {
            const message = error instanceof PortableSettingsError || error instanceof ModelRegistryError
                ? `${error.code}: ${error.message}`
                : '백업 파일을 읽지 못했습니다.';
            announce(message, 'error');
        }
    } finally {
        input.value = '';
    }
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
    populateProviderSelect();
    settingsRoot.querySelector('#cmr_provider')?.addEventListener('change', onProviderChange);
    settingsRoot.querySelector('#cmr_add_form')?.addEventListener('submit', onAddModel);
    settingsRoot.querySelector('#cmr_model_list')?.addEventListener('click', onModelListClick);
    settingsRoot.querySelector('#cmr_run_diagnostics')?.addEventListener('click', onRunDiagnostics);
    settingsRoot.querySelector('#cmr_copy_diagnostics')?.addEventListener('click', onCopyDiagnostics);
    settingsRoot.querySelector('#cmr_export_backup')?.addEventListener('click', onExportBackup);
    settingsRoot.querySelector('#cmr_import_backup_button')?.addEventListener('click', () => {
        settingsRoot?.querySelector('#cmr_import_backup')?.click?.();
    });
    settingsRoot.querySelector('#cmr_import_backup')?.addEventListener('change', onImportBackup);
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
    launcherButton?.parentElement && launcherButton.focus?.();
}

function handlePopupShowFailure(popup, root, error) {
    popup?.dlg?.remove?.();
    const popupList = context?.Popup?.util?.popups;
    if (Array.isArray(popupList)) {
        const index = popupList.indexOf(popup);
        if (index >= 0) {
            popupList.splice(index, 1);
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

    activeProviderId = findInitialProviderId();
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
        void popup.show().catch(error => handlePopupShowFailure(popup, root, error));
    } catch (error) {
        settingsRoot = null;
        console.error('[Custom Model Router] 모델 관리 패널을 만들지 못했습니다.', error);
        renderLauncher();
    }
}

function onAddModel(event) {
    event.preventDefault();
    const input = settingsRoot?.querySelector('#cmr_model_id');
    const provider = getProvider(activeProviderId);
    try {
        if (!provider) {
            throw new ModelRegistryError('unsupported_provider', '지원하지 않는 제공업체입니다.');
        }
        const id = normalizeModelId(input?.value);
        const control = getProviderControl(provider);
        if (provider.controlType === 'select' && control && isNativeModelOption(control, id)) {
            throw new ModelRegistryError('core_duplicate', '이미 SillyTavern 기본 목록에 있는 모델입니다.');
        }
        settings = addModel(settings, provider.id, id);
        persistSettings('settings-ui');
        if (input) {
            input.value = '';
            input.setAttribute('aria-invalid', 'false');
            input.focus?.();
        }
        synchronize();
        announce(`${provider.label}에 ${id} 모델을 등록했습니다. 사용할 모델은 API Connections의 모델 선택기 또는 입력란에서 선택·입력하세요.`);
    } catch (error) {
        input?.setAttribute('aria-invalid', 'true');
        announce(error instanceof ModelRegistryError ? error.message : '모델을 등록하지 못했습니다.', 'error');
    }
}

function onModelListClick(event) {
    const button = event.target?.closest?.('[data-cmr-action]');
    if (!button || !settingsRoot?.contains(button)) {
        return;
    }
    const provider = getProvider(button.dataset.provider);
    const modelId = normalizeModelId(button.dataset.modelId);
    if (!provider || !hasEnabledModel(settings, provider.id, modelId)) {
        announce('등록된 모델 정보를 찾지 못했습니다.', 'error');
        return;
    }

    if (button.dataset.cmrAction === 'delete') {
        const configured = getConfiguredModel(provider);
        const preservesInputValue = provider.controlType === 'input' && configured === modelId;
        if (isProtectedConfiguredModel(provider, modelId)) {
            announce(`이 모델은 SillyTavern에서 현재 사용 중입니다. API Connections의 ${provider.label} 모델 선택기에서 다른 모델을 선택한 뒤 삭제해 주세요.`, 'error');
            return;
        }
        settings = removeModel(settings, provider.id, modelId);
        persistSettings('settings-ui');
        synchronize();
        settingsRoot?.querySelector('#cmr_model_id')?.focus?.();
        announce(preservesInputValue
            ? `${provider.label}에서 ${modelId} 등록만 삭제했습니다. 현재 모델 입력값은 유지됩니다.`
            : `${provider.label}에서 ${modelId} 모델 등록을 삭제했습니다.`);
    }
}

function teardownRuntime({ applyNativeFallback = false } = {}) {
    observer?.disconnect();
    observer = null;
    observedContainer = null;
    externalIntegrationController?.destroy?.();
    externalIntegrationController = null;

    let selectionChanged = false;
    for (const provider of getProviders()) {
        const binding = boundControls.get(provider.id);
        const control = binding?.control;
        if (!control) {
            continue;
        }
        if (applyNativeFallback && provider.controlType === 'select' && isProviderActive(provider)) {
            const configured = normalizeModelId(getConfiguredModel(provider) || control.value);
            const customOnly = hasEnabledModel(settings, provider.id, configured)
                && !isNativeModelOption(control, configured);
            if (customOnly) {
                const fallback = getNativeFallbackModel(control, provider.fallbackModelIds);
                const fallbackApplied = Boolean(fallback && selectModel(control, fallback));
                if (fallbackApplied) {
                    selectionChanged = updateSelectedModel(provider.id, null, false) || selectionChanged;
                }
            }
        }
        control.removeEventListener(binding.eventName, binding.handler);
        if (provider.controlType === 'select') {
            removeCustomGroup(control, provider.id);
        }
    }
    boundControls.clear();
    pendingRestores.clear();
    pendingNativeChecks.clear();

    if (selectionChanged) {
        persistSettings('lifecycle');
    }

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
    activeProviderId = null;
    launcherButton?.removeEventListener('click', openSettingsPanel);
    launcherButton?.remove();
    launcherButton = null;
    launcherCount = null;
    settingsTemplateHtml = '';
    uninstallRegistryApi?.();
    uninstallRegistryApi = null;
    registryApiController?.destroy();
    registryApiController = null;
    unregisterConnectionProfileAdapter?.();
    unregisterConnectionProfileAdapter = null;
    purposeRouter?.destroy();
    purposeRouter = null;
    routingSettings = null;
    externalSettings = null;
    stabilityMonitor?.record('확장 비활성화', getRuntimeMetrics('destroyed'));
    stabilityMonitor = null;
    lastDiagnosticReport = null;
    lastRepairReport = null;
    acceptedSettingsSnapshot = null;
    acceptedRoutingSnapshot = null;
    acceptedExternalSnapshot = null;
    context = null;
    settings = null;
    syncScheduled = false;
    initialized = false;
}

async function initialize(generation) {
    context = getSillyTavernContext();
    const storedSettings = context.extensionSettings[SETTINGS_KEY];
    const storedRoutes = context.extensionSettings[ROUTES_SETTINGS_KEY];
    const storedExternal = context.extensionSettings[EXTERNAL_SETTINGS_KEY];
    lastRepairReport = repairSettingsBundle({
        registrySettings: storedSettings,
        purposeRoutes: storedRoutes,
    });
    if (!lastRepairReport.ok) {
        const issue = lastRepairReport.errors[0];
        throw new PortableSettingsError(
            issue?.code ?? 'settings_repair_failed',
            lastRepairReport.summary,
            lastRepairReport.errors,
        );
    }
    settings = normalizeSettings(lastRepairReport.registrySettings);
    routingSettings = normalizePurposeRoutes(lastRepairReport.purposeRoutes);
    externalSettings = normalizeAutomaticExternalSettings(storedExternal);
    rememberAcceptedSettings();
    const settingsChanged = JSON.stringify(storedSettings) !== JSON.stringify(settings);
    const routesChanged = JSON.stringify(storedRoutes) !== JSON.stringify(routingSettings);
    const externalChanged = JSON.stringify(storedExternal) !== JSON.stringify(externalSettings);
    context.extensionSettings[SETTINGS_KEY] = settings;
    context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
    context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
    stabilityMonitor = createStabilityMonitor({ sampleLimit: 512 });
    lastDiagnosticReport = null;
    purposeRouter = new PurposeRouter({
        routes: routingSettings,
        getRegistrySettings: () => settings,
        onRoutesChanged: persistRoutingSettings,
    });
    unregisterConnectionProfileAdapter = purposeRouter.registerAdapter(
        createSillyTavernConnectionProfileAdapter(() => getLiveContext()),
    );
    registryApiController = createRegistryApi({
        extensionVersion: EXTENSION_VERSION,
        readSettings: () => settings,
        writeSettings: writeRegistryApiSettings,
        routingApi: createPurposeRoutingApi(purposeRouter),
        onSubscriberError: error => {
            console.error('[Custom Model Router] Registry API 구독자 처리 실패', error);
        },
    });
    uninstallRegistryApi = installRegistryApi(globalThis, registryApiController.api);
    externalIntegrationController = createExternalIntegrationController({
        root: document,
        documentRef: document,
        exclude: control => {
            for (let current = control; current; current = current.parentElement) {
                if (current.id === OBSERVER_ROOT_SELECTOR.slice(1) || current.id === 'cmr_settings') {
                    return true;
                }
            }
            return false;
        },
        getModels: providerId => getEnabledModels(settings, providerId),
        getPreferredModels: targetId => ({
            ...(externalSettings?.selectedModels?.[targetId] ?? {}),
        }),
        onSelectionChanged: onExternalSelectionChanged,
        onSelectionInvalidated: onExternalSelectionInvalidated,
        onTargetsChanged: () => renderExternalIntegrations(),
    });
    externalIntegrationController.start();
    activeProviderId = findInitialProviderId();
    subscribeToSillyTavernEvents();
    synchronize();

    const loaded = await loadSettingsTemplate(generation);
    if (!loaded || generation !== lifecycleGeneration) {
        return;
    }
    renderUi();
    if (settingsChanged || routesChanged || externalChanged) {
        persistSettings('migration');
        context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
        context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
    }
    initialized = true;
    console.info(`[Custom Model Router] v${EXTENSION_VERSION} 초기화 완료`);
}

export function init() {
    if (destructionPromise) {
        return destructionPromise.then(() => init());
    }
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
    if (destructionPromise) {
        return destructionPromise;
    }
    lifecycleGeneration += 1;
    initializationPromise = null;
    const runPromise = Promise.resolve().then(async () => {
        const popup = activePopup;
        if (popup && typeof popup.completeCancelled === 'function') {
            try {
                await popup.completeCancelled();
            } catch (error) {
                console.warn('[Custom Model Router] 모델 관리 패널을 닫는 중 오류가 발생했습니다.', error);
            }
        }
        teardownRuntime({ applyNativeFallback: true });
    });
    const trackedPromise = runPromise.finally(() => {
        if (destructionPromise === trackedPromise) {
            destructionPromise = null;
        }
    });
    destructionPromise = trackedPromise;
    return trackedPromise;
}
