import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PORTABLE_SETTINGS_FORMAT,
    PORTABLE_SETTINGS_MAX_LENGTH,
    PORTABLE_SETTINGS_MAX_MODELS,
    PORTABLE_SETTINGS_MAX_ROUTES,
    PORTABLE_SETTINGS_SCHEMA_VERSION,
    PortableSettingsError,
    createPortableSettings,
    inspectPortableSettings,
    parsePortableSettings,
    repairSettingsBundle,
    stringifyPortableSettings,
} from '../src/portable-settings.js';
import { addModel, normalizeSettings, setSelectedModel } from '../src/registry.js';
import { setPurposeRoute } from '../src/purpose-router.js';
import { setExternalSelectedModel, setExternalTargetExcluded } from '../src/external-settings.js';

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
    let externalSettings = setExternalSelectedModel(
        undefined,
        'cmr-ext-1234abcd',
        'openai',
        'gpt-future',
    );
    externalSettings = setExternalTargetExcluded(externalSettings, 'cmr-ext-1234abcd', true);
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
    assert.deepEqual(backup.externalIntegrations.mappings, {});
    assert.deepEqual(backup.externalIntegrations.excludedTargets, { 'cmr-ext-1234abcd': true });
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

test('portable 구조 경계 안의 자체 백업은 다시 읽히고 경계를 넘는 내보내기는 거부한다', () => {
    const createLongModel = index => ({
        id: `openrouter/${String(index).padStart(4, '0')}`.padEnd(256, 'x'),
        provider: 'openrouter',
        protocol: 'openai-chat-completions',
        enabled: true,
    });
    const models = Array.from(
        { length: PORTABLE_SETTINGS_MAX_MODELS },
        (_, index) => createLongModel(index),
    );
    const serialized = stringifyPortableSettings({
        registrySettings: { schemaVersion: 2, models, selectedModels: {} },
        purposeRoutes: { schemaVersion: 1, routes: {} },
        now: '2026-08-20T00:00:00.000Z',
    });

    assert.ok(serialized.length > 1_000_000);
    assert.ok(new TextEncoder().encode(serialized).byteLength <= PORTABLE_SETTINGS_MAX_LENGTH);
    assert.equal(parsePortableSettings(serialized).registrySettings.models.length, models.length);
    assert.throws(
        () => stringifyPortableSettings({
            registrySettings: {
                schemaVersion: 2,
                models: [...models, createLongModel(PORTABLE_SETTINGS_MAX_MODELS)],
                selectedModels: {},
            },
            purposeRoutes: { schemaVersion: 1, routes: {} },
        }),
        error => error instanceof PortableSettingsError && error.code === 'too_many_models',
    );

    const routes = Object.fromEntries(Array.from(
        { length: PORTABLE_SETTINGS_MAX_ROUTES + 1 },
        (_, index) => [`route-${String(index).padStart(3, '0')}`, {
            provider: 'openai',
            modelId: 'gpt-route-boundary',
            adapterId: 'sillytavern.connection-profile',
        }],
    ));
    assert.throws(
        () => stringifyPortableSettings({
            registrySettings: normalizeSettings(),
            purposeRoutes: { schemaVersion: 1, routes },
        }),
        error => error instanceof PortableSettingsError && error.code === 'too_many_routes',
    );
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
    assert.equal(parsed.externalSettings.excludedTargets['cmr-ext-1234abcd'], true);
    parsed.registrySettings.models[0].id = 'changed';
    assert.equal(source.registrySettings.models[0].id, 'gpt-future');
});

test('v0.6.0~v0.6.5 legacy mapping 백업은 선택 기록만 남기고 제거한다', () => {
    const source = createSettings();
    const backup = createPortableSettings({
        ...source,
        now: '2026-08-18T01:02:03.000Z',
    });
    backup.externalIntegrations.schemaVersion = 1;
    delete backup.externalIntegrations.excludedTargets;
    backup.externalIntegrations.mappings['cmr-ext-1234abcd'] = 'openai';

    const inspection = inspectPortableSettings(backup);
    assert.equal(inspection.ok, true);
    const parsed = parsePortableSettings(backup);
    assert.deepEqual(parsed.externalSettings.mappings, {});
    assert.equal(
        parsed.externalSettings.selectedModels['cmr-ext-1234abcd'].openai,
        'gpt-future',
    );
});

