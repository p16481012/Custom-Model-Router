import {
    ModelRegistryError,
    addModel,
    createModelKey,
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
    getNativeModelIds,
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
    BUILTIN_PURPOSES,
    PurposeRouter,
    PurposeRouterError,
    createPurposeRoutingApi,
    normalizePurposeRoutes,
} from './src/purpose-router.js';
import {
    SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
    createSillyTavernConnectionProfileAdapter,
} from './src/connection-profile-adapter.js';

const EXTENSION_VERSION = '0.4.0';
const SETTINGS_KEY = 'customModelRouter';
const ROUTES_SETTINGS_KEY = 'customModelRouterRouting';
const OBSERVER_ROOT_SELECTOR = '#rm_api_block';
const CONNECTION_PROFILE_SELECTOR = '#connection_profiles';
const API_TITLE_SELECTOR = '#title_api';
const LAUNCHER_SELECTOR = '#cmr_open_manager';
const PURPOSE_LABELS = Object.freeze({
    translation: '번역',
    summary: '요약',
    search: '검색 보조',
    captioning: '이미지 설명',
    custom: '기타 보조 작업',
});

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
let purposeRouter = null;
let unregisterConnectionProfileAdapter = null;
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

function persistSettings(source = 'runtime') {
    context.extensionSettings[SETTINGS_KEY] = settings;
    context.saveSettingsDebounced();
    registryApiController?.synchronize(source);
}

function writeRegistryApiSettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
    context.extensionSettings[SETTINGS_KEY] = settings;
    context.saveSettingsDebounced();
    scheduleSync();
}

function persistRoutingSettings(nextRoutes) {
    routingSettings = normalizePurposeRoutes(nextRoutes);
    context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
    context.saveSettingsDebounced();
    renderRoutingFields();
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
    feedback.textContent = message;
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
        help.textContent = getProviderHelp(provider);
    }
    const listTitle = settingsRoot.querySelector('#cmr_list_title');
    if (listTitle) {
        listTitle.textContent = `${provider.label} 등록 모델`;
    }
}

function renderCompatibilityStatus() {
    const status = settingsRoot?.querySelector('#cmr_compatibility');
    const provider = getProvider(activeProviderId);
    if (!status || !provider) {
        return;
    }

    const control = getProviderControl(provider);
    const active = isProviderActive(provider);
    const controlName = provider.controlType === 'select' ? '모델 선택기' : '모델 입력란';
    status.dataset.state = control && active ? 'ok' : 'error';
    if (!control) {
        status.textContent = `${provider.label} ${controlName}을 찾지 못했습니다. 등록은 가능하지만 지금 적용할 수 없습니다.`;
    } else if (!active) {
        status.textContent = `${provider.label} ${controlName} 감지됨 · API Connections에서 이 제공업체를 현재 연결로 선택하면 적용할 수 있습니다.`;
    } else {
        status.textContent = `${provider.label} ${controlName} 감지됨 · 현재 연결`;
    }
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
    const provider = getProvider(activeProviderId);
    if (!list || !settings || !provider) {
        return;
    }

    const models = getEnabledModels(settings, provider.id);
    const total = getEnabledModels(settings).length;
    const control = getProviderControl(provider);
    const configuredModel = getConfiguredModel(provider);
    const active = isProviderActive(provider);
    const nativeIds = provider.controlType === 'select' && control ? getNativeModelIds(control) : new Set();
    const count = settingsRoot.querySelector('#cmr_model_count');
    if (count) {
        count.textContent = `이 제공업체 ${models.length}개 · 전체 ${total}개`;
    }
    list.replaceChildren();

    if (!models.length) {
        const empty = document.createElement('li');
        empty.className = 'cmr-empty';
        empty.textContent = `${provider.label}에 등록한 모델이 없습니다.`;
        list.append(empty);
        return;
    }

    for (const model of models) {
        const isConfigured = configuredModel === model.id;
        const isCurrent = active && isConfigured;
        const row = document.createElement('li');
        row.className = 'cmr-model-row';
        row.dataset.current = String(isCurrent);
        row.dataset.provider = provider.id;
        if (isCurrent) {
            row.setAttribute('aria-current', 'true');
        }

        const info = document.createElement('div');
        info.className = 'cmr-model-summary';
        const modelId = document.createElement('code');
        modelId.className = 'cmr-model-id';
        modelId.textContent = model.id;
        modelId.title = model.id;
        modelId.setAttribute('dir', 'ltr');
        const badges = document.createElement('div');
        badges.className = 'cmr-model-badges';
        if (isCurrent) {
            badges.append(createBadge('현재 사용', 'selected'));
        } else if (isConfigured) {
            badges.append(createBadge('저장된 선택', 'saved'));
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
        selectButton.dataset.provider = provider.id;
        selectButton.dataset.modelId = model.id;
        selectButton.disabled = isConfigured || !control || !active;
        selectButton.title = isConfigured
            ? '이미 선택된 모델'
            : (!active ? `${provider.label} 연결을 먼저 활성화하세요.` : `${provider.label} 모델로 적용`);
        selectButton.setAttribute('aria-label', `${provider.label}에 ${model.id} 모델 적용`);
        const selectIcon = document.createElement('i');
        selectIcon.className = 'fa-solid fa-check';
        selectIcon.setAttribute('aria-hidden', 'true');
        selectButton.append(selectIcon);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'menu_button cmr-icon-button cmr-delete-button';
        deleteButton.dataset.cmrAction = 'delete';
        deleteButton.dataset.provider = provider.id;
        deleteButton.dataset.modelId = model.id;
        const deleteBlocked = provider.controlType === 'select' && isConfigured && !nativeIds.has(model.id);
        deleteButton.title = deleteBlocked ? `다른 ${provider.label} 모델을 선택한 뒤 삭제할 수 있습니다.` : '등록 삭제';
        deleteButton.setAttribute('aria-disabled', String(deleteBlocked));
        deleteButton.setAttribute('aria-label', `${provider.label} ${model.id} 모델 등록 삭제`);
        const deleteIcon = document.createElement('i');
        deleteIcon.className = 'fa-solid fa-trash-can';
        deleteIcon.setAttribute('aria-hidden', 'true');
        deleteButton.append(deleteIcon);
        actions.append(selectButton, deleteButton);
        row.append(info, actions);
        list.append(row);
    }
}

function announceRoute(message, state = 'ok') {
    const status = settingsRoot?.querySelector('#cmr_route_status');
    if (!status) {
        return;
    }
    status.dataset.state = state;
    status.textContent = message;
}

function parseRouteModelKey(value) {
    try {
        const parsed = JSON.parse(String(value ?? ''));
        if (!Array.isArray(parsed) || parsed.length !== 2) {
            return null;
        }
        const [provider, modelId] = parsed.map(item => String(item ?? ''));
        return hasEnabledModel(settings, provider, modelId) ? { provider, modelId } : null;
    } catch {
        return null;
    }
}

function getConnectionProfiles(providerId) {
    const profiles = context?.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) {
        return [];
    }
    return profiles.filter(profile => {
        const apiMap = context?.CONNECT_API_MAP?.[profile?.api];
        return apiMap?.selected === 'openai' && apiMap?.source === providerId;
    });
}

