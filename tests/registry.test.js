import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MODEL_ID_MAX_LENGTH,
    ModelRegistryError,
    addModel,
    getEnabledModels,
    getSelectedModel,
    hasEnabledModel,
    normalizeSettings,
    removeModel,
    setSelectedModel,
    validateModelId,
} from '../src/registry.js';

test('Vertex Gemini 모델 ID를 v0.1 호환 호출로 정규화하고 허용한다', () => {
    const result = validateModelId('  gemini-3.5-pro-preview  ');
    assert.equal(result.ok, true);
    assert.equal(result.id, 'gemini-3.5-pro-preview');
    assert.equal(result.provider.id, 'vertexai');
});

test('Google 모델은 계열과 무관하게 안전한 URL path segment만 허용한다', () => {
    assert.equal(validateModelId('gemma-3-27b-it').ok, true);
    assert.equal(validateModelId('Gemma_4.preview').ok, true);
    for (const id of [
        'gemini-3/pro',
        'gemini-3\\preview',
        'gemini-3:preview',
        'gemini-3?preview',
        'gemini-3#preview',
        'gemini-3%preview',
        'gemini-3 preview',
        'gemini-<script>',
    ]) {
        assert.equal(validateModelId(id).code, 'invalid_characters');
    }
});

test('원격 모델 ID 길이를 제한한다', () => {
    const exact = `gemini-${'a'.repeat(MODEL_ID_MAX_LENGTH - 'gemini-'.length)}`;
    const tooLong = `${exact}a`;

    assert.equal(exact.length, MODEL_ID_MAX_LENGTH);
    assert.equal(validateModelId(exact).ok, true);
    assert.equal(validateModelId(tooLong).code, 'too_long');
});

test('v1 Vertex 저장값과 선택 상태를 schema v2로 무손실 이관한다', () => {
    const settings = normalizeSettings({
        schemaVersion: 1,
        models: [
            { id: 'gemini-3.5-pro-preview', provider: 'wrong', protocol: 'wrong' },
            { id: 'gemini-3.5-pro-preview' },
            { id: 'bad/model' },
            null,
        ],
        selectedModelId: 'gemini-3.5-pro-preview',
    });

    assert.equal(settings.schemaVersion, 2);
    assert.deepEqual(settings.models, [{
        id: 'gemini-3.5-pro-preview',
        provider: 'vertexai',
        protocol: 'vertex-gemini',
        enabled: true,
    }]);
    assert.deepEqual(settings.selectedModels, { vertexai: 'gemini-3.5-pro-preview' });
    assert.equal(settings.selectedModelId, 'gemini-3.5-pro-preview');
    assert.equal(Object.keys(settings).includes('selectedModelId'), false);
});

test('schema v2는 제공업체+모델 ID를 복합키로 사용한다', () => {
    let settings = addModel(undefined, 'openai', 'shared-model');
    settings = addModel(settings, 'custom', 'shared-model');

    assert.deepEqual(
        settings.models.map(model => [model.provider, model.id]),
        [['openai', 'shared-model'], ['custom', 'shared-model']],
    );
    assert.throws(
        () => addModel(settings, 'openai', 'shared-model'),
        error => error instanceof ModelRegistryError && error.code === 'duplicate',
    );
});

