import {
    ModelRegistryError,
    addModel,
    normalizeModelId,
    normalizeSettings,
    setSelectedModel,
} from './registry.js';
import {
    getProvider,
    normalizeProviderId,
    validateProviderModelId,
} from './providers.js';

export const MODEL_SEARCH_VISIBILITY_THRESHOLD = 12;
export const BULK_MODEL_INPUT_MAX_LENGTH = 65_536;
export const BULK_MODEL_LINE_LIMIT = 200;

export class ModelManagementError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ModelManagementError';
        this.code = code;
    }
}

function normalizeSearchText(value) {
    return String(value ?? '').trim().toLocaleLowerCase('ko-KR');
}

export function shouldShowModelSearch(modelCount) {
    return Number.isInteger(modelCount) && modelCount > MODEL_SEARCH_VISIBILITY_THRESHOLD;
}

export function filterRegisteredModels(models, query, getProviderLabel = () => '') {
    const normalizedQuery = normalizeSearchText(query);
    const source = Array.isArray(models) ? models : [];
    if (!normalizedQuery) {
        return [...source];
    }

    return source.filter((model) => {
        const providerLabel = getProviderLabel(model?.provider, model);
        return [model?.id, model?.provider, providerLabel]
            .some(value => normalizeSearchText(value).includes(normalizedQuery));
    });
}

function createPlanIssue(line, id, code, message, source = null) {
    const issue = { line, id, code, message };
    if (source) {
        issue.source = source;
    }
    return issue;
}

export function createBulkModelRegistrationPlan(settings, providerValue, input, options = {}) {
    const providerId = normalizeProviderId(providerValue);
    const provider = getProvider(providerId);
    if (!provider) {
        throw new ModelManagementError('unsupported_provider', '지원하지 않는 제공업체입니다.');
    }

    const text = String(input ?? '');
    if (text.length > BULK_MODEL_INPUT_MAX_LENGTH) {
        throw new ModelManagementError(
            'bulk_input_too_large',
            `한 번에 입력하는 모델 ID는 ${BULK_MODEL_INPUT_MAX_LENGTH.toLocaleString('ko-KR')}자 이하여야 합니다.`,
        );
    }

    const rawLines = text.split(/\r?\n/);
    const enteredModelCount = rawLines.reduce((count, line) => (
        String(line ?? '').trim() ? count + 1 : count
    ), 0);
    if (enteredModelCount > BULK_MODEL_LINE_LIMIT) {
        throw new ModelManagementError(
            'bulk_line_limit',
            `한 번에 ${BULK_MODEL_LINE_LIMIT}개 모델까지 등록할 수 있습니다.`,
        );
    }

    const normalizedSettings = normalizeSettings(settings);
    const registered = new Set(normalizedSettings.models
        .filter(model => model.provider === providerId)
        .map(model => model.id));
    const seen = new Set();
    const additions = [];
    const duplicates = [];
    const invalid = [];
    let nonEmptyLineCount = 0;

    rawLines.forEach((rawValue, index) => {
        const line = index + 1;
        const trimmed = String(rawValue ?? '').trim();
        if (!trimmed) {
            return;
        }
        nonEmptyLineCount += 1;
        const validation = validateProviderModelId(providerId, trimmed);
        if (!validation.ok) {
            invalid.push(createPlanIssue(
                line,
                normalizeModelId(trimmed),
                validation.code,
                validation.message,
            ));
            return;
        }

        const id = validation.id;
        if (seen.has(id)) {
            duplicates.push(createPlanIssue(
                line,
                id,
                'duplicate_input',
                '같은 입력에 중복된 모델 ID입니다.',
                'input',
            ));
            return;
        }
        seen.add(id);
        if (registered.has(id)) {
            duplicates.push(createPlanIssue(
                line,
                id,
                'duplicate_registry',
                '이미 이 제공업체에 등록된 모델 ID입니다.',
                'registry',
            ));
            return;
        }
        if (typeof options.isUnavailableModelId === 'function' && options.isUnavailableModelId(id) === true) {
            duplicates.push(createPlanIssue(
                line,
                id,
                'core_duplicate',
                '이미 SillyTavern 기본 목록에 있는 모델 ID입니다.',
                'native',
            ));
            return;
        }
        additions.push({ line, id });
    });

    return {
        ok: invalid.length === 0,
        providerId,
        lineCount: rawLines.length,
        nonEmptyLineCount,
        additions,
        duplicates,
        invalid,
    };
}

export function applyBulkModelRegistrationPlan(settings, plan) {
    if (!plan?.ok) {
        throw new ModelManagementError('bulk_plan_invalid', '잘못된 모델 ID가 있어 아무 모델도 등록하지 않았습니다.');
    }
    let next = normalizeSettings(settings);
    for (const addition of plan.additions ?? []) {
        next = addModel(next, plan.providerId, addition.id);
    }
    return next;
}

export function createModelDeletionUndo(settings, providerValue, modelValue) {
    const normalized = normalizeSettings(settings);
    const providerId = normalizeProviderId(providerValue);
    const modelId = normalizeModelId(modelValue);
    const model = normalized.models.find(candidate => (
        candidate.provider === providerId && candidate.id === modelId
    ));
    if (!model) {
        throw new ModelManagementError('model_not_registered', '실행 취소할 등록 모델을 찾지 못했습니다.');
    }

    return Object.freeze({
        providerId,
        model: Object.freeze({ ...model }),
        restoreSelection: normalized.selectedModels[providerId] === modelId,
    });
}

export function restoreModelDeletion(settings, undo) {
    const normalized = normalizeSettings(settings);
    const providerId = normalizeProviderId(undo?.providerId);
    const modelId = normalizeModelId(undo?.model?.id);
    if (!getProvider(providerId) || !modelId) {
        throw new ModelManagementError('undo_invalid', '삭제 실행 취소 정보가 올바르지 않습니다.');
    }
    if (normalized.models.some(model => model.provider === providerId && model.id === modelId)) {
        return {
            ok: false,
            code: 'model_already_registered',
            message: '같은 모델이 이미 다시 등록되어 실행 취소하지 않았습니다.',
            settings: normalized,
            selectionRestored: false,
        };
    }

    let restored;
    try {
        restored = addModel(normalized, providerId, modelId);
        if (undo?.model?.enabled === false) {
            restored = normalizeSettings({
                ...restored,
                models: restored.models.map(model => (
                    model.provider === providerId && model.id === modelId
                        ? { ...model, enabled: false }
                        : model
                )),
            });
        }
    } catch (error) {
        if (error instanceof ModelRegistryError) {
            return {
                ok: false,
                code: error.code,
                message: error.message,
                settings: normalized,
                selectionRestored: false,
            };
        }
        throw error;
    }

    let selectionRestored = false;
    if (undo?.restoreSelection === true && restored.selectedModels[providerId] === undefined) {
        restored = setSelectedModel(restored, providerId, modelId);
        selectionRestored = true;
    }
    return {
        ok: true,
        settings: restored,
        selectionRestored,
    };
}