function populatePurposeSelect(select) {
    const previous = select.value;
    const options = BUILTIN_PURPOSES.map(purpose => {
        const option = document.createElement('option');
        option.value = purpose;
        option.textContent = PURPOSE_LABELS[purpose] ?? purpose;
        return option;
    });
    select.replaceChildren(...options);
    select.value = options.some(option => option.value === previous) ? previous : BUILTIN_PURPOSES[0];
}

function populateRouteModelSelect(select, preferredKey = null) {
    const groups = [];
    for (const provider of getProviders()) {
        const models = getEnabledModels(settings, provider.id);
        if (!models.length) {
            continue;
        }
        const group = document.createElement('optgroup');
        group.label = provider.label;
        for (const model of models) {
            const option = document.createElement('option');
            option.value = createModelKey(provider.id, model.id);
            option.textContent = model.id;
            group.append(option);
        }
        groups.push(group);
    }
    if (!groups.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '먼저 사용자 모델을 등록하세요.';
        select.replaceChildren(option);
        select.disabled = true;
        return;
    }
    select.replaceChildren(...groups);
    select.disabled = false;
    if (preferredKey && select.options.some(option => option.value === preferredKey)) {
        select.value = preferredKey;
    } else {
        select.value = select.options[0]?.value ?? '';
    }
}

function populateRouteProfileSelect(select, providerId, preferredId = null) {
    const profiles = getConnectionProfiles(providerId);
    if (!profiles.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '같은 제공업체의 Connection Profile 없음';
        select.replaceChildren(option);
        select.disabled = true;
        return;
    }
    const options = profiles.map(profile => {
        const option = document.createElement('option');
        option.value = String(profile.id);
        option.textContent = String(profile.name || profile.id);
        return option;
    });
    select.replaceChildren(...options);
    select.disabled = false;
    if (preferredId && options.some(option => option.value === preferredId)) {
        select.value = preferredId;
    } else {
        select.value = options[0]?.value ?? '';
    }
}