test('제공업체별 규칙으로 공식·지역·중계 API 모델 ID를 검증한다', () => {
    assert.equal(validateModelId('gpt-5.7:preview', 'openai').ok, true);
    assert.equal(validateModelId('claude-next.preview', 'claude').ok, true);
    assert.equal(validateModelId('gemini-4-pro-preview', 'makersuite').ok, true);
    assert.equal(validateModelId('gemma-3-27b-it', 'makersuite').ok, true);
    assert.equal(validateModelId('gemma-3-27b-it', 'vertexai').ok, true);
    assert.equal(validateModelId('grok-next-beta', 'xai').ok, true);
    assert.equal(validateModelId('glm-5-air', 'zai').ok, true);
    assert.equal(validateModelId('anthropic/claude-next:beta', 'openrouter').ok, true);
    assert.equal(validateModelId('@cf/meta/llama-next', 'workers_ai').ok, true);
    assert.equal(validateModelId('accounts/org/models/new-model', 'fireworks').ok, true);
    assert.equal(validateModelId('hf.co/org/model-GGUF:Q4_K_M', 'custom').ok, true);
    assert.equal(validateModelId('https://localhost/v1/models', 'custom').code, 'model_url_not_allowed');
    assert.equal(validateModelId('models/gemini-4-pro', 'makersuite').code, 'invalid_characters');
    assert.equal(validateModelId('gemma-3:27b', 'vertexai').code, 'invalid_characters');
    assert.equal(validateModelId('model id with spaces', 'custom').code, 'invalid_characters');
    assert.equal(validateModelId('model?unsafe=true', 'openrouter').code, 'invalid_characters');
});

test('알 수 없는 미래 schema를 v1 Vertex 형식으로 오해하지 않는다', () => {
    const settings = normalizeSettings({
        schemaVersion: 999,
        models: [
            { id: 'future-model', provider: 'openai', enabled: true },
            { id: 'gemini-future', provider: 'unknown', enabled: true },
        ],
        selectedModelId: 'gemini-future',
    });

    assert.deepEqual(settings.models, [{
        id: 'future-model',
        provider: 'openai',
        protocol: 'openai-chat-completions',
        enabled: true,
    }]);
    assert.deepEqual(settings.selectedModels, {});
});

test('선택 상태와 삭제를 제공업체별로 격리한다', () => {
    let settings = addModel(undefined, 'openai', 'next-model');
    settings = addModel(settings, 'xai', 'next-model');
    settings = setSelectedModel(settings, 'openai', 'next-model');
    settings = setSelectedModel(settings, 'xai', 'next-model');

    assert.equal(getSelectedModel(settings, 'openai'), 'next-model');
    assert.equal(getSelectedModel(settings, 'xai'), 'next-model');
    assert.equal(hasEnabledModel(settings, 'openai', 'next-model'), true);
    assert.equal(getEnabledModels(settings, 'xai').length, 1);

    settings = removeModel(settings, 'openai', 'next-model');
    assert.equal(getSelectedModel(settings, 'openai'), null);
    assert.equal(getSelectedModel(settings, 'xai'), 'next-model');
    assert.equal(hasEnabledModel(settings, 'xai', 'next-model'), true);
});

test('schema v2 비활성 모델을 선택할 수 없고 손상된 protocol을 descriptor 값으로 복구한다', () => {
    const settings = normalizeSettings({
        schemaVersion: 2,
        models: [
            { id: 'future-model', provider: 'openai', protocol: 'tampered', enabled: false },
            { id: 'grok-future', provider: 'xai', protocol: 'tampered', enabled: true },
        ],
        selectedModels: {
            openai: 'future-model',
            xai: 'grok-future',
        },
    });

    assert.deepEqual(settings.models, [
        { id: 'future-model', provider: 'openai', protocol: 'openai-chat-completions', enabled: false },
        { id: 'grok-future', provider: 'xai', protocol: 'openai-chat-completions', enabled: true },
    ]);
    assert.deepEqual(settings.selectedModels, { xai: 'grok-future' });
    assert.throws(
        () => setSelectedModel(settings, 'openai', 'future-model'),
        error => error instanceof ModelRegistryError && error.code === 'not_registered',
    );
});

test('v0.1 단축 호출은 계속 Vertex AI 선택을 다룬다', () => {
    let settings = addModel(undefined, 'gemini-3.5-flash-preview');
    settings = setSelectedModel(settings, 'gemini-3.5-flash-preview');
    assert.equal(settings.selectedModelId, 'gemini-3.5-flash-preview');
    assert.equal(hasEnabledModel(settings, 'gemini-3.5-flash-preview'), true);

    settings = removeModel(settings, 'gemini-3.5-flash-preview');
    assert.equal(settings.selectedModelId, null);
});
