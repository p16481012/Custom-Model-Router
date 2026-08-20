import { getProvider, getProviders } from './providers.js';
import {
    EXTERNAL_INJECTED_OPTION_LIMIT,
    EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD,
    EXTERNAL_TARGET_LIMIT,
} from './external-integrations.js';

export const DIAGNOSTIC_SCHEMA_VERSION = 2;
export const MINIMUM_SILLYTAVERN_VERSION = '1.18.0';
export const VALIDATED_SILLYTAVERN_VERSIONS = Object.freeze(['1.18.0']);

export const REQUIRED_CONTEXT_CAPABILITIES = Object.freeze([
    Object.freeze({ path: 'extensionSettings', type: 'object', label: '확장 설정' }),
    Object.freeze({ path: 'saveSettingsDebounced', type: 'function', label: '설정 저장 함수' }),
    Object.freeze({ path: 'eventSource', type: 'object', label: '이벤트 소스' }),
    Object.freeze({ path: 'eventSource.on', type: 'function', label: '이벤트 구독 함수' }),
    Object.freeze({ path: 'eventSource.removeListener', type: 'function', label: '이벤트 구독 해제 함수' }),
    Object.freeze({ path: 'chatCompletionSettings', type: 'object', label: 'Chat Completion 설정' }),
    Object.freeze({ path: 'Popup', type: 'function', label: '팝업 API' }),
    Object.freeze({ path: 'POPUP_TYPE', type: 'object', label: '팝업 유형' }),
]);

export const REQUIRED_EVENT_CAPABILITIES = Object.freeze([
    'APP_INITIALIZED',
    'SETTINGS_UPDATED',
    'CHATCOMPLETION_SOURCE_CHANGED',
    'CHATCOMPLETION_MODEL_CHANGED',
    'MAIN_API_CHANGED',
    'OAI_PRESET_CHANGED_AFTER',
    'CONNECTION_PROFILE_LOADED',
]);

const RESOURCE_METRICS = Object.freeze([
    'launcherCount',
    'panelCount',
    'observerCount',
    'externalObserverCount',
    'listenerCount',
    'boundControlCount',
    'modelGroupCount',
    'pendingTaskCount',
]);

const SINGLE_INSTANCE_RESOURCE_LIMITS = Object.freeze({
    launcherCount: 1,
    panelCount: 1,
    observerCount: 1,
    externalObserverCount: 1,
});

const BOUNDED_RESOURCE_LIMITS = Object.freeze({
    listenerCount: REQUIRED_EVENT_CAPABILITIES.length,
    boundControlCount: getProviders().length,
    modelGroupCount: getProviders().length,
});

const STATUS_RANK = Object.freeze({ passed: 0, warning: 1, failed: 2 });
const EXTERNAL_MANAGED_OPTION_COUNT_LIMIT = EXTERNAL_TARGET_LIMIT * EXTERNAL_INJECTED_OPTION_LIMIT;

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function getPathValue(source, path) {
    return path.split('.').reduce((value, key) => value?.[key], source);
}

function createCheck(id, category, status, message, details = undefined) {
    const result = { id, category, status, message };
    if (details && Object.keys(details).length) {
        result.details = details;
    }
    return result;
}

export function summarizeDiagnosticChecks(checks) {
    const counts = { passed: 0, warning: 0, failed: 0 };
    for (const check of checks) {
        if (Object.hasOwn(counts, check?.status)) {
            counts[check.status] += 1;
        }
    }

    const status = counts.failed > 0 ? 'error' : (counts.warning > 0 ? 'warning' : 'ok');
    const summary = status === 'ok'
        ? `호환성 검사 ${counts.passed}개를 모두 통과했습니다.`
        : (status === 'warning'
            ? `호환성 검사에서 주의 사항 ${counts.warning}개를 찾았습니다.`
            : `호환성 검사에서 오류 ${counts.failed}개와 주의 사항 ${counts.warning}개를 찾았습니다.`);

    return { status, summary, counts };
}

function safelyQueryAll(documentRef, selector) {
    try {
        return Array.from(documentRef?.querySelectorAll?.(selector) ?? []);
    } catch {
        return [];
    }
}

