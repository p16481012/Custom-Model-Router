import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readText(path) {
    return readFile(new URL(path, ROOT_URL), 'utf8');
}

test('모델 관리 기본 화면은 등록·삭제에 집중하고 외부 연결은 문제 카드와 고급 관리로 분리한다', async () => {
    const [html, source] = await Promise.all([
        readText('settings.html'),
        readText('index.js'),
    ]);

    assert.match(html, /id="cmr_provider"/);
    assert.match(html, /id="cmr_add_form"/);
    assert.match(html, /id="cmr_model_list"/);
    assert.match(html, /data-cmr-list-scope="all"/);
    assert.match(html, /id="cmr_compatibility"[^>]*\bhidden\b/);
    assert.doesNotMatch(html, /id="cmr_external_section"/);
    assert.match(html, /id="cmr_external_warning"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_external_warning_open"/);
    assert.match(html, /id="cmr_operations_section"/);
    assert.match(html, /id="cmr_external_advanced"/);
    assert.match(html, /id="cmr_external_list"/);
    assert.match(html, /실제 요청에 해당 모델이 사용된다는 사실은 다릅니다/);
    assert.doesNotMatch(html, /id="cmr_external_refresh"|data-cmr-external-mode/);
    assert.doesNotMatch(html, /<dt>자동 연결|<dt>연결 안 함/);
    assert.doesNotMatch(html, /id="cmr_rout(?:ing_section|e_(?:form|purpose|model|profile|clear|test|status))"/);
    assert.doesNotMatch(source, /dataset\.cmrAction\s*=\s*'select'/);
    assert.match(source, /dataset\.cmrAction\s*=\s*'delete'/);

    const addButton = html.match(/<button\b[^>]*class="[^"]*cmr-add-button[^"]*"[^>]*>([\s\S]*?)<\/button>/)?.[0] ?? '';
    assert.match(addButton, /aria-label="[^"]+"/);
    assert.match(addButton, /title="[^"]+"/);
    assert.match(addButton, /fa-plus/);
    assert.doesNotMatch(addButton, /<span\b|>\s*추가\s*</);
});

test('브라우저 샌드박스는 안전 대상 자동 연결·provider metadata·재렌더 시나리오를 유지한다', async () => {
    const html = await readText('tests/browser-sandbox.html');

    assert.match(html, /id="switch_caption_provider"/);
    assert.match(html, /switchCaptionProvider\(\)/);
    assert.match(html, /data-extension-name="unknown helper"/);
    assert.match(html, /browser-sandbox=0\.6\.9/);
    assert.match(html, /제공업체 선택기가 없어도 안전하게 자동 연결/);
});
