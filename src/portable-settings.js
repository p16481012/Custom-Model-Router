import {
    SETTINGS_SCHEMA_VERSION,
    hasEnabledModel,
    normalizeSettings,
} from './registry.js';
import {
    getProvider,
    isSupportedProvider,
    normalizeProviderId,
    validateProviderModelId,
} from './providers.js';
import {
    PURPOSE_ROUTES_SCHEMA_VERSION,
    normalizePurposeRoutes,
    validatePurposeId,
    validatePurposeRoute,
} from './purpose-router.js';
import {
    EXTERNAL_MAPPING_DISABLED,
    EXTERNAL_MAPPING_MANUAL,
    EXTERNAL_SETTINGS_MAX_TARGETS,
    EXTERNAL_SETTINGS_SCHEMA_VERSION,
    normalizeExternalSettings,
} from './external-settings.js';

export const PORTABLE_SETTINGS_FORMAT = 'custom-model-router-portable-settings';
export const PORTABLE_SETTINGS_SCHEMA_VERSION = 2;
export const PORTABLE_SETTINGS_MAX_LENGTH = 1_000_000;
export const PORTABLE_SETTINGS_MAX_MODELS = 5_000;
export const PORTABLE_SETTINGS_MAX_ROUTES = 256;

const ROOT_KEYS = Object.freeze(['format', 'schemaVersion', 'createdAt', 'registry', 'purposeRoutes', 'externalIntegrations']);
const REGISTRY_KEYS = Object.freeze(['schemaVersion', 'models', 'selectedModels']);
const MODEL_KEYS = Object.freeze(['id', 'provider', 'protocol', 'enabled']);
const PURPOSE_ROUTES_KEYS = Object.freeze(['schemaVersion', 'routes']);
const ROUTE_KEYS = Object.freeze(['provider', 'modelId', 'adapterId', 'connectionProfileId']);
const EXTERNAL_INTEGRATION_KEYS = Object.freeze(['schemaVersion', 'mappings', 'selectedModels']);

export class PortableSettingsError extends Error {
    constructor(code, message, issues = []) {
        super(message);
        this.name = 'PortableSettingsError';
        this.code = code;
        this.issues = issues.map(issue => ({ ...issue }));
    }
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneRegistrySettings(value) {
    const normalized = normalizeSettings(value);
    return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        models: normalized.models.map(model => ({
            id: model.id,
            provider: model.provider,
            protocol: model.protocol,
            enabled: model.enabled,
        })),
        selectedModels: Object.fromEntries(Object.entries(normalized.selectedModels)),
    };
}

function clonePurposeRoutes(value) {
    const normalized = normalizePurposeRoutes(value);
    return {
        schemaVersion: PURPOSE_ROUTES_SCHEMA_VERSION,
        routes: Object.fromEntries(Object.entries(normalized.routes).map(([purpose, route]) => {
            const exportedRoute = {
                provider: route.provider,
                modelId: route.modelId,
                adapterId: route.adapterId,
            };
            if (route.connectionProfileId !== undefined) {
                exportedRoute.connectionProfileId = route.connectionProfileId;
            }
            return [purpose, exportedRoute];
        })),
    };
}

function cloneExternalSettings(value) {
    const normalized = normalizeExternalSettings(value);
    return {
        schemaVersion: EXTERNAL_SETTINGS_SCHEMA_VERSION,
        mappings: { ...normalized.mappings },
        selectedModels: Object.fromEntries(
            Object.entries(normalized.selectedModels).map(([targetId, selections]) => [
                targetId,
                { ...selections },
            ]),
        ),
    };
}

function normalizeCreatedAt(value) {
    const date = value instanceof Date ? value : new Date(value ?? Date.now());
    if (Number.isNaN(date.getTime())) {
        throw new PortableSettingsError('created_at_invalid', '백업 생성 시각이 올바르지 않습니다.');
    }
    return date.toISOString();
}

/**
 * 전달받은 객체에서 모델 Registry와 용도별 경로 필드만 새 객체로 복사한다.
 * API 키, 엔드포인트, Service Account, Connection Profile 본문은 읽거나 복사하지 않는다.
 */
