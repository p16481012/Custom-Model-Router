import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MODEL_ID_MAX_LENGTH,
    ModelRegistryError,
    addModel,
    hasEnabledModel,
    normalizeSettings,
    removeModel,
    setSelectedModel,
    validateModelId,
} from '../src/registry.js';

test('Vertex Gemini 모델 ID를 정규화하고 허용한다', () => {
    assert.deepEqual(validateModelId('  gemini-3.5-pro-preview  '), {
        ok: true,
        id: 'gemini-3.5-pro-preview',
    });
});

test('Gemini가 아닌 모델과 URL 경로 문자를 거부한다', () => {
    assert.equal(validateModelId('claude-opus-4').code, 'unsupported_family');
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

test('모델 ID 길이를 제한한다', () => {
    const exact = `gemini-${'a'.repeat(MODEL_ID_MAX_LENGTH - 'gemini-'.length)}`;
    const tooLong = `${exact}a`;

    assert.equal(exact.length, MODEL_ID_MAX_LENGTH);
    assert.equal(validateModelId(exact).ok, true);
    assert.equal(validateModelId(tooLong).code, 'too_long');
});

test('손상된 저장값을 제거하고 중복 모델을 하나로 합친다', () => {
    const settings = normalizeSettings({
        schemaVersion: 999,
        models: [
            { id: 'gemini-3.5-pro-preview', provider: 'wrong', protocol: 'wrong' },
            { id: 'gemini-3.5-pro-preview' },
            { id: 'not-gemini' },
            null,
        ],
        selectedModelId: 'gemini-3.5-pro-preview',
    });

    assert.equal(settings.schemaVersion, 1);
    assert.deepEqual(settings.models, [{
        id: 'gemini-3.5-pro-preview',
        provider: 'vertexai',
        protocol: 'vertex-gemini',
        enabled: true,
    }]);
    assert.equal(settings.selectedModelId, 'gemini-3.5-pro-preview');
});

test('v0.1에서 지원하지 않는 비활성 상태는 활성 레코드로 복구한다', () => {
    const settings = normalizeSettings({
        models: [
            { id: 'gemini-3.5-pro-preview', enabled: false },
            { id: 'gemini-3.5-pro-preview', enabled: true },
        ],
    });

    assert.deepEqual(settings.models, [{
        id: 'gemini-3.5-pro-preview',
        provider: 'vertexai',
        protocol: 'vertex-gemini',
        enabled: true,
    }]);
    assert.equal(hasEnabledModel(settings, 'gemini-3.5-pro-preview'), true);
});

test('중복 등록을 명확한 오류로 거부한다', () => {
    const settings = addModel(undefined, 'gemini-3.5-pro-preview');
    assert.throws(
        () => addModel(settings, 'gemini-3.5-pro-preview'),
        error => error instanceof ModelRegistryError && error.code === 'duplicate',
    );
});

test('등록 모델만 선택할 수 있고 삭제하면 선택 상태도 해제한다', () => {
    let settings = addModel(undefined, 'gemini-3.5-flash-preview');
    settings = setSelectedModel(settings, 'gemini-3.5-flash-preview');
    assert.equal(settings.selectedModelId, 'gemini-3.5-flash-preview');
    assert.equal(hasEnabledModel(settings, 'gemini-3.5-flash-preview'), true);

    settings = removeModel(settings, 'gemini-3.5-flash-preview');
    assert.equal(settings.models.length, 0);
    assert.equal(settings.selectedModelId, null);
    assert.throws(
        () => setSelectedModel(settings, 'gemini-3.5-flash-preview'),
        error => error instanceof ModelRegistryError && error.code === 'not_registered',
    );
});
