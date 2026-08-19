import {
    isSupportedProvider,
    normalizeProviderId,
    validateProviderModelId,
} from './providers.js';

export const EXTERNAL_SETTINGS_SCHEMA_VERSION = 1;
export const EXTERNAL_SETTINGS_MAX_TARGETS = 512;
// v0.6.5 이하 모듈 import 호환용 상수다. v0.6.6에서는 mapping을 저장하지 않는다.
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

function createSettings(selectedModels) {
    return {
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings: {},
        selectedModels,
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
 * 손상되거나 알 수 없는 필드는 버리고 외부 컨트롤 연결 설정을 schema v1으로 복구한다.
 * 알 수 없는 미래 schema만은 조용히 낮추지 않고 명시적으로 거부한다.
 */
export function normalizeExternalSettings(value) {
    const source = isRecord(value) ? value : {};
    checkFutureSchema(source);

    const selectedModels = {};
    const acceptedTargets = new Set();

    // provider별 선택 기록은 재렌더 복구에 필요하므로 mapping보다 먼저 한도에 반영한다.
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

    // v0.6.0~v0.6.5의 자동/직접/연결 안 함 및 제공업체 고정 mapping은 읽되
    // v0.6.6의 단일 직접 연결 동작에는 필요하지 않으므로 저장값에서 제거한다.
    return createSettings(selectedModels);
}

/**
 * v0.6.3~v0.6.5 호출부와의 호환 별칭이다. 모든 legacy mapping을 제거하고
 * 대상별 마지막 모델 선택만 보존한다.
 */
export function normalizeAutomaticExternalSettings(value) {
    const normalized = normalizeExternalSettings(value);
    return createSettings({ ...normalized.selectedModels });
}

function assertTargetCapacity(settings, targetId) {
    const targetIds = new Set(Object.keys(settings.selectedModels));
    if (!targetIds.has(targetId) && targetIds.size >= EXTERNAL_SETTINGS_MAX_TARGETS) {
        throw new ExternalSettingsError(
            'target_limit',
            `외부 모델 컨트롤 설정은 최대 ${EXTERNAL_SETTINGS_MAX_TARGETS}개까지 저장할 수 있습니다.`,
        );
    }
}

/** @deprecated v0.6.6부터 모든 안전 대상은 직접 연결되므로 항상 null을 반환한다. */
export function getExternalMapping(value, targetId) {
    normalizeExternalSettings(value);
    void targetId;
    return null;
}

/** @deprecated legacy 호출을 검증한 뒤 mapping 없이 정규화한다. */
export function setExternalMapping(value, targetId, mode) {
    const normalized = normalizeExternalSettings(value);
    validateTargetId(targetId);
    const normalizedMode = normalizeProviderId(mode);
    if (normalizedMode !== EXTERNAL_MAPPING_MANUAL
        && normalizedMode !== EXTERNAL_MAPPING_DISABLED
        && !isSupportedProvider(normalizedMode)) {
        throw new ExternalSettingsError(
            'mapping_provider_invalid',
            '더 이상 지원하지 않는 외부 연결 방식입니다.',
        );
    }
    return normalized;
}

/** @deprecated mapping은 정규화 단계에서 이미 제거된다. */
export function removeExternalMapping(value, targetId) {
    void targetId;
    return normalizeExternalSettings(value);
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
        return createSettings(selectedModels);
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
    return createSettings(selectedModels);
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
    return createSettings(selectedModels);
}
