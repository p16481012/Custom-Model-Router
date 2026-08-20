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
            '.cmr-list-region',
            '#cmr_model_list',
            '.cmr-model-row',
            '#cmr_external_warning',
            '.cmr-tool-section',
            '.cmr-tool-body',
            '.cmr-operation-actions',
            '#cmr_external_advanced',
            '#cmr_external_list',
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

        test('실제 Popup CSS에서 패널 배치와 고급 외부 연결 관리를 유지한다', async ({ page }, testInfo) => {
            await openScenario(page, {
                modelCount: 7,
                externalCount: 12,
                externalExcludedCount: 2,
                diagnosticCount: 20,
                openDetails: true,
                openAdvanced: true,
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
            const deleteButtonSize = await page.locator('.cmr-delete-button').first().evaluate(element => {
                const rect = element.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            });
            expect(deleteButtonSize.width).toBeLessThanOrEqual(30);
            expect(Math.abs(deleteButtonSize.width - deleteButtonSize.height)).toBeLessThanOrEqual(1);

            await expect(page.locator('#cmr_external_section')).toHaveCount(0);
            await expect(page.locator('#cmr_external_warning')).toBeHidden();
            const external = page.locator('#cmr_operations_section #cmr_external_advanced');
            await expect(external).toHaveCount(1);
            await expect(external.locator('.cmr-external-row')).toHaveCount(12);
            await expect(external.locator('.cmr-external-state[data-state="connected"]')).toHaveCount(10);
            await expect(external.locator('.cmr-external-state[data-state="excluded"]')).toHaveCount(2);
            await expect(external).toContainText('선택지 연결됨');
            await expect(external).toContainText('실제 요청 확인 필요');
            await expect(external).toContainText('연결 제외');
            await expect(external.locator('[data-cmr-external-action="exclude"]')).toHaveCount(10);
            await expect(external.locator('[data-cmr-external-action="restore"]')).toHaveCount(2);
            expect(await external.locator('[data-cmr-external-action]').allTextContents()).toEqual(
                Array.from({ length: 12 }, () => ''),
            );
            await expect(external.locator('select, [data-cmr-external-mode]')).toHaveCount(0);
            await expect(external).not.toContainText('자동 연결');
            await expect(external).not.toContainText('연결 안 함');
            await expect(external).not.toContainText('모델 새로고침');

            const longExternalName = external.locator('.cmr-external-name').first();
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
                const summaryTitle = document.querySelector('#cmr_external_advanced summary > span:first-child');
                const summaryCount = document.getElementById('cmr_external_count');
                const titleRect = summaryTitle.getBoundingClientRect();
                const countRect = summaryCount.getBoundingClientRect();
                const overlaps = titleRect.left < countRect.right
                    && titleRect.right > countRect.left
                    && titleRect.top < countRect.bottom
                    && titleRect.bottom > countRect.top;
                return {
                    overlaps,
                    scopePaddingBottom: Number.parseFloat(getComputedStyle(
                        document.querySelector('.cmr-scope-note .cmr-tool-body'),
                    ).paddingBottom),
                };
            });
            expect(detailsSpacing.overlaps).toBe(false);
            expect(detailsSpacing.scopePaddingBottom).toBeGreaterThan(0);

            await attachViewportScreenshot(page, testInfo, `ui-${viewport.width}x${viewport.height}`);

            await expectHiddenScrollbarCanScroll(page, '#cmr_model_list');
            await expectHiddenScrollbarCanScroll(page, '#cmr_external_list');
            await expectHiddenScrollbarCanScroll(page, '#cmr_diagnostic_list');
            await expectHiddenScrollbarCanScroll(page, '.popup-content', {
                keyboard: false,
                hoverAtStart: true,
            });
            await page.locator('#cmr_model_list, #cmr_external_list, #cmr_diagnostic_list').evaluateAll(elements => {
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
        await expect(advanced.locator('summary')).toBeFocused();
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
        await excludeButton.focus();
        await excludeButton.click();
        await expect(warning).toBeHidden();
        const targetRow = advanced.locator(`[data-target-id="${targetId}"]`);
        await expect(targetRow.locator('.cmr-external-state')).toHaveText('연결 제외');
        const restoreButton = targetRow.locator('[data-cmr-external-action="restore"]');
        await expect(restoreButton).toBeFocused();

        await restoreButton.click();
        await expect(warning).toBeVisible();
        await expect(targetRow.locator('.cmr-external-state')).toHaveText('선택지 연결 실패');
        await expect(targetRow.locator('[data-cmr-external-action="exclude"]')).toBeFocused();
        await expectNoHorizontalOverflow(page);
        await attachViewportScreenshot(page, testInfo, 'external-warning-advanced');
    });

    test('런타임 감시 문제를 임의의 대상 문제로 표현하지 않는다', async ({ page }) => {
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
    });
});

test.describe('모델 목록 스크롤 경계', () => {
    test.use({ viewport: { width: 420, height: 800 } });

    test('0개·6개는 펼치고 7개·100개는 숨은 내부 스크롤을 사용한다', async ({ page }, testInfo) => {
        await openScenario(page, { modelCount: 0, externalCount: 0, diagnosticCount: 0 });
        const list = page.locator('#cmr_model_list');

        for (const modelCount of [0, 6]) {
            await page.evaluate(count => globalThis.setUiRegressionState({ modelCount: count }), modelCount);
            await expect(list).toHaveAttribute('data-scrollable', 'false');
            await expect(list).not.toHaveAttribute('tabindex', '0');
            await expect(list).toHaveCSS('overflow', 'visible');
            await attachViewportScreenshot(page, testInfo, `model-boundary-${modelCount}`);
        }

        for (const modelCount of [7, 100]) {
            await page.evaluate(count => globalThis.setUiRegressionState({ modelCount: count }), modelCount);
            await expect(list).toHaveAttribute('data-scrollable', 'true');
            await expect(list).toHaveAttribute('tabindex', '0');
            await expectHiddenScrollbarCanScroll(page, '#cmr_model_list');
            await list.evaluate(element => { element.scrollTop = 0; });
            await page.locator('.popup-content').evaluate(element => { element.scrollTop = 0; });
            await attachViewportScreenshot(page, testInfo, `model-boundary-${modelCount}`);
        }
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
