import {
    isSupportedProvider,
    normalizeProviderId,
    validateProviderModelId,
} from './providers.js';

export const EXTERNAL_SETTINGS_SCHEMA_VERSION = 2;
export const EXTERNAL_SETTINGS_MAX_TARGETS = 512;
// v0.6.5 이하 모듈 import 호환용 상수다. legacy mapping은 모두 폐기한다.
export const EXTERNAL_MAPPING_MANUAL = 'manual';
export const EXTERNAL_MAPPING_DISABLED = 'disabled';

const EXTERNAL_TARGET_ID_PATTERN = /^cmr-ext-[a-f0-9]{8}$/;
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class ExternalSettingsError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ExternalSettingsError';
        this.code = code;
    }
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeRead(value, key) {
    try {
        return value?.[key];
    } catch {
        return undefined;
    }
}

function safeEntries(value) {
    if (!isRecord(value)) {
        return [];
    }

    try {
        return Object.entries(value);
    } catch {
        return [];
    }
}

function normalizeTargetId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function validateTargetId(value) {
    const targetId = normalizeTargetId(value);
    if (!EXTERNAL_TARGET_ID_PATTERN.test(targetId) || POLLUTION_KEYS.has(targetId)) {
        throw new ExternalSettingsError(
            'target_id_invalid',
            '외부 모델 컨트롤 대상 ID 형식이 올바르지 않습니다.',
        );
    }
    return targetId;
}

function createSettings(selectedModels, excludedTargets = {}) {
    return {
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings: {},
        selectedModels,
        excludedTargets,
    };
}

function checkFutureSchema(source) {
    const schemaVersion = safeRead(source, 'schemaVersion');
    if (Number.isInteger(schemaVersion) && schemaVersion > EXTERNAL_SETTINGS_SCHEMA_VERSION) {
        throw new ExternalSettingsError(
            'future_schema',
            `외부 확장 연결 설정 schema v${schemaVersion}은 현재 버전에서 읽을 수 없습니다.`,
        );
    }
}

/**
 * 손상되거나 알 수 없는 필드는 버리고 외부 컨트롤 연결 설정을 schema v2로 복구한다.
 * 알 수 없는 미래 schema만은 조용히 낮추지 않고 명시적으로 거부한다.
 */
export function normalizeExternalSettings(value) {
    const source = isRecord(value) ? value : {};
    checkFutureSchema(source);

    const selectedModels = {};
    const excludedTargets = {};
    const acceptedTargets = new Set();

    // 사용자가 문제 대상을 명시적으로 제외한 선택은 자동 복구 선호보다
    // 안전에 영향을 주므로 512개 합산 한도에서 먼저 보존한다.
    const excludedEntries = safeRead(source, 'schemaVersion') === EXTERNAL_SETTINGS_SCHEMA_VERSION
        ? safeEntries(safeRead(source, 'excludedTargets'))
        : [];
    for (const [candidateTargetId, candidateExcluded] of excludedEntries) {
        const targetId = normalizeTargetId(candidateTargetId);
        if (candidateExcluded !== true
            || !EXTERNAL_TARGET_ID_PATTERN.test(targetId)
            || POLLUTION_KEYS.has(targetId)) {
            continue;
        }
        if (!acceptedTargets.has(targetId) && acceptedTargets.size >= EXTERNAL_SETTINGS_MAX_TARGETS) {
            continue;
        }
        acceptedTargets.add(targetId);
        excludedTargets[targetId] = true;
    }

    // provider별 선택 기록은 재렌더 복구에 필요하므로 한도에 함께 반영한다.
    for (const [candidateTargetId, candidateSelections] of safeEntries(safeRead(source, 'selectedModels'))) {
        const targetId = normalizeTargetId(candidateTargetId);
        if (!EXTERNAL_TARGET_ID_PATTERN.test(targetId) || POLLUTION_KEYS.has(targetId)) {
            continue;
        }
        if (!acceptedTargets.has(targetId) && acceptedTargets.size >= EXTERNAL_SETTINGS_MAX_TARGETS) {
            continue;
        }

        const selections = {};
        for (const [candidateProvider, candidateModelId] of safeEntries(candidateSelections)) {
            const providerId = normalizeProviderId(candidateProvider);
            if (POLLUTION_KEYS.has(providerId) || !isSupportedProvider(providerId)) {
                continue;
            }
            const validation = validateProviderModelId(providerId, candidateModelId);
            if (validation.ok) {
                selections[providerId] = validation.id;
            }
        }
        if (Object.keys(selections).length) {
            acceptedTargets.add(targetId);
            selectedModels[targetId] = selections;
        }
    }

    return createSettings(selectedModels, excludedTargets);
}

/**
 * v0.6.3~v0.6.5 호출부와의 호환 별칭이다. 모든 legacy mapping을 제거하고
 * 대상별 마지막 모델 선택만 보존한다.
 */
export function normalizeAutomaticExternalSettings(value) {
    const normalized = normalizeExternalSettings(value);
    return createSettings(
        { ...normalized.selectedModels },
        { ...normalized.excludedTargets },
    );
}

