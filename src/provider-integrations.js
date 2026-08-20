import {
    SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
    createSillyTavernConnectionProfileAdapter,
} from './connection-profile-adapter.js';
import {
    getProvider,
    normalizeProviderId,
    normalizeProviderModelId,
} from './providers.js';
import {
    getEnabledModels,
    hasEnabledModel,
} from './registry.js';

export const PROVIDER_INTEGRATION_API_VERSION = '1.0.0';
export const PROVIDER_INTEGRATION_READY_EVENT = 'custom-model-router:provider-integrations-ready';
export const PROVIDER_INTEGRATION_INPUT_SCHEMA = 'cmr.chat-completion/1';
export const PROVIDER_INTEGRATION_OWNED_ATTRIBUTE = 'data-cmr-provider-hook-owned';
export const PROVIDER_INTEGRATION_STRATEGIES = Object.freeze({
    SILLYTAVERN_INHERITED: 'sillytavern-inherited',
    OPENAI_COMPATIBLE: 'openai-compatible',
});

const CONSUMER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SLOT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_CONSUMERS = 64;
const MAX_SLOTS = 16;
const DEFAULT_RECEIPT_DISPOSE_TIMEOUT_MS = 1_000;
const ALLOWED_REQUEST_KEYS = new Set([
    'modelId',
    'prompt',
    'messages',
    'maxTokens',
    'stream',
    'extractData',
]);
const ALLOWED_MESSAGE_KEYS = new Set([
    'role',
    'content',
    'name',
    'tool_call_id',
]);
const ALLOWED_MESSAGE_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
export const PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES = Object.freeze({
    inputSchema: PROVIDER_INTEGRATION_INPUT_SCHEMA,
    handlerInstall: 'before-model-publish',
    providerScopedModels: true,
    abortSignal: true,
    streaming: true,
    credentialMode: 'opaque-reference',
    endpointOverride: false,
    mainChatMutation: false,
    silentFallback: false,
    dispose: true,
});
const HANDLER_CAPABILITIES = Object.freeze({
    inputSchema: PROVIDER_INTEGRATION_INPUT_SCHEMA,
    abortSignal: true,
    streaming: true,
    credentialMode: 'opaque-reference',
    mainChatMutation: false,
    silentFallback: false,
});
const SAFE_ERROR_MESSAGES = Object.freeze({
    consumer_callback_failed: '외부 provider consumer 콜백 처리 중 오류가 발생했습니다.',
    consumer_dispose_failed: '외부 provider consumer 자원 정리 중 오류가 발생했습니다.',
    consumer_dispose_timeout: '외부 provider consumer 자원 정리 시간이 초과되었습니다.',
    consumer_listener_failed: '외부 provider integration 이벤트 처리 중 오류가 발생했습니다.',
    reconcile_failed: '공용 provider binding 동기화 중 오류가 발생했습니다.',
});
const SAFE_BINDING_FAILURE_CODES = new Set([
    'handler_receipt_invalid',
    'publication_receipt_invalid',
]);

export class ProviderIntegrationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ProviderIntegrationError';
        this.code = code;
    }
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Freeze only CMR-owned JSON-like values. Never pass platform objects here. */
function deepFreezeOwned(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) {
        return value;
    }
    seen.add(value);
    for (const child of Object.values(value)) {
        deepFreezeOwned(child, seen);
    }
    return Object.freeze(value);
}

function parseVersion(value) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ''));
    return match ? match.slice(1).map(Number) : null;
}

export function isProviderIntegrationApiCompatible(
    requiredVersion,
    actualVersion = PROVIDER_INTEGRATION_API_VERSION,
) {
    const required = parseVersion(requiredVersion);
    const actual = parseVersion(actualVersion);
    if (!required || !actual || required[0] !== actual[0]) {
        return false;
    }
    for (let index = 1; index < actual.length; index += 1) {
        if (required[index] !== actual[index]) {
            return actual[index] > required[index];
        }
    }
    return true;
}

function normalizeIdentifier(value, pattern, code, label) {
    const id = String(value ?? '').trim().toLowerCase();
    if (!pattern.test(id)) {
        throw new ProviderIntegrationError(code, `${label} 형식이 올바르지 않습니다.`);
    }
    return id;
}

function normalizeStrategies(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new ProviderIntegrationError(
            'consumer_strategies_invalid',
            'consumer slot에는 하나 이상의 공용 adapter 전략이 필요합니다.',
        );
    }
    const allowed = new Set(Object.values(PROVIDER_INTEGRATION_STRATEGIES));
    const strategies = [...new Set(value.map(item => String(item ?? '').trim()))];
    if (strategies.some(strategy => !allowed.has(strategy))) {
        throw new ProviderIntegrationError(
            'consumer_strategy_unsupported',
            '지원하지 않는 공용 provider adapter 전략입니다.',
        );
    }
    return Object.freeze(strategies);
}

