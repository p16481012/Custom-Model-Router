import {
    ModelRegistryError,
    getEnabledModels,
    getSelectedModel,
    hasEnabledModel,
    normalizeModelId,
    normalizeSettings,
    removeModel,
    setSelectedModel,
} from './src/registry.js';
import {
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
    announceProviderIntegrationApi,
    createProviderIntegrationController,
    diagnoseProviderIntegrations,
} from './src/provider-integrations.js';
import {
    createStabilityMonitor,
    diagnoseCompatibility,
    diagnoseExternalRuntimeResources,
    summarizeDiagnosticChecks,
} from './src/compatibility.js';
import {
    PORTABLE_SETTINGS_MAX_LENGTH,
    PortableSettingsError,
    createSettingsImportPreview,
    parsePortableSettings,
    repairSettingsBundle,
    stringifyPortableSettings,
} from './src/portable-settings.js';
import {
    EXTERNAL_INJECTED_OPTION_LIMIT,
    EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD,
    createExternalIntegrationController,
} from './src/external-integrations.js';
import {
    ExternalSettingsError,
    normalizeAutomaticExternalSettings,
    removeExternalSelectedModel,
    removeExternalTargetSelections,
    setExternalTargetExcluded,
    setExternalSelectedModel,
} from './src/external-settings.js';
import {
    BULK_MODEL_INPUT_MAX_LENGTH,
    ModelManagementError,
    applyBulkModelRegistrationPlan,
    createBulkModelRegistrationPlan,
    createModelDeletionUndo,
    filterRegisteredModels,
    restoreModelDeletion,
    shouldShowModelSearch,
} from './src/model-management.js';

