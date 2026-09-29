import { getProvider, getProviders } from './providers.js';
import { normalizeSettings } from './registry.js';

function collectProviderModels(provider, registeredModels) {
    return registeredModels
        .filter(model => model.provider === provider.id && model.enabled)
        .map(model => ({ ...model, source: 'registered' }));
}

/** External model choices contain only explicitly registered, enabled models. */
export function readModelCatalog(settings) {
    const registered = normalizeSettings(settings).models;
    return new Map(getProviders().map(provider => [
        provider.id, collectProviderModels(provider, registered),
    ]));
}

/** Re-read registrations at request time so removed or disabled models cannot use a stale hook. */
export function readProviderModelCatalog(settings, providerId) {
    const provider = getProvider(providerId);
    return provider ? collectProviderModels(provider, normalizeSettings(settings).models) : [];
}
