import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelCatalog, readProviderModelCatalog } from '../src/model-catalog.js';

const option = (value, extra = {}) => ({ tagName: 'OPTION', value, ...extra });
const host = (...children) => ({ tagName: 'SELECT', children });
const documentWith = controls => ({ querySelector: selector => controls[selector] ?? null });
const registry = models => ({ schemaVersion: 2, models, selectedModels: {} });
const ids = models => models.map(model => model.id);

test('기본 목록과 직접 등록을 provider·ID로 합치되 수동 비활성화와 등록 우선순위를 지킨다', () => {
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
    assert.deepEqual(ids(catalog.get('openai')), ['shared', 'manual', 'native']);
    assert.deepEqual(catalog.get('openai').map(model => model.source), ['registered', 'registered', 'native']);
    assert.deepEqual(ids(catalog.get('claude')), ['shared']);
    assert.equal(catalog.get('openai')[2].protocol, 'openai-chat-completions');
    assert.equal(JSON.stringify(settings), before, '카탈로그를 등록 설정에 저장하지 않는다');
});

test('빈 안내·유효하지 않은 ID·disabled/hidden·CMR 관리 옵션을 기본 목록에서 제외한다', () => {
    const grouped = (...children) => ({ tagName: 'OPTGROUP', children });
    const control = host(
        option(''), option('invalid model'), option(' padded '), option('disabled', { disabled: true }),
        option('hidden', { hidden: true }), option('injected', { dataset: { cmrModel: 'true' } }),
        { ...grouped(option('owned')), dataset: { cmrProvider: 'openai' } },
        { ...grouped(option('group-disabled')), disabled: true },
        { ...grouped(option('group-hidden')), hidden: true },
        grouped(option('valid-native'), option('other-injected', { dataset: { cmrExternalModel: 'true' } })),
    );
    assert.deepEqual(ids(readProviderModelCatalog({}, 'openai', documentWith({ '#model_openai_select': control }))), ['valid-native']);
});

test('Custom은 실제 로드된 core select·datalist만 읽고 임의 입력·외부 목록은 수집하지 않는다', () => {
    const doc = documentWith({
        '#custom_model_id': { tagName: 'INPUT', value: 'not-a-catalog', list: 'other-list' },
        '#other-list': { tagName: 'DATALIST', children: [option('external')] },
        '#model_custom_select_fill': { tagName: 'DATALIST', children: [option('vendor/model'), option('shared')] },
        '#model_custom_select': host(option('shared'), option('loaded-select')),
    });
    assert.deepEqual(ids(readProviderModelCatalog({}, 'custom', doc)), ['vendor/model', 'shared', 'loaded-select']);
});

test('core 목록이 없으면 fallback ID나 현재 입력값을 기본 모델로 만들어 내지 않는다', () => {
    assert.ok([...readModelCatalog({}, documentWith({})).values()].every(models => models.length === 0));
    assert.deepEqual(readProviderModelCatalog({}, 'not-supported', documentWith({})), []);
    assert.deepEqual(readProviderModelCatalog({}, 'openai', documentWith({
        '#model_openai_select': { tagName: 'INPUT', value: 'wrong-control' },
    })), []);
});

test('core 목록 교체를 다시 읽고 제거된 기본 모델이나 과거 projection을 축적하지 않는다', () => {
    const controls = { '#model_openai_select': host(option('before')) };
    const doc = documentWith(controls);
    assert.deepEqual(ids(readProviderModelCatalog({}, 'openai', doc)), ['before']);
    controls['#model_openai_select'] = host(option('after'), option('before', { dataset: { cmrProvider: 'openai' } }));
    assert.deepEqual(ids(readProviderModelCatalog({}, 'openai', doc)), ['after']);
    controls['#model_openai_select'].children[0].disabled = true;
    assert.deepEqual(readProviderModelCatalog({}, 'openai', doc), []);
});

test('일시 기본 카탈로그에는 저장 Registry의 5000개 한도를 적용하거나 기록하지 않는다', () => {
    const settings = registry([{ provider: 'openai', id: 'manual', enabled: true }]);
    const control = host(...Array.from({ length: 5001 }, (_, i) => option(`native-${i}`)));
    const models = readProviderModelCatalog(settings, 'openai', documentWith({ '#model_openai_select': control }));
    assert.equal(models.length, 5002);
    assert.equal(models[0].id, 'manual');
    assert.equal(settings.models.length, 1);
});
