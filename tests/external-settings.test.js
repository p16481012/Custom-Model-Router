import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXTERNAL_SETTINGS_MAX_TARGETS,
    EXTERNAL_SETTINGS_SCHEMA_VERSION,
    ExternalSettingsError,
    getExternalMapping,
    getExternalSelectedModel,
    normalizeAutomaticExternalSettings,
    normalizeExternalSettings,
    removeExternalMapping,
    removeExternalSelectedModel,
    removeExternalTargetSelections,
    setExternalMapping,
    setExternalSelectedModel,
} from '../src/external-settings.js';

const TARGET = 'cmr-ext-1234abcd';

test('빈 값과 손상된 최상위 값은 schema v1 빈 설정으로 정규화한다', () => {
    const empty = {
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings: {},
        selectedModels: {},
    };
    assert.deepEqual(normalizeExternalSettings(), empty);
    assert.deepEqual(normalizeExternalSettings([]), empty);
    assert.deepEqual(normalizeExternalSettings({ mappings: 'bad', selectedModels: 42 }), empty);
});

test('legacy 연결 mode를 제거하고 provider별 선택과 안전한 필드만 정규화한다', () => {
    const normalized = normalizeExternalSettings({
        schemaVersion: 1,
        mappings: {
            ' CMR-EXT-1234ABCD ': ' ZAI ',
            'cmr-ext-2345bcde': 'disabled',
            'cmr-ext-3456cdef': 'unknown',
            unsafe: 'openai',
        },
        selectedModels: {
            [TARGET]: {
                zai: ' glm-5-plus ',
                openai: 'gpt-6-mini',
                unknown: 'must-drop',
            },
            unsafe: { openai: 'gpt-6-mini' },
        },
        apiKey: 'must-drop',
    });

    assert.deepEqual(normalized, {
        schemaVersion: 1,
        mappings: {},
        selectedModels: {
            [TARGET]: {
                zai: 'glm-5-plus',
                openai: 'gpt-6-mini',
            },
        },
    });
    assert.equal(JSON.stringify(normalized).includes('must-drop'), false);
});

test('미래 schema는 조용히 낮추지 않고 명시적인 오류를 낸다', () => {
    assert.throws(
        () => normalizeExternalSettings({ schemaVersion: 2, mappings: {}, selectedModels: {} }),
        error => error instanceof ExternalSettingsError && error.code === 'future_schema',
    );
});

test('legacy provider mapping은 제거하고 대상별 마지막 선택만 보존한다', () => {
    const mappings = {};
    for (let index = 0; index < EXTERNAL_SETTINGS_MAX_TARGETS; index += 1) {
        mappings[`cmr-ext-${index.toString(16).padStart(8, '0')}`] = 'openai';
    }
    const selectedTarget = 'cmr-ext-00000200';
    const normalized = normalizeAutomaticExternalSettings({
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings,
        selectedModels: {
            [selectedTarget]: { vertexai: 'gemini-future' },
        },
    });

    assert.deepEqual(normalized.mappings, {});
    assert.deepEqual(normalized.selectedModels, {
        [selectedTarget]: { vertexai: 'gemini-future' },
    });
    assert.throws(
        () => normalizeAutomaticExternalSettings({ schemaVersion: 2 }),
        error => error instanceof ExternalSettingsError && error.code === 'future_schema',
    );
});

test('legacy 연결 mutation API는 입력을 검증하되 mode를 다시 저장하지 않는다', () => {
    const source = normalizeExternalSettings();
    const mapped = setExternalMapping(source, TARGET, 'openai');
    const disabled = setExternalMapping(mapped, TARGET, 'disabled');

    assert.equal(getExternalMapping(source, TARGET), null);
    assert.equal(getExternalMapping(mapped, TARGET), null);
    assert.equal(getExternalMapping(disabled, TARGET), null);
    assert.deepEqual(removeExternalMapping(disabled, TARGET), {
        schemaVersion: 1,
        mappings: {},
        selectedModels: {},
    });
});