export function createPortableSettings(options = {}) {
    if (
        Number.isInteger(options.registrySettings?.schemaVersion)
        && options.registrySettings.schemaVersion > SETTINGS_SCHEMA_VERSION
    ) {
        throw new PortableSettingsError(
            'future_registry_schema',
            `Registry 스키마 v${options.registrySettings.schemaVersion}은 현재 확장에서 내보낼 수 없습니다.`,
        );
    }
    if (
        Number.isInteger(options.purposeRoutes?.schemaVersion)
        && options.purposeRoutes.schemaVersion > PURPOSE_ROUTES_SCHEMA_VERSION
    ) {
        throw new PortableSettingsError(
            'future_routes_schema',
            `용도별 경로 스키마 v${options.purposeRoutes.schemaVersion}은 현재 확장에서 내보낼 수 없습니다.`,
        );
    }
    try {
        normalizeExternalSettings(options.externalSettings);
    } catch (error) {
        throw new PortableSettingsError(
            'future_external_schema',
            error?.message ?? '외부 확장 연결 설정을 내보낼 수 없습니다.',
        );
    }
    return {
        format: PORTABLE_SETTINGS_FORMAT,
        schemaVersion: PORTABLE_SETTINGS_SCHEMA_VERSION,
        createdAt: normalizeCreatedAt(options.createdAt ?? options.now),
        registry: cloneRegistrySettings(options.registrySettings),
        purposeRoutes: clonePurposeRoutes(options.purposeRoutes),
        externalIntegrations: cloneExternalSettings(options.externalSettings),
    };
}

export function stringifyPortableSettings(options = {}, space = 2) {
    const indentation = Number.isInteger(space) ? Math.min(Math.max(space, 0), 8) : 2;
    return JSON.stringify(createPortableSettings(options), null, indentation);
}

function createIssue(severity, code, path, message) {
    return { severity, code, path, message };
}

function addUnknownKeyIssues(issues, value, allowedKeys, path) {
    if (!isRecord(value)) {
        return;
    }
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            issues.push(createIssue(
                'error',
                'unknown_field',
                `${path}.${String(key).slice(0, 128)}`,
                `${path}에 허용되지 않은 필드가 있습니다: ${String(key).slice(0, 128)}`,
            ));
        }
    }
}

function parseInput(input, issues) {
    if (typeof input === 'string') {
        if (input.length > PORTABLE_SETTINGS_MAX_LENGTH) {
            issues.push(createIssue(
                'error',
                'backup_too_large',
                '$',
                `백업 JSON은 ${PORTABLE_SETTINGS_MAX_LENGTH.toLocaleString('ko-KR')}자 이하여야 합니다.`,
            ));
            return null;
        }
        try {
            return JSON.parse(input);
        } catch {
            issues.push(createIssue('error', 'json_invalid', '$', '백업 JSON 형식이 올바르지 않습니다.'));
            return null;
        }
    }

    if (!isRecord(input)) {
        issues.push(createIssue('error', 'backup_root_invalid', '$', '백업 최상위 값은 객체여야 합니다.'));
        return null;
    }

    try {
        const serialized = JSON.stringify(input);
        if (typeof serialized !== 'string') {
            throw new TypeError('직렬화할 수 없음');
        }
        if (serialized.length > PORTABLE_SETTINGS_MAX_LENGTH) {
            issues.push(createIssue(
                'error',
                'backup_too_large',
                '$',
                `백업 JSON은 ${PORTABLE_SETTINGS_MAX_LENGTH.toLocaleString('ko-KR')}자 이하여야 합니다.`,
            ));
            return null;
        }
        return JSON.parse(serialized);
    } catch {
        issues.push(createIssue('error', 'backup_not_serializable', '$', '백업 객체를 안전하게 읽을 수 없습니다.'));
        return null;
    }
}

function validateSchemaVersion(issues, actual, expected, path, label) {
    if (!Number.isInteger(actual)) {
        issues.push(createIssue('error', 'schema_version_invalid', path, `${label} 스키마 버전이 올바르지 않습니다.`));
        return false;
    }
    if (actual > expected) {
        issues.push(createIssue(
            'error',
            'future_schema_unsupported',
            path,
            `${label} 스키마 v${actual}은 이 확장에서 지원하지 않습니다. 확장을 먼저 업데이트해 주세요.`,
        ));
        return false;
    }
    if (actual !== expected) {
        issues.push(createIssue(
            'error',
            'schema_version_unsupported',
            path,
            `${label} 스키마 v${actual}은 이 백업 형식에서 지원하지 않습니다.`,
        ));
        return false;
    }
    return true;
}

