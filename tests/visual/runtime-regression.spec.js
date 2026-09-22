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

test('붙여넣기 직후 오류·중복을 알리고 문제 행으로 이동하며 수정 전에는 저장하지 않는다', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'already-there'));
    await openPanel(page);
    const input = page.locator('#cmr_model_id');
    const summary = page.locator('#cmr_input_validation_summary');
    const issues = page.locator('#cmr_input_validation_issues');
    const before = await page.evaluate(() => JSON.stringify(cmrRuntime.context.extensionSettings));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('new-one\nbad id\nalready-there\nnew-one'));
    await input.focus();
    await page.keyboard.press('Control+V');
    await expect(summary).toHaveText('신규 1개 · 중복 2개 · 오류 1개');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(issues.locator('button')).toHaveCount(3);
    expect(await page.evaluate(() => JSON.stringify(cmrRuntime.context.extensionSettings))).toBe(before);
    await issues.locator('[data-cmr-input-line="2"]').focus();
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('bad id');
    await page.locator('#cmr_add_form button[type="submit"]').click();
    expect(await page.evaluate(() => CustomModelRouter.listModels().map(model => model.id))).toEqual(['already-there']);
    await expect(input).toBeFocused();
    await page.keyboard.insertText('fixed-two');
    await expect(summary).toHaveText('신규 2개 · 중복 2개 · 오류 0개');
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#cmr_feedback')).toBeEmpty();
    await page.keyboard.press('Control+Z');
    await expect(input).toHaveValue('new-one\nbad id\nalready-there\nnew-one');
    await expect(summary).toHaveText('신규 1개 · 중복 2개 · 오류 1개');
    await page.keyboard.press('Control+Y');
    await expect(summary).toHaveText('신규 2개 · 중복 2개 · 오류 0개');
    expect(await page.locator('#cmr_settings').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('input-validation.png') });
    await page.locator('#cmr_add_form button[type="submit"]').click();
    expect(await page.evaluate(() => CustomModelRouter.listModels().map(model => model.id))).toEqual(['already-there', 'new-one', 'fixed-two']);
    await expect(page.locator('#cmr_input_validation')).toBeHidden();
    await expect(page.locator('#model_openai_select')).toHaveValue('native-model');
});

