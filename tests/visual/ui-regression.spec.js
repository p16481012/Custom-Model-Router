import { expect, test } from '@playwright/test';
import { startUiRegressionServer } from './server.js';

const VIEWPORTS = Object.freeze([
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 420, height: 800 },
    { width: 720, height: 900 },
]);

let fixtureServer;

test.beforeAll(async () => {
    fixtureServer = await startUiRegressionServer();
});

test.afterAll(async () => {
    await fixtureServer?.close();
});

async function openScenario(page, state) {
    await page.goto(fixtureServer.url, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-settings-source="settings.html"] #cmr_settings')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
        core: Boolean(document.querySelector('[data-st-core-css]')?.sheet),
        popup: Boolean(document.querySelector('[data-st-popup-css]')?.sheet),
        extension: Boolean(document.querySelector('[data-cmr-css]')?.sheet),
    }))).toEqual({ core: true, popup: true, extension: true });
    const stylesheetOrder = await page.locator('link[rel="stylesheet"]').evaluateAll(links => (
        links.map(link => link.getAttribute('href'))
    ));
    expect(stylesheetOrder.indexOf('/st/style.css')).toBeLessThan(stylesheetOrder.indexOf('/cmr/style.css'));
    expect(stylesheetOrder.indexOf('/st/css/popup.css')).toBeLessThan(stylesheetOrder.indexOf('/cmr/style.css'));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(nextState => globalThis.setUiRegressionState(nextState), state);
}

async function expectNoHorizontalOverflow(page) {
    const report = await page.evaluate(() => {
        const panel = document.getElementById('cmr_settings');
        const panelRect = panel.getBoundingClientRect();
        const selectors = [
            '#cmr_settings',
            '.cmr-panel-header',
            '.cmr-description',
            '.cmr-provider-field',
            '.cmr-add-form',
            '.cmr-input-row',
            '#cmr_bulk_add',
            '.cmr-bulk-add-form',
            '.cmr-feedback-row',
            '.cmr-list-region',
            '#cmr_model_search_region',
            '#cmr_model_list',
            '.cmr-model-row',
            '#cmr_external_warning',
            '.cmr-tool-section',
            '.cmr-tool-body',
            '.cmr-operation-actions',
            '#cmr_external_advanced',
            '#cmr_external_list',
            '#cmr_external_picker',
            '#cmr_external_picker_list',
            '#cmr_import_preview',
            '#cmr_import_preview_list',
            '.cmr-scope-note',
        ];
        const offenders = [];
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                const rect = element.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                const style = getComputedStyle(element);
                const escapesPanel = selector !== '#cmr_settings'
                    && (rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1);
                const exposesHorizontalScroll = element.scrollWidth > element.clientWidth + 1
                    && !['hidden', 'clip'].includes(style.overflowX)
                    && rect.left + element.scrollWidth > panelRect.right + 1;
                if (escapesPanel || exposesHorizontalScroll) {
                    offenders.push({
                        selector,
                        className: element.className,
                        clientWidth: element.clientWidth,
                        scrollWidth: element.scrollWidth,
                        left: rect.left,
                        right: rect.right,
                        panelLeft: panelRect.left,
                        panelRight: panelRect.right,
                        overflowX: style.overflowX,
                    });
                }
            }
        }
        return {
            documentClientWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            offenders,
        };
    });

    expect(report.documentScrollWidth).toBeLessThanOrEqual(report.documentClientWidth + 1);
    expect(report.offenders).toEqual([]);
}

