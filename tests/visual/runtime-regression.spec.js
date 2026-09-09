import { test, expect } from '@playwright/test';
import { startUiRegressionServer } from './server.js';

let server;
test.beforeAll(async () => { server = await startUiRegressionServer(); });
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(new URL('/runtime-sandbox', server.url).href);
    await page.waitForFunction(() => Boolean(globalThis.cmrRuntime));
});

async function openPanel(page) {
    await page.locator('#cmr_open_manager').click();
    await expect(page.locator('#cmr_settings')).toBeVisible();
}
async function openTools(page) {
    await page.locator('#cmr_settings > details.cmr-tool-section > summary').click();
}
async function upload(page, content) {
    await page.locator('#cmr_import_backup').setInputFiles({ name: 'cmr-test.json', mimeType: 'application/json', buffer: Buffer.from(content) });
}
async function backup(page, models) { return page.evaluate(models => cmrRuntime.backup(models), models); }
const record = (id, enabled = true, provider = 'openai') => ({ id, provider, enabled });

test('제품 UI의 여러 줄 등록·활성 토글·삭제 실행 취소가 좁은 화면에서 동작한다', async ({ page }, testInfo) => {
    await openPanel(page);
    await page.locator('#cmr_model_id').fill('runtime-one\nruntime-two');
    await page.locator('#cmr_add_form button[type="submit"]').click();
    await expect(page.locator('.cmr-model-row')).toHaveCount(2);
    await page.locator('[data-cmr-action="toggle-enabled"][data-model-id="runtime-one"]').click();
    await expect(page.locator('.cmr-model-row').filter({ hasText: 'runtime-one' })).toHaveAttribute('data-enabled', 'false');
    await expect(page.locator('#model_openai_select option[value="runtime-one"]')).toHaveCount(0);
    await page.locator('[data-cmr-action="toggle-enabled"][data-model-id="runtime-one"]').click();
    await expect(page.locator('#model_openai_select option[value="runtime-one"]')).toHaveCount(1);
    await page.locator('[data-cmr-action="delete"][data-model-id="runtime-two"]').click();
    await page.locator('#cmr_undo_delete').click();
    await expect(page.locator('.cmr-model-row')).toHaveCount(2);
    expect(await page.locator('#cmr_settings').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('production-manager.png') });
    await page.locator('.popup-button-close').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cmr_manager_dialog')).toHaveCount(0);
});

test('제품 가져오기 경로가 falsy 백업을 거부하고 현재 설정을 보존한다', async ({ page }) => {
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'keep-me'));
    await openPanel(page);
    await openTools(page);
    for (const input of ['null', 'false', '0', '""']) {
        await upload(page, input);
        await expect(page.locator('#cmr_feedback')).toContainText('backup_root_invalid');
        await expect(page.locator('#cmr_import_preview')).toBeHidden();
        expect(await page.evaluate(() => CustomModelRouter.listModels().map(model => model.id))).toEqual(['keep-me']);
    }
});

test('제품 모델 병합의 충돌 선택과 세션 내 설정 되돌리기를 미리보기로 적용한다', async ({ page }, testInfo) => {
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'existing'));
    await openPanel(page);
    await openTools(page);
    await upload(page, await backup(page, [record('existing', false), record('incoming')]));
    await page.locator('#cmr_import_mode').selectOption('merge');
    await page.locator('#cmr_import_choices > summary').click();
    const conflict = page.locator('#cmr_import_choices_list label').filter({ hasText: 'existing' }).locator('input');
    await expect(conflict).not.toBeChecked();
    await conflict.check();
    await expect(page.locator('#cmr_import_preview_summary')).toContainText('충돌 1건');
    await page.locator('#cmr_import_preview_apply').click();
    expect(await page.evaluate(() => CustomModelRouter.getModel('openai', 'existing').enabled)).toBe(false);
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'incoming'))).toBe(true);
    await page.locator('.popup-button-close').click();
    await openPanel(page);
    await openTools(page);
    await page.getByText('모델 정리 및 복구', { exact: true }).click();
    await page.locator('#cmr_undo_settings').click();
    await expect(page.locator('#cmr_import_preview_title')).toHaveText('설정 되돌리기 미리보기');
    await expect(page.locator('#cmr_import_preview_summary')).toContainText('삭제 1건');
    await page.screenshot({ path: testInfo.outputPath('production-undo-preview.png') });
    await page.locator('#cmr_import_preview_apply').click();
    expect(await page.evaluate(() => CustomModelRouter.getModel('openai', 'existing').enabled)).toBe(true);
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'incoming'))).toBe(false);
    await expect(page.locator('#cmr_undo_settings')).toBeHidden();
});

test('기본 모델 중복 정리는 native 선택을 유지하고 적용 직전 변경을 재확인한다', async ({ page }) => {
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'native-model'));
    await openPanel(page);
    await openTools(page);
    await page.getByText('모델 정리 및 복구', { exact: true }).click();
    await page.locator('#cmr_cleanup_native').click();
    await expect(page.locator('#cmr_import_preview_summary')).toContainText('삭제');
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'added-later'));
    await page.locator('#cmr_import_preview_apply').click();
    await expect(page.locator('#cmr_feedback')).toContainText('다시 확인');
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'native-model'))).toBe(true);
    await page.locator('#cmr_import_preview_apply').click();
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'native-model'))).toBe(false);
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'added-later'))).toBe(true);
    await expect(page.locator('#model_openai_select')).toHaveValue('native-model');
});