test('사전 검사는 공급자·등록 변경을 따라가고 IME 조합·오래된 행 링크·닫힌 팝업을 안전하게 처리한다', async ({ page }) => {
    await openPanel(page);
    const input = page.locator('#cmr_model_id');
    const summary = page.locator('#cmr_input_validation_summary');
    await input.fill('vendor/model');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await page.locator('#cmr_provider').selectOption('openrouter');
    await expect(summary).toHaveText('신규 1개 · 중복 0개 · 오류 0개');
    await page.evaluate(() => CustomModelRouter.registerModel('openrouter', 'vendor/model'));
    await expect(summary).toHaveText('신규 0개 · 중복 1개 · 오류 0개');
    await expect(input).toHaveValue('vendor/model');
    await input.evaluate(el => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.value = 'bad id';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#cmr_input_validation')).toBeHidden();
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await input.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await expect(summary).toHaveText('신규 0개 · 중복 0개 · 오류 1개');
    await input.evaluate(el => { el.value = 'now-fixed'; });
    await page.locator('[data-cmr-input-line="1"]').click();
    await expect(summary).toHaveText('신규 1개 · 중복 0개 · 오류 0개');
    expect(await input.evaluate(el => el.selectionStart === el.selectionEnd)).toBe(true);
    await input.fill('another bad id');
    await page.locator('.popup-button-close').click();
    await openPanel(page);
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('');
    await expect(page.locator('#cmr_input_validation')).toBeHidden();
    expect(await page.evaluate(() => CustomModelRouter.listModels().map(model => model.id))).toEqual(['vendor/model']);
});

test('입력 행 수 상한을 미리 알리고 긴 입력의 오류 행도 좁은 화면에서 선택·스크롤한다', async ({ page }, testInfo) => {
    await openPanel(page);
    const input = page.locator('#cmr_model_id');
    const summary = page.locator('#cmr_input_validation_summary');
    await input.fill(Array.from({ length: 201 }, (_, i) => `model-${i}`).join('\n'));
    await expect(summary).toHaveText('한 번에 200개 모델까지 등록할 수 있습니다.');
    await expect(page.locator('#cmr_input_validation_issues')).toBeHidden();
    const text = Array.from({ length: 150 }, (_, i) => (
        i === 74 || i === 149 ? 'bad id' : `model-${i}-${'x'.repeat(45)}`
    )).join('\n');
    for (const width of [320, 360, 420, 720]) {
        await page.setViewportSize({ width, height: width === 320 ? 568 : 800 });
        await input.fill(text);
        await expect(summary).toHaveText('신규 148개 · 중복 0개 · 오류 2개');
        await input.evaluate(el => { el.scrollTop = 0; el.setSelectionRange(0, 0); });
        await page.locator('[data-cmr-input-line="150"]').click();
        await expect(input).toBeFocused();
        expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('bad id');
        await expect.poll(() => input.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        expect(await page.locator('#cmr_settings').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`input-line-jump-${width}.png`) });
        const lastLineScroll = await input.evaluate(el => el.scrollTop);
        await page.locator('[data-cmr-input-line="75"]').click();
        expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('bad id');
        expect(await input.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        expect(await input.evaluate(el => el.scrollTop)).toBeLessThan(lastLineScroll * 0.75);
        await expect(input).toHaveValue(text);
        await page.screenshot({ path: testInfo.outputPath(`input-middle-line-jump-${width}.png`) });
    }
    expect(await page.evaluate(() => CustomModelRouter.listModels())).toEqual([]);
});

test('외부 제공업체 선택은 기본·수동 모델과 입력 제안을 함께 필터링하고 미지원 업체에는 주입하지 않는다', async ({ page }) => {
    await page.evaluate(() => {
        for (const provider of ['openai', 'claude', 'vertexai']) {
            CustomModelRouter.registerModel(provider, `${provider}-manual`);
            if (provider === 'openai') continue;
            const core = document.querySelector(`#model_${provider}_select`);
            core.replaceChildren(new Option(`${provider} native`, `${provider}-native`));
        }
        const panel = document.createElement('section');
        panel.id = 'provider_filter_settings';
        const provider = document.createElement('select');
        provider.id = 'external_filter_provider';
        for (const [value, label] of [['', 'Choose provider'], ['openai', 'OpenAI'], ['anthropic', 'Claude'], ['vertexai', 'Google Vertex AI'], ['unknown', 'Unsupported']]) {
            provider.append(new Option(label, value));
        }
        provider.value = 'openai';
        const model = document.createElement('select');
        model.id = 'external_filter_chat_model';
        model.dataset.providerSelect = provider.id;
        const native = new Option('External native', 'external-native');
        model.append(native);
        const input = document.createElement('input');
        input.id = 'external_filter_input_model';
        input.dataset.providerSelect = provider.id;
        input.value = 'external-input-unchanged';
        panel.append(provider, model, input);
        document.body.append(panel);
        cmrRuntime.filterTest = { native, provider, model, input };
    });
    const provider = page.locator('#external_filter_provider');
    const model = page.locator('#external_filter_chat_model');
    const input = page.locator('#external_filter_input_model');
    const snapshot = () => page.evaluate(() => {
        const { provider, model, input, native } = cmrRuntime.filterTest;
        const read = host => [...(host?.querySelectorAll('[data-cmr-external-model="true"]') ?? [])]
            .map(option => [option.dataset.cmrProvider, option.value]).sort((a, b) => a[1].localeCompare(b[1]));
        return {
            models: read(model), suggestions: read(document.getElementById(input.getAttribute('list'))),
            provider: provider.value, providerValues: [...provider.options].map(option => option.value),
            nativePreserved: native.parentElement === model,
        };
    });
    for (const [value, id, nativeId] of [
        ['openai', 'openai', 'native-model'], ['anthropic', 'claude', 'claude-native'],
        ['vertexai', 'vertexai', 'vertexai-native'], ['openai', 'openai', 'native-model'],
    ]) {
        await provider.selectOption(value);
        const expected = [[id, `${id}-manual`], [id, nativeId]].sort((a, b) => a[1].localeCompare(b[1]));
        await expect.poll(async () => (await snapshot()).models).toEqual(expected);
        await expect.poll(async () => (await snapshot()).suggestions).toEqual(expected);
        expect((await snapshot()).nativePreserved).toBe(true);
        expect((await snapshot()).providerValues).toEqual(['', 'openai', 'anthropic', 'vertexai', 'unknown']);
        await expect(model).toHaveValue('external-native');
        await expect(input).toHaveValue('external-input-unchanged');
    }
    await model.selectOption('openai-manual');
    await provider.selectOption('unknown');
    await expect.poll(async () => (await snapshot()).models).toEqual([]);
    await expect.poll(async () => (await snapshot()).suggestions).toEqual([]);
    await expect(model).toHaveValue('external-native');
    await provider.selectOption('');
    await expect.poll(async () => (await snapshot()).models).toEqual([]);
    await provider.selectOption('anthropic');
    await expect.poll(async () => (await snapshot()).models).toEqual([
        ['claude', 'claude-manual'], ['claude', 'claude-native'],
    ]);
    // Replacing the actual provider control must not retain its previous binding/scope.
    await provider.evaluate(el => {
        const replacement = el.cloneNode(true);
        replacement.value = 'vertexai';
        el.replaceWith(replacement);
        cmrRuntime.filterTest.provider = replacement;
    });
    await expect.poll(async () => (await snapshot()).models).toEqual([
        ['vertexai', 'vertexai-manual'], ['vertexai', 'vertexai-native'],
    ]);
    await provider.selectOption('openai');
    await expect.poll(async () => (await snapshot()).models).toEqual([
        ['openai', 'native-model'], ['openai', 'openai-manual'],
    ]);
    await expect(page.locator('#model_openai_select')).toHaveValue('native-model');
    expect(await page.evaluate(() => cmrRuntime.context.chatCompletionSettings.chat_completion_source)).toBe('openai');
});

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

test('기본 모델의 단일·여러 줄 등록은 외부의 부족한 목록을 채우고 native 옵션·현재 선택을 보존한다', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => {
        const core = document.querySelector('#model_openai_select');
        const alternative = new Option('Native alternative', 'native-alternative');
        core.append(alternative, new Option('Native second alternative', 'native-second-alternative'));
        const subset = document.createElement('select');
        subset.id = 'subset_chat_model';
        subset.append(new Option('Current native model only', 'native-model'));
        const existing = document.createElement('select');
        existing.id = 'existing_chat_model';
        const externalAlternative = new Option('Already available', 'native-alternative');
        existing.append(new Option('Current native model', 'native-model'), externalAlternative);
        document.body.append(subset, existing);
        const events = { core: 0, subset: 0, existing: 0 };
        for (const [key, select] of Object.entries({ core, subset, existing })) {
            select.addEventListener('change', () => { events[key] += 1; });
        }
        cmrRuntime.nativeRegistration = { core, subset, existing, alternative, externalAlternative, events };
    });
    await expect(page.locator('#subset_chat_model option[value="native-alternative"]')).toHaveCount(1);
    await expect(page.locator('#existing_chat_model option[value="native-alternative"]')).toHaveCount(1);
    expect(await page.evaluate(() => CustomModelRouter.listModels())).toEqual([]);
    await openPanel(page);
    await page.locator('#cmr_model_help_trigger').click();
    const help = page.locator('#cmr_model_help');
    await expect(help).toBeVisible();
    await expect(help).toContainText('기본 모델은 외부에 자동 제공됩니다.');
    const helpBox = await help.boundingBox();
    expect(helpBox.y).toBeGreaterThanOrEqual(0);
    expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(569);
    await page.keyboard.press('Escape');
    const input = page.locator('#cmr_model_id');
    const submit = page.locator('#cmr_add_form button[type="submit"]');
    await input.fill('native-alternative');
    await submit.click();
    await expect(page.locator('#cmr_feedback')).toContainText('native-alternative 모델을 등록했습니다.');
    await expect(page.locator('#cmr_model_list .cmr-model-row')).toHaveCount(1);
    await expect(page.locator('#subset_chat_model option[value="native-alternative"]')).toHaveCount(1);
    await expect(page.locator('#subset_chat_model option[value="native-alternative"]')).toHaveAttribute('data-cmr-provider', 'openai');
    await input.fill('native-model\nnative-alternative\nnative-second-alternative\nnative-second-alternative');
    await submit.click();
    await expect(page.locator('#cmr_feedback')).toContainText('모델 2개를 등록했습니다. 중복 2개');
    await expect(page.locator('#cmr_model_list .cmr-model-row')).toHaveCount(3);
    for (const selector of ['#model_openai_select', '#subset_chat_model', '#existing_chat_model']) {
        for (const id of ['native-model', 'native-alternative', 'native-second-alternative']) {
            await expect(page.locator(`${selector} option[value="${id}"]`)).toHaveCount(1);
        }
        await expect(page.locator(selector)).toHaveValue('native-model');
    }
    await expect(page.locator('#model_openai_select optgroup[data-cmr-provider]')).toHaveCount(0);
    expect(await page.evaluate(() => {
        const { core, existing, alternative, externalAlternative, events } = cmrRuntime.nativeRegistration;
        return {
            corePreserved: alternative.parentElement === core,
            externalPreserved: externalAlternative.parentElement === existing,
            events,
        };
    })).toEqual({ corePreserved: true, externalPreserved: true, events: { core: 0, subset: 0, existing: 0 } });

    // Model availability and actual extension requests are separate contracts:
    // this fixture checks native selection/events, not a remote provider call.
    await page.locator('.popup-button-close').click();
    await page.locator('#subset_chat_model').selectOption('native-alternative');
    await expect(page.locator('#subset_chat_model')).toHaveValue('native-alternative');
    await expect(page.locator('#model_openai_select')).toHaveValue('native-model');
    expect(await page.evaluate(() => cmrRuntime.nativeRegistration.events.subset)).toBe(1);
    await page.evaluate(async () => { await cmrRuntime.destroy(); await cmrRuntime.init(); });
    expect(await page.evaluate(() => CustomModelRouter.listModels().map(model => model.id).sort())).toEqual([
        'native-alternative', 'native-model', 'native-second-alternative',
    ]);
    await expect(page.locator('#subset_chat_model option[value="native-alternative"]')).toHaveCount(1);
    await expect(page.locator('#model_openai_select option[value="native-alternative"]')).toHaveCount(1);
});