function safelyQuery(documentRef, selector) {
    try {
        return documentRef?.querySelector?.(selector) ?? null;
    } catch {
        return null;
    }
}

export function normalizeSillyTavernVersion(value) {
    const match = String(value ?? '').match(/(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:[^0-9]|$)/);
    return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function compareVersions(left, right) {
    const a = normalizeSillyTavernVersion(left);
    const b = normalizeSillyTavernVersion(right);
    if (!a || !b) {
        return null;
    }

    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (aParts[index] !== bParts[index]) {
            return aParts[index] < bParts[index] ? -1 : 1;
        }
    }
    return 0;
}

function diagnoseVersion(clientVersion, documentRef) {
    const versionText = clientVersion
        ?? safelyQuery(documentRef, '#version_display')?.textContent
        ?? '';
    const version = normalizeSillyTavernVersion(versionText);
    if (!version) {
        return {
            version: null,
            check: createCheck(
                'st-version-unavailable',
                'version',
                'warning',
                'SillyTavern 버전을 확인하지 못했습니다. 기능 계약 검사는 계속 진행했습니다.',
            ),
        };
    }

    if (compareVersions(version, MINIMUM_SILLYTAVERN_VERSION) < 0) {
        return {
            version,
            check: createCheck(
                'st-version-too-old',
                'version',
                'failed',
                `SillyTavern ${version}은 최소 지원 버전 ${MINIMUM_SILLYTAVERN_VERSION}보다 낮습니다.`,
                { detected: version, minimum: MINIMUM_SILLYTAVERN_VERSION },
            ),
        };
    }

    if (!VALIDATED_SILLYTAVERN_VERSIONS.includes(version)) {
        return {
            version,
            check: createCheck(
                'st-version-unverified',
                'version',
                'warning',
                `SillyTavern ${version}은 최소 버전을 충족하지만 검증 행렬에는 아직 없습니다.`,
                { detected: version, validated: [...VALIDATED_SILLYTAVERN_VERSIONS] },
            ),
        };
    }

    return {
        version,
        check: createCheck(
            'st-version-validated',
            'version',
            'passed',
            `SillyTavern ${version}은 검증된 버전입니다.`,
            { detected: version },
        ),
    };
}

function resolveContext(sillyTavern, suppliedContext) {
    if (suppliedContext !== undefined) {
        return { context: suppliedContext, error: null };
    }
    if (!sillyTavern || typeof sillyTavern.getContext !== 'function') {
        return { context: null, error: 'SillyTavern.getContext()를 찾을 수 없습니다.' };
    }

    try {
        return { context: sillyTavern.getContext(), error: null };
    } catch {
        return { context: null, error: 'SillyTavern.getContext() 호출 중 오류가 발생했습니다.' };
    }
}