async function expectButtonsAligned(page, expectedColumns) {
    const metrics = await page.evaluate(() => {
        function info(button) {
            const style = getComputedStyle(button);
            const rect = button.getBoundingClientRect();
            return {
                alignItems: style.alignItems,
                clientHeight: button.clientHeight,
                clientWidth: button.clientWidth,
                display: style.display,
                height: rect.height,
                justifyContent: style.justifyContent,
                scrollHeight: button.scrollHeight,
                scrollWidth: button.scrollWidth,
                textAlign: style.textAlign,
                width: rect.width,
                writingMode: style.writingMode,
                x: rect.x,
                y: rect.y,
            };
        }
        const add = info(document.querySelector('.cmr-add-button'));
        const operation = [...document.querySelectorAll('.cmr-operation-actions > .menu_button')].map(info);
        return { add, operation };
    });

    for (const button of [metrics.add, ...metrics.operation]) {
        expect(['flex', 'inline-flex']).toContain(button.display);
        expect(button.alignItems).toBe('center');
        expect(button.justifyContent).toBe('center');
        expect(button.textAlign).toBe('center');
        expect(button.writingMode).toBe('horizontal-tb');
        expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
        expect(button.scrollHeight).toBeLessThanOrEqual(button.clientHeight + 1);
    }
    expect(Math.abs(metrics.add.width - metrics.add.height)).toBeLessThanOrEqual(1);
    for (const button of metrics.operation) {
        expect(button.width).toBeGreaterThan(button.height);
    }

    const firstRowY = metrics.operation[0].y;
    const firstRow = metrics.operation.filter(button => Math.abs(button.y - firstRowY) < 1);
    expect(firstRow).toHaveLength(expectedColumns);
    expect(new Set(firstRow.map(button => Math.round(button.x))).size).toBe(expectedColumns);
}

async function expectHiddenScrollbarCanScroll(page, selector, { keyboard = true, hoverAtStart = false } = {}) {
    const target = page.locator(selector);
    await target.scrollIntoViewIfNeeded();
    const style = await target.evaluate(element => ({
        overflowY: getComputedStyle(element).overflowY,
        scrollbarWidth: getComputedStyle(element).scrollbarWidth,
        webkitDisplay: getComputedStyle(element, '::-webkit-scrollbar').display,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
    }));
    expect(style.overflowY).toBe('auto');
    expect(style.scrollbarWidth).toBe('none');
    expect(style.webkitDisplay).toBe('none');
    expect(style.scrollHeight).toBeGreaterThan(style.clientHeight);

    await target.evaluate(element => { element.scrollTop = 0; });
    await target.hover(hoverAtStart ? { position: { x: 4, y: 4 } } : undefined);
    await page.mouse.wheel(0, 420);
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

    if (keyboard) {
        await target.evaluate(element => { element.scrollTop = 0; });
        await target.focus();
        await page.keyboard.press('End');
        await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    }
}

async function attachViewportScreenshot(page, testInfo, name) {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ animations: 'disabled', fullPage: false, path });
    await testInfo.attach(name, {
        path,
        contentType: 'image/png',
    });
}

