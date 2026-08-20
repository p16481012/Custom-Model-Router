import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PROVIDER_INTEGRATION_API_VERSION,
    PROVIDER_INTEGRATION_INPUT_SCHEMA,
    PROVIDER_INTEGRATION_OWNED_ATTRIBUTE,
    PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES,
    PROVIDER_INTEGRATION_STRATEGIES,
    ProviderIntegrationError,
    createProviderIntegrationController,
    diagnoseProviderIntegrations,
    isProviderIntegrationApiCompatible,
} from '../src/provider-integrations.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });
    return { promise, resolve, reject };
}

async function waitFor(predicate, label = 'condition') {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail(`Timed out waiting for ${label}`);
}

function createRegistry(provider, ...modelIds) {
    return {
        schemaVersion: 2,
        models: modelIds.map(id => ({ provider, id, enabled: true })),
        selectedModels: {},
    };
}

function createHarness({
    provider = 'openai',
    modelIds = ['gpt-cmr-test'],
    sendRequest,
    disposeTimeoutMs,
} = {}) {
    const profileSecret = 'PROFILE_API_KEY_SHOULD_NOT_LEAK';
    const endpointSecret = 'https://private.example.invalid/v1';
    const mainSettings = {
        source: 'main-chat-provider',
        model: 'main-chat-model',
        apiKey: 'MAIN_CHAT_SECRET',
    };
    const profile = Object.freeze({
        id: 'profile-primary',
        api_key: profileSecret,
        api_url: endpointSecret,
    });
    const sendCalls = [];
    let source = provider;
    let selectedProfile = 'profile-primary';
    let registrySettings = createRegistry(provider, ...modelIds);
    const service = {
        getProfile(profileId) {
            if (profileId !== 'profile-primary') {
                throw new Error('profile not found');
            }
            return profile;
        },
        validateProfile(value) {
            assert.strictEqual(value, profile);
            return { selected: 'openai', source };
        },
        async sendRequest(...args) {
            sendCalls.push(args);
            if (sendRequest) {
                return await sendRequest(...args);
            }
            return { ok: true, text: 'response' };
        },
    };
    const context = {
        extensionSettings: {
            disabledExtensions: [],
            connectionManager: {
                get selectedProfile() {
                    return selectedProfile;
                },
            },
        },
        ConnectionManagerRequestService: service,
        chatCompletionSettings: mainSettings,
    };
    const errors = [];
    const controller = createProviderIntegrationController({
        readRegistrySettings: () => registrySettings,
        getContext: () => context,
        onError: error => errors.push(error),
        disposeTimeoutMs,
    });
    return {
        controller,
        context,
        endpointSecret,
        errors,
        mainSettings,
        profileSecret,
        sendCalls,
        setProvider(value) {
            source = value;
        },
        setRegistry(value) {
            registrySettings = value;
        },
        setSelectedProfile(value) {
            selectedProfile = value;
        },
    };
}

function createDescriptor({
    consumerId = 'test.consumer',
    strategies = [PROVIDER_INTEGRATION_STRATEGIES.SILLYTAVERN_INHERITED],
    contractVersion = PROVIDER_INTEGRATION_API_VERSION,
    capabilities = PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES,
} = {}) {
    return {
        consumerId,
        label: 'Test consumer',
        contractVersion,
        capabilities: { ...capabilities },
        slots: [{ slotId: 'chat', strategies }],
    };
}

function createValidHandlerReceipt(onDispose = () => {}) {
    return Object.freeze({
        requestHandlerBound: true,
        handlerToken: 'handler-token',
        dispose: onDispose,
    });
}

function createValidPublicationReceipt({
    onDispose = () => {},
    updateModels = async () => true,
} = {}) {
    return Object.freeze({
        modelsPublished: true,
        publicationToken: 'publication-token',
        updateModels,
        dispose: onDispose,
    });
}

test('API contract is versioned, fail-closed, and exposes only the generic safe strategies', () => {
    assert.equal(isProviderIntegrationApiCompatible('1.0.0'), true);
    assert.equal(isProviderIntegrationApiCompatible('1.0.1'), false);
    assert.equal(isProviderIntegrationApiCompatible('2.0.0'), false);
    assert.equal(isProviderIntegrationApiCompatible('invalid'), false);

    const harness = createHarness();
    assert.equal(harness.controller.api.apiVersion, '1.0.0');
    assert.deepEqual(
        harness.controller.api.capabilities.strategies,
        ['sillytavern-inherited', 'openai-compatible'],
    );
    assert.equal(harness.controller.api.capabilities.inputSchema, PROVIDER_INTEGRATION_INPUT_SCHEMA);
    assert.equal(harness.controller.api.capabilities.atomicHandlerBeforeModels, true);
    assert.equal(harness.controller.api.capabilities.selectedConnectionProfileOnly, true);
    assert.equal(harness.controller.api.capabilities.credentials, 'connection-manager-owned');
    assert.equal(harness.controller.api.capabilities.mainChatMutation, false);
    assert.equal(harness.controller.api.capabilities.ownedControlAttribute, PROVIDER_INTEGRATION_OWNED_ATTRIBUTE);
    assert.deepEqual(
        harness.controller.api.capabilities.consumerRequirements,
        PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES,
    );
});

