import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXTERNAL_SETTINGS_MAX_TARGETS,
    EXTERNAL_SETTINGS_SCHEMA_VERSION,
    ExternalSettingsError,
    getExternalExcludedTargetIds,
    getExternalMapping,
    getExternalSelectedModel,
    isExternalTargetExcluded,
    normalizeAutomaticExternalSettings,
    normalizeExternalSettings,
    removeExternalMapping,
    removeExternalSelectedModel,
    removeExternalTargetSelections,
    setExternalMapping,
    setExternalSelectedModel,
    setExternalTargetExcluded,
} from '../src/external-settings.js';

const TARGET = 'cmr-ext-1234abcd';

test('빈 값과 손상된 최상위 값은 schema v2 빈 설정으로 정규화한다', () => {
    const empty = {
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings: {},
        selectedModels: {},
        excludedTargets: {},
    };
    assert.deepEqual(normalizeExternalSettings(), empty);
    assert.deepEqual(normalizeExternalSettings([]), empty);
    assert.deepEqual(normalizeExternalSettings({ mappings: 'bad', selectedModels: 42 }), empty);
});

test('legacy 연결 mode는 disabled까지 폐기하고 provider별 선택만 schema v2로 이관한다', () => {
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
        schemaVersion: 2,
        mappings: {},
        selectedModels: {
            [TARGET]: {
                zai: 'glm-5-plus',
                openai: 'gpt-6-mini',
            },
        },
        excludedTargets: {},
    });
    assert.equal(JSON.stringify(normalized).includes('must-drop'), false);
});

test('미래 schema는 조용히 낮추지 않고 명시적인 오류를 낸다', () => {
    assert.throws(
        () => normalizeExternalSettings({ schemaVersion: 3, mappings: {}, selectedModels: {} }),
        error => error instanceof ExternalSettingsError && error.code === 'future_schema',
    );
});

test('legacy provider mapping은 제거하고 대상별 마지막 선택과 v2 제외만 보존한다', () => {
    const mappings = {};
    for (let index = 0; index < EXTERNAL_SETTINGS_MAX_TARGETS; index += 1) {
        mappings[`cmr-ext-${index.toString(16).padStart(8, '0')}`] = 'openai';
    }
    const selectedTarget = 'cmr-ext-00000200';
    const excludedTarget = 'cmr-ext-000001ff';
    const normalized = normalizeAutomaticExternalSettings({
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings,
        excludedTargets: { [excludedTarget]: true },
        selectedModels: {
            [selectedTarget]: { vertexai: 'gemini-future' },
        },
    });

    assert.deepEqual(normalized.mappings, {});
    assert.deepEqual(normalized.selectedModels, {
        [selectedTarget]: { vertexai: 'gemini-future' },
    });
    assert.deepEqual(normalized.excludedTargets, { [excludedTarget]: true });
    assert.throws(
        () => normalizeAutomaticExternalSettings({ schemaVersion: 3 }),
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
        schemaVersion: 2,
        mappings: {},
        selectedModels: {},
        excludedTargets: {},
    });
});

test('사용자 제외를 targetId별로 추가·해제하고 선택 선호는 보존한다', () => {
    let settings = setExternalSelectedModel(undefined, TARGET, 'openai', 'gpt-6-mini');
    settings = setExternalTargetExcluded(settings, TARGET, true);

    assert.equal(isExternalTargetExcluded(settings, TARGET), true);
    assert.deepEqual(getExternalExcludedTargetIds(settings), [TARGET]);
    assert.equal(getExternalSelectedModel(settings, TARGET, 'openai'), 'gpt-6-mini');
    assert.equal(getExternalMapping(settings, TARGET), null);

    settings = setExternalTargetExcluded(settings, TARGET, false);
    assert.equal(isExternalTargetExcluded(settings, TARGET), false);
    assert.deepEqual(settings.excludedTargets, {});
    assert.equal(getExternalSelectedModel(settings, TARGET, 'openai'), 'gpt-6-mini');
});

test('schema v1의 제외 필드와 legacy disabled는 폐기하고 v2의 명시적 제외만 읽는다', () => {
    const legacy = normalizeExternalSettings({
        schemaVersion: 1,
        mappings: { [TARGET]: 'disabled' },
        excludedTargets: { [TARGET]: true },
        selectedModels: { [TARGET]: { openai: 'gpt-6-mini' } },
    });
    assert.deepEqual(legacy.excludedTargets, {});
    assert.equal(legacy.selectedModels[TARGET].openai, 'gpt-6-mini');

    const current = normalizeExternalSettings({
        schemaVersion: 2,
        excludedTargets: { [TARGET]: true },
    });
    assert.deepEqual(current.excludedTargets, { [TARGET]: true });
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
        schemaVersion: 2,
        mappings,
        selectedModels: { [TARGET]: circular },
        excludedTargets: {},
    };
    Object.defineProperty(source.excludedTargets, '__proto__', { enumerable: true, value: true });
    Object.defineProperty(source, 'unknown', {
        enumerable: true,
        get() { throw new Error('getter must not run'); },
    });

    const normalized = normalizeExternalSettings(source);
    assert.deepEqual(normalized.mappings, {});
    assert.deepEqual(normalized.selectedModels, { [TARGET]: { openai: 'gpt-6-mini' } });
    assert.deepEqual(normalized.excludedTargets, {});
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

test('제외와 선택은 target 512개 합산 한도를 공유하고 제외를 먼저 보존한다', () => {
    const excludedTargets = {};
    for (let index = 0; index < EXTERNAL_SETTINGS_MAX_TARGETS + 4; index += 1) {
        excludedTargets[`cmr-ext-${index.toString(16).padStart(8, '0')}`] = true;
    }
    const normalized = normalizeExternalSettings({
        schemaVersion: 2,
        excludedTargets,
        selectedModels: { 'cmr-ext-ffffffff': { openai: 'gpt-new' } },
    });
    assert.equal(Object.keys(normalized.excludedTargets).length, EXTERNAL_SETTINGS_MAX_TARGETS);
    assert.deepEqual(normalized.selectedModels, {});
    assert.throws(
        () => setExternalTargetExcluded(normalized, 'cmr-ext-ffffffff', true),
        error => error instanceof ExternalSettingsError && error.code === 'target_limit',
    );

    const existing = Object.keys(normalized.excludedTargets)[0];
    const withPreference = setExternalSelectedModel(normalized, existing, 'openai', 'gpt-existing');
    assert.equal(withPreference.selectedModels[existing].openai, 'gpt-existing');
    assert.equal(withPreference.excludedTargets[existing], true);
});
