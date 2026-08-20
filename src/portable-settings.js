import {
    SETTINGS_SCHEMA_VERSION,
    VERTEX_PROVIDER,
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
// The structural limits below produce at most about 6 MB even when every
// model ID, route and external selection is filled to its own maximum. Keep a
// bounded margin so every backup successfully created here can be parsed by
// the same version without weakening the import size guard indefinitely.
export const PORTABLE_SETTINGS_MAX_LENGTH = 8_000_000;
export const PORTABLE_SETTINGS_MAX_MODELS = 5_000;
export const PORTABLE_SETTINGS_MAX_ROUTES = 256;
export const SETTINGS_IMPORT_PREVIEW_SCHEMA_VERSION = 1;
export const SETTINGS_REPAIR_DETAILS_SCHEMA_VERSION = 1;

const ROOT_KEYS = Object.freeze(['format', 'schemaVersion', 'createdAt', 'registry', 'purposeRoutes', 'externalIntegrations']);
const REGISTRY_KEYS = Object.freeze(['schemaVersion', 'models', 'selectedModels']);
const MODEL_KEYS = Object.freeze(['id', 'provider', 'protocol', 'enabled']);
const PURPOSE_ROUTES_KEYS = Object.freeze(['schemaVersion', 'routes']);
const ROUTE_KEYS = Object.freeze(['provider', 'modelId', 'adapterId', 'connectionProfileId']);
const EXTERNAL_INTEGRATION_KEYS = Object.freeze(['schemaVersion', 'mappings', 'selectedModels', 'excludedTargets']);

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
        excludedTargets: { ...normalized.excludedTargets },
    };
}

function normalizeCreatedAt(value) {
    const date = value instanceof Date ? value : new Date(value ?? Date.now());
    if (Number.isNaN(date.getTime())) {
        throw new PortableSettingsError('created_at_invalid', '백업 생성 시각이 올바르지 않습니다.');
    }
    return date.toISOString();
}

function getUtf8ByteLength(value) {
    const text = String(value ?? '');
    if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(text).byteLength;
    }
    // JSON.stringify escapes lone surrogates, so encodeURIComponent is safe for
    // serialized portable settings on older runtimes without TextEncoder.
    return encodeURIComponent(text).replace(/%[0-9A-F]{2}|./g, 'x').length;
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
    const portable = {
        format: PORTABLE_SETTINGS_FORMAT,
        schemaVersion: PORTABLE_SETTINGS_SCHEMA_VERSION,
        createdAt: normalizeCreatedAt(options.createdAt ?? options.now),
        registry: cloneRegistrySettings(options.registrySettings),
        purposeRoutes: clonePurposeRoutes(options.purposeRoutes),
        externalIntegrations: cloneExternalSettings(options.externalSettings),
    };
    if (portable.registry.models.length > PORTABLE_SETTINGS_MAX_MODELS) {
        throw new PortableSettingsError(
            'too_many_models',
            `모델은 최대 ${PORTABLE_SETTINGS_MAX_MODELS.toLocaleString('ko-KR')}개까지 내보낼 수 있습니다.`,
        );
    }
    if (Object.keys(portable.purposeRoutes.routes).length > PORTABLE_SETTINGS_MAX_ROUTES) {
        throw new PortableSettingsError(
            'too_many_routes',
            `용도별 경로는 최대 ${PORTABLE_SETTINGS_MAX_ROUTES}개까지 내보낼 수 있습니다.`,
        );
    }
    return portable;
}