const EXTENSION_VERSION = '0.6.14';
const SETTINGS_KEY = 'customModelRouter';
const ROUTES_SETTINGS_KEY = 'customModelRouterRouting';
const EXTERNAL_SETTINGS_KEY = 'customModelRouterExternalIntegrations';
const OBSERVER_ROOT_SELECTOR = '#rm_api_block';
const CONNECTION_PROFILE_SELECTOR = '#connection_profiles';
const API_TITLE_SELECTOR = '#title_api';
const LAUNCHER_SELECTOR = '#cmr_open_manager';
const MODEL_LIST_SCROLL_THRESHOLD = 6;
const REPAIR_ISSUE_MESSAGES = Object.freeze({
    settings_migrated: '이전 저장 스키마를 현재 버전으로 이관했습니다.',
    settings_normalized: '저장된 모델·선택·경로 값을 현재 규칙에 맞게 정규화했습니다.',
    invalid_records_removed: '손상되거나 중복된 모델·선택·경로 레코드를 제외했습니다.',
    future_registry_schema: '현재 확장보다 새로운 Registry 스키마라 저장값 적용을 중단했습니다.',
    future_routes_schema: '현재 확장보다 새로운 용도별 경로 스키마라 저장값 적용을 중단했습니다.',
});
const REPAIR_COUNT_KEYS = Object.freeze(['models', 'selections', 'routes']);
const REPAIR_DETAIL_MESSAGES = Object.freeze({
    registry_container_replaced: count => `Registry 루트 형식 오류 ${count}건을 빈 설정으로 복구했습니다.`,
    registry_unknown_fields_removed: count => `Registry의 지원하지 않는 필드 ${count}개를 제거했습니다.`,
    models_container_replaced: count => `모델 목록 형식 오류 ${count}건을 빈 목록으로 복구했습니다.`,
    model_invalid_removed: count => `제공업체 또는 모델 ID가 잘못된 모델 레코드 ${count}개를 제거했습니다.`,
    model_duplicate_merged: count => `중복된 모델 레코드 ${count}개를 하나로 합쳤습니다.`,
    model_record_normalized: count => `모델 레코드 ${count}개의 provider·protocol·활성 상태를 정규화했습니다.`,
    model_unknown_fields_removed: count => `모델 레코드의 지원하지 않는 필드 ${count}개를 제거했습니다.`,
    selections_container_replaced: count => `모델 선택 기록 형식 오류 ${count}건을 빈 기록으로 복구했습니다.`,
    legacy_selection_conflict_removed: count => `서로 충돌하는 이전 모델 선택 기록 ${count}개를 제거했습니다.`,
    selection_invalid_removed: count => `등록된 활성 모델을 가리키지 않는 선택 기록 ${count}개를 제거했습니다.`,
    selection_duplicate_merged: count => `중복된 제공업체 선택 기록 ${count}개를 하나로 합쳤습니다.`,
    selection_record_normalized: count => `모델 선택 기록 ${count}개의 제공업체·모델 ID를 정규화했습니다.`,
    routes_root_container_replaced: count => `기능별 경로 루트 형식 오류 ${count}건을 빈 설정으로 복구했습니다.`,
    routes_unknown_fields_removed: count => `기능별 경로 설정의 지원하지 않는 필드 ${count}개를 제거했습니다.`,
    routes_container_replaced: count => `기능별 경로 목록 형식 오류 ${count}건을 빈 목록으로 복구했습니다.`,
    route_invalid_removed: count => `용도·모델·어댑터 형식이 잘못된 기능별 경로 ${count}개를 제거했습니다.`,
    route_duplicate_merged: count => `정규화 후 중복된 기능별 경로 ${count}개를 하나로 합쳤습니다.`,
    route_record_normalized: count => `기능별 경로 ${count}개의 식별자와 필드를 정규화했습니다.`,
    route_unknown_fields_removed: count => `기능별 경로 레코드의 지원하지 않는 필드 ${count}개를 제거했습니다.`,
    schema_migrated: count => `이전 저장 스키마 ${count}곳을 현재 형식으로 이관했습니다.`,
    schema_normalized: count => `저장 스키마 표기 ${count}곳을 현재 형식으로 정규화했습니다.`,
    future_registry_schema: count => `지원하지 않는 미래 Registry 스키마 ${count}건 때문에 적용을 중단했습니다.`,
    future_routes_schema: count => `지원하지 않는 미래 경로 스키마 ${count}건 때문에 적용을 중단했습니다.`,
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
let destructionPromise = null;
let lifecycleGeneration = 0;
let observer = null;
let observedContainer = null;
let syncScheduled = false;
let settingsRoot = null;
let settingsTemplateHtml = '';
let launcherButton = null;
let activePopup = null;
let activeProviderId = null;
let registryApiController = null;
let uninstallRegistryApi = null;
let routingSettings = null;
let externalSettings = null;
let externalIntegrationController = null;
let providerIntegrationController = null;
let purposeRouter = null;
let unregisterConnectionProfileAdapter = null;
let stabilityMonitor = null;
let lastDiagnosticReport = null;
let lastRepairReport = null;
let modelSearchQuery = '';
let pendingModelDeletionUndo = null;
let pendingImportPreview = null;
let importOperationSequence = 0;
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

    pendingModelDeletionUndo = null;
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
    const providerIntegrationMetrics = providerIntegrationController?.getMetrics?.() ?? {};
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
        providerIntegrationConsumerCount: providerIntegrationMetrics.consumerCount ?? 0,
        providerIntegrationPendingCount: providerIntegrationMetrics.pendingCount ?? 0,
        providerIntegrationReadyCount: providerIntegrationMetrics.readyCount ?? 0,
        providerIntegrationFailedCount: providerIntegrationMetrics.failedCount ?? 0,
        providerIntegrationPublishedModelCount: providerIntegrationMetrics.publishedModelCount ?? 0,
        pendingTaskCount: pendingRestores.size
            + pendingNativeChecks.size
            + (syncScheduled ? 1 : 0)
            + (providerIntegrationMetrics.pendingCount ?? 0),
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

    const modelCount = normalizeSettings(settings).models.length;
    const detectedCount = getProviders().filter(provider => getProviderControl(provider)).length;
    launcherButton.disabled = !settingsTemplateHtml;
    launcherButton.dataset.state = detectedCount > 0 ? 'ready' : 'warning';
    launcherButton.setAttribute('aria-expanded', String(Boolean(activePopup)));
    launcherButton.setAttribute(
        'aria-label',
        `사용자 모델 관리, ${modelCount}개 등록됨${detectedCount ? '' : ', 지원 모델 컨트롤을 찾지 못함'}`,
    );
    launcherButton.title = settingsTemplateHtml ? '사용자 모델 관리' : '모델 관리 패널을 불러오는 중';
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
        launcherButton.append(icon);
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

function sanitizeRepairIssue(issue, fallbackSeverity) {
    const rawCode = typeof issue?.code === 'string' ? issue.code.trim() : '';
    const code = /^[a-z0-9_-]{1,64}$/.test(rawCode) ? rawCode : 'unknown_repair_issue';
    const severity = issue?.severity === 'error' || issue?.severity === 'warning'
        ? issue.severity
        : fallbackSeverity;
    return {
        severity,
        code,
        message: Object.hasOwn(REPAIR_ISSUE_MESSAGES, code)
            ? REPAIR_ISSUE_MESSAGES[code]
            : '저장값 검사에서 분류되지 않은 문제를 발견했습니다.',
    };
}

function sanitizeRepairCounts(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return Object.fromEntries(REPAIR_COUNT_KEYS.map((key) => {
        const count = value[key];
        return [key, Number.isInteger(count) && count >= 0 ? count : 0];
    }));
}

function sanitizeRepairDetails(value) {
    if (value?.schemaVersion !== 1 || !Array.isArray(value.items)) {
        return null;
    }
    const actions = new Set(['removed', 'changed', 'rejected']);
    const categories = new Set([
        'registry', 'registry.schema', 'registry.models', 'registry.selections',
        'routes', 'routes.schema', 'routes.entries',
    ]);
    const items = [];
    for (const item of value.items) {
        const formatter = REPAIR_DETAIL_MESSAGES[item?.code];
        if (typeof formatter !== 'function'
            || !actions.has(item?.action)
            || !categories.has(item?.pathCategory)
            || !Number.isInteger(item?.count)
            || item.count <= 0
            || item.count > 100_000) {
            continue;
        }
        items.push({
            code: item.code,
            action: item.action,
            pathCategory: item.pathCategory,
            count: item.count,
            message: formatter(item.count),
        });
    }
    const totals = { removed: 0, changed: 0, rejected: 0 };
    for (const item of items) {
        totals[item.action] += item.count;
    }
    return { schemaVersion: 1, totals, items };
}

function sanitizeMaterialRepairReport(report) {
    if (report?.status !== 'warning' && report?.status !== 'error') {
        return null;
    }
    const repairWarnings = Array.from(
        report.warnings ?? [],
        issue => sanitizeRepairIssue(issue, 'warning'),
    );
    const notices = repairWarnings
        .filter(issue => issue.code === 'settings_migrated')
        .map(issue => ({ ...issue, severity: 'info' }));
    const warnings = repairWarnings.filter(issue => issue.code !== 'settings_migrated');
    const errors = Array.from(report.errors ?? [], issue => sanitizeRepairIssue(issue, 'error'));
    const status = report.status === 'error' || errors.length
        ? 'error'
        : (warnings.length ? 'warning' : 'ok');
    const result = {
        status,
        summary: status === 'error'
            ? 'CMR 저장값을 적용하지 않았습니다. 오류 코드를 확인해 주세요.'
            : (status === 'warning'
                ? 'CMR 저장값을 복구했습니다. 변경 내역을 확인해 주세요.'
                : 'CMR 저장값을 현재 스키마로 안전하게 이관했습니다.'),
        notices,
        warnings,
        errors,
    };
    const beforeCounts = sanitizeRepairCounts(report.beforeCounts);
    const afterCounts = sanitizeRepairCounts(report.afterCounts);
    if (beforeCounts) {
        result.beforeCounts = beforeCounts;
    }
    if (afterCounts) {
        result.afterCounts = afterCounts;
    }
    const details = sanitizeRepairDetails(report.details);
    if (details) {
        result.details = details;
    }
    return result;
}

function rememberMaterialRepairReport(report) {
    const sanitized = sanitizeMaterialRepairReport(report);
    if (sanitized) {
        lastRepairReport = sanitized;
    }
}

function createRepairDiagnosticCheck(report) {
    if (!report) {
        return null;
    }
    const details = {
        noticeCodes: report.notices.map(issue => issue.code),
        warningCodes: report.warnings.map(issue => issue.code),
        errorCodes: report.errors.map(issue => issue.code),
    };
    if (report.beforeCounts) {
        details.beforeCounts = report.beforeCounts;
    }
    if (report.afterCounts) {
        details.afterCounts = report.afterCounts;
    }
    if (report.details) {
        details.repairItems = report.details.items.map(item => ({
            code: item.code,
            action: item.action,
            pathCategory: item.pathCategory,
            count: item.count,
        }));
    }
    const detailMessages = report.details?.items.map(item => item.message) ?? [];
    return {
        id: 'settings-repair',
        category: 'settings',
        status: report.status === 'error'
            ? 'failed'
            : (report.status === 'warning' ? 'warning' : 'passed'),
        message: [report.summary, ...detailMessages].join('\n'),
        details,
    };
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
        input.placeholder = `${provider.placeholder}\n여러 개면 한 줄에 하나`;
        input.maxLength = BULK_MODEL_INPUT_MAX_LENGTH;
    }
    const help = settingsRoot.querySelector('#cmr_model_help');
    if (help) {
        help.textContent = formatUiSentences(
            `${getProviderHelp(provider)} 모델 ID 하나를 입력하거나 여러 개면 한 줄에 하나씩 최대 200개를 입력합니다. 빈 줄·중복·SillyTavern 기본 모델은 건너뛰며, 잘못된 행이 하나라도 있으면 아무 모델도 등록하지 않습니다.`,
        );
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
    // 관리 목록의 개수는 비활성 레코드까지 포함한다. 실제 SillyTavern
    // 및 외부 모델 선택지 주입은 synchronize 경로의 getEnabledModels만 쓴다.
    const models = normalizeSettings(settings).models;
    const providerLabels = new Map(providers.map(provider => [provider.id, provider.label]));
    const searchRegion = settingsRoot.querySelector('#cmr_model_search_region');
    const searchInput = settingsRoot.querySelector('#cmr_model_search');
    const searchStatus = settingsRoot.querySelector('#cmr_model_search_status');
    const searchVisible = shouldShowModelSearch(models.length);
    if (searchRegion) {
        searchRegion.hidden = !searchVisible;
    }
    if (!searchVisible) {
        modelSearchQuery = '';
    }
    if (searchInput && searchInput.value !== modelSearchQuery) {
        searchInput.value = modelSearchQuery;
    }
    const visibleModels = filterRegisteredModels(
        models,
        modelSearchQuery,
        providerId => providerLabels.get(providerId) ?? providerId,
    );
    const modelsByProvider = new Map(providers.map(provider => [
        provider.id,
        visibleModels.filter(model => model.provider === provider.id),
    ]));
    const populatedProviderCount = new Set(models.map(model => model.provider)).size;
    const total = models.length;
    const visibleTotal = visibleModels.length;
    const count = settingsRoot.querySelector('#cmr_model_count');
    if (count) {
        count.textContent = modelSearchQuery
            ? `검색 ${visibleTotal}/${total}개`
            : `제공업체 ${populatedProviderCount}곳 · 모델 ${total}개`;
    }
    if (searchStatus) {
        searchStatus.textContent = modelSearchQuery
            ? `등록 모델 ${total}개 중 ${visibleTotal}개를 표시합니다.`
            : '';
    }
    list.dataset.scrollable = String(visibleTotal > MODEL_LIST_SCROLL_THRESHOLD);
    if (visibleTotal > MODEL_LIST_SCROLL_THRESHOLD) {
        list.setAttribute('tabindex', '0');
        list.setAttribute('aria-label', `표시 중인 등록 모델 ${visibleTotal}개. 스크롤하여 모두 확인할 수 있습니다.`);
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
    if (!visibleTotal) {
        const empty = document.createElement('li');
        empty.className = 'cmr-empty';
        empty.textContent = '검색 조건과 일치하는 등록 모델이 없습니다.';
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
            row.dataset.enabled = String(model.enabled);

            const info = document.createElement('div');
            info.className = 'cmr-model-summary';
            const modelId = document.createElement('code');
            modelId.className = 'cmr-model-id';
            modelId.textContent = model.id;
            modelId.title = model.id;
            modelId.setAttribute('dir', 'ltr');
            info.append(modelId);
            if (!model.enabled) {
                const state = document.createElement('span');
                state.className = 'cmr-model-state';
                state.dataset.state = 'disabled';
                state.textContent = '비활성';
                state.title = '모델 선택기에는 표시되지 않는 등록 레코드입니다.';
                state.setAttribute('aria-label', '비활성: 모델 선택기에는 표시되지 않는 등록 레코드');
                info.append(state);
            }

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

function renderModelDeletionUndo() {
    const button = settingsRoot?.querySelector('#cmr_undo_delete');
    if (!button) {
        return;
    }
    button.hidden = !pendingModelDeletionUndo;
    if (pendingModelDeletionUndo) {
        const provider = getProvider(pendingModelDeletionUndo.providerId);
        button.setAttribute(
            'aria-label',
            `${provider?.label ?? pendingModelDeletionUndo.providerId} ${pendingModelDeletionUndo.model.id} 모델 삭제 실행 취소`,
        );
    }
}

function createExternalTargetRow(target) {
    const source = target.resolution?.source;
    const bridgeStatus = target.bridge?.status ?? (source === 'direct' ? 'idle' : source);
    const ownerLabel = target.extensionLabel && target.extensionLabel !== '외부 확장'
        ? target.extensionLabel
        : target.label;
    const controlLabel = ownerLabel === target.label ? '외부 모델 칸' : target.label;
    const row = document.createElement('li');
    row.className = 'cmr-model-row cmr-external-row';
    row.dataset.targetId = target.targetId;

    const info = document.createElement('div');
    info.className = 'cmr-model-summary';
    const text = document.createElement('span');
    text.className = 'cmr-external-heading';
    const name = document.createElement('strong');
    name.className = 'cmr-external-name';
    name.textContent = ownerLabel;
    const control = document.createElement('small');
    control.className = 'cmr-external-control';
    control.textContent = controlLabel;
    const meta = document.createElement('span');
    meta.className = 'cmr-external-meta';
    const state = document.createElement('span');
    state.className = 'cmr-external-state';
    const verification = document.createElement('span');
    verification.className = 'cmr-external-verification';

    if (source === 'user-excluded') {
        state.dataset.state = 'excluded';
        state.textContent = '사용자 제외';
        verification.textContent = 'CMR 선택지를 표시하지 않음';
    } else if (bridgeStatus === 'failed') {
        state.dataset.state = 'failed';
        state.textContent = '선택지 연결 실패';
        verification.textContent = '이 대상 제외 가능';
    } else if (bridgeStatus === 'idle') {
        state.dataset.state = 'idle';
        state.textContent = '등록 모델 없음';
        verification.textContent = '등록 후 자동 표시';
    } else {
        state.dataset.state = 'connected';
        state.textContent = '선택지 연결됨';
        verification.textContent = '실제 요청 확인 필요';
    }
    meta.append(state, verification);
    text.append(name, control, meta);
    info.append(text);

    const actions = document.createElement('div');
    actions.className = 'cmr-external-actions';
    const action = document.createElement('button');
    const shouldRestore = source === 'user-excluded';
    const actionTargetLabel = ownerLabel === target.label
        ? ownerLabel
        : `${ownerLabel} · ${controlLabel}`;
    action.type = 'button';
    action.className = 'menu_button cmr-icon-button';
    action.dataset.cmrExternalAction = shouldRestore ? 'restore' : 'exclude';
    action.dataset.targetId = target.targetId;
    action.title = shouldRestore ? '다시 연결' : '이 대상 연결 제외';
    action.setAttribute('aria-label', `${actionTargetLabel} ${shouldRestore ? '다시 연결' : '연결에서 제외'}`);
    const icon = document.createElement('i');
    icon.className = shouldRestore ? 'fa-solid fa-rotate-left' : 'fa-solid fa-eye-slash';
    icon.setAttribute('aria-hidden', 'true');
    action.append(icon);
    actions.append(action);
    row.append(info, actions);
    return row;
}

function appendExternalRows(list, targets, emptyMessage) {
    list.replaceChildren();
    const sorted = [...targets].sort((left, right) => (
        String(left.extensionLabel ?? left.label).localeCompare(
            String(right.extensionLabel ?? right.label),
            'ko',
        )
    ));
    for (const target of sorted) {
        list.append(createExternalTargetRow(target));
    }
    if (!sorted.length) {
        const empty = document.createElement('li');
        empty.className = 'cmr-empty';
        empty.textContent = emptyMessage;
        list.append(empty);
    }
}

function renderExternalIntegrations() {
    const list = settingsRoot?.querySelector('#cmr_external_list');
    const pickerList = settingsRoot?.querySelector('#cmr_external_picker_list');
    const count = settingsRoot?.querySelector('#cmr_external_count');
    if (!list || !pickerList || !count || !externalSettings) {
        return;
    }

    const focusedAction = document.activeElement?.closest?.('[data-cmr-external-action]');
    const focusedTargetId = focusedAction && settingsRoot.contains(focusedAction)
        ? String(focusedAction.dataset.targetId ?? '')
        : '';
    const targets = externalIntegrationController?.getTargets?.() ?? [];
    const metrics = externalIntegrationController?.getMetrics?.() ?? {
        observerCount: 0,
        boundCount: 0,
        directCount: 0,
    };
    const directTargets = targets.filter(target => target.resolution?.source === 'direct');
    const failedTargets = directTargets.filter(target => target.bridge?.status === 'failed');
    const userExcludedTargets = targets.filter(target => target.resolution?.source === 'user-excluded');
    const selectableTargets = directTargets.filter(target => target.bridge?.status !== 'failed');
    const runtimeMismatch = Boolean(externalIntegrationController) && (
        metrics.observerCount !== 1 || metrics.boundCount !== directTargets.length
    );
    const capacityLimitedTargetCount = Math.max(0, metrics.capacityLimitedTargetCount ?? 0);
    const managedOptionCapacityLimited = capacityLimitedTargetCount > 0;
    const managedOptionCount = Math.max(
        metrics.expectedManagedOptionCount ?? 0,
        metrics.actualManagedOptionCount ?? 0,
    );
    const managedOptionBudgetExceeded = managedOptionCount
        > EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD;
    const hasManagedOptionWarning = managedOptionCapacityLimited || managedOptionBudgetExceeded;
    const managedOptionWarnings = [
        managedOptionCapacityLimited
            ? `외부 모델 칸 ${capacityLimitedTargetCount}곳은 표시 가능한 CMR 선택지가 ${EXTERNAL_INJECTED_OPTION_LIMIT}개를 넘어 일부만 표시합니다.`
            : null,
        managedOptionBudgetExceeded
            ? `외부 모델 선택지 ${managedOptionCount}개가 권장 한도 ${EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD}개를 초과했습니다.`
            : null,
    ].filter(Boolean).join(' ');
    count.textContent = failedTargets.length || userExcludedTargets.length
        ? `문제 ${failedTargets.length}개 · 사용자 제외 ${userExcludedTargets.length}개`
        : (hasManagedOptionWarning ? '성능 주의' : '설정 없음');

    appendExternalRows(
        list,
        [...failedTargets, ...userExcludedTargets],
        '연결 실패나 사용자 제외 대상이 없습니다.',
    );
    appendExternalRows(
        pickerList,
        selectableTargets,
        '현재 화면에서 직접 제외할 수 있는 외부 모델 칸이 없습니다.',
    );

    const status = settingsRoot.querySelector('#cmr_external_status');
    if (status) {
        status.dataset.state = failedTargets.length || runtimeMismatch
            ? 'error'
            : (hasManagedOptionWarning ? 'warning' : 'ok');
        status.textContent = failedTargets.length
            ? `${failedTargets.length}개 대상의 선택지 연결을 확인해야 합니다.`
            : runtimeMismatch
                ? '외부 연결 감시 자원을 확인해야 합니다.'
                : hasManagedOptionWarning
                    ? managedOptionWarnings
                : userExcludedTargets.length
                    ? `${userExcludedTargets.length}개 대상을 사용자가 연결에서 제외했습니다.`
                    : '현재 조치가 필요한 외부 연결 문제가 없습니다.';
    }

    const warning = settingsRoot.querySelector('#cmr_external_warning');
    const warningText = settingsRoot.querySelector('#cmr_external_warning_text');
    if (warning) {
        const hasProblem = failedTargets.length > 0 || runtimeMismatch || hasManagedOptionWarning;
        warning.hidden = !hasProblem;
        if (warningText) {
            warningText.textContent = !hasProblem
                ? ''
                : (failedTargets.length
                    ? `${failedTargets.length}개 모델 칸에 선택지를 표시하지 못했습니다.`
                    : runtimeMismatch
                        ? '외부 연결 감시 자원 상태가 예상과 다릅니다.'
                        : managedOptionWarnings);
        }
    }

    if (focusedTargetId) {
        const replacementAction = [...settingsRoot.querySelectorAll('[data-cmr-external-action]')]
            .find(action => action.dataset.targetId === focusedTargetId);
        replacementAction?.focus();
    }
}

function renderUi() {
    renderLauncher();
    renderProviderFields();
    renderCompatibilityStatus();
    renderModelList();
    renderModelDeletionUndo();
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

function synchronizeExternalIntegrations() {
    if (!externalIntegrationController) {
        return;
    }
    const desired = Object.keys(externalSettings?.excludedTargets ?? {}).sort();
    const current = (externalIntegrationController.getExcludedTargetIds?.() ?? []).sort();
    if (JSON.stringify(desired) !== JSON.stringify(current)) {
        externalIntegrationController.setExcludedTargetIds?.(desired);
        return;
    }
    externalIntegrationController.sync?.();
}

function synchronizeProviderIntegrations() {
    const controller = providerIntegrationController;
    if (!controller) {
        return;
    }
    try {
        void controller.sync().catch(error => {
            if (providerIntegrationController === controller) {
                console.warn('[Custom Model Router] 공용 provider integration 동기화에 실패했습니다.', error);
            }
        });
    } catch (error) {
        if (providerIntegrationController === controller) {
            console.warn('[Custom Model Router] 공용 provider integration 동기화를 시작하지 못했습니다.', error);
        }
    }
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
    synchronizeProviderIntegrations();
    synchronizeExternalIntegrations();
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
    rememberMaterialRepairReport(repairReport);

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

    if (settingsChanged) {
        pendingModelDeletionUndo = null;
    }
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
        [context.eventTypes.CONNECTION_PROFILE_CREATED, onConnectionStateChanged],
        [context.eventTypes.CONNECTION_PROFILE_LOADED, onConnectionStateChanged],
        [context.eventTypes.CONNECTION_PROFILE_UPDATED, onConnectionStateChanged],
        [context.eventTypes.CONNECTION_PROFILE_DELETED, onConnectionStateChanged],
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
    const selectedTargetIds = Object.keys(normalized.selectedModels);
    const excludedTargetIds = Object.keys(normalized.excludedTargets ?? {});
    const exclusionSet = new Set(excludedTargetIds);
    const staleTargetId = [
        ...selectedTargetIds.filter(candidateTargetId => !exclusionSet.has(candidateTargetId)),
        ...excludedTargetIds,
    ].find(candidateTargetId => (
        candidateTargetId !== targetId && !detectedTargetIds.has(candidateTargetId)
    ));
    if (!staleTargetId) {
        return null;
    }
    const selectedModels = { ...normalized.selectedModels };
    const excludedTargets = { ...(normalized.excludedTargets ?? {}) };
    delete selectedModels[staleTargetId];
    delete excludedTargets[staleTargetId];
    return { ...normalized, selectedModels, excludedTargets };
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
    if (!context || !externalSettings) {
        return;
    }
    // 과거 버전이 provider 선택기를 model target으로 오인해 저장한 선택은
    // 실제 모델 선호가 아니므로 option 정리와 함께 target 전체 기록을 폐기한다.
    if (reason === 'provider-control') {
        const next = setExternalTargetExcluded(
            removeExternalTargetSelections(externalSettings, targetId),
            targetId,
            false,
        );
        if (JSON.stringify(next) === JSON.stringify(externalSettings)) {
            return;
        }
        externalSettings = next;
        context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
        acceptedExternalSnapshot = normalizeAutomaticExternalSettings(externalSettings);
        context.saveSettingsDebounced();
        renderExternalIntegrations();
        return;
    }
    // 일시적인 외부 컨트롤 정리에는 마지막 선택을 보존한다.
    // Registry에서 실제 모델이 사라진 경우에만 더는 복원할 수 없는 provider 선택을 정리한다.
    if (reason !== 'models-updated' || !providerId
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

function onExternalListClick(event) {
    const button = event.target?.closest?.('[data-cmr-external-action]');
    if (!button || !settingsRoot?.contains(button) || !context || !externalSettings) {
        return;
    }
    const targetId = String(button.dataset.targetId ?? '');
    const action = button.dataset.cmrExternalAction;
    const target = (externalIntegrationController?.getTargets?.() ?? [])
        .find(candidate => candidate.targetId === targetId);
    const actionMatchesState = (action === 'exclude' && target?.resolution?.source === 'direct')
        || (action === 'restore' && target?.resolution?.source === 'user-excluded');
    if (!target || !actionMatchesState) {
        announce('외부 연결 대상을 찾지 못했습니다.', 'error');
        return;
    }

    try {
        const excluded = action === 'exclude';
        const next = withExternalTargetCapacityRecovery(externalSettings, targetId, candidate => (
            setExternalTargetExcluded(candidate, targetId, excluded)
        ));
        externalSettings = next;
        context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
        acceptedExternalSnapshot = normalizeAutomaticExternalSettings(externalSettings);
        context.saveSettingsDebounced();
        externalIntegrationController?.setExcludedTargetIds?.(
            Object.keys(externalSettings.excludedTargets ?? {}),
        );
        renderExternalIntegrations();
        announce(excluded
            ? `${target.extensionLabel ?? target.label} 모델 칸을 CMR 연결에서 제외했습니다.`
            : `${target.extensionLabel ?? target.label} 모델 칸을 다시 연결했습니다.`);
    } catch (error) {
        console.error('[Custom Model Router] 외부 연결 제외 설정을 저장하지 못했습니다.', error);
        announce('외부 연결 제외 설정을 저장하지 못했습니다.', 'error');
    }
}

function onOpenExternalManager() {
    const operations = settingsRoot?.querySelector('#cmr_operations_section');
    const advanced = settingsRoot?.querySelector('#cmr_external_advanced');
    if (operations) {
        operations.open = true;
    }
    if (advanced) {
        advanced.open = true;
        const failedAction = advanced.querySelector?.('#cmr_external_list [data-cmr-external-action="exclude"]');
        (failedAction ?? advanced.querySelector?.('#cmr_external_status') ?? advanced.querySelector?.('summary'))?.focus?.();
        advanced.scrollIntoView?.({ block: 'nearest' });
    }
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
        userExcludedCount: 0,
        connectedCount: 0,
        idleCount: 0,
        failedCount: 0,
        listenerCount: 0,
    };
    const externalTargets = externalIntegrationController?.getTargets?.() ?? [];
    const externalCheck = diagnoseExternalRuntimeResources(externalMetrics, externalTargets);
    const providerIntegrationCheck = diagnoseProviderIntegrations(
        providerIntegrationController?.getMetrics?.() ?? {},
    );
    const stability = stabilityMonitor?.analyze() ?? null;
    const stabilityCheck = stability?.evaluated ? {
        id: 'runtime-stability',
        category: 'stability',
        status: stability.status === 'error'
            ? 'failed'
            : (stability.status === 'warning' ? 'warning' : 'passed'),
        message: `장시간 계측 · ${stability.summary}`,
        details: {
            sampleCount: stability.sampleCount,
            activeSampleCount: stability.activeSampleCount,
        },
    } : null;
    const repairCheck = createRepairDiagnosticCheck(lastRepairReport);
    const checks = [
        ...compatibility.checks,
        externalCheck,
        providerIntegrationCheck,
        ...(repairCheck ? [repairCheck] : []),
        ...(stabilityCheck ? [stabilityCheck] : []),
    ];
    const diagnosticSummary = summarizeDiagnosticChecks(checks);
    return {
        ...compatibility,
        checks,
        counts: diagnosticSummary.counts,
        status: diagnosticSummary.status,
        summary: diagnosticSummary.summary,
        extensionVersion: EXTENSION_VERSION,
        externalIntegrations: externalCheck.details,
        providerIntegrations: providerIntegrationCheck.details,
        stability,
        repair: lastRepairReport,
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
    if (lastDiagnosticReport.stability && !lastDiagnosticReport.stability.evaluated) {
        const item = document.createElement('li');
        item.dataset.status = 'pending';
        item.textContent = formatUiSentences(`장시간 계측 · ${lastDiagnosticReport.stability.summary}`);
        list.append(item);
    }
}

function onRunDiagnostics() {
    synchronizeExternalIntegrations();
    lastDiagnosticReport = createDiagnosticReport();
    renderDiagnosticReport();
}

async function onCopyDiagnostics() {
    try {
        externalIntegrationController?.sync?.();
        lastDiagnosticReport = createDiagnosticReport();
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
    } catch (error) {
        const message = error instanceof PortableSettingsError
            ? `${error.code}: ${error.message}`
            : '이 브라우저에서는 백업 파일을 내보내지 못했습니다.';
        announce(message, 'error');
    }
}

function isCurrentImportOperation(operation) {
    return operation.sequence === importOperationSequence
        && operation.generation === lifecycleGeneration
        && context === operation.context
        && purposeRouter === operation.purposeRouter
        && settingsRoot?.querySelector('#cmr_import_backup') === operation.input;
}

function createImportSettingsFingerprint() {
    // 이 문자열은 stale 판정에만 사용한다. route profile ID와 외부 target ID를
    // 미리보기·진단·오류 메시지에 포함하지 않는다.
    return JSON.stringify({
        registry: normalizeSettings(settings),
        routes: normalizePurposeRoutes(routingSettings),
        external: normalizeAutomaticExternalSettings(externalSettings),
    });
}

function createCurrentImportPreview(parsed) {
    return createSettingsImportPreview({
        currentRegistrySettings: settings,
        currentPurposeRoutes: routingSettings,
        currentExternalSettings: externalSettings,
        importedRegistrySettings: parsed.registrySettings,
        importedPurposeRoutes: parsed.purposeRoutes,
        importedExternalSettings: parsed.externalSettings,
    });
}

function getImportRegistrySafety(parsed) {
    try {
        return {
            registrySettings: assertRegistryReplacementSafe(parsed.registrySettings),
            blocker: null,
        };
    } catch (error) {
        return {
            registrySettings: null,
            blocker: {
                code: error instanceof ModelRegistryError ? error.code : 'registry_replacement_unsafe',
                message: error instanceof ModelRegistryError
                    ? error.message
                    : '현재 사용 중인 모델을 보호하기 위해 이 백업을 적용할 수 없습니다.',
            },
        };
    }
}

function createImportPreviewSignature(preview, blocker) {
    return JSON.stringify({ preview, blockerCode: blocker?.code ?? null });
}

function describePreviewModel(model) {
    const provider = getProvider(model.provider);
    return `${provider?.label ?? model.provider} · ${model.modelId}`;
}

function collectImportPreviewItems(preview) {
    const items = [];
    const add = (change, text) => items.push({ change, text });
    for (const model of preview.registry.models.additions) {
        add('addition', `모델 추가 · ${describePreviewModel(model)}`);
    }
    for (const model of preview.registry.models.conflicts) {
        add('conflict', `모델 설정 변경 · ${describePreviewModel(model)} · ${model.changedKeys.join(', ')}`);
    }
    for (const model of preview.registry.models.deletions) {
        add('deletion', `모델 삭제 · ${describePreviewModel(model)}`);
    }
    for (const selection of preview.registry.selections.additions) {
        add('addition', `모델 선택 추가 · ${describePreviewModel(selection)}`);
    }
    for (const selection of preview.registry.selections.conflicts) {
        const provider = getProvider(selection.provider);
        add('conflict', `모델 선택 변경 · ${provider?.label ?? selection.provider} · ${selection.currentModelId} → ${selection.importedModelId}`);
    }
    for (const selection of preview.registry.selections.deletions) {
        add('deletion', `모델 선택 삭제 · ${describePreviewModel(selection)}`);
    }
    for (const route of preview.routes.additions) {
        add('addition', `기능 경로 추가 · ${route.purpose}`);
    }
    for (const route of preview.routes.conflicts) {
        add('conflict', `기능 경로 변경 · ${route.purpose} · ${route.changedKeys.join(', ')}`);
    }
    for (const route of preview.routes.deletions) {
        add('deletion', `기능 경로 삭제 · ${route.purpose}`);
    }
    const externalChanges = [
        preview.external.changes.selections,
        preview.external.changes.exclusions,
    ].reduce((totals, changes) => ({
        additions: totals.additions + changes.additions,
        conflicts: totals.conflicts + changes.conflicts,
        deletions: totals.deletions + changes.deletions,
    }), { additions: 0, conflicts: 0, deletions: 0 });
    if (externalChanges.additions) {
        add('addition', `외부 연결 기록 추가 · ${externalChanges.additions}건`);
    }
    if (externalChanges.conflicts) {
        add('conflict', `외부 연결 기록 변경 · ${externalChanges.conflicts}건`);
    }
    if (externalChanges.deletions) {
        add('deletion', `외부 연결 기록 삭제 · ${externalChanges.deletions}건`);
    }
    return items;
}

function renderImportPreview() {
    const section = settingsRoot?.querySelector('#cmr_import_preview');
    const summary = settingsRoot?.querySelector('#cmr_import_preview_summary');
    const list = settingsRoot?.querySelector('#cmr_import_preview_list');
    const applyButton = settingsRoot?.querySelector('#cmr_import_preview_apply');
    if (!section || !summary || !list || !applyButton) {
        return;
    }
    section.hidden = !pendingImportPreview;
    list.replaceChildren();
    if (!pendingImportPreview) {
        summary.textContent = '';
        return;
    }

    const { preview, blocker } = pendingImportPreview;
    applyButton.disabled = Boolean(blocker) || !preview.hasChanges;
    summary.dataset.state = blocker ? 'error' : (preview.hasChanges ? 'warning' : 'ok');
    summary.textContent = blocker
        ? `적용할 수 없는 충돌이 있습니다. ${blocker.code}: ${blocker.message}`
        : (preview.hasChanges
            ? `추가 ${preview.summary.additions}건 · 변경 충돌 ${preview.summary.conflicts}건 · 삭제 ${preview.summary.deletions}건`
            : '현재 CMR 설정과 동일한 백업입니다.');

    const items = collectImportPreviewItems(preview);
    const visibleItems = items.slice(0, 40);
    for (const item of visibleItems) {
        const row = document.createElement('li');
        row.dataset.change = item.change;
        row.textContent = item.text;
        list.append(row);
    }
    if (items.length > visibleItems.length) {
        const row = document.createElement('li');
        row.textContent = `그 밖의 변경 ${items.length - visibleItems.length}건`;
        list.append(row);
    }
    if (!items.length) {
        const row = document.createElement('li');
        row.className = 'cmr-empty';
        row.textContent = '적용할 변경이 없습니다.';
        list.append(row);
    }
}

function closeImportPreview(message = '') {
    pendingImportPreview = null;
    renderImportPreview();
    if (message) {
        announce(message);
    }
}

function onCancelImportPreview() {
    closeImportPreview('백업 가져오기를 취소했습니다.');
    settingsRoot?.querySelector('#cmr_import_backup_button')?.focus?.();
}

function onApplyImportPreview() {
    const pending = pendingImportPreview;
    if (!pending || !isCurrentImportOperation(pending.operation)) {
        closeImportPreview();
        announce('백업 미리보기가 만료되었습니다. 파일을 다시 선택해 주세요.', 'error');
        return;
    }

    const preview = createCurrentImportPreview(pending.parsed);
    const safety = getImportRegistrySafety(pending.parsed);
    const signature = createImportPreviewSignature(preview, safety.blocker);
    const settingsFingerprint = createImportSettingsFingerprint();
    if (settingsFingerprint !== pending.settingsFingerprint || signature !== pending.signature) {
        pendingImportPreview = {
            ...pending,
            preview,
            blocker: safety.blocker,
            registrySettings: safety.registrySettings,
            signature,
            settingsFingerprint,
        };
        renderImportPreview();
        announce('미리보기 중 설정이 바뀌어 변경 내역을 다시 계산했습니다. 다시 확인해 주세요.', 'error');
        return;
    }
    if (safety.blocker || !preview.hasChanges) {
        renderImportPreview();
        return;
    }

    settings = safety.registrySettings;
    externalSettings = normalizeAutomaticExternalSettings(pending.parsed.externalSettings);
    pending.operation.context.extensionSettings[SETTINGS_KEY] = settings;
    pending.operation.context.extensionSettings[EXTERNAL_SETTINGS_KEY] = externalSettings;
    pending.operation.purposeRouter.replaceRoutes(pending.parsed.purposeRoutes);
    acceptedExternalSnapshot = normalizeAutomaticExternalSettings(externalSettings);
    pendingModelDeletionUndo = null;
    closeImportPreview();
    persistSettings('backup-import');
    synchronize();
    announce(pending.parsed.report.status === 'warning'
        ? `백업을 가져왔습니다. ${pending.parsed.report.summary}`
        : '미리보기에서 확인한 Registry, 용도별 경로와 외부 확장 연결 변경을 적용했습니다.');
    settingsRoot?.querySelector('#cmr_import_backup_button')?.focus?.();
}

async function onImportBackup(event) {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    if (!file) {
        return;
    }
    const operation = {
        sequence: ++importOperationSequence,
        generation: lifecycleGeneration,
        context,
        purposeRouter,
        input,
    };
    pendingImportPreview = null;
    renderImportPreview();
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
        const preview = createCurrentImportPreview(parsed);
        const safety = getImportRegistrySafety(parsed);
        pendingImportPreview = {
            operation,
            parsed,
            preview,
            blocker: safety.blocker,
            registrySettings: safety.registrySettings,
            signature: createImportPreviewSignature(preview, safety.blocker),
            settingsFingerprint: createImportSettingsFingerprint(),
        };
        renderImportPreview();
        announce(safety.blocker
            ? `백업 변경 내역을 확인했습니다. ${safety.blocker.code}: ${safety.blocker.message}`
            : '백업 변경 내역을 확인한 뒤 적용하거나 취소해 주세요.', safety.blocker ? 'error' : 'ok');
        settingsRoot?.querySelector(safety.blocker || !preview.hasChanges
            ? '#cmr_import_preview_cancel'
            : '#cmr_import_preview_apply')?.focus?.();
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
    const modelInput = settingsRoot.querySelector('#cmr_model_id');
    if (modelInput) {
        modelInput.maxLength = BULK_MODEL_INPUT_MAX_LENGTH;
    }
    populateProviderSelect();
    settingsRoot.querySelector('#cmr_provider')?.addEventListener('change', onProviderChange);
    settingsRoot.querySelector('#cmr_add_form')?.addEventListener('submit', onAddModel);
    settingsRoot.querySelector('#cmr_model_search')?.addEventListener('input', onModelSearchInput);
    settingsRoot.querySelector('#cmr_undo_delete')?.addEventListener('click', onUndoModelDeletion);
    settingsRoot.querySelector('#cmr_model_list')?.addEventListener('click', onModelListClick);
    settingsRoot.querySelector('#cmr_external_advanced')?.addEventListener('click', onExternalListClick);
    settingsRoot.querySelector('#cmr_external_warning_open')?.addEventListener('click', onOpenExternalManager);
    settingsRoot.querySelector('#cmr_run_diagnostics')?.addEventListener('click', onRunDiagnostics);
    settingsRoot.querySelector('#cmr_copy_diagnostics')?.addEventListener('click', onCopyDiagnostics);
    settingsRoot.querySelector('#cmr_export_backup')?.addEventListener('click', onExportBackup);
    settingsRoot.querySelector('#cmr_import_backup_button')?.addEventListener('click', () => {
        settingsRoot?.querySelector('#cmr_import_backup')?.click?.();
    });
    settingsRoot.querySelector('#cmr_import_backup')?.addEventListener('change', onImportBackup);
    settingsRoot.querySelector('#cmr_import_preview_apply')?.addEventListener('click', onApplyImportPreview);
    settingsRoot.querySelector('#cmr_import_preview_cancel')?.addEventListener('click', onCancelImportPreview);
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
    modelSearchQuery = '';
    pendingModelDeletionUndo = null;
    pendingImportPreview = null;
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
        let showResult;
        try {
            showResult = popup.show();
        } catch (error) {
            handlePopupShowFailure(popup, root, error);
            return;
        }
        void Promise.resolve(showResult).catch(error => handlePopupShowFailure(popup, root, error));
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
        const control = getProviderControl(provider);
        const plan = createBulkModelRegistrationPlan(
            settings,
            provider.id,
            input?.value,
            {
                isUnavailableModelId: id => (
                    provider.controlType === 'select'
                    && Boolean(control)
                    && isNativeModelOption(control, id)
                ),
            },
        );
        if (!plan.ok) {
            const examples = plan.invalid.slice(0, 3)
                .map(issue => `${issue.line}행: ${issue.message}`)
                .join(' ');
            throw new ModelManagementError(
                'model_input_invalid',
                `잘못된 모델 ID ${plan.invalid.length}개가 있어 아무 모델도 등록하지 않았습니다. ${examples}`,
            );
        }
        if (!plan.additions.length) {
            input?.setAttribute('aria-invalid', 'false');
            announce(plan.duplicates.length
                ? `새로 등록할 모델이 없습니다. 중복 ${plan.duplicates.length}개를 건너뛰었습니다.`
                : '등록할 모델 ID를 한 줄에 하나씩 입력해 주세요.', 'error');
            return;
        }
        const nextSettings = applyBulkModelRegistrationPlan(settings, plan);
        pendingModelDeletionUndo = null;
        settings = nextSettings;
        persistSettings('settings-ui');
        if (input) {
            input.value = '';
            input.setAttribute('aria-invalid', 'false');
            input.focus?.();
        }
        synchronize();
        const duplicateSuffix = plan.duplicates.length
            ? ` 중복 ${plan.duplicates.length}개는 건너뛰었습니다.`
            : '';
        announce(plan.additions.length === 1
            ? `${provider.label}에 ${plan.additions[0].id} 모델을 등록했습니다.${duplicateSuffix} 사용할 모델은 API Connections의 모델 선택기 또는 입력란에서 선택·입력하세요.`
            : `${provider.label}에 모델 ${plan.additions.length}개를 등록했습니다.${duplicateSuffix}`);
    } catch (error) {
        input?.setAttribute('aria-invalid', 'true');
        const message = error instanceof ModelRegistryError || error instanceof ModelManagementError
            ? error.message
            : '모델을 등록하지 못했습니다.';
        announce(message, 'error');
    }
}

function onModelSearchInput(event) {
    modelSearchQuery = String(event.currentTarget?.value ?? '');
    renderModelList();
}

function onUndoModelDeletion() {
    const undo = pendingModelDeletionUndo;
    if (!undo) {
        renderModelDeletionUndo();
        announce('실행 취소할 최근 모델 삭제가 없습니다.', 'error');
        return;
    }
    const result = restoreModelDeletion(settings, undo);
    if (!result.ok) {
        pendingModelDeletionUndo = null;
        renderModelDeletionUndo();
        announce(result.message, 'error');
        return;
    }
    settings = result.settings;
    pendingModelDeletionUndo = null;
    persistSettings('settings-ui');
    synchronize();
    const provider = getProvider(undo.providerId);
    announce(`${provider?.label ?? undo.providerId}의 ${undo.model.id} 모델 등록을 복구했습니다.`);
    const restoredButton = [...(settingsRoot?.querySelectorAll?.('[data-cmr-action="delete"]') ?? [])]
        .find(button => button.dataset.provider === undo.providerId && button.dataset.modelId === undo.model.id);
    restoredButton?.focus?.();
}

function onModelListClick(event) {
    const button = event.target?.closest?.('[data-cmr-action]');
    if (!button || !settingsRoot?.contains(button)) {
        return;
    }
    const provider = getProvider(button.dataset.provider);
    const modelId = normalizeModelId(button.dataset.modelId);
    const registered = normalizeSettings(settings).models.some(model => (
        model.provider === provider?.id && model.id === modelId
    ));
    if (!provider || !registered) {
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
        const undo = createModelDeletionUndo(settings, provider.id, modelId);
        settings = removeModel(settings, provider.id, modelId);
        pendingModelDeletionUndo = undo;
        persistSettings('settings-ui');
        synchronize();
        settingsRoot?.querySelector('#cmr_undo_delete')?.focus?.();
        announce(preservesInputValue
            ? `${provider.label}에서 ${modelId} 등록만 삭제했습니다. 현재 모델 입력값은 유지됩니다.`
            : `${provider.label}에서 ${modelId} 모델 등록을 삭제했습니다.`);
    }
}

async function teardownRuntime({ applyNativeFallback = false } = {}) {
    observer?.disconnect();
    observer = null;
    observedContainer = null;
    const providerIntegrationCleanup = providerIntegrationController?.destroy?.();
    providerIntegrationController = null;
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
    try {
        await providerIntegrationCleanup;
    } catch (error) {
        console.warn('[Custom Model Router] 공용 provider integration 정리에 실패했습니다.', error);
    }
}

async function initialize(generation) {
    context = getSillyTavernContext();
    const storedSettings = context.extensionSettings[SETTINGS_KEY];
    const storedRoutes = context.extensionSettings[ROUTES_SETTINGS_KEY];
    const storedExternal = context.extensionSettings[EXTERNAL_SETTINGS_KEY];
    const initialRepairReport = repairSettingsBundle({
        registrySettings: storedSettings,
        purposeRoutes: storedRoutes,
    });
    rememberMaterialRepairReport(initialRepairReport);
    if (!initialRepairReport.ok) {
        const issue = initialRepairReport.errors[0];
        throw new PortableSettingsError(
            issue?.code ?? 'settings_repair_failed',
            initialRepairReport.summary,
            initialRepairReport.errors,
        );
    }
    settings = normalizeSettings(initialRepairReport.registrySettings);
    routingSettings = normalizePurposeRoutes(initialRepairReport.purposeRoutes);
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
    providerIntegrationController = createProviderIntegrationController({
        readRegistrySettings: () => settings,
        getContext: () => getLiveContext(),
        onError: error => {
            console.warn('[Custom Model Router] 공용 provider integration 처리 실패', error);
        },
    });
    registryApiController = createRegistryApi({
        extensionVersion: EXTENSION_VERSION,
        readSettings: () => settings,
        writeSettings: writeRegistryApiSettings,
        routingApi: createPurposeRoutingApi(purposeRouter),
        integrationsApi: providerIntegrationController.api,
        onSubscriberError: error => {
            console.error('[Custom Model Router] Registry API 구독자 처리 실패', error);
        },
    });
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
        excludedTargetIds: Object.keys(externalSettings.excludedTargets ?? {}),
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
    uninstallRegistryApi = installRegistryApi(globalThis, registryApiController.api);
    announceProviderIntegrationApi(document, providerIntegrationController.api);
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
    const runPromise = initialize(generation).catch(async error => {
        if (generation === lifecycleGeneration) {
            await teardownRuntime({ applyNativeFallback: true });
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
        await teardownRuntime({ applyNativeFallback: true });
    });
    const trackedPromise = runPromise.finally(() => {
        if (destructionPromise === trackedPromise) {
            destructionPromise = null;
        }
    });
    destructionPromise = trackedPromise;
    return trackedPromise;
}