function renderRoutingFields() {
    const purposeSelect = settingsRoot?.querySelector('#cmr_route_purpose');
    const modelSelect = settingsRoot?.querySelector('#cmr_route_model');
    const profileSelect = settingsRoot?.querySelector('#cmr_route_profile');
    if (!purposeSelect || !modelSelect || !profileSelect || !purposeRouter) {
        return;
    }
    const previousPurpose = purposeSelect.value;
    populatePurposeSelect(purposeSelect);
    if (previousPurpose && BUILTIN_PURPOSES.includes(previousPurpose)) {
        purposeSelect.value = previousPurpose;
    }
    const purpose = purposeSelect.value;
    const route = purposeRouter.getRoute(purpose);
    const routeKey = route ? createModelKey(route.provider, route.modelId) : null;
    const previousModelKey = modelSelect.value;
    populateRouteModelSelect(modelSelect, routeKey ?? previousModelKey);
    const model = parseRouteModelKey(modelSelect.value);
    populateRouteProfileSelect(
        profileSelect,
        model?.provider,
        route && route.provider === model?.provider ? route.connectionProfileId : null,
    );
    const clearButton = settingsRoot.querySelector('#cmr_route_clear');
    const testButton = settingsRoot.querySelector('#cmr_route_test');
    if (clearButton) {
        clearButton.disabled = !route;
    }
    if (testButton) {
        testButton.disabled = !route;
    }
    if (route) {
        const provider = getProvider(route.provider);
        announceRoute(`${PURPOSE_LABELS[purpose] ?? purpose}: ${provider?.label ?? route.provider} / ${route.modelId}`);
    } else {
        announceRoute(`${PURPOSE_LABELS[purpose] ?? purpose} 용도에 저장된 경로가 없습니다.`, 'error');
    }
}

function renderUi() {
    renderLauncher();
    renderProviderFields();
    renderCompatibilityStatus();
    renderModelList();
    renderRoutingFields();
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
    if (storedSettings !== settings) {
        settings = normalizeSettings(storedSettings);
        context.extensionSettings[SETTINGS_KEY] = settings;
        registryApiController?.synchronize('external-settings');
    }
    const storedRoutes = context.extensionSettings[ROUTES_SETTINGS_KEY];
    if (storedRoutes !== routingSettings && purposeRouter) {
        purposeRouter.replaceRoutes(normalizePurposeRoutes(storedRoutes));
    }
    scheduleSync();
}

