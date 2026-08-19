import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getCustomGroup,
    getNativeFallbackModel,
    getNativeModelIds,
    removeAllCustomGroups,
    syncModelOptions,
} from '../src/model-select.js';

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.dataset = {};
        this.parentElement = null;
        this.label = '';
        this.textContent = '';
        this.value = '';
        this.disabled = false;
    }

    append(...children) {
        for (const child of children) {
            child.remove();
            child.parentElement = this;
            this.children.push(child);
        }
    }

    prepend(child) {
        child.remove();
        child.parentElement = this;
        this.children.unshift(child);
    }

    replaceChildren(...children) {
        for (const child of this.children) {
            child.parentElement = null;
        }
        this.children = [];
        this.append(...children);
    }

    remove() {
        if (!this.parentElement) {
            return;
        }
        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
    }
}

class FakeSelect extends FakeElement {
    constructor(ownerDocument) {
        super('select', ownerDocument);
        this._value = '';
    }

    get options() {
        return this.children.flatMap(child => (
            child.tagName === 'OPTGROUP' ? child.children : [child]
        )).filter(child => child.tagName === 'OPTION');
    }

    get value() {
        return this.options.some(option => option.value === this._value) ? this._value : '';
    }

    set value(value) {
        this._value = String(value ?? '');
    }
}

class FakeDocument {
    createElement(tagName) {
        return tagName.toLowerCase() === 'select'
            ? new FakeSelect(this)
            : new FakeElement(tagName, this);
    }
}

function createOption(documentRef, value, disabled = false) {
    const option = documentRef.createElement('option');
    option.value = value;
    option.textContent = value;
    option.disabled = disabled;
    return option;
}

test('제공업체가 일치하는 사용자 모델만 해당 select에 주입한다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(createOption(documentRef, 'gpt-4-turbo'));

    const result = syncModelOptions(select, 'openai', [
        { id: 'gpt-next', provider: 'openai', enabled: true },
        { id: 'grok-next', provider: 'xai', enabled: true },
    ], { documentRef });

    assert.deepEqual(result.injectedIds, ['gpt-next']);
    assert.deepEqual(getCustomGroup(select, 'openai').children.map(option => option.value), ['gpt-next']);
    assert.equal(getCustomGroup(select, 'openai').label, '사용자 모델');
    assert.equal(getCustomGroup(select, 'xai'), null);
});

test('원격 목록이 optgroup을 지운 뒤 preferredModelId로 사용자 선택을 복원한다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    const nativeOption = createOption(documentRef, 'grok-3-beta');
    select.append(nativeOption);
    const models = [{ id: 'grok-next', provider: 'xai', enabled: true }];

    syncModelOptions(select, 'xai', models, { documentRef });
    select.value = 'grok-next';
    select.replaceChildren(nativeOption);
    assert.equal(select.value, '');

    const result = syncModelOptions(select, 'xai', models, {
        documentRef,
        preferredModelId: 'grok-next',
    });

    assert.equal(result.restoredId, 'grok-next');
    assert.equal(select.value, 'grok-next');
    assert.deepEqual(result.injectedIds, ['grok-next']);
});

test('기본 fallback은 확장 그룹과 비활성 옵션을 제외한다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(
        createOption(documentRef, 'disabled-native', true),
        createOption(documentRef, 'first-native'),
        createOption(documentRef, 'preferred-native'),
    );
    syncModelOptions(select, 'openai', [
        { id: 'custom-model', provider: 'openai', enabled: true },
    ], { documentRef });

    assert.equal(getNativeFallbackModel(select, ['preferred-native']), 'preferred-native');
    assert.deepEqual(
        [...getNativeModelIds(select)],
        ['disabled-native', 'first-native', 'preferred-native'],
    );
});

test('전체 정리 시 CMR optgroup만 제거하고 기본 옵션은 보존한다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(createOption(documentRef, 'gpt-4-turbo'));
    syncModelOptions(select, 'openai', [
        { id: 'gpt-next', provider: 'openai', enabled: true },
    ], { documentRef });

    removeAllCustomGroups(select);

    assert.equal(getCustomGroup(select, 'openai'), null);
    assert.deepEqual([...getNativeModelIds(select)], ['gpt-4-turbo']);
});