test('기본 카탈로그 변경은 저장 없이 반영되고 수동 비활성화·삭제·재초기화가 중복 없이 동작한다', async ({ page }) => {
    await page.evaluate(() => {
        const select = document.createElement('select');
        select.id = 'catalog_chat_model';
        select.append(new Option('Current', 'native-model'));
        document.body.append(select);
        const core = document.querySelector('#model_openai_select');
        const option = new Option('Loaded model', 'native-extra');
        core.append(option);
        const events = { core: 0, external: 0 };
        core.addEventListener('change', () => events.core++);
        select.addEventListener('change', () => events.external++);
        cmrRuntime.catalogTest = { option, events };
    });
    const extra = page.locator('#catalog_chat_model option[value="native-extra"]');
    await expect(extra).toHaveCount(1);
    await page.evaluate(() => { cmrRuntime.catalogTest.option.disabled = true; });
    await expect(extra).toHaveCount(0);
    await page.evaluate(() => { cmrRuntime.catalogTest.option.disabled = false; });
    await expect(extra).toHaveCount(1);
    await page.evaluate(() => { cmrRuntime.catalogTest.option.value = 'native-renamed'; });
    await expect(extra).toHaveCount(0);
    const renamed = page.locator('#catalog_chat_model option[value="native-renamed"]');
    await expect(renamed).toHaveCount(1);
    expect(await page.evaluate(async () => {
        const { stringifyPortableSettings } = await import('/cmr/src/portable-settings.js');
        return JSON.parse(stringifyPortableSettings({ registrySettings: cmrRuntime.context.extensionSettings.customModelRouter })).registry.models;
    })).toEqual([]);
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'native-renamed'));
    await expect(renamed).toHaveCount(1);
    await openPanel(page);
    await page.locator('[data-cmr-action="toggle-enabled"][data-model-id="native-renamed"]').click();
    await expect(renamed).toHaveCount(0);
    await expect(page.locator('#model_openai_select option[value="native-renamed"]')).toHaveCount(1);
    await page.locator('[data-cmr-action="delete"][data-model-id="native-renamed"]').click();
    await expect(renamed).toHaveCount(1);
    await page.locator('.popup-button-close').click();
    await page.evaluate(async () => { await cmrRuntime.destroy(); await cmrRuntime.init(); });
    await expect(renamed).toHaveCount(1);
    await expect(page.locator('#catalog_chat_model')).toHaveValue('native-model');
    await expect(page.locator('#model_openai_select')).toHaveValue('native-model');
    expect(await page.evaluate(() => CustomModelRouter.listModels())).toEqual([]);
    expect(await page.evaluate(() => cmrRuntime.catalogTest.events)).toEqual({ core: 0, external: 0 });
    await page.evaluate(() => cmrRuntime.catalogTest.option.remove());
    await expect(renamed).toHaveCount(0);
});

