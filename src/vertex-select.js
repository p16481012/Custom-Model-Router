import { PROVIDER_IDS } from './providers.js';
import {
    CUSTOM_GROUP_LABEL,
    getCustomGroup as getProviderCustomGroup,
    getNativeModelIds,
    hasModelOption,
    isNativeModelOption,
    removeCustomGroup as removeProviderCustomGroup,
    selectModel,
    syncModelOptions,
} from './model-select.js';

export { CUSTOM_GROUP_LABEL, getNativeModelIds, hasModelOption, isNativeModelOption };

// v0.1 확장 API와 테스트를 유지하는 Vertex 전용 호환 래퍼다.
export const CUSTOM_GROUP_PROVIDER = PROVIDER_IDS.VERTEXAI;

export function getCustomGroup(select) {
    return getProviderCustomGroup(select, CUSTOM_GROUP_PROVIDER);
}

export function syncVertexOptions(select, models, documentRef = select?.ownerDocument ?? globalThis.document) {
    const result = syncModelOptions(select, CUSTOM_GROUP_PROVIDER, models, { documentRef });
    return {
        injectedIds: result.injectedIds,
        coreSupportedIds: result.coreSupportedIds,
    };
}

export function selectVertexModel(select, modelId, eventFactory) {
    return selectModel(select, modelId, eventFactory);
}

export function removeCustomGroup(select) {
    removeProviderCustomGroup(select, CUSTOM_GROUP_PROVIDER);
}
