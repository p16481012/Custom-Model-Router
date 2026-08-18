import {
    MODEL_ID_MAX_LENGTH,
    PROVIDER_IDS,
    getProvider,
    isSupportedProvider,
    normalizeProviderId,
    normalizeProviderModelId,
    validateProviderModelId,
} from './providers.js';

export const SETTINGS_SCHEMA_VERSION = 2;
export const VERTEX_PROVIDER = PROVIDER_IDS.VERTEXAI;
export const VERTEX_GEMINI_PROTOCOL = 'vertex-gemini';
export { MODEL_ID_MAX_LENGTH };

export class ModelRegistryError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ModelRegistryError';
        this.code = code;
    }
}

export function normalizeModelId(value) {
    return normalizeProviderModelId(value);
}

/**
 * v0.1 호환을 위해 provider를 생략하면 Vertex AI 규칙으로 검사한다.
 * 신규 호출은 `validateModelId(value, providerId)`를 사용한다.
 */
export function validateModelId(value, providerId = VERTEX_PROVIDER) {
    return validateProviderModelId(providerId, value);
}

export function createModelKey(providerId, modelId) {
    return JSON.stringify([
        normalizeProviderId(providerId),
        normalizeModelId(modelId),
    ]);
}

function resolveProviderAndValue(providerOrValue, maybeValue) {
    if (maybeValue === undefined) {
        return { providerId: VERTEX_PROVIDER, value: providerOrValue };
    }

    return {
        providerId: normalizeProviderId(providerOrValue),
        value: maybeValue,
    };
}

/**
 * v0.1의 `createModelRecord(id)`와 v0.2의
 * `createModelRecord(providerId, id, enabled?)`를 모두 허용한다.
 */
export function createModelRecord(providerOrId, maybeId, enabled = true) {
    const { providerId, value } = resolveProviderAndValue(providerOrId, maybeId);
    const provider = getProvider(providerId);
    if (!provider) {
        throw new ModelRegistryError('unsupported_provider', '지원하지 않는 제공업체입니다.');
    }

    return {
        id: normalizeModelId(value),
        provider: provider.id,
        protocol: provider.protocol,
        enabled: enabled !== false,
    };
}

function finalizeSettings(models, selectedModels) {
    const normalizedSelections = { ...selectedModels };
    const result = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        models,
        selectedModels: normalizedSelections,
    };

    // 전환 중인 v0.1 런타임이 Vertex 선택 상태를 읽을 수 있게 하되,
    // 저장 JSON에는 더 이상 단일 제공업체 필드를 남기지 않는다.
    Object.defineProperty(result, 'selectedModelId', {
        configurable: true,
        enumerable: false,
        get: () => normalizedSelections[VERTEX_PROVIDER] ?? null,
    });

    return result;
}

function normalizeModels(source, legacySchema) {
    const models = [];
    const modelIndexes = new Map();

    for (const candidate of Array.isArray(source.models) ? source.models : []) {
        const providerId = legacySchema
            ? VERTEX_PROVIDER
            : normalizeProviderId(candidate?.provider);
        if (!isSupportedProvider(providerId)) {
            continue;
        }

        const validation = validateProviderModelId(providerId, candidate?.id);
        if (!validation.ok) {
            continue;
        }

        const key = createModelKey(providerId, validation.id);
        const enabled = legacySchema ? true : candidate?.enabled !== false;
        const existingIndex = modelIndexes.get(key);
        if (existingIndex !== undefined) {
            // 손상된 중복 레코드 중 하나라도 활성 상태면 활성으로 복구한다.
            if (enabled && !models[existingIndex].enabled) {
                models[existingIndex] = createModelRecord(providerId, validation.id, true);
            }
            continue;
        }

        modelIndexes.set(key, models.length);
        models.push(createModelRecord(providerId, validation.id, enabled));
    }

    return models;
}