test('Custom의 실제 로드 목록도 native 연결과 공개 hook에 제공하며 요청 직전 가용성을 다시 검사한다', async ({ page }) => {
    await page.evaluate(async () => {
        const { PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES } = await import('/cmr/src/provider-integrations.js');
        const list = document.createElement('datalist');
        list.id = 'model_custom_select_fill';
        list.append(new Option('Custom model', 'vendor/native'));
        const core = document.createElement('select');
        core.id = 'model_custom_select';
        core.append(new Option('Custom model', 'vendor/native'));
        document.querySelector('#rm_api_block').append(list, core);
        const panel = document.createElement('section');
        panel.className = 'extension_container';
        panel.innerHTML = '<label for="catalog_custom_provider">Model provider</label><select id="catalog_custom_provider"><option value="custom">Custom OpenAI-compatible</option></select><label for="catalog_custom_model">Chat model</label><select id="catalog_custom_model" data-provider-select="catalog_custom_provider"><option value="native-model">Current</option></select>';
        document.body.append(panel);
        const state = { models: [], calls: [], execute: null };
        cmrRuntime.nativeHook = state;
        cmrRuntime.context.ConnectionManagerRequestService.validateProfile = () => ({ selected: 'openai', source: 'custom' });
        cmrRuntime.context.ConnectionManagerRequestService.sendRequest = async (...args) => { state.calls.push(args[4].model); return { content: 'ok' }; };
        const registration = CustomModelRouter.integrations.registerConsumer({
            consumerId: 'native.catalog', label: 'Native catalog', contractVersion: '1.1.0',
            capabilities: PROVIDER_INTEGRATION_REQUIRED_CAPABILITIES,
            slots: [{ slotId: 'chat', strategies: ['openai-compatible'] }],
        }, {
            installHandler(binding) { state.execute = binding.execute; return { requestHandlerBound: true, handlerToken: {}, dispose() {} }; },
            publishModels(binding) {
                state.models = binding.models.map(model => model.id);
                return { modelsPublished: true, publicationToken: {}, updateModels(models) { state.models = models.map(model => model.id); return true; }, dispose() {} };
            },
        });
        await registration.ready;
    });
    await expect(page.locator('#catalog_custom_model option[value="vendor/native"]')).toHaveCount(1);
    await expect(page.locator('#catalog_custom_provider option')).toHaveCount(1);
    await expect(page.locator('#catalog_custom_provider')).toHaveValue('custom');
    expect(await page.evaluate(() => cmrRuntime.nativeHook.models)).toEqual(['vendor/native']);
    expect(await page.evaluate(() => CustomModelRouter.listModels())).toEqual([]);
    const result = await page.evaluate(async () => {
        const state = cmrRuntime.nativeHook;
        await state.execute({ modelId: 'vendor/native', prompt: 'test', maxTokens: 8 });
        document.querySelector('#model_custom_select_fill').replaceChildren();
        document.querySelector('#model_custom_select').replaceChildren();
        let code;
        try { await state.execute({ modelId: 'vendor/native', prompt: 'test', maxTokens: 8 }); } catch (error) { code = error.code; }
        return { calls: state.calls, code };
    });
    expect(result).toEqual({ calls: ['vendor/native'], code: 'model_not_ready' });
    await expect(page.locator('#catalog_custom_model option[value="vendor/native"]')).toHaveCount(0);
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
    await page.getByText('설정 복구', { exact: true }).click();
    const undoWidth = await page.locator('#cmr_undo_settings').evaluate(button => ({
        button: button.getBoundingClientRect().width, parent: button.parentElement.clientWidth,
    }));
    expect(undoWidth.button).toBeCloseTo(undoWidth.parent, 0);
    await page.locator('#cmr_undo_settings').click();
    await expect(page.locator('#cmr_import_preview_title')).toHaveText('설정 되돌리기 미리보기');
    await expect(page.locator('#cmr_import_preview_summary')).toContainText('삭제 1건');
    await page.locator('#cmr_import_preview_cancel').click();
    await expect(page.locator('#cmr_feedback')).toHaveText('설정 되돌리기를 취소했습니다.');
    await expect(page.locator('#cmr_undo_settings')).toBeFocused();
    await page.locator('#cmr_undo_settings').click();
    // The preview remains accessible even when its source menu is collapsed.
    await openTools(page);
    await expect(page.locator('#cmr_import_preview')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('production-undo-preview.png') });
    await page.locator('#cmr_import_preview_apply').click();
    expect(await page.evaluate(() => CustomModelRouter.getModel('openai', 'existing').enabled)).toBe(true);
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'incoming'))).toBe(false);
    await expect(page.locator('#cmr_undo_settings')).toBeHidden();
    await expect(page.locator('#cmr_import_backup_button')).toBeFocused();
});

