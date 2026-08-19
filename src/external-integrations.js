import {
    getProviders,
    isSupportedProvider,
    normalizeProviderId,
    validateProviderModelId,
} from './providers.js';

export const EXTERNAL_AUTO_CONFIDENCE_THRESHOLD = 0.72;
// v0.6.5 이하 모듈 import 호환용 상수다. controller는 mode mapping을 사용하지 않는다.
export const EXTERNAL_MAPPING_MANUAL = 'manual';
export const EXTERNAL_MAPPING_DISABLED = 'disabled';
export const EXTERNAL_GROUP_LABEL = '사용자 모델';
export const EXTERNAL_MODEL_SELECTOR = '[data-cmr-external-model="true"]';
export const EXTERNAL_GROUP_SELECTOR = '[data-cmr-external-group="true"]';
export const EXTERNAL_TARGET_LIMIT = 512;
export const EXTERNAL_INJECTED_OPTION_LIMIT = 512;
const EXTERNAL_DATALIST_ATTRIBUTE = 'data-cmr-external-datalist';
const EXTERNAL_DATALIST_PREVIOUS_LIST_ATTRIBUTE = 'data-cmr-previous-list';
const EXTERNAL_DATALIST_HAD_LIST_ATTRIBUTE = 'data-cmr-had-list';
const EXTERNAL_DIRECT_PROVIDER_MARKER = 'direct';

const SAFE_TARGET_ID_PATTERN = /^cmr-ext-[a-f0-9]{8}$/;
const MODEL_WORD_PATTERN = /(?:^|[^a-z0-9])(model|models|llm|engine)(?:$|[^a-z0-9])/i;
const PROVIDER_WORD_PATTERN = /(?:^|[^a-z0-9])(provider|source|vendor|api)(?:$|[^a-z0-9])/i;
const NON_MODEL_FIELD_PATTERN = /(?:^|[^a-z0-9])(azure|url|endpoint|api key|apikey|token|secret|deployment|account|project|region)(?:$|[^a-z0-9])/i;
const UNSAFE_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'date', 'file', 'hidden', 'image', 'month', 'number', 'password', 'radio', 'range', 'reset', 'submit', 'time', 'week']);
const NON_CHAT_MODEL_PATTERNS = Object.freeze([
    { code: 'embedding-model', pattern: /(?:^|[^a-z0-9])(vector(?:s|ization)?|embedding|embeddings)(?:$|[^a-z0-9])/i },
    { code: 'image-generation-model', pattern: /(?:^|[^a-z0-9])(image(?:s)?|vision model|stable diffusion|image generation|image generator|diffusion model|sd model|sd generation)(?:$|[^a-z0-9])/i },
    { code: 'speech-model', pattern: /(?:^|[^a-z0-9])(tts|stt|text to speech|speech to text|voice model|speech model|speech synthesis|transcription|transcribe|whisper)(?:$|[^a-z0-9])/i },
    { code: 'audio-model', pattern: /(?:^|[^a-z0-9])(audio|music generation|sound generation)(?:$|[^a-z0-9])/i },
    { code: 'rerank-model', pattern: /(?:^|[^a-z0-9])(rerank|reranker|ranking model)(?:$|[^a-z0-9])/i },
    { code: 'classifier-model', pattern: /(?:^|[^a-z0-9])(classifier|classification|moderation model)(?:$|[^a-z0-9])/i },
    { code: 'tokenizer-model', pattern: /(?:^|[^a-z0-9])(tokenizer|tokenization model)(?:$|[^a-z0-9])/i },
    { code: 'image-asset-model', pattern: /(?:^|[^a-z0-9])(checkpoint|vae|lora)(?:$|[^a-z0-9])/i },
    { code: 'caption-ollama-model', pattern: /(?:^|[^a-z0-9])caption[^a-z0-9]+ollama[^a-z0-9]+custom[^a-z0-9]+model(?:$|[^a-z0-9])/i },
    { code: 'azure-deployment', pattern: /(?:^|[^a-z0-9])(azure|deployment name|deployment model)(?:$|[^a-z0-9])/i },
]);
const EXPLICIT_PROVIDER_ATTRIBUTES = [
    'data-model-provider',
    'data-api-provider',
    'data-provider',
    'data-source',
    'data-type',
];
const DEFAULT_EXTERNAL_PROVIDER_VALUES = Object.freeze({
    claude: 'anthropic',
    makersuite: 'google',
    mistralai: 'mistral',
});

const PROVIDER_ALIASES = Object.freeze([
    ['vertex ai', 'vertexai'],
    ['vertexai', 'vertexai'],
    ['vertex', 'vertexai'],
    ['google ai studio', 'makersuite'],
    ['makersuite', 'makersuite'],
    ['google generative ai', 'makersuite'],
    ['anthropic', 'claude'],
    ['claude', 'claude'],
    ['openrouter', 'openrouter'],
    ['open router', 'openrouter'],
    ['azure openai', 'azure_openai'],
    ['openai compatible', 'custom'],
    ['openai-compatible', 'custom'],
    ['lm studio', 'custom'],
    ['local api', 'custom'],
    ['openai', 'openai'],
    ['z.ai', 'zai'],
    ['zhipu', 'zai'],
    ['chatglm', 'zai'],
    ['glm', 'zai'],
    ['deepseek', 'deepseek'],
    ['moonshot', 'moonshot'],
    ['kimi', 'moonshot'],
    ['minimax', 'minimax'],
    ['mistral', 'mistralai'],
    ['groq', 'groq'],
    ['grok', 'xai'],
    ['x.ai', 'xai'],
    ['siliconflow', 'siliconflow'],
    ['workers ai', 'workers_ai'],
    ['cloudflare', 'workers_ai'],
    ['fireworks', 'fireworks'],
    ['chutes', 'chutes'],
    ['electronhub', 'electronhub'],
    ['nanogpt', 'nanogpt'],
    ['ai/ml api', 'aimlapi'],
    ['ai21', 'ai21'],
    ['cohere', 'cohere'],
    ['perplexity', 'perplexity'],
    ['pollinations', 'pollinations'],
    ['custom', 'custom'],
    ['gemini', 'makersuite'],
]);

const CORE_CONTROL_IDS = new Set(getProviders().map(provider => (
    provider.selector.startsWith('#') ? provider.selector.slice(1) : ''
)).filter(Boolean));

function tagName(element) {
    return String(element?.tagName ?? '').toUpperCase();
}

function getAttribute(element, name) {
    const value = element?.getAttribute?.(name);
    return value === null || value === undefined ? '' : String(value);
}

function hasAttribute(element, name) {
    try {
        return element?.hasAttribute?.(name) === true;
    } catch {
        return false;
    }
}

function normalizeText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function searchableText(value) {
    return normalizeText(value).toLowerCase().replace(/[_:/.-]+/g, ' ');
}