function normalizeConsumerDescriptor(value) {
    if (!isRecord(value)) {
        throw new ProviderIntegrationError('consumer_invalid', 'provider consumer 형식이 올바르지 않습니다.');
    }
    if (!isProviderIntegrationApiCompatible(value.contractVersion)) {
        throw new ProviderIntegrationError(
            'consumer_contract_incompatible',
            'provider consumer 계약 버전이 호환되지 않습니다.',
        );
    }
    const consumerId = normalizeIdentifier(
        value.consumerId,
        CONSUMER_ID_PATTERN,
        'consumer_id_invalid',
        'consumer ID',
    );
    if (!isRecord(value.capabilities)) {
        throw new ProviderIntegrationError(
            'consumer_capabilities_invalid',
            'provider consumer capability 형식이 올바르지 않습니다.',
        );
    }
    const capabilityKeys = Object.keys(value.capabilities);
    if (capabilityKeys.length !== Object.keys(PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES).length
        || capabilityKeys.some(key => !Object.hasOwn(PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES, key))) {
        throw new ProviderIntegrationError(
            'consumer_capability_mismatch',
            'provider consumer capability 목록이 안전 계약과 일치하지 않습니다.',
        );
    }
    for (const [key, expected] of Object.entries(PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES)) {
        if (value.capabilities[key] !== expected) {
            throw new ProviderIntegrationError(
                'consumer_capability_mismatch',
                `provider consumer capability '${key}'가 안전 계약과 일치하지 않습니다.`,
            );
        }
    }
    if (!Array.isArray(value.slots) || value.slots.length === 0 || value.slots.length > MAX_SLOTS) {
        throw new ProviderIntegrationError(
            'consumer_slots_invalid',
            `provider consumer slot은 1개 이상 ${MAX_SLOTS}개 이하여야 합니다.`,
        );
    }
    const slotIds = new Set();
    const slots = value.slots.map(slot => {
        if (!isRecord(slot)) {
            throw new ProviderIntegrationError('consumer_slot_invalid', 'provider consumer slot 형식이 올바르지 않습니다.');
        }
        const slotId = normalizeIdentifier(slot.slotId, SLOT_ID_PATTERN, 'slot_id_invalid', 'slot ID');
        if (slotIds.has(slotId)) {
            throw new ProviderIntegrationError('slot_duplicate', '같은 slot ID를 중복 등록할 수 없습니다.');
        }
        slotIds.add(slotId);
        return Object.freeze({
            slotId,
            strategies: normalizeStrategies(slot.strategies),
        });
    });
    return Object.freeze({
        consumerId,
        label: String(value.label ?? consumerId).trim().slice(0, 80) || consumerId,
        contractVersion: String(value.contractVersion),
        capabilities: deepFreezeOwned({ ...PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES }),
        slots: Object.freeze(slots),
    });
}

function normalizeConsumerHooks(value) {
    if (!isRecord(value)
        || typeof value.installHandler !== 'function'
        || typeof value.publishModels !== 'function') {
        throw new ProviderIntegrationError(
            'consumer_hooks_invalid',
            'consumer hook에는 installHandler와 publishModels 함수가 필요합니다.',
        );
    }
    return Object.freeze({
        installHandler: value.installHandler,
        publishModels: value.publishModels,
    });
}

function getConnectionService(context) {
    if (!context || !isRecord(context.extensionSettings)) {
        throw new ProviderIntegrationError('context_unavailable', 'SillyTavern context를 사용할 수 없습니다.');
    }
    if (Array.isArray(context.extensionSettings.disabledExtensions)
        && context.extensionSettings.disabledExtensions.includes('connection-manager')) {
        throw new ProviderIntegrationError(
            'connection_manager_unavailable',
            'SillyTavern Connection Manager가 비활성화되어 있습니다.',
        );
    }
    const service = context.ConnectionManagerRequestService;
    const required = ['getProfile', 'validateProfile', 'sendRequest'];
    if (required.some(method => typeof service?.[method] !== 'function')) {
        throw new ProviderIntegrationError(
            'connection_manager_unavailable',
            'SillyTavern Connection Manager 공개 요청 API를 사용할 수 없습니다.',
        );
    }
    return service;
}

function resolveSelectedConnection(getContext) {
    const context = getContext();
    const service = getConnectionService(context);
    const profileId = String(context.extensionSettings?.connectionManager?.selectedProfile ?? '').trim();
    if (!profileId) {
        throw new ProviderIntegrationError(
            'connection_profile_not_selected',
            '선택된 SillyTavern Connection Profile이 없습니다.',
        );
    }
    let profile;
    let apiMap;
    try {
        profile = service.getProfile(profileId);
        apiMap = service.validateProfile(profile);
    } catch {
        throw new ProviderIntegrationError(
            'connection_profile_invalid',
            '선택된 SillyTavern Connection Profile을 사용할 수 없습니다.',
        );
    }
    if (apiMap?.selected !== 'openai') {
        throw new ProviderIntegrationError(
            'connection_profile_unsupported',
            '선택된 Connection Profile은 Chat Completion 요청을 지원하지 않습니다.',
        );
    }
    const providerId = normalizeProviderId(apiMap?.source);
    const provider = getProvider(providerId);
    if (!provider) {
        throw new ProviderIntegrationError(
            'connection_profile_provider_unsupported',
            '선택된 Connection Profile의 제공업체는 CMR Registry에서 지원하지 않습니다.',
        );
    }
    return Object.freeze({
        profileId,
        providerId,
        provider,
    });
}

function createPublicModel(model) {
    return Object.freeze({
        provider: model.provider,
        id: model.id,
        protocol: model.protocol,
    });
}

function assertDataProperties(value, code) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some(descriptor => (
        typeof descriptor.get === 'function' || typeof descriptor.set === 'function'
    ))) {
        throw new ProviderIntegrationError(code, '공용 provider 요청에는 getter 또는 setter를 사용할 수 없습니다.');
    }
}

