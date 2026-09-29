import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelCatalog, readProviderModelCatalog } from '../src/model-catalog.js';

const option = (value, extra = {}) => ({ tagName: 'OPTION', value, ...extra });
const host = (...children) => ({ tagName: 'SELECT', children });
const documentWith = controls => ({ querySelector: selector => controls[selector] ?? null });
const registry = models => ({ schemaVersion: 2, models, selectedModels: {} });
const ids = models => models.map(model => model.id);

test('기본 목록과 같은 ID도 등록할 수 있지만 직접 등록한 활성 모델만 업체별로 제공한다', () => {
    const settings = registry([
        { provider: 'openai', id: 'shared', enabled: true },
        { provider: 'openai', id: 'off', enabled: false },
        { provider: 'openai', id: 'manual', enabled: true },
    ]);
    const before = JSON.stringify(settings);
    const catalog = readModelCatalog(settings, documentWith({
        '#model_openai_select': host(option('native'), option('shared'), option('off'), option('native')),
        '#model_claude_select': host(option('shared')),
    }));
    assert.deepEqual(ids(catalog.get('openai')), ['shared', 'manual']);
    assert.deepEqual(catalog.get('openai').map(model => model.source), ['registered', 'registered']);
    assert.deepEqual(ids(catalog.get('claude')), []);
    assert.equal(catalog.get('openai')[0].protocol, 'openai-chat-completions');
    assert.equal(JSON.stringify(settings), before, '카탈로그를 등록 설정에 저장하지 않는다');
});

test('기본 목록의 정상·안내·비활성·CMR 옵션은 등록되지 않았으면 모두 제공하지 않는다', () => {
    const grouped = (...children) => ({ tagName: 'OPTGROUP', children });
    const control = host(
        option(''), option('invalid model'), option(' padded '), option('disabled', { disabled: true }),
        option('hidden', { hidden: true }), option('injected', { dataset: { cmrModel: 'true' } }),
        { ...grouped(option('owned')), dataset: { cmrProvider: 'openai' } },
        { ...grouped(option('group-disabled')), disabled: true },
        { ...grouped(option('group-hidden')), hidden: true },
        grouped(option('valid-native'), option('other-injected', { dataset: { cmrExternalModel: 'true' } })),
    );
    assert.deepEqual(ids(readProviderModelCatalog({}, 'openai', documentWith({ '#model_openai_select': control }))), []);
    assert.equal(control.children.at(-1).children[0].value, 'valid-native', '기본 목록을 수정하지 않는다');
});

test('Custom도 core select·datalist나 현재 입력에 있는 모델을 자동 제공하지 않는다', () => {
    const doc = documentWith({
        '#custom_model_id': { tagName: 'INPUT', value: 'not-a-catalog', list: 'other-list' },
        '#other-list': { tagName: 'DATALIST', children: [option('external')] },
        '#model_custom_select_fill': { tagName: 'DATALIST', children: [option('vendor/model'), option('shared')] },
        '#model_custom_select': host(option('shared'), option('loaded-select')),
    });
    assert.deepEqual(ids(readProviderModelCatalog({}, 'custom', doc)), []);
    assert.deepEqual(ids(readProviderModelCatalog(registry([
        { provider: 'custom', id: 'vendor/model', enabled: true },
    ]), 'custom', doc)), ['vendor/model']);
});

test('core 목록이 없으면 fallback ID나 현재 입력값을 기본 모델로 만들어 내지 않는다', () => {
    assert.ok([...readModelCatalog({}, documentWith({})).values()].every(models => models.length === 0));
    assert.deepEqual(readProviderModelCatalog({}, 'not-supported', documentWith({})), []);
    assert.deepEqual(readProviderModelCatalog({}, 'openai', documentWith({
        '#model_openai_select': { tagName: 'INPUT', value: 'wrong-control' },
    })), []);
});

test('기본 목록 교체·비활성화는 등록 모델의 제공 여부를 바꾸지 않고 등록 삭제는 반영한다', () => {
    const controls = { '#model_openai_select': host(option('before')) };
    const doc = documentWith(controls);
    const settings = registry([{ provider: 'openai', id: 'before', enabled: true }]);
    assert.deepEqual(ids(readProviderModelCatalog(settings, 'openai', doc)), ['before']);
    controls['#model_openai_select'] = host(option('after'), option('before', { dataset: { cmrProvider: 'openai' } }));
    assert.deepEqual(ids(readProviderModelCatalog(settings, 'openai', doc)), ['before']);
    controls['#model_openai_select'].children[0].disabled = true;
    assert.deepEqual(ids(readProviderModelCatalog(settings, 'openai', doc)), ['before']);
    settings.models = [];
    assert.deepEqual(readProviderModelCatalog(settings, 'openai', doc), []);
});

test('기본 목록이 5000개를 넘어도 외부 목록과 저장 Registry에는 등록 모델만 남는다', () => {
    const settings = registry([{ provider: 'openai', id: 'manual', enabled: true }]);
    const control = host(...Array.from({ length: 5001 }, (_, i) => option(`native-${i}`)));
    const models = readProviderModelCatalog(settings, 'openai', documentWith({ '#model_openai_select': control }));
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'manual');
    assert.equal(settings.models.length, 1);
});