function validatePortableSchemaVersion(issues, actual) {
    const path = '$.schemaVersion';
    if (!Number.isInteger(actual)) {
        issues.push(createIssue('error', 'schema_version_invalid', path, '백업 스키마 버전이 올바르지 않습니다.'));
        return false;
    }
    if (actual > PORTABLE_SETTINGS_SCHEMA_VERSION) {
        issues.push(createIssue(
            'error',
            'future_schema_unsupported',
            path,
            `백업 스키마 v${actual}은 이 확장에서 지원하지 않습니다. 확장을 먼저 업데이트해 주세요.`,
        ));
        return false;
    }
    if (![1, PORTABLE_SETTINGS_SCHEMA_VERSION].includes(actual)) {
        issues.push(createIssue(
            'error',
            'schema_version_unsupported',
            path,
            `백업 스키마 v${actual}은 지원하지 않습니다.`,
        ));
        return false;
    }
    if (actual === 1) {
        issues.push(createIssue(
            'warning',
            'backup_schema_migrated',
            path,
            'v0.5 백업을 v0.6 형식으로 가져오며 외부 확장 연결은 빈 상태로 시작합니다.',
        ));
    }
    return true;
}

function validateRegistry(value, issues) {
    const path = '$.registry';
    if (!isRecord(value)) {
        issues.push(createIssue('error', 'registry_invalid', path, 'Registry 백업은 객체여야 합니다.'));
        return null;
    }
    addUnknownKeyIssues(issues, value, REGISTRY_KEYS, path);
    validateSchemaVersion(issues, value.schemaVersion, SETTINGS_SCHEMA_VERSION, `${path}.schemaVersion`, 'Registry');

    if (!Array.isArray(value.models)) {
        issues.push(createIssue('error', 'models_invalid', `${path}.models`, 'Registry models는 배열이어야 합니다.'));
        return null;
    }
    if (value.models.length > PORTABLE_SETTINGS_MAX_MODELS) {
        issues.push(createIssue(
            'error',
            'too_many_models',
            `${path}.models`,
            `모델은 최대 ${PORTABLE_SETTINGS_MAX_MODELS.toLocaleString('ko-KR')}개까지 가져올 수 있습니다.`,
        ));
    }

    const models = [];
    const modelKeys = new Set();
    for (const [index, candidate] of value.models.slice(0, PORTABLE_SETTINGS_MAX_MODELS).entries()) {
        const modelPath = `${path}.models[${index}]`;
        if (!isRecord(candidate)) {
            issues.push(createIssue('error', 'model_invalid', modelPath, `${modelPath}는 객체여야 합니다.`));
            continue;
        }
        addUnknownKeyIssues(issues, candidate, MODEL_KEYS, modelPath);
        const providerId = normalizeProviderId(candidate.provider);
        const validation = validateProviderModelId(providerId, candidate.id);
        if (!validation.ok || candidate.provider !== providerId || candidate.id !== validation.id) {
            issues.push(createIssue(
                'error',
                validation.ok ? 'model_not_canonical' : validation.code,
                modelPath,
                validation.ok ? `${modelPath}의 제공업체 또는 모델 ID가 정규 형식이 아닙니다.` : validation.message,
            ));
            continue;
        }
        const provider = getProvider(providerId);
        if (candidate.protocol !== provider.protocol) {
            issues.push(createIssue(
                'error',
                'protocol_mismatch',
                `${modelPath}.protocol`,
                `${modelPath}의 요청 프로토콜이 현재 제공업체 계약과 다릅니다.`,
            ));
            continue;
        }
        if (typeof candidate.enabled !== 'boolean') {
            issues.push(createIssue(
                'error',
                'enabled_invalid',
                `${modelPath}.enabled`,
                `${modelPath}의 enabled는 true 또는 false여야 합니다.`,
            ));
            continue;
        }
        const key = JSON.stringify([providerId, validation.id]);
        if (modelKeys.has(key)) {
            issues.push(createIssue('error', 'model_duplicate', modelPath, `${modelPath}는 앞의 모델과 중복됩니다.`));
            continue;
        }
        modelKeys.add(key);
        models.push({
            id: validation.id,
            provider: providerId,
            protocol: provider.protocol,
            enabled: candidate.enabled,
        });
    }

    if (!isRecord(value.selectedModels)) {
        issues.push(createIssue(
            'error',
            'selected_models_invalid',
            `${path}.selectedModels`,
            'Registry selectedModels는 객체여야 합니다.',
        ));
        return { schemaVersion: SETTINGS_SCHEMA_VERSION, models, selectedModels: {} };
    }

    const selectedModels = {};
    for (const [candidateProvider, candidateId] of Object.entries(value.selectedModels)) {
        const providerId = normalizeProviderId(candidateProvider);
        const selectionPath = `${path}.selectedModels.${String(candidateProvider).slice(0, 128)}`;
        if (!isSupportedProvider(providerId) || candidateProvider !== providerId || typeof candidateId !== 'string') {
            issues.push(createIssue(
                'error',
                'selection_invalid',
                selectionPath,
                `${selectionPath}의 제공업체 또는 모델 ID가 올바르지 않습니다.`,
            ));
            continue;
        }
        const selectable = models.some(model => (
            model.enabled
            && model.provider === providerId
            && model.id === candidateId
        ));
        if (!selectable) {
            issues.push(createIssue(
                'error',
                'selection_not_registered',
                selectionPath,
                `${selectionPath}는 등록된 활성 모델을 가리켜야 합니다.`,
            ));
            continue;
        }
        selectedModels[providerId] = candidateId;
    }

    return { schemaVersion: SETTINGS_SCHEMA_VERSION, models, selectedModels };
}