for (const viewport of VIEWPORTS) {
    test.describe(`${viewport.width}x${viewport.height}`, () => {
        test.use({ viewport });

        test('실제 Popup CSS에서 패널 배치와 문제·직접 제외 목록을 분리한다', async ({ page }, testInfo) => {
            await openScenario(page, {
                modelCount: 13,
                externalCount: 24,
                externalExcludedCount: 4,
                externalProblemCount: 4,
                externalRiskBlockedCount: 2,
                diagnosticCount: 20,
                openDetails: true,
                openAdvanced: true,
                openPicker: true,
            });

            const dialog = page.locator('#cmr_manager_dialog');
            await expect(dialog).toBeVisible();
            await expect(page.locator('.popup-button-close:visible')).toHaveCount(1);
            await expect(page.locator('#cmr_settings .popup-button-close')).toHaveCount(0);

            await expectNoHorizontalOverflow(page);
            await expectButtonsAligned(page, viewport.width === 720 ? 4 : 2);

            const wrapping = await page.evaluate(() => ({
                sentenceDisplay: getComputedStyle(document.querySelector('.cmr-sentence')).display,
                wordBreak: getComputedStyle(document.getElementById('cmr_settings')).wordBreak,
                overflowWrap: getComputedStyle(document.getElementById('cmr_settings')).overflowWrap,
            }));
            expect(wrapping).toEqual({
                sentenceDisplay: 'block',
                wordBreak: 'keep-all',
                overflowWrap: 'normal',
            });

            const addButton = page.locator('.cmr-add-button');
            await expect(addButton).toHaveText('');
            await expect(addButton).toHaveAttribute('title', '모델 등록');
            await expect(addButton).toHaveAttribute('aria-label', '입력한 모델 ID 등록');
            await expect(addButton.locator('.fa-plus')).toHaveCount(1);
            const addButtonSize = await addButton.evaluate(element => {
                const rect = element.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            });
            expect(Math.abs(addButtonSize.width - addButtonSize.height)).toBeLessThanOrEqual(1);
            await expect(page.locator('#cmr_model_search_region')).toBeVisible();
            const deleteButtonSize = await page.locator('.cmr-delete-button').first().evaluate(element => {
                const rect = element.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            });
            expect(deleteButtonSize.width).toBeLessThanOrEqual(30);
            expect(Math.abs(deleteButtonSize.width - deleteButtonSize.height)).toBeLessThanOrEqual(1);

            await expect(page.locator('#cmr_external_section')).toHaveCount(0);
            await expect(page.locator('#cmr_external_warning')).toBeVisible();
            const external = page.locator('#cmr_operations_section #cmr_external_advanced');
            const actionList = external.locator('#cmr_external_list');
            const picker = external.locator('#cmr_external_picker');
            const pickerList = external.locator('#cmr_external_picker_list');
            await expect(external).toHaveCount(1);
            await expect(picker).toHaveAttribute('open', '');
            await expect(actionList.locator('.cmr-external-row')).toHaveCount(8);
            await expect(actionList.locator('.cmr-external-state[data-state="failed"]')).toHaveCount(4);
            await expect(actionList.locator('.cmr-external-state[data-state="excluded"]')).toHaveCount(4);
            await expect(actionList.locator('.cmr-external-state[data-state="connected"]')).toHaveCount(0);
            await expect(pickerList.locator('.cmr-external-row')).toHaveCount(14);
            await expect(pickerList.locator('.cmr-external-state[data-state="connected"]')).toHaveCount(14);
            await expect(pickerList).toContainText('선택지 연결됨');
            await expect(pickerList).toContainText('실제 요청 확인 필요');
            await expect(actionList).toContainText('사용자 제외');
            await expect(external).not.toContainText('안전상 제외 23');
            await expect(external).not.toContainText('안전상 제외 24');
            await expect(actionList.locator('[data-cmr-external-action="exclude"]')).toHaveCount(4);
            await expect(actionList.locator('[data-cmr-external-action="restore"]')).toHaveCount(4);
            await expect(pickerList.locator('[data-cmr-external-action="exclude"]')).toHaveCount(14);
            expect(await external.locator('[data-cmr-external-action]').allTextContents()).toEqual(
                Array.from({ length: 22 }, () => ''),
            );
            await expect(external.locator('select, [data-cmr-external-mode]')).toHaveCount(0);
            await expect(external).not.toContainText('자동 연결');
            await expect(external).not.toContainText('연결 안 함');
            await expect(external).not.toContainText('모델 새로고침');

            const longExternalName = pickerList.locator('.cmr-external-name').first();
            const externalEllipsis = await longExternalName.evaluate(element => ({
                clientWidth: element.clientWidth,
                overflow: getComputedStyle(element).overflow,
                scrollWidth: element.scrollWidth,
                textOverflow: getComputedStyle(element).textOverflow,
                whiteSpace: getComputedStyle(element).whiteSpace,
            }));
            expect(externalEllipsis.overflow).toBe('hidden');
            expect(externalEllipsis.textOverflow).toBe('ellipsis');
            expect(externalEllipsis.whiteSpace).toBe('nowrap');
            expect(externalEllipsis.scrollWidth).toBeGreaterThan(externalEllipsis.clientWidth);

            const detailsSpacing = await page.evaluate(() => {
                const advanced = document.getElementById('cmr_external_advanced');
                const advancedBody = advanced.querySelector('.cmr-advanced-body');
                const summaryTitle = document.querySelector('#cmr_external_advanced summary > span:first-child');
                const summaryCount = document.getElementById('cmr_external_count');
                const advancedRect = advanced.getBoundingClientRect();
                const advancedBodyRect = advancedBody.getBoundingClientRect();
                const titleRect = summaryTitle.getBoundingClientRect();
                const countRect = summaryCount.getBoundingClientRect();
                const overlaps = titleRect.left < countRect.right
                    && titleRect.right > countRect.left
                    && titleRect.top < countRect.bottom
                    && titleRect.bottom > countRect.top;
                return {
                    advancedBodyWidthRatio: advancedBodyRect.width / advancedRect.width,
                    overlaps,
                    scopePaddingBottom: Number.parseFloat(getComputedStyle(
                        document.querySelector('.cmr-scope-note .cmr-tool-body'),
                    ).paddingBottom),
                };
            });
            expect(detailsSpacing.advancedBodyWidthRatio).toBeGreaterThanOrEqual(0.95);
            expect(detailsSpacing.overlaps).toBe(false);
            expect(detailsSpacing.scopePaddingBottom).toBeGreaterThan(0);

            await attachViewportScreenshot(page, testInfo, `ui-${viewport.width}x${viewport.height}`);

            await expectHiddenScrollbarCanScroll(page, '#cmr_model_list');
            await expectHiddenScrollbarCanScroll(page, '#cmr_external_list');
            await expectHiddenScrollbarCanScroll(page, '#cmr_external_picker_list');
            await expectHiddenScrollbarCanScroll(page, '#cmr_diagnostic_list');
            await expectHiddenScrollbarCanScroll(page, '.popup-content', {
                keyboard: false,
                hoverAtStart: true,
            });
            await page.locator('#cmr_model_list, #cmr_external_list, #cmr_external_picker_list, #cmr_diagnostic_list').evaluateAll(elements => {
                for (const element of elements) element.scrollTop = 0;
            });
            await page.locator('.popup-content').evaluate(element => {
                element.scrollTop = element.scrollHeight;
            });
            await attachViewportScreenshot(page, testInfo, `ui-${viewport.width}x${viewport.height}-bottom`);

            await page.locator('.popup-button-close').click();
            await expect(dialog).toBeHidden();
        });
    });
}