export function stringifyPortableSettings(options = {}, space = 2) {
    const indentation = Number.isInteger(space) ? Math.min(Math.max(space, 0), 8) : 2;
    const serialized = JSON.stringify(createPortableSettings(options), null, indentation);
    if (getUtf8ByteLength(serialized) > PORTABLE_SETTINGS_MAX_LENGTH) {
        throw new PortableSettingsError(
            'backup_too_large',
            `백업 JSON은 UTF-8 기준 ${PORTABLE_SETTINGS_MAX_LENGTH.toLocaleString('ko-KR')}바이트 이하여야 합니다.`,
        );
    }
    return serialized;
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
        if (getUtf8ByteLength(input) > PORTABLE_SETTINGS_MAX_LENGTH) {
            issues.push(createIssue(
                'error',
                'backup_too_large',
                '$',
                `백업 JSON은 UTF-8 기준 ${PORTABLE_SETTINGS_MAX_LENGTH.toLocaleString('ko-KR')}바이트 이하여야 합니다.`,
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
        if (getUtf8ByteLength(serialized) > PORTABLE_SETTINGS_MAX_LENGTH) {
            issues.push(createIssue(
                'error',
                'backup_too_large',
                '$',
                `백업 JSON은 UTF-8 기준 ${PORTABLE_SETTINGS_MAX_LENGTH.toLocaleString('ko-KR')}바이트 이하여야 합니다.`,
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
    const externalSchemaVersion = value.schemaVersion;
    if (!Number.isInteger(externalSchemaVersion)) {
        issues.push(createIssue(
            'error',
            'schema_version_invalid',
            `${path}.schemaVersion`,
            '외부 확장 연결 스키마 버전이 올바르지 않습니다.',
        ));
    } else if (externalSchemaVersion > EXTERNAL_SETTINGS_SCHEMA_VERSION) {
        issues.push(createIssue(
            'error',
            'future_schema_unsupported',
            `${path}.schemaVersion`,
            `외부 확장 연결 스키마 v${externalSchemaVersion}은 이 확장에서 지원하지 않습니다. 확장을 먼저 업데이트해 주세요.`,
        ));
    } else if (externalSchemaVersion < 1) {
        issues.push(createIssue(
            'error',
            'schema_version_unsupported',
            `${path}.schemaVersion`,
            `외부 확장 연결 스키마 v${externalSchemaVersion}은 이 백업 형식에서 지원하지 않습니다.`,
        ));
    }
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
        && (externalSchemaVersion === EXTERNAL_SETTINGS_SCHEMA_VERSION
            ? mappingEntries.length === 0
            : mappingEntries.every(([targetId, mode]) => {
                const sourceMode = normalizeProviderId(mode);
                return /^cmr-ext-[a-f0-9]{8}$/.test(targetId)
                    && (sourceMode === EXTERNAL_MAPPING_MANUAL
                        || sourceMode === EXTERNAL_MAPPING_DISABLED
                        || isSupportedProvider(sourceMode));
            })));
    const selectedCanonical = isRecord(value.selectedModels)
        && Object.keys(value.selectedModels).length === Object.keys(normalized.selectedModels).length
        && Object.entries(normalized.selectedModels).every(([targetId, selections]) => (
            isRecord(value.selectedModels[targetId])
            && Object.keys(value.selectedModels[targetId]).length === Object.keys(selections).length
            && Object.entries(selections).every(([providerId, modelId]) => (
                value.selectedModels[targetId][providerId] === modelId
            ))
        ));
    const excludedCanonical = externalSchemaVersion === 1
        ? value.excludedTargets === undefined && Object.keys(normalized.excludedTargets).length === 0
        : isRecord(value.excludedTargets)
            && Object.keys(value.excludedTargets).length === Object.keys(normalized.excludedTargets).length
            && Object.entries(normalized.excludedTargets).every(([targetId, excluded]) => (
                value.excludedTargets[targetId] === excluded
            ));
    if (!mappingsCanonical || !selectedCanonical || !excludedCanonical) {
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

function compareText(left, right) {
    return String(left).localeCompare(String(right), 'en');
}

function createModelIdentity(model) {
    return {
        provider: model.provider,
        modelId: model.id,
    };
}

function createModelMap(settings) {
    return new Map(settings.models.map(model => [
        JSON.stringify([model.provider, model.id]),
        model,
    ]));
}

function compareRegistryModels(current, imported) {
    const currentModels = createModelMap(current);
    const importedModels = createModelMap(imported);
    const additions = [];
    const conflicts = [];
    const deletions = [];

    for (const [key, model] of importedModels) {
        const previous = currentModels.get(key);
        if (!previous) {
            additions.push(createModelIdentity(model));
            continue;
        }
        const changedKeys = ['protocol', 'enabled'].filter(field => previous[field] !== model[field]);
        if (changedKeys.length) {
            conflicts.push({ ...createModelIdentity(model), changedKeys });
        }
    }
    for (const [key, model] of currentModels) {
        if (!importedModels.has(key)) {
            deletions.push(createModelIdentity(model));
        }
    }

    const sortModels = (left, right) => (
        compareText(left.provider, right.provider) || compareText(left.modelId, right.modelId)
    );
    additions.sort(sortModels);
    conflicts.sort(sortModels);
    deletions.sort(sortModels);
    return { additions, conflicts, deletions };
}

function compareRegistrySelections(current, imported) {
    const additions = [];
    const conflicts = [];
    const deletions = [];
    const providers = new Set([
        ...Object.keys(current.selectedModels),
        ...Object.keys(imported.selectedModels),
    ]);

    for (const provider of [...providers].sort(compareText)) {
        const currentModelId = current.selectedModels[provider];
        const importedModelId = imported.selectedModels[provider];
        if (currentModelId === undefined) {
            additions.push({ provider, modelId: importedModelId });
        } else if (importedModelId === undefined) {
            deletions.push({ provider, modelId: currentModelId });
        } else if (currentModelId !== importedModelId) {
            conflicts.push({ provider, currentModelId, importedModelId });
        }
    }
    return { additions, conflicts, deletions };
}

function routeKeys(route) {
    return ROUTE_KEYS.filter(key => Object.hasOwn(route, key));
}

function comparePurposeRoutes(current, imported) {
    const additions = [];
    const conflicts = [];
    const deletions = [];
    const purposes = new Set([
        ...Object.keys(current.routes),
        ...Object.keys(imported.routes),
    ]);

    for (const purpose of [...purposes].sort(compareText)) {
        const currentRoute = current.routes[purpose];
        const importedRoute = imported.routes[purpose];
        if (!currentRoute) {
            additions.push({ purpose, keys: routeKeys(importedRoute) });
            continue;
        }
        if (!importedRoute) {
            deletions.push({ purpose, keys: routeKeys(currentRoute) });
            continue;
        }
        const changedKeys = ROUTE_KEYS.filter(key => currentRoute[key] !== importedRoute[key]);
        if (changedKeys.length) {
            conflicts.push({ purpose, changedKeys });
        }
    }
    return { additions, conflicts, deletions };
}

function createExternalTargetStates(settings) {
    const targetIds = new Set([
        ...Object.keys(settings.selectedModels),
        ...Object.keys(settings.excludedTargets),
    ]);
    return new Map([...targetIds].map(targetId => [targetId, {
        selections: Object.entries(settings.selectedModels[targetId] ?? {})
            .sort(([left], [right]) => compareText(left, right)),
        excluded: settings.excludedTargets[targetId] === true,
    }]));
}

function countExternalSettings(settings) {
    const targets = createExternalTargetStates(settings);
    return {
        targets: targets.size,
        selectedTargets: Object.keys(settings.selectedModels).length,
        selections: Object.values(settings.selectedModels)
            .reduce((total, selections) => total + Object.keys(selections).length, 0),
        excludedTargets: Object.keys(settings.excludedTargets).length,
    };
}

function compareExternalSettings(current, imported) {
    const currentTargets = createExternalTargetStates(current);
    const importedTargets = createExternalTargetStates(imported);
    let targetAdditions = 0;
    let targetConflicts = 0;
    let targetDeletions = 0;
    let selectionAdditions = 0;
    let selectionConflicts = 0;
    let selectionDeletions = 0;
    let exclusionAdditions = 0;
    let exclusionDeletions = 0;

    for (const [targetId, importedState] of importedTargets) {
        const currentState = currentTargets.get(targetId);
        if (!currentState) {
            targetAdditions += 1;
        } else if (JSON.stringify(currentState) !== JSON.stringify(importedState)) {
            targetConflicts += 1;
        }
    }
    for (const targetId of currentTargets.keys()) {
        if (!importedTargets.has(targetId)) {
            targetDeletions += 1;
        }
    }

    const currentSelections = new Map();
    const importedSelections = new Map();
    for (const [targetId, selections] of Object.entries(current.selectedModels)) {
        for (const [provider, modelId] of Object.entries(selections)) {
            currentSelections.set(JSON.stringify([targetId, provider]), modelId);
        }
    }
    for (const [targetId, selections] of Object.entries(imported.selectedModels)) {
        for (const [provider, modelId] of Object.entries(selections)) {
            importedSelections.set(JSON.stringify([targetId, provider]), modelId);
        }
    }
    for (const [key, modelId] of importedSelections) {
        if (!currentSelections.has(key)) {
            selectionAdditions += 1;
        } else if (currentSelections.get(key) !== modelId) {
            selectionConflicts += 1;
        }
    }
    for (const key of currentSelections.keys()) {
        if (!importedSelections.has(key)) {
            selectionDeletions += 1;
        }
    }
    for (const targetId of Object.keys(imported.excludedTargets)) {
        if (!Object.hasOwn(current.excludedTargets, targetId)) {
            exclusionAdditions += 1;
        }
    }
    for (const targetId of Object.keys(current.excludedTargets)) {
        if (!Object.hasOwn(imported.excludedTargets, targetId)) {
            exclusionDeletions += 1;
        }
    }

    return {
        currentCounts: countExternalSettings(current),
        importedCounts: countExternalSettings(imported),
        changes: {
            targets: {
                additions: targetAdditions,
                conflicts: targetConflicts,
                deletions: targetDeletions,
            },
            selections: {
                additions: selectionAdditions,
                conflicts: selectionConflicts,
                deletions: selectionDeletions,
            },
            exclusions: {
                additions: exclusionAdditions,
                conflicts: 0,
                deletions: exclusionDeletions,
            },
        },
    };
}

function changeSetHasEntries(changeSet) {
    return changeSet.additions.length > 0
        || changeSet.conflicts.length > 0
        || changeSet.deletions.length > 0;
}

function countChangeSet(changeSet) {
    return changeSet.additions.length + changeSet.conflicts.length + changeSet.deletions.length;
}

/**
 * 검증·정규화를 마친 현재/가져오기 설정만 비교한다. 모델 ID 외의 경로 값은
 * 노출하지 않고 외부 target은 원문 식별자 대신 개수만 반환한다.
 */
export function createSettingsImportPreview(options = {}) {
    const currentRegistry = cloneRegistrySettings(options.currentRegistrySettings);
    const importedRegistry = cloneRegistrySettings(options.importedRegistrySettings);
    const currentRoutes = clonePurposeRoutes(options.currentPurposeRoutes);
    const importedRoutes = clonePurposeRoutes(options.importedPurposeRoutes);
    const currentExternal = cloneExternalSettings(options.currentExternalSettings);
    const importedExternal = cloneExternalSettings(options.importedExternalSettings);
    const models = compareRegistryModels(currentRegistry, importedRegistry);
    const selections = compareRegistrySelections(currentRegistry, importedRegistry);
    const routes = comparePurposeRoutes(currentRoutes, importedRoutes);
    const external = compareExternalSettings(currentExternal, importedExternal);
    // `targets` is derived from selections/exclusions. Counting both would report the
    // same external record twice, so the headline uses only the concrete records.
    const externalSummary = [external.changes.selections, external.changes.exclusions]
        .reduce((summary, changes) => ({
        additions: summary.additions + changes.additions,
        conflicts: summary.conflicts + changes.conflicts,
        deletions: summary.deletions + changes.deletions,
        }), { additions: 0, conflicts: 0, deletions: 0 });
    const externalChangeCount = Object.values(external.changes).reduce((total, changes) => (
        total + changes.additions + changes.conflicts + changes.deletions
    ), 0);
    const hasChanges = changeSetHasEntries(models)
        || changeSetHasEntries(selections)
        || changeSetHasEntries(routes)
        || externalChangeCount > 0;

    return {
        schemaVersion: SETTINGS_IMPORT_PREVIEW_SCHEMA_VERSION,
        status: hasChanges ? 'changes' : 'no-change',
        hasChanges,
        summary: {
            additions: models.additions.length
                + selections.additions.length
                + routes.additions.length
                + externalSummary.additions,
            conflicts: models.conflicts.length
                + selections.conflicts.length
                + routes.conflicts.length
                + externalSummary.conflicts,
            deletions: models.deletions.length
                + selections.deletions.length
                + routes.deletions.length
                + externalSummary.deletions,
        },
        registry: {
            models,
            selections,
            changeCount: countChangeSet(models) + countChangeSet(selections),
        },
        routes: {
            ...routes,
            changeCount: countChangeSet(routes),
        },
        external,
    };
}

/**
 * portable 원문을 기존 원자 검증기로 먼저 검사한 뒤 안전한 미리보기만 반환한다.
 * invalid/future schema는 parsePortableSettings와 동일한 오류로 중단한다.
 */
export function previewPortableSettingsImport(input, current = {}) {
    const parsed = parsePortableSettings(input);
    const preview = createSettingsImportPreview({
        currentRegistrySettings: current.registrySettings,
        currentPurposeRoutes: current.purposeRoutes,
        currentExternalSettings: current.externalSettings,
        importedRegistrySettings: parsed.registrySettings,
        importedPurposeRoutes: parsed.purposeRoutes,
        importedExternalSettings: parsed.externalSettings,
    });
    return {
        ...preview,
        importStatus: parsed.report.status,
        warningCodes: parsed.report.warnings.map(issue => issue.code),
    };
}

function countRecordEntries(value) {
    return isRecord(value) ? Object.keys(value).length : 0;
}

function countRegistrySelections(value) {
    const selectedModels = isRecord(value?.selectedModels) ? value.selectedModels : {};
    const legacySelection = value?.selectedModelId;
    const currentVertexSelection = Object.hasOwn(selectedModels, VERTEX_PROVIDER)
        ? selectedModels[VERTEX_PROVIDER]
        : undefined;
    const legacyIsDistinct = Boolean(legacySelection)
        && currentVertexSelection !== legacySelection;
    return Object.keys(selectedModels).length + (legacyIsDistinct ? 1 : 0);
}

function createRepairDetailCollector() {
    const records = new Map();
    return {
        add(code, action, pathCategory, count = 1) {
            if (!Number.isInteger(count) || count <= 0) {
                return;
            }
            const key = JSON.stringify([code, action, pathCategory]);
            const current = records.get(key) ?? { code, action, pathCategory, count: 0 };
            current.count += count;
            records.set(key, current);
        },
        finish() {
            const items = [...records.values()].sort((left, right) => (
                compareText(left.pathCategory, right.pathCategory)
                || compareText(left.action, right.action)
                || compareText(left.code, right.code)
            ));
            const totals = { removed: 0, changed: 0, rejected: 0 };
            for (const item of items) {
                totals[item.action] += item.count;
            }
            return {
                schemaVersion: SETTINGS_REPAIR_DETAILS_SCHEMA_VERSION,
                totals,
                items,
            };
        },
    };
}

function countUnknownFields(value, allowedKeys) {
    if (!isRecord(value)) {
        return 0;
    }
    const allowed = new Set(allowedKeys);
    return Object.keys(value).filter(key => !allowed.has(key)).length;
}

function isLegacyRegistrySettings(source) {
    return source.schemaVersion === 1
        || (
            source.schemaVersion === undefined
            && Object.hasOwn(source, 'selectedModelId')
            && !Object.hasOwn(source, 'selectedModels')
        );
}

function classifySchemaRepair(source, currentVersion, legacySchema = false) {
    if (legacySchema) {
        return 'migrated';
    }
    if (Object.keys(source).length > 0 && source.schemaVersion !== currentVersion) {
        return 'normalized';
    }
    return null;
}

function analyzeRegistryRepair(source, normalized, details) {
    const legacySchema = isLegacyRegistrySettings(source);
    details.add(
        'registry_unknown_fields_removed',
        'removed',
        'registry',
        countUnknownFields(source, [...REGISTRY_KEYS, 'selectedModelId']),
    );
    const schemaRepair = classifySchemaRepair(source, SETTINGS_SCHEMA_VERSION, legacySchema);
    if (schemaRepair === 'migrated') {
        details.add('schema_migrated', 'changed', 'registry.schema', 1);
    } else if (schemaRepair === 'normalized') {
        details.add('schema_normalized', 'changed', 'registry.schema', 1);
    }

    if (!Array.isArray(source.models)) {
        if (source.models !== undefined) {
            details.add('models_container_replaced', 'changed', 'registry.models', 1);
        }
    } else {
        const seenModels = new Set();
        for (const candidate of source.models) {
            if (!isRecord(candidate)) {
                details.add('model_invalid_removed', 'removed', 'registry.models', 1);
                continue;
            }
            const providerId = legacySchema
                ? VERTEX_PROVIDER
                : normalizeProviderId(candidate.provider);
            const validation = validateProviderModelId(providerId, candidate.id);
            if (!isSupportedProvider(providerId) || !validation.ok) {
                details.add('model_invalid_removed', 'removed', 'registry.models', 1);
                continue;
            }
            const key = JSON.stringify([providerId, validation.id]);
            if (seenModels.has(key)) {
                details.add('model_duplicate_merged', 'removed', 'registry.models', 1);
                continue;
            }
            seenModels.add(key);
            if (legacySchema) {
                details.add(
                    'model_unknown_fields_removed',
                    'removed',
                    'registry.models',
                    countUnknownFields(candidate, ['id']),
                );
                continue;
            }
            const provider = getProvider(providerId);
            const canonical = {
                id: validation.id,
                provider: providerId,
                protocol: provider.protocol,
                enabled: candidate.enabled !== false,
            };
            const knownValueChanged = MODEL_KEYS.some(field => candidate[field] !== canonical[field]);
            const unknownFieldCount = countUnknownFields(candidate, MODEL_KEYS);
            if (knownValueChanged) {
                details.add('model_record_normalized', 'changed', 'registry.models', 1);
            }
            details.add(
                'model_unknown_fields_removed',
                'removed',
                'registry.models',
                unknownFieldCount,
            );
        }
    }

    const selectedSource = isRecord(source.selectedModels) ? source.selectedModels : {};
    if (source.selectedModels !== undefined && !isRecord(source.selectedModels)) {
        details.add('selections_container_replaced', 'changed', 'registry.selections', 1);
    }
    const selectionCandidates = Object.entries(selectedSource).map(([provider, modelId]) => ({
        provider,
        modelId,
        legacy: false,
    }));
    const hasVertexSelection = Object.hasOwn(selectedSource, VERTEX_PROVIDER);
    if (!hasVertexSelection && source.selectedModelId !== undefined) {
        selectionCandidates.push({
            provider: VERTEX_PROVIDER,
            modelId: source.selectedModelId,
            legacy: true,
        });
    } else if (hasVertexSelection
        && source.selectedModelId
        && selectedSource[VERTEX_PROVIDER] !== source.selectedModelId) {
        details.add('legacy_selection_conflict_removed', 'removed', 'registry.selections', 1);
    }
    const seenProviders = new Set();
    for (const candidate of selectionCandidates) {
        const providerId = normalizeProviderId(candidate.provider);
        const validation = validateProviderModelId(providerId, candidate.modelId);
        const selectable = validation.ok && normalized.models.some(model => (
            model.enabled && model.provider === providerId && model.id === validation.id
        ));
        if (!isSupportedProvider(providerId) || !validation.ok || !selectable) {
            details.add('selection_invalid_removed', 'removed', 'registry.selections', 1);
            continue;
        }
        if (seenProviders.has(providerId)) {
            details.add('selection_duplicate_merged', 'removed', 'registry.selections', 1);
            continue;
        }
        seenProviders.add(providerId);
        if (!candidate.legacy
            && (candidate.provider !== providerId || candidate.modelId !== validation.id)) {
            details.add('selection_record_normalized', 'changed', 'registry.selections', 1);
        }
    }
}

function analyzeRoutesRepair(source, details) {
    details.add(
        'routes_unknown_fields_removed',
        'removed',
        'routes',
        countUnknownFields(source, PURPOSE_ROUTES_KEYS),
    );
    if (classifySchemaRepair(source, PURPOSE_ROUTES_SCHEMA_VERSION) === 'normalized') {
        details.add('schema_normalized', 'changed', 'routes.schema', 1);
    }
    if (!isRecord(source.routes)) {
        if (source.routes !== undefined) {
            details.add('routes_container_replaced', 'changed', 'routes.entries', 1);
        }
        return;
    }

    const seenPurposes = new Set();
    for (const [candidatePurpose, candidateRoute] of Object.entries(source.routes)) {
        const purposeValidation = validatePurposeId(candidatePurpose);
        const routeValidation = validatePurposeRoute(candidateRoute);
        if (!purposeValidation.ok || !routeValidation.ok) {
            details.add('route_invalid_removed', 'removed', 'routes.entries', 1);
            continue;
        }
        if (seenPurposes.has(purposeValidation.id)) {
            details.add('route_duplicate_merged', 'removed', 'routes.entries', 1);
            continue;
        }
        seenPurposes.add(purposeValidation.id);
        const canonical = routeValidation.route;
        const knownValueChanged = candidatePurpose !== purposeValidation.id
            || ROUTE_KEYS.some(field => candidateRoute[field] !== canonical[field]);
        if (knownValueChanged) {
            details.add('route_record_normalized', 'changed', 'routes.entries', 1);
        }
        details.add(
            'route_unknown_fields_removed',
            'removed',
            'routes.entries',
            countUnknownFields(candidateRoute, ROUTE_KEYS),
        );
    }
}

function createRepairDetails(registrySource, routesSource, registrySettings, rootRepairs = {}) {
    const details = createRepairDetailCollector();
    if (rootRepairs.registry === true) {
        details.add('registry_container_replaced', 'changed', 'registry', 1);
    }
    if (rootRepairs.routes === true) {
        details.add('routes_root_container_replaced', 'changed', 'routes', 1);
    }
    analyzeRegistryRepair(registrySource, registrySettings, details);
    analyzeRoutesRepair(routesSource, details);
    return details.finish();
}

function createRejectedRepairDetails(errors) {
    const details = createRepairDetailCollector();
    for (const issue of errors) {
        const pathCategory = issue.code === 'future_registry_schema'
            ? 'registry.schema'
            : 'routes.schema';
        details.add(issue.code, 'rejected', pathCategory, 1);
    }
    return details.finish();
}

/**
 * 현재 확장 저장값을 복구한다. 미래 스키마는 조용히 낮추지 않고 명시적으로 중단한다.
 */
export function repairSettingsBundle(options = {}) {
    const rawRegistrySettings = options.registrySettings;
    const rawPurposeRoutes = options.purposeRoutes;
    const registrySource = isRecord(rawRegistrySettings) ? rawRegistrySettings : {};
    const routesSource = isRecord(rawPurposeRoutes) ? rawPurposeRoutes : {};
    const rootRepairs = {
        registry: rawRegistrySettings !== undefined && !isRecord(rawRegistrySettings),
        routes: rawPurposeRoutes !== undefined && !isRecord(rawPurposeRoutes),
    };
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
            details: createRejectedRepairDetails(errors),
        };
    }

    const registrySettings = cloneRegistrySettings(registrySource);
    const purposeRoutes = clonePurposeRoutes(routesSource);
    const details = createRepairDetails(
        registrySource,
        routesSource,
        registrySettings,
        rootRepairs,
    );
    const beforeCounts = {
        models: Array.isArray(registrySource.models) ? registrySource.models.length : 0,
        selections: countRegistrySelections(registrySource),
        routes: countRecordEntries(routesSource.routes),
    };
    const afterCounts = {
        models: registrySettings.models.length,
        selections: Object.keys(registrySettings.selectedModels).length,
        routes: Object.keys(purposeRoutes.routes).length,
    };
    const migrated = details.items.some(item => item.code === 'schema_migrated');
    const removed = details.totals.removed > 0
        || Object.keys(beforeCounts).some(key => beforeCounts[key] > afterCounts[key]);
    const repaired = Object.keys(beforeCounts).some(key => beforeCounts[key] !== afterCounts[key])
        || details.items.some(item => item.code !== 'schema_migrated');
    const warnings = [];
    if (migrated) {
        warnings.push(createIssue(
            'warning',
            'settings_migrated',
            '$',
            '이전 저장 스키마를 현재 버전으로 이관했습니다.',
        ));
    }
    if (removed) {
        warnings.push(createIssue(
            'warning',
            'invalid_records_removed',
            '$',
            '손상되거나 중복된 모델·선택·경로 레코드를 제외했습니다.',
        ));
    } else if (repaired) {
        warnings.push(createIssue(
            'warning',
            'settings_normalized',
            '$',
            '저장된 모델·선택·경로 값을 현재 규칙에 맞게 정규화했습니다.',
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
        details,
        errors: [],
        warnings,
    };
}
