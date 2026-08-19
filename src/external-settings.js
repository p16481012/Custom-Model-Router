import {
    isSupportedProvider,
    normalizeProviderId,
    validateProviderModelId,
} from './providers.js';

export const EXTERNAL_SETTINGS_SCHEMA_VERSION = 1;
export const EXTERNAL_SETTINGS_MAX_TARGETS = 512;
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

function normalizeMappingProvider(value) {
    const providerId = normalizeProviderId(value);
    return providerId === EXTERNAL_MAPPING_DISABLED || isSupportedProvider(providerId)
        ? providerId
        : null;
}

function validateMappingProvider(value) {
    const providerId = normalizeMappingProvider(value);
    if (!providerId) {
        throw new ExternalSettingsError(
            'mapping_provider_invalid',
            '외부 모델 컨트롤에는 지원 제공업체 또는 disabled만 연결할 수 있습니다.',
        );
    }
    return providerId;
}

function createSettings(mappings, selectedModels) {
    return {
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings,
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

    const mappings = {};
    const selectedModels = {};
    const acceptedTargets = new Set();

    for (const [candidateTargetId, candidateProvider] of safeEntries(safeRead(source, 'mappings'))) {
        const targetId = normalizeTargetId(candidateTargetId);
        const providerId = normalizeMappingProvider(candidateProvider);
        if (!EXTERNAL_TARGET_ID_PATTERN.test(targetId) || POLLUTION_KEYS.has(targetId) || !providerId) {
            continue;
        }
        if (!acceptedTargets.has(targetId) && acceptedTargets.size >= EXTERNAL_SETTINGS_MAX_TARGETS) {
            continue;
        }
        acceptedTargets.add(targetId);
        mappings[targetId] = providerId;
    }

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

    return createSettings(mappings, selectedModels);
}

/**
 * v0.6.3 이후 자동 연결 모드용 설정을 정규화한다.
 *
 * 예전 수동 mapping이 512개 한도를 먼저 차지해 보존해야 할 selectedModels가
 * 잘리는 일을 막기 위해 mapping을 읽기 전에 제외한다.
 */
export function normalizeAutomaticExternalSettings(value) {
    const source = isRecord(value) ? value : {};
    checkFutureSchema(source);
    return normalizeExternalSettings({
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings: {},
        selectedModels: safeRead(source, 'selectedModels'),
    });
}

function assertTargetCapacity(settings, targetId) {
    const targetIds = new Set([
        ...Object.keys(settings.mappings),
        ...Object.keys(settings.selectedModels),
    ]);
    if (!targetIds.has(targetId) && targetIds.size >= EXTERNAL_SETTINGS_MAX_TARGETS) {
        throw new ExternalSettingsError(
            'target_limit',
            `외부 모델 컨트롤 설정은 최대 ${EXTERNAL_SETTINGS_MAX_TARGETS}개까지 저장할 수 있습니다.`,
        );
    }
}

export function getExternalMapping(value, targetId) {
    const normalizedTargetId = normalizeTargetId(targetId);
    if (!EXTERNAL_TARGET_ID_PATTERN.test(normalizedTargetId) || POLLUTION_KEYS.has(normalizedTargetId)) {
        return null;
    }
    return normalizeExternalSettings(value).mappings[normalizedTargetId] ?? null;
}

export function setExternalMapping(value, targetId, providerId) {
    const normalized = normalizeExternalSettings(value);
    const normalizedTargetId = validateTargetId(targetId);
    const normalizedProviderId = validateMappingProvider(providerId);
    assertTargetCapacity(normalized, normalizedTargetId);
    return createSettings(
        {
            ...normalized.mappings,
            [normalizedTargetId]: normalizedProviderId,
        },
        { ...normalized.selectedModels },
    );
}

export function removeExternalMapping(value, targetId) {
    const normalized = normalizeExternalSettings(value);
    const normalizedTargetId = normalizeTargetId(targetId);
    if (!EXTERNAL_TARGET_ID_PATTERN.test(normalizedTargetId)
        || !Object.hasOwn(normalized.mappings, normalizedTargetId)) {
        return normalized;
    }
    const mappings = { ...normalized.mappings };
    delete mappings[normalizedTargetId];
    return createSettings(mappings, { ...normalized.selectedModels });
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
        return createSettings({ ...normalized.mappings }, selectedModels);
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
    return createSettings({ ...normalized.mappings }, selectedModels);
}

export function removeExternalSelectedModel(value, targetId, providerId) {
    return setExternalSelectedModel(value, targetId, providerId, null);
}