test('inherited strategy installs the handler before publishing models and routes through the selected profile', async () => {
    const harness = createHarness({ provider: 'openai', modelIds: ['gpt-one', 'gpt-two'] });
    const mainSettingsBefore = structuredClone(harness.mainSettings);
    const order = [];
    let handlerInput;
    let publicationInput;
    let execute;
    let handlerDisposals = 0;
    let publicationDisposals = 0;

    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler(input) {
            order.push('install');
            handlerInput = input;
            execute = input.execute;
            return createValidHandlerReceipt(() => {
                handlerDisposals += 1;
            });
        },
        async publishModels(input) {
            order.push('publish');
            publicationInput = input;
            return createValidPublicationReceipt({
                onDispose: () => {
                    publicationDisposals += 1;
                },
            });
        },
    });

    const ready = await registration.ready;
    assert.deepEqual(order, ['install', 'publish']);
    assert.deepEqual(ready.bindings, [{
        slotId: 'chat',
        strategy: 'sillytavern-inherited',
        status: 'ready',
        code: null,
        providerId: 'cmr.sillytavern.openai',
        modelCount: 2,
    }]);
    assert.equal(Object.isFrozen(handlerInput), true);
    assert.equal(Object.isFrozen(publicationInput), true);
    assert.equal(Object.isFrozen(handlerInput.provider), true);
    assert.equal(Object.isFrozen(publicationInput.models), true);
    assert.equal(Object.isFrozen(handlerInput.signal), false);
    assert.equal(handlerInput.provider.source, 'openai');
    assert.deepEqual(publicationInput.models.map(({ provider, id, protocol }) => ({ provider, id, protocol })), [
        { provider: 'openai', id: 'gpt-one', protocol: 'openai-chat-completions' },
        { provider: 'openai', id: 'gpt-two', protocol: 'openai-chat-completions' },
    ]);

    const result = await execute({
        modelId: 'gpt-two',
        prompt: 'hello',
        maxTokens: 123,
        extractData: false,
    });
    assert.deepEqual(result, { ok: true, text: 'response' });
    assert.equal(harness.sendCalls.length, 1);
    const [profileId, prompt, maxTokens, requestOptions, override] = harness.sendCalls[0];
    assert.equal(profileId, 'profile-primary');
    assert.equal(prompt, 'hello');
    assert.equal(maxTokens, 123);
    assert.equal(requestOptions.stream, false);
    assert.equal(requestOptions.extractData, false);
    assert.equal(requestOptions.includePreset, false);
    assert.equal(requestOptions.includeInstruct, false);
    assert.deepEqual(requestOptions.instructSettings, {});
    assert.ok(requestOptions.signal instanceof AbortSignal);
    assert.deepEqual(override, { model: 'gpt-two' });
    assert.deepEqual(harness.mainSettings, mainSettingsBefore);

    assert.equal(registration.dispose(), true);
    await waitFor(() => handlerDisposals === 1 && publicationDisposals === 1, 'receipt disposal');
    assert.equal(registration.dispose(), false);
    assert.equal(handlerDisposals, 1);
    assert.equal(publicationDisposals, 1);
});

test('custom selected profile enables only the OpenAI-compatible strategy', async () => {
    const harness = createHarness({ provider: 'custom', modelIds: ['local-model'] });
    const installs = [];
    let execute;
    const registration = harness.controller.api.registerConsumer(createDescriptor({
        strategies: [
            PROVIDER_INTEGRATION_STRATEGIES.SILLYTAVERN_INHERITED,
            PROVIDER_INTEGRATION_STRATEGIES.OPENAI_COMPATIBLE,
        ],
    }), {
        async installHandler(input) {
            installs.push(input);
            execute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });

    const snapshot = await registration.ready;
    assert.equal(installs.length, 1);
    assert.equal(installs[0].strategy, 'openai-compatible');
    assert.deepEqual(installs[0].provider, {
        id: 'cmr.openai-compatible',
        label: 'OpenAI-compatible · 사용자 모델',
        source: 'custom',
        protocol: 'openai-compatible',
    });
    assert.equal(snapshot.bindings[0].providerId, 'cmr.openai-compatible');
    await execute({ modelId: 'local-model', prompt: 'local', maxTokens: 8 });
    assert.equal(harness.sendCalls[0][0], 'profile-primary');
    assert.deepEqual(harness.sendCalls[0][4], { model: 'local-model' });
});

test('pending handler cannot execute or publish models before its valid receipt arrives', async () => {
    const harness = createHarness();
    const handler = deferred();
    let installInput;
    let publishCount = 0;
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        installHandler(input) {
            installInput = input;
            return handler.promise;
        },
        async publishModels() {
            publishCount += 1;
            return createValidPublicationReceipt();
        },
    });

    await waitFor(() => Boolean(installInput), 'pending install hook');
    assert.deepEqual(harness.controller.getMetrics(), {
        consumerCount: 1,
        pendingCount: 1,
        readyCount: 0,
        failedCount: 0,
        publishedModelCount: 0,
    });
    assert.equal(publishCount, 0);
    await assert.rejects(
        installInput.execute({ modelId: 'gpt-cmr-test', prompt: 'early', maxTokens: 4 }),
        error => error instanceof ProviderIntegrationError && error.code === 'binding_not_ready',
    );

    handler.resolve(createValidHandlerReceipt());
    const ready = await registration.ready;
    assert.equal(publishCount, 1);
    assert.equal(ready.bindings[0].status, 'ready');
});