test('기본 모델 중복 정리는 native 선택을 유지하고 적용 직전 변경을 재확인한다', async ({ page }) => {
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'native-model'));
    await openPanel(page);
    const cleanup = page.getByRole('button', { name: '기본 모델 중복 정리', exact: true });
    await expect(cleanup).toBeVisible();
    await expect(page.locator('#cmr_operations_section')).not.toHaveAttribute('open');
    await cleanup.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cmr_import_preview')).toBeVisible();
    await expect(page.locator('#cmr_import_preview_cancel')).toBeFocused();
    await expect(page.locator('#cmr_cleanup_warning')).toBeVisible();
    await expect(page.locator('#cmr_cleanup_warning')).toContainText('정리한 기본 모델은 현재 목록에서 자동 제공됩니다.');
    expect(await page.locator('#cmr_import_preview_apply').evaluate(button => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return range.getClientRects().length;
    })).toBe(1);
    expect(await page.locator('#cmr_import_preview').evaluate(node => node.closest('details'))).toBeNull();
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'native-model'))).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#cmr_import_preview')).toBeHidden();
    await expect(page.locator('#cmr_feedback')).toHaveText('기본 모델 중복 정리를 취소했습니다.');
    await expect(cleanup).toBeFocused();
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'native-model'))).toBe(true);
    await cleanup.click();
    await expect(page.locator('#cmr_import_preview_summary')).toContainText('삭제');
    await page.evaluate(() => CustomModelRouter.registerModel('openai', 'added-later'));
    await page.locator('#cmr_import_preview_apply').click();
    await expect(page.locator('#cmr_feedback')).toContainText('다시 확인');
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'native-model'))).toBe(true);
    await page.locator('#cmr_import_preview_apply').click();
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'native-model'))).toBe(false);
    expect(await page.evaluate(() => CustomModelRouter.hasModel('openai', 'added-later'))).toBe(true);
    await expect(page.locator('#model_openai_select')).toHaveValue('native-model');
    await expect(cleanup).toBeFocused();
    await expect(page.locator('#cmr_operations_section')).not.toHaveAttribute('open');
    await cleanup.click();
    await expect(page.locator('#cmr_feedback')).toHaveText('기본 목록과 중복된 등록 모델이 없습니다.');
    await expect(page.locator('#cmr_import_preview')).toBeHidden();
});

