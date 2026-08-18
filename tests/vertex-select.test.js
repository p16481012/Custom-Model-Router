import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getCustomGroup,
    getNativeModelIds,
    hasModelOption,
    removeCustomGroup,
    selectVertexModel,
    syncVertexOptions,
} from '../src/vertex-select.js';

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
        this.listeners = new Map();
        this.dispatchedEvents = [];
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

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
        this.dispatchedEvents.push(event);
        for (const listener of this.listeners.get(event.type) ?? []) {
            listener.call(this, event);
        }
        return true;
    }
}

class FakeDocument {
    constructor() {
        this.defaultView = { Event };
    }

    createElement(tagName) {
        return tagName.toLowerCase() === 'select'
            ? new FakeSelect(this)
            : new FakeElement(tagName, this);
    }
}

function createNativeOption(documentRef, value) {
    const option = documentRef.createElement('option');
    option.value = value;
    option.textContent = value;
    return option;
}

test('사용자 모델 optgroup을 멱등하게 주입한다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(createNativeOption(documentRef, 'gemini-2.5-pro'));
    const models = [
        { id: 'gemini-3.5-pro-preview', enabled: true },
        { id: 'gemini-3.5-flash-preview', enabled: true },
    ];

    const first = syncVertexOptions(select, models, documentRef);
    const firstGroup = getCustomGroup(select);
    const second = syncVertexOptions(select, models, documentRef);

    assert.deepEqual(first.injectedIds, ['gemini-3.5-pro-preview', 'gemini-3.5-flash-preview']);
    assert.deepEqual(second.injectedIds, first.injectedIds);
    assert.equal(getCustomGroup(select), firstGroup);
    assert.equal(firstGroup.children.length, 2);
    assert.equal(hasModelOption(select, 'gemini-3.5-pro-preview'), true);
});

test('SillyTavern 기본 옵션과 같은 모델은 중복 주입하지 않는다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(createNativeOption(documentRef, 'gemini-3.5-pro-preview'));

    const result = syncVertexOptions(select, [{ id: 'gemini-3.5-pro-preview', enabled: true }], documentRef);

    assert.deepEqual(result.injectedIds, []);
    assert.deepEqual(result.coreSupportedIds, ['gemini-3.5-pro-preview']);
    assert.equal(getCustomGroup(select), null);
    assert.deepEqual([...getNativeModelIds(select)], ['gemini-3.5-pro-preview']);
});

test('옵션 재동기화 후 기존 사용자 선택을 유지한다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(createNativeOption(documentRef, 'gemini-2.5-pro'));
    syncVertexOptions(select, [{ id: 'gemini-3.5-pro-preview', enabled: true }], documentRef);
    select.value = 'gemini-3.5-pro-preview';

    syncVertexOptions(select, [
        { id: 'gemini-3.5-pro-preview', enabled: true },
        { id: 'gemini-3.5-flash-preview', enabled: true },
    ], documentRef);

    assert.equal(select.value, 'gemini-3.5-pro-preview');
});

test('모델 선택 시 bubbling change 이벤트를 한 번 발생시킨다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(createNativeOption(documentRef, 'gemini-2.5-pro'));
    syncVertexOptions(select, [{ id: 'gemini-3.5-pro-preview', enabled: true }], documentRef);

    const selected = selectVertexModel(select, 'gemini-3.5-pro-preview');

    assert.equal(selected, true);
    assert.equal(select.value, 'gemini-3.5-pro-preview');
    assert.equal(select.dispatchedEvents.length, 1);
    assert.equal(select.dispatchedEvents[0].type, 'change');
    assert.equal(select.dispatchedEvents[0].bubbles, true);
});

test('확장 optgroup만 제거하고 기본 옵션은 보존한다', () => {
    const documentRef = new FakeDocument();
    const select = documentRef.createElement('select');
    select.append(createNativeOption(documentRef, 'gemini-2.5-pro'));
    syncVertexOptions(select, [{ id: 'gemini-3.5-pro-preview', enabled: true }], documentRef);

    removeCustomGroup(select);

    assert.equal(getCustomGroup(select), null);
    assert.equal(hasModelOption(select, 'gemini-2.5-pro'), true);
});