function normalizeMessages(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new ProviderIntegrationError(
            'request_messages_invalid',
            'messages는 하나 이상의 단순 Chat Completion 메시지여야 합니다.',
        );
    }
    return value.map(message => {
        if (!isRecord(message)) {
            throw new ProviderIntegrationError('request_message_invalid', '각 message는 객체여야 합니다.');
        }
        assertDataProperties(message, 'request_message_accessor_not_allowed');
        if (Object.keys(message).some(key => !ALLOWED_MESSAGE_KEYS.has(key))) {
            throw new ProviderIntegrationError(
                'request_message_field_not_allowed',
                'message에 허용되지 않는 필드가 포함되어 있습니다.',
            );
        }
        const role = String(message.role ?? '').trim();
        if (!ALLOWED_MESSAGE_ROLES.has(role) || typeof message.content !== 'string') {
            throw new ProviderIntegrationError(
                'request_message_invalid',
                'message에는 지원 역할과 문자열 content가 필요합니다.',
            );
        }
        const normalized = { role, content: message.content };
        if (message.name !== undefined) {
            if (typeof message.name !== 'string') {
                throw new ProviderIntegrationError('request_message_invalid', 'message name은 문자열이어야 합니다.');
            }
            normalized.name = message.name;
        }
        if (message.tool_call_id !== undefined) {
            if (typeof message.tool_call_id !== 'string') {
                throw new ProviderIntegrationError('request_message_invalid', 'tool_call_id는 문자열이어야 합니다.');
            }
            normalized.tool_call_id = message.tool_call_id;
        }
        return Object.freeze(normalized);
    });
}

function validateExecutionInput(value, providerId, readRegistrySettings) {
    if (!isRecord(value)) {
        throw new ProviderIntegrationError('request_invalid', '공용 provider 요청은 객체여야 합니다.');
    }
    assertDataProperties(value, 'request_accessor_not_allowed');
    const unknownKeys = Object.keys(value).filter(key => !ALLOWED_REQUEST_KEYS.has(key));
    if (unknownKeys.length > 0) {
        throw new ProviderIntegrationError(
            'request_field_not_allowed',
            '공용 provider 요청에 허용되지 않는 필드가 포함되어 있습니다.',
        );
    }
    const modelId = normalizeProviderModelId(value.modelId);
    if (!hasEnabledModel(readRegistrySettings(), providerId, modelId)) {
        throw new ProviderIntegrationError(
            'model_not_ready',
            '요청한 모델은 이 provider binding의 활성 Registry 모델이 아닙니다.',
        );
    }
    const hasPrompt = value.prompt !== undefined;
    const hasMessages = value.messages !== undefined;
    if (hasPrompt === hasMessages) {
        throw new ProviderIntegrationError(
            'request_prompt_invalid',
            'prompt 문자열과 messages 배열 중 하나만 제공해야 합니다.',
        );
    }
    if (hasPrompt && (typeof value.prompt !== 'string' || value.prompt.length === 0)) {
        throw new ProviderIntegrationError('request_prompt_invalid', 'prompt는 비어 있지 않은 문자열이어야 합니다.');
    }
    const maxTokens = value.maxTokens;
    if (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens < 1) {
        throw new ProviderIntegrationError('request_max_tokens_invalid', 'maxTokens는 1 이상의 정수여야 합니다.');
    }
    if (value.stream !== undefined && typeof value.stream !== 'boolean') {
        throw new ProviderIntegrationError('request_stream_invalid', 'stream은 boolean이어야 합니다.');
    }
    if (value.extractData !== undefined && typeof value.extractData !== 'boolean') {
        throw new ProviderIntegrationError('request_extract_data_invalid', 'extractData는 boolean이어야 합니다.');
    }
    const request = {
        maxTokens,
        stream: value.stream === true,
        extractData: value.extractData !== false,
        // 외부 확장 요청에 현재 메인 채팅 preset/instruct 상태가 섞이지 않게 고정한다.
        includePreset: false,
        includeInstruct: false,
        instructSettings: {},
    };
    if (hasMessages) {
        request.messages = normalizeMessages(value.messages);
    } else {
        request.prompt = value.prompt;
    }
    return { modelId, request };
}

function isAbortSignal(value) {
    try {
        return value === null
            || value === undefined
            || (
                typeof value === 'object'
                && typeof value.aborted === 'boolean'
                && typeof value.addEventListener === 'function'
            );
    } catch {
        return false;
    }
}

function createSafeAbortError() {
    const error = new Error('공용 provider 요청이 취소되었습니다.');
    error.name = 'AbortError';
    return error;
}

function createSafeStreamError(code = 'backend_stream_failed') {
    const messages = {
        backend_stream_failed: 'SillyTavern 연결 backend 스트림 처리에 실패했습니다.',
        backend_stream_invalid: 'SillyTavern 연결 backend가 올바른 스트림을 반환하지 않았습니다.',
        backend_stream_reused: 'provider 스트림 factory는 한 번만 호출할 수 있습니다.',
    };
    const safeCode = Object.hasOwn(messages, code) ? code : 'backend_stream_failed';
    return new ProviderIntegrationError(safeCode, messages[safeCode]);
}

function isSignalAborted(value) {
    try {
        return value?.aborted === true;
    } catch {
        return true;
    }
}

function forwardAbort(source, controller) {
    if (!source || controller.signal.aborted) {
        return;
    }
    // 호출자가 넣은 abort reason에 endpoint·키 등이 있어도 backend나 consumer에 전달하지 않는다.
    controller.abort(createSafeAbortError());
}

