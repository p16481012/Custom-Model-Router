export const SETTINGS_SCHEMA_VERSION = 1;
export const VERTEX_PROVIDER = 'vertexai';
export const VERTEX_GEMINI_PROTOCOL = 'vertex-gemini';
export const MODEL_ID_MAX_LENGTH = 128;

const MODEL_ID_PATTERN = /^gemini-[a-z0-9][a-z0-9._-]*$/;

export class ModelRegistryError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ModelRegistryError';
        this.code = code;
    }
}

export function normalizeModelId(value) {
    return String(value ?? '').trim();
}

export function validateModelId(value) {
    const id = normalizeModelId(value);

    if (!id) {
        return {
            ok: false,
            code: 'empty',
            message: '모델 ID를 입력해 주세요.',
        };
    }

    if (id.length > MODEL_ID_MAX_LENGTH) {
        return {
            ok: false,
            code: 'too_long',
            message: `모델 ID는 ${MODEL_ID_MAX_LENGTH}자 이하여야 합니다.`,
        };
    }

    if (!id.startsWith('gemini-')) {
        return {
            ok: false,
            code: 'unsupported_family',
            message: 'v0.1에서는 gemini-로 시작하는 Vertex Gemini 모델만 지원합니다.',
        };
    }

    if (!MODEL_ID_PATTERN.test(id)) {
        return {
            ok: false,
            code: 'invalid_characters',
            message: '모델 ID에는 영문 소문자, 숫자, 마침표, 밑줄, 하이픈만 사용할 수 있습니다.',
        };
    }

    return { ok: true, id };
}

export function createModelRecord(id) {
    return {
        id,
        provider: VERTEX_PROVIDER,
        protocol: VERTEX_GEMINI_PROTOCOL,
        enabled: true,
    };
}

export function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const seen = new Set();
    const models = [];

    for (const candidate of Array.isArray(source.models) ? source.models : []) {
        const validation = validateModelId(candidate?.id);
        if (!validation.ok || seen.has(validation.id)) {
            continue;
        }

        seen.add(validation.id);
        models.push(createModelRecord(validation.id));
    }

    const selectedCandidate = normalizeModelId(source.selectedModelId);
    const selectedModelId = models.some(model => model.enabled && model.id === selectedCandidate)
        ? selectedCandidate
        : null;

    return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        models,
        selectedModelId,
    };
}

export function addModel(settings, value) {
    const normalized = normalizeSettings(settings);
    const validation = validateModelId(value);

    if (!validation.ok) {
        throw new ModelRegistryError(validation.code, validation.message);
    }

    if (normalized.models.some(model => model.id === validation.id)) {
        throw new ModelRegistryError('duplicate', '이미 등록된 모델 ID입니다.');
    }

    return {
        ...normalized,
        models: [...normalized.models, createModelRecord(validation.id)],
    };
}

export function removeModel(settings, modelId) {
    const normalized = normalizeSettings(settings);
    const id = normalizeModelId(modelId);

    return {
        ...normalized,
        models: normalized.models.filter(model => model.id !== id),
        selectedModelId: normalized.selectedModelId === id ? null : normalized.selectedModelId,
    };
}

export function setSelectedModel(settings, modelId) {
    const normalized = normalizeSettings(settings);

    if (modelId === null || modelId === undefined || modelId === '') {
        return { ...normalized, selectedModelId: null };
    }

    const id = normalizeModelId(modelId);
    if (!normalized.models.some(model => model.enabled && model.id === id)) {
        throw new ModelRegistryError('not_registered', '등록된 활성 모델만 선택 상태로 저장할 수 있습니다.');
    }

    return { ...normalized, selectedModelId: id };
}

export function hasEnabledModel(settings, modelId) {
    const id = normalizeModelId(modelId);
    return normalizeSettings(settings).models.some(model => model.enabled && model.id === id);
}

export function getEnabledModels(settings) {
    return normalizeSettings(settings).models.filter(model => model.enabled);
}
