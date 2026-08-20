import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readUiFiles() {
    return Promise.all([
        readFile(new URL('settings.html', ROOT_URL), 'utf8'),
        readFile(new URL('style.css', ROOT_URL), 'utf8'),
        readFile(new URL('index.js', ROOT_URL), 'utf8'),
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

test('등록 모델 영역은 전체 보기와 12개 초과 검색 계약을 사용한다', async () => {
    const [html, css, index] = await readUiFiles();

    assert.match(html, /class="cmr-list-region" data-cmr-list-scope="all"/);
    assert.match(html, /id="cmr_list_title">전체 등록 모델</);
    assert.match(html, /id="cmr_model_count"[^>]*>제공업체 0곳 · 모델 0개</);
    assert.match(html, /id="cmr_model_search_region"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_model_search"[^>]*type="search"[^>]*aria-controls="cmr_model_list"/s);
    assert.match(index, /const searchVisible = shouldShowModelSearch\(models\.length\)/);
    assert.match(index, /filterRegisteredModels\(\s*models,\s*modelSearchQuery/s);
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

test('통합 모델 등록·삭제 실행 취소·백업 미리보기는 접근 가능한 독립 흐름을 갖는다', async () => {
    const [html, css, index] = await readUiFiles();

    for (const id of [
        'cmr_add_form',
        'cmr_model_id',
        'cmr_undo_delete',
        'cmr_import_preview',
        'cmr_import_preview_summary',
        'cmr_import_preview_list',
        'cmr_import_preview_cancel',
        'cmr_import_preview_apply',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /<textarea[\s\S]*?id="cmr_model_id"[\s\S]*?rows="3"[\s\S]*?maxlength="65536"[\s\S]*?placeholder="한 줄에 모델 ID 하나"[\s\S]*?<\/textarea>/);
    assert.doesNotMatch(html, /cmr_bulk_/);
    assert.match(html, /id="cmr_undo_delete"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_import_preview"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_import_preview_list"[^>]*aria-label="백업 변경 내역"[^>]*tabindex="0"/);
    assert.match(index, /#cmr_add_form'\)\?\.addEventListener\('submit', onAddModel\)/);
    assert.doesNotMatch(index, /cmr_bulk_|onBulkAddModels/);
    assert.match(index, /#cmr_undo_delete'\)\?\.addEventListener\('click', onUndoModelDeletion\)/);
    assert.match(index, /#cmr_import_preview_apply'\)\?\.addEventListener\('click', onApplyImportPreview\)/);
    assert.match(index, /#cmr_import_preview_cancel'\)\?\.addEventListener\('click', onCancelImportPreview\)/);
    assert.match(css, /\.cmr-add-form textarea\s*{[^}]*resize:\s*vertical/s);
    assert.doesNotMatch(css, /cmr-bulk-add-form|cmr-inline-actions/);
    assert.match(css, /\.cmr-undo-button\[hidden\]\s*{[^}]*display:\s*none\s*!important/s);
    assert.match(css, /\.cmr-import-preview\[hidden\]\s*{[^}]*display:\s*none/s);
    assert.match(css, /\.cmr-change-list\s*{[^}]*max-block-size:[^;}]+;[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s);
    assert.match(css, /\.cmr-change-list::\-webkit-scrollbar\s*{[^}]*display:\s*none/s);
});

test('모델 목록은 6개 초과 표식에서만 내부 스크롤하고 스크롤바를 숨긴다', async () => {
    const [, css, index] = await readUiFiles();

    assert.match(css, /\.cmr-model-list\s*{[^}]*overflow:\s*visible/s);
    assert.match(css, /\.cmr-model-list\[data-scrollable="true"\]\s*{[^}]*max-block-size:[^;}]+;[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s);
    assert.match(css, /\.cmr-model-list\[data-scrollable="true"\]::\-webkit-scrollbar\s*{[^}]*display:\s*none/s);
    assert.match(css, /\.cmr-icon-button\.menu_button\s*{[^}]*inline-size:\s*1\.75rem\s*!important[^}]*min-inline-size:\s*1\.75rem\s*!important/s);
    assert.match(css, /\.cmr-model-state\s*{[^}]*border-radius:\s*999px/s);
    assert.match(index, /state\.textContent = '비활성'/);
    assert.match(index, /const models = normalizeSettings\(settings\)\.models/);
});

test('정보 도움말은 다섯 개 native popover와 접근 가능한 아이콘 버튼으로 연결된다', async () => {
    const [html, css] = await readUiFiles();
    const helpPairs = [
        ['cmr_provider_help_trigger', 'cmr_provider_help', '제공업체 선택 도움말'],
        ['cmr_model_help_trigger', 'cmr_model_help', '모델 ID 등록 규칙'],
        ['cmr_model_list_help_trigger', 'cmr_model_list_help', '등록 모델 목록 도움말'],
        ['cmr_operations_help_trigger', 'cmr_operations_help', '진단 및 백업 도움말'],
        ['cmr_external_help_trigger', 'cmr_external_help', '외부 모델 연결 도움말'],
    ];

    assert.equal((html.match(/class="cmr-info-button"/g) ?? []).length, helpPairs.length);
    assert.equal((html.match(/class="fa-solid fa-circle-info" aria-hidden="true"/g) ?? []).length, helpPairs.length);
    assert.equal((html.match(/class="cmr-help-popover" popover="auto"/g) ?? []).length, helpPairs.length);

    for (const [triggerId, helpId, label] of helpPairs) {
        const triggerStart = html.indexOf(`id="${triggerId}"`);
        const buttonStart = html.lastIndexOf('<button', triggerStart);
        const buttonEnd = html.indexOf('</button>', triggerStart) + '</button>'.length;
        const button = html.slice(buttonStart, buttonEnd);
        const helpStart = html.indexOf(`id="${helpId}"`);
        const helpOpenStart = html.lastIndexOf('<div', helpStart);
        const helpOpenEnd = html.indexOf('>', helpStart) + 1;
        const helpOpeningTag = html.slice(helpOpenStart, helpOpenEnd);

        assert.ok(triggerStart >= 0, `${triggerId} trigger가 있어야 합니다.`);
        assert.match(button, /class="cmr-info-button"/);
        assert.match(button, /type="button"/);
        assert.match(button, new RegExp(`popovertarget="${helpId}"`));
        assert.match(button, new RegExp(`aria-describedby="${helpId}"`));
        assert.match(button, new RegExp(`aria-label="${label}"`));
        assert.match(button, /class="fa-solid fa-circle-info" aria-hidden="true"/);
        assert.match(helpOpeningTag, /class="cmr-help-popover"/);
        assert.match(helpOpeningTag, /popover="auto"/);
    }

    const summaryContent = [...html.matchAll(/<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/g)]
        .map(match => match[1])
        .join('\n');
    assert.doesNotMatch(summaryContent, /<button\b/);
    assert.match(css, /\.cmr-help-popover\s*{[^}]*display:\s*none[^}]*max-inline-size:\s*min\(22rem,\s*calc\(100dvw - 1rem\)\)[^}]*word-break:\s*keep-all[^}]*overflow-wrap:\s*normal/s);
    assert.match(css, /\.cmr-help-popover:popover-open\s*{[^}]*display:\s*block/s);
    assert.match(css, /\.cmr-info-button:focus-visible\s*{[^}]*outline:/s);
});

test('상시 안내는 짧게 유지하고 긴 도움말을 입력 컨트롤에 직접 연결하지 않는다', async () => {
    const [html, css, index] = await readUiFiles();

    assert.match(html, /class="cmr-description">목록에 없는 모델을 등록하고, 실제 선택은 API Connections에서 합니다\.<\/p>/);
    assert.match(html, /id="cmr_provider_hint">등록 위치만 정하며 현재 모델은 바뀌지 않습니다\.<\/small>/);
    assert.match(html, /id="cmr_model_hint">한 줄에 하나 · 최대 200개 · 오류가 있으면 전체 취소<\/small>/);
    assert.match(html, /id="cmr_operations_description"[^>]*>CMR 상태를 진단하고 비밀정보를 제외한 설정을 백업·복구합니다\.<\/p>/);
    assert.match(html, /class="cmr-tool-description">실제 요청 적용은 외부 기능에서 직접 확인하세요\.<\/p>/);
    assert.match(html, /<select id="cmr_provider"[^>]*aria-describedby="cmr_provider_hint"[^>]*>/);
    assert.match(html, /<textarea[\s\S]*?id="cmr_model_id"[\s\S]*?aria-describedby="cmr_model_hint cmr_feedback"[\s\S]*?<\/textarea>/);
    assert.match(html, /<ul id="cmr_model_list"[^>]*aria-labelledby="cmr_list_title"[^>]*><\/ul>/);
    assert.doesNotMatch(html, /<select id="cmr_provider"[^>]*aria-describedby="[^"]*cmr_provider_help/);
    assert.doesNotMatch(html, /<textarea[\s\S]*?id="cmr_model_id"[\s\S]*?aria-describedby="[^"]*cmr_(?:provider|model)_help/);
    assert.doesNotMatch(html, /<ul id="cmr_model_list"[^>]*aria-describedby=/);
    assert.match(index, /help\.textContent = formatUiSentences\(/);
    assert.match(index, /\$\{getProviderHelp\(provider\)\}[^`]*빈 줄·중복·SillyTavern 기본 모델은 건너뛰며/);
    assert.match(css, /#cmr_settings #cmr_model_help[\s\S]*?white-space:\s*pre-line/);
    assert.match(css, /word-break:\s*keep-all/);
    assert.match(css, /overflow-wrap:\s*normal/);
    assert.match(css, /\.cmr-sentence\s*{[^}]*display:\s*block/s);
    assert.doesNotMatch(css, /word-break:\s*break-all/);
});

test('외부 연결 UI는 평상시 숨기고 문제 경고와 고급 제외 관리만 제공한다', async () => {
    const [html, css, index] = await readUiFiles();

    assert.doesNotMatch(html, /id="cmr_external_section"/);
    for (const id of [
        'cmr_external_warning',
        'cmr_external_warning_open',
        'cmr_external_advanced',
        'cmr_external_count',
        'cmr_external_status',
        'cmr_external_list',
        'cmr_external_picker',
        'cmr_external_picker_list',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /id="cmr_external_warning"[^>]*hidden/);
    assert.match(html, /id="cmr_external_warning_open"[\s\S]*?title="외부 연결 관리 열기"[\s\S]*?aria-label="고급 외부 연결 관리 열기"/);
    const operations = html.match(/<details class="cmr-tool-section" id="cmr_operations_section">([\s\S]*?)<\/details>\s*<\/div>\s*<\/details>/)?.[1] ?? '';
    assert.match(operations, /id="cmr_external_advanced"/);
    assert.match(operations, /고급: 외부 연결 관리/);
    assert.match(operations, /id="cmr_external_list"[^>]*aria-label="외부 확장 모델 연결 관리"[^>]*tabindex="0"/);
    assert.match(operations, /연결 실패와 사용자가 제외한 대상만 기본 목록에 표시합니다/);
    assert.match(operations, /문제가 생긴 모델 칸 제외/);
    assert.match(operations, /id="cmr_external_picker_list"[^>]*aria-label="연결에서 제외할 외부 모델 칸"[^>]*tabindex="0"/);
    assert.match(operations, /문제가 생긴 모델 칸만 제외하세요/);
    assert.match(operations, /실제 요청 적용은 외부 기능에서 직접 확인하세요/);
    assert.match(operations, /선택지가 보여도 실제 요청에 사용됐다는 뜻은 아닙니다/);
    assert.match(index, /const directTargets = targets\.filter\(target => target\.resolution\?\.source === 'direct'\)/);
    assert.match(index, /const failedTargets = directTargets\.filter\(target => target\.bridge\?\.status === 'failed'\)/);
    assert.match(index, /const userExcludedTargets = targets\.filter\(target => target\.resolution\?\.source === 'user-excluded'\)/);
    assert.match(index, /const selectableTargets = directTargets\.filter\(target => target\.bridge\?\.status !== 'failed'\)/);
    assert.match(index, /appendExternalRows\(\s*list,\s*\[\.\.\.failedTargets, \.\.\.userExcludedTargets\]/s);
    assert.match(index, /appendExternalRows\(\s*pickerList,\s*selectableTargets/s);
    const renderer = index.match(/function renderExternalIntegrations\(\)\s*{([\s\S]*?)\n}\n\nfunction renderUi/)?.[1] ?? '';
    assert.doesNotMatch(renderer, /risk-blocked/);
    assert.match(index, /const capacityLimitedTargetCount = Math\.max\(0, metrics\.capacityLimitedTargetCount \?\? 0\)/);
    assert.match(index, /const managedOptionCapacityLimited = capacityLimitedTargetCount > 0/);
    assert.match(index, /managedOptionCount\s*>\s*EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD/);
    assert.match(index, /외부 모델 칸 \$\{capacityLimitedTargetCount\}곳은 표시 가능한 CMR 선택지가 \$\{EXTERNAL_INJECTED_OPTION_LIMIT\}개를 넘어 일부만 표시합니다/);
    assert.match(index, /외부 모델 선택지 \$\{managedOptionCount\}개가 권장 한도 \$\{EXTERNAL_MANAGED_OPTION_WARNING_THRESHOLD\}개를 초과했습니다/);
    assert.match(index, /failedTargets\.length > 0 \|\| runtimeMismatch \|\| hasManagedOptionWarning/);
    assert.doesNotMatch(html, /cmr_external_refresh|data-cmr-external-mode|<dt>자동 연결|<dt>연결 안 함/);
    assert.match(css, /\.cmr-warning-card\b/);
    assert.match(css, /\.cmr-advanced-section\b/);
    assert.match(css, /\.cmr-advanced-body\s*{[^}]*clear:\s*both[^}]*inline-size:\s*100%[^}]*min-width:\s*0/s);
    assert.match(css, /\.cmr-external-row\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
    assert.match(css, /\.cmr-external-heading\s*{[^}]*display:\s*grid[^}]*flex:\s*1 1 auto/s);
    assert.match(css, /\.cmr-external-name\s*{[^}]*display:\s*block[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.cmr-external-state\[data-state="connected"\]/);
    assert.match(css, /\.cmr-external-state\[data-state="excluded"\]/);
    assert.doesNotMatch(css, /select\[data-cmr-external-mode\]|cmr-external-mode-guide|cmr-external-toolbar/);
});

test('모델 추가 버튼은 접근 가능한 아이콘 전용 정사각형 버튼이다', async () => {
    const [html, css] = await readUiFiles();
    const addForm = html.match(/<form id="cmr_add_form"[\s\S]*?<\/form>/)?.[0] ?? '';
    const button = addForm.match(/<button(?=[^>]*class="menu_button cmr-add-button cmr-icon-button")[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

    assert.equal((addForm.match(/<button\b/g) ?? []).length, 2);
    assert.equal((addForm.match(/class="cmr-info-button"/g) ?? []).length, 1);
    assert.equal((addForm.match(/class="menu_button cmr-add-button cmr-icon-button"/g) ?? []).length, 1);
    assert.equal((addForm.match(/<textarea\b/g) ?? []).length, 1);
    assert.match(button, /type="submit"/);
    assert.match(button, /title="모델 등록"/);
    assert.match(button, /aria-label="입력한 모델 ID 등록"/);
    assert.match(button, /class="fa-solid fa-plus"/);
    assert.doesNotMatch(button, /<span|>\s*추가\s*</);
    assert.match(css, /\.cmr-input-row > \.cmr-add-button\.menu_button\s*{[^}]*block-size:\s*1\.9rem[^}]*inline-size:\s*1\.9rem\s*!important[^}]*padding:\s*0\s*!important/s);
});

test('버튼·상세 섹션·제공업체 그룹은 SillyTavern 전역 스타일과 독립적으로 정렬된다', async () => {
    const [html, css] = await readUiFiles();

    assert.match(css, /#cmr_settings \.menu_button\s*{[^}]*display:\s*inline-flex\s*!important[^}]*justify-content:\s*center\s*!important[^}]*text-align:\s*center\s*!important/s);
    assert.match(css, /\.cmr-input-row > \.cmr-add-button\.menu_button\s*{[^}]*block-size:\s*1\.9rem[^}]*inline-size:\s*1\.9rem\s*!important/s);
    assert.match(css, /\.cmr-operation-actions\s*{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
    assert.match(css, /@container \(max-width: 560px\)[\s\S]*\.cmr-operation-actions\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
    assert.match(css, /\.cmr-tool-section,[\s\S]*\.cmr-scope-note\s*{[^}]*margin-block:[^;}]+;[^}]*padding-block:/s);
    assert.match(css, /#cmr_settings #cmr_provider optgroup\s*{[^}]*font-weight:\s*700/s);
    assert.match(html, /id="cmr_diagnostic_list"[^>]*aria-label="호환성 진단 결과"[^>]*tabindex="0"/);
});