test('현재 사용 중인 custom-only 모델의 비활성화와 백업 삭제는 차단된다', async ({ page }) => {
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'in-use'));
    await page.locator('#model_openai_select').selectOption('in-use');
    await openPanel(page);
    await page.locator('[data-cmr-action="toggle-enabled"]').click();
    await expect(page.locator('#cmr_feedback')).toContainText('현재 사용 중');
    expect(await page.evaluate(() => CustomModelRouter.getModel('openai', 'in-use').enabled)).toBe(true);
    await openTools(page);
    await upload(page, await backup(page, []));
    await expect(page.locator('#cmr_import_preview_apply')).toBeDisabled();
    await expect(page.locator('#cmr_import_preview_summary')).toContainText('model_in_use');
});

test('실패한 공용 연동만 제품 UI에서 재시도하고 경고를 정리한다', async ({ page }) => {
    await page.evaluate(async () => {
        CustomModelRouter.registerModel('openai', 'hook-model');
        await cmrRuntime.registerTestConsumer();
    });
    await openPanel(page);
    await expect(page.locator('#cmr_external_warning')).toBeVisible();
    await page.locator('#cmr_external_warning_open').click();
    await expect(page.locator('#cmr_provider_connections')).toBeVisible();
    await expect(page.locator('#cmr_provider_connections_list')).toContainText('실패');
    await page.locator('[data-consumer-id="browser.test"]').click();
    await expect(page.locator('#cmr_provider_connections_list')).toContainText('준비됨');
    await expect(page.locator('#cmr_external_warning')).toBeHidden();
});

test('실제 select의 중복 value도 저장한 provider 옵션과 change 이벤트를 정확히 복원한다', async ({ page }) => {
    const result = await page.evaluate(async () => {
        await cmrRuntime.destroy();
        const { createExternalIntegrationController } = await import('/cmr/src/external-integrations.js');
        const select = document.createElement('select');
        select.id = 'review_chat_model';
        select.append(new Option('Choose', ''));
        document.body.append(select);
        let changed;
        select.addEventListener('change', () => { changed = select.selectedOptions[0]?.dataset.cmrProvider; });
        const controller = createExternalIntegrationController({ root: document, documentRef: document,
            getModels: provider => ['openai', 'claude'].includes(provider) ? [recordFor(provider)] : [],
            getPreferredModels: () => ({ claude: 'shared' }),
        });
        function recordFor(provider) { return { id: 'shared', provider, enabled: true }; }
        controller.start();
        const result = { changed, selected: select.selectedOptions[0]?.dataset.cmrProvider, value: select.value };
        controller.destroy();
        return result;
    });
    expect(result).toEqual({ changed: 'claude', selected: 'claude', value: 'shared' });
});

test('공유 datalist는 입력별로 격리되고 제외 순서·원본 갱신·종료를 보존한다', async ({ page }) => {
    const results = await page.evaluate(async () => {
        await cmrRuntime.destroy();
        const { createExternalIntegrationController, createExternalTargetId } = await import('/cmr/src/external-integrations.js');
        const host = document.createElement('div');
        host.innerHTML = '<input id="first_chat_model" list="shared-list"><input id="second_chat_model" list="shared-list"><datalist id="shared-list"><option value="native"></datalist>';
        document.body.append(host);
        const [first, second] = host.querySelectorAll('input');
        const list = host.querySelector('datalist');
        const ids = [first, second].map(control => createExternalTargetId(control, { documentRef: document }));
        const values = control => [...control.list.options].map(option => option.value);
        const controller = createExternalIntegrationController({ root: document, documentRef: document,
            excludedTargetIds: [ids[0]], getModels: provider => provider === 'openai' ? [{ provider, id: 'projected' }] : [],
        });
        controller.start();
        const firstExcluded = [values(first), values(second)];
        controller.setExcludedTargetIds([ids[1]]);
        const secondExcluded = [values(first), values(second)];
        list.append(new Option('Fresh', 'fresh-native'));
        await new Promise(resolve => setTimeout(resolve, 60));
        const updated = values(first);
        controller.setExcludedTargetIds([]);
        list.append(new Option('All fresh', 'both-fresh'));
        await new Promise(resolve => setTimeout(resolve, 60));
        const bothUpdated = [values(first), values(second)];
        controller.destroy();
        return { firstExcluded, secondExcluded, updated, bothUpdated, restored: [first.getAttribute('list'), second.getAttribute('list')], lists: host.querySelectorAll('datalist').length };
    });
    expect(results.firstExcluded).toEqual([['native'], ['native', 'projected']]);
    expect(results.secondExcluded).toEqual([['native', 'projected'], ['native']]);
    expect(results.updated).toEqual(['native', 'fresh-native', 'projected']);
    expect(results.bothUpdated).toEqual([
        ['native', 'fresh-native', 'both-fresh', 'projected'],
        ['native', 'fresh-native', 'both-fresh', 'projected'],
    ]);
    expect(results.restored).toEqual(['shared-list', 'shared-list']);
    expect(results.lists).toBe(1);
});