function getAll(root, selector) {
    try {
        return Array.from(root?.querySelectorAll?.(selector) ?? []);
    } catch {
        return [];
    }
}

function getRootDocument(element, explicitDocument) {
    return explicitDocument ?? element?.ownerDocument ?? globalThis.document;
}

function getOptions(host) {
    if (host?.options) {
        return Array.from(host.options);
    }

    return Array.from(host?.children ?? []).flatMap(child => (
        tagName(child) === 'OPTGROUP' ? Array.from(child.children ?? []) : [child]
    )).filter(child => tagName(child) === 'OPTION');
}

function getSelectedOption(select) {
    const options = getOptions(select);
    return options.find(option => option.selected && String(option.value) === String(select?.value))
        ?? Array.from(select?.selectedOptions ?? [])
            .find(option => String(option.value) === String(select?.value))
        ?? options.find(option => String(option.value) === String(select?.value))
        ?? null;
}

function getLabels(control, documentRef) {
    const direct = Array.from(control?.labels ?? []).map(label => normalizeText(label.textContent));
    if (direct.length) {
        return direct.filter(Boolean);
    }

    const id = normalizeText(control?.id ?? getAttribute(control, 'id'));
    if (!id) {
        return [];
    }

    return getAll(documentRef, 'label')
        .filter(label => getAttribute(label, 'for') === id)
        .map(label => normalizeText(label.textContent))
        .filter(Boolean);
}

function getControlText(control, documentRef) {
    return [
        control?.id,
        control?.name,
        control?.className,
        control?.placeholder,
        control?.title,
        getAttribute(control, 'aria-label'),
        getAttribute(control, 'data-role'),
        getAttribute(control, 'data-control'),
        ...getLabels(control, documentRef),
    ].map(normalizeText).filter(Boolean).join(' ');
}

function hasOwnMarker(element) {
    if (!element) {
        return false;
    }

    const id = normalizeText(element.id ?? getAttribute(element, 'id'));
    return id === 'cmr_settings'
        || id.startsWith('cmr_')
        || getAttribute(element, 'data-cmr-external-model') === 'true'
        || getAttribute(element, 'data-cmr-external-group') === 'true'
        || Boolean(getAttribute(element, 'data-cmr-provider'))
        || getAttribute(element, 'data-cmr-model') === 'true'
        || getAttribute(element, 'data-cmr-owned') === 'true'
        || String(element.className ?? '').split(/\s+/).some(name => name === 'cmr-panel');
}

function isExcludedControl(control, options = {}) {
    const id = normalizeText(control?.id ?? getAttribute(control, 'id'));
    if (CORE_CONTROL_IDS.has(id) || hasOwnMarker(control)) {
        return true;
    }

    let ancestor = control?.parentElement;
    while (ancestor) {
        if (hasOwnMarker(ancestor)) {
            return true;
        }
        ancestor = ancestor.parentElement;
    }

    return typeof options.exclude === 'function' && options.exclude(control) === true;
}

function resolveDatalist(input, documentRef) {
    if (tagName(input?.list) === 'DATALIST') {
        return input.list;
    }

    const listId = normalizeText(getAttribute(input, 'list'));
    return listId ? documentRef?.getElementById?.(listId) ?? null : null;
}

function getReferencingInput(datalist, root, documentRef) {
    const id = normalizeText(datalist?.id ?? getAttribute(datalist, 'id'));
    if (!id) {
        return null;
    }

    return getAll(root ?? documentRef, 'input')
        .find(input => getAttribute(input, 'list') === id) ?? null;
}

function isModelSemantic(control, documentRef) {
    if (getAttribute(control, 'data-model-provider')) {
        return true;
    }
    const explicitRole = searchableText([
        getAttribute(control, 'data-role'),
        getAttribute(control, 'data-control'),
        getAttribute(control, 'data-field'),
    ].join(' '));
    if (MODEL_WORD_PATTERN.test(explicitRole)) {
        return true;
    }

    return MODEL_WORD_PATTERN.test(searchableText(getControlText(control, documentRef)));
}

function isUnavailableControl(control) {
    return control?.disabled === true
        || hasAttribute(control, 'disabled')
        || control?.multiple === true
        || hasAttribute(control, 'multiple')
        || control?.readOnly === true
        || hasAttribute(control, 'readonly');
}

function isSensitiveNonModelField(control, documentRef) {
    return NON_MODEL_FIELD_PATTERN.test(searchableText(getControlText(control, documentRef)));
}

export function isExternalModelControl(control, options = {}) {
    const documentRef = getRootDocument(control, options.documentRef);
    if (!control || isExcludedControl(control, options)) {
        return false;
    }

    const tag = tagName(control);
    if (isUnavailableControl(control) || isSensitiveNonModelField(control, documentRef)) {
        return false;
    }
    if (tag === 'DATALIST') {
        const input = getReferencingInput(control, options.root, documentRef);
        return Boolean(
            input
            && !isExcludedControl(input, options)
            && !isUnavailableControl(input)
            && !isSensitiveNonModelField(input, documentRef)
            && isModelSemantic(input, documentRef),
        );
    }

    if (tag === 'SELECT') {
        return isModelSemantic(control, documentRef);
    }

    if (tag !== 'INPUT') {
        return false;
    }

    const type = normalizeText(control.type ?? getAttribute(control, 'type') ?? 'text').toLowerCase();
    return !UNSAFE_INPUT_TYPES.has(type) && isModelSemantic(control, documentRef);
}

function findProviderAliases(value) {
    const text = searchableText(value);
    if (!text) {
        return [];
    }

    const matches = [];
    const matchedAliases = [];
    for (const [alias, providerId] of PROVIDER_ALIASES) {
        const normalizedAlias = searchableText(alias);
        const pattern = new RegExp(`(?:^|[^a-z0-9])${normalizedAlias.replace(/\s+/g, '[^a-z0-9]+')}(?:$|[^a-z0-9])`, 'i');
        const shadowedBySpecificAlias = matchedAliases.some(match => (
            match.providerId !== providerId
            && match.alias.includes(normalizedAlias)
        ));
        if (pattern.test(text) && !shadowedBySpecificAlias && isSupportedProvider(providerId) && !matches.includes(providerId)) {
            matches.push(providerId);
            matchedAliases.push({ alias: normalizedAlias, providerId });
        }
    }
    return matches;
}

function addEvidence(store, providerId, score, source, value, externalProviderValue = null) {
    if (!isSupportedProvider(providerId)) {
        return;
    }

    const evidence = store.get(providerId) ?? [];
    evidence.push({
        source,
        score,
        value: normalizeText(value).slice(0, 160),
        externalProviderValue: normalizeText(externalProviderValue) || null,
    });
    store.set(providerId, evidence);
}

function addTextEvidence(store, value, score, source, externalProviderValue = null) {
    for (const providerId of findProviderAliases(value)) {
        addEvidence(store, providerId, score, source, value, externalProviderValue);
    }
}

