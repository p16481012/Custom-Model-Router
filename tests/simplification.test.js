import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readText(path) {
    return readFile(new URL(path, ROOT_URL), 'utf8');
}

test('v0.6.4 관리 패널은 모델 등록·삭제와 오류 표시에만 집중한다', async () => {
    const [html, source] = await Promise.all([
        readText('settings.html'),
        readText('index.js'),
    ]);

    assert.match(html, /id="cmr_provider"/);
    assert.match(html, /id="cmr_add_form"/);
    assert.match(html, /id="cmr_model_list"/);
    assert.match(html, /id="cmr_compatibility"[^>]*\bhidden\b/);
    assert.doesNotMatch(html, /id="cmr_external_(?:section|list|refresh|status|count)"/);
    assert.doesNotMatch(html, /id="cmr_rout(?:ing_section|e_(?:form|purpose|model|profile|clear|test|status))"/);
    assert.doesNotMatch(source, /dataset\.cmrAction\s*=\s*'select'/);
    assert.match(source, /dataset\.cmrAction\s*=\s*'delete'/);
});

test('브라우저 샌드박스는 수동 mapping UI 대신 자동 추론·provider 전환을 검증한다', async () => {
    const html = await readText('tests/browser-sandbox.html');

    assert.doesNotMatch(html, /id="(?:bind|disable|reset)_unknown"/);
    assert.doesNotMatch(html, /\.(?:bind|disable|reset)Unknown\s*\(/);
    assert.match(html, /id="switch_caption_provider"/);
    assert.match(html, /switchCaptionProvider\(\)/);
    assert.match(html, /data-extension-name="unknown helper"/);
});
