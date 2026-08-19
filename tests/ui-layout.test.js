import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readUiFiles() {
    return Promise.all([
        readFile(new URL('settings.html', ROOT_URL), 'utf8'),
        readFile(new URL('style.css', ROOT_URL), 'utf8'),
    ]);
}

test('패널 헤더는 버전 배지와 중복 닫기 버튼을 만들지 않는다', async () => {
    const [html, css] = await readUiFiles();
    const header = html.match(/<header class="cmr-panel-header">([\s\S]*?)<\/header>/)?.[1] ?? '';

    assert.match(header, /id="cmr_panel_title"/);
    assert.doesNotMatch(header, /cmr-panel-header-actions|cmr_panel_close/);
    assert.doesNotMatch(html, /cmr-version|>v0\.\d+\.\d+</);
    assert.doesNotMatch(css, /\.popup-button-close\s*{[^}]*display:\s*none/s);
    assert.doesNotMatch(css, /\.cmr-panel-close\b/);
});

test('등록 모델 영역은 전체 보기와 제공업체별 그룹 계약을 사용한다', async () => {
    const [html, css] = await readUiFiles();

    assert.match(html, /class="cmr-list-region" data-cmr-list-scope="all"/);
    assert.match(html, /id="cmr_list_title">전체 등록 모델</);
    assert.match(html, /id="cmr_model_count"[^>]*>제공업체 0곳 · 모델 0개</);
    for (const className of [
        'cmr-provider-group',
        'cmr-provider-group-header',
        'cmr-provider-group-label',
        'cmr-provider-group-count',
        'cmr-provider-model-list',
    ]) {
        assert.match(css, new RegExp(`\\.${className}\\b`));
    }
});

test('모델 목록은 6개 초과 표식에서만 내부 스크롤하고 스크롤바를 숨긴다', async () => {
    const [, css] = await readUiFiles();

    assert.match(css, /\.cmr-model-list\s*{[^}]*overflow:\s*visible/s);
    assert.match(css, /\.cmr-model-list\[data-scrollable="true"\]\s*{[^}]*max-block-size:[^;}]+;[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s);
    assert.match(css, /\.cmr-model-list\[data-scrollable="true"\]::\-webkit-scrollbar\s*{[^}]*display:\s*none/s);
    assert.match(css, /\.cmr-icon-button\.menu_button\s*{[^}]*inline-size:\s*1\.75rem\s*!important[^}]*min-inline-size:\s*1\.75rem\s*!important/s);
});

test('한국어 설명은 문장 블록과 공백 기준 줄바꿈을 사용한다', async () => {
    const [html, css] = await readUiFiles();

    const expectedSentenceCounts = {
        cmr_provider_help: 2,
        cmr_model_list_help: 3,
    };
    for (const [id, expectedCount] of Object.entries(expectedSentenceCounts)) {
        const content = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)<\\/small>`))?.[1] ?? '';
        assert.equal((content.match(/class="cmr-sentence"/g) ?? []).length, expectedCount);
    }
    assert.match(css, /word-break:\s*keep-all/);
    assert.match(css, /overflow-wrap:\s*normal/);
    assert.match(css, /\.cmr-sentence\s*{[^}]*display:\s*block/s);
    assert.doesNotMatch(css, /word-break:\s*break-all/);
});

test('다른 확장 연결 UI는 새로고침과 모드 선택 없이 단일 직접 연결 상태만 제공한다', async () => {
    const [html, css] = await readUiFiles();

    for (const id of [
        'cmr_external_section',
        'cmr_external_count',
        'cmr_external_status',
        'cmr_external_list',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /id="cmr_external_list"[^>]*tabindex="0"/);
    assert.match(html, /연결 대상 0개/);
    assert.match(html, /등록 모델 전체를 제공업체별로 표시합니다/);
    assert.match(html, /화면 변경을 감지해 자동으로 갱신됩니다/);
    assert.doesNotMatch(html, /cmr_external_refresh|data-cmr-external-mode|<dt>자동 연결|<dt>연결 안 함/);
    assert.match(html, /임베딩, TTS, 이미지 생성/);
    assert.match(css, /\.cmr-external-row\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    assert.match(css, /\.cmr-external-heading\s*{[^}]*flex:\s*1 1 auto/s);
    assert.match(css, /\.cmr-external-name\s*{[^}]*display:\s*block[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
    assert.doesNotMatch(css, /select\[data-cmr-external-mode\]|cmr-external-mode-guide|cmr-external-toolbar/);
});

test('버튼·상세 섹션·제공업체 그룹은 SillyTavern 전역 스타일과 독립적으로 정렬된다', async () => {
    const [html, css] = await readUiFiles();

    assert.match(css, /#cmr_settings \.menu_button\s*{[^}]*display:\s*inline-flex\s*!important[^}]*justify-content:\s*center\s*!important[^}]*text-align:\s*center\s*!important/s);
    assert.match(css, /\.cmr-add-button\.menu_button\s*{[^}]*block-size:\s*1\.9rem[^}]*padding-inline:\s*0\.5rem/s);
    assert.match(css, /\.cmr-operation-actions\s*{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
    assert.match(css, /@container \(max-width: 560px\)[\s\S]*\.cmr-operation-actions\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
    assert.match(css, /\.cmr-tool-section,[\s\S]*\.cmr-scope-note\s*{[^}]*margin-block:[^;}]+;[^}]*padding-block:/s);
    assert.match(css, /#cmr_settings #cmr_provider optgroup\s*{[^}]*font-weight:\s*700/s);
    assert.match(html, /id="cmr_diagnostic_list"[^>]*aria-label="호환성 진단 결과"[^>]*tabindex="0"/);
});