function getExplicitProviderEvidence(control, store) {
    for (const attribute of EXPLICIT_PROVIDER_ATTRIBUTES) {
        const value = getAttribute(control, attribute);
        if (!value) {
            continue;
        }
        const exactId = normalizeProviderId(value);
        if (isSupportedProvider(exactId)) {
            addEvidence(store, exactId, 0.99, 'explicit-attribute', `${attribute}=${value}`, value);
        } else {
            addTextEvidence(store, value, 0.96, 'explicit-attribute', value);
        }
    }
}

function getExternalControlBoundary(control) {
    const fallback = control?.parentElement ?? null;
    let ancestor = fallback;
    for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
        const id = normalizeText(ancestor.id ?? getAttribute(ancestor, 'id'));
        const hasExtensionMarker = Boolean(
            getAttribute(ancestor, 'data-extension-id')
            || getAttribute(ancestor, 'data-extension-name')
            || getAttribute(ancestor, 'data-name'),
        );
        const isSemanticContainer = /(?:^|[_-])(container|settings|panel|drawer|extension|form)(?:$|[_-])/i.test(id);
        const isBoundaryElement = ['SECTION', 'FIELDSET', 'FORM', 'DIALOG'].includes(tagName(ancestor));
        if (hasExtensionMarker || isSemanticContainer || isBoundaryElement) {
            return ancestor;
        }
        if (['BODY', 'HTML'].includes(tagName(ancestor)) || ancestor.nodeType === 9) {
            break;
        }
    }
    return fallback;
}

function getConnectedProviderSelect(control, documentRef) {
    const referenceId = normalizeText(
        getAttribute(control, 'data-provider-select')
        || getAttribute(control, 'data-source-select'),
    );
    if (referenceId) {
        const explicit = documentRef?.getElementById?.(referenceId);
        if (tagName(explicit) === 'SELECT') {
            return explicit;
        }
    }

    // 공통 Extensions root까지 올라가면 이웃 확장의 provider를 잘못 연결할 수 있다.
    // 가장 가까운 확장/패널 경계 안에서만 암시적 provider control을 찾는다.
    const boundary = getExternalControlBoundary(control);
    return getAll(boundary, 'select')
        .filter(candidate => candidate !== control)
        .find(candidate => (
            PROVIDER_WORD_PATTERN.test(searchableText(getControlText(candidate, documentRef)))
        )) ?? null;
}

function getConnectedProviderEvidence(control, documentRef, store) {
    const providerSelect = getConnectedProviderSelect(control, documentRef);
    if (!providerSelect) {
        return;
    }

    const selectedOption = getSelectedOption(providerSelect);
    for (const attribute of EXPLICIT_PROVIDER_ATTRIBUTES) {
        const value = getAttribute(selectedOption, attribute);
        if (value) {
            addTextEvidence(store, value, 0.99, 'connected-provider-select', value);
        }
    }
    const externalProviderValue = normalizeText(selectedOption?.value ?? providerSelect.value);
    addTextEvidence(
        store,
        [selectedOption?.value, selectedOption?.textContent, providerSelect.value].join(' '),
        0.97,
        'connected-provider-select',
        externalProviderValue,
    );
}

function getOptionEvidence(control, store) {
    const optionHost = tagName(control) === 'INPUT'
        ? resolveDatalist(control, control.ownerDocument)
        : control;
    for (const option of getOptions(optionHost)) {
        for (const attribute of ['data-provider', 'data-api-provider', 'data-source', 'data-type']) {
            const value = getAttribute(option, attribute);
            if (value) {
                addTextEvidence(store, value, option.selected ? 0.88 : 0.76, 'option-data-type', value);
            }
        }
    }
}

export function inferExternalProvider(control, options = {}) {
    const documentRef = getRootDocument(control, options.documentRef);
    const evidenceByProvider = new Map();
    getExplicitProviderEvidence(control, evidenceByProvider);
    getConnectedProviderEvidence(control, documentRef, evidenceByProvider);
    addTextEvidence(evidenceByProvider, getControlText(control, documentRef), 0.74, 'id-name-label');
    getOptionEvidence(control, evidenceByProvider);

    const candidates = [...evidenceByProvider.entries()].map(([providerId, evidence]) => {
        const ordered = [...evidence].sort((left, right) => right.score - left.score);
        const corroboration = new Set(ordered.map(item => item.source)).size - 1;
        return {
            providerId,
            confidence: Math.min(1, ordered[0].score + Math.max(0, corroboration) * 0.04),
            source: ordered[0].source,
            evidence: ordered,
        };
    }).sort((left, right) => right.confidence - left.confidence || left.providerId.localeCompare(right.providerId));

    const best = candidates[0] ?? null;
    const runnerUp = candidates[1] ?? null;
    const ambiguous = Boolean(best && runnerUp && Math.abs(best.confidence - runnerUp.confidence) < 0.08);
    return {
        providerId: best && !ambiguous ? best.providerId : null,
        confidence: best?.confidence ?? 0,
        source: ambiguous ? 'ambiguous' : (best?.source ?? 'none'),
        evidence: best?.evidence ?? [],
        externalProviderValue: ambiguous
            ? null
            : (best?.evidence.find(item => item.externalProviderValue)?.externalProviderValue ?? null),
        candidates,
    };
}

function getRiskText(control, documentRef) {
    const parts = [getControlText(control, documentRef)];
    let ancestor = control?.parentElement;
    for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
        parts.push([
            ancestor.id,
            ancestor.className,
            getAttribute(ancestor, 'aria-label'),
            getAttribute(ancestor, 'data-extension-name'),
            getAttribute(ancestor, 'data-name'),
        ].map(normalizeText).filter(Boolean).join(' '));
    }
    return searchableText(parts.join(' '));
}

export function assessExternalTargetRisk(control, options = {}) {
    const documentRef = getRootDocument(control, options.documentRef);
    const text = getRiskText(control, documentRef);
    // SillyTavern Caption의 멀티모달 Chat Completion 모델은 이름에 image가 포함될 수 있다.
    const explicitChatCompletion = /caption[^a-z0-9]+multimodal[^a-z0-9]+model/i.test(text);
    if (!explicitChatCompletion) {
        for (const rule of NON_CHAT_MODEL_PATTERNS) {
            if (rule.pattern.test(text)) {
                return {
                    level: 'blocked',
                    excludedReason: rule.code,
                    signals: [rule.code],
                };
            }
        }
    }
    return { level: 'none', excludedReason: null, signals: [] };
}

function getStableAncestorHint(control) {
    let ancestor = control?.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
        const hint = [
            ancestor.id,
            getAttribute(ancestor, 'data-extension-id'),
            getAttribute(ancestor, 'data-extension-name'),
            getAttribute(ancestor, 'data-name'),
        ].map(normalizeText).find(Boolean);
        if (hint) {
            return `${tagName(ancestor)}:${hint}`;
        }
    }
    return '';
}