function assertTargetCapacity(settings, targetId) {
    const targetIds = new Set([
        ...Object.keys(settings.selectedModels),
        ...Object.keys(settings.excludedTargets),
    ]);
    if (!targetIds.has(targetId) && targetIds.size >= EXTERNAL_SETTINGS_MAX_TARGETS) {
        throw new ExternalSettingsError(
            'target_limit',
            `외부 모델 컨트롤 설정은 최대 ${EXTERNAL_SETTINGS_MAX_TARGETS}개까지 저장할 수 있습니다.`,
        );
    }
}

/** @deprecated legacy mapping은 모두 제거되어 항상 null을 반환한다. */
export function getExternalMapping(value, targetId) {
    normalizeExternalSettings(value);
    void targetId;
    return null;
}

/** @deprecated legacy 호출을 검증하되 새 excludedTargets로 되살리지 않는다. */
export function setExternalMapping(value, targetId, mode) {
    const normalized = normalizeExternalSettings(value);
    const normalizedTargetId = validateTargetId(targetId);
    const normalizedMode = normalizeProviderId(mode);
    if (normalizedMode !== EXTERNAL_MAPPING_MANUAL
        && normalizedMode !== EXTERNAL_MAPPING_DISABLED
        && !isSupportedProvider(normalizedMode)) {
        throw new ExternalSettingsError(
            'mapping_provider_invalid',
            '더 이상 지원하지 않는 외부 연결 방식입니다.',
        );
    }
    void normalizedTargetId;
    return normalized;
}

/** @deprecated legacy mapping은 정규화 단계에서 이미 제거된다. */
export function removeExternalMapping(value, targetId) {
    void targetId;
    return normalizeExternalSettings(value);
}

export function getExternalExcludedTargetIds(value) {
    return Object.keys(normalizeExternalSettings(value).excludedTargets);
}

export function isExternalTargetExcluded(value, targetId) {
    const normalizedTargetId = normalizeTargetId(targetId);
    if (!EXTERNAL_TARGET_ID_PATTERN.test(normalizedTargetId)
        || POLLUTION_KEYS.has(normalizedTargetId)) {
        return false;
    }
    return normalizeExternalSettings(value).excludedTargets[normalizedTargetId] === true;
}

export function setExternalTargetExcluded(value, targetId, excluded = true) {
    const normalized = normalizeExternalSettings(value);
    const normalizedTargetId = validateTargetId(targetId);
    const excludedTargets = { ...normalized.excludedTargets };
    if (excluded === true) {
        assertTargetCapacity(normalized, normalizedTargetId);
        excludedTargets[normalizedTargetId] = true;
    } else {
        delete excludedTargets[normalizedTargetId];
    }
    return createSettings({ ...normalized.selectedModels }, excludedTargets);
}

export function getExternalSelectedModel(value, targetId, providerId) {
    const normalizedTargetId = normalizeTargetId(targetId);
    const normalizedProviderId = normalizeProviderId(providerId);
    if (!EXTERNAL_TARGET_ID_PATTERN.test(normalizedTargetId)
        || POLLUTION_KEYS.has(normalizedTargetId)
        || !isSupportedProvider(normalizedProviderId)) {
        return null;
    }
    return normalizeExternalSettings(value).selectedModels[normalizedTargetId]?.[normalizedProviderId] ?? null;
}

export function setExternalSelectedModel(value, targetId, providerId, modelId) {
    const normalized = normalizeExternalSettings(value);
    const normalizedTargetId = validateTargetId(targetId);
    const normalizedProviderId = normalizeProviderId(providerId);
    if (!isSupportedProvider(normalizedProviderId)) {
        throw new ExternalSettingsError('unsupported_provider', '지원하지 않는 제공업체입니다.');
    }

    const selectedModels = { ...normalized.selectedModels };
    const selections = { ...(selectedModels[normalizedTargetId] ?? {}) };
    if (modelId === null || modelId === undefined || modelId === '') {
        delete selections[normalizedProviderId];
        if (Object.keys(selections).length) {
            selectedModels[normalizedTargetId] = selections;
        } else {
            delete selectedModels[normalizedTargetId];
        }
        return createSettings(selectedModels, { ...normalized.excludedTargets });
    }

    const validation = validateProviderModelId(normalizedProviderId, modelId);
    if (!validation.ok) {
        throw new ExternalSettingsError(validation.code, validation.message);
    }
    assertTargetCapacity(normalized, normalizedTargetId);
    selectedModels[normalizedTargetId] = {
        ...selections,
        [normalizedProviderId]: validation.id,
    };
    return createSettings(selectedModels, { ...normalized.excludedTargets });
}

export function removeExternalSelectedModel(value, targetId, providerId) {
    return setExternalSelectedModel(value, targetId, providerId, null);
}

export function removeExternalTargetSelections(value, targetId) {
    const normalized = normalizeExternalSettings(value);
    const normalizedTargetId = normalizeTargetId(targetId);
    if (!EXTERNAL_TARGET_ID_PATTERN.test(normalizedTargetId)
        || !Object.hasOwn(normalized.selectedModels, normalizedTargetId)) {
        return normalized;
    }
    const selectedModels = { ...normalized.selectedModels };
    delete selectedModels[normalizedTargetId];
    return createSettings(selectedModels, { ...normalized.excludedTargets });
}
