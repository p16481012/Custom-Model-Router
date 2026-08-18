import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readText(path) {
    return readFile(new URL(path, ROOT_URL), 'utf8');
}

test('배포 파일의 버전 표기가 모두 일치한다', async () => {
    const [manifestText, packageText, settingsHtml, readme, entrypoint] = await Promise.all([
        readText('manifest.json'),
        readText('package.json'),
        readText('settings.html'),
        readText('README.md'),
        readText('index.js'),
    ]);
    const manifest = JSON.parse(manifestText);
    const packageJson = JSON.parse(packageText);
    const version = manifest.version;

    assert.match(version, /^0\.\d+\.\d+$/);
    assert.equal(packageJson.version, version);
    assert.match(settingsHtml, new RegExp(`cmr-version[^>]*>v${version}<`));
    assert.match(readme, new RegExp(`현재 버전은 \\*\\*v${version.replaceAll('.', '\\.')}`));
    assert.match(entrypoint, new RegExp(`v${version.replaceAll('.', '\\.')} 초기화 완료`));
});