function validateRoutes(value, registrySettings, issues) {
    const path = '$.purposeRoutes';
    if (!isRecord(value)) {
        issues.push(createIssue('error', 'purpose_routes_invalid', path, '용도별 경로 백업은 객체여야 합니다.'));
        return null;
    }
    addUnknownKeyIssues(issues, value, PURPOSE_ROUTES_KEYS, path);
    validateSchemaVersion(
        issues,
        value.schemaVersion,
        PURPOSE_ROUTES_SCHEMA_VERSION,
        `${path}.schemaVersion`,
        '용도별 경로',
    );

    if (!isRecord(value.routes)) {
        issues.push(createIssue('error', 'routes_invalid', `${path}.routes`, '용도별 routes는 객체여야 합니다.'));
        return null;
    }
    const entries = Object.entries(value.routes);
    if (entries.length > PORTABLE_SETTINGS_MAX_ROUTES) {
        issues.push(createIssue(
            'error',
            'too_many_routes',
            `${path}.routes`,
            `용도별 경로는 최대 ${PORTABLE_SETTINGS_MAX_ROUTES}개까지 가져올 수 있습니다.`,
        ));
    }

    const routes = {};
    for (const [candidatePurpose, candidateRoute] of entries.slice(0, PORTABLE_SETTINGS_MAX_ROUTES)) {
        const routePath = `${path}.routes.${String(candidatePurpose).slice(0, 128)}`;
        const purposeValidation = validatePurposeId(candidatePurpose);
        if (!purposeValidation.ok || candidatePurpose !== purposeValidation.id) {
            issues.push(createIssue(
                'error',
                purposeValidation.ok ? 'purpose_not_canonical' : purposeValidation.code,
                routePath,
                purposeValidation.ok ? `${routePath}의 용도 ID가 정규 형식이 아닙니다.` : purposeValidation.message,
            ));
            continue;
        }
        if (!isRecord(candidateRoute)) {
            issues.push(createIssue('error', 'route_invalid', routePath, `${routePath}는 객체여야 합니다.`));
            continue;
        }
        addUnknownKeyIssues(issues, candidateRoute, ROUTE_KEYS, routePath);
        const routeValidation = validatePurposeRoute(candidateRoute);
        if (!routeValidation.ok) {
            issues.push(createIssue('error', routeValidation.code, routePath, routeValidation.message));
            continue;
        }
        const canonical = routeValidation.route;
        const routeIsCanonical = candidateRoute.provider === canonical.provider
            && candidateRoute.modelId === canonical.modelId
            && candidateRoute.adapterId === canonical.adapterId
            && candidateRoute.connectionProfileId === canonical.connectionProfileId;
        if (!routeIsCanonical) {
            issues.push(createIssue(
                'error',
                'route_not_canonical',
                routePath,
                `${routePath}의 제공업체·모델·어댑터 값이 정규 형식이 아닙니다.`,
            ));
            continue;
        }
        routes[purposeValidation.id] = routeValidation.route;
        if (registrySettings && !hasEnabledModel(
            registrySettings,
            routeValidation.route.provider,
            routeValidation.route.modelId,
        )) {
            issues.push(createIssue(
                'warning',
                'route_model_not_registered',
                routePath,
                `${routePath}가 가리키는 모델은 현재 Registry에 없습니다. 모델을 등록하기 전까지 실행되지 않습니다.`,
            ));
        }
    }

    return { schemaVersion: PURPOSE_ROUTES_SCHEMA_VERSION, routes };
}

