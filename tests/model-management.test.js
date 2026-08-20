import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BULK_MODEL_INPUT_MAX_LENGTH,
    BULK_MODEL_LINE_LIMIT,
    MODEL_SEARCH_VISIBILITY_THRESHOLD,
    ModelManagementError,
    applyBulkModelRegistrationPlan,
    createBulkModelRegistrationPlan,
    createModelDeletionUndo,
    filterRegisteredModels,
    restoreModelDeletion,
    shouldShowModelSearch,
} from '../src/model-management.js';
import {
    addModel,
    normalizeSettings,
    removeModel,
    setSelectedModel,
} from '../src/registry.js';

test('등록 모델 검색은 임계값을 넘을 때만 표시하고 제공업체·모델 ID를 함께 찾는다', () => {
    assert.equal(shouldShowModelSearch(MODEL_SEARCH_VISIBILITY_THRESHOLD), false);
    assert.equal(shouldShowModelSearch(MODEL_SEARCH_VISIBILITY_THRESHOLD + 1), true);
    const models = [
        { provider: 'vertexai', id: 'gemini-custom' },
        { provider: 'openai', id: 'gpt-custom' },
    ];
    const labels = { vertexai: 'Google Vertex AI', openai: 'OpenAI' };
    assert.deepEqual(
        filterRegisteredModels(models, 'google', providerId => labels[providerId]),
        [models[0]],
    );
    assert.deepEqual(filterRegisteredModels(models, 'GPT'), [models[1]]);
    assert.deepEqual(filterRegisteredModels(models, '  '), models);
});

test('여러 줄 모델 ID는 빈 줄을 무시하고 신규·중복·잘못된 행을 분류한다', () => {
    const settings = addModel(normalizeSettings(), 'openai', 'already-there');
    const plan = createBulkModelRegistrationPlan(
        settings,
        'openai',
        '\nnew-one\nalready-there\nnew-one\nbad id\nnative-one\n',
        { isUnavailableModelId: id => id === 'native-one' },
    );
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.additions, [{ line: 2, id: 'new-one' }]);
    assert.deepEqual(plan.duplicates.map(item => item.code), [
        'duplicate_registry',
        'duplicate_input',
        'core_duplicate',
    ]);
    assert.equal(plan.invalid[0].line, 5);
    assert.throws(
        () => applyBulkModelRegistrationPlan(settings, plan),
        error => error instanceof ModelManagementError && error.code === 'bulk_plan_invalid',
    );
});

test('유효한 여러 줄 계획은 한 번에 적용하며 입력 중복은 건너뛴다', () => {
    const plan = createBulkModelRegistrationPlan(
        normalizeSettings(),
        'vertexai',
        'gemini-a\ngemini-b\ngemini-a',
    );
    assert.equal(plan.ok, true);
    const settings = applyBulkModelRegistrationPlan(normalizeSettings(), plan);
    assert.deepEqual(settings.models.map(model => model.id), ['gemini-a', 'gemini-b']);
    assert.equal(plan.duplicates.length, 1);
});

test('대량 입력의 전체 길이와 행 수를 제한한다', () => {
    assert.throws(
        () => createBulkModelRegistrationPlan(
            normalizeSettings(),
            'openai',
            'x'.repeat(BULK_MODEL_INPUT_MAX_LENGTH + 1),
        ),
        error => error instanceof ModelManagementError && error.code === 'bulk_input_too_large',
    );
    assert.throws(
        () => createBulkModelRegistrationPlan(
            normalizeSettings(),
            'openai',
            Array.from({ length: BULK_MODEL_LINE_LIMIT + 1 }, (_, index) => `model-${index}`).join('\n'),
        ),
        error => error instanceof ModelManagementError && error.code === 'bulk_line_limit',
    );
    const sparse = createBulkModelRegistrationPlan(
        normalizeSettings(),
        'openai',
        `${'\n'.repeat(BULK_MODEL_LINE_LIMIT + 20)}one-model`,
    );
    assert.equal(sparse.ok, true);
    assert.deepEqual(sparse.additions.map(item => item.id), ['one-model']);
});

test('삭제 실행 취소는 모델을 복구하되 이후 생긴 선택을 덮지 않는다', () => {
    let settings = addModel(normalizeSettings(), 'openai', 'deleted-model');
    settings = addModel(settings, 'openai', 'other-model');
    settings = setSelectedModel(settings, 'openai', 'deleted-model');
    const undo = createModelDeletionUndo(settings, 'openai', 'deleted-model');
    settings = removeModel(settings, 'openai', 'deleted-model');
    settings = setSelectedModel(settings, 'openai', 'other-model');

    const restored = restoreModelDeletion(settings, undo);
    assert.equal(restored.ok, true);
    assert.equal(restored.selectionRestored, false);
    assert.equal(restored.settings.selectedModels.openai, 'other-model');
    assert.deepEqual(restored.settings.models.map(model => model.id), ['other-model', 'deleted-model']);
});

test('삭제 뒤 다른 변경이 없으면 선택까지 복구하고 같은 모델 재등록과 충돌하면 덮지 않는다', () => {
    let settings = addModel(normalizeSettings(), 'openai', 'deleted-model');
    settings = setSelectedModel(settings, 'openai', 'deleted-model');
    const undo = createModelDeletionUndo(settings, 'openai', 'deleted-model');
    const deleted = removeModel(settings, 'openai', 'deleted-model');
    const restored = restoreModelDeletion(deleted, undo);
    assert.equal(restored.ok, true);
    assert.equal(restored.selectionRestored, true);
    assert.equal(restored.settings.selectedModels.openai, 'deleted-model');

    const conflict = restoreModelDeletion(addModel(deleted, 'openai', 'deleted-model'), undo);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'model_already_registered');

    const disabled = normalizeSettings({
        schemaVersion: 2,
        models: [{
            id: 'disabled-model',
            provider: 'openai',
            protocol: 'openai-chat-completions',
            enabled: false,
        }],
        selectedModels: {},
    });
    const disabledUndo = createModelDeletionUndo(disabled, 'openai', 'disabled-model');
    const disabledRestored = restoreModelDeletion(
        removeModel(disabled, 'openai', 'disabled-model'),
        disabledUndo,
    );
    assert.equal(disabledRestored.ok, true);
    assert.equal(disabledRestored.settings.models[0].enabled, false);
});
