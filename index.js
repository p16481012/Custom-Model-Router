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
    EXTERNAL_MAPPING_DISABLED,
    createExternalIntegrationController,
} from './src/external-integrations.js';
import {
    ExternalSettingsError,
    getExternalSelectedModel,
    normalizeExternalSettings,
    removeExternalMapping,
    setExternalMapping,
    setExternalSelectedModel,
} from './src/external-settings.js';

const EXTENSION_VERSION = '0.6.1';
const SETTINGS_KEY = 'customModelRouter';
const ROUTES_SETTINGS_KEY = 'customModelRouterRouting';
const EXTERNAL_SETTINGS_KEY = 'customModelRouterExternalIntegrations';
const EXTERNAL_MODE_CHOOSE = '__choose_provider__';
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
    acceptedExternalSnapshot = normalizeExternalSettings(externalSettings);
}

function persistSettings(source = 'runtime') {
    context.extensionSettings[SETTINGS_KEY] = settings;
    acceptedSettingsSnapshot = normalizeSettings(settings);
    context.saveSettingsDebounced();
    registryApiController?.synchronize(source);
}

function writeRegistryApiSettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
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
    renderRoutingFields();
}

function persistExternalSettings(source = 'external-integrations') {
    externalSettings = normalizeExternalSettings(externalSettings);
    context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
    acceptedExternalSnapshot = normalizeExternalSettings(externalSettings);
    context.saveSettingsDebounced();
    externalIntegrationController?.setMappings(externalSettings.mappings);
    renderExternalIntegrations();
    registryApiController?.synchronize(source);
}