function createBackendCandidate(strategy, options, connectionAdapter) {
    let selected;
    try {
        selected = resolveSelectedConnection(options.getContext);
    } catch {
        return null;
    }
    const isCustom = selected.providerId === 'custom';
    if (strategy === PROVIDER_INTEGRATION_STRATEGIES.SILLYTAVERN_INHERITED && isCustom) {
        return null;
    }
    if (strategy === PROVIDER_INTEGRATION_STRATEGIES.OPENAI_COMPATIBLE && !isCustom) {
        return null;
    }
    const models = getEnabledModels(options.readRegistrySettings(), selected.providerId)
        .map(createPublicModel);
    if (models.length === 0) {
        return null;
    }
    const providerId = strategy === PROVIDER_INTEGRATION_STRATEGIES.OPENAI_COMPATIBLE
        ? 'cmr.openai-compatible'
        : `cmr.sillytavern.${selected.providerId}`;
    const label = strategy === PROVIDER_INTEGRATION_STRATEGIES.OPENAI_COMPATIBLE
        ? 'OpenAI-compatible · 사용자 모델'
        : `${selected.provider.label} · SillyTavern 연결`;
    const modelsFingerprint = JSON.stringify(models.map(model => `${model.provider}\u0000${model.id}`));
    const fingerprint = `${strategy}\u0000${selected.profileId}\u0000${selected.providerId}`;
    const route = Object.freeze({
        provider: selected.providerId,
        modelId: models[0].id,
        adapterId: SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
        connectionProfileId: selected.profileId,
    });
    if (connectionAdapter.supports({ route })?.ok !== true) {
        return null;
    }

    function assertFresh() {
        let live;
        try {
            live = resolveSelectedConnection(options.getContext);
        } catch {
            throw new ProviderIntegrationError(
                'backend_unavailable',
                'SillyTavern 연결 backend를 사용할 수 없습니다.',
            );
        }
        if (live.profileId !== selected.profileId || live.providerId !== selected.providerId) {
            throw new ProviderIntegrationError(
                'backend_stale',
                'SillyTavern Connection Profile이 변경되어 provider binding을 다시 준비해야 합니다.',
            );
        }
    }

    async function execute(value, executionOptions = {}) {
        if (!isAbortSignal(executionOptions?.signal)) {
            throw new ProviderIntegrationError('signal_invalid', 'signal은 AbortSignal이어야 합니다.');
        }
        if (isSignalAborted(executionOptions?.signal)) {
            throw createSafeAbortError();
        }
        assertFresh();
        const normalized = validateExecutionInput(
            value,
            selected.providerId,
            options.readRegistrySettings,
        );
        const liveRoute = {
            provider: selected.providerId,
            modelId: normalized.modelId,
            adapterId: SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
            connectionProfileId: selected.profileId,
        };
        const support = connectionAdapter.supports({ route: liveRoute });
        if (support?.ok !== true) {
            throw new ProviderIntegrationError(
                support?.code ?? 'backend_unavailable',
                'SillyTavern 연결 backend를 사용할 수 없습니다.',
            );
        }
        try {
            const result = await connectionAdapter.execute({
                route: liveRoute,
                request: normalized.request,
                signal: executionOptions?.signal ?? null,
            });
            if (isSignalAborted(executionOptions?.signal)) {
                throw createSafeAbortError();
            }
            return Object.freeze({
                kind: normalized.request.stream ? 'stream' : 'value',
                value: result,
            });
        } catch (error) {
            if (error?.name === 'AbortError' || isSignalAborted(executionOptions?.signal)) {
                // Connection Manager가 민감한 원인을 AbortError에 넣더라도
                // 소비 확장 경계 밖으로 원문을 전달하지 않는다.
                throw createSafeAbortError();
            }
            throw new ProviderIntegrationError(
                'backend_request_failed',
                'SillyTavern 연결 backend 요청에 실패했습니다.',
            );
        }
    }

    return Object.freeze({
        strategy,
        fingerprint,
        modelsFingerprint,
        models: Object.freeze(models),
        provider: deepFreezeOwned({
            id: providerId,
            label,
            source: selected.providerId,
            protocol: selected.provider.protocol,
        }),
        assertFresh,
        execute,
    });
}

function validateHandlerReceipt(value) {
    if (!isRecord(value)
        || value.requestHandlerBound !== true
        || value.handlerToken === undefined
        || value.handlerToken === null
        || typeof value.dispose !== 'function') {
        throw new ProviderIntegrationError(
            'handler_receipt_invalid',
            'consumer가 유효한 provider handler 설치 영수증을 반환하지 않았습니다.',
        );
    }
    return value;
}

function validatePublicationReceipt(value) {
    if (!isRecord(value)
        || value.modelsPublished !== true
        || value.publicationToken === undefined
        || value.publicationToken === null
        || typeof value.updateModels !== 'function'
        || typeof value.dispose !== 'function') {
        throw new ProviderIntegrationError(
            'publication_receipt_invalid',
            'consumer가 유효한 모델 게시 영수증을 반환하지 않았습니다.',
        );
    }
    return value;
}

function createReceiptDisposer(onError, timeoutMs = DEFAULT_RECEIPT_DISPOSE_TIMEOUT_MS) {
    const disposedReceipts = new WeakSet();
    return async receipt => {
        if (!isRecord(receipt) || disposedReceipts.has(receipt)) {
            return false;
        }
        // 외부 영수증은 frozen일 수 있으므로 절대로 상태 필드를 쓰지 않는다.
        disposedReceipts.add(receipt);
        let dispose;
        try {
            dispose = receipt.dispose;
        } catch {
            onError('consumer_dispose_failed');
            return false;
        }
        if (typeof dispose !== 'function') {
            return false;
        }
        let result;
        try {
            result = dispose.call(receipt);
        } catch {
            onError('consumer_dispose_failed');
            return false;
        }
        return await new Promise(resolve => {
            let settled = false;
            const finish = value => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };
            const timer = setTimeout(() => {
                onError('consumer_dispose_timeout');
                finish(false);
            }, timeoutMs);
            Promise.resolve(result).then(
                () => finish(true),
                () => {
                    if (!settled) {
                        onError('consumer_dispose_failed');
                    }
                    finish(false);
                },
            );
        });
    };
}

function createConsumerSnapshot(consumer) {
    const statuses = [...consumer.bindings.values()].map(binding => Object.freeze({
        slotId: binding.slotId,
        strategy: binding.strategy,
        status: binding.status,
        code: binding.code ?? null,
        providerId: binding.status === 'ready' ? binding.candidate.provider.id : null,
        modelCount: binding.status === 'ready' ? binding.candidate.models.length : 0,
    }));
    return deepFreezeOwned({
        consumerId: consumer.descriptor.consumerId,
        label: consumer.descriptor.label,
        contractVersion: consumer.descriptor.contractVersion,
        bindings: statuses,
    });
}

