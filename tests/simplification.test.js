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
    assert.match(html, /<textarea[\s\S]*?id="cmr_model_id"[\s\S]*?maxlength="65536"[\s\S]*?<\/textarea>/);
    assert.doesNotMatch(html, /cmr_bulk_/);
    assert.match(html, /id="cmr_model_list"/);
    assert.match(html, /id="cmr_model_search_region"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_undo_delete"[^>]*\bhidden\b/);
    assert.match(html, /data-cmr-list-scope="all"/);
    assert.match(html, /id="cmr_compatibility"[^>]*\bhidden\b/);
    assert.doesNotMatch(html, /id="cmr_external_section"/);
    assert.match(html, /id="cmr_external_warning"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_external_warning_open"/);
    assert.match(html, /id="cmr_operations_section"/);
    assert.match(html, /id="cmr_external_advanced"/);
    assert.match(html, /id="cmr_external_list"/);
    assert.match(html, /id="cmr_external_picker"/);
    assert.match(html, /id="cmr_external_picker_list"/);
    assert.match(html, /연결 실패와 사용자가 제외한 대상만 기본 목록에 표시합니다/);
    assert.match(html, /실제 요청 적용은 외부 기능에서 직접 확인하세요/);
    assert.match(html, /선택지가 보여도 실제 요청에 사용됐다는 뜻은 아닙니다/);
    assert.doesNotMatch(html, /id="cmr_external_refresh"|data-cmr-external-mode/);
    assert.doesNotMatch(html, /<dt>자동 연결|<dt>연결 안 함/);
    assert.doesNotMatch(html, /id="cmr_rout(?:ing_section|e_(?:form|purpose|model|profile|clear|test|status))"/);
    assert.doesNotMatch(source, /dataset\.cmrAction\s*=\s*'select'/);
    assert.match(source, /dataset\.cmrAction\s*=\s*'delete'/);
    assert.equal((source.match(/#cmr_add_form'\)\?\.addEventListener\('submit', onAddModel\)/g) ?? []).length, 1);
    assert.doesNotMatch(source, /cmr_bulk_|onBulkAddModels/);
    assert.match(source, /appendExternalRows\(\s*list,\s*\[\.\.\.failedTargets, \.\.\.userExcludedTargets\]/s);
    assert.match(source, /appendExternalRows\(\s*pickerList,\s*selectableTargets/s);

    const addButton = html.match(/<button\b[^>]*class="[^"]*cmr-add-button[^"]*"[^>]*>([\s\S]*?)<\/button>/)?.[0] ?? '';
    assert.equal((html.match(/\bcmr-add-button\b/g) ?? []).length, 1);
    assert.match(addButton, /aria-label="[^"]+"/);
    assert.match(addButton, /title="[^"]+"/);
    assert.match(addButton, /fa-plus/);
    assert.doesNotMatch(addButton, /<span\b|>\s*추가\s*</);
});

test('설정 복구는 파일 선택 직후 적용하지 않고 변경 미리보기를 거친다', async () => {
    const [html, source] = await Promise.all([
        readText('settings.html'),
        readText('index.js'),
    ]);

    assert.match(html, /id="cmr_import_preview"[^>]*\bhidden\b/);
    assert.match(html, /id="cmr_import_preview_summary"[^>]*role="status"/);
    assert.match(html, /id="cmr_import_preview_list"[^>]*aria-label="백업 변경 내역"/);
    assert.match(html, /id="cmr_import_preview_cancel"/);
    assert.match(html, /id="cmr_import_preview_apply"/);
    assert.match(source, /pendingImportPreview\s*=\s*\{/);
    assert.match(source, /renderImportPreview\(\)/);
    assert.match(source, /백업 변경 내역을 확인한 뒤 적용하거나 취소해 주세요/);
});

test('브라우저 샌드박스는 안전 대상 자동 연결·native provider 재사용·재렌더 시나리오를 유지한다', async () => {
    const html = await readText('tests/browser-sandbox.html');

    assert.match(html, /id="switch_caption_provider"/);
    assert.match(html, /switchCaptionProvider\(\)/);
    assert.match(html, /class="caption_settings"/);
    assert.match(html, /id="caption_multimodal_api"[^>]*aria-label="Caption model provider"/);
    assert.match(html, /id="caption_multimodal_model"/);
    assert.match(html, /captionProviderTargeted/);
    assert.match(html, /captionProviderManagedCount/);
    assert.match(html, /captionModelTargeted/);
    assert.match(html, /captionModelManagedCount/);
    assert.match(html, /setCaptionProvider\(value\)/);
    assert.match(html, /cleanupStaleCaptionProviderModel\(\)/);
    assert.match(html, /staleGroup\.dataset\.cmrExternalGroup\s*=\s*'true'/);
    assert.match(html, /staleOption\.dataset\.cmrExternalModel\s*=\s*'true'/);
    assert.match(html, /controller\.rescan\(\)/);
    assert.match(html, /data-extension-name="unknown helper"/);
    assert.match(html, /id="native_custom_provider"/);
    assert.match(html, /value="custom" selected>Custom OpenAI-compatible/);
    assert.match(html, /id="native_current_provider"/);
    assert.match(html, /value="current_st" label="Current SillyTavern Settings" selected/);
    assert.match(html, /id="ambiguous_native_provider"/);
    assert.match(html, /value="main" selected>Main/);
    assert.match(html, /getCurrentSillyTavernProviderId:\s*\(\) => currentSillyTavernProviderId/);
    assert.match(html, /setCurrentSillyTavernProviderId\(providerId\)/);
    assert.match(html, /nativeReuseKind/);
    assert.match(html, /verificationRequired/);
    assert.match(html, /endpointUnchanged/);
    assert.match(html, /apiKeyUnchanged/);
    assert.match(html, /browser-sandbox=0\.6\.16/);
    assert.match(html, /제공업체 선택기가 없어도 안전하게 자동 연결/);
});

test('수동 UI 샌드박스도 모델 등록·복구 미리보기·외부 목록 분리를 반영한다', async () => {
    const html = await readText('tests/ui-sandbox.html');
    const actionList = html.match(/id="cmr_external_list"[\s\S]*?<\/ul>/)?.[0] ?? '';
    const pickerList = html.match(/id="cmr_external_picker_list"[\s\S]*?<\/ul>/)?.[0] ?? '';

    for (const id of [
        'cmr_model_id',
        'cmr_undo_delete',
        'cmr_model_search_region',
        'cmr_import_preview',
        'cmr_external_picker',
        'cmr_external_picker_list',
        'cmr_provider_help_trigger',
        'cmr_model_help_trigger',
        'cmr_model_list_help_trigger',
        'cmr_operations_help_trigger',
        'cmr_external_help_trigger',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.equal((html.match(/class="cmr-info-button"/g) ?? []).length, 5);
    assert.equal((html.match(/class="cmr-help-popover" popover="auto"/g) ?? []).length, 5);
    assert.match(html, /목록에 없는 모델을 등록하고, 실제 선택은 API Connections에서 합니다/);
    assert.match(html, /등록 위치만 정하며 현재 모델은 바뀌지 않습니다/);
    assert.match(html, /한 줄에 하나 · 최대 200개 · 오류가 있으면 전체 취소/);
    assert.match(html, /실제 요청 적용은 외부 기능에서 직접 확인하세요/);
    assert.match(actionList, /선택지 연결 실패/);
    assert.match(actionList, /사용자 제외/);
    assert.doesNotMatch(actionList, /선택지 연결됨/);
    assert.match(pickerList, /선택지 연결됨/);
    assert.match(pickerList, /실제 요청 확인 필요/);
    assert.doesNotMatch(actionList + pickerList, /안전상 제외/);
});