function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value)) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function createExternalTargetId(control, options = {}) {
    const documentRef = getRootDocument(control, options.documentRef);
    const controlId = normalizeText(control?.id ?? getAttribute(control, 'id'));
    const controlName = normalizeText(control?.name ?? getAttribute(control, 'name'));
    const labels = getLabels(control, documentRef);
    const placeholder = normalizeText(control?.placeholder);
    const currentListId = normalizeText(getAttribute(control, 'list'));
    const currentList = currentListId ? documentRef?.getElementById?.(currentListId) : null;
    const isOwnedList = getAttribute(currentList, EXTERNAL_DATALIST_ATTRIBUTE) === 'true'
        || currentListId.startsWith('cmr_external_models_');
    const stableListId = isOwnedList
        ? normalizeText(getAttribute(currentList, EXTERNAL_DATALIST_PREVIOUS_LIST_ATTRIBUTE))
        : currentListId;
    const needsListIdentity = !controlId && !controlName && labels.length === 0 && !placeholder;
    const identity = [
        getStableAncestorHint(control),
        tagName(control),
        controlId,
        controlName,
        needsListIdentity ? stableListId : '',
        labels.join('|'),
        placeholder,
    ].join('\u001f');
    return `cmr-ext-${fnv1a(identity)}`;
}

function describeControl(control, root, documentRef, options) {
    const tag = tagName(control);
    const referencingInput = tag === 'DATALIST'
        ? getReferencingInput(control, root, documentRef)
        : null;
    const effectiveControl = referencingInput ?? control;
    const optionHost = tag === 'SELECT'
        ? control
        : (tag === 'DATALIST' ? control : resolveDatalist(control, documentRef));
    const labels = getLabels(effectiveControl, documentRef);
    const providerControl = getConnectedProviderSelect(effectiveControl, documentRef);
    const inference = inferExternalProvider(effectiveControl, { ...options, documentRef });
    let risk = assessExternalTargetRisk(effectiveControl, { documentRef });
    const isCaptionSpecialProvider = /caption[^a-z0-9]+multimodal[^a-z0-9]+model/i.test(
        searchableText(getControlText(effectiveControl, documentRef)),
    ) && ['custom', 'ollama'].includes(normalizeProviderId(inference.externalProviderValue));
    if (isCaptionSpecialProvider) {
        risk = {
            level: 'blocked',
            excludedReason: 'caption-special-provider',
            signals: ['caption-special-provider'],
        };
    }
    if (/azure/i.test(normalizeText(inference.externalProviderValue))) {
        risk = {
            level: 'blocked',
            excludedReason: 'azure-deployment',
            signals: ['azure-deployment'],
        };
    }
    return {
        targetId: createExternalTargetId(effectiveControl, { documentRef }),
        control: effectiveControl,
        optionHost,
        controlType: tag === 'DATALIST' || optionHost ? (tag === 'SELECT' ? 'select' : 'datalist') : 'input',
        label: labels[0]
            || normalizeText(getAttribute(effectiveControl, 'aria-label'))
            || normalizeText(effectiveControl.name)
            || normalizeText(effectiveControl.id)
            || '외부 모델 입력란',
        inference,
        risk,
        providerControl,
    };
}

export function discoverExternalModelTargets(root, options = {}) {
    const documentRef = options.documentRef ?? (root?.nodeType === 9 ? root : root?.ownerDocument) ?? globalThis.document;
    const candidates = getAll(root, 'select,input,datalist');
    const targets = [];
    const seenControls = new Set();
    for (const candidate of candidates) {
        if (targets.length >= EXTERNAL_TARGET_LIMIT) {
            break;
        }
        if (!isExternalModelControl(candidate, { ...options, root, documentRef })) {
            continue;
        }
        const target = describeControl(candidate, root, documentRef, options);
        if (seenControls.has(target.control)) {
            continue;
        }
        seenControls.add(target.control);
        targets.push(target);
    }
    return targets;
}

export function normalizeExternalMappings(value) {
    // v0.6.0~v0.6.5 호출부의 호환용 함수다. 단일 직접 연결에서는 대상별 mode가 없다.
    void value;
    return {};
}

export function resolveExternalTargetProvider(target, mappings, options = {}) {
    void mappings;
    void options;
    const isRiskBlocked = target?.risk?.level === 'blocked';
    if (isRiskBlocked) {
        return {
            providerId: null,
            confidence: target?.inference?.confidence ?? 0,
            source: 'risk-blocked',
            excludedReason: target.risk.excludedReason,
        };
    }

    return {
        providerId: null,
        confidence: 1,
        source: 'direct',
    };
}

function isManagedGroup(element) {
    return tagName(element) === 'OPTGROUP' && getAttribute(element, 'data-cmr-external-group') === 'true';
}

function isManagedOption(element) {
    return tagName(element) === 'OPTION' && getAttribute(element, 'data-cmr-external-model') === 'true';
}

function removeElement(element) {
    if (typeof element?.remove === 'function') {
        element.remove();
    } else {
        element?.parentElement?.removeChild?.(element);
    }
}

export function removeExternalTargetModels(target, providerId = null, options = {}) {
    const host = target?.optionHost;
    if (!host) {
        return 0;
    }
    const normalizedProviderId = providerId ? normalizeProviderId(providerId) : null;
    let removed = 0;
    for (const child of Array.from(host.children ?? [])) {
        const childProvider = normalizeProviderId(getAttribute(child, 'data-cmr-provider'));
        if (isManagedGroup(child) && (!normalizedProviderId || childProvider === normalizedProviderId)) {
            removed += getOptions(child).length;
            removeElement(child);
            continue;
        }
        if (isManagedOption(child) && (!normalizedProviderId || childProvider === normalizedProviderId)) {
            removed += 1;
            removeElement(child);
        }
    }
    if (options.removeOwnedHost === true && getAttribute(host, EXTERNAL_DATALIST_ATTRIBUTE) === 'true') {
        const listId = normalizeText(host.id ?? getAttribute(host, 'id'));
        if (listId && getAttribute(target?.control, 'list') === listId) {
            const previousList = getAttribute(host, EXTERNAL_DATALIST_PREVIOUS_LIST_ATTRIBUTE);
            if (getAttribute(host, EXTERNAL_DATALIST_HAD_LIST_ATTRIBUTE) === 'true') {
                target.control.setAttribute?.('list', previousList);
            } else {
                target.control.removeAttribute?.('list');
            }
        }
        removeElement(host);
        target.optionHost = null;
    }
    return removed;
}

function enabledModelIds(providerId, models) {
    return [...new Set((Array.isArray(models) ? models : [])
        .filter(model => model?.enabled !== false)
        .filter(model => !model?.provider || normalizeProviderId(model.provider) === providerId)
        .map(model => validateProviderModelId(providerId, model?.id))
        .filter(validation => validation.ok)
        .map(validation => validation.id))].slice(0, EXTERNAL_INJECTED_OPTION_LIMIT);
}

