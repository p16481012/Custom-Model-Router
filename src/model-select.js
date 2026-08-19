import {
    PROVIDER_IDS,
    getProvider,
    normalizeProviderId,
    normalizeProviderModelId,
    validateProviderModelId,
} from './providers.js';

export const CUSTOM_GROUP_LABEL = '사용자 모델';

function getDirectChildren(element) {
    return Array.from(element?.children ?? []);
}

function getOptions(element) {
    if (element?.options) {
        return Array.from(element.options);
    }

    return getDirectChildren(element).flatMap(child => (
        String(child.tagName).toUpperCase() === 'OPTGROUP'
            ? getDirectChildren(child)
            : [child]
    )).filter(child => String(child.tagName).toUpperCase() === 'OPTION');
}

function isManagedGroup(element) {
    return String(element?.tagName).toUpperCase() === 'OPTGROUP'
        && Boolean(element?.dataset?.cmrProvider);
}

export function getCustomGroup(select, providerId = PROVIDER_IDS.VERTEXAI) {
    const normalizedProviderId = normalizeProviderId(providerId);
    return getDirectChildren(select).find(child => (
        isManagedGroup(child)
        && child.dataset.cmrProvider === normalizedProviderId
    )) ?? null;
}

export function getNativeModelIds(select) {
    const result = new Set();

    for (const child of getDirectChildren(select)) {
        if (isManagedGroup(child)) {
            continue;
        }

        if (String(child.tagName).toUpperCase() === 'OPTION') {
            result.add(String(child.value));
            continue;
        }

        for (const option of getDirectChildren(child)) {
            if (String(option.tagName).toUpperCase() === 'OPTION') {
                result.add(String(option.value));
            }
        }
    }

    return result;
}

export function hasModelOption(select, modelId) {
    const id = normalizeProviderModelId(modelId);
    return getOptions(select).some(option => String(option.value) === id);
}

export function isNativeModelOption(select, modelId) {
    return getNativeModelIds(select).has(normalizeProviderModelId(modelId));
}

/**
 * SillyTavern이 원격 목록을 비우고 다시 그린 뒤에도 호출 한 번으로 optgroup을 복원한다.
 * `preferredModelId`는 목록 재생성 직전에 저장해 둔 선택을 되살릴 때 사용하며 change는
 * 발생시키지 않는다. 실제 설정 반영 여부는 호출 측 lifecycle이 결정해야 한다.
 */
export function syncModelOptions(select, providerId, models, options = {}) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const provider = getProvider(normalizedProviderId);
    const documentRef = options.documentRef ?? select?.ownerDocument ?? globalThis.document;
    if (!select || !documentRef?.createElement || provider?.controlType !== 'select') {
        return { injectedIds: [], coreSupportedIds: [], restoredId: null };
    }

    const previousValue = normalizeProviderModelId(select.value);
    const preferredModelId = normalizeProviderModelId(options.preferredModelId);
    const nativeIds = getNativeModelIds(select);
    const enabledIds = Array.from(new Set(
        (Array.isArray(models) ? models : [])
            .filter(model => model?.enabled !== false)
            .filter(model => !model?.provider || model.provider === normalizedProviderId)
            .map(model => validateProviderModelId(normalizedProviderId, model?.id))
            .filter(validation => validation.ok)
            .map(validation => validation.id),
    ));
    const coreSupportedIds = enabledIds.filter(id => nativeIds.has(id));
    const injectedIds = enabledIds.filter(id => !nativeIds.has(id));
    let group = getCustomGroup(select, normalizedProviderId);

    if (injectedIds.length === 0) {
        group?.remove();
    } else {
        if (!group) {
            group = documentRef.createElement('optgroup');
            group.dataset.cmrProvider = normalizedProviderId;
            group.label = CUSTOM_GROUP_LABEL;
            select.prepend(group);
        }

        const currentIds = getDirectChildren(group).map(option => String(option.value));
        const isCurrent = currentIds.length === injectedIds.length
            && currentIds.every((id, index) => id === injectedIds[index]);

        if (!isCurrent) {
            const injectedOptions = injectedIds.map(id => {
                const option = documentRef.createElement('option');
                option.value = id;
                option.textContent = id;
                option.dataset.cmrModel = 'true';
                option.dataset.cmrProvider = normalizedProviderId;
                return option;
            });
            group.replaceChildren(...injectedOptions);
        }
    }

    const restoreCandidate = previousValue && hasModelOption(select, previousValue)
        ? previousValue
        : (preferredModelId && hasModelOption(select, preferredModelId) ? preferredModelId : null);
    if (restoreCandidate) {
        select.value = restoreCandidate;
    }

    return { injectedIds, coreSupportedIds, restoredId: restoreCandidate };
}

export function selectModel(select, modelId, eventFactory) {
    const id = normalizeProviderModelId(modelId);
    if (!select || !id || !hasModelOption(select, id)) {
        return false;
    }

    select.value = id;
    if (String(select.value) !== id) {
        return false;
    }

    const createEvent = eventFactory ?? (() => {
        const EventClass = select.ownerDocument?.defaultView?.Event ?? globalThis.Event;
        return new EventClass('change', { bubbles: true });
    });
    select.dispatchEvent(createEvent());
    return true;
}

export function getNativeFallbackModel(select, preferredModelIds = []) {
    const nativeIds = getNativeModelIds(select);
    const enabledOptions = getOptions(select).filter(option => (
        !option.disabled
        && nativeIds.has(String(option.value))
        && normalizeProviderModelId(option.value)
    ));

    for (const preferredId of preferredModelIds) {
        const id = normalizeProviderModelId(preferredId);
        if (enabledOptions.some(option => String(option.value) === id)) {
            return id;
        }
    }

    return enabledOptions.length ? String(enabledOptions[0].value) : null;
}

export function removeCustomGroup(select, providerId = PROVIDER_IDS.VERTEXAI) {
    getCustomGroup(select, providerId)?.remove();
}

export function removeAllCustomGroups(select) {
    for (const child of getDirectChildren(select)) {
        if (isManagedGroup(child)) {
            child.remove();
        }
    }
}