test.describe('외부 연결 문제 경고', () => {
    test.use({ viewport: { width: 420, height: 800 } });

    test('평상시 관리 UI를 숨기고 문제 경고에서 고급 관리로 이동한다', async ({ page }, testInfo) => {
        await openScenario(page, {
            modelCount: 3,
            externalCount: 4,
            externalProblemCount: 1,
        });

        const warning = page.locator('#cmr_external_warning');
        const operations = page.locator('#cmr_operations_section');
        const advanced = page.locator('#cmr_external_advanced');
        await expect(page.locator('#cmr_external_section')).toHaveCount(0);
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('1개 모델 칸에 선택지를 표시하지 못했습니다.');
        await expect(operations).not.toHaveAttribute('open', '');
        await expect(advanced).not.toHaveAttribute('open', '');
        await attachViewportScreenshot(page, testInfo, 'external-warning');

        await page.locator('#cmr_external_warning_open').click();
        await expect(operations).toHaveAttribute('open', '');
        await expect(advanced).toHaveAttribute('open', '');
        await expect(advanced.locator('#cmr_external_picker')).not.toHaveAttribute('open', '');
        await expect(advanced.locator('.cmr-external-state[data-state="failed"]')).toHaveCount(1);
        await expect(advanced).toContainText('선택지 연결 실패');
        const failedRow = advanced.locator('.cmr-external-row').filter({
            has: page.locator('.cmr-external-state[data-state="failed"]'),
        });
        const targetId = await failedRow.getAttribute('data-target-id');
        const excludeButton = failedRow.locator('[data-cmr-external-action="exclude"]');
        await expect(excludeButton).toHaveAttribute(
            'aria-label',
            /외부 확장 4 · Chat Completion 모델 칸 4 연결에서 제외/,
        );
        await expect(excludeButton).toBeFocused();
        await excludeButton.click();
        await expect(warning).toBeHidden();
        const targetRow = advanced.locator(`[data-target-id="${targetId}"]`);
        await expect(targetRow.locator('.cmr-external-state')).toHaveText('사용자 제외');
        const restoreButton = targetRow.locator('[data-cmr-external-action="restore"]');
        await expect(restoreButton).toBeFocused();

        await restoreButton.click();
        await expect(warning).toBeVisible();
        await expect(targetRow.locator('.cmr-external-state')).toHaveText('선택지 연결 실패');
        await expect(targetRow.locator('[data-cmr-external-action="exclude"]')).toBeFocused();
        await expectNoHorizontalOverflow(page);
        await attachViewportScreenshot(page, testInfo, 'external-warning-advanced');
    });

    test('런타임 문제와 512·2048 선택지 경고를 같은 문제 카드에 표시한다', async ({ page }, testInfo) => {
        await openScenario(page, {
            externalCount: 3,
            externalRuntimeProblem: true,
        });

        const warning = page.locator('#cmr_external_warning');
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('외부 연결 감시 자원 상태가 예상과 다릅니다.');
        await page.locator('#cmr_external_warning_open').click();
        const status = page.locator('#cmr_external_status');
        await expect(status).toHaveText('외부 연결 감시 자원을 확인해야 합니다.');
        await expect(status).not.toContainText('1개 대상');

        await page.evaluate(() => globalThis.setUiRegressionState({
            externalCount: 5,
            externalCapacityLimitedTargetCount: 1,
            diagnosticCount: 2,
            diagnosticOptionWarning: true,
        }));
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('외부 모델 칸 1곳은 표시 가능한 CMR 선택지가 512개를 넘어 일부만 표시합니다.');
        await page.locator('#cmr_external_warning_open').click();
        const picker = page.locator('#cmr_external_picker');
        await expect(picker).not.toHaveAttribute('open', '');
        await picker.locator(':scope > summary').click();
        await expect(picker).toHaveAttribute('open', '');
        await expect(page.locator('#cmr_external_picker_list .cmr-external-row')).toHaveCount(5);
        await expect(page.locator('#cmr_diagnostic_list [data-status="warning"]')).toHaveCount(2);

        await page.evaluate(() => globalThis.setUiRegressionState({
            externalCount: 5,
            externalExpectedManagedOptionCount: 2050,
            externalActualManagedOptionCount: 2049,
        }));
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('외부 모델 선택지 2050개가 권장 한도 2048개를 초과했습니다.');
        await expect(warning).not.toContainText('표시 가능한 CMR 선택지가 512개');
        await attachViewportScreenshot(page, testInfo, 'external-option-budget-warning');
    });
});

