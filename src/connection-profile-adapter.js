import { PurposeRouterError } from './purpose-router.js';

export const SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID = 'sillytavern.connection-profile';

function getDefaultContext() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) {
        throw new PurposeRouterError('context_unavailable', 'SillyTavern.getContext()를 찾을 수 없습니다.');
    }
    return context;
}

function getConnectionService(context) {
    const disabledExtensions = context?.extensionSettings?.disabledExtensions;
    if (Array.isArray(disabledExtensions) && disabledExtensions.includes('connection-manager')) {
        throw new PurposeRouterError('connection_manager_unavailable', 'SillyTavern Connection Manager가 비활성화되어 있습니다.');
    }

    const service = context?.ConnectionManagerRequestService;
    const requiredMethods = ['getProfile', 'validateProfile', 'sendRequest'];
    const missing = requiredMethods.filter(method => typeof service?.[method] !== 'function');
    if (missing.length) {
        throw new PurposeRouterError(
            'connection_manager_unavailable',
            `SillyTavern Connection Manager 공개 API가 없습니다: ${missing.join(', ')}`,
        );
    }
    return service;
}

function resolveProfile(context, route) {
    if (!route.connectionProfileId) {
        throw new PurposeRouterError(
            'connection_profile_not_selected',
            'SillyTavern 연결 프로필을 선택해 주세요.',
        );
    }

    const service = getConnectionService(context);
    let profile;
    try {
        profile = service.getProfile(route.connectionProfileId);
    } catch (error) {
        throw new PurposeRouterError('connection_profile_not_found', '선택한 SillyTavern 연결 프로필을 찾을 수 없습니다.', {
            cause: error,
            details: { connectionProfileId: route.connectionProfileId },
        });
    }

    let apiMap;
    try {
        apiMap = service.validateProfile(profile);
    } catch (error) {
        throw new PurposeRouterError('connection_profile_unsupported', '선택한 연결 프로필로 보조 요청을 보낼 수 없습니다.', {
            cause: error,
            details: { connectionProfileId: route.connectionProfileId },
        });
    }

    if (apiMap?.selected !== 'openai' || apiMap?.source !== route.provider) {
        throw new PurposeRouterError(
            'connection_profile_provider_mismatch',
            `연결 프로필 제공업체와 Registry 경로 제공업체가 다릅니다. (${apiMap?.source ?? '알 수 없음'} / ${route.provider})`,
            {
                details: {
                    connectionProfileId: route.connectionProfileId,
                    profileProvider: apiMap?.source ?? null,
                    routeProvider: route.provider,
                },
            },
        );
    }

    return { service, profile };
}

function normalizeRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PurposeRouterError('adapter_request_invalid', '요청은 객체여야 합니다.');
    }

    const prompt = value.messages ?? value.prompt;
    const validPrompt = typeof prompt === 'string'
        ? prompt.length > 0
        : Array.isArray(prompt) && prompt.length > 0;
    if (!validPrompt) {
        throw new PurposeRouterError('adapter_request_prompt_missing', 'prompt 문자열 또는 messages 배열이 필요합니다.');
    }

    const maxTokens = Number(value.maxTokens);
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
        throw new PurposeRouterError('adapter_request_max_tokens_invalid', 'maxTokens는 1 이상의 정수여야 합니다.');
    }

    if (value.overridePayload !== undefined && (
        !value.overridePayload
        || typeof value.overridePayload !== 'object'
        || Array.isArray(value.overridePayload)
    )) {
        throw new PurposeRouterError('adapter_request_override_invalid', 'overridePayload는 객체여야 합니다.');
    }
    if (value.overridePayload && Object.keys(value.overridePayload).length > 0) {
        throw new PurposeRouterError(
            'adapter_request_override_not_allowed',
            '연결 프로필의 제공업체, 인증, 엔드포인트를 보호하기 위해 임의 payload 덮어쓰기를 허용하지 않습니다.',
        );
    }

    return {
        prompt,
        maxTokens,
        stream: value.stream === true,
        extractData: value.extractData !== false,
        includePreset: value.includePreset !== false,
        includeInstruct: value.includeInstruct !== false,
        instructSettings: value.instructSettings && typeof value.instructSettings === 'object'
            ? value.instructSettings
            : {},
    };
}

/**
 * SillyTavern 1.18의 공개 ConnectionManagerRequestService를 사용하는 opt-in 어댑터다.
 * Connection Profile의 인증·엔드포인트를 사용하되 payload의 model만 Registry 경로로 덮어쓴다.
 */
export function createSillyTavernConnectionProfileAdapter(getContext = getDefaultContext) {
    if (typeof getContext !== 'function') {
        throw new PurposeRouterError('context_resolver_invalid', 'getContext는 함수여야 합니다.');
    }

    return Object.freeze({
        id: SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
        label: 'SillyTavern 연결 프로필',
        supports({ route }) {
            try {
                const context = getContext();
                resolveProfile(context, route);
                return { ok: true };
            } catch (error) {
                if (error instanceof PurposeRouterError) {
                    return {
                        ok: false,
                        code: error.code,
                        message: error.message,
                    };
                }
                throw error;
            }
        },
        async execute({ route, request, signal }) {
            const context = getContext();
            const { service } = resolveProfile(context, route);
            const normalized = normalizeRequest(request);

            return await service.sendRequest(
                route.connectionProfileId,
                normalized.prompt,
                normalized.maxTokens,
                {
                    stream: normalized.stream,
                    signal,
                    extractData: normalized.extractData,
                    includePreset: normalized.includePreset,
                    includeInstruct: normalized.includeInstruct,
                    instructSettings: normalized.instructSettings,
                },
                // Connection Profile의 provider/auth/endpoint는 그대로 두고 model만 바꾼다.
                { model: route.modelId },
            );
        },
    });
}