function diagnoseContext(context) {
    const checks = [];
    const missing = [];

    for (const capability of REQUIRED_CONTEXT_CAPABILITIES) {
        const value = getPathValue(context, capability.path);
        const matches = capability.type === 'object' ? isObject(value) : typeof value === capability.type;
        if (!matches) {
            missing.push(capability.label);
        }
    }
    if (!isObject(context?.eventTypes ?? context?.event_types)) {
        missing.push('이벤트 유형');
    }

    checks.push(missing.length
        ? createCheck(
            'context-required-capabilities',
            'context',
            'failed',
            `필수 SillyTavern API가 없습니다: ${missing.join(', ')}`,
            { missing },
        )
        : createCheck(
            'context-required-capabilities',
            'context',
            'passed',
            '필수 SillyTavern context API를 모두 찾았습니다.',
        ));

    const eventTypes = context?.eventTypes ?? context?.event_types;
    const missingEvents = REQUIRED_EVENT_CAPABILITIES.filter(key => (
        typeof eventTypes?.[key] !== 'string' || !eventTypes[key]
    ));
    checks.push(missingEvents.length
        ? createCheck(
            'context-event-contract',
            'events',
            'warning',
            `연결·설정 변경 동기화 이벤트 일부를 찾지 못했습니다: ${missingEvents.join(', ')}`,
            { missing: missingEvents },
        )
        : createCheck(
            'context-event-contract',
            'events',
            'passed',
            '연결·설정 변경 동기화 이벤트 계약이 일치합니다.',
        ));

    const requestCapabilities = {
        'ChatCompletionService.processRequest': typeof context?.ChatCompletionService?.processRequest === 'function',
        'ConnectionManagerRequestService.getProfile': typeof context?.ConnectionManagerRequestService?.getProfile === 'function',
        'ConnectionManagerRequestService.validateProfile': typeof context?.ConnectionManagerRequestService?.validateProfile === 'function',
        'ConnectionManagerRequestService.sendRequest': typeof context?.ConnectionManagerRequestService?.sendRequest === 'function',
        CONNECT_API_MAP: isObject(context?.CONNECT_API_MAP),
    };
    const missingRequestCapabilities = Object.entries(requestCapabilities)
        .filter(([, available]) => !available)
        .map(([key]) => key);
    checks.push(missingRequestCapabilities.length
        ? createCheck(
            'context-request-contract',
            'request',
            'warning',
            '보조 요청 라우팅에 필요한 요청 계약 일부를 찾지 못했습니다.',
            { missing: missingRequestCapabilities },
        )
        : createCheck(
            'context-request-contract',
            'request',
            'passed',
            '보조 요청 라우팅에 필요한 요청 계약을 찾았습니다.',
        ));

    return checks;
}

function diagnoseProviderContracts(context, documentRef) {
    const providers = getProviders();
    const missing = [];
    const wrongType = [];
    const available = [];

    for (const provider of providers) {
        const control = safelyQuery(documentRef, provider.selector);
        const expectedTag = provider.controlType === 'select' ? 'SELECT' : 'INPUT';
        if (!control) {
            missing.push(provider.id);
        } else if (String(control.tagName).toUpperCase() !== expectedTag) {
            wrongType.push(provider.id);
        } else {
            available.push(provider.id);
        }
    }

    const source = String(context?.chatCompletionSettings?.chat_completion_source ?? '');
    const activeProvider = getProvider(source);
    const checks = [];

    if (!documentRef?.querySelector) {
        checks.push(createCheck(
            'provider-control-inventory',
            'dom',
            'warning',
            'DOM을 사용할 수 없어 제공업체 모델 컨트롤을 검사하지 못했습니다.',
        ));
    } else if (missing.length || wrongType.length) {
        checks.push(createCheck(
            'provider-control-inventory',
            'dom',
            'warning',
            `지원 제공업체 ${providers.length}개 중 모델 컨트롤 ${available.length}개를 확인했습니다.`,
            { available: available.length, missing, wrongType },
        ));
    } else {
        checks.push(createCheck(
            'provider-control-inventory',
            'dom',
            'passed',
            `지원 제공업체 모델 컨트롤 ${providers.length}개를 모두 확인했습니다.`,
            { available: available.length },
        ));
    }

    if (!source) {
        checks.push(createCheck(
            'active-provider-contract',
            'provider',
            'warning',
            '현재 Chat Completion 제공업체를 확인하지 못했습니다.',
        ));
    } else if (!activeProvider) {
        checks.push(createCheck(
            'active-provider-contract',
            'provider',
            'warning',
            `현재 제공업체 ${source}는 Custom Model Router 지원 목록에 없습니다.`,
            { source },
        ));
    } else {
        const control = safelyQuery(documentRef, activeProvider.selector);
        const settings = context?.[activeProvider.settingsProperty];
        const settingContractAvailable = isObject(settings)
            && Object.hasOwn(settings, activeProvider.settingKey);
        const controlAvailable = Boolean(control);
        const status = settingContractAvailable && controlAvailable ? 'passed' : 'failed';
        checks.push(createCheck(
            'active-provider-contract',
            'provider',
            status,
            status === 'passed'
                ? `${activeProvider.label} 모델 컨트롤과 설정 키가 일치합니다.`
                : `${activeProvider.label}의 모델 컨트롤 또는 설정 키 계약이 달라졌습니다.`,
            {
                provider: activeProvider.id,
                controlAvailable,
                settingContractAvailable,
            },
        ));
    }

    return { checks, inventory: { available, missing, wrongType } };
}

