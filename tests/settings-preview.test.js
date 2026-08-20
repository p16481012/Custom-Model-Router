import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PortableSettingsError,
    SETTINGS_IMPORT_PREVIEW_SCHEMA_VERSION,
    SETTINGS_REPAIR_DETAILS_SCHEMA_VERSION,
    createPortableSettings,
    createSettingsImportPreview,
    previewPortableSettingsImport,
    repairSettingsBundle,
} from '../src/portable-settings.js';
import { normalizeSettings } from '../src/registry.js';
import { normalizePurposeRoutes } from '../src/purpose-router.js';
import {
    normalizeExternalSettings,
    setExternalSelectedModel,
    setExternalTargetExcluded,
} from '../src/external-settings.js';

function model(provider, id, enabled = true) {
    const protocols = {
        openai: 'openai-chat-completions',
        vertexai: 'vertex-gemini',
        xai: 'openai-chat-completions',
        zai: 'openai-chat-completions',
    };
    return { provider, id, protocol: protocols[provider], enabled };
}

function route(provider, modelId, connectionProfileId) {
    return {
        provider,
        modelId,
        adapterId: 'sillytavern.connection-profile',
        connectionProfileId,
    };
}

function createCurrentSettings() {
    const registrySettings = normalizeSettings({
        schemaVersion: 2,
        models: [
            model('openai', 'gpt-a'),
            model('openai', 'gpt-b'),
            model('vertexai', 'gemini-delete'),
            model('xai', 'grok-toggle', false),
        ],
        selectedModels: { openai: 'gpt-a' },
    });
    const purposeRoutes = normalizePurposeRoutes({
        schemaVersion: 1,
        routes: {
            summary: route('openai', 'gpt-a', 'profile-current-secret'),
            translation: route('openai', 'gpt-a', 'profile-delete-secret'),
        },
    });
    let externalSettings = setExternalSelectedModel(
        undefined,
        'cmr-ext-11111111',
        'openai',
        'gpt-a',
    );
    externalSettings = setExternalTargetExcluded(
        externalSettings,
        'cmr-ext-22222222',
        true,
    );
    return { registrySettings, purposeRoutes, externalSettings };
}

function createImportedSettings() {
    const registrySettings = normalizeSettings({
        schemaVersion: 2,
        models: [
            model('openai', 'gpt-a'),
            model('openai', 'gpt-b'),
            model('xai', 'grok-toggle', true),
            model('zai', 'glm-add'),
        ],
        selectedModels: { openai: 'gpt-b' },
    });
    const purposeRoutes = normalizePurposeRoutes({
        schemaVersion: 1,
        routes: {
            summary: route('openai', 'gpt-a', 'profile-import-secret'),
            captioning: route('openai', 'gpt-b', 'profile-add-secret'),
        },
    });
    let externalSettings = setExternalSelectedModel(
        undefined,
        'cmr-ext-11111111',
        'openai',
        'gpt-b',
    );
    externalSettings = setExternalTargetExcluded(
        externalSettings,
        'cmr-ext-33333333',
        true,
    );
    return { registrySettings, purposeRoutes, externalSettings };
}

test('동일한 sanitized 설정은 no-change 미리보기를 만든다', () => {
    const current = createCurrentSettings();
    const sourceSnapshot = structuredClone(current);
    const preview = createSettingsImportPreview({
        currentRegistrySettings: current.registrySettings,
        currentPurposeRoutes: current.purposeRoutes,
        currentExternalSettings: current.externalSettings,
        importedRegistrySettings: current.registrySettings,
        importedPurposeRoutes: current.purposeRoutes,
        importedExternalSettings: current.externalSettings,
    });

    assert.equal(preview.schemaVersion, SETTINGS_IMPORT_PREVIEW_SCHEMA_VERSION);
    assert.equal(preview.status, 'no-change');
    assert.equal(preview.hasChanges, false);
    assert.deepEqual(preview.summary, { additions: 0, conflicts: 0, deletions: 0 });
    assert.equal(preview.registry.changeCount, 0);
    assert.equal(preview.routes.changeCount, 0);
    assert.deepEqual(preview.external.currentCounts, preview.external.importedCounts);
    assert.deepEqual(current, sourceSnapshot);
});

test('가져오기 미리보기는 모델 식별자·route 키·외부 집계만 구조화한다', () => {
    const current = createCurrentSettings();
    const imported = createImportedSettings();
    const backup = createPortableSettings({
        ...imported,
        now: '2026-08-20T00:00:00.000Z',
    });
    const preview = previewPortableSettingsImport(backup, current);

    assert.equal(preview.status, 'changes');
    assert.equal(preview.hasChanges, true);
    assert.deepEqual(preview.summary, { additions: 3, conflicts: 4, deletions: 3 });
    assert.deepEqual(preview.registry.models.additions, [{ provider: 'zai', modelId: 'glm-add' }]);
    assert.deepEqual(preview.registry.models.conflicts, [{
        provider: 'xai',
        modelId: 'grok-toggle',
        changedKeys: ['enabled'],
    }]);
    assert.deepEqual(preview.registry.models.deletions, [{
        provider: 'vertexai',
        modelId: 'gemini-delete',
    }]);
    assert.deepEqual(preview.registry.selections.conflicts, [{
        provider: 'openai',
        currentModelId: 'gpt-a',
        importedModelId: 'gpt-b',
    }]);
    assert.deepEqual(preview.routes.additions, [{
        purpose: 'captioning',
        keys: ['provider', 'modelId', 'adapterId', 'connectionProfileId'],
    }]);
    assert.deepEqual(preview.routes.conflicts, [{
        purpose: 'summary',
        changedKeys: ['connectionProfileId'],
    }]);
    assert.deepEqual(preview.routes.deletions, [{
        purpose: 'translation',
        keys: ['provider', 'modelId', 'adapterId', 'connectionProfileId'],
    }]);
    assert.deepEqual(preview.external.changes, {
        targets: { additions: 1, conflicts: 1, deletions: 1 },
        selections: { additions: 0, conflicts: 1, deletions: 0 },
        exclusions: { additions: 1, conflicts: 0, deletions: 1 },
    });

    const serialized = JSON.stringify(preview);
    assert.doesNotMatch(
        serialized,
        /cmr-ext-|profile-current-secret|profile-import-secret|profile-add-secret|profile-delete-secret/,
    );
});