function getRuntimeMetrics(phase = 'active') {
    const externalMetrics = externalIntegrationController?.getMetrics?.() ?? {};
    return {
        phase,
        launcherCount: launcherButton?.parentElement ? 1 : 0,
        panelCount: activePopup ? 1 : 0,
        observerCount: observer && observedContainer ? 1 : 0,
        listenerCount: subscribedEvents.length,
        boundControlCount: boundControls.size,
        externalObserverCount: externalMetrics.observerCount ?? 0,
        externalListenerCount: externalMetrics.listenerCount ?? 0,
        externalTargetCount: externalMetrics.targetCount ?? 0,
        externalAutoCount: externalMetrics.autoCount ?? 0,
        externalManualCount: externalMetrics.manualCount ?? 0,
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
    if (preferredKey && Array.from(select.options).some(option => option.value === preferredKey)) {
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

function announceExternal(message, state = 'ok') {
    const status = settingsRoot?.querySelector('#cmr_external_status');
    if (!status) {
        return;
    }
    status.dataset.state = state;
    status.textContent = message;
}

function getExternalTargetHint(target) {
    const controlId = String(target?.control?.id ?? '').trim();
    const controlName = String(target?.control?.name ?? target?.control?.getAttribute?.('name') ?? '').trim();
    return controlId ? `#${controlId}` : (controlName ? `[name="${controlName}"]` : target.targetId);
}

function humanizeExternalContext(value) {
    const translatedTokens = {
        caption: 'Caption',
        memory: '메모리',
        summary: '요약',
        summarizer: '요약',
        translate: '번역',
        translation: '번역',
        translator: '번역',
        vision: '이미지 설명',
    };
    const ignoredTokens = new Set([
        'block', 'container', 'content', 'control', 'drawer', 'ext', 'extension', 'field',
        'form', 'generic', 'id', 'input', 'main', 'model', 'panel', 'primary', 'root',
        'select', 'selector', 'setting', 'settings', 'wrapper',
    ]);
    const tokens = String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^\p{L}\p{N}]+/u)
        .map(token => token.trim())
        .filter(Boolean)
        .filter(token => !ignoredTokens.has(token.toLowerCase()))
        .slice(0, 4)
        .map(token => translatedTokens[token.toLowerCase()] ?? token);
    return tokens.join(' · ');
}

function getExternalContextName(target) {
    const control = target?.control;
    const explicitName = [
        control?.getAttribute?.('data-extension-name'),
        control?.getAttribute?.('data-extension-id'),
    ].map(humanizeExternalContext).find(Boolean) ?? '';

    let ancestorName = '';
    for (let ancestor = control?.parentElement, depth = 0; ancestor && depth < 6; ancestor = ancestor.parentElement, depth += 1) {
        const heading = [...(ancestor.children ?? [])].find(child => (
            child.matches?.('h1,h2,h3,h4,h5,h6,legend,.inline-drawer-header')
        ));
        const candidates = [
            ancestor.getAttribute?.('data-extension-name'),
            ancestor.getAttribute?.('data-extension-id'),
            heading?.textContent,
            ancestor.getAttribute?.('aria-label'),
            ancestor.id,
        ];
        for (const candidate of candidates) {
            const name = humanizeExternalContext(candidate);
            if (name) {
                ancestorName = name;
                break;
            }
        }
        if (ancestorName) {
            break;
        }
    }

    const controlName = [control?.id, control?.name, control?.getAttribute?.('name')]
        .map(humanizeExternalContext)
        .find(Boolean) ?? '';
    return [...new Set([explicitName || ancestorName, controlName].filter(Boolean))].join(' · ');
}

function getExternalTargetDisplayName(target, fallbackIndex = 0) {
    const controlId = String(target?.control?.id ?? '').trim().toLowerCase();
    const knownNames = {
        caption_multimodal_model: 'Caption · 이미지 설명 모델',
        caption_custom_model: 'Caption · 사용자 지정 모델',
    };
    if (knownNames[controlId]) {
        return knownNames[controlId];
    }
    const label = String(target?.label ?? '').trim();
    if (label && !/^(?:model(?: id)?|모델(?: id)?)$/i.test(label)) {
        return label;
    }
    const contextName = getExternalContextName(target);
    return contextName
        ? `${contextName} · 모델 입력란`
        : `다른 확장의 모델 입력란 ${fallbackIndex + 1}`;
}

function getExternalResolutionCopy(target) {
    const source = target?.resolution?.source ?? 'unresolved';
    const provider = getProvider(target?.resolution?.providerId);
    if (source === 'manual') {
        return {
            badge: '사용 가능',
            badgeKind: 'saved',
            summary: `${provider?.label ?? '선택한 제공업체'} · 직접 지정`,
            explanation: `${provider?.label ?? '선택한 제공업체'}의 등록 모델을 이 입력란에 표시합니다.`,
        };
    }
    if (source.startsWith('auto:')) {
        return {
            badge: '사용 가능',
            badgeKind: 'selected',
            summary: `${provider?.label ?? '제공업체'} · 자동으로 연결됨`,
            explanation: `CMR이 ${provider?.label ?? '제공업체'} 연결을 찾았습니다. 등록 모델을 이 입력란에 표시합니다.`,
        };
    }
    if (source === 'manual-disabled') {
        return {
            badge: '연결 안 함',
            badgeKind: '',
            summary: 'CMR 모델을 표시하지 않음',
            explanation: '사용자 설정에 따라 CMR이 이 모델 입력란을 변경하지 않습니다.',
        };
    }
    return {
        badge: '설정 필요',
        badgeKind: '',
        summary: '제공업체를 확인하지 못함',
        explanation: '제공업체를 자동으로 판단하지 못했습니다. 아래 연결 방식에서 사용할 제공업체를 직접 선택하세요.',
    };
}

function populateExternalModeSelect(select, target) {
    const mapping = externalSettings?.mappings?.[target.targetId];
    const unresolved = target?.resolution?.source === 'unresolved'
        && mapping !== EXTERNAL_MAPPING_DISABLED
        && !getProvider(mapping);
    const options = [];
    if (unresolved) {
        const chooseOption = document.createElement('option');
        chooseOption.value = EXTERNAL_MODE_CHOOSE;
        chooseOption.textContent = '제공업체를 선택하세요';
        chooseOption.disabled = true;
        options.push(chooseOption);
    }

    const autoOption = document.createElement('option');
    autoOption.value = '';
    autoOption.textContent = unresolved ? '자동 감지 다시 시도' : '자동으로 찾기 (권장)';

    const providerGroup = document.createElement('optgroup');
    providerGroup.label = '제공업체 직접 지정';
    for (const provider of getProviders()) {
        providerGroup.append(createOption(provider));
    }

    const disabledOption = document.createElement('option');
    disabledOption.value = EXTERNAL_MAPPING_DISABLED;
    disabledOption.textContent = '이 입력란에서는 연결 안 함';

    select.replaceChildren(...options, autoOption, providerGroup, disabledOption);
    select.value = mapping === EXTERNAL_MAPPING_DISABLED || getProvider(mapping)
        ? mapping
        : (unresolved ? EXTERNAL_MODE_CHOOSE : '');
}

function renderExternalIntegrations() {
    const list = settingsRoot?.querySelector('#cmr_external_list');
    const count = settingsRoot?.querySelector('#cmr_external_count');
    const skipped = settingsRoot?.querySelector('#cmr_external_skipped');
    if (!list || !count) {
        return;
    }

    const targets = externalIntegrationController?.getTargets?.() ?? [];
    const actionable = targets.filter(target => target.resolution?.source !== 'risk-blocked');
    const skippedCount = targets.length - actionable.length;
    const connectedCount = actionable.filter(target => Boolean(target.resolution?.providerId)).length;
    const unresolvedCount = actionable.filter(target => !target.resolution?.providerId
        && target.resolution?.source !== 'manual-disabled').length;
    const disabledCount = actionable.filter(target => target.resolution?.source === 'manual-disabled').length;
    count.textContent = `사용 가능 ${connectedCount}개${unresolvedCount ? ` · 설정 필요 ${unresolvedCount}개` : ''}${disabledCount ? ` · 연결 안 함 ${disabledCount}개` : ''}`;
    count.removeAttribute?.('title');
    if (skipped) {
        skipped.textContent = skippedCount
            ? `지원하지 않는 입력란 ${skippedCount}개는 안전을 위해 건드리지 않았습니다.`
            : '현재 건너뛴 비채팅 모델 입력란은 없습니다.';
    }
    list.replaceChildren();

    if (!actionable.length) {
        const empty = document.createElement('li');
        empty.className = 'cmr-empty';
        empty.textContent = '다른 확장에서 연결할 수 있는 Chat Completion 모델 입력란을 찾지 못했습니다.';
        list.append(empty);
    }

    for (const [targetIndex, target] of actionable.entries()) {
        const row = document.createElement('li');
        row.className = 'cmr-external-row';
        row.dataset.targetId = target.targetId;
        row.dataset.needsAttention = target.resolution?.source === 'unresolved' ? 'true' : 'false';

        const details = document.createElement('details');
        details.className = 'cmr-external-details';
        details.open = target.resolution?.source === 'unresolved';

        const summary = document.createElement('summary');
        const copy = getExternalResolutionCopy(target);

        const heading = document.createElement('div');
        heading.className = 'cmr-external-heading';
        const name = document.createElement('span');
        name.className = 'cmr-external-name';
        name.textContent = getExternalTargetDisplayName(target, targetIndex);
        name.title = name.textContent;
        const badge = createBadge(copy.badge, copy.badgeKind);
        heading.append(name);

        const summaryDetail = document.createElement('span');
        summaryDetail.className = 'cmr-external-summary-detail';
        summaryDetail.textContent = copy.summary;
        summary.append(heading, badge, summaryDetail);

        const body = document.createElement('div');
        body.className = 'cmr-external-body';
        const explanation = document.createElement('p');
        explanation.className = 'cmr-external-explanation';
        explanation.id = `${target.targetId}_description`;
        explanation.textContent = copy.explanation;

        const modeField = document.createElement('div');
        modeField.className = 'cmr-external-mode-field';
        const modeLabel = document.createElement('label');
        const modeSelect = document.createElement('select');
        modeSelect.id = `${target.targetId}_mode`;
        modeSelect.className = 'text_pole';
        modeSelect.dataset.cmrExternalMode = 'true';
        modeSelect.setAttribute('aria-describedby', explanation.id);
        modeLabel.htmlFor = modeSelect.id;
        modeLabel.setAttribute('for', modeSelect.id);
        modeLabel.textContent = '연결 방식';
        populateExternalModeSelect(modeSelect, target);
        modeField.append(modeLabel, modeSelect);

        const technical = document.createElement('details');
        technical.className = 'cmr-external-technical';
        const technicalLabel = document.createElement('summary');
        technicalLabel.textContent = '문제 해결용 정보';
        const technicalBody = document.createElement('div');
        technicalBody.className = 'cmr-external-technical-body';
        const technicalName = document.createElement('span');
        technicalName.textContent = '기술 식별자';
        const hint = document.createElement('code');
        hint.className = 'cmr-external-hint';
        hint.textContent = getExternalTargetHint(target);
        technicalBody.append(technicalName, hint);
        technical.append(technicalLabel, technicalBody);

        body.append(explanation, modeField, technical);
        details.append(summary, body);
        row.append(details);
        list.append(row);
    }
}

function renderUi() {
    renderLauncher();
    renderProviderFields();
    renderCompatibilityStatus();
    renderModelList();
    renderExternalIntegrations();
    renderRoutingFields();
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
        nextExternal = normalizeExternalSettings(storedExternal);
    } catch (error) {
        settings = normalizeSettings(acceptedSettingsSnapshot ?? settings);
        routingSettings = normalizePurposeRoutes(acceptedRoutingSnapshot ?? routingSettings);
        externalSettings = normalizeExternalSettings(acceptedExternalSnapshot ?? externalSettings);
        externalIntegrationController?.setMappings(externalSettings.mappings);
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
        externalSettings = normalizeExternalSettings(acceptedExternalSnapshot ?? externalSettings);
        externalIntegrationController?.setMappings(externalSettings.mappings);
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

    const nextSettings = normalizeSettings(repairReport.registrySettings);
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
    externalIntegrationController?.setMappings(externalSettings.mappings);
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
    if (externalChanged) {
        renderExternalIntegrations();
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
    const router = purposeRouter;
    if (!router || !purpose) {
        return;
    }
    button.disabled = true;
    announceRoute('보조 요청을 전송하고 있습니다.');
    try {
        const result = await router.execute(purpose, {
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
        if (purposeRouter !== router) {
            button.disabled = true;
        } else {
            try {
                button.disabled = !router.getRoute(purpose);
            } catch {
                button.disabled = true;
            }
        }
    }
}

function onExternalSelectionChanged({ targetId, providerId, modelId }) {
    if (!context || !externalSettings) {
        return;
    }
    try {
        const previous = getExternalSelectedModel(externalSettings, targetId, providerId);
        if (previous === (modelId || null)) {
            return;
        }
        externalSettings = setExternalSelectedModel(externalSettings, targetId, providerId, modelId);
        context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
        acceptedExternalSnapshot = normalizeExternalSettings(externalSettings);
        context.saveSettingsDebounced();
        renderExternalIntegrations();
    } catch (error) {
        console.error('[Custom Model Router] 외부 확장 모델 선택을 저장하지 못했습니다.', error);
    }
}

function onExternalRefresh() {
    const targets = externalIntegrationController?.rescan?.() ?? [];
    renderExternalIntegrations();
    const connected = targets.filter(target => Boolean(target.resolution?.providerId)).length;
    announceExternal(`다른 확장의 모델 입력란을 다시 확인했습니다. 현재 ${connected}개에서 등록 모델을 사용할 수 있습니다.`);
}

function focusExternalTargetSummary(targetId) {
    settingsRoot
        ?.querySelector(`[data-target-id="${targetId}"]`)
        ?.querySelector('summary')
        ?.focus?.();
}

function onExternalModeChange(event) {
    const select = event.target?.closest?.('[data-cmr-external-mode]');
    if (!select || !settingsRoot?.contains(select) || !externalSettings) {
        return;
    }
    const row = select.closest?.('[data-target-id]');
    const targetId = row?.dataset.targetId;
    if (!targetId) {
        return;
    }

    try {
        const selectedValue = String(select.value ?? '');
        if (selectedValue === EXTERNAL_MODE_CHOOSE) {
            announceExternal('사용할 제공업체를 선택해 주세요.', 'warning');
            return;
        }
        if (!selectedValue) {
            const wasUnresolved = row.dataset.needsAttention === 'true';
            externalSettings = removeExternalMapping(externalSettings, targetId);
            persistExternalSettings();
            focusExternalTargetSummary(targetId);
            announceExternal(wasUnresolved
                ? '자동 감지를 다시 실행했습니다. 계속 설정 필요로 표시되면 제공업체를 직접 선택하세요.'
                : '이 입력란은 이제 제공업체를 자동으로 찾습니다.', wasUnresolved ? 'warning' : 'ok');
            return;
        }
        if (selectedValue === EXTERNAL_MAPPING_DISABLED) {
            externalSettings = setExternalMapping(externalSettings, targetId, EXTERNAL_MAPPING_DISABLED);
            persistExternalSettings();
            focusExternalTargetSummary(targetId);
            announceExternal('이 모델 입력란에서는 CMR 연결을 사용하지 않습니다.', 'warning');
            return;
        }
        const provider = getProvider(selectedValue);
        if (!provider) {
            throw new ExternalSettingsError('mapping_provider_missing', '사용할 제공업체를 선택해 주세요.');
        }
        externalSettings = setExternalMapping(externalSettings, targetId, provider.id);
        persistExternalSettings();
        focusExternalTargetSummary(targetId);
        announceExternal(`${provider.label}로 직접 지정했습니다.`);
    } catch (error) {
        announceExternal(error instanceof ExternalSettingsError ? error.message : '외부 확장 연결을 저장하지 못했습니다.', 'error');
    }
}

function onImportBackupButton() {
    settingsRoot?.querySelector('#cmr_import_backup')?.click?.();
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
        autoCount: 0,
        manualCount: 0,
        listenerCount: 0,
    };
    const externalTargets = externalIntegrationController?.getTargets?.() ?? [];
    const externalUnresolvedCount = externalTargets.filter(target => (
        target.resolution?.source === 'unresolved'
    )).length;
    const externalDisabledCount = externalTargets.filter(target => (
        target.resolution?.source === 'manual-disabled'
    )).length;
    const externalSafetySkippedCount = externalTargets.filter(target => (
        target.resolution?.source === 'risk-blocked'
    )).length;
    const externalStatus = externalUnresolvedCount ? 'warning' : 'passed';
    const externalCheck = {
        id: 'external-model-controls',
        status: externalStatus,
        message: `외부 확장 모델 입력란 ${externalMetrics.targetCount}개 확인 · ${externalMetrics.boundCount}개 사용 가능 · ${externalUnresolvedCount}개 설정 필요 · ${externalDisabledCount}개 연결 안 함 · ${externalSafetySkippedCount}개 안전상 건너뜀`,
        details: {
            ...externalMetrics,
            unresolvedCount: externalUnresolvedCount,
            disabledCount: externalDisabledCount,
            safetySkippedCount: externalSafetySkippedCount,
            excludedCount: externalDisabledCount + externalSafetySkippedCount,
        },
    };
    const stability = stabilityMonitor?.analyze() ?? null;
    const status = compatibility.status === 'error' || stability?.status === 'error'
        ? 'error'
        : (compatibility.status === 'warning' || stability?.status === 'warning' || externalStatus === 'warning'
            ? 'warning'
            : 'ok');
    const compatibilitySummary = stability?.status === 'error'
        ? `${compatibility.summary} 장시간 계측에서 자원 증가를 발견했습니다.`
        : (stability?.status === 'warning' && compatibility.status === 'ok'
            ? `${compatibility.summary} ${stability.summary}`
            : compatibility.summary);
    const summary = externalUnresolvedCount
        ? `${compatibilitySummary} 외부 모델 컨트롤 ${externalUnresolvedCount}개는 제공업체 확인이 필요합니다.`
        : compatibilitySummary;
    return {
        ...compatibility,
        checks: [...compatibility.checks, externalCheck],
        status,
        summary,
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
    summary.textContent = lastDiagnosticReport.summary;
    for (const check of lastDiagnosticReport.checks) {
        const item = document.createElement('li');
        item.dataset.status = check.status;
        item.textContent = `${check.status === 'passed' ? '통과' : (check.status === 'warning' ? '주의' : '오류')} · ${check.message}`;
        list.append(item);
    }
    if (lastDiagnosticReport.stability) {
        const item = document.createElement('li');
        item.dataset.status = lastDiagnosticReport.stability.status === 'error'
            ? 'failed'
            : (lastDiagnosticReport.stability.status === 'warning' ? 'warning' : 'passed');
        item.textContent = `장시간 계측 · ${lastDiagnosticReport.stability.summary}`;
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
        announce('등록 모델, 기능별 지정과 다른 확장 연결 설정을 백업 파일로 저장했습니다.');
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
            announce('백업 불러오기를 취소했습니다.', 'error');
            return;
        }
        settings = normalizeSettings(parsed.registrySettings);
        externalSettings = normalizeExternalSettings(parsed.externalSettings);
        operation.context.extensionSettings[SETTINGS_KEY] = settings;
        operation.context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
        operation.purposeRouter.replaceRoutes(parsed.purposeRoutes);
        externalIntegrationController?.setMappings(externalSettings.mappings);
        acceptedExternalSnapshot = normalizeExternalSettings(externalSettings);
        persistSettings('backup-import');
        synchronize();
        announce(parsed.report.status === 'warning'
            ? `백업을 불러왔습니다. ${parsed.report.summary}`
            : '백업에서 등록 모델, 기능별 지정과 다른 확장 연결 설정을 복구했습니다.');
    } catch (error) {
        if (isCurrentImportOperation(operation)) {
            const message = error instanceof PortableSettingsError
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
    settingsRoot.querySelector('#cmr_external_refresh')?.addEventListener('click', onExternalRefresh);
    settingsRoot.querySelector('#cmr_external_list')?.addEventListener('change', onExternalModeChange);
    settingsRoot.querySelector('#cmr_route_purpose')?.addEventListener('change', onRoutePurposeChange);
    settingsRoot.querySelector('#cmr_route_model')?.addEventListener('change', onRouteModelChange);
    settingsRoot.querySelector('#cmr_route_form')?.addEventListener('submit', onRouteSubmit);
    settingsRoot.querySelector('#cmr_route_clear')?.addEventListener('click', onRouteClear);
    settingsRoot.querySelector('#cmr_route_test')?.addEventListener('click', onRouteTest);
    settingsRoot.querySelector('#cmr_run_diagnostics')?.addEventListener('click', onRunDiagnostics);
    settingsRoot.querySelector('#cmr_copy_diagnostics')?.addEventListener('click', onCopyDiagnostics);
    settingsRoot.querySelector('#cmr_export_backup')?.addEventListener('click', onExportBackup);
    settingsRoot.querySelector('#cmr_import_backup_button')?.addEventListener('click', onImportBackupButton);
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
    externalSettings = normalizeExternalSettings(storedExternal);
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
        mappings: externalSettings.mappings,
        exclude: control => {
            for (let current = control; current; current = current.parentElement) {
                if (current.id === OBSERVER_ROOT_SELECTOR.slice(1) || current.id === 'cmr_settings') {
                    return true;
                }
            }
            return false;
        },
        getModels: providerId => getEnabledModels(settings, providerId),
        getPreferredModel: (targetId, providerId) => (
            getExternalSelectedModel(externalSettings, targetId, providerId)
        ),
        onSelectionChanged: onExternalSelectionChanged,
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
