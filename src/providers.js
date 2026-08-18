export const PROVIDER_IDS = Object.freeze({
    OPENAI: 'openai',
    CLAUDE: 'claude',
    OPENROUTER: 'openrouter',
    AI21: 'ai21',
    MAKERSUITE: 'makersuite',
    VERTEXAI: 'vertexai',
    MISTRALAI: 'mistralai',
    COHERE: 'cohere',
    PERPLEXITY: 'perplexity',
    GROQ: 'groq',
    ELECTRONHUB: 'electronhub',
    CHUTES: 'chutes',
    NANOGPT: 'nanogpt',
    DEEPSEEK: 'deepseek',
    AIMLAPI: 'aimlapi',
    XAI: 'xai',
    POLLINATIONS: 'pollinations',
    MOONSHOT: 'moonshot',
    FIREWORKS: 'fireworks',
    COMETAPI: 'cometapi',
    AZURE_OPENAI: 'azure_openai',
    ZAI: 'zai',
    SILICONFLOW: 'siliconflow',
    WORKERS_AI: 'workers_ai',
    MINIMAX: 'minimax',
    CUSTOM: 'custom',
});

export const MODEL_ID_MAX_LENGTH = 128;
export const CATALOG_MODEL_ID_MAX_LENGTH = 256;

const CLOUD_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const PATH_SEGMENT_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CATALOG_MODEL_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9._:/+@-]*$/;

function freezeDescriptor(descriptor) {
    return Object.freeze({
        kind: 'remote',
        protocol: 'openai-chat-completions',
        mainApi: 'openai',
        source: descriptor.id,
        settingsProperty: 'chatCompletionSettings',
        controlType: 'select',
        validator: 'catalog',
        applyEvent: 'change',
        ...descriptor,
        fallbackModelIds: Object.freeze([...(descriptor.fallbackModelIds ?? [])]),
    });
}

/**
 * SillyTavern 1.18의 Chat Completion 모델 컨트롤과 저장 키를 한곳에 모은다.
 * 인증·엔드포인트는 descriptor에 포함하지 않으며 확장은 모델 값만 다룬다.
 */