function findDuplicateKeys(entries, toKey) {
    const counts = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const key = toKey(entry);
        if (key) {
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([key, count]) => ({ key, count }));
}

function findDuplicateListenerReferences(subscriptions) {
    const eventHandlers = new Map();
    const duplicateEvents = new Map();
    for (const subscription of Array.isArray(subscriptions) ? subscriptions : []) {
        const eventName = String(subscription?.eventName ?? '');
        const handler = subscription?.handler;
        if (!eventName || typeof handler !== 'function') {
            continue;
        }
        if (!eventHandlers.has(eventName)) {
            eventHandlers.set(eventName, new Set());
        }
        const handlers = eventHandlers.get(eventName);
        if (handlers.has(handler)) {
            duplicateEvents.set(eventName, (duplicateEvents.get(eventName) ?? 0) + 1);
        } else {
            handlers.add(handler);
        }
    }
    return [...duplicateEvents.entries()].map(([eventName, duplicateCount]) => ({
        eventName,
        duplicateCount,
    }));
}

function findDuplicateModelGroups(groups) {
    const countsByHost = new Map();
    const duplicates = [];
    for (const group of Array.isArray(groups) ? groups : []) {
        const providerId = String(group?.dataset?.cmrProvider ?? '');
        const optionHost = group?.parentElement ?? group?.parentNode ?? null;
        if (!providerId || !optionHost) {
            continue;
        }
        if (!countsByHost.has(optionHost)) {
            countsByHost.set(optionHost, new Map());
        }
        const providerCounts = countsByHost.get(optionHost);
        providerCounts.set(providerId, (providerCounts.get(providerId) ?? 0) + 1);
    }
    for (const providerCounts of countsByHost.values()) {
        for (const [key, count] of providerCounts) {
            if (count > 1) {
                duplicates.push({ key, count });
            }
        }
    }
    return duplicates;
}

export function diagnoseRuntimeResources(runtimeState = {}, documentRef = globalThis.document) {
    const checks = [];
    const subscriptions = Array.isArray(runtimeState.subscriptions) ? runtimeState.subscriptions : [];
    const duplicateListeners = findDuplicateListenerReferences(subscriptions);
    const duplicateBindings = findDuplicateKeys(
        runtimeState.controlBindings,
        binding => String(binding?.providerId ?? ''),
    );

    const domLauncherCount = safelyQueryAll(documentRef, '#cmr_open_manager').length;
    const domPanelCount = safelyQueryAll(documentRef, '#cmr_manager_dialog').length;
    const launcherCount = Number.isInteger(runtimeState.launcherCount)
        ? runtimeState.launcherCount
        : domLauncherCount;
    const panelCount = Number.isInteger(runtimeState.panelCount)
        ? runtimeState.panelCount
        : domPanelCount;
    const observerCount = Number.isInteger(runtimeState.observerCount)
        ? runtimeState.observerCount
        : null;

    const managedGroups = safelyQueryAll(documentRef, 'optgroup[data-cmr-provider]');
    const duplicateDomGroups = findDuplicateModelGroups(managedGroups);
    const hasDuplicateResources = launcherCount > 1
        || panelCount > 1
        || (observerCount !== null && observerCount > 1)
        || duplicateListeners.length > 0
        || duplicateBindings.length > 0
        || duplicateDomGroups.length > 0;

    checks.push(hasDuplicateResources
        ? createCheck(
            'runtime-duplicate-resources',
            'lifecycle',
            'failed',
            '중복 런타임 자원을 발견했습니다. 확장을 비활성화한 뒤 다시 활성화해 주세요.',
            {
                launcherCount,
                panelCount,
                observerCount,
                duplicateListeners,
                duplicateBindings,
                duplicateModelGroups: duplicateDomGroups,
            },
        )
        : createCheck(
            'runtime-duplicate-resources',
            'lifecycle',
            'passed',
            '중복 런처·패널·옵저버·이벤트 구독을 찾지 못했습니다.',
            { launcherCount, panelCount, observerCount },
        ));

    const phase = runtimeState.phase ?? 'active';
    const resourceCounts = {
        launcherCount,
        panelCount,
        observerCount,
        listenerCount: Number.isInteger(runtimeState.listenerCount)
            ? runtimeState.listenerCount
            : subscriptions.length,
        boundControlCount: Number.isInteger(runtimeState.boundControlCount)
            ? runtimeState.boundControlCount
            : (Array.isArray(runtimeState.controlBindings) ? runtimeState.controlBindings.length : null),
        modelGroupCount: Number.isInteger(runtimeState.modelGroupCount)
            ? runtimeState.modelGroupCount
            : managedGroups.length,
        pendingTaskCount: Number.isInteger(runtimeState.pendingTaskCount)
            ? runtimeState.pendingTaskCount
            : null,
    };
    const liveAfterDestroy = phase === 'destroyed'
        && Object.values(resourceCounts).some(value => Number.isInteger(value) && value > 0);
    checks.push(liveAfterDestroy
        ? createCheck(
            'runtime-destroy-cleanup',
            'lifecycle',
            'failed',
            '비활성화 이후에도 런타임 자원이 남아 있습니다.',
            resourceCounts,
        )
        : createCheck(
            'runtime-destroy-cleanup',
            'lifecycle',
            'passed',
            phase === 'destroyed'
                ? '비활성화 이후 런타임 자원이 모두 정리되었습니다.'
                : '현재 활성 런타임에서 비활성화 잔여 자원은 검사 대상이 아닙니다.',
            resourceCounts,
        ));

    return checks;
}

