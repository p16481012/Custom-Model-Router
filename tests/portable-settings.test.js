import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PORTABLE_SETTINGS_FORMAT,
    PORTABLE_SETTINGS_SCHEMA_VERSION,
    PortableSettingsError,
    createPortableSettings,
    inspectPortableSettings,
    parsePortableSettings,
    repairSettingsBundle,
    stringifyPortableSettings,
} from '../src/portable-settings.js';
import { addModel, setSelectedModel } from '../src/registry.js';
import { setPurposeRoute } from '../src/purpose-router.js';
import { setExternalMapping, setExternalSelectedModel } from '../src/external-settings.js';

function createSettings() {
    let registrySettings = addModel(undefined, 'openai', 'gpt-future');
    registrySettings = addModel(registrySettings, 'vertexai', 'gemini-future');
    registrySettings = setSelectedModel(registrySettings, 'openai', 'gpt-future');
    const purposeRoutes = setPurposeRoute(undefined, 'summary', {
        provider: 'openai',
        modelId: 'gpt-future',
        adapterId: 'sillytavern.connection-profile',
        connectionProfileId: 'profile-summary',
    }, { registrySettings });
    let externalSettings = setExternalMapping(undefined, 'cmr-ext-1234abcd', 'openai');
    externalSettings = setExternalSelectedModel(
        externalSettings,
        'cmr-ext-1234abcd',
        'openai',
        'gpt-future',
    );
    return { registrySettings, purposeRoutes, externalSettings };
}

test('Registry·용도별 경로·외부 연결만 결정적 백업으로 만들고 연결 비밀정보를 제외한다', () => {
    const { registrySettings, purposeRoutes, externalSettings } = createSettings();
    registrySettings.apiKey = 'REGISTRY_SECRET';
    registrySettings.endpoint = 'https://secret.invalid';
    purposeRoutes.serviceAccount = 'ROUTES_SECRET';
    purposeRoutes.routes.summary.apiKey = 'ROUTE_SECRET';

    const backup = createPortableSettings({
        registrySettings,
        purposeRoutes,
        externalSettings,
        createdAt: new Date('2026-08-18T00:00:00.000Z'),
        connectionProfiles: [{ apiKey: 'PROFILE_SECRET' }],
    });
    const serialized = JSON.stringify(backup);

    assert.equal(backup.format, PORTABLE_SETTINGS_FORMAT);
    assert.equal(backup.schemaVersion, PORTABLE_SETTINGS_SCHEMA_VERSION);
    assert.equal(backup.createdAt, '2026-08-18T00:00:00.000Z');
    assert.deepEqual(Object.keys(backup), [
        'format', 'schemaVersion', 'createdAt', 'registry', 'purposeRoutes', 'externalIntegrations',
    ]);
    assert.deepEqual(backup.purposeRoutes.routes.summary, {
        provider: 'openai',
        modelId: 'gpt-future',
        adapterId: 'sillytavern.connection-profile',
        connectionProfileId: 'profile-summary',
    });
    assert.equal(backup.externalIntegrations.mappings['cmr-ext-1234abcd'], 'openai');
    assert.doesNotMatch(
        serialized,
        /REGISTRY_SECRET|ROUTES_SECRET|ROUTE_SECRET|PROFILE_SECRET|secret\.invalid/,
    );

    const pretty = stringifyPortableSettings({
        registrySettings,
        purposeRoutes,
        now: '2026-08-18T00:00:00.000Z',
    });
    assert.match(pretty, /\n  "format"/);
    assert.equal(JSON.parse(pretty).createdAt, backup.createdAt);
});

test('정상 백업을 검사하고 원본 설정을 변경하지 않는 값으로 파싱한다', () => {
    const source = createSettings();
    const backup = createPortableSettings({
        ...source,
        now: '2026-08-18T01:02:03.000Z',
    });
    // JSON 객체의 필드 순서가 달라도 같은 백업으로 받아들여야 한다.
    backup.purposeRoutes.routes.summary = {
        connectionProfileId: 'profile-summary',
        adapterId: 'sillytavern.connection-profile',
        modelId: 'gpt-future',
        provider: 'openai',
    };

    const inspection = inspectPortableSettings(JSON.stringify(backup));
    assert.equal(inspection.ok, true);
    assert.equal(inspection.status, 'ok');
    assert.match(inspection.summary, /모두 올바릅니다/);

    const parsed = parsePortableSettings(backup);
    assert.equal(parsed.registrySettings.selectedModels.openai, 'gpt-future');
    assert.equal(parsed.purposeRoutes.routes.summary.modelId, 'gpt-future');
    assert.equal(parsed.externalSettings.selectedModels['cmr-ext-1234abcd'].openai, 'gpt-future');
    parsed.registrySettings.models[0].id = 'changed';
    assert.equal(source.registrySettings.models[0].id, 'gpt-future');
});

