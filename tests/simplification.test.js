import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readText(path) {
    return readFile(new URL(path, ROOT_URL), 'utf8');
}

test('v0.6.6 모델 관리 영역은 등록·삭제와 읽기 전용 외부 연결 상태에 집중한다', async () => {
    const [html, source] = await Promise.all([
        readText('settings.html'),
        readText('index.js'),
    ]);

    assert.match(html, /id="cmr_provider"/);
    assert.match(html, /id="cmr_add_form"/);
    assert.match(html, /id="cmr_model_list"/);
    assert.match(html, /data-cmr-list-scope="all"/);
    assert.match(html, /id="cmr_compatibility"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_external_section"/);
    assert.match(html, /등록 모델 전체를 제공업체별로 표시/);
    assert.doesNotMatch(html, /id="cmr_external_refresh"|data-cmr-external-mode/);
    assert.doesNotMatch(html, /<dt>자동 연결|<dt>연결 안 함/);
    assert.doesNotMatch(html, /id="cmr_rout(?:ing_section|e_(?:form|purpose|model|profile|clear|test|status))"/);
    assert.doesNotMatch(source, /dataset\.cmrAction\s*=\s*'select'/);
    assert.match(source, /dataset\.cmrAction\s*=\s*'delete'/);
});

test('브라우저 샌드박스는 단일 직접 연결·provider metadata·재렌더 시나리오를 유지한다', async () => {
    const html = await readText('tests/browser-sandbox.html');

    assert.match(html, /id="switch_caption_provider"/);
    assert.match(html, /switchCaptionProvider\(\)/);
    assert.match(html, /data-extension-name="unknown helper"/);
    assert.match(html, /browser-sandbox=0\.6\.6/);
    assert.match(html, /제공업체 선택기가 없어도 직접 연결/);
});