test.describe('모델 목록 스크롤 경계', () => {
    test.use({ viewport: { width: 420, height: 800 } });

    test('6개 스크롤·12개 검색 경계와 13개 초과 검색을 구분한다', async ({ page }, testInfo) => {
        await openScenario(page, { modelCount: 0, externalCount: 0, diagnosticCount: 0 });
        const list = page.locator('#cmr_model_list');
        const searchRegion = page.locator('#cmr_model_search_region');

        for (const modelCount of [0, 6]) {
            await page.evaluate(count => globalThis.setUiRegressionState({ modelCount: count }), modelCount);
            await expect(list).toHaveAttribute('data-scrollable', 'false');
            await expect(list).not.toHaveAttribute('tabindex', '0');
            await expect(list).toHaveCSS('overflow', 'visible');
            await expect(searchRegion).toBeHidden();
            await attachViewportScreenshot(page, testInfo, `model-boundary-${modelCount}`);
        }

        for (const modelCount of [7, 12, 13, 100]) {
            await page.evaluate(count => globalThis.setUiRegressionState({ modelCount: count }), modelCount);
            await expect(list).toHaveAttribute('data-scrollable', 'true');
            await expect(list).toHaveAttribute('tabindex', '0');
            if (modelCount > 12) {
                await expect(searchRegion).toBeVisible();
            } else {
                await expect(searchRegion).toBeHidden();
            }
            await expectHiddenScrollbarCanScroll(page, '#cmr_model_list');
            await list.evaluate(element => { element.scrollTop = 0; });
            await page.locator('.popup-content').evaluate(element => { element.scrollTop = 0; });
            await attachViewportScreenshot(page, testInfo, `model-boundary-${modelCount}`);
        }

        await page.evaluate(() => globalThis.setUiRegressionState({ modelCount: 13 }));
        const search = page.locator('#cmr_model_search');
        await search.fill('OpenRouter');
        await expect(page.locator('#cmr_model_count')).toHaveText('검색 4/13개');
        await expect(page.locator('#cmr_model_list .cmr-model-row')).toHaveCount(4);
        await expect(list).toHaveAttribute('data-scrollable', 'false');
        await expect(list).toHaveCSS('overflow', 'visible');
    });
});