export const MODEL_PROVIDERS = Object.freeze([
    freezeDescriptor({
        id: PROVIDER_IDS.OPENAI,
        label: 'OpenAI',
        settingKey: 'openai_model',
        selector: '#model_openai_select',
        validator: 'cloud',
        placeholder: 'gpt-새로운-모델',
        fallbackModelIds: ['gpt-4-turbo'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.CLAUDE,
        label: 'Anthropic',
        protocol: 'anthropic-messages',
        settingKey: 'claude_model',
        selector: '#model_claude_select',
        validator: 'cloud',
        placeholder: 'claude-새로운-모델',
        fallbackModelIds: ['claude-sonnet-4-5'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.MAKERSUITE,
        label: 'Google AI Studio',
        protocol: 'google-gemini',
        source: 'makersuite',
        settingKey: 'google_model',
        selector: '#model_google_select',
        validator: 'path-segment',
        placeholder: 'gemini-x.y-pro-preview',
        fallbackModelIds: ['gemini-2.5-pro'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.VERTEXAI,
        label: 'Google Vertex AI',
        protocol: 'vertex-gemini',
        settingKey: 'vertexai_model',
        selector: '#model_vertexai_select',
        validator: 'path-segment',
        placeholder: 'gemini-x.y-pro-preview',
        fallbackModelIds: ['gemini-2.5-pro'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.XAI,
        label: 'xAI',
        settingKey: 'xai_model',
        selector: '#model_xai_select',
        validator: 'cloud',
        placeholder: 'grok-새로운-모델',
        fallbackModelIds: ['grok-3-beta'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.ZAI,
        label: 'Z.AI (GLM)',
        settingKey: 'zai_model',
        selector: '#model_zai_select',
        validator: 'cloud',
        placeholder: 'glm-새로운-모델',
        fallbackModelIds: ['glm-4.6'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.DEEPSEEK,
        label: 'DeepSeek',
        settingKey: 'deepseek_model',
        selector: '#model_deepseek_select',
        validator: 'cloud',
        placeholder: 'deepseek-새로운-모델',
        fallbackModelIds: ['deepseek-v4-flash'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.MOONSHOT,
        label: 'Moonshot AI (Kimi)',
        settingKey: 'moonshot_model',
        selector: '#model_moonshot_select',
        validator: 'cloud',
        placeholder: 'kimi-새로운-모델',
        fallbackModelIds: ['kimi-latest'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.MINIMAX,
        label: 'MiniMax',
        settingKey: 'minimax_model',
        selector: '#model_minimax_select',
        validator: 'cloud',
        placeholder: 'MiniMax-새로운-모델',
        fallbackModelIds: ['MiniMax-M2.7'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.MISTRALAI,
        label: 'Mistral AI',
        settingKey: 'mistralai_model',
        selector: '#model_mistralai_select',
        placeholder: 'mistral-새로운-모델',
        fallbackModelIds: ['mistral-large-latest'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.GROQ,
        label: 'Groq',
        settingKey: 'groq_model',
        selector: '#model_groq_select',
        placeholder: '조직/새로운-모델',
        fallbackModelIds: ['llama-3.3-70b-versatile'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.SILICONFLOW,
        label: 'SiliconFlow',
        settingKey: 'siliconflow_model',
        selector: '#model_siliconflow_select',
        placeholder: '조직/새로운-모델',
        fallbackModelIds: ['deepseek-ai/DeepSeek-V3'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.WORKERS_AI,
        label: 'Cloudflare Workers AI',
        settingKey: 'workers_ai_model',
        selector: '#model_workers_ai_select',
        placeholder: '@cf/조직/새로운-모델',
        fallbackModelIds: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.FIREWORKS,
        label: 'Fireworks AI',
        settingKey: 'fireworks_model',
        selector: '#model_fireworks_select',
        placeholder: 'accounts/조직/models/새로운-모델',
        fallbackModelIds: ['accounts/fireworks/models/kimi-k2-instruct'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.CHUTES,
        label: 'Chutes',
        settingKey: 'chutes_model',
        selector: '#model_chutes_select',
        placeholder: '조직/새로운-모델',
        fallbackModelIds: ['deepseek-ai/DeepSeek-V3-0324'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.ELECTRONHUB,
        label: 'ElectronHub',
        settingKey: 'electronhub_model',
        selector: '#model_electronhub_select',
        placeholder: '조직/새로운-모델',
        fallbackModelIds: ['gpt-4o-mini'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.NANOGPT,
        label: 'NanoGPT',
        settingKey: 'nanogpt_model',
        selector: '#model_nanogpt_select',
        placeholder: '조직/새로운-모델',
        fallbackModelIds: ['gpt-4o-mini'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.AIMLAPI,
        label: 'AI/ML API',
        settingKey: 'aimlapi_model',
        selector: '#model_aimlapi_select',
        placeholder: '조직/새로운-모델',
        fallbackModelIds: ['chatgpt-4o-latest'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.OPENROUTER,
        label: 'OpenRouter',
        settingKey: 'openrouter_model',
        selector: '#model_openrouter_select',
        placeholder: '조직/새로운-모델:변형',
        fallbackModelIds: ['OR_Website'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.AI21,
        label: 'AI21',
        protocol: 'ai21-chat',
        settingKey: 'ai21_model',
        selector: '#model_ai21_select',
        validator: 'cloud',
        placeholder: 'jamba-새로운-모델',
        fallbackModelIds: ['jamba-large'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.COHERE,
        label: 'Cohere',
        protocol: 'cohere-chat',
        settingKey: 'cohere_model',
        selector: '#model_cohere_select',
        validator: 'cloud',
        placeholder: 'command-새로운-모델',
        fallbackModelIds: ['command-r-plus'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.PERPLEXITY,
        label: 'Perplexity',
        settingKey: 'perplexity_model',
        selector: '#model_perplexity_select',
        validator: 'cloud',
        placeholder: 'sonar-새로운-모델',
        fallbackModelIds: ['sonar-pro'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.POLLINATIONS,
        label: 'Pollinations',
        settingKey: 'pollinations_model',
        selector: '#model_pollinations_select',
        placeholder: '새로운-모델',
        fallbackModelIds: ['openai'],
    }),
    freezeDescriptor({
        id: PROVIDER_IDS.CUSTOM,
        label: 'Custom OpenAI-compatible',
        kind: 'custom',
        protocol: 'openai-compatible',
        settingKey: 'custom_model',
        selector: '#custom_model_id',
        controlType: 'input',
        applyEvent: 'input',
        placeholder: '사용자 엔드포인트 모델 ID',
    }),
]);

export const STRUCTURAL_EXCLUSIONS = Object.freeze({
    [PROVIDER_IDS.AZURE_OPENAI]: 'deployment-name-controls-target',
    [PROVIDER_IDS.COMETAPI]: 'core-disabled',
});

const PROVIDERS_BY_ID = new Map(MODEL_PROVIDERS.map(provider => [provider.id, provider]));

export function getProvider(providerId) {
    return PROVIDERS_BY_ID.get(String(providerId ?? '')) ?? null;
}

export function isSupportedProvider(providerId) {
    return PROVIDERS_BY_ID.has(String(providerId ?? ''));
}

export function getProviders(options = {}) {
    const kind = options?.kind;
    return kind ? MODEL_PROVIDERS.filter(provider => provider.kind === kind) : [...MODEL_PROVIDERS];
}

export function normalizeProviderId(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function normalizeProviderModelId(value) {
    return String(value ?? '').trim();
}

export function validateProviderModelId(providerId, value) {
    const provider = getProvider(normalizeProviderId(providerId));
    if (!provider) {
        return {
            ok: false,
            code: 'unsupported_provider',
            message: '지원하지 않는 제공업체입니다.',
        };
    }

    const id = normalizeProviderModelId(value);
    if (!id) {
        return {
            ok: false,
            code: 'empty',
            message: '모델 ID를 입력해 주세요.',
        };
    }

    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(id)) {
        return {
            ok: false,
            code: 'model_url_not_allowed',
            message: '모델 ID 입력란에는 URL이 아닌 모델 ID만 입력해 주세요.',
        };
    }

    const maxLength = provider.validator === 'catalog'
        ? CATALOG_MODEL_ID_MAX_LENGTH
        : MODEL_ID_MAX_LENGTH;
    if (id.length > maxLength) {
        return {
            ok: false,
            code: 'too_long',
            message: `모델 ID는 ${maxLength}자 이하여야 합니다.`,
        };
    }

    const pattern = provider.validator === 'path-segment'
        ? PATH_SEGMENT_MODEL_PATTERN
        : (provider.validator === 'catalog' ? CATALOG_MODEL_PATTERN : CLOUD_MODEL_PATTERN);
    if (!pattern.test(id)) {
        return {
            ok: false,
            code: 'invalid_characters',
            message: provider.validator === 'catalog'
                ? '모델 ID에는 영문자, 숫자, 마침표, 밑줄, 콜론, 슬래시, 더하기, @, 하이픈만 사용할 수 있습니다.'
                : (provider.validator === 'path-segment'
                    ? '모델 ID에는 영문자, 숫자, 마침표, 밑줄, 하이픈만 사용할 수 있습니다.'
                    : '모델 ID에는 영문자, 숫자, 마침표, 밑줄, 콜론, 하이픈만 사용할 수 있습니다.'),
        };
    }

    return { ok: true, id, provider };
}