export function createProviderIntegrationController(options = {}) {
    if (typeof options.readRegistrySettings !== 'function' || typeof options.getContext !== 'function') {
        throw new ProviderIntegrationError(
            'dependencies_invalid',
            'provider integration에는 Registry reader와 SillyTavern context resolver가 필요합니다.',
        );
    }
    const onError = typeof options.onError === 'function' ? options.onError : () => {};
    const connectionAdapter = createSillyTavernConnectionProfileAdapter(options.getContext);
    const consumers = new Map();
    const listeners = new Set();
    let active = true;
    let generation = 0;
    let revision = 0;
    let syncQueue = Promise.resolve();

    function assertActive() {
        if (!active) {
            throw new ProviderIntegrationError('destroyed', '종료된 provider integration API입니다.');
        }
    }

    function reportError(code = 'consumer_callback_failed') {
        const safeCode = typeof code === 'string' && Object.hasOwn(SAFE_ERROR_MESSAGES, code)
            ? code
            : 'consumer_callback_failed';
        try {
            onError(new ProviderIntegrationError(safeCode, SAFE_ERROR_MESSAGES[safeCode]));
        } catch {
            // 외부 오류 처리기가 integration cleanup을 막지 않게 한다.
        }
    }
    const configuredDisposeTimeout = Number(options.disposeTimeoutMs);
    const disposeTimeoutMs = Number.isFinite(configuredDisposeTimeout)
        ? Math.max(1, Math.min(5_000, Math.trunc(configuredDisposeTimeout)))
        : DEFAULT_RECEIPT_DISPOSE_TIMEOUT_MS;
    const safeDispose = createReceiptDisposer(reportError, disposeTimeoutMs);

    function emit(type, consumer, binding = null) {
        revision += 1;
        const event = deepFreezeOwned({
            type,
            revision,
            consumerId: consumer?.descriptor.consumerId ?? null,
            slotId: binding?.slotId ?? null,
            strategy: binding?.strategy ?? null,
            status: binding?.status ?? null,
            code: binding?.code ?? null,
        });
        for (const listener of [...listeners]) {
            try {
                listener(event);
            } catch {
                reportError('consumer_listener_failed');
            }
        }
    }

    function drainBinding(consumer, binding, reason = 'binding-removed') {
        if (!binding) {
            return Promise.resolve(false);
        }
        if (binding.drainPromise) {
            return binding.drainPromise;
        }
        binding.draining = true;
        binding.status = 'draining';
        binding.controller.abort(new ProviderIntegrationError('binding_disposed', 'provider binding이 종료되었습니다.'));
        for (const execution of binding.executions) {
            execution.abort(new ProviderIntegrationError('binding_disposed', 'provider binding이 종료되었습니다.'));
        }
        binding.executions.clear();
        if (consumer.bindings.get(binding.key) === binding) {
            consumer.bindings.delete(binding.key);
        }
        binding.drainPromise = (async () => {
            await safeDispose(binding.publicationReceipt);
            await safeDispose(binding.handlerReceipt);
            emit(reason, consumer, binding);
            return true;
        })();
        return binding.drainPromise;
    }

    function createTrackedExecution(binding, controller, callerSignal, forward, candidate) {
        let cleaned = false;
        let callerListenerAttached = false;
        let iterator = null;
        let closePromise = null;
        const execution = {
            controller,
            candidate,
            get cleaned() {
                return cleaned;
            },
            track() {
                if (!cleaned) {
                    binding.executions.add(execution);
                }
            },
            markCallerListenerAttached() {
                callerListenerAttached = true;
                if (cleaned) {
                    execution.removeCallerListener();
                }
            },
            removeCallerListener() {
                if (!forward || !callerListenerAttached) {
                    return;
                }
                callerListenerAttached = false;
                try {
                    callerSignal.removeEventListener?.('abort', forward);
                } catch {
                    // 호출자 signal cleanup 실패가 요청 결과나 종료를 덮지 않게 한다.
                }
            },
            setIterator(value) {
                if (iterator) {
                    throw createSafeStreamError('backend_stream_invalid');
                }
                iterator = value;
                if (cleaned || controller.signal.aborted) {
                    void execution.closeIterator().catch(() => {});
                }
            },
            closeIterator(value) {
                if (!iterator) {
                    return Promise.resolve({ value, done: true });
                }
                if (closePromise) {
                    return closePromise;
                }
                let returnMethod;
                try {
                    returnMethod = iterator.return;
                } catch {
                    closePromise = Promise.reject(createSafeStreamError());
                    return closePromise;
                }
                if (typeof returnMethod !== 'function') {
                    closePromise = Promise.resolve({ value, done: true });
                    return closePromise;
                }
                closePromise = Promise.resolve().then(async () => {
                    try {
                        return await returnMethod.call(iterator, value);
                    } catch {
                        throw createSafeStreamError();
                    }
                });
                return closePromise;
            },
            abort() {
                if (!controller.signal.aborted) {
                    controller.abort(createSafeAbortError());
                }
                const closing = execution.closeIterator();
                // lifecycle abort 경로에서는 외부 iterator.return 오류를 원문 없이 흡수한다.
                void closing.catch(() => {});
                execution.cleanup();
                return closing;
            },
            cleanup() {
                if (cleaned) {
                    return false;
                }
                cleaned = true;
                binding.executions.delete(execution);
                execution.removeCallerListener();
                return true;
            },
        };
        return execution;
    }

    function assertExecutionFence(binding, execution) {
        if (execution.controller.signal.aborted
            || binding.status !== 'ready'
            || binding.draining
            || !active) {
            execution.abort();
            throw createSafeAbortError();
        }
        try {
            execution.candidate.assertFresh();
        } catch (error) {
            execution.abort();
            if (error instanceof ProviderIntegrationError && error.code === 'backend_stale') {
                throw new ProviderIntegrationError(
                    'backend_stale',
                    'SillyTavern Connection Profile이 변경되어 provider binding을 다시 준비해야 합니다.',
                );
            }
            throw new ProviderIntegrationError(
                'backend_unavailable',
                'SillyTavern 연결 backend를 사용할 수 없습니다.',
            );
        }
        if (execution.controller.signal.aborted
            || binding.status !== 'ready'
            || binding.draining
            || !active) {
            execution.abort();
            throw createSafeAbortError();
        }
    }

    function normalizeStreamStep(value) {
        try {
            if (!isRecord(value)) {
                throw createSafeStreamError('backend_stream_invalid');
            }
            const done = value.done;
            if (done !== undefined && typeof done !== 'boolean') {
                throw createSafeStreamError('backend_stream_invalid');
            }
            return {
                value: value.value,
                done: done === true,
            };
        } catch (error) {
            if (error instanceof ProviderIntegrationError
                && error.code === 'backend_stream_invalid') {
                throw error;
            }
            throw createSafeStreamError('backend_stream_invalid');
        }
    }

    function createSafeStreamFactory(binding, execution, backendFactory) {
        let factoryCalled = false;
        return function providerStreamFactory() {
            assertExecutionFence(binding, execution);
            if (factoryCalled) {
                throw createSafeStreamError('backend_stream_reused');
            }
            factoryCalled = true;
            let iterator;
            let nextMethod;
            try {
                iterator = backendFactory();
                if (!isRecord(iterator)) {
                    throw createSafeStreamError('backend_stream_invalid');
                }
                execution.setIterator(iterator);
                nextMethod = iterator.next;
                if (typeof nextMethod !== 'function') {
                    throw createSafeStreamError('backend_stream_invalid');
                }
            } catch (error) {
                execution.abort();
                if (error instanceof ProviderIntegrationError
                    && error.code === 'backend_stream_invalid') {
                    throw error;
                }
                throw createSafeStreamError();
            }
            assertExecutionFence(binding, execution);
            let finishedNormally = false;
            const safeIterator = {
                async next(...args) {
                    if (finishedNormally) {
                        return { value: undefined, done: true };
                    }
                    assertExecutionFence(binding, execution);
                    let rawStep;
                    try {
                        rawStep = await nextMethod.call(iterator, ...args);
                    } catch {
                        execution.abort();
                        throw createSafeStreamError();
                    }
                    // signal을 무시한 backend의 늦은 chunk/완료는 소비자에게 전달하지 않는다.
                    assertExecutionFence(binding, execution);
                    let step;
                    try {
                        step = normalizeStreamStep(rawStep);
                    } catch {
                        execution.abort();
                        throw createSafeStreamError('backend_stream_invalid');
                    }
                    // IteratorResult getter가 재진입해 lifecycle을 종료한 경우에도 값을 내보내지 않는다.
                    assertExecutionFence(binding, execution);
                    if (step.done) {
                        finishedNormally = true;
                        execution.cleanup();
                    }
                    return step;
                },
                async return(value) {
                    if (finishedNormally) {
                        return { value, done: true };
                    }
                    if (!execution.controller.signal.aborted) {
                        execution.controller.abort(createSafeAbortError());
                    }
                    try {
                        const rawStep = await execution.closeIterator(value);
                        const step = normalizeStreamStep(rawStep);
                        finishedNormally = true;
                        return { value: step.value, done: true };
                    } catch {
                        throw createSafeStreamError();
                    } finally {
                        execution.cleanup();
                    }
                },
                [Symbol.asyncIterator]() {
                    return safeIterator;
                },
            };
            return Object.freeze(safeIterator);
        };
    }

    function createBoundExecute(binding) {
        return async (request, executionOptions = {}) => {
            if (binding.status !== 'ready' || binding.draining || !active) {
                throw new ProviderIntegrationError('binding_not_ready', 'provider handler가 준비되지 않았습니다.');
            }
            let callerSignal;
            try {
                callerSignal = executionOptions?.signal ?? null;
            } catch {
                throw new ProviderIntegrationError('signal_invalid', 'signal은 AbortSignal이어야 합니다.');
            }
            if (!isAbortSignal(callerSignal)) {
                throw new ProviderIntegrationError('signal_invalid', 'signal은 AbortSignal이어야 합니다.');
            }
            const controller = new AbortController();
            let execution;
            const forward = callerSignal ? () => (
                execution ? execution.abort() : forwardAbort(callerSignal, controller)
            ) : null;
            execution = createTrackedExecution(
                binding,
                controller,
                callerSignal,
                forward,
                binding.candidate,
            );
            if (forward) {
                try {
                    callerSignal.addEventListener('abort', forward, { once: true });
                    execution.markCallerListenerAttached();
                    if (callerSignal.aborted) {
                        forward();
                    }
                } catch {
                    execution.abort();
                    throw new ProviderIntegrationError('signal_invalid', 'signal은 AbortSignal이어야 합니다.');
                }
            }
            execution.track();
            try {
                if (controller.signal.aborted) {
                    throw createSafeAbortError();
                }
                if (binding.status !== 'ready' || binding.draining || !active) {
                    throw new ProviderIntegrationError('binding_not_ready', 'provider handler가 준비되지 않았습니다.');
                }
                const outcome = await execution.candidate.execute(request, { signal: controller.signal });
                if (controller.signal.aborted || binding.status !== 'ready' || binding.draining || !active) {
                    throw createSafeAbortError();
                }
                if (!isRecord(outcome) || !['stream', 'value'].includes(outcome.kind)) {
                    throw createSafeStreamError('backend_stream_invalid');
                }
                if (outcome.kind === 'stream') {
                    if (typeof outcome.value !== 'function') {
                        throw createSafeStreamError('backend_stream_invalid');
                    }
                    return createSafeStreamFactory(binding, execution, outcome.value);
                }
                execution.cleanup();
                return outcome.value;
            } catch (error) {
                const aborted = error?.name === 'AbortError' || controller.signal.aborted;
                execution.abort();
                if (aborted) {
                    throw createSafeAbortError();
                }
                throw error;
            }
        };
    }

    async function installBinding(consumer, slot, candidate) {
        const key = `${slot.slotId}\u0000${candidate.strategy}`;
        const binding = {
            key,
            slotId: slot.slotId,
            strategy: candidate.strategy,
            candidate,
            status: 'pending',
            code: null,
            controller: new AbortController(),
            executions: new Set(),
            handlerReceipt: null,
            publicationReceipt: null,
            draining: false,
            drainPromise: null,
            generation: ++generation,
        };
        consumer.bindings.set(key, binding);
        emit('binding-pending', consumer, binding);
        const installGeneration = binding.generation;
        try {
            const handlerValue = await consumer.hooks.installHandler(Object.freeze({
                slotId: slot.slotId,
                strategy: candidate.strategy,
                provider: candidate.provider,
                capabilities: HANDLER_CAPABILITIES,
                execute: createBoundExecute(binding),
                signal: binding.controller.signal,
            }));
            binding.handlerReceipt = handlerValue;
            validateHandlerReceipt(handlerValue);
            if (!active || !consumer.active || binding.draining
                || binding.generation !== installGeneration
                || consumer.bindings.get(key) !== binding) {
                await safeDispose(binding.handlerReceipt);
                return;
            }
            const publicationValue = await consumer.hooks.publishModels(Object.freeze({
                handlerToken: binding.handlerReceipt.handlerToken,
                slotId: slot.slotId,
                strategy: candidate.strategy,
                provider: candidate.provider,
                models: candidate.models,
                signal: binding.controller.signal,
            }));
            binding.publicationReceipt = publicationValue;
            validatePublicationReceipt(publicationValue);
            if (!active || !consumer.active || binding.draining
                || binding.generation !== installGeneration
                || consumer.bindings.get(key) !== binding) {
                await safeDispose(binding.publicationReceipt);
                await safeDispose(binding.handlerReceipt);
                return;
            }
            binding.status = 'ready';
            emit('binding-ready', consumer, binding);
        } catch (error) {
            await safeDispose(binding.publicationReceipt);
            await safeDispose(binding.handlerReceipt);
            if (consumer.bindings.get(key) === binding && !binding.draining) {
                binding.status = 'failed';
                binding.code = error instanceof ProviderIntegrationError
                    && SAFE_BINDING_FAILURE_CODES.has(error.code)
                    ? error.code
                    : 'consumer_install_failed';
                emit('binding-failed', consumer, binding);
            }
        }
    }

    async function updateBindingModels(consumer, binding, candidate) {
        try {
            const updated = await binding.publicationReceipt.updateModels(candidate.models, {
                signal: binding.controller.signal,
            });
            if (updated !== true) {
                throw new ProviderIntegrationError(
                    'model_update_rejected',
                    'consumer가 Registry 모델 갱신을 적용하지 않았습니다.',
                );
            }
            if (binding.status === 'ready' && !binding.draining) {
                binding.candidate = candidate;
                emit('models-updated', consumer, binding);
            }
        } catch {
            await drainBinding(consumer, binding, 'binding-update-failed');
        }
    }

    async function reconcileConsumer(consumer, forceRetry = false) {
        if (!active || !consumer.active) {
            return;
        }
        const desiredKeys = new Set();
        for (const slot of consumer.descriptor.slots) {
            for (const strategy of slot.strategies) {
                const key = `${slot.slotId}\u0000${strategy}`;
                const candidate = createBackendCandidate(strategy, options, connectionAdapter);
                if (!candidate) {
                    continue;
                }
                desiredKeys.add(key);
                const current = consumer.bindings.get(key);
                if (current && current.candidate.fingerprint === candidate.fingerprint) {
                    if (current.status === 'ready'
                        && current.candidate.modelsFingerprint !== candidate.modelsFingerprint) {
                        await updateBindingModels(consumer, current, candidate);
                    } else if (current.status === 'failed' && forceRetry) {
                        await drainBinding(consumer, current, 'binding-retry');
                        await installBinding(consumer, slot, candidate);
                    }
                    continue;
                }
                if (current) {
                    await drainBinding(consumer, current, 'binding-replaced');
                }
                await installBinding(consumer, slot, candidate);
            }
        }
        for (const [key, binding] of [...consumer.bindings]) {
            if (!desiredKeys.has(key)) {
                await drainBinding(consumer, binding, 'binding-unavailable');
            }
        }
    }

    function sync(optionsValue = {}) {
        assertActive();
        const forceRetry = optionsValue?.retryFailed === true;
        const operation = syncQueue.catch(() => undefined).then(async () => {
            for (const consumer of [...consumers.values()]) {
                await reconcileConsumer(consumer, forceRetry);
            }
        });
        // 호출자는 현재 실패를 관찰하되, 다음 동기화는 이전 실패에서 회복할 수 있다.
        syncQueue = operation.catch(() => {
            reportError('reconcile_failed');
        });
        return operation.catch(() => {
            throw new ProviderIntegrationError(
                'reconcile_failed',
                SAFE_ERROR_MESSAGES.reconcile_failed,
            );
        });
    }

    function registerConsumer(descriptorValue, hooksValue) {
        assertActive();
        if (consumers.size >= MAX_CONSUMERS) {
            throw new ProviderIntegrationError(
                'consumer_limit_exceeded',
                `provider consumer는 최대 ${MAX_CONSUMERS}개까지 등록할 수 있습니다.`,
            );
        }
        const descriptor = normalizeConsumerDescriptor(descriptorValue);
        if (consumers.has(descriptor.consumerId)) {
            throw new ProviderIntegrationError('consumer_duplicate', '같은 provider consumer가 이미 등록되어 있습니다.');
        }
        const consumer = {
            descriptor,
            hooks: normalizeConsumerHooks(hooksValue),
            bindings: new Map(),
            active: true,
        };
        consumers.set(descriptor.consumerId, consumer);
        emit('consumer-registered', consumer);
        const ready = sync().then(() => createConsumerSnapshot(consumer));
        let disposed = false;
        const dispose = () => {
            if (disposed || !consumer.active) {
                return false;
            }
            disposed = true;
            consumer.active = false;
            consumers.delete(descriptor.consumerId);
            const drains = [...consumer.bindings.values()]
                .map(binding => drainBinding(consumer, binding, 'consumer-disposed'));
            Promise.all(drains).then(() => {
                emit('consumer-unregistered', consumer);
            }).catch(() => reportError('consumer_dispose_failed'));
            return true;
        };
        return Object.freeze({
            consumerId: descriptor.consumerId,
            ready,
            dispose,
        });
    }

    function getConsumers() {
        assertActive();
        return Object.freeze([...consumers.values()].map(createConsumerSnapshot));
    }

    function getMetrics() {
        const bindings = [...consumers.values()].flatMap(consumer => [...consumer.bindings.values()]);
        return Object.freeze({
            consumerCount: active ? consumers.size : 0,
            pendingCount: active ? bindings.filter(binding => binding.status === 'pending').length : 0,
            readyCount: active ? bindings.filter(binding => binding.status === 'ready').length : 0,
            failedCount: active ? bindings.filter(binding => binding.status === 'failed').length : 0,
            publishedModelCount: active
                ? bindings.filter(binding => binding.status === 'ready')
                    .reduce((total, binding) => total + binding.candidate.models.length, 0)
                : 0,
        });
    }

    function subscribe(listener) {
        assertActive();
        if (typeof listener !== 'function') {
            throw new ProviderIntegrationError('listener_invalid', 'integration 이벤트 구독자는 함수여야 합니다.');
        }
        listeners.add(listener);
        return Object.freeze(() => listeners.delete(listener));
    }

    const api = Object.freeze({
        apiVersion: PROVIDER_INTEGRATION_API_VERSION,
        capabilities: deepFreezeOwned({
            strategies: Object.values(PROVIDER_INTEGRATION_STRATEGIES),
            inputSchema: PROVIDER_INTEGRATION_INPUT_SCHEMA,
            atomicHandlerBeforeModels: true,
            selectedConnectionProfileOnly: true,
            credentials: 'connection-manager-owned',
            mainChatMutation: false,
            unknownConsumersUntouched: true,
            ownedControlAttribute: PROVIDER_INTEGRATION_OWNED_ATTRIBUTE,
            consumerRequirements: { ...PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES },
        }),
        isCompatible(requiredVersion) {
            return isProviderIntegrationApiCompatible(requiredVersion);
        },
        registerConsumer,
        getConsumers,
        refresh() {
            return sync({ retryFailed: true });
        },
        subscribe,
    });

    async function destroy() {
        if (!active) {
            return false;
        }
        active = false;
        generation += 1;
        const currentConsumers = [...consumers.values()];
        consumers.clear();
        const drains = [];
        for (const consumer of currentConsumers) {
            consumer.active = false;
            for (const binding of [...consumer.bindings.values()]) {
                drains.push(drainBinding(consumer, binding, 'integration-destroyed'));
            }
        }
        // 응답하지 않는 외부 hook 때문에 CMR 종료가 멈추지 않게 syncQueue는 기다리지 않는다.
        // 이미 확보한 영수증은 여기서 정리하고, 늦게 도착한 영수증은 installBinding이 정리한다.
        await Promise.all(drains);
        listeners.clear();
        return true;
    }

    return Object.freeze({
        api,
        sync,
        getMetrics,
        destroy,
    });
}