test.describe('모델 등록·복구 흐름', () => {
    test.use({ viewport: { width: 420, height: 800 } });

    test('여러 모델을 textarea로 등록하고 삭제를 즉시 실행 취소한다', async ({ page }, testInfo) => {
        await openScenario(page, { modelCount: 11, openBulk: true });
        const bulk = page.locator('#cmr_bulk_add');
        const textarea = page.locator('#cmr_bulk_model_ids');
        const undo = page.locator('#cmr_undo_delete');
        await expect(bulk).toHaveAttribute('open', '');
        await expect(page.locator('#cmr_model_search_region')).toBeHidden();

        await textarea.fill('gemini-bulk-alpha\ngemini-bulk-beta\ngemini-bulk-alpha');
        await page.locator('#cmr_bulk_add_form button[type="submit"]').click();
        await expect(page.locator('#cmr_feedback')).toHaveText('모델 2개를 등록했습니다.');
        await expect(page.locator('#cmr_model_count')).toHaveText('제공업체 3곳 · 모델 13개');
        await expect(page.locator('#cmr_model_search_region')).toBeVisible();
        await expect(textarea).toHaveValue('');

        const addedRow = page.locator('#cmr_model_list .cmr-model-row').filter({ hasText: 'gemini-bulk-alpha' });
        await addedRow.locator('.cmr-delete-button').click();
        await expect(undo).toBeVisible();
        await expect(undo).toBeFocused();
        await expect(page.locator('#cmr_model_count')).toHaveText('제공업체 3곳 · 모델 12개');
        await expect(page.locator('#cmr_model_search_region')).toBeHidden();

        await undo.click();
        await expect(undo).toBeHidden();
        await expect(page.locator('#cmr_feedback')).toContainText('gemini-bulk-alpha 모델 등록을 복구했습니다.');
        await expect(page.locator('#cmr_model_count')).toHaveText('제공업체 3곳 · 모델 13개');
        await attachViewportScreenshot(page, testInfo, 'bulk-add-delete-undo');
    });

    test('백업은 적용 전 변경 미리보기를 스크롤하고 취소·적용할 수 있다', async ({ page }, testInfo) => {
        await openScenario(page, {
            modelCount: 3,
            showImportPreview: true,
            importPreviewItemCount: 30,
            openDetails: true,
        });
        const preview = page.locator('#cmr_import_preview');
        const list = page.locator('#cmr_import_preview_list');
        await expect(preview).toBeVisible();
        await expect(page.locator('#cmr_import_preview_summary')).toHaveText('추가 2건 · 변경 충돌 1건 · 삭제 1건');
        await expect(list.locator('li')).toHaveCount(30);
        await expect(list).toHaveAttribute('tabindex', '0');
        await expectHiddenScrollbarCanScroll(page, '#cmr_import_preview_list');
        await attachViewportScreenshot(page, testInfo, 'import-preview');

        await page.locator('#cmr_import_preview_cancel').click();
        await expect(preview).toBeHidden();
        await expect(page.locator('#cmr_feedback')).toHaveText('백업 가져오기를 취소했습니다.');

        await page.evaluate(() => globalThis.setUiRegressionState({
            modelCount: 3,
            showImportPreview: true,
            openDetails: true,
        }));
        await page.locator('#cmr_import_preview_apply').click();
        await expect(preview).toBeHidden();
        await expect(page.locator('#cmr_feedback')).toHaveText('미리보기에서 확인한 변경을 적용했습니다.');
    });
});

test.describe('Popup 닫기 계약', () => {
    test.use({ viewport: { width: 420, height: 800 } });

    test('Escape 키로 실제 modal dialog를 닫는다', async ({ page }) => {
        await openScenario(page, { modelCount: 7, externalCount: 4, openDetails: true });
        const dialog = page.locator('#cmr_manager_dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });
});