/**
 * 인증 정보나 연결 설정을 읽지 않고 SillyTavern 공개 context와 모델 컨트롤 계약만 검사한다.
 */
export function diagnoseCompatibility(options = {}) {
    const sillyTavern = options.sillyTavern ?? globalThis.SillyTavern;
    const documentRef = options.documentRef ?? globalThis.document;
    const checks = [];

    const versionResult = diagnoseVersion(options.clientVersion, documentRef);
    checks.push(versionResult.check);

    const contextResult = resolveContext(sillyTavern, options.context);
    if (contextResult.error) {
        checks.push(createCheck(
            'context-access',
            'context',
            'failed',
            contextResult.error,
        ));
    } else {
        checks.push(createCheck(
            'context-access',
            'context',
            'passed',
            'SillyTavern context에 안전하게 접근했습니다.',
        ));
        checks.push(...diagnoseContext(contextResult.context));
        const providerResult = diagnoseProviderContracts(contextResult.context, documentRef);
        checks.push(...providerResult.checks);
    }

    const mutationObserverClass = options.MutationObserverClass ?? globalThis.MutationObserver;
    checks.push(typeof mutationObserverClass === 'function'
        ? createCheck(
            'mutation-observer-contract',
            'dom',
            'passed',
            '모델 목록 재생성을 감시할 MutationObserver를 찾았습니다.',
        )
        : createCheck(
            'mutation-observer-contract',
            'dom',
            'warning',
            'MutationObserver가 없어 동적 모델 목록 복구가 제한됩니다.',
        ));

    checks.push(...diagnoseRuntimeResources(options.runtimeState, documentRef));
    const result = summarizeDiagnosticChecks(checks);
    return {
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
        status: result.status,
        summary: result.summary,
        counts: result.counts,
        environment: {
            sillyTavernVersion: versionResult.version,
            minimumVersion: MINIMUM_SILLYTAVERN_VERSION,
            validatedVersions: [...VALIDATED_SILLYTAVERN_VERSIONS],
        },
        checks,
    };
}

function normalizeMetric(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
}

function normalizeMonitorSample(reason, metrics, sequence) {
    const result = {
        sequence,
        reason: String(reason ?? '동기화').slice(0, 64),
        phase: metrics?.phase === 'destroyed' ? 'destroyed' : 'active',
    };
    for (const metric of RESOURCE_METRICS) {
        result[metric] = normalizeMetric(metrics?.[metric]);
    }
    return result;
}