function getExternalProviderAttributes(target, providerId, options = {}) {
    const host = target?.optionHost;
    let externalProviderValue = normalizeText(options.externalProviderValue);
    if (!externalProviderValue && target?.inference?.providerId === providerId) {
        externalProviderValue = normalizeText(target.inference.externalProviderValue);
    }
    if (!externalProviderValue && target?.providerControl) {
        const matchingProviderOption = getOptions(target.providerControl).find(option => (
            findProviderAliases([option.value, option.textContent].join(' ')).includes(providerId)
        ));
        externalProviderValue = normalizeText(matchingProviderOption?.value);
    }
    externalProviderValue ||= DEFAULT_EXTERNAL_PROVIDER_VALUES[providerId] ?? providerId;
    if (!externalProviderValue) {
        return {};
    }

    const attributes = {};
    for (const attribute of ['data-type', 'data-provider', 'data-api-provider', 'data-source']) {
        const isUsedByNativeOptions = getOptions(host)
            .some(option => !isManagedOption(option) && Boolean(getAttribute(option, attribute)));
        if (isUsedByNativeOptions) {
            attributes[attribute] = externalProviderValue;
        }
    }
    // 명시적인 control 속성은 native option 표본이 없어도 같은 키를 유지한다.
    for (const attribute of ['data-type', 'data-provider', 'data-api-provider', 'data-source']) {
        if (!attributes[attribute] && getAttribute(target?.control, attribute)) {
            attributes[attribute] = externalProviderValue;
        }
    }
    return attributes;
}

function nativeOptionMatchesProvider(option, providerId, externalAttributes) {
    let hasProviderMetadata = false;
    for (const attribute of ['data-type', 'data-provider', 'data-api-provider', 'data-source']) {
        const rawValue = getAttribute(option, attribute);
        if (!rawValue) {
            continue;
        }
        hasProviderMetadata = true;
        const expectedValue = normalizeProviderId(externalAttributes[attribute]);
        const tokens = rawValue.split(',').map(value => normalizeText(value)).filter(Boolean);
        if (tokens.some(token => (
            normalizeProviderId(token) === expectedValue
            || normalizeProviderId(token) === providerId
            || findProviderAliases(token).includes(providerId)
        ))) {
            return true;
        }
    }
    // provider metadata가 없는 일반 select는 모델 ID를 전역 고유값으로 취급한다.
    return !hasProviderMetadata;
}

function createManagedOption(documentRef, providerId, modelId, externalAttributes = {}, label = '') {
    const option = documentRef.createElement('option');
    option.value = modelId;
    option.textContent = label || modelId;
    if (label) {
        option.label = label;
        option.setAttribute?.('label', label);
    }
    option.dataset.cmrExternalModel = 'true';
    option.dataset.cmrProvider = providerId;
    for (const [attribute, value] of Object.entries(externalAttributes)) {
        option.setAttribute?.(attribute, value);
        if (!option.setAttribute && attribute.startsWith('data-')) {
            const key = attribute.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
            option.dataset[key] = value;
        }
    }
    return option;
}

function ensureExternalOptionHost(target, providerMarker, documentRef) {
    let host = target?.optionHost;
    const control = target?.control;
    if (!host && tagName(control) === 'INPUT' && documentRef?.createElement) {
        const previousList = getAttribute(control, 'list');
        const hadList = control.hasAttribute?.('list') ?? Boolean(previousList);
        const datalist = documentRef.createElement('datalist');
        datalist.id = `cmr_external_models_${String(target?.targetId ?? '').replace(/^cmr-ext-/, '')}`;
        datalist.dataset.cmrExternalGroup = 'true';
        datalist.dataset.cmrProvider = providerMarker;
        datalist.setAttribute?.(EXTERNAL_DATALIST_ATTRIBUTE, 'true');
        datalist.setAttribute?.(EXTERNAL_DATALIST_PREVIOUS_LIST_ATTRIBUTE, previousList);
        datalist.setAttribute?.(EXTERNAL_DATALIST_HAD_LIST_ATTRIBUTE, hadList ? 'true' : 'false');
        const parent = control.parentElement ?? documentRef.body;
        parent?.append?.(datalist);
        control.setAttribute?.('list', datalist.id);
        target.optionHost = datalist;
        host = datalist;
    }
    if (host && getAttribute(host, EXTERNAL_DATALIST_ATTRIBUTE) === 'true') {
        host.dataset.cmrProvider = providerMarker;
    }
    return host;
}

export function syncExternalTarget(target, providerId, models, options = {}) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const control = target?.control;
    const documentRef = options.documentRef
        ?? target?.optionHost?.ownerDocument
        ?? control?.ownerDocument
        ?? globalThis.document;
    const host = ensureExternalOptionHost(target, normalizedProviderId, documentRef);
    if (!host || !documentRef?.createElement || !isSupportedProvider(normalizedProviderId)) {
        return { providerId: normalizedProviderId || null, injectedIds: [], nativeIds: [], reason: 'no-option-host' };
    }

    const externalAttributes = getExternalProviderAttributes(target, normalizedProviderId, options);
    const previousValue = String(control?.value ?? '');
    const previousSelectedOption = tagName(host) === 'SELECT' ? getSelectedOption(control) : null;
    const previousProviderId = isManagedOption(previousSelectedOption)
        ? normalizeProviderId(getAttribute(previousSelectedOption, 'data-cmr-provider'))
        : null;
    const nativeIds = new Set(getOptions(host)
        .filter(option => !isManagedOption(option) && !isManagedGroup(option?.parentElement))
        .filter(option => nativeOptionMatchesProvider(option, normalizedProviderId, externalAttributes))
        .map(option => String(option.value)));
    const ids = enabledModelIds(normalizedProviderId, models).filter(id => !nativeIds.has(id));
    removeExternalTargetModels(target);

    if (ids.length) {
        if (tagName(host) === 'SELECT') {
            const group = documentRef.createElement('optgroup');
            group.label = EXTERNAL_GROUP_LABEL;
            group.dataset.cmrExternalGroup = 'true';
            group.dataset.cmrProvider = normalizedProviderId;
            group.append(...ids.map(id => createManagedOption(documentRef, normalizedProviderId, id, externalAttributes)));
            host.append(group);
        } else if (tagName(host) === 'DATALIST') {
            host.append(...ids.map(id => createManagedOption(documentRef, normalizedProviderId, id, externalAttributes)));
        }
    }

    // 옵션 목록 동기화는 외부 확장이 가진 현재 선택/입력값을 변경하지 않는다.
    if (control) {
        const previousManagedOption = previousProviderId
            ? getOptions(host).find(option => (
                isManagedOption(option)
                && normalizeProviderId(getAttribute(option, 'data-cmr-provider')) === previousProviderId
                && String(option.value) === previousValue
            ))
            : null;
        if (String(control.value ?? '') !== previousValue) {
            control.value = previousValue;
        }
        if (previousManagedOption) {
            for (const option of getOptions(host)) {
                option.selected = option === previousManagedOption;
            }
        }
    }
    return {
        providerId: normalizedProviderId,
        injectedIds: ids,
        nativeIds: [...nativeIds],
        reason: null,
    };
}