function validateExternalIntegrations(value, issues) {
    const path = '$.externalIntegrations';
    if (!isRecord(value)) {
        issues.push(createIssue('error', 'external_integrations_invalid', path, '외부 확장 연결 백업은 객체여야 합니다.'));
        return null;
    }
    addUnknownKeyIssues(issues, value, EXTERNAL_INTEGRATION_KEYS, path);
    validateSchemaVersion(
        issues,
        value.schemaVersion,
        EXTERNAL_SETTINGS_SCHEMA_VERSION,
        `${path}.schemaVersion`,
        '외부 확장 연결',
    );
    let normalized;
    try {
        normalized = cloneExternalSettings(value);
    } catch {
        issues.push(createIssue(
            'error',
            'external_integrations_invalid',
            path,
            '외부 확장 연결 설정을 정규화할 수 없습니다.',
        ));
        return null;
    }
    const mappingEntries = isRecord(value.mappings) ? Object.entries(value.mappings) : null;
    const mappingsCanonical = Boolean(mappingEntries
        && mappingEntries.length <= EXTERNAL_SETTINGS_MAX_TARGETS
        && mappingEntries.every(([targetId, mode]) => {
            const sourceMode = normalizeProviderId(mode);
            return /^cmr-ext-[a-f0-9]{8}$/.test(targetId)
                && (sourceMode === EXTERNAL_MAPPING_MANUAL
                    || sourceMode === EXTERNAL_MAPPING_DISABLED
                    || isSupportedProvider(sourceMode));
        }));
    const selectedCanonical = isRecord(value.selectedModels)
        && Object.keys(value.selectedModels).length === Object.keys(normalized.selectedModels).length
        && Object.entries(normalized.selectedModels).every(([targetId, selections]) => (
            isRecord(value.selectedModels[targetId])
            && Object.keys(value.selectedModels[targetId]).length === Object.keys(selections).length
            && Object.entries(selections).every(([providerId, modelId]) => (
                value.selectedModels[targetId][providerId] === modelId
            ))
        ));
    if (!mappingsCanonical || !selectedCanonical) {
        issues.push(createIssue(
            'error',
            'external_integrations_not_canonical',
            path,
            '외부 확장 연결의 target ID·제공업체·모델 ID가 정규 형식이 아니거나 허용되지 않은 필드가 있습니다.',
        ));
    }
    return normalized;
}

function summarizeInspection(issues) {
    const errors = issues.filter(issue => issue.severity === 'error');
    const warnings = issues.filter(issue => issue.severity === 'warning');
    const status = errors.length ? 'error' : (warnings.length ? 'warning' : 'ok');
    const summary = status === 'ok'
        ? '백업 형식과 내부 설정이 모두 올바릅니다.'
        : (status === 'warning'
            ? `백업을 가져올 수 있지만 주의 사항 ${warnings.length}개가 있습니다.`
            : `백업을 가져올 수 없습니다. 오류 ${errors.length}개를 수정해 주세요.`);
    return { status, summary, errors, warnings };
}

/**
 * 가져오기 전에 형식·스키마·허용 필드·모델/경로 계약을 검사한다.
 * 오류 결과에는 잘못된 값 자체를 싣지 않아 진단 복사 시 비밀정보가 노출되지 않는다.
 */
export function inspectPortableSettings(input) {
    const issues = [];
    const source = parseInput(input, issues);
    let registry = null;
    let purposeRoutes = null;
    let externalIntegrations = null;

    if (source) {
        if (!isRecord(source)) {
            issues.push(createIssue('error', 'backup_root_invalid', '$', '백업 최상위 값은 객체여야 합니다.'));
        } else {
            addUnknownKeyIssues(issues, source, ROOT_KEYS, '$');
            if (source.format !== PORTABLE_SETTINGS_FORMAT) {
                issues.push(createIssue(
                    'error',
                    'backup_format_invalid',
                    '$.format',
                    'Custom Model Router 백업 파일이 아닙니다.',
                ));
            }
            const portableVersionValid = validatePortableSchemaVersion(issues, source.schemaVersion);
            if (typeof source.createdAt !== 'string' || Number.isNaN(Date.parse(source.createdAt))) {
                issues.push(createIssue(
                    'error',
                    'created_at_invalid',
                    '$.createdAt',
                    '백업 생성 시각이 올바르지 않습니다.',
                ));
            }
            registry = validateRegistry(source.registry, issues);
            purposeRoutes = validateRoutes(source.purposeRoutes, registry, issues);
            externalIntegrations = portableVersionValid && source.schemaVersion === 1
                ? cloneExternalSettings()
                : validateExternalIntegrations(source.externalIntegrations, issues);
        }
    }

    const summary = summarizeInspection(issues);
    const result = {
        ok: summary.errors.length === 0,
        status: summary.status,
        summary: summary.summary,
        errors: summary.errors,
        warnings: summary.warnings,
    };
    if (result.ok) {
        result.value = {
            registry,
            purposeRoutes,
            externalIntegrations,
        };
    }
    return result;
}

