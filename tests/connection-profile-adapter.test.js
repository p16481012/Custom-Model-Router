import test from 'node:test';
import assert from 'node:assert/strict';

import { addModel } from '../src/registry.js';
import {
    PurposeRouter,
    PurposeRouterError,
} from '../src/purpose-router.js';
import {
    SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
    createSillyTavernConnectionProfileAdapter,
} from '../src/connection-profile-adapter.js';

function makeRoute(overrides = {}) {
    return {
        provider: 'openai',
        modelId: 'gpt-auxiliary',
        adapterId: SILLYTAVERN_CONNECTION_PROFILE_ADAPTER_ID,
        connectionProfileId: 'profile-openai',
        ...overrides,
    };
}

function makeContext(options = {}) {
    const profile = {
        id: 'profile-openai',
        api: 'openai',
        model: 'gpt-profile-default',
        preset: '보조 요청',
        'secret-id': 'server-side-secret-reference',
    };
    const calls = [];
    const service = {
        getProfile(profileId) {
            if (options.profileMissing || profileId !== profile.id) {
                throw new Error('not found');
            }
            return profile;
        },
        validateProfile() {
            if (options.invalidProfile) {
                throw new Error('invalid profile');
            }
            return {
                selected: 'openai',
                source: options.profileProvider ?? 'openai',
            };
        },
        async sendRequest(...args) {
            calls.push(args);
            if (options.requestError) {
                throw options.requestError;
            }
            return { content: '보조 응답' };
        },
    };
    const context = {
        extensionSettings: {
            disabledExtensions: options.disabled ? ['connection-manager'] : [],
        },
        chatCompletionSettings: {
            chat_completion_source: 'xai',
            xai_model: 'grok-main',
            openai_model: 'gpt-main',
        },
        ConnectionManagerRequestService: service,
    };
    return { context, profile, calls };
}

function makeRouter(context, route = makeRoute()) {
    const registry = addModel(undefined, route.provider, route.modelId);
    const router = new PurposeRouter({
        routes: { routes: { translation: route } },
        getRegistrySettings: () => registry,
    });
    router.registerAdapter(createSillyTavernConnectionProfileAdapter(() => context));
    return router;
}

test('Connection Profile 인증·엔드포인트를 재사용하고 model만 Registry 경로로 강제한다', async () => {
    const { context, profile, calls } = makeContext();
    const contextBefore = structuredClone(context.chatCompletionSettings);
    const profileBefore = structuredClone(profile);
    const controller = new AbortController();
    const router = makeRouter(context);
    const messages = [{ role: 'user', content: '번역해 줘' }];

    const result = await router.execute('translation', {
        messages,
        maxTokens: 321,
        stream: true,
        extractData: false,
        includePreset: false,
        includeInstruct: false,
        instructSettings: { names_behavior: 1 },
    }, { signal: controller.signal });

    assert.deepEqual(result, { content: '보조 응답' });
    assert.equal(calls.length, 1);
    const [profileId, prompt, maxTokens, custom, overridePayload] = calls[0];
    assert.equal(profileId, 'profile-openai');
    assert.equal(prompt, messages);
    assert.equal(maxTokens, 321);
    assert.deepEqual(custom, {
        stream: true,
        signal: controller.signal,
        extractData: false,
        includePreset: false,
        includeInstruct: false,
        instructSettings: { names_behavior: 1 },
    });
    assert.deepEqual(overridePayload, { model: 'gpt-auxiliary' });
    assert.deepEqual(context.chatCompletionSettings, contextBefore);
    assert.deepEqual(profile, profileBefore);
});

test('연결 프로필 제공업체가 경로와 다르면 실제 요청 전에 명시적으로 중단한다', async () => {
    const { context, calls } = makeContext({ profileProvider: 'xai' });
    const router = makeRouter(context);

    await assert.rejects(
        router.execute('translation', { prompt: 'hello', maxTokens: 100 }),
        error => (
            error instanceof PurposeRouterError
            && error.code === 'adapter_unsupported'
            && error.details.reasonCode === 'connection_profile_provider_mismatch'
        ),
    );
    assert.equal(calls.length, 0);
});

test('Connection Manager 비활성화와 삭제된 프로필을 안전한 오류로 보고한다', async () => {
    const disabled = makeContext({ disabled: true });
    await assert.rejects(
        makeRouter(disabled.context).execute('translation', { prompt: 'hello', maxTokens: 100 }),
        error => (
            error instanceof PurposeRouterError
            && error.code === 'adapter_unsupported'
            && error.details.reasonCode === 'connection_manager_unavailable'
        ),
    );

    const missing = makeContext({ profileMissing: true });
    await assert.rejects(
        makeRouter(missing.context).execute('translation', { prompt: 'hello', maxTokens: 100 }),
        error => (
            error instanceof PurposeRouterError
            && error.code === 'adapter_unsupported'
            && error.details.reasonCode === 'connection_profile_not_found'
        ),
    );
});

test('보조 요청 입력을 검증하고 빈 prompt나 잘못된 maxTokens를 전송하지 않는다', async () => {
    const { context, calls } = makeContext();
    const router = makeRouter(context);

    await assert.rejects(
        router.execute('translation', { prompt: '', maxTokens: 100 }),
        error => error instanceof PurposeRouterError && error.code === 'adapter_request_prompt_missing',
    );
    await assert.rejects(
        router.execute('translation', { prompt: 'hello', maxTokens: 0 }),
        error => error instanceof PurposeRouterError && error.code === 'adapter_request_max_tokens_invalid',
    );
    await assert.rejects(
        router.execute('translation', { prompt: 'hello', maxTokens: 100, overridePayload: [] }),
        error => error instanceof PurposeRouterError && error.code === 'adapter_request_override_invalid',
    );
    await assert.rejects(
        router.execute('translation', {
            prompt: 'hello',
            maxTokens: 100,
            overridePayload: { chat_completion_source: 'xai', secret_id: 'other-secret' },
        }),
        error => error instanceof PurposeRouterError && error.code === 'adapter_request_override_not_allowed',
    );
    assert.equal(calls.length, 0);
});

test('Connection Manager 공개 API가 없는 버전은 지원하는 척하지 않는다', async () => {
    const context = {
        extensionSettings: { disabledExtensions: [] },
        ConnectionManagerRequestService: null,
    };
    const router = makeRouter(context);

    await assert.rejects(
        router.execute('translation', { prompt: 'hello', maxTokens: 100 }),
        error => (
            error instanceof PurposeRouterError
            && error.code === 'adapter_unsupported'
            && error.details.reasonCode === 'connection_manager_unavailable'
        ),
    );
});