test('false, rejected, and thrown install hooks fail closed without publishing models', async t => {
    const cases = [
        {
            name: 'false receipt',
            installHandler: () => false,
            code: 'handler_receipt_invalid',
        },
        {
            name: 'rejected promise',
            installHandler: () => Promise.reject(new ProviderIntegrationError(
                'EXTERNAL_SECRET_CODE',
                'EXTERNAL_SECRET_MESSAGE',
            )),
            code: 'consumer_install_failed',
        },
        {
            name: 'synchronous throw',
            installHandler: () => {
                throw new Error('thrown');
            },
            code: 'consumer_install_failed',
        },
    ];
    for (const [index, scenario] of cases.entries()) {
        await t.test(scenario.name, async () => {
            const harness = createHarness();
            let publishCount = 0;
            const registration = harness.controller.api.registerConsumer(createDescriptor({
                consumerId: `failure.${index}`,
            }), {
                installHandler: scenario.installHandler,
                async publishModels() {
                    publishCount += 1;
                    return createValidPublicationReceipt();
                },
            });
            const snapshot = await registration.ready;
            assert.equal(publishCount, 0);
            assert.equal(snapshot.bindings[0].status, 'failed');
            assert.equal(snapshot.bindings[0].code, scenario.code);
            assert.equal(harness.controller.getMetrics().failedCount, 1);
        });
    }
});

test('invalid or rejected publication cleans every obtained frozen receipt exactly once', async t => {
    const cases = [
        {
            name: 'invalid publication receipt',
            publishModels(publicationDisposals) {
                return Object.freeze({
                    modelsPublished: false,
                    publicationToken: 'invalid',
                    updateModels: async () => true,
                    dispose: () => {
                        publicationDisposals.count += 1;
                    },
                });
            },
            expectedPublicationDisposals: 1,
            code: 'publication_receipt_invalid',
        },
        {
            name: 'rejected publication promise',
            publishModels() {
                return Promise.reject(new Error('publish rejected'));
            },
            expectedPublicationDisposals: 0,
            code: 'consumer_install_failed',
        },
        {
            name: 'thrown publication hook',
            publishModels() {
                throw new Error('publish thrown');
            },
            expectedPublicationDisposals: 0,
            code: 'consumer_install_failed',
        },
    ];
    for (const [index, scenario] of cases.entries()) {
        await t.test(scenario.name, async () => {
            const harness = createHarness();
            let handlerDisposals = 0;
            const publicationDisposals = { count: 0 };
            const registration = harness.controller.api.registerConsumer(createDescriptor({
                consumerId: `publication-failure.${index}`,
            }), {
                async installHandler() {
                    return createValidHandlerReceipt(() => {
                        handlerDisposals += 1;
                    });
                },
                publishModels() {
                    return scenario.publishModels(publicationDisposals);
                },
            });
            const snapshot = await registration.ready;
            assert.equal(snapshot.bindings[0].status, 'failed');
            assert.equal(snapshot.bindings[0].code, scenario.code);
            assert.equal(handlerDisposals, 1);
            assert.equal(publicationDisposals.count, scenario.expectedPublicationDisposals);
            await harness.controller.destroy();
            assert.equal(handlerDisposals, 1);
            assert.equal(publicationDisposals.count, scenario.expectedPublicationDisposals);
        });
    }
});

test('incompatible or unsafe consumer contracts are rejected synchronously without touching hooks', () => {
    const harness = createHarness();
    let calls = 0;
    const hooks = {
        installHandler() {
            calls += 1;
        },
        publishModels() {
            calls += 1;
        },
    };
    assert.throws(
        () => harness.controller.api.registerConsumer(createDescriptor({ contractVersion: '2.0.0' }), hooks),
        error => error instanceof ProviderIntegrationError && error.code === 'consumer_contract_incompatible',
    );
    assert.throws(
        () => harness.controller.api.registerConsumer(createDescriptor({
            capabilities: {
                ...PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES,
                endpointOverride: true,
            },
        }), hooks),
        error => error instanceof ProviderIntegrationError && error.code === 'consumer_capability_mismatch',
    );
    assert.throws(
        () => harness.controller.api.registerConsumer(createDescriptor({
            capabilities: {
                ...PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES,
                unknownCapability: true,
            },
        }), hooks),
        error => error instanceof ProviderIntegrationError && error.code === 'consumer_capability_mismatch',
    );
    assert.equal(calls, 0);
    assert.equal(harness.controller.getMetrics().consumerCount, 0);
});

