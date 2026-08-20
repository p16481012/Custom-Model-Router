import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { MODEL_PROVIDERS, STRUCTURAL_EXCLUSIONS } from '../src/providers.js';

const ROOT_URL = new URL('../', import.meta.url);

async function readText(path) {
    return readFile(new URL(path, ROOT_URL), 'utf8');
}

test('배포 파일과 진행 문서의 버전 표기가 모두 일치한다', async () => {
    const [
        manifestText,
        packageText,
        packageLockText,
        settingsHtml,
        readme,
        entrypoint,
        checklist,
        roadmap,
        apiDocument,
        portableSettings,
        compatibility,
        playwrightConfig,
        uiRegressionSpec,
        uiRegressionServer,
        uiRegressionWorkflow,
        rootEntries,
    ] = await Promise.all([
        readText('manifest.json'),
        readText('package.json'),
        readText('package-lock.json'),
        readText('settings.html'),
        readText('README.md'),
        readText('index.js'),
        readText('USER_CHECKLIST.md'),
        readText('ROADMAP.md'),
        readText('API.md'),
        readText('src/portable-settings.js'),
        readText('src/compatibility.js'),
        readText('playwright.config.js'),
        readText('tests/visual/ui-regression.spec.js'),
        readText('tests/visual/server.js'),
        readText('.github/workflows/ui-regression.yml'),
        readdir(ROOT_URL),
    ]);
    const manifest = JSON.parse(manifestText);
    const packageJson = JSON.parse(packageText);
    const packageLock = JSON.parse(packageLockText);
    const version = manifest.version;

    assert.match(version, /^0\.\d+\.\d+$/);
    assert.equal(packageJson.version, version);
    assert.equal(packageLock.version, version);
    assert.equal(packageLock.packages[''].version, version);
    assert.equal(packageJson.engines.node, '>=24');
    assert.equal(packageLock.packages[''].engines.node, '>=24');
    assert.match(packageJson.scripts['test:ui'], /playwright test.*playwright\.config\.js/);
    assert.match(packageJson.scripts.check, /src\/providers\.js/);
    assert.match(packageJson.scripts.check, /src\/model-select\.js/);
    assert.match(packageJson.scripts.check, /src\/model-management\.js/);
    assert.match(packageJson.scripts.check, /src\/registry-api\.js/);
    assert.match(packageJson.scripts.check, /src\/purpose-router\.js/);
    assert.match(packageJson.scripts.check, /src\/connection-profile-adapter\.js/);
    assert.match(packageJson.scripts.check, /src\/compatibility\.js/);
    assert.match(packageJson.scripts.check, /src\/portable-settings\.js/);
    assert.match(packageJson.scripts.check, /src\/external-integrations\.js/);
    assert.match(packageJson.scripts.check, /src\/external-settings\.js/);
    assert.doesNotMatch(settingsHtml, /cmr-version|>\s*v0\.\d+\.\d+\s*</, '관리 UI에는 버전 배지를 표시하지 않는다');
    assert.match(readme, new RegExp(`현재 버전은 \\*\\*v${version.replaceAll('.', '\\.')}`));
    assert.match(entrypoint, new RegExp(`EXTENSION_VERSION = '${version.replaceAll('.', '\\.')}'`));
    assert.match(entrypoint, /초기화 완료/);
    assert.match(checklist, new RegExp(`대상 버전: \\*\\*v${version.replaceAll('.', '\\.')}\\*\\*`));
    assert.match(roadmap, new RegExp(`현재 릴리스: \\*\\*v${version.replaceAll('.', '\\.')}\\*\\*`));
    assert.match(apiDocument, new RegExp(`Custom Model Router v${version.replaceAll('.', '\\.')}`));
    assert.match(readme, /\.\/USER_CHECKLIST\.md/);
    assert.match(readme, /\.\/ROADMAP\.md/);
    assert.match(readme, /\.\/API\.md/);
    assert.match(readme, /\.\/examples\/routing-integration\.js/);
    assert.match(readme, /API Connections/);
    for (const document of [readme, roadmap]) {
        assert.doesNotMatch(document, /모델 별칭|`MAIN`|`AUX`|`FAST`/);
    }
    assert.match(roadmap, /## v0\.3\.0 — 공개 Registry API/);
    assert.match(roadmap, /## v0\.4\.0 — 확장 어댑터와 용도별 라우팅/);
    assert.match(roadmap, /## v0\.5\.0 — 호환성과 운영 안정화/);
    assert.match(roadmap, /## v0\.6\.0 — 범용 외부 확장 모델 브리지/);
    assert.match(roadmap, /## v0\.6\.4 — 삭제 안전성·외부 선택 저장 회복/);
    assert.match(roadmap, /## v0\.6\.5 — UI 정리와 직접 연결 회귀 복구/);
    assert.match(roadmap, /## v0\.6\.6 — 외부 연결 단일화와 진단·버튼 수정/);
    assert.match(roadmap, /## v0\.6\.7 — 실제 UI 회귀 검사 자동화/);
    assert.match(roadmap, /## v0\.6\.8 — 외부 target 식별 안정화와 진단 정합성/);
    assert.match(roadmap, /## v0\.6\.9 — 외부 연결 예외 중심 UI와 schema v2/);
    assert.match(roadmap, /## v0\.6\.10 — 대량 모델 관리·안전한 복구와 외부 UI 정리/);
    assert.match(roadmap, /## v0\.6\.11 — 단일·여러 줄 모델 등록 UI 통합/);
    assert.match(roadmap, /## v0\.6\.12 — 런처 배지 제거와 설명 정보 구조 정리/);
    assert.match(roadmap, /## v0\.6\.13 — 외부 provider\/source 선택기 오탐 차단/);
    assert.match(settingsHtml, /<textarea[\s\S]*?id="cmr_model_id"/);
    assert.match(settingsHtml, /id="cmr_add_form"/);
    assert.doesNotMatch(settingsHtml, /cmr_bulk_/);
    assert.match(entrypoint, /#cmr_add_form'\)\?\.addEventListener\('submit', onAddModel\)/);
    assert.doesNotMatch(entrypoint, /cmr_bulk_/);
    assert.match(entrypoint, /new context\.Popup/);
    assert.match(entrypoint, /#cmr_open_manager/);
    assert.doesNotMatch(entrypoint, /className = 'cmr-launcher-count'/);
    assert.doesNotMatch(settingsHtml, /cmr-launcher-count/);
    assert.match(entrypoint, /사용자 모델 관리, \$\{modelCount\}개 등록됨/);
    assert.doesNotMatch(entrypoint, /#extensions_settings2|#extensions_settings/);
    assert.doesNotMatch(settingsHtml, /inline-drawer/);
    assert.match(entrypoint, /installRegistryApi\(globalThis/);
    assert.match(entrypoint, /createPurposeRoutingApi/);
    assert.match(entrypoint, /createSillyTavernConnectionProfileAdapter/);
    assert.match(entrypoint, /diagnoseCompatibility/);
    assert.match(entrypoint, /stringifyPortableSettings/);
    assert.match(entrypoint, /createExternalIntegrationController/);
    assert.match(entrypoint, /normalizeAutomaticExternalSettings/);
    assert.match(settingsHtml, /cmr_run_diagnostics/);
    assert.match(settingsHtml, /cmr_export_backup/);
    assert.match(settingsHtml, /호환성 진단 및 CMR 설정 백업/);
    assert.equal((settingsHtml.match(/class="cmr-info-button"/g) ?? []).length, 5);
    assert.equal((settingsHtml.match(/popover="auto"/g) ?? []).length, 5);
    for (const helpId of [
        'cmr_provider_help',
        'cmr_model_help',
        'cmr_model_list_help',
        'cmr_operations_help',
        'cmr_external_help',
    ]) {
        assert.match(settingsHtml, new RegExp(`popovertarget="${helpId}"`));
        assert.match(settingsHtml, new RegExp(`id="${helpId}"[^>]*popover="auto"`));
    }
    assert.match(settingsHtml, /id="cmr_provider_hint"[^>]*>등록 위치만 정하며 현재 모델은 바뀌지 않습니다/);
    assert.match(settingsHtml, /id="cmr_model_hint"[^>]*>한 줄에 하나 · 최대 200개 · 오류가 있으면 전체 취소/);
    assert.match(settingsHtml, /실제 요청 적용은 외부 기능에서 직접 확인하세요/);
    const scopeContent = settingsHtml.match(/<details class="cmr-scope-note">([\s\S]*?)<\/details>/)?.[1] ?? '';
    assert.equal((scopeContent.match(/<p class="cmr-sentence">/g) ?? []).length, 3);
    assert.match(scopeContent, /표준 Chat Completion 모델 칸만 지원합니다/);
    assert.match(scopeContent, /비채팅 모델 칸과 자체 위젯은 변경하지 않습니다/);
    assert.match(scopeContent, /API 키·계정·엔드포인트는 저장하거나 백업하지 않습니다/);
    assert.doesNotMatch(settingsHtml, /id="cmr_external_section"/);
    assert.match(settingsHtml, /id="cmr_external_warning"[^>]*hidden/);
    assert.match(settingsHtml, /id="cmr_external_advanced"/);
    assert.match(settingsHtml, /cmr_external_(?:list|status|count)/);
    assert.match(settingsHtml, /id="cmr_external_picker"/);
    assert.match(settingsHtml, /id="cmr_external_picker_list"/);
    assert.doesNotMatch(settingsHtml, /cmr_external_refresh|data-cmr-external-mode/);
    assert.doesNotMatch(settingsHtml, /cmr_rout(?:ing_section|e_(?:form|purpose|model|profile|clear|test|status))/);
    assert.match(portableSettings, /PORTABLE_SETTINGS_SCHEMA_VERSION = 2/);
    assert.match(portableSettings, /externalIntegrations/);
    assert.match(compatibility, /DIAGNOSTIC_SCHEMA_VERSION = 2/);
    assert.match(readme, /진단 JSON schema v2/);
    assert.match(roadmap, /진단 JSON schema v2/);
    assert.match(checklist, /진단 schema v2/);
    assert.match(apiDocument, /v0\.6 범용 DOM 모델 브리지/);
    assert.match(apiDocument, /Portable backup schema v2/);
    assert.match(apiDocument, /v0\.6\.7의 Playwright UI 회귀 검사 인프라/);
    assert.match(apiDocument, /v0\.6\.12의 런처 숫자 배지 제거와 정보 popover 중심 문구 정리/);
    assert.match(apiDocument, /v0\.6\.13의 외부 provider\/source 선택기 오탐 차단/);
    assert.match(apiDocument, /모두 새 객체로 만들고 순서까지 뒤집으면/);
    assert.match(apiDocument, /DOM 브리지 내부 저장 schema v2/);
    assert.match(apiDocument, /excludedTargets/);
    assert.match(apiDocument, /disabled.*사용자 제외로 되살리지 않습니다/);
    assert.match(readme, /select\/input\/datalist/);
    assert.match(roadmap, /fetch.*XMLHttpRequest.*monkey patch/);
    for (const document of [readme, roadmap, checklist]) {
        assert.match(document, /Playwright Chromium UI 회귀 검사 (?:__UI_TEST_COUNT__|\d+)개/);
        assert.match(document, /전체 SillyTavern.*런타임/);
        assert.match(document, /12개/);
        assert.match(document, /200/);
        assert.match(document, /실행 취소/);
        assert.match(document, /추가·충돌·삭제/);
        assert.match(document, /2,048개/);
    }
    for (const document of [readme, roadmap, checklist, apiDocument]) {
        assert.match(document, /provider\/source 선택기/);
        assert.match(document, /targetCount/);
        assert.match(document, /provider(?:\/source)? 후보가 여러 개/);
    }
    assert.match(readme, /native provider option과 현재 값(?:은|을) 보존/);
    assert.match(roadmap, /native option·현재 값·기존 이벤트를 보존/);
    assert.match(checklist, /native provider option·현재 값은 유지/);
    assert.match(apiDocument, /native provider option과 현재 값은 보존/);
    for (const document of [readme, roadmap]) {
        assert.match(document, /검증 상태별 외부 확장 목록/);
        assert.match(document, /Caption/);
        assert.match(document, /Vectors/);
        assert.match(document, /Stable Diffusion/);
        assert.match(document, /호환.*인증.*(?:아니|아닙)/);
    }
    assert.match(apiDocument, /target 하나에는 native option과 중복되는 항목을 제외한 표시 가능한 CMR 후보 중 최대 512개/);
    assert.match(apiDocument, /2,048개/);
    assert.match(apiDocument, /추가·충돌·삭제/);
    assert.match(apiDocument, /복구 보고서의 `details`/);

    assert.match(playwrightConfig, /testDir:\s*'\.\/tests\/visual'/);
    assert.match(playwrightConfig, /browserName:\s*'chromium'/);
    assert.match(playwrightConfig, /screenshot:\s*'only-on-failure'/);
    for (const viewport of ['320, height: 568', '360, height: 640', '420, height: 800', '720, height: 900']) {
        assert.match(uiRegressionSpec, new RegExp(`width: ${viewport}`));
    }
    assert.match(uiRegressionSpec, /\[0, 6\]/);
    assert.match(uiRegressionSpec, /\[7, 12, 13, 100\]/);
    assert.match(uiRegressionSpec, /page\.keyboard\.press\('Escape'\)/);
    assert.match(uiRegressionSpec, /#cmr_external_list/);
    assert.match(uiRegressionSpec, /#cmr_diagnostic_list/);
    assert.match(uiRegressionSpec, /expectHiddenScrollbarCanScroll/);
    assert.match(uiRegressionSpec, /선택지 연결됨/);
    assert.match(uiRegressionSpec, /실제 요청 확인 필요/);
    assert.match(uiRegressionSpec, /#cmr_external_warning_open/);
    assert.match(uiRegressionSpec, /#cmr_external_advanced/);
    assert.match(uiRegressionSpec, /\.fa-plus/);
    assert.match(uiRegressionSpec, /cmr-info-button|cmr_provider_help_trigger/);
    assert.match(uiRegressionSpec, /popover-open|showPopover/);
    assert.match(uiRegressionServer, /REQUIRED_ST_VERSION = '1\.18\.0'/);
    assert.match(uiRegressionServer, /readFile\(resolve\(REPOSITORY_ROOT, 'settings\.html'\)/);
    assert.match(uiRegressionServer, /public', 'style\.css'/);
    assert.match(uiRegressionServer, /public', 'css', 'popup\.css'/);
    assert.match(uiRegressionWorkflow, /ref: 51ad27fb86d39a3daca3adaa970375c9670c12df/);
    assert.doesNotMatch(uiRegressionWorkflow, /uses:\s*actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);
    for (const actionCommit of [
        'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
        'a0853c24544627f65ddf259abe73b1d18a591444',
        'b7c566a772e6b6bfb58ed0dc250532a479d7789f',
    ]) {
        assert.match(uiRegressionWorkflow, new RegExp(actionCommit));
    }
    assert.equal(
        (uiRegressionWorkflow.match(/persist-credentials:\s*false/g) ?? []).length,
        2,
    );
    assert.match(uiRegressionWorkflow, /node-version:\s*24/);
    assert.match(uiRegressionWorkflow, /npx playwright install chromium/);
    assert.doesNotMatch(uiRegressionWorkflow, /playwright install --with-deps/);
    assert.match(uiRegressionWorkflow, /ui-regression-evidence-/);
    assert.match(uiRegressionWorkflow, /if: always\(\) && !cancelled\(\)/);
    assert.match(uiRegressionWorkflow, /retention-days: 14/);
    for (const document of [readme, roadmap, checklist, apiDocument]) {
        assert.match(document, /Vectors|embedding/);
        assert.match(document, /TTS/);
        assert.match(document, /Stable Diffusion/);
        assert.match(document, /iframe/);
        assert.match(document, /Shadow DOM/);
    }
    assert.doesNotMatch(entrypoint, /\.options\.some\(/, '실제 select.options는 Array가 아닌 HTMLCollection이다');
    assert.equal(
        rootEntries.some(name => /^licen[cs]e(?:\.|$)/i.test(name)),
        false,
        '사용자 요청에 따라 라이선스 파일을 추가하면 안 된다',
    );

    assert.equal(MODEL_PROVIDERS.length, 24, '등록 가능한 Chat Completion 연결은 24개여야 한다');
    assert.equal(new Set(MODEL_PROVIDERS.map(provider => provider.id)).size, 24);
    for (const providerId of ['zai', 'deepseek', 'moonshot', 'minimax', 'siliconflow', 'custom']) {
        assert.ok(
            MODEL_PROVIDERS.some(provider => provider.id === providerId),
            `${providerId} 제공업체가 등록 대상에 포함되어야 한다`,
        );
    }
    assert.deepEqual(
        STRUCTURAL_EXCLUSIONS,
        {
            azure_openai: 'deployment-name-controls-target',
            cometapi: 'core-disabled',
        },
    );
    for (const document of [readme, checklist, roadmap]) {
        assert.match(document, /24개/);
        assert.match(document, /Azure OpenAI/);
        assert.match(document, /CometAPI/);
    }
    assert.match(readme, /Z\.AI \(GLM\)/);
    assert.match(checklist, /Z\.AI \(GLM\)/);
    assert.match(roadmap, /Z\.AI \(GLM\)/);

    const testDirectory = new URL('../tests/', import.meta.url);
    const testFiles = (await readdir(testDirectory)).filter(name => name.endsWith('.test.js'));
    const testSources = await Promise.all(testFiles.map(name => readFile(new URL(name, testDirectory), 'utf8')));
    const testCount = testSources.reduce(
        (total, source) => total + Array.from(source.matchAll(/^test\(/gm)).length,
        0,
    );
    for (const document of [readme, roadmap, checklist]) {
        assert.doesNotMatch(
            document,
            /__(?:TEST_COUNT|UI_TEST_COUNT)__/,
            '최종 문서에는 Node/UI 테스트 개수 자리표시자가 남으면 안 된다',
        );
    }
    assert.match(readme, new RegExp(`현재 자동 검사 ${testCount}개`));
    assert.match(roadmap, new RegExp(`검사 ${testCount}개 통과`));
    assert.match(checklist, new RegExp(`Node 자동 검사 ${testCount}개`));
    const documentedUiCounts = [readme, roadmap, checklist].map(document => {
        const match = document.match(/Playwright Chromium UI 회귀 검사 (\d+)개/);
        assert.ok(match, '최종 문서에는 Playwright UI 검사 개수를 숫자로 기록해야 한다');
        return Number(match[1]);
    });
    assert.equal(new Set(documentedUiCounts).size, 1, '세 문서의 Playwright UI 검사 개수가 같아야 한다');
    assert.equal(documentedUiCounts[0], 11, 'v0.6.13 Playwright UI 검사 개수는 11개여야 한다');

    const checklistIds = Array.from(
        checklist.matchAll(/\*\*\[(?:필수|조건부|권장|선택)\]\[([A-Z0-9-]+)\]/g),
        match => match[1],
    );
    assert.ok(checklistIds.length >= 30, '사용자 검증 항목이 충분히 제공되어야 한다');
    assert.equal(new Set(checklistIds).size, checklistIds.length, '체크리스트 항목 ID는 중복되면 안 된다');
});