/**
 * 직접 연결 대상에는 Registry의 모든 제공업체 모델을 함께 표시한다.
 * select는 제공업체별 optgroup을 사용하고, input/datalist는 실제 입력값을 바꾸지 않도록
 * 모델 ID를 value로 유지하면서 provider가 드러나는 label을 붙인다.
 */
export function syncExternalTargetProviders(target, providerEntries, options = {}) {
    const control = target?.control;
    const documentRef = options.documentRef
        ?? target?.optionHost?.ownerDocument
        ?? control?.ownerDocument
        ?? globalThis.document;
    const host = ensureExternalOptionHost(target, EXTERNAL_DIRECT_PROVIDER_MARKER, documentRef);
    if (!host || !documentRef?.createElement) {
        return { injectedModels: [], nativeModels: [], reason: 'no-option-host' };
    }

    const providerById = new Map(getProviders().map(provider => [provider.id, provider]));
    const entries = (Array.isArray(providerEntries) ? providerEntries : [])
        .map(entry => {
            const providerId = normalizeProviderId(entry?.providerId ?? entry?.id);
            return {
                providerId,
                label: normalizeText(entry?.label) || providerById.get(providerId)?.label || providerId,
                models: Array.isArray(entry?.models) ? entry.models : [],
            };
        })
        .filter(entry => isSupportedProvider(entry.providerId));
    const previousValue = String(control?.value ?? '');
    const previousManagedOption = tagName(host) === 'SELECT'
        ? getOptions(host).find(option => (
            option.selected
            && isManagedOption(option)
            && String(option.value) === previousValue
        )) ?? null
        : null;
    const previousProviderId = previousManagedOption
        ? normalizeProviderId(getAttribute(previousManagedOption, 'data-cmr-provider'))
        : null;
    const nativeOptions = getOptions(host)
        .filter(option => !isManagedOption(option) && !isManagedGroup(option?.parentElement));
    const injectedModels = [];
    const nativeModels = [];
    removeExternalTargetModels(target);

    let remaining = EXTERNAL_INJECTED_OPTION_LIMIT;
    for (const entry of entries) {
        if (remaining <= 0) {
            break;
        }
        const externalAttributes = getExternalProviderAttributes(target, entry.providerId, options);
        const nativeIds = new Set(nativeOptions
            .filter(option => nativeOptionMatchesProvider(option, entry.providerId, externalAttributes))
            .map(option => String(option.value)));
        nativeModels.push(...[...nativeIds].map(modelId => ({ providerId: entry.providerId, modelId })));
        const ids = enabledModelIds(entry.providerId, entry.models)
            .filter(id => !nativeIds.has(id))
            .slice(0, remaining);
        remaining -= ids.length;
        if (!ids.length) {
            continue;
        }

        if (tagName(host) === 'SELECT') {
            const group = documentRef.createElement('optgroup');
            group.label = `${entry.label} · ${EXTERNAL_GROUP_LABEL}`;
            group.dataset.cmrExternalGroup = 'true';
            group.dataset.cmrProvider = entry.providerId;
            group.append(...ids.map(id => createManagedOption(
                documentRef,
                entry.providerId,
                id,
                externalAttributes,
            )));
            host.append(group);
        } else if (tagName(host) === 'DATALIST') {
            host.append(...ids.map(id => createManagedOption(
                documentRef,
                entry.providerId,
                id,
                externalAttributes,
                `${entry.label} · ${id}`,
            )));
        }
        injectedModels.push(...ids.map(modelId => ({ providerId: entry.providerId, modelId })));
    }

    if (control) {
        if (String(control.value ?? '') !== previousValue) {
            control.value = previousValue;
        }
        const restoredManagedOption = previousProviderId
            ? getOptions(host).find(option => (
                isManagedOption(option)
                && normalizeProviderId(getAttribute(option, 'data-cmr-provider')) === previousProviderId
                && String(option.value) === previousValue
            ))
            : null;
        if (restoredManagedOption) {
            for (const option of getOptions(host)) {
                option.selected = option === restoredManagedOption;
            }
        }
    }
    return { injectedModels, nativeModels, reason: null };
}

function mutationOnlyTouchesManagedNodes(record) {
    const nodes = [...Array.from(record?.addedNodes ?? []), ...Array.from(record?.removedNodes ?? [])];
    return record?.type === 'childList'
        && nodes.length > 0
        && nodes.every(node => isManagedGroup(node) || isManagedOption(node));
}

function isWithinCmrOwnedTree(node) {
    for (let current = node; current; current = current.parentElement) {
        if (hasOwnMarker(current)) {
            return true;
        }
    }
    return false;
}

function mutationOnlyTouchesCmrUi(record) {
    if (isWithinCmrOwnedTree(record?.target)) {
        return true;
    }
    const nodes = [...Array.from(record?.addedNodes ?? []), ...Array.from(record?.removedNodes ?? [])];
    return record?.type === 'childList'
        && nodes.length > 0
        && nodes.every(node => isWithinCmrOwnedTree(node));
}

function isKnownMutationNode(node, knownControls) {
    for (let current = node?.nodeType === 3 ? node.parentElement : node; current; current = current.parentElement) {
        if (knownControls.has(current)) {
            return true;
        }
    }
    return false;
}

function isPotentialExternalMutationNode(node, root, documentRef, knownControls) {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    if (!element || isWithinCmrOwnedTree(element)) {
        return false;
    }
    if (isKnownMutationNode(element, knownControls)) {
        return true;
    }
    const tag = tagName(element);
    if (['SELECT', 'INPUT', 'DATALIST'].includes(tag)) {
        return isExternalModelControl(element, { root, documentRef })
            || MODEL_WORD_PATTERN.test(searchableText(getControlText(element, documentRef)))
            || PROVIDER_WORD_PATTERN.test(searchableText(getControlText(element, documentRef)));
    }
    if (tag === 'LABEL') {
        const text = searchableText(element.textContent);
        return MODEL_WORD_PATTERN.test(text) || PROVIDER_WORD_PATTERN.test(text);
    }
    if (tag === 'OPTION') {
        return isKnownMutationNode(element.parentElement, knownControls)
            || isPotentialExternalMutationNode(element.parentElement, root, documentRef, knownControls);
    }
    return getAll(element, 'select,input,datalist,label')
        .some(candidate => isPotentialExternalMutationNode(candidate, root, documentRef, knownControls));
}