test('hook descriptors and execution boundary never expose or accept profile secrets, endpoints, or arbitrary overrides', async () => {
    const backendSentinel = 'BACKEND_SECRET_SENTINEL';
    const harness = createHarness({
        sendRequest: async () => {
            const error = new Error(backendSentinel);
            error.code = backendSentinel;
            throw error;
        },
    });
    const hookInputs = [];
    let execute;
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler(input) {
            hookInputs.push(input);
            execute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels(input) {
            hookInputs.push(input);
            return createValidPublicationReceipt();
        },
    });
    await registration.ready;

    for (const input of hookInputs) {
        const serialized = JSON.stringify(input);
        assert.equal(serialized.includes(harness.profileSecret), false);
        assert.equal(serialized.includes(harness.endpointSecret), false);
        assert.equal(serialized.includes('profile-primary'), false);
        assert.equal(Object.hasOwn(input.provider, 'endpoint'), false);
        assert.equal(Object.hasOwn(input.provider, 'apiKey'), false);
        assert.equal(Object.hasOwn(input.provider, 'connectionProfileId'), false);
    }
    for (const forbidden of [
        { endpoint: 'https://attacker.invalid/v1' },
        { apiKey: 'attacker-key' },
        { headers: { authorization: 'Bearer secret' } },
        { overridePayload: { api_url: 'https://attacker.invalid' } },
        { instructSettings: { apiKey: 'secret' } },
        { includePreset: true },
    ]) {
        await assert.rejects(
            execute({
                modelId: 'gpt-cmr-test',
                prompt: 'safe prompt',
                maxTokens: 10,
                ...forbidden,
            }),
            error => error instanceof ProviderIntegrationError && error.code === 'request_field_not_allowed',
        );
    }
    for (const maxTokens of [true, '10']) {
        await assert.rejects(
            execute({ modelId: 'gpt-cmr-test', prompt: 'safe prompt', maxTokens }),
            error => error instanceof ProviderIntegrationError && error.code === 'request_max_tokens_invalid',
        );
    }
    const signalAccessorSentinel = 'SIGNAL_ACCESSOR_SECRET_SENTINEL';
    await assert.rejects(
        execute(
            { modelId: 'gpt-cmr-test', prompt: 'safe prompt', maxTokens: 10 },
            {
                get signal() {
                    throw new Error(signalAccessorSentinel);
                },
            },
        ),
        error => (
            error instanceof ProviderIntegrationError
            && error.code === 'signal_invalid'
            && !error.message.includes(signalAccessorSentinel)
        ),
    );
    const accessorRequest = { modelId: 'gpt-cmr-test', prompt: 'safe', maxTokens: 10 };
    Object.defineProperty(accessorRequest, 'endpoint', {
        enumerable: true,
        get() {
            throw new Error('must not execute getter');
        },
    });
    await assert.rejects(
        execute(accessorRequest),
        error => error instanceof ProviderIntegrationError && error.code === 'request_accessor_not_allowed',
    );
    assert.equal(harness.sendCalls.length, 0);
    await assert.rejects(
        execute({ modelId: 'gpt-cmr-test', prompt: 'safe', maxTokens: 10 }),
        error => (
            error instanceof ProviderIntegrationError
            && error.code === 'backend_request_failed'
            && !error.message.includes(backendSentinel)
        ),
    );
});

test('messages are allowlisted and cloned before Connection Manager receives them', async () => {
    const harness = createHarness();
    let execute;
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler(input) {
            execute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });
    await registration.ready;

    const messages = [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hello', name: 'tester' },
    ];
    await execute({ modelId: 'gpt-cmr-test', messages, maxTokens: 20 });
    assert.notStrictEqual(harness.sendCalls[0][1], messages);
    assert.notStrictEqual(harness.sendCalls[0][1][0], messages[0]);
    assert.deepEqual(harness.sendCalls[0][1], messages);

    await assert.rejects(
        execute({
            modelId: 'gpt-cmr-test',
            messages: [{ role: 'user', content: 'hello', apiKey: 'nested-secret' }],
            maxTokens: 20,
        }),
        error => error instanceof ProviderIntegrationError && error.code === 'request_message_field_not_allowed',
    );
    assert.equal(harness.sendCalls.length, 1);
});

test('changing Registry models updates the published list without reinstalling the handler', async () => {
    const harness = createHarness({ modelIds: ['gpt-one'] });
    let installCount = 0;
    let publishCount = 0;
    let publicationDisposals = 0;
    const updates = [];
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler() {
            installCount += 1;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            publishCount += 1;
            return createValidPublicationReceipt({
                onDispose: () => {
                    publicationDisposals += 1;
                },
                updateModels: async (models, options) => {
                    updates.push({ models, options });
                    return true;
                },
            });
        },
    });
    await registration.ready;
    harness.setRegistry(createRegistry('openai', 'gpt-one', 'gpt-two'));
    await harness.controller.sync();

    assert.equal(installCount, 1);
    assert.equal(publishCount, 1);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].models.map(model => model.id), ['gpt-one', 'gpt-two']);
    assert.ok(updates[0].options.signal instanceof AbortSignal);
    assert.equal(harness.controller.getMetrics().publishedModelCount, 2);

    harness.setRegistry(createRegistry('openai'));
    await harness.controller.sync();
    assert.deepEqual(harness.controller.getMetrics(), {
        consumerCount: 1,
        pendingCount: 0,
        readyCount: 0,
        failedCount: 0,
        publishedModelCount: 0,
    });
    assert.equal(publicationDisposals, 1);
});