function analyzeMonitorSamples(samples) {
    const activeSamples = samples.filter(sample => sample.phase === 'active');
    if (activeSamples.length < 2) {
        return {
            status: 'pending',
            evaluated: false,
            summary: '반복 전환 표본이 부족해 장시간 안정성 검사를 아직 실행하지 않았습니다.',
            sampleCount: samples.length,
            activeSampleCount: activeSamples.length,
            drift: [],
            maxima: Object.fromEntries(RESOURCE_METRICS.map(metric => [metric, activeSamples[0]?.[metric] ?? 0])),
        };
    }

    const maxima = {};
    for (const metric of RESOURCE_METRICS) {
        maxima[metric] = Math.max(...activeSamples.map(sample => sample[metric]));
    }

    const drift = [];
    const recordLimitViolation = (metric, limit, policy) => {
        const values = activeSamples.map(sample => sample[metric]);
        const maximum = maxima[metric];
        if (maximum <= limit) {
            return;
        }

        let runningMaximum = values[0];
        let growthStepCount = 0;
        for (const value of values.slice(1)) {
            if (value > runningMaximum) {
                runningMaximum = value;
                growthStepCount += 1;
            }
        }
        drift.push({
            metric,
            first: values[0],
            last: values.at(-1),
            maximum,
            limit,
            policy,
            growthStepCount,
        });
    };

    for (const [metric, limit] of Object.entries(SINGLE_INSTANCE_RESOURCE_LIMITS)) {
        recordLimitViolation(metric, limit, 'single-instance');
    }
    for (const [metric, limit] of Object.entries(BOUNDED_RESOURCE_LIMITS)) {
        recordLimitViolation(metric, limit, 'bounded-collection');
    }

    const transient = {
        pendingTaskCount: {
            maximum: maxima.pendingTaskCount,
            last: activeSamples.at(-1).pendingTaskCount,
        },
    };
    const status = drift.length ? 'error' : 'ok';
    return {
        status,
        evaluated: true,
        summary: status === 'ok'
            ? `활성 상태 샘플 ${activeSamples.length}개에서 런타임 자원 제한 초과를 찾지 못했습니다.`
            : `활성 상태 샘플 ${activeSamples.length}개에서 런타임 자원 제한 초과 또는 중복을 찾았습니다.`,
        sampleCount: samples.length,
        activeSampleCount: activeSamples.length,
        drift,
        maxima,
        transient,
    };
}

function normalizeRuntimeCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * 외부 브리지의 공개 가능한 개수만으로 observer와 대상 분류 불변식을 검사한다.
 * 대상 label·DOM 식별자·현재 값은 결과에 포함하지 않는다.
 */