test('알 수 없는 필드와 그 값은 가져오기를 거부하되 진단에 비밀 값을 싣지 않는다', () => {
    const backup = createPortableSettings({
        ...createSettings(),
        now: '2026-08-18T00:00:00.000Z',
    });
    backup.apiKey = 'TOP_LEVEL_SECRET';
    backup.registry.models[0].endpoint = 'MODEL_ENDPOINT_SECRET';
    backup.purposeRoutes.routes.summary.serviceAccount = 'ROUTE_ACCOUNT_SECRET';

    const inspection = inspectPortableSettings(backup);
    assert.equal(inspection.ok, false);
    assert.equal(inspection.status, 'error');
    assert.equal(inspection.errors.filter(issue => issue.code === 'unknown_field').length, 3);
    assert.ok(inspection.errors.some(issue => issue.path === '$.apiKey'));
    assert.doesNotMatch(
        JSON.stringify(inspection),
        /TOP_LEVEL_SECRET|MODEL_ENDPOINT_SECRET|ROUTE_ACCOUNT_SECRET/,
    );
    assert.throws(
        () => parsePortableSettings(backup),
        error => error instanceof PortableSettingsError && error.code === 'unknown_field',
    );
});

test('미래 백업·Registry·용도별 경로 스키마를 명확히 거부한다', () => {
    const base = createPortableSettings({
        ...createSettings(),
        now: '2026-08-18T00:00:00.000Z',
    });
    for (const mutate of [
        value => { value.schemaVersion = PORTABLE_SETTINGS_SCHEMA_VERSION + 1; },
        value => { value.registry.schemaVersion = 999; },
        value => { value.purposeRoutes.schemaVersion = 999; },
        value => { value.externalIntegrations.schemaVersion = 999; },
    ]) {
        const candidate = structuredClone(base);
        mutate(candidate);
        const report = inspectPortableSettings(candidate);
        assert.equal(report.ok, false);
        assert.ok(report.errors.some(issue => issue.code === 'future_schema_unsupported'));
    }

    assert.throws(
        () => createPortableSettings({ registrySettings: { schemaVersion: 999 } }),
        error => error instanceof PortableSettingsError && error.code === 'future_registry_schema',
    );
    assert.throws(
        () => createPortableSettings({ purposeRoutes: { schemaVersion: 999 } }),
        error => error instanceof PortableSettingsError && error.code === 'future_routes_schema',
    );
    assert.throws(
        () => createPortableSettings({ externalSettings: { schemaVersion: 999 } }),
        error => error instanceof PortableSettingsError && error.code === 'future_external_schema',
    );
});

test('v0.5 schema v1 백업은 외부 연결 빈 설정으로 안전하게 이관한다', () => {
    const backup = createPortableSettings({
        ...createSettings(),
        now: '2026-08-18T00:00:00.000Z',
    });
    backup.schemaVersion = 1;
    delete backup.externalIntegrations;

    const parsed = parsePortableSettings(backup);
    assert.equal(parsed.report.status, 'warning');
    assert.deepEqual(parsed.externalSettings, { schemaVersion: 1, mappings: {}, selectedModels: {} });
});

test('Registry에서 사라진 용도별 모델은 경로를 보존하면서 주의로 보고한다', () => {
    const backup = createPortableSettings({
        ...createSettings(),
        now: '2026-08-18T00:00:00.000Z',
    });
    backup.registry.models = backup.registry.models.filter(model => model.provider !== 'openai');
    delete backup.registry.selectedModels.openai;

    const report = inspectPortableSettings(backup);
    assert.equal(report.ok, true);
    assert.equal(report.status, 'warning');
    assert.deepEqual(report.warnings.map(issue => issue.code), ['route_model_not_registered']);

    const parsed = parsePortableSettings(backup);
    assert.equal(parsed.purposeRoutes.routes.summary.modelId, 'gpt-future');
    assert.equal(parsed.report.status, 'warning');
});

test('이전·손상 저장값을 정규화하고 미래 저장 스키마는 복구하지 않는다', () => {
    const result = repairSettingsBundle({
        registrySettings: {
            schemaVersion: 1,
            models: [
                { id: 'gemini-legacy' },
                { id: 'gemini-legacy' },
                { id: 'bad/model' },
            ],
            selectedModelId: 'gemini-legacy',
        },
        purposeRoutes: {
            routes: {
                summary: {
                    provider: 'vertexai',
                    modelId: 'gemini-legacy',
                    adapterId: 'sillytavern.connection-profile',
                },
                '잘못된 용도': { provider: 'vertexai' },
            },
        },
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'warning');
    assert.deepEqual(result.beforeCounts, { models: 3, selections: 1, routes: 2 });
    assert.deepEqual(result.afterCounts, { models: 1, selections: 1, routes: 1 });
    assert.equal(result.registrySettings.selectedModels.vertexai, 'gemini-legacy');
    assert.equal(result.purposeRoutes.routes.summary.modelId, 'gemini-legacy');
    assert.deepEqual(
        result.warnings.map(issue => issue.code),
        ['settings_migrated', 'invalid_records_removed'],
    );

    const future = repairSettingsBundle({
        registrySettings: { schemaVersion: 999 },
        purposeRoutes: { schemaVersion: 1, routes: {} },
    });
    assert.equal(future.ok, false);
    assert.equal(future.status, 'error');
    assert.equal(future.errors[0].code, 'future_registry_schema');
    assert.equal(Object.hasOwn(future, 'registrySettings'), false);
});
