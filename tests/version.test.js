import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readText(path) {
    return readFile(new URL(path, ROOT_URL), 'utf8');
}

test('배포 파일과 진행 문서의 버전 표기가 모두 일치한다', async () => {
    const [
        manifestText,
        packageText,
        settingsHtml,
        readme,
        entrypoint,
        checklist,
        roadmap,
        rootEntries,
    ] = await Promise.all([
        readText('manifest.json'),
        readText('package.json'),
        readText('settings.html'),
        readText('README.md'),
        readText('index.js'),
        readText('USER_CHECKLIST.md'),
        readText('ROADMAP.md'),
        readdir(ROOT_URL),
    ]);
    const manifest = JSON.parse(manifestText);
    const packageJson = JSON.parse(packageText);
    const version = manifest.version;

    assert.match(version, /^0\.\d+\.\d+$/);
    assert.equal(packageJson.version, version);
    assert.match(settingsHtml, new RegExp(`cmr-version[^>]*>v${version}<`));
    assert.match(readme, new RegExp(`현재 버전은 \\*\\*v${version.replaceAll('.', '\\.')}`));
    assert.match(entrypoint, new RegExp(`v${version.replaceAll('.', '\\.')} 초기화 완료`));
    assert.match(checklist, new RegExp(`대상 버전: \\*\\*v${version.replaceAll('.', '\\.')}\\*\\*`));
    assert.match(roadmap, new RegExp(`현재 릴리스: \\*\\*v${version.replaceAll('.', '\\.')}\\*\\*`));
    assert.match(readme, /\.\/USER_CHECKLIST\.md/);
    assert.match(readme, /\.\/ROADMAP\.md/);
    assert.match(readme, /API Connections/);
    assert.match(entrypoint, /new context\.Popup/);
    assert.match(entrypoint, /#cmr_open_manager/);
    assert.doesNotMatch(entrypoint, /#extensions_settings2|#extensions_settings/);
    assert.doesNotMatch(settingsHtml, /inline-drawer/);
    assert.equal(
        rootEntries.some(name => /^licen[cs]e(?:\.|$)/i.test(name)),
        false,
        '사용자 요청에 따라 라이선스 파일을 추가하면 안 된다',
    );

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