test('하나의 target에 provider별 선택을 독립 저장하고 선택만 제거한다', () => {
    let settings = setExternalSelectedModel(undefined, TARGET, 'openai', 'gpt-6-mini');
    settings = setExternalSelectedModel(settings, TARGET, 'zai', 'glm-5-plus');
    settings = setExternalMapping(settings, TARGET, 'zai');

    assert.equal(getExternalSelectedModel(settings, TARGET, 'openai'), 'gpt-6-mini');
    assert.equal(getExternalSelectedModel(settings, TARGET, 'zai'), 'glm-5-plus');
    settings = removeExternalSelectedModel(settings, TARGET, 'zai');
    assert.equal(getExternalSelectedModel(settings, TARGET, 'zai'), null);
    assert.equal(getExternalSelectedModel(settings, TARGET, 'openai'), 'gpt-6-mini');
    assert.equal(getExternalMapping(settings, TARGET), null);

    settings = setExternalSelectedModel(settings, TARGET, 'openai', '');
    assert.deepEqual(settings.selectedModels, {});

    settings = setExternalSelectedModel(settings, TARGET, 'claude', 'claude-next');
    assert.deepEqual(removeExternalTargetSelections(settings, TARGET).selectedModels, {});
});

test('잘못된 target·provider·model은 mutation API에서 구조화 오류를 낸다', () => {
    assert.throws(
        () => setExternalMapping(undefined, '__proto__', 'openai'),
        error => error instanceof ExternalSettingsError && error.code === 'target_id_invalid',
    );
    assert.throws(
        () => setExternalMapping(undefined, TARGET, 'unknown'),
        error => error instanceof ExternalSettingsError && error.code === 'mapping_provider_invalid',
    );
    assert.throws(
        () => setExternalSelectedModel(undefined, TARGET, 'unknown', 'model'),
        error => error instanceof ExternalSettingsError && error.code === 'unsupported_provider',
    );
    assert.throws(
        () => setExternalSelectedModel(undefined, TARGET, 'vertexai', 'bad/model'),
        error => error instanceof ExternalSettingsError && error.code === 'invalid_characters',
    );
});

test('원형·getter 오류·prototype pollution 입력을 실행하거나 결과에 남기지 않는다', () => {
    const mappings = {};
    Object.defineProperty(mappings, '__proto__', { enumerable: true, value: 'openai' });
    mappings[TARGET] = 'openai';
    const circular = { openai: 'gpt-6-mini' };
    circular.self = circular;
    const source = {
        mappings,
        selectedModels: { [TARGET]: circular },
    };
    Object.defineProperty(source, 'unknown', {
        enumerable: true,
        get() { throw new Error('getter must not run'); },
    });

    const normalized = normalizeExternalSettings(source);
    assert.deepEqual(normalized.mappings, {});
    assert.deepEqual(normalized.selectedModels, { [TARGET]: { openai: 'gpt-6-mini' } });
    assert.equal(Object.hasOwn(normalized.mappings, '__proto__'), false);
    assert.equal({}.polluted, undefined);
});

test('provider별 선택 target을 최대 512개까지만 정규화하고 mutation 추가는 거부한다', () => {
    const selectedModels = {};
    for (let index = 0; index < EXTERNAL_SETTINGS_MAX_TARGETS + 4; index += 1) {
        selectedModels[`cmr-ext-${index.toString(16).padStart(8, '0')}`] = { openai: `gpt-${index}` };
    }
    const normalized = normalizeExternalSettings({ selectedModels });
    assert.equal(Object.keys(normalized.selectedModels).length, EXTERNAL_SETTINGS_MAX_TARGETS);
    assert.throws(
        () => setExternalSelectedModel(normalized, 'cmr-ext-ffffffff', 'openai', 'gpt-new'),
        error => error instanceof ExternalSettingsError && error.code === 'target_limit',
    );

    const existing = Object.keys(normalized.selectedModels)[0];
    assert.equal(setExternalSelectedModel(normalized, existing, 'zai', 'glm-new').selectedModels[existing].zai, 'glm-new');
});
