import { getProvider, getProviders, validateProviderModelId } from './providers.js';
import { normalizeSettings } from './registry.js';

function nativeOptions(host) {
    // Only known core catalog hosts are read; never infer models from a free-text value.
    if (!['SELECT', 'DATALIST'].includes(host?.tagName)) return [];
    return Array.from(host.children ?? []).flatMap(child => {
        if (child.disabled || child.hidden || child.dataset?.cmrProvider
            || child.dataset?.cmrModel || child.dataset?.cmrExternalModel
            || child.dataset?.cmrExternalGroup) return [];
        if (child.tagName === 'OPTGROUP') return nativeOptions({ tagName: 'SELECT', children: child.children });
        return child.tagName === 'OPTION' ? [child] : [];
    });
}

function collectProviderModels(provider, registeredModels, documentRef) {
    const registered = registeredModels.filter(model => model.provider === provider.id);
    // A disabled manual registration overrides the same native reference too.
    const seen = new Set(registered.map(model => model.id));
    const models = registered.filter(model => model.enabled).map(model => ({ ...model, source: 'registered' }));
    const selectors = provider.controlType === 'select'
        ? [provider.selector]
        : provider.id === 'custom' ? ['#model_custom_select_fill', '#model_custom_select'] : [];
    for (const selector of selectors) {
        for (const option of nativeOptions(documentRef?.querySelector?.(selector))) {
            const value = String(option.value ?? '');
            const validation = validateProviderModelId(provider.id, value);
            if (!validation.ok || validation.id !== value || seen.has(value)) continue;
            seen.add(value);
            models.push({ id: value, provider: provider.id, protocol: provider.protocol, enabled: true, source: 'native' });
        }
    }
    return models;
}

/** Ephemeral projection only. Never pass this catalog to settings persistence or backups. */
export function readModelCatalog(settings, documentRef) {
    const registered = normalizeSettings(settings).models;
    return new Map(getProviders().map(provider => [
        provider.id, collectProviderModels(provider, registered, documentRef),
    ]));
}

/** Re-read availability at request time so a removed native model cannot use a stale hook. */
export function readProviderModelCatalog(settings, providerId, documentRef) {
    const provider = getProvider(providerId);
    return provider ? collectProviderModels(provider, normalizeSettings(settings).models, documentRef) : [];
}