function onSourceChanged() {
    reconcileActiveProvider({ clearEmpty: false });
    scheduleSync();
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

function onRoutePurposeChange() {
    announceRoute('');
    renderRoutingFields();
}

function onRouteModelChange(event) {
    const model = parseRouteModelKey(event.currentTarget?.value);
    const profileSelect = settingsRoot?.querySelector('#cmr_route_profile');
    if (profileSelect) {
        populateRouteProfileSelect(profileSelect, model?.provider);
    }
    announceRoute(model
        ? `${getProvider(model.provider)?.label ?? model.provider} / ${model.modelId} 경로를 저장할 수 있습니다.`
        : '등록 모델을 선택해 주세요.', model ? 'ok' : 'error');
}

function onRouteSubmit(event) {
    event.preventDefault();
    const purpose = settingsRoot?.querySelector('#cmr_route_purpose')?.value;
    const model = parseRouteModelKey(settingsRoot?.querySelector('#cmr_route_model')?.value);
    const connectionProfileId = settingsRoot?.querySelector('#cmr_route_profile')?.value;
    try {
        if (!model) {
            throw new PurposeRouterError('model_not_selected', '등록 모델을 선택해 주세요.');
        }
        if (!connectionProfileId) {
            throw new PurposeRouterError('connection_profile_not_selected', '같은 제공업체의 Connection Profile을 선택해 주세요.');
        }
        purposeRouter.setRoute(purpose, {
            provider: model.provider,
            modelId: model.modelId,
            adapterId: SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
            connectionProfileId,
        });
        renderRoutingFields();
        announceRoute(`${PURPOSE_LABELS[purpose] ?? purpose} 경로를 저장했습니다.`);
    } catch (error) {
        announceRoute(error instanceof PurposeRouterError ? error.message : '경로를 저장하지 못했습니다.', 'error');
    }
}

function onRouteClear() {
    const purpose = settingsRoot?.querySelector('#cmr_route_purpose')?.value;
    if (!purposeRouter?.removeRoute(purpose)) {
        announceRoute('해제할 경로가 없습니다.', 'error');
        return;
    }
    renderRoutingFields();
    announceRoute(`${PURPOSE_LABELS[purpose] ?? purpose} 경로를 해제했습니다.`);
}

async function onRouteTest(event) {
    const button = event.currentTarget;
    const purpose = settingsRoot?.querySelector('#cmr_route_purpose')?.value;
    if (!purposeRouter || !purpose) {
        return;
    }
    button.disabled = true;
    announceRoute('보조 요청을 전송하고 있습니다.');
    try {
        const result = await purposeRouter.execute(purpose, {
            prompt: 'Reply with exactly CMR_OK.',
            maxTokens: 24,
            stream: false,
        });
        const content = String(result?.content ?? '').trim();
        announceRoute(content
            ? `테스트 응답: ${content.slice(0, 160)}`
            : '테스트 요청은 완료됐지만 텍스트 응답이 비어 있습니다.', content ? 'ok' : 'error');
    } catch (error) {
        const message = error instanceof PurposeRouterError
            ? `${error.code}: ${error.message}`
            : '보조 요청 테스트에 실패했습니다.';
        announceRoute(message, 'error');
    } finally {
        button.disabled = !purposeRouter.getRoute(purpose);
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
    settingsRoot.querySelector('#cmr_route_purpose')?.addEventListener('change', onRoutePurposeChange);
    settingsRoot.querySelector('#cmr_route_model')?.addEventListener('change', onRouteModelChange);
    settingsRoot.querySelector('#cmr_route_form')?.addEventListener('submit', onRouteSubmit);
    settingsRoot.querySelector('#cmr_route_clear')?.addEventListener('click', onRouteClear);
    settingsRoot.querySelector('#cmr_route_test')?.addEventListener('click', onRouteTest);
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
        announce(`${provider.label}에 ${id} 모델을 등록했습니다.`);
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

    if (button.dataset.cmrAction === 'select') {
        if (!isProviderActive(provider)) {
            announce(`API Connections에서 ${provider.label} 연결을 먼저 선택해 주세요.`, 'error');
            return;
        }
        synchronize();
        const control = getProviderControl(provider);
        const previousModel = getConfiguredModel(provider);
        const previousControlValue = normalizeModelId(control?.value);
        const previousSelectedModel = getSelectedModel(settings, provider.id);
        if (!control || !applyProviderModel(provider, control, modelId)) {
            announce(`${provider.label} 모델 컨트롤에 모델을 적용하지 못했습니다.`, 'error');
            return;
        }
        if (getConfiguredModel(provider) !== modelId) {
            control.value = previousControlValue;
            updateSelectedModel(provider.id, previousSelectedModel);
            announce('SillyTavern이 모델 변경을 수락하지 않았습니다. 먼저 해당 제공업체에 연결해 모델 목록을 불러와 주세요.', 'error');
            return;
        }
        updateSelectedModel(provider.id, modelId);
        renderModelList();
        announce(`${modelId} 모델을 ${provider.label}에 적용했습니다.`);
        return;
    }

    if (button.dataset.cmrAction === 'delete') {
        const control = getProviderControl(provider);
        const configured = getConfiguredModel(provider);
        const preservesInputValue = provider.controlType === 'input' && configured === modelId;
        const nativeReplacement = provider.controlType === 'select'
            && control
            && isNativeModelOption(control, modelId);
        if (provider.controlType === 'select' && configured === modelId && !nativeReplacement) {
            announce(`현재 선택 중입니다. 먼저 다른 ${provider.label} 모델을 선택해 주세요.`, 'error');
            return;
        }
        settings = removeModel(settings, provider.id, modelId);
        persistSettings('settings-ui');
        synchronize();
        announce(preservesInputValue
            ? `${provider.label}에서 ${modelId} 등록만 삭제했습니다. 현재 모델 입력값은 유지됩니다.`
            : `${provider.label}에서 ${modelId} 모델 등록을 삭제했습니다.`);
    }
}

function teardownRuntime({ applyNativeFallback = false } = {}) {
    observer?.disconnect();
    observer = null;
    observedContainer = null;

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
    const storedRoutes = context.extensionSettings[ROUTES_SETTINGS_KEY];
    routingSettings = normalizePurposeRoutes(storedRoutes);
    const routesChanged = JSON.stringify(storedRoutes) !== JSON.stringify(routingSettings);
    context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
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
    activeProviderId = findInitialProviderId();
    subscribeToSillyTavernEvents();
    synchronize();

    const loaded = await loadSettingsTemplate(generation);
    if (!loaded || generation !== lifecycleGeneration) {
        return;
    }
    renderUi();
    if (settingsChanged || routesChanged) {
        persistSettings('migration');
        context.extensionSettings[ROUTES_SETTINGS_KEY] = routingSettings;
    }
    initialized = true;
    console.info(`[Custom Model Router] v${EXTENSION_VERSION} 초기화 완료`);
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