function normalizeSelections(source, models, legacySchema) {
    const candidates = source.selectedModels && typeof source.selectedModels === 'object'
        ? { ...source.selectedModels }
        : {};
    const selectedModels = {};

    if (legacySchema || candidates[VERTEX_PROVIDER] === undefined) {
        candidates[VERTEX_PROVIDER] ??= source.selectedModelId;
    }

    for (const [candidateProvider, candidateId] of Object.entries(candidates)) {
        const providerId = normalizeProviderId(candidateProvider);
        if (!isSupportedProvider(providerId)) {
            continue;
        }

        const id = normalizeModelId(candidateId);
        const isSelectable = models.some(model => (
            model.enabled
            && model.provider === providerId
            && model.id === id
        ));
        if (isSelectable) {
            selectedModels[providerId] = id;
        }
    }

    return selectedModels;
}

export function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const legacySchema = source.schemaVersion === 1
        || (
            source.schemaVersion === undefined
            && Object.hasOwn(source, 'selectedModelId')
            && !Object.hasOwn(source, 'selectedModels')
        );
    const models = normalizeModels(source, legacySchema);
    const selectedModels = normalizeSelections(source, models, legacySchema);

    return finalizeSettings(models, selectedModels);
}

/**
 * `addModel(settings, id)`는 Vertex(v0.1),
 * `addModel(settings, providerId, id)`는 다중 제공업체(v0.2) 호출이다.
 */
export function addModel(settings, providerOrValue, maybeValue) {
    const normalized = normalizeSettings(settings);
    const { providerId, value } = resolveProviderAndValue(providerOrValue, maybeValue);
    const validation = validateProviderModelId(providerId, value);

    if (!validation.ok) {
        throw new ModelRegistryError(validation.code, validation.message);
    }

    if (normalized.models.some(model => (
        model.provider === providerId
        && model.id === validation.id
    ))) {
        throw new ModelRegistryError('duplicate', '이 제공업체에 이미 등록된 모델 ID입니다.');
    }

    return finalizeSettings(
        [...normalized.models, createModelRecord(providerId, validation.id)],
        normalized.selectedModels,
    );
}

export function removeModel(settings, providerOrModelId, maybeModelId) {
    const normalized = normalizeSettings(settings);
    const { providerId, value } = resolveProviderAndValue(providerOrModelId, maybeModelId);
    const id = normalizeModelId(value);
    const selectedModels = { ...normalized.selectedModels };

    if (selectedModels[providerId] === id) {
        delete selectedModels[providerId];
    }

    return finalizeSettings(
        normalized.models.filter(model => !(
            model.provider === providerId
            && model.id === id
        )),
        selectedModels,
    );
}

export function setSelectedModel(settings, providerOrModelId, maybeModelId) {
    const normalized = normalizeSettings(settings);
    const { providerId, value } = resolveProviderAndValue(providerOrModelId, maybeModelId);
    const selectedModels = { ...normalized.selectedModels };

    if (value === null || value === undefined || value === '') {
        delete selectedModels[providerId];
        return finalizeSettings(normalized.models, selectedModels);
    }

    const id = normalizeModelId(value);
    if (!normalized.models.some(model => (
        model.enabled
        && model.provider === providerId
        && model.id === id
    ))) {
        throw new ModelRegistryError('not_registered', '해당 제공업체에 등록된 활성 모델만 선택 상태로 저장할 수 있습니다.');
    }

    selectedModels[providerId] = id;
    return finalizeSettings(normalized.models, selectedModels);
}

export function getSelectedModel(settings, providerId = VERTEX_PROVIDER) {
    const normalizedProviderId = normalizeProviderId(providerId);
    return normalizeSettings(settings).selectedModels[normalizedProviderId] ?? null;
}

export function hasEnabledModel(settings, providerOrModelId, maybeModelId) {
    const { providerId, value } = resolveProviderAndValue(providerOrModelId, maybeModelId);
    const id = normalizeModelId(value);
    return normalizeSettings(settings).models.some(model => (
        model.enabled
        && model.provider === providerId
        && model.id === id
    ));
}

export function getEnabledModels(settings, providerId) {
    const normalizedProviderId = providerId === undefined
        ? null
        : normalizeProviderId(providerId);
    return normalizeSettings(settings).models.filter(model => (
        model.enabled
        && (normalizedProviderId === null || model.provider === normalizedProviderId)
    ));
}