test('destroy returns while install is pending, aborts its signal, and disposes a late frozen receipt once', async () => {
    const harness = createHarness();
    const lateHandler = deferred();
    let installSignal;
    let publishCount = 0;
    let handlerDisposals = 0;
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        installHandler(input) {
            installSignal = input.signal;
            return lateHandler.promise;
        },
        async publishModels() {
            publishCount += 1;
            return createValidPublicationReceipt();
        },
    });
    await waitFor(() => Boolean(installSignal), 'install signal');

    const destroyResult = await Promise.race([
        harness.controller.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('destroy blocked')), 100)),
    ]);
    assert.equal(destroyResult, true);
    assert.equal(installSignal.aborted, true);
    assert.deepEqual(harness.controller.getMetrics(), {
        consumerCount: 0,
        pendingCount: 0,
        readyCount: 0,
        failedCount: 0,
        publishedModelCount: 0,
    });

    lateHandler.resolve(createValidHandlerReceipt(() => {
        handlerDisposals += 1;
    }));
    await registration.ready;
    assert.equal(handlerDisposals, 1);
    assert.equal(publishCount, 0);
    assert.equal(await harness.controller.destroy(), false);
    assert.equal(handlerDisposals, 1);
});

test('destroy during pending publication cleans the handler immediately and the late publication exactly once', async () => {
    const harness = createHarness();
    const latePublication = deferred();
    let publishSignal;
    let handlerDisposals = 0;
    let publicationDisposals = 0;
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler() {
            return createValidHandlerReceipt(() => {
                handlerDisposals += 1;
            });
        },
        publishModels(input) {
            publishSignal = input.signal;
            return latePublication.promise;
        },
    });
    await waitFor(() => Boolean(publishSignal), 'publication signal');
    await harness.controller.destroy();
    assert.equal(publishSignal.aborted, true);
    assert.equal(handlerDisposals, 1);

    latePublication.resolve(createValidPublicationReceipt({
        onDispose: () => {
            publicationDisposals += 1;
        },
    }));
    await registration.ready;
    assert.equal(publicationDisposals, 1);
    assert.equal(handlerDisposals, 1);
});