function isRelevantMutationTarget(node, root, documentRef, knownControls) {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    return isKnownMutationNode(element, knownControls)
        || ['SELECT', 'INPUT', 'DATALIST', 'LABEL', 'OPTION'].includes(tagName(element))
            && isPotentialExternalMutationNode(element, root, documentRef, knownControls);
}

export function mutationNeedsExternalRescan(records, options = {}) {
    const root = options.root ?? globalThis.document;
    const documentRef = options.documentRef ?? (root?.nodeType === 9 ? root : root?.ownerDocument) ?? globalThis.document;
    const knownControls = options.knownControls instanceof Set ? options.knownControls : new Set();
    return (Array.isArray(records) ? records : Array.from(records ?? []))
        .some(record => {
            if (mutationOnlyTouchesManagedNodes(record) || mutationOnlyTouchesCmrUi(record)) {
                return false;
            }
            if (isKnownMutationNode(record?.target, knownControls)) {
                return true;
            }
            if (record?.type === 'attributes' || record?.type === 'characterData') {
                return isPotentialExternalMutationNode(record.target, root, documentRef, knownControls);
            }
            const nodes = [...Array.from(record?.addedNodes ?? []), ...Array.from(record?.removedNodes ?? [])];
            return record?.type === 'childList' && (
                isRelevantMutationTarget(record.target, root, documentRef, knownControls)
                || nodes.some(node => isPotentialExternalMutationNode(node, root, documentRef, knownControls))
            );
        });
}

/**
 * 외부 확장의 DOM을 관찰하는 수명주기 래퍼. 요청(fetch)을 가로채지 않으며,
 * 모델 컨트롤의 선택지와 CMR 등록 모델만 동기화한다.
 */