export function diagnoseExternalRuntimeResources(metrics = {}, targets = []) {
    const normalizedTargets = Array.isArray(targets) ? targets : [];
    const observerCount = normalizeRuntimeCount(metrics.observerCount);
    const targetCount = normalizeRuntimeCount(metrics.targetCount);
    const boundCount = normalizeRuntimeCount(metrics.boundCount);
    const directCount = normalizeRuntimeCount(metrics.directCount);
    const userExcludedCount = normalizeRuntimeCount(metrics.userExcludedCount);
    const connectedCount = normalizeRuntimeCount(metrics.connectedCount);
    const idleCount = normalizeRuntimeCount(metrics.idleCount);
    const failedCount = normalizeRuntimeCount(metrics.failedCount);
    const listenerCount = normalizeRuntimeCount(metrics.listenerCount);
    // 비정상 입력도 진단 JSON을 무한히 키우지 않도록 hard cap 초과는 한 칸의 sentinel로만 보존한다.
    const normalizeManagedOptionCount = value => Math.min(
        normalizeRuntimeCount(value),
        EXTERNAL_MANAGED_OPTION_COUNT_LIMIT + 1,
    );
    const activeRegistryModelCount = normalizeManagedOptionCount(metrics.activeRegistryModelCount);
    const eligibleManagedOptionCount = normalizeManagedOptionCount(metrics.eligibleManagedOptionCount);
    const expectedManagedOptionCount = normalizeManagedOptionCount(metrics.expectedManagedOptionCount);
    const actualManagedOptionCount = normalizeManagedOptionCount(metrics.actualManagedOptionCount);
    const capacityLimitedTargetCount = normalizeRuntimeCount(metrics.capacityLimitedTargetCount);
    const actualDirectCount = normalizedTargets.filter(target => (
        target?.resolution?.source === 'direct'
    )).length;
    const riskBlockedTargets = normalizedTargets.filter(target => (
        target?.resolution?.source === 'risk-blocked'
    ));
    const userExcludedTargets = normalizedTargets.filter(target => (
        target?.resolution?.source === 'user-excluded'
    ));
    const actualConnectedCount = normalizedTargets.filter(target => (
        target?.resolution?.source === 'direct' && target?.bridge?.status === 'connected'
    )).length;
    const actualIdleCount = normalizedTargets.filter(target => (
        target?.resolution?.source === 'direct' && target?.bridge?.status === 'idle'
    )).length;
    const actualFailedCount = normalizedTargets.filter(target => (
        target?.resolution?.source === 'direct' && target?.bridge?.status === 'failed'
    )).length;
    const excludedCount = riskBlockedTargets.length;
    const expectedListenerCount = normalizedTargets.reduce((count, target) => (
        count
        + (target?.resolution?.source === 'direct' ? 1 : 0)
        + (target?.providerControl && target.providerControl !== target.control ? 2 : 0)
    ), 0);
    const excludedReasonCounts = new Map();
    for (const target of riskBlockedTargets) {
        const reason = String(target?.resolution?.excludedReason ?? 'unspecified').slice(0, 64);
        excludedReasonCounts.set(reason, (excludedReasonCounts.get(reason) ?? 0) + 1);
    }
    const excludedByReason = Object.fromEntries(excludedReasonCounts);
    const sumTargetBridgeCount = key => Math.min(
        normalizedTargets.reduce((total, target) => (
            target?.resolution?.source === 'direct'
                ? total + normalizeRuntimeCount(target?.bridge?.[key])
                : total
        ), 0),
        EXTERNAL_MANAGED_OPTION_COUNT_LIMIT + 1,
    );
    const derivedEligibleManagedOptionCount = sumTargetBridgeCount('eligibleModelCount');
    const derivedExpectedManagedOptionCount = sumTargetBridgeCount('expectedManagedOptionCount');
    const derivedCapacityLimitedTargetCount = normalizedTargets.filter(target => (
        target?.resolution?.source === 'direct' && target?.bridge?.capacityLimited === true
    )).length;
    const managedOptionBudgetExceeded = Math.max(
        expectedManagedOptionCount,
        actualManagedOptionCount,
    ) > EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD;
    const managedOptionCapacityLimited = capacityLimitedTargetCount > 0;

    const invariants = {
        singleObserver: observerCount === 1,
        reportedTargetsMatch: targetCount === normalizedTargets.length,
        reportedDirectMatch: directCount === actualDirectCount,
        reportedUserExcludedMatch: userExcludedCount === userExcludedTargets.length,
        reportedBridgeStatesMatch: connectedCount === actualConnectedCount
            && idleCount === actualIdleCount
            && failedCount === actualFailedCount,
        candidatePartitionMatches: targetCount === directCount + userExcludedCount + excludedCount,
        bridgePartitionMatches: directCount === connectedCount + idleCount + failedCount,
        noBridgeFailures: failedCount === 0,
        directBindingsMatch: boundCount === connectedCount + idleCount,
        listenerBindingsMatch: listenerCount === expectedListenerCount,
        managedOptionEligibilityMatches: eligibleManagedOptionCount === derivedEligibleManagedOptionCount,
        managedOptionEstimateMatches: expectedManagedOptionCount === derivedExpectedManagedOptionCount,
        capacityLimitedTargetsMatch: capacityLimitedTargetCount === derivedCapacityLimitedTargetCount,
        managedOptionCountsCoherent: expectedManagedOptionCount <= eligibleManagedOptionCount
            && capacityLimitedTargetCount <= directCount,
        managedOptionsWithinEstimate: actualManagedOptionCount <= expectedManagedOptionCount,
        managedOptionCountsWithinHardCap: expectedManagedOptionCount <= EXTERNAL_MANAGED_OPTION_COUNT_LIMIT
            && actualManagedOptionCount <= EXTERNAL_MANAGED_OPTION_COUNT_LIMIT,
    };
    const valid = Object.values(invariants).every(Boolean);
    const inventory = `후보 ${targetCount}개 = 연결 정책 ${directCount}개 + 사용자 제외 ${userExcludedCount}개 + 비채팅·비호환 제외 ${excludedCount}개`;
    const hasManagedOptionWarning = managedOptionBudgetExceeded || managedOptionCapacityLimited;
    const status = valid ? (hasManagedOptionWarning ? 'warning' : 'passed') : 'failed';
    const managedOptionWarnings = [
        managedOptionCapacityLimited
            ? `외부 모델 칸 ${capacityLimitedTargetCount}곳은 표시 가능한 CMR 선택지가 대상당 ${EXTERNAL_INJECTED_OPTION_LIMIT}개를 넘어 일부만 표시됩니다.`
            : null,
        managedOptionBudgetExceeded
            ? `외부 모델 선택지 DOM 옵션이 권장 한도 ${EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD}개를 초과했습니다. 최대 예상 ${expectedManagedOptionCount}개 · 실제 ${actualManagedOptionCount}개.`
            : null,
    ].filter(Boolean).join(' ');

    return createCheck(
        'external-model-controls',
        'external',
        status,
        !valid
            ? `외부 모델 칸 런타임 집계가 일치하지 않습니다. ${inventory}`
            : (hasManagedOptionWarning
                ? `${managedOptionWarnings} ${inventory}`
                : `외부 모델 칸 ${inventory}`),
        {
            observerCount,
            targetCount,
            boundCount,
            directCount,
            connectedCount,
            idleCount,
            failedCount,
            userExcludedCount,
            listenerCount,
            expectedListenerCount,
            activeRegistryModelCount,
            eligibleManagedOptionCount,
            expectedManagedOptionCount,
            actualManagedOptionCount,
            capacityLimitedTargetCount,
            managedOptionPerTargetLimit: EXTERNAL_INJECTED_OPTION_LIMIT,
            managedOptionWarningThreshold: EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD,
            managedOptionBudgetExceeded,
            managedOptionCapacityLimited,
            excludedCount,
            excludedByReason,
            invariants,
        },
    );
}

