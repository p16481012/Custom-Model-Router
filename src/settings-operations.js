import { createModelKey, normalizeSettings } from './registry.js';
import { parsePortableSettings, stringifyPortableSettings } from './portable-settings.js';

// Only the portable allowlist crosses the history boundary. Credentials,
// arbitrary storage fields, and live context objects must never be retained.
export function snapshotSettingsBundle(bundle) {
    return parsePortableSettings(stringifyPortableSettings(bundle));
}

export function mergeRegistryModels(current, imported, selectedKeys) {
    const existing = normalizeSettings(current.registrySettings);
    const incoming = normalizeSettings(imported.registrySettings);
    const models = new Map(existing.models.map(model => [createModelKey(model.provider, model.id), model]));
    const chosen = selectedKeys instanceof Set ? selectedKeys : new Set(incoming.models
        .filter(model => !models.has(createModelKey(model.provider, model.id)))
        .map(model => createModelKey(model.provider, model.id)));
    for (const model of incoming.models) {
        const key = createModelKey(model.provider, model.id);
        if (chosen.has(key)) models.set(key, model);
    }
    return snapshotSettingsBundle({
        ...current,
        registrySettings: normalizeSettings({ ...existing, models: [...models.values()] }),
    });
}

export function findNativeRegisteredModels(registry, isNative) {
    return normalizeSettings(registry).models.filter(model => isNative(model.provider, model.id));
}

export function removeNativeRegistrations(current, selectedKeys, isNative) {
    const registry = normalizeSettings(current.registrySettings);
    return snapshotSettingsBundle({
        ...current,
        registrySettings: normalizeSettings({
            ...registry,
            models: registry.models.filter(model => !selectedKeys.has(createModelKey(model.provider, model.id))
                || !isNative(model.provider, model.id)),
        }),
    });
}