test('목록의 중복 정리 아이콘은 좁은 화면과 밝은 테마에서도 접힌 메뉴 밖에 정사각형으로 표시된다', async ({ page }, testInfo) => {
    await page.evaluate(() => {
        for (const id of ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']) {
            CustomModelRouter.registerModel('vertexai', id);
        }
    });
    await page.addStyleTag({ content: `
        :root { --SmartThemeBodyColor: #171717; --SmartThemeBlurTintColor: #fff; --SmartThemeBorderColor: #333; }
        .menu_button { width: min-content; background: #fff; color: #171717; border: 1px solid #333; box-shadow: 2px 2px #333; }
    ` });
    await openPanel(page);
    const cleanup = page.locator('#cmr_cleanup_native');
    await expect(cleanup).toHaveCount(1);
    await expect(cleanup).toHaveAttribute('title', '기본 모델 중복 정리');
    await expect(cleanup).toHaveAccessibleName('기본 모델 중복 정리');
    await expect(cleanup).toHaveText('');
    await expect(cleanup.locator('.fa-broom')).toBeVisible();
    for (const width of [320, 360, 420, 720]) {
        await page.setViewportSize({ width, height: 800 });
        await cleanup.scrollIntoViewIfNeeded();
        await expect(cleanup).toBeInViewport();
        const metrics = await cleanup.evaluate(button => {
            const box = button.getBoundingClientRect();
            const heading = document.querySelector('#cmr_list_title').getBoundingClientRect();
            const help = document.querySelector('#cmr_model_list_help_trigger').getBoundingClientRect();
            const panel = document.querySelector('#cmr_settings');
            return {
                width: box.width, height: box.height,
                inlineWithTitle: Math.abs((box.top + box.bottom) / 2 - (heading.top + heading.bottom) / 2) < 1,
                afterHelp: box.left >= help.right,
                inHeader: Boolean(button.closest('.cmr-list-header')),
                inDetails: Boolean(button.closest('details')),
                overflow: panel.scrollWidth > panel.clientWidth + 1,
            };
        });
        expect(metrics.width).toBeGreaterThanOrEqual(24);
        expect(metrics.width).toBeCloseTo(metrics.height, 1);
        expect(metrics).toMatchObject({ inlineWithTitle: true, afterHelp: true, inHeader: true, inDetails: false, overflow: false });
        await expect(page.locator('#cmr_operations_section')).not.toHaveAttribute('open');
        await page.screenshot({ path: testInfo.outputPath(`cleanup-button-${width}.png`) });
    }
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
