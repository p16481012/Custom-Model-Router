export const CUSTOM_GROUP_LABEL = '사용자 지정 모델 · Custom Model Router';
export const CUSTOM_GROUP_PROVIDER = 'vertexai';

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

export function getCustomGroup(select) {
    return getDirectChildren(select).find(child => (
        String(child.tagName).toUpperCase() === 'OPTGROUP'
        && child.dataset?.cmrProvider === CUSTOM_GROUP_PROVIDER
    )) ?? null;
}

export function getNativeModelIds(select) {
    const customGroup = getCustomGroup(select);
    const result = new Set();

    for (const child of getDirectChildren(select)) {
        if (child === customGroup) {
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
    const id = String(modelId ?? '');
    return getOptions(select).some(option => String(option.value) === id);
}

export function isNativeModelOption(select, modelId) {
    return getNativeModelIds(select).has(String(modelId ?? ''));
}

export function syncVertexOptions(select, models, documentRef = select?.ownerDocument ?? globalThis.document) {
    if (!select || !documentRef?.createElement) {
        return { injectedIds: [], coreSupportedIds: [] };
    }

    const previousValue = String(select.value ?? '');
    const nativeIds = getNativeModelIds(select);
    const enabledIds = Array.from(new Set(
        (Array.isArray(models) ? models : [])
            .filter(model => model?.enabled !== false)
            .map(model => String(model?.id ?? ''))
            .filter(Boolean),
    ));
    const coreSupportedIds = enabledIds.filter(id => nativeIds.has(id));
    const injectedIds = enabledIds.filter(id => !nativeIds.has(id));
    let group = getCustomGroup(select);

    if (injectedIds.length === 0) {
        group?.remove();
    } else {
        if (!group) {
            group = documentRef.createElement('optgroup');
            group.dataset.cmrProvider = CUSTOM_GROUP_PROVIDER;
            group.label = CUSTOM_GROUP_LABEL;
            select.prepend(group);
        }

        const currentIds = getDirectChildren(group).map(option => String(option.value));
        const isCurrent = currentIds.length === injectedIds.length
            && currentIds.every((id, index) => id === injectedIds[index]);

        if (!isCurrent) {
            const options = injectedIds.map(id => {
                const option = documentRef.createElement('option');
                option.value = id;
                option.textContent = id;
                option.dataset.cmrModel = 'true';
                return option;
            });
            group.replaceChildren(...options);
        }
    }

    if (previousValue && hasModelOption(select, previousValue)) {
        select.value = previousValue;
    }

    return { injectedIds, coreSupportedIds };
}

export function selectVertexModel(select, modelId, eventFactory) {
    const id = String(modelId ?? '');
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

export function removeCustomGroup(select) {
    getCustomGroup(select)?.remove();
}