export function parsePortableSettings(input) {
    const report = inspectPortableSettings(input);
    if (!report.ok) {
        const code = report.errors[0]?.code ?? 'backup_invalid';
        throw new PortableSettingsError(code, report.summary, report.errors);
    }

    return {
        registrySettings: cloneRegistrySettings(report.value.registry),
        purposeRoutes: clonePurposeRoutes(report.value.purposeRoutes),
        externalSettings: cloneExternalSettings(report.value.externalIntegrations),
        report: {
            status: report.status,
            summary: report.summary,
            warnings: report.warnings.map(issue => ({ ...issue })),
        },
    };
}

function countRecordEntries(value) {
    return isRecord(value) ? Object.keys(value).length : 0;
}

/**
 * 현재 확장 저장값을 복구한다. 미래 스키마는 조용히 낮추지 않고 명시적으로 중단한다.
 */
export function repairSettingsBundle(options = {}) {
    const registrySource = isRecord(options.registrySettings) ? options.registrySettings : {};
    const routesSource = isRecord(options.purposeRoutes) ? options.purposeRoutes : {};
    const registryVersion = registrySource.schemaVersion;
    const routesVersion = routesSource.schemaVersion;
    const errors = [];

    if (Number.isInteger(registryVersion) && registryVersion > SETTINGS_SCHEMA_VERSION) {
        errors.push(createIssue(
            'error',
            'future_registry_schema',
            '$.registrySettings.schemaVersion',
            `Registry 스키마 v${registryVersion}은 현재 확장에서 복구할 수 없습니다.`,
        ));
    }
    if (Number.isInteger(routesVersion) && routesVersion > PURPOSE_ROUTES_SCHEMA_VERSION) {
        errors.push(createIssue(
            'error',
            'future_routes_schema',
            '$.purposeRoutes.schemaVersion',
            `용도별 경로 스키마 v${routesVersion}은 현재 확장에서 복구할 수 없습니다.`,
        ));
    }
    if (errors.length) {
        return {
            ok: false,
            status: 'error',
            summary: '미래 스키마 저장값은 확장을 업데이트한 뒤 다시 시도해 주세요.',
            errors,
            warnings: [],
        };
    }

    const registrySettings = cloneRegistrySettings(registrySource);
    const purposeRoutes = clonePurposeRoutes(routesSource);
    const beforeCounts = {
        models: Array.isArray(registrySource.models) ? registrySource.models.length : 0,
        selections: countRecordEntries(registrySource.selectedModels)
            + (registrySource.selectedModelId ? 1 : 0),
        routes: countRecordEntries(routesSource.routes),
    };
    const afterCounts = {
        models: registrySettings.models.length,
        selections: Object.keys(registrySettings.selectedModels).length,
        routes: Object.keys(purposeRoutes.routes).length,
    };
    const migrated = registryVersion !== SETTINGS_SCHEMA_VERSION
        || routesVersion !== PURPOSE_ROUTES_SCHEMA_VERSION;
    const repaired = Object.keys(beforeCounts).some(key => beforeCounts[key] !== afterCounts[key]);
    const warnings = [];
    if (migrated) {
        warnings.push(createIssue(
            'warning',
            'settings_migrated',
            '$',
            '이전 저장 스키마를 현재 버전으로 이관했습니다.',
        ));
    }
    if (repaired) {
        warnings.push(createIssue(
            'warning',
            'invalid_records_removed',
            '$',
            '손상되거나 중복된 모델·선택·경로 레코드를 제외했습니다.',
        ));
    }

    return {
        ok: true,
        status: warnings.length ? 'warning' : 'ok',
        summary: warnings.length
            ? '저장값을 현재 스키마로 복구했습니다. 변경 내역을 확인해 주세요.'
            : '저장값을 검사했으며 복구할 항목이 없습니다.',
        registrySettings,
        purposeRoutes,
        beforeCounts,
        afterCounts,
        errors: [],
        warnings,
    };
}