test('disposing a ready consumer aborts in-flight requests and cleans both receipts once', async () => {
    let requestSignal;
    const abortSentinel = 'abort-secret-endpoint-and-key';
    const lateBackend = deferred();
    const harness = createHarness({
        sendRequest: async (_profileId, _prompt, _maxTokens, options) => {
            requestSignal = options.signal;
            return await lateBackend.promise;
        },
    });
    let execute;
    let handlerDisposals = 0;
    let publicationDisposals = 0;
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler(input) {
            execute = input.execute;
            return createValidHandlerReceipt(() => {
                handlerDisposals += 1;
            });
        },
        async publishModels() {
            return createValidPublicationReceipt({
                onDispose: () => {
                    publicationDisposals += 1;
                },
            });
        },
    });
    await registration.ready;
    const execution = execute({ modelId: 'gpt-cmr-test', prompt: 'long request', maxTokens: 10 });
    await waitFor(() => Boolean(requestSignal), 'request signal');
    assert.equal(registration.dispose(), true);
    lateBackend.resolve({ secret: abortSentinel, late: 'success' });
    await assert.rejects(execution, error => (
        error?.name === 'AbortError'
        && !error.message.includes(abortSentinel)
    ));
    await waitFor(() => handlerDisposals === 1 && publicationDisposals === 1, 'consumer cleanup');
    assert.equal(requestSignal.aborted, true);
    assert.equal(handlerDisposals, 1);
    assert.equal(publicationDisposals, 1);

    const preAbortedHarness = createHarness();
    let preAbortedExecute;
    const preAbortedRegistration = preAbortedHarness.controller.api.registerConsumer(createDescriptor({
        consumerId: 'pre-aborted.consumer',
    }), {
        async installHandler(input) {
            preAbortedExecute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });
    await preAbortedRegistration.ready;
    const preAbortedController = new AbortController();
    preAbortedController.abort(new Error(abortSentinel));
    await assert.rejects(
        preAbortedExecute(
            { modelId: 'gpt-cmr-test', prompt: 'must not send', maxTokens: 10 },
            { signal: preAbortedController.signal },
        ),
        error => error?.name === 'AbortError' && !error.message.includes(abortSentinel),
    );
    assert.equal(preAbortedHarness.sendCalls.length, 0);
    await preAbortedHarness.controller.destroy();

    const reentrantHarness = createHarness();
    let reentrantExecute;
    let reentrantRegistration;
    reentrantRegistration = reentrantHarness.controller.api.registerConsumer(createDescriptor({
        consumerId: 'reentrant-signal.consumer',
    }), {
        async installHandler(input) {
            reentrantExecute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });
    await reentrantRegistration.ready;
    const reentrantSignal = {
        aborted: false,
        addEventListener() {
            reentrantRegistration.dispose();
        },
        removeEventListener() {},
    };
    await assert.rejects(
        reentrantExecute(
            { modelId: 'gpt-cmr-test', prompt: 'must not send after dispose', maxTokens: 10 },
            { signal: reentrantSignal },
        ),
        error => error instanceof ProviderIntegrationError && error.code === 'binding_not_ready',
    );
    assert.equal(reentrantHarness.sendCalls.length, 0);
    await reentrantHarness.controller.destroy();

    let uncalledBackendFactoryCount = 0;
    let uncalledRequestSignal;
    const uncalledHarness = createHarness({
        sendRequest: async (_profileId, _prompt, _maxTokens, options) => {
            uncalledRequestSignal = options.signal;
            return () => {
                uncalledBackendFactoryCount += 1;
                return {
                    async next() {
                        return { value: 'unused', done: true };
                    },
                };
            };
        },
    });
    let uncalledExecute;
    const uncalledRegistration = uncalledHarness.controller.api.registerConsumer(createDescriptor({
        consumerId: 'uncalled-stream.consumer',
    }), {
        async installHandler(input) {
            uncalledExecute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });
    await uncalledRegistration.ready;
    const uncalledFactory = await uncalledExecute({
        modelId: 'gpt-cmr-test',
        prompt: 'stream later',
        maxTokens: 10,
        stream: true,
    });
    assert.equal(typeof uncalledFactory, 'function');
    assert.equal(uncalledRequestSignal.aborted, false);
    assert.equal(uncalledRegistration.dispose(), true);
    assert.equal(uncalledRequestSignal.aborted, true);
    assert.throws(
        () => uncalledFactory(),
        error => error?.name === 'AbortError' && !error.message.includes(abortSentinel),
    );
    assert.equal(uncalledBackendFactoryCount, 0);
    await uncalledHarness.controller.destroy();

    for (const scenario of [
        { consumerId: 'late-chunk.consumer', done: false, lifecycle: 'dispose' },
        { consumerId: 'late-completion.consumer', done: true, lifecycle: 'destroy' },
    ]) {
        const lateStep = deferred();
        const lateSentinel = `STREAM_LATE_SECRET_${scenario.done ? 'DONE' : 'CHUNK'}`;
        let streamRequestSignal;
        let nextCount = 0;
        let returnCount = 0;
        const streamHarness = createHarness({
            sendRequest: async (_profileId, _prompt, _maxTokens, options) => {
                streamRequestSignal = options.signal;
                return () => ({
                    next() {
                        nextCount += 1;
                        return lateStep.promise;
                    },
                    async return() {
                        returnCount += 1;
                        return { value: undefined, done: true };
                    },
                });
            },
        });
        let streamExecute;
        const streamRegistration = streamHarness.controller.api.registerConsumer(createDescriptor({
            consumerId: scenario.consumerId,
        }), {
            async installHandler(input) {
                streamExecute = input.execute;
                return createValidHandlerReceipt();
            },
            async publishModels() {
                return createValidPublicationReceipt();
            },
        });
        await streamRegistration.ready;
        const factory = await streamExecute({
            modelId: 'gpt-cmr-test',
            prompt: 'late stream',
            maxTokens: 10,
            stream: true,
        });
        const iterator = factory();
        assert.strictEqual(iterator[Symbol.asyncIterator](), iterator);
        const pendingStep = iterator.next();
        await waitFor(() => nextCount === 1, 'stream next');
        if (scenario.lifecycle === 'dispose') {
            assert.equal(streamRegistration.dispose(), true);
        } else {
            assert.equal(await streamHarness.controller.destroy(), true);
        }
        assert.equal(streamRequestSignal.aborted, true);
        lateStep.resolve({
            value: { secret: lateSentinel },
            done: scenario.done,
        });
        await assert.rejects(
            pendingStep,
            error => error?.name === 'AbortError' && !error.message.includes(lateSentinel),
        );
        await waitFor(() => returnCount === 1, 'underlying stream return');
        assert.equal(returnCount, 1);
        if (scenario.lifecycle === 'dispose') {
            await streamHarness.controller.destroy();
        }
        assert.equal(returnCount, 1);
    }

    const streamErrorSentinel = 'STREAM_FACTORY_ITERATOR_RETURN_SECRET';
    let streamErrorCall = 0;
    let streamErrorReturnCount = 0;
    const streamErrorHarness = createHarness({
        sendRequest: async () => {
            streamErrorCall += 1;
            if (streamErrorCall === 1) {
                return () => {
                    throw new Error(`${streamErrorSentinel}: factory`);
                };
            }
            return () => ({
                next() {
                    if (streamErrorCall === 2) {
                        throw new Error(`${streamErrorSentinel}: next`);
                    }
                    return {
                        get done() {
                            throw new Error(`${streamErrorSentinel}: result getter`);
                        },
                    };
                },
                return() {
                    streamErrorReturnCount += 1;
                    throw new Error(`${streamErrorSentinel}: return`);
                },
            });
        },
    });
    let streamErrorExecute;
    const streamErrorRegistration = streamErrorHarness.controller.api.registerConsumer(createDescriptor({
        consumerId: 'stream-errors.consumer',
    }), {
        async installHandler(input) {
            streamErrorExecute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });
    await streamErrorRegistration.ready;
    const throwingFactory = await streamErrorExecute({
        modelId: 'gpt-cmr-test',
        prompt: 'factory error',
        maxTokens: 10,
        stream: true,
    });
    assert.throws(
        () => throwingFactory(),
        error => (
            error instanceof ProviderIntegrationError
            && error.code === 'backend_stream_failed'
            && !error.message.includes(streamErrorSentinel)
        ),
    );
    const throwingIteratorFactory = await streamErrorExecute({
        modelId: 'gpt-cmr-test',
        prompt: 'iterator error',
        maxTokens: 10,
        stream: true,
    });
    const throwingIterator = throwingIteratorFactory();
    await assert.rejects(
        throwingIterator.next(),
        error => (
            error instanceof ProviderIntegrationError
            && error.code === 'backend_stream_failed'
            && !error.message.includes(streamErrorSentinel)
        ),
    );
    await waitFor(() => streamErrorReturnCount === 1, 'failed iterator return cleanup');
    assert.equal(streamErrorReturnCount, 1);
    const invalidStepFactory = await streamErrorExecute({
        modelId: 'gpt-cmr-test',
        prompt: 'invalid iterator result',
        maxTokens: 10,
        stream: true,
    });
    await assert.rejects(
        invalidStepFactory().next(),
        error => (
            error instanceof ProviderIntegrationError
            && error.code === 'backend_stream_invalid'
            && !error.message.includes(streamErrorSentinel)
        ),
    );
    await waitFor(() => streamErrorReturnCount === 2, 'invalid step iterator cleanup');
    await streamErrorHarness.controller.destroy();
    assert.equal(streamErrorReturnCount, 2);
});

test('a selected profile or provider mismatch makes the old handler stale without mutating main settings', async () => {
    const harness = createHarness();
    const before = structuredClone(harness.mainSettings);
    let execute;
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler(input) {
            execute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });
    await registration.ready;
    harness.setProvider('xai');
    await assert.rejects(
        execute({ modelId: 'gpt-cmr-test', prompt: 'stale', maxTokens: 4 }),
        error => error instanceof ProviderIntegrationError && error.code === 'backend_stale',
    );
    assert.equal(harness.sendCalls.length, 0);
    assert.deepEqual(harness.mainSettings, before);

    const streamSignals = [];
    let backendFactoryCount = 0;
    let backendReturnCount = 0;
    const streamHarness = createHarness({
        sendRequest: async (_profileId, _prompt, _maxTokens, options) => {
            streamSignals.push(options.signal);
            return () => {
                backendFactoryCount += 1;
                return {
                    async next() {
                        return { value: 'must not escape stale profile', done: false };
                    },
                    async return() {
                        backendReturnCount += 1;
                        return { value: undefined, done: true };
                    },
                };
            };
        },
    });
    let streamExecute;
    const streamRegistration = streamHarness.controller.api.registerConsumer(createDescriptor({
        consumerId: 'stale-stream.consumer',
    }), {
        async installHandler(input) {
            streamExecute = input.execute;
            return createValidHandlerReceipt();
        },
        async publishModels() {
            return createValidPublicationReceipt();
        },
    });
    await streamRegistration.ready;
    const staleFactory = await streamExecute({
        modelId: 'gpt-cmr-test',
        prompt: 'profile changes before factory',
        maxTokens: 4,
        stream: true,
    });
    streamHarness.setProvider('xai');
    assert.throws(
        () => staleFactory(),
        error => error instanceof ProviderIntegrationError && error.code === 'backend_stale',
    );
    assert.equal(streamSignals[0].aborted, true);
    assert.equal(backendFactoryCount, 0);

    streamHarness.setProvider('openai');
    const staleIteratorFactory = await streamExecute({
        modelId: 'gpt-cmr-test',
        prompt: 'profile changes before next',
        maxTokens: 4,
        stream: true,
    });
    const staleIterator = staleIteratorFactory();
    streamHarness.setProvider('xai');
    await assert.rejects(
        staleIterator.next(),
        error => error instanceof ProviderIntegrationError && error.code === 'backend_stale',
    );
    assert.equal(streamSignals[1].aborted, true);
    await waitFor(() => backendReturnCount === 1, 'stale stream return');
    assert.equal(backendFactoryCount, 1);
    assert.equal(backendReturnCount, 1);
    await streamHarness.controller.destroy();
    assert.equal(backendReturnCount, 1);
});

test('diagnostics expose counts only and mark failed bindings as a warning', () => {
    assert.deepEqual(diagnoseProviderIntegrations({
        consumerCount: 2,
        pendingCount: 1,
        readyCount: 3,
        failedCount: 0,
        publishedModelCount: 7,
        profileId: 'must-not-leak',
        apiKey: 'must-not-leak',
    }), {
        id: 'external-provider-integrations',
        category: 'external',
        status: 'passed',
        message: '공용 provider hook 2곳 · 준비된 provider binding 3개',
        details: {
            consumerCount: 2,
            pendingCount: 1,
            readyCount: 3,
            failedCount: 0,
            publishedModelCount: 7,
        },
    });
    assert.equal(diagnoseProviderIntegrations({ failedCount: 1 }).status, 'warning');
});

test('consumer listener and disposer errors are replaced with stable secret-free public errors', async () => {
    const harness = createHarness();
    const sentinel = 'EXTERNAL_CALLBACK_SECRET_SENTINEL';
    const events = [];
    harness.controller.api.subscribe(event => {
        events.push(event);
        throw new Error(`${sentinel}: listener`);
    });
    const registration = harness.controller.api.registerConsumer(createDescriptor(), {
        async installHandler() {
            return createValidHandlerReceipt(() => {
                throw new Error(`${sentinel}: handler dispose`);
            });
        },
        async publishModels() {
            return createValidPublicationReceipt({
                onDispose: () => {
                    throw new Error(`${sentinel}: publication dispose`);
                },
            });
        },
    });
    const snapshot = await registration.ready;
    assert.equal(registration.dispose(), true);
    await waitFor(() => harness.errors.length >= 4, 'sanitized callback errors');

    assert.ok(harness.errors.every(error => error instanceof ProviderIntegrationError));
    assert.ok(harness.errors.every(error => [
        'consumer_listener_failed',
        'consumer_dispose_failed',
    ].includes(error.code)));
    assert.equal(harness.errors.some(error => error.message.includes(sentinel)), false);
    assert.equal(JSON.stringify(harness.errors).includes(sentinel), false);
    assert.equal(JSON.stringify(events).includes(sentinel), false);
    assert.equal(JSON.stringify(snapshot).includes(sentinel), false);

    const hangingHarness = createHarness({ disposeTimeoutMs: 5 });
    let hangingHandlerDisposals = 0;
    const hangingRegistration = hangingHarness.controller.api.registerConsumer(createDescriptor({
        consumerId: 'hanging.disposer',
    }), {
        async installHandler() {
            return createValidHandlerReceipt(() => {
                hangingHandlerDisposals += 1;
            });
        },
        async publishModels() {
            return createValidPublicationReceipt({
                onDispose: () => new Promise(() => {}),
            });
        },
    });
    await hangingRegistration.ready;
    await hangingHarness.controller.destroy();
    assert.equal(hangingHandlerDisposals, 1);
    assert.equal(hangingHarness.errors.some(error => error.code === 'consumer_dispose_timeout'), true);

    const accessorHarness = createHarness({ disposeTimeoutMs: 5 });
    const accessorSentinel = 'DISPOSE_GETTER_SECRET_SENTINEL';
    const accessorRegistration = accessorHarness.controller.api.registerConsumer(createDescriptor({
        consumerId: 'accessor.disposer',
    }), {
        async installHandler() {
            return {
                requestHandlerBound: true,
                handlerToken: 'accessor-token',
                get dispose() {
                    throw new Error(accessorSentinel);
                },
            };
        },
        async publishModels() {
            assert.fail('invalid handler receipt must not publish models');
        },
    });
    const accessorSnapshot = await accessorRegistration.ready;
    assert.equal(accessorSnapshot.bindings[0].status, 'failed');
    assert.equal(accessorHarness.controller.getMetrics().pendingCount, 0);
    assert.equal(accessorHarness.controller.getMetrics().failedCount, 1);
    await accessorHarness.controller.destroy();
    assert.equal(JSON.stringify(accessorHarness.errors).includes(accessorSentinel), false);
});

test('sync queue reports a stable error and recovers after an unexpected reconciliation failure', async () => {
    const sentinel = 'REGISTRY_READER_SECRET_SENTINEL';
    let failRead = true;
    const errors = [];
    const contextHarness = createHarness();
    const controller = createProviderIntegrationController({
        readRegistrySettings() {
            if (failRead) {
                throw new Error(sentinel);
            }
            return createRegistry('openai', 'gpt-recovered');
        },
        getContext: () => contextHarness.context,
        onError: error => errors.push(error),
    });
    let publishCount = 0;
    const registration = controller.api.registerConsumer(createDescriptor({
        consumerId: 'sync.recovery',
    }), {
        async installHandler() {
            return createValidHandlerReceipt();
        },
        async publishModels() {
            publishCount += 1;
            return createValidPublicationReceipt();
        },
    });

    await assert.rejects(
        registration.ready,
        error => (
            error instanceof ProviderIntegrationError
            && error.code === 'reconcile_failed'
            && !error.message.includes(sentinel)
        ),
    );
    await waitFor(() => errors.length === 1, 'sanitized reconciliation error');
    assert.equal(errors[0].code, 'reconcile_failed');
    assert.equal(errors[0].message.includes(sentinel), false);

    failRead = false;
    await controller.api.refresh();
    assert.equal(publishCount, 1);
    assert.equal(controller.getMetrics().readyCount, 1);
});