test('invalid·future portable 입력은 미리보기 전에 기존 오류로 원자 거부한다', () => {
    const current = createCurrentSettings();
    const snapshot = structuredClone(current);
    const valid = createPortableSettings({
        ...createImportedSettings(),
        now: '2026-08-20T00:00:00.000Z',
    });
    const invalid = structuredClone(valid);
    invalid.apiKey = 'TOP_LEVEL_SECRET';
    const future = structuredClone(valid);
    future.externalIntegrations.schemaVersion = 999;

    for (const candidate of [invalid, future]) {
        assert.throws(
            () => previewPortableSettingsImport(candidate, current),
            error => error instanceof PortableSettingsError,
        );
        assert.deepEqual(current, snapshot);
    }
});

test('복구 상세는 제거·변경 사유를 고정 코드와 path category 집계로만 반환한다', () => {
    const report = repairSettingsBundle({
        registrySettings: {
            schemaVersion: 2,
            endpoint: 'ROOT_ENDPOINT_SECRET',
            models: [
                { ...model('openai', 'gpt-safe'), apiKey: 'MODEL_KEY_SECRET' },
                model('openai', 'gpt-safe'),
                model('openai', 'https://MODEL_VALUE_SECRET.invalid'),
                {
                    id: 'gpt-normalized',
                    provider: 'OpenAI',
                    protocol: 'wrong-protocol',
                    enabled: 'yes',
                },
            ],
            selectedModels: {
                openai: 'gpt-safe',
                unsupported: 'SELECTION_SECRET',
            },
        },
        purposeRoutes: {
            schemaVersion: 1,
            serviceAccount: 'ROOT_ROUTE_SECRET',
            routes: {
                summary: { ...route('openai', 'gpt-safe', 'profile-safe'), apiKey: 'ROUTE_KEY_SECRET' },
                Summary: route('openai', 'gpt-safe', 'profile-duplicate'),
                '잘못된 용도 SECRET': { provider: 'openai' },
            },
        },
    });

    assert.equal(report.ok, true);
    assert.equal(report.details.schemaVersion, SETTINGS_REPAIR_DETAILS_SCHEMA_VERSION);
    assert.ok(report.details.totals.removed > 0);
    assert.ok(report.details.totals.changed > 0);
    const byCode = Object.fromEntries(report.details.items.map(item => [item.code, item]));
    assert.equal(byCode.registry_unknown_fields_removed.pathCategory, 'registry');
    assert.equal(byCode.model_duplicate_merged.action, 'removed');
    assert.equal(byCode.model_invalid_removed.count, 1);
    assert.equal(byCode.model_record_normalized.action, 'changed');
    assert.equal(byCode.registry_unknown_fields_removed.action, 'removed');
    assert.equal(byCode.model_unknown_fields_removed.pathCategory, 'registry.models');
    assert.equal(byCode.model_unknown_fields_removed.action, 'removed');
    assert.equal(byCode.selection_invalid_removed.pathCategory, 'registry.selections');
    assert.equal(byCode.routes_unknown_fields_removed.pathCategory, 'routes');
    assert.equal(byCode.route_duplicate_merged.action, 'removed');
    assert.equal(byCode.route_invalid_removed.pathCategory, 'routes.entries');
    assert.equal(byCode.route_unknown_fields_removed.action, 'removed');
    assert.doesNotMatch(
        JSON.stringify(report.details),
        /SECRET|gpt-safe|gpt-normalized|summary|openai|profile-safe/,
    );
});

test('미래 저장 schema 복구 거부도 원문 없이 category별 상세를 만든다', () => {
    const report = repairSettingsBundle({
        registrySettings: { schemaVersion: 999, apiKey: 'REGISTRY_SECRET' },
        purposeRoutes: { schemaVersion: 999, routes: { secret: 'ROUTE_SECRET' } },
    });

    assert.equal(report.ok, false);
    assert.deepEqual(report.details, {
        schemaVersion: SETTINGS_REPAIR_DETAILS_SCHEMA_VERSION,
        totals: { removed: 0, changed: 0, rejected: 2 },
        items: [
            {
                code: 'future_registry_schema',
                action: 'rejected',
                pathCategory: 'registry.schema',
                count: 1,
            },
            {
                code: 'future_routes_schema',
                action: 'rejected',
                pathCategory: 'routes.schema',
                count: 1,
            },
        ],
    });
    assert.doesNotMatch(JSON.stringify(report.details), /SECRET|apiKey|secret/);
});