export function createExternalIntegrationController(options = {}) {
    const root = options.root ?? globalThis.document;
    const observerFactory = options.observerFactory
        ?? (callback => new globalThis.MutationObserver(callback));
    const schedule = options.schedule ?? (callback => {
        if (typeof globalThis.requestAnimationFrame === 'function') {
            globalThis.requestAnimationFrame(callback);
        } else {
            queueMicrotask(callback);
        }
    });
    let observer = null;
    let pending = false;
    let active = false;
    let targets = [];
    let generation = 0;
    const managedTargets = new Map();
    const bindings = new Map();

    function getModels(providerId) {
        try {
            const models = typeof options.getModels === 'function' ? options.getModels(providerId) : options.models;
            return Array.isArray(models) ? models : [];
        } catch {
            return [];
        }
    }

    function getProviderEntries() {
        return getProviders().map(provider => ({
            providerId: provider.id,
            label: provider.label,
            models: getModels(provider.id),
        }));
    }

    function unbindElement(element) {
        const entries = bindings.get(element) ?? [];
        for (const { eventName, handler } of entries) {
            element?.removeEventListener?.(eventName, handler);
        }
        bindings.delete(element);
    }

    function bindElement(element, eventName, handler, bindingKey) {
        if (!element?.addEventListener) {
            return;
        }
        const entries = bindings.get(element) ?? [];
        if (entries.some(entry => entry.bindingKey === bindingKey)) {
            return;
        }
        element.addEventListener(eventName, handler);
        entries.push({ eventName, handler, bindingKey });
        bindings.set(element, entries);
    }

    function dispatchSelectionEvent(control) {
        const eventName = tagName(control) === 'SELECT' ? 'change' : 'input';
        const event = typeof options.eventFactory === 'function'
            ? options.eventFactory(eventName, control)
            : (() => {
                const EventClass = control?.ownerDocument?.defaultView?.Event ?? globalThis.Event;
                return new EventClass(eventName, { bubbles: true });
            })();
        control?.dispatchEvent?.(event);
    }

    function getManagedSelectionIdentity(target) {
        const control = target?.control;
        if (tagName(control) !== 'SELECT') {
            return null;
        }
        const selectedOption = getSelectedOption(control);
        if (!isManagedOption(selectedOption)) {
            return null;
        }
        return {
            providerId: normalizeProviderId(getAttribute(selectedOption, 'data-cmr-provider')),
            modelId: String(selectedOption.value),
        };
    }

    function selectNativeFallbackAndNotify(target) {
        const control = target?.control;
        if (tagName(control) !== 'SELECT') {
            return false;
        }
        const remainingOptions = getOptions(control).filter(option => (
            !isManagedOption(option)
            && !isManagedGroup(option?.parentElement)
            && option.disabled !== true
        ));
        const currentOption = remainingOptions.find(option => (
            String(option.value) === String(control.value ?? '')
        ));
        const fallbackOption = currentOption ?? remainingOptions[0] ?? null;
        for (const option of getOptions(control)) {
            option.selected = option === fallbackOption;
        }
        control.value = fallbackOption ? String(fallbackOption.value) : '';
        dispatchSelectionEvent(control);
        return true;
    }

    function notifySelectionInvalidated(target, selection, reason) {
        if (!selection) {
            return;
        }
        try {
            options.onSelectionInvalidated?.({
                targetId: target.targetId,
                providerId: selection.providerId,
                modelId: selection.modelId,
                reason,
            });
        } catch {
            // 저장 콜백 실패가 외부 확장 control 정리를 막지 않게 격리한다.
        }
    }

    function syncManagedTarget(target, synchronizeTarget) {
        const previousSelection = getManagedSelectionIdentity(target);
        const result = synchronizeTarget();
        if (!previousSelection) {
            return result;
        }
        const currentSelection = getManagedSelectionIdentity(target);
        const preserved = currentSelection
            && currentSelection.providerId === previousSelection.providerId
            && currentSelection.modelId === previousSelection.modelId;
        if (!preserved) {
            selectNativeFallbackAndNotify(target);
            notifySelectionInvalidated(target, previousSelection, 'models-updated');
        }
        return result;
    }

    function removeManagedModelsAndNotify(target, cleanupOptions = {}, reason = 'disconnected') {
        const removedSelection = getManagedSelectionIdentity(target);
        const removed = removeExternalTargetModels(target, null, cleanupOptions);
        if (!removedSelection) {
            return removed;
        }
        selectNativeFallbackAndNotify(target);
        notifySelectionInvalidated(target, removedSelection, reason);
        return removed;
    }

    function bindTarget(target) {
        if (target.providerControl && target.providerControl !== target.control) {
            bindElement(target.providerControl, 'change', () => requestSync(), `provider:${target.targetId}`);
            bindElement(target.providerControl, 'input', () => requestSync(), `provider-input:${target.targetId}`);
        }
        if (target.resolution?.source !== 'direct') {
            return;
        }
        bindElement(target.control, tagName(target.control) === 'SELECT' ? 'change' : 'input', event => {
            if (event?.isTrusted !== true) {
                return;
            }
            const value = normalizeText(target.control?.value);
            const selectedOption = tagName(target.control) === 'SELECT'
                ? getSelectedOption(target.control)
                : null;
            const matchingOptions = getOptions(target.optionHost).filter(option => (
                isManagedOption(option)
                && String(option.value) === value
            ));
            const isSelectControl = tagName(target.control) === 'SELECT';
            const managedOption = selectedOption && isManagedOption(selectedOption)
                ? selectedOption
                : (!isSelectControl && matchingOptions.length === 1 ? matchingOptions[0] : null);
            const matchingProviderIds = [...new Set((managedOption ? [managedOption] : matchingOptions)
                .filter(() => !isSelectControl || Boolean(managedOption))
                .map(option => normalizeProviderId(getAttribute(option, 'data-cmr-provider')))
                .filter(isSupportedProvider))];
            const selectedProviderId = matchingProviderIds.length === 1 ? matchingProviderIds[0] : null;
            const isCmrModel = Boolean(managedOption && isSupportedProvider(selectedProviderId))
                || Boolean(matchingProviderIds.length);
            const selection = {
                targetId: target.targetId,
                providerId: isCmrModel ? selectedProviderId : null,
                modelId: isCmrModel ? value : null,
                mode: 'direct',
                userInitiated: true,
            };
            if (matchingProviderIds.length > 1) {
                selection.providerIds = matchingProviderIds;
            }
            options.onSelectionChanged?.(selection);
        }, `model:${target.targetId}:direct`);

    }

    function restorePreferredModel(target) {
        if (target.resolution?.source !== 'direct' || normalizeText(target.control?.value)) {
            return null;
        }
        const preferredEntries = Object.entries(options.getPreferredModels?.(target.targetId) ?? {});
        let preferredOption = null;
        for (const [candidateProvider, candidateModel] of preferredEntries) {
            const normalizedCandidateProvider = normalizeProviderId(candidateProvider);
            const normalizedCandidateModel = normalizeText(candidateModel);
            preferredOption = getOptions(target.optionHost).find(option => (
                isManagedOption(option)
                && normalizeProviderId(getAttribute(option, 'data-cmr-provider')) === normalizedCandidateProvider
                && String(option.value) === normalizedCandidateModel
            )) ?? null;
            if (preferredOption) {
                break;
            }
        }
        if (!preferredOption) {
            return null;
        }
        const preferred = String(preferredOption.value);
        if (tagName(target.control) === 'SELECT') {
            for (const option of getOptions(target.optionHost)) {
                option.selected = option === preferredOption;
            }
        }
        target.control.value = preferred;
        if (String(target.control.value) !== preferred) {
            return null;
        }
        dispatchSelectionEvent(target.control);
        return preferred;
    }

    function scanAndSync() {
        const nextTargets = discoverExternalModelTargets(root, options);
        const nextControls = new Set(nextTargets.map(target => target.control));
        // 재탐지마다 현재 descriptor를 기준으로 다시 바인딩해 교체된 provider control을 놓치지 않는다.
        for (const element of [...bindings.keys()]) {
            unbindElement(element);
        }
        for (const [control, target] of managedTargets) {
            if (!nextControls.has(control)) {
                removeExternalTargetModels(target, null, { removeOwnedHost: true });
                managedTargets.delete(control);
            }
        }

        for (const target of nextTargets) {
            const resolution = resolveExternalTargetProvider(target, null, options);
            const previous = managedTargets.get(target.control);
            if (previous?.optionHost && previous.optionHost !== target.optionHost) {
                // 외부 확장이 plain input의 list를 자기 datalist로 바꾼 경우 이전 CMR host를 남기지 않는다.
                removeExternalTargetModels(previous, null, { removeOwnedHost: true });
            }
            target.resolution = resolution;
            if (resolution.source === 'direct') {
                syncManagedTarget(target, () => (
                    syncExternalTargetProviders(target, getProviderEntries(), options)
                ));
                managedTargets.set(target.control, target);
                bindTarget(target);
                target.restoredModelId = restorePreferredModel(target);
            } else {
                removeManagedModelsAndNotify(target, { removeOwnedHost: true }, resolution.source);
                managedTargets.delete(target.control);
                // 현재 provider가 비어 있거나 안전상 제외되어도 provider 변경은 계속 감지한다.
                bindTarget(target);
            }
        }
        targets = nextTargets;
        try {
            options.onTargetsChanged?.([...targets]);
        } catch {
            // UI 콜백 실패가 외부 확장 control 정리를 막지 않게 격리한다.
        }
        return [...targets];
    }

    function requestSync(records = null) {
        const knownControls = new Set([
            ...managedTargets.keys(),
            ...[...managedTargets.values()].flatMap(target => [target.optionHost, target.providerControl]).filter(Boolean),
        ]);
        if (records && !mutationNeedsExternalRescan(records, { root, documentRef: options.documentRef, knownControls })) {
            return false;
        }
        if (pending) {
            return true;
        }
        pending = true;
        const requestedGeneration = generation;
        schedule(() => {
            pending = false;
            if (active && requestedGeneration === generation) {
                scanAndSync();
            }
        });
        return true;
    }

    function start() {
        if (active) {
            return [...targets];
        }
        active = true;
        generation += 1;
        targets = scanAndSync();
        observer = observerFactory(records => requestSync(records));
        observer?.observe?.(root?.documentElement ?? root, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
                'id', 'name', 'class', 'type', 'list', 'value', 'placeholder', 'title', 'for',
                'disabled', 'readonly', 'multiple', 'aria-label',
                'data-role', 'data-control', 'data-field', 'data-provider', 'data-api-provider',
                'data-model-provider', 'data-source', 'data-type', 'data-provider-select', 'data-source-select',
                'data-extension-id', 'data-extension-name', 'data-name',
            ],
        });
        return [...targets];
    }

    function stop(options = {}) {
        active = false;
        generation += 1;
        observer?.disconnect?.();
        observer = null;
        pending = false;
        if (options.cleanup !== false) {
            for (const target of managedTargets.values()) {
                removeManagedModelsAndNotify(target, { removeOwnedHost: true }, 'destroy');
            }
            managedTargets.clear();
        }
        for (const element of [...bindings.keys()]) {
            unbindElement(element);
        }
        targets = [];
    }

    function getMetrics() {
        const directCount = targets.filter(target => target.resolution?.source === 'direct').length;
        return {
            observerCount: active && observer ? 1 : 0,
            targetCount: targets.length,
            boundCount: managedTargets.size,
            directCount,
            listenerCount: [...bindings.values()].reduce((total, entries) => total + entries.length, 0),
        };
    }

    return Object.freeze({
        start,
        stop,
        destroy: stop,
        scanAndSync,
        rescan: scanAndSync,
        sync: scanAndSync,
        requestSync,
        getTargets: () => [...targets],
        getMappings: () => ({}),
        getMetrics,
        setMappings(value) {
            // v0.6.5 이하 호출부와의 호환용 no-op이다.
            normalizeExternalMappings(value);
            return scanAndSync();
        },
    });
}