test('external schema v2 백업은 폐기된 legacy mapping을 다시 허용하지 않는다', () => {
    const backup = createPortableSettings({
        ...createSettings(),
        now: '2026-08-18T01:02:03.000Z',
    });
    backup.externalIntegrations.mappings['cmr-ext-1234abcd'] = 'disabled';

    const report = inspectPortableSettings(backup);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some(issue => issue.code === 'external_integrations_not_canonical'));
});

test('external schema v1 백업은 legacy disabled를 되살리지 않고 선택만 v2로 이관한다', () => {
    const backup = createPortableSettings({
        ...createSettings(),
        now: '2026-08-18T01:02:03.000Z',
    });
    backup.externalIntegrations = {
        schemaVersion: 1,
        mappings: { 'cmr-ext-1234abcd': 'disabled' },
        selectedModels: {
            'cmr-ext-1234abcd': { openai: 'gpt-future' },
        },
    };

    const parsed = parsePortableSettings(backup);
    assert.deepEqual(parsed.externalSettings.excludedTargets, {});
    assert.equal(parsed.externalSettings.schemaVersion, 2);
    assert.equal(parsed.externalSettings.selectedModels['cmr-ext-1234abcd'].openai, 'gpt-future');
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
    assert.deepEqual(parsed.externalSettings, {
        schemaVersion: 2,
        mappings: {},
        selectedModels: {},
        excludedTargets: {},
    });
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

test('legacy 모델의 제거 필드는 원문 없이 복구 상세에 집계한다', () => {
    const report = repairSettingsBundle({
        registrySettings: {
            schemaVersion: 1,
            models: [{ id: 'gemini-legacy-detail', apiKey: 'LEGACY_MODEL_SECRET' }],
            selectedModelId: 'gemini-legacy-detail',
        },
        purposeRoutes: { schemaVersion: 1, routes: {} },
    });

    const detail = report.details.items.find(item => item.code === 'model_unknown_fields_removed');
    assert.deepEqual(detail, {
        code: 'model_unknown_fields_removed',
        action: 'removed',
        pathCategory: 'registry.models',
        count: 1,
    });
    assert.deepEqual(
        report.warnings.map(issue => issue.code),
        ['settings_migrated', 'invalid_records_removed'],
    );
    assert.doesNotMatch(JSON.stringify(report.details), /LEGACY_MODEL_SECRET|apiKey|gemini-legacy-detail/);
});

test('빈 첫 설치와 삭제 없는 정규화를 이관·레코드 제거와 구분한다', () => {
    const fresh = repairSettingsBundle({});
    assert.equal(fresh.ok, true);
    assert.equal(fresh.status, 'ok');
    assert.deepEqual(fresh.warnings, []);
    assert.deepEqual(fresh.details, {
        schemaVersion: 1,
        totals: { removed: 0, changed: 0, rejected: 0 },
        items: [],
    });

    const normalized = repairSettingsBundle({
        registrySettings: {
            schemaVersion: 2,
            models: [{
                id: 'MODEL_VALUE_SECRET',
                provider: 'OpenAI',
                protocol: 'WRONG_PROTOCOL_SECRET',
                enabled: 'yes',
            }],
            selectedModels: { OpenAI: 'MODEL_VALUE_SECRET' },
        },
        purposeRoutes: { schemaVersion: 1, routes: {} },
    });
    assert.equal(normalized.ok, true);
    assert.equal(normalized.status, 'warning');
    assert.deepEqual(normalized.beforeCounts, { models: 1, selections: 1, routes: 0 });
    assert.deepEqual(normalized.afterCounts, normalized.beforeCounts);
    assert.deepEqual(normalized.warnings, [{
        severity: 'warning',
        code: 'settings_normalized',
        path: '$',
        message: '저장된 모델·선택·경로 값을 현재 규칙에 맞게 정규화했습니다.',
    }]);
    assert.deepEqual(normalized.details.totals, { removed: 0, changed: 2, rejected: 0 });
    assert.deepEqual(normalized.details.items.map(item => item.code), [
        'model_record_normalized',
        'selection_record_normalized',
    ]);
    assert.doesNotMatch(
        JSON.stringify({ warnings: normalized.warnings, details: normalized.details }),
        /MODEL_VALUE_SECRET|WRONG_PROTOCOL_SECRET|OpenAI/,
    );

    const missingSchema = repairSettingsBundle({
        registrySettings: {
            models: [{
                id: 'gpt-schema-normalized',
                provider: 'openai',
                protocol: 'openai-chat-completions',
                enabled: true,
            }],
            selectedModels: {},
        },
        purposeRoutes: { routes: {} },
    });
    assert.deepEqual(missingSchema.warnings.map(issue => issue.code), ['settings_normalized']);
    assert.equal(
        missingSchema.details.items.filter(item => item.code === 'schema_normalized').length,
        2,
    );
    assert.equal(missingSchema.details.items.some(item => item.code === 'schema_migrated'), false);

    const migratedAndNormalized = repairSettingsBundle({
        registrySettings: {
            schemaVersion: 1,
            models: 'BROKEN_CONTAINER_SECRET',
        },
        purposeRoutes: { schemaVersion: 1, routes: {} },
    });
    assert.deepEqual(migratedAndNormalized.warnings.map(issue => issue.code), [
        'settings_migrated',
        'settings_normalized',
    ]);
    assert.equal(migratedAndNormalized.details.totals.removed, 0);
    assert.doesNotMatch(
        JSON.stringify({
            warnings: migratedAndNormalized.warnings,
            details: migratedAndNormalized.details,
        }),
        /BROKEN_CONTAINER_SECRET/,
    );

    const invalidRoots = repairSettingsBundle({
        registrySettings: 'REGISTRY_ROOT_SECRET',
        purposeRoutes: ['ROUTES_ROOT_SECRET'],
    });
    assert.deepEqual(invalidRoots.warnings.map(issue => issue.code), ['settings_normalized']);
    assert.deepEqual(invalidRoots.details.totals, { removed: 0, changed: 2, rejected: 0 });
    assert.deepEqual(invalidRoots.details.items.map(item => item.code), [
        'registry_container_replaced',
        'routes_root_container_replaced',
    ]);
    assert.doesNotMatch(
        JSON.stringify({ warnings: invalidRoots.warnings, details: invalidRoots.details }),
        /REGISTRY_ROOT_SECRET|ROUTES_ROOT_SECRET/,
    );
});

test('정규화 설정의 비열거 하위 호환 getter를 중복 선택 레코드로 오인하지 않는다', () => {
    const normalizedRegistry = normalizeSettings({
        schemaVersion: 2,
        models: [{
            id: 'gemini-normalized',
            provider: 'vertexai',
            protocol: 'vertex-gemini',
            enabled: true,
        }],
        selectedModels: { vertexai: 'gemini-normalized' },
    });
    assert.equal(Object.hasOwn(normalizedRegistry, 'selectedModelId'), true);
    assert.equal(Object.keys(normalizedRegistry).includes('selectedModelId'), false);

    const report = repairSettingsBundle({
        registrySettings: normalizedRegistry,
        purposeRoutes: { schemaVersion: 1, routes: {} },
    });
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.beforeCounts, { models: 1, selections: 1, routes: 0 });
    assert.deepEqual(report.afterCounts, report.beforeCounts);
    assert.deepEqual(report.warnings, []);

    const duplicateLegacyField = repairSettingsBundle({
        registrySettings: {
            ...normalizedRegistry,
            selectedModelId: 'gemini-normalized',
        },
        purposeRoutes: { schemaVersion: 1, routes: {} },
    });
    assert.equal(duplicateLegacyField.status, 'ok');
    assert.deepEqual(duplicateLegacyField.beforeCounts, { models: 1, selections: 1, routes: 0 });
});