export function announceProviderIntegrationApi(target, api) {
    if (!target || typeof target.dispatchEvent !== 'function' || !api) {
        return false;
    }
    const CustomEventCtor = target.defaultView?.CustomEvent ?? globalThis.CustomEvent;
    if (typeof CustomEventCtor !== 'function') {
        return false;
    }
    target.dispatchEvent(new CustomEventCtor(PROVIDER_INTEGRATION_READY_EVENT, {
        detail: api,
    }));
    return true;
}

export function diagnoseProviderIntegrations(metrics = {}) {
    const details = {
        consumerCount: Number(metrics.consumerCount) || 0,
        pendingCount: Number(metrics.pendingCount) || 0,
        readyCount: Number(metrics.readyCount) || 0,
        failedCount: Number(metrics.failedCount) || 0,
        publishedModelCount: Number(metrics.publishedModelCount) || 0,
    };
    const status = details.failedCount > 0 ? 'warning' : 'passed';
    return {
        id: 'external-provider-integrations',
        category: 'external',
        status,
        message: details.failedCount > 0
            ? `공용 provider hook ${details.failedCount}개가 handler 설치 또는 모델 게시에 실패했습니다.`
            : `공용 provider hook ${details.consumerCount}곳 · 준비된 provider binding ${details.readyCount}개`,
        details,
    };
}