/**
 * 프로필 전환·모델 목록 재생성을 반복하며 자원 수가 누적되는지 확인하는 수동 계측기다.
 * 시간·타이머·네트워크를 사용하지 않아 단위 테스트와 브라우저 진단에서 동일하게 쓸 수 있다.
 */
export function createStabilityMonitor(options = {}) {
    const requestedLimit = Number(options.sampleLimit);
    const sampleLimit = Number.isInteger(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 2), 10_000)
        : 256;
    const samples = [];
    let sequence = 0;

    return Object.freeze({
        record(reason, metrics = {}) {
            sequence += 1;
            samples.push(normalizeMonitorSample(reason, metrics, sequence));
            if (samples.length > sampleLimit) {
                samples.splice(0, samples.length - sampleLimit);
            }
            return samples.at(-1);
        },
        analyze() {
            return analyzeMonitorSamples(samples);
        },
        getSamples() {
            return samples.map(sample => ({ ...sample }));
        },
        clear() {
            samples.length = 0;
            sequence = 0;
        },
        get size() {
            return samples.length;
        },
        get sampleLimit() {
            return sampleLimit;
        },
    });
}

export function getMostSevereCheck(checks) {
    return [...(Array.isArray(checks) ? checks : [])]
        .sort((left, right) => STATUS_RANK[right.status] - STATUS_RANK[left.status])[0]
        ?? null;
}
