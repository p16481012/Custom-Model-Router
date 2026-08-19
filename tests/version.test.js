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
    assert.match(packageJson.scripts['test:ui'], /playwright test.*playwright\.config\.js/);
    assert.match(packageJson.scripts.check, /src\/providers\.js/);
    assert.match(packageJson.scripts.check, /src\/model-select\.js/);
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
    assert.match(entrypoint, /new context\.Popup/);
    assert.match(entrypoint, /#cmr_open_manager/);
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
    assert.match(settingsHtml, /cmr_external_(?:section|list|status|count)/);
    assert.doesNotMatch(settingsHtml, /cmr_external_refresh|data-cmr-external-mode/);
    assert.doesNotMatch(settingsHtml, /cmr_rout(?:ing_section|e_(?:form|purpose|model|profile|clear|test|status))/);
    assert.match(portableSettings, /PORTABLE_SETTINGS_SCHEMA_VERSION = 2/);
    assert.match(portableSettings, /externalIntegrations/);
    assert.match(apiDocument, /v0\.6 범용 DOM 모델 브리지/);
    assert.match(apiDocument, /Portable backup schema v2/);
    assert.match(apiDocument, /v0\.6\.7의 Playwright UI 회귀 검사 인프라/);
    assert.match(readme, /select\/input\/datalist/);
    assert.match(roadmap, /fetch.*XMLHttpRequest.*monkey patch/);
    for (const document of [readme, roadmap, checklist]) {
        assert.match(document, /Playwright Chromium UI 회귀 검사 6개/);
        assert.match(document, /전체 SillyTavern.*런타임/);
    }

    assert.match(playwrightConfig, /testDir:\s*'\.\/tests\/visual'/);
    assert.match(playwrightConfig, /browserName:\s*'chromium'/);
    assert.match(playwrightConfig, /screenshot:\s*'only-on-failure'/);
    for (const viewport of ['320, height: 568', '360, height: 640', '420, height: 800', '720, height: 900']) {
        assert.match(uiRegressionSpec, new RegExp(`width: ${viewport}`));
    }
    assert.match(uiRegressionSpec, /\[0, 6\]/);
    assert.match(uiRegressionSpec, /\[7, 100\]/);
    assert.match(uiRegressionSpec, /page\.keyboard\.press\('Escape'\)/);
    assert.match(uiRegressionSpec, /#cmr_external_list/);
    assert.match(uiRegressionSpec, /#cmr_diagnostic_list/);
    assert.match(uiRegressionSpec, /expectHiddenScrollbarCanScroll/);
    assert.match(uiRegressionSpec, /직접 연결했습니다/);
    assert.match(uiRegressionServer, /REQUIRED_ST_VERSION = '1\.18\.0'/);
    assert.match(uiRegressionServer, /readFile\(resolve\(REPOSITORY_ROOT, 'settings\.html'\)/);
    assert.match(uiRegressionServer, /public', 'style\.css'/);
    assert.match(uiRegressionServer, /public', 'css', 'popup\.css'/);
    assert.match(uiRegressionWorkflow, /ref: 51ad27fb86d39a3daca3adaa970375c9670c12df/);
    assert.doesNotMatch(uiRegressionWorkflow, /uses:\s*actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);
    for (const actionCommit of [
        '11d5960a326750d5838078e36cf38b85af677262',
        '49933ea5288caeca8642d1e84afbd3f7d6820020',
        'ea165f8d65b6e75b540449e92b4886f43607fa02',
    ]) {
        assert.match(uiRegressionWorkflow, new RegExp(actionCommit));
    }
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
    assert.match(readme, new RegExp(`현재 자동 검사 ${testCount}개`));
    assert.match(roadmap, new RegExp(`검사 ${testCount}개 통과`));

    const checklistIds = Array.from(
        checklist.matchAll(/\*\*\[(?:필수|조건부|권장|선택)\]\[([A-Z0-9-]+)\]/g),
        match => match[1],
    );
    assert.ok(checklistIds.length >= 30, '사용자 검증 항목이 충분히 제공되어야 한다');
    assert.equal(new Set(checklistIds).size, checklistIds.length, '체크리스트 항목 ID는 중복되면 안 된다');
});
