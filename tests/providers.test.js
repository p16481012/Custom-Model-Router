import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MODEL_PROVIDERS,
    STRUCTURAL_EXCLUSIONS,
    getProvider,
    getProviders,
    isSupportedProvider,
} from '../src/providers.js';

const EXPECTED_CONTROLS = {
    openai: ['#model_openai_select', 'openai_model'],
    claude: ['#model_claude_select', 'claude_model'],
    makersuite: ['#model_google_select', 'google_model'],
    vertexai: ['#model_vertexai_select', 'vertexai_model'],
    xai: ['#model_xai_select', 'xai_model'],
    zai: ['#model_zai_select', 'zai_model'],
    deepseek: ['#model_deepseek_select', 'deepseek_model'],
    moonshot: ['#model_moonshot_select', 'moonshot_model'],
    minimax: ['#model_minimax_select', 'minimax_model'],
    mistralai: ['#model_mistralai_select', 'mistralai_model'],
    groq: ['#model_groq_select', 'groq_model'],
    siliconflow: ['#model_siliconflow_select', 'siliconflow_model'],
    workers_ai: ['#model_workers_ai_select', 'workers_ai_model'],
    fireworks: ['#model_fireworks_select', 'fireworks_model'],
    chutes: ['#model_chutes_select', 'chutes_model'],
    electronhub: ['#model_electronhub_select', 'electronhub_model'],
    nanogpt: ['#model_nanogpt_select', 'nanogpt_model'],
    aimlapi: ['#model_aimlapi_select', 'aimlapi_model'],
    openrouter: ['#model_openrouter_select', 'openrouter_model'],
    ai21: ['#model_ai21_select', 'ai21_model'],
    cohere: ['#model_cohere_select', 'cohere_model'],
    perplexity: ['#model_perplexity_select', 'perplexity_model'],
    pollinations: ['#model_pollinations_select', 'pollinations_model'],
    custom: ['#custom_model_id', 'custom_model'],
};

test('SillyTavern 1.18 Chat Completion 제공업체의 selector와 저장 키를 선언한다', () => {
    assert.equal(MODEL_PROVIDERS.length, 24);
    assert.deepEqual(
        MODEL_PROVIDERS.map(provider => provider.id),
        Object.keys(EXPECTED_CONTROLS),
    );

    for (const provider of MODEL_PROVIDERS) {
        assert.deepEqual(
            [provider.selector, provider.settingKey],
            EXPECTED_CONTROLS[provider.id],
            `${provider.id} 연결 정보가 일치해야 한다`,
        );
        assert.equal(provider.mainApi, 'openai');
        assert.equal(provider.source, provider.id);
        assert.equal(provider.settingsProperty, 'chatCompletionSettings');
    }
});

test('Google path segment 규칙과 Custom 자유 입력 이벤트를 구분한다', () => {
    assert.deepEqual(getProvider('vertexai'), {
        id: 'vertexai',
        label: 'Google Vertex AI',
        kind: 'remote',
        protocol: 'vertex-gemini',
        mainApi: 'openai',
        source: 'vertexai',
        settingsProperty: 'chatCompletionSettings',
        settingKey: 'vertexai_model',
        selector: '#model_vertexai_select',
        controlType: 'select',
        validator: 'path-segment',
        applyEvent: 'change',
        placeholder: 'gemini-x.y-pro-preview',
        fallbackModelIds: ['gemini-2.5-pro'],
    });
    assert.equal(getProvider('makersuite').settingKey, 'google_model');
    assert.equal(getProvider('zai').label, 'Z.AI (GLM)');
    assert.equal(getProvider('moonshot').label, 'Moonshot AI (Kimi)');
    assert.equal(getProvider('custom').controlType, 'input');
    assert.equal(getProvider('custom').applyEvent, 'input');
});

test('구조적으로 등록할 수 없는 연결을 명시적으로 회계 처리한다', () => {
    assert.deepEqual(STRUCTURAL_EXCLUSIONS, {
        azure_openai: 'deployment-name-controls-target',
        cometapi: 'core-disabled',
    });
    assert.equal(isSupportedProvider('azure_openai'), false);
    assert.equal(isSupportedProvider('cometapi'), false);
    assert.equal(Object.isFrozen(STRUCTURAL_EXCLUSIONS), true);
});

test('모든 제공업체 descriptor가 Chat Completion 설정만 가리킨다', () => {
    assert.equal(getProviders().every(provider => provider.settingsProperty === 'chatCompletionSettings'), true);
});

test('descriptor와 fallback 배열은 런타임에서 변경할 수 없다', () => {
    const provider = getProvider('openai');
    assert.equal(Object.isFrozen(provider), true);
    assert.equal(Object.isFrozen(provider.fallbackModelIds), true);
    assert.throws(() => provider.fallbackModelIds.push('tampered'));
});
