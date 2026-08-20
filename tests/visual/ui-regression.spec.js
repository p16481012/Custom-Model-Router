import { expect, test } from '@playwright/test';
import { startUiRegressionServer } from './server.js';

const VIEWPORTS = Object.freeze([
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 420, height: 800 },
    { width: 720, height: 900 },
]);
const HELP_POPOVERS = Object.freeze([
    {
        trigger: '#cmr_provider_help_trigger',
        popover: '#cmr_provider_help',
        label: '제공업체 선택 도움말',
        description: /선택한 제공업체가 모델 ID 형식과 등록 위치를 결정합니다/,
    },
    {
        trigger: '#cmr_model_help_trigger',
        popover: '#cmr_model_help',
        label: '모델 ID 등록 규칙',
        description: /잘못된 행이 하나라도 있으면 아무 모델도 등록하지 않습니다/,
    },
    {
        trigger: '#cmr_model_list_help_trigger',
        popover: '#cmr_model_list_help',
        label: '등록 모델 목록 도움말',
        description: /비활성 모델은 이 목록에만 남고 선택기에는 표시되지 않습니다/,
    },
    {
        trigger: '#cmr_operations_help_trigger',
        popover: '#cmr_operations_help',
        label: '진단 및 백업 도움말',
        description: /등록 모델·경로·외부 선택 기록만 백업합니다/,
    },
    {
        trigger: '#cmr_external_help_trigger',
        popover: '#cmr_external_help',
        label: '외부 모델 연결 도움말',
        description: /선택지가 보여도 실제 요청에 사용됐다는 뜻은 아닙니다/,
    },
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

async function expectRegistrationControlsAligned(page) {
    const metrics = await page.evaluate(() => {
        const row = document.querySelector('#cmr_add_form .cmr-input-row');
        const textarea = document.getElementById('cmr_model_id');
        const button = row.querySelector(':scope > .cmr-add-button');
        const icon = button.querySelector(':scope > .fa-solid.fa-plus');
        const rowRect = row.getBoundingClientRect();
        const textareaRect = textarea.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
            buttonAfter: getComputedStyle(button, '::after').content,
            buttonBefore: getComputedStyle(button, '::before').content,
            buttonChildCount: button.childElementCount,
            buttonRect: {
                bottom: buttonRect.bottom,
                left: buttonRect.left,
                right: buttonRect.right,
                top: buttonRect.top,
                width: buttonRect.width,
            },
            iconAfter: getComputedStyle(icon, '::after').content,
            iconBefore: getComputedStyle(icon, '::before').content,
            iconCount: button.querySelectorAll(':scope > .fa-solid.fa-plus').length,
            rowAlignItems: getComputedStyle(row).alignItems,
            rowRect: {
                left: rowRect.left,
                right: rowRect.right,
                top: rowRect.top,
            },
            textareaRect: {
                bottom: textareaRect.bottom,
                left: textareaRect.left,
                right: textareaRect.right,
                top: textareaRect.top,
                width: textareaRect.width,
            },
            textareaRows: textarea.rows,
            textareaTagName: textarea.tagName,
        };
    });

    expect(metrics.textareaTagName).toBe('TEXTAREA');
    expect(metrics.textareaRows).toBe(3);
    expect(metrics.rowAlignItems).toBe('flex-start');
    expect(Math.abs(metrics.textareaRect.top - metrics.buttonRect.top)).toBeLessThanOrEqual(1);
    expect(metrics.textareaRect.left).toBeGreaterThanOrEqual(metrics.rowRect.left - 1);
    expect(metrics.textareaRect.right).toBeLessThan(metrics.buttonRect.left);
    expect(metrics.buttonRect.right).toBeLessThanOrEqual(metrics.rowRect.right + 1);
    expect(metrics.textareaRect.width).toBeGreaterThan(metrics.buttonRect.width);
    expect(metrics.buttonChildCount).toBe(1);
    expect(metrics.iconCount).toBe(1);
    expect(metrics.buttonBefore).toBe('none');
    expect(metrics.buttonAfter).toBe('none');
    expect(metrics.iconBefore).toBe('"+"');
    expect(metrics.iconAfter).toBe('none');
}

async function expectHelpPopoverWithinViewport(page, selector) {
    const metrics = await page.locator(selector).evaluate(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            bottom: rect.bottom,
            clientWidth: element.clientWidth,
            display: style.display,
            documentClientWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            height: rect.height,
            left: rect.left,
            overflowWrap: style.overflowWrap,
            right: rect.right,
            scrollWidth: element.scrollWidth,
            sentenceDisplays: [...element.querySelectorAll('.cmr-sentence')]
                .map(sentence => getComputedStyle(sentence).display),
            top: rect.top,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
            width: rect.width,
            wordBreak: style.wordBreak,
        };
    });

    expect(metrics.display).toBe('block');
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.height).toBeGreaterThan(0);
    expect(metrics.left).toBeGreaterThanOrEqual(-1);
    expect(metrics.top).toBeGreaterThanOrEqual(-1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
    expect(metrics.wordBreak).toBe('keep-all');
    expect(metrics.overflowWrap).toBe('normal');
    expect(metrics.sentenceDisplays.length).toBeGreaterThan(0);
    expect(new Set(metrics.sentenceDisplays)).toEqual(new Set(['block']));
}

async function exerciseHelpPopovers(page) {
    const dialog = page.locator('#cmr_manager_dialog');
    const openPopovers = page.locator('.cmr-help-popover:popover-open');

    await expect(page.locator('.cmr-info-button')).toHaveCount(HELP_POPOVERS.length);
    await expect(page.locator('.cmr-help-popover')).toHaveCount(HELP_POPOVERS.length);
    await expect(openPopovers).toHaveCount(0);

    for (const item of HELP_POPOVERS) {
        const trigger = page.locator(item.trigger);
        const popover = page.locator(item.popover);
        await expect(trigger).toHaveAttribute('type', 'button');
        await expect(trigger).toHaveAttribute('popovertarget', item.popover.slice(1));
        await expect(trigger).toHaveAttribute('aria-describedby', item.popover.slice(1));
        await expect(trigger).toHaveAccessibleName(item.label);
        await expect(trigger).toHaveAccessibleDescription(item.description);
        await expect(trigger.locator(':scope > .fa-circle-info[aria-hidden="true"]')).toHaveCount(1);
        await expect(popover).toHaveAttribute('popover', 'auto');
        await expect(popover).toBeHidden();
    }

    await expect(page.locator('.cmr-description')).toHaveText(
        '목록에 없는 모델을 등록하고, 실제 선택은 API Connections에서 합니다.',
    );
    await expect(page.locator('#cmr_provider_hint')).toHaveText('등록 위치만 정하며 현재 모델은 바뀌지 않습니다.');
    await expect(page.locator('#cmr_model_hint')).toHaveText('한 줄에 하나 · 최대 200개 · 오류가 있으면 전체 취소');
    await expect(page.locator('#cmr_operations_description')).toHaveText(
        'CMR 상태를 진단하고 비밀정보를 제외한 설정을 백업·복구합니다.',
    );
    await expect(page.locator('#cmr_external_advanced .cmr-context-row > .cmr-tool-description')).toHaveText(
        '실제 요청 적용은 외부 기능에서 직접 확인하세요.',
    );

    const provider = page.locator(HELP_POPOVERS[0].trigger);
    await provider.click();
    await expect(page.locator(HELP_POPOVERS[0].popover)).toBeVisible();
    await expect(openPopovers).toHaveCount(1);
    await expectHelpPopoverWithinViewport(page, HELP_POPOVERS[0].popover);

    const model = page.locator(HELP_POPOVERS[1].trigger);
    await model.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(HELP_POPOVERS[0].popover)).toBeHidden();
    await expect(page.locator(HELP_POPOVERS[1].popover)).toBeVisible();
    await expect(openPopovers).toHaveCount(1);
    await expectHelpPopoverWithinViewport(page, HELP_POPOVERS[1].popover);

    const list = page.locator(HELP_POPOVERS[2].trigger);
    await list.focus();
    await page.keyboard.press('Space');
    await expect(page.locator(HELP_POPOVERS[1].popover)).toBeHidden();
    await expect(page.locator(HELP_POPOVERS[2].popover)).toBeVisible();
    await expect(openPopovers).toHaveCount(1);
    await expectHelpPopoverWithinViewport(page, HELP_POPOVERS[2].popover);

    await page.locator('#cmr_panel_title').click();
    await expect(openPopovers).toHaveCount(0);

    for (const item of HELP_POPOVERS.slice(3)) {
        const trigger = page.locator(item.trigger);
        await trigger.click();
        await expect(page.locator(item.popover)).toBeVisible();
        await expect(openPopovers).toHaveCount(1);
        await expectHelpPopoverWithinViewport(page, item.popover);
    }

    const external = page.locator(HELP_POPOVERS[4].trigger);
    await page.keyboard.press('Escape');
    await expect(page.locator(HELP_POPOVERS[4].popover)).toBeHidden();
    await expect(openPopovers).toHaveCount(0);
    await expect(external).toBeFocused();
    await expect(dialog).toBeVisible();
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
            await expectRegistrationControlsAligned(page);
            await exerciseHelpPopovers(page);
            await expectNoHorizontalOverflow(page);

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
            await expect(page.locator('#cmr_add_form')).toHaveCount(1);
            await expect(page.locator('#cmr_model_id')).toHaveCount(1);
            await expect(page.locator('#cmr_bulk_add, #cmr_bulk_add_form, #cmr_bulk_model_ids')).toHaveCount(0);
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
        await openScenario(page, { modelCount: 11 });
        const textarea = page.locator('#cmr_model_id');
        const undo = page.locator('#cmr_undo_delete');
        await expect(page.locator('#cmr_add_form')).toHaveCount(1);
        await expect(page.locator('#cmr_bulk_add, #cmr_bulk_add_form, #cmr_bulk_model_ids')).toHaveCount(0);
        await expect(page.locator('#cmr_model_search_region')).toBeHidden();

        await textarea.fill('gemini-bulk-alpha\ngemini-bulk-beta\ngemini-bulk-alpha');
        await page.locator('#cmr_add_form .cmr-add-button').click();
        await expect(page.locator('#cmr_feedback')).toHaveText(
            'Google Vertex AI에 모델 2개를 등록했습니다. 중복 1개는 건너뛰었습니다.',
        );
        await expect(page.locator('#cmr_model_count')).toHaveText('제공업체 3곳 · 모델 13개');
        await expect(page.locator('#cmr_model_search_region')).toBeVisible();
        await expect(textarea).toHaveValue('');
        await expect(textarea).toBeFocused();

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
        await attachViewportScreenshot(page, testInfo, 'multiline-add-delete-undo');
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

test.describe('외부 bridge provider 선택기 경계', () => {
    test.use({ viewport: { width: 720, height: 900 } });

    test('provider select는 보존하고 연결된 model select만 provider 전환에 맞춰 동기화한다', async ({ page }) => {
        const nativeProviderValues = ['openai', 'anthropic', 'google', 'vertexai', 'custom'];
        const readSnapshot = () => page.evaluate(() => globalThis.cmrSandboxSnapshot ?? null);
        const setProvider = value => page.evaluate(
            nextValue => globalThis.cmrSandbox.setCaptionProvider(nextValue),
            value,
        );
        const expectProviderPreserved = (snapshot, value) => {
            expect(snapshot.captionProviderTargeted).toBe(false);
            expect(snapshot.captionProviderManagedCount).toBe(0);
            expect(snapshot.captionProviderValue).toBe(value);
            expect(snapshot.captionProviderValues).toEqual(nativeProviderValues);
        };

        await page.goto(fixtureServer.browserSandboxUrl, { waitUntil: 'networkidle' });
        await expect.poll(() => readSnapshot()).not.toBeNull();

        const initial = await readSnapshot();
        expectProviderPreserved(initial, 'openai');
        expect(initial.captionModelTargeted).toBe(true);
        expect(initial.captionModelManagedCount).toBeGreaterThan(0);
        expect(initial.captionModelSource).toBe('direct');
        expect(initial.captionModelRisk).toBeNull();
        const managedModelCount = initial.captionModelManagedCount;

        const cleaned = await page.evaluate(
            () => globalThis.cmrSandbox.cleanupStaleCaptionProviderModel(),
        );
        expectProviderPreserved(cleaned, 'vertexai');
        expect(cleaned.captionModelTargeted).toBe(true);
        expect(cleaned.captionModelManagedCount).toBe(managedModelCount);
        expect(cleaned.captionModelSource).toBe('direct');
        expect(cleaned.captionModelRisk).toBeNull();

        const cleanOpenai = await setProvider('openai');
        expectProviderPreserved(cleanOpenai, 'openai');
        expect(cleanOpenai.captionModelManagedCount).toBe(managedModelCount);

        const anthropic = await setProvider('anthropic');
        expectProviderPreserved(anthropic, 'anthropic');
        expect(anthropic.captionModelTargeted).toBe(true);
        expect(anthropic.captionModelManagedCount).toBe(managedModelCount);
        expect(anthropic.captionModelSource).toBe('direct');
        expect(anthropic.captionModelRisk).toBeNull();

        const custom = await setProvider('custom');
        expectProviderPreserved(custom, 'custom');
        expect(custom.captionModelTargeted).toBe(true);
        expect(custom.captionModelManagedCount).toBe(0);
        expect(custom.captionModelSource).toBe('risk-blocked');
        expect(custom.captionModelRisk).toBe('caption-special-provider');

        const restored = await setProvider('openai');
        expectProviderPreserved(restored, 'openai');
        expect(restored.captionModelTargeted).toBe(true);
        expect(restored.captionModelManagedCount).toBe(managedModelCount);
        expect(restored.captionModelSource).toBe('direct');
        expect(restored.captionModelRisk).toBeNull();

        const unsupported = await page.locator('#caption_model_provider').evaluate((provider, modelId) => {
            provider.value = modelId;
            return {
                hasModelOption: [...provider.options].some(option => option.value === modelId),
                value: provider.value,
            };
        }, 'gpt-5.9-preview');
        expect(unsupported).toEqual({ hasModelOption: false, value: '' });

        const finalSnapshot = await setProvider('openai');
        expectProviderPreserved(finalSnapshot, 'openai');
        expect(finalSnapshot.captionModelManagedCount).toBe(managedModelCount);
    });
});

test.describe('공용 provider adapter 실제 요청 경계', () => {
    test.use({ viewport: { width: 720, height: 900 } });

    async function openProviderSandbox(page) {
        await page.goto(fixtureServer.providerIntegrationSandboxUrl, { waitUntil: 'networkidle' });
        await expect.poll(() => page.evaluate(() => globalThis.cmrProviderSandboxSnapshot ?? null)).not.toBeNull();
    }

    test('SillyTavern 연결 상속은 handler 설치 뒤에만 모델을 게시하고 정확한 profile/model로 요청한다', async ({ page }) => {
        await openProviderSandbox(page);
        const initial = await page.evaluate(() => globalThis.cmrProviderSandbox.snapshot());
        expect(initial.metrics).toMatchObject({ consumerCount: 0, readyCount: 0, publishedModelCount: 0 });
        expect(initial.nativeProviderValues).toEqual(['native']);
        expect(initial.nativeModelValues).toEqual(['native-model']);
        expect(initial.hookOwnedCount).toBe(0);

        const ready = await page.evaluate(
            () => globalThis.cmrProviderSandbox.register('sillytavern-inherited'),
        );
        expect(ready.metrics).toMatchObject({ consumerCount: 1, readyCount: 1, failedCount: 0 });
        expect(ready.hookProviderValues).toEqual(['cmr.sillytavern.openai']);
        expect(ready.hookModelValues).toEqual(['gpt-hook-model']);
        expect(ready.lifecycle).toMatchObject({
            installEnvelopeFrozen: true,
            providerDescriptorFrozen: true,
            modelListFrozen: true,
            abortSignalFrozen: false,
            publishCount: 1,
        });

        const requested = await page.evaluate(
            () => globalThis.cmrProviderSandbox.request('gpt-hook-model', { stream: true }),
        );
        expect(requested.calls).toEqual([{
            profileId: 'profile-inherited',
            model: 'gpt-hook-model',
            prompt: [{ role: 'user', content: 'fixture request' }],
            maxTokens: 64,
            stream: true,
        }]);
        expect(requested.lastRequestResult).toEqual({ content: 'inherited-ok', model: 'gpt-hook-model' });
        expect(requested.mainChatSettings).toEqual({
            chat_completion_source: 'xai',
            xai_model: 'main-chat-model',
        });
        expect(requested.secretExposed).toBe(false);

        const disposed = await page.evaluate(() => globalThis.cmrProviderSandbox.dispose());
        expect(disposed.metrics).toMatchObject({ consumerCount: 0, readyCount: 0, publishedModelCount: 0 });
        expect(disposed.hookOwnedCount).toBe(0);
        expect(disposed.lifecycle).toMatchObject({ handlerDisposeCount: 1, publicationDisposeCount: 1 });
        expect(disposed.nativeProviderValues).toEqual(['native']);
        expect(disposed.nativeModelValues).toEqual(['native-model']);
    });

    test('OpenAI-compatible은 Connection Manager가 소유한 endpoint/인증으로 실제 POST하고 CMR 공개 상태에는 노출하지 않는다', async ({ page }) => {
        let requestEvidence = null;
        await page.route('**/provider-integrations/echo', async route => {
            const request = route.request();
            requestEvidence = {
                method: request.method(),
                authorization: request.headers().authorization,
                body: request.postDataJSON(),
            };
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ content: 'compatible-ok' }),
            });
        });
        await openProviderSandbox(page);

        const ready = await page.evaluate(
            () => globalThis.cmrProviderSandbox.register('openai-compatible'),
        );
        expect(ready.hookProviderValues).toEqual(['cmr.openai-compatible']);
        expect(ready.hookModelValues).toEqual(['compatible-hook-model']);
        const requested = await page.evaluate(
            () => globalThis.cmrProviderSandbox.request('compatible-hook-model'),
        );
        expect(requestEvidence).toEqual({
            method: 'POST',
            authorization: 'Bearer browser-fixture-private-secret',
            body: {
                model: 'compatible-hook-model',
                messages: [{ role: 'user', content: 'fixture request' }],
                max_tokens: 64,
                stream: false,
            },
        });
        expect(requested.lastRequestResult).toEqual({ content: 'compatible-ok' });
        expect(requested.secretExposed).toBe(false);
        expect(JSON.stringify(requested.consumers)).not.toContain('profile-compatible');
        expect(JSON.stringify(requested.consumers)).not.toContain('provider-integrations/echo');
        await page.evaluate(() => globalThis.cmrProviderSandbox.dispose());
    });

    test('호환되지 않는 hook은 native UI를 그대로 두고 성공한 공개 hook도 refresh에서 중복 게시하지 않는다', async ({ page }) => {
        await openProviderSandbox(page);
        const rejected = await page.evaluate(() => globalThis.cmrProviderSandbox.registerIncompatible());
        expect(rejected.code).toBe('consumer_contract_incompatible');
        expect(rejected.snapshot.metrics).toMatchObject({ consumerCount: 0, readyCount: 0 });
        expect(rejected.snapshot.hookOwnedCount).toBe(0);
        expect(rejected.snapshot.nativeProviderValues).toEqual(['native']);
        expect(rejected.snapshot.nativeProviderValue).toBe('native');
        expect(rejected.snapshot.nativeModelValues).toEqual(['native-model']);
        expect(rejected.snapshot.nativeModelValue).toBe('native-model');

        await page.evaluate(() => globalThis.cmrProviderSandbox.register('sillytavern-inherited'));
        const refreshed = await page.evaluate(async () => {
            await globalThis.cmrProviderSandbox.controller.api.refresh();
            return globalThis.cmrProviderSandbox.snapshot();
        });
        expect(refreshed.lifecycle.publishCount).toBe(1);
        expect(refreshed.metrics).toMatchObject({ consumerCount: 1, readyCount: 1, failedCount: 0 });
        expect(refreshed.hookProviderValues).toEqual(['cmr.sillytavern.openai']);
        expect(refreshed.hookModelValues).toEqual(['gpt-hook-model']);
        expect(refreshed.nativeProviderValues).toEqual(['native']);
        expect(refreshed.nativeModelValues).toEqual(['native-model']);
        await page.evaluate(() => globalThis.cmrProviderSandbox.dispose());
    });
});

test.describe('Popup 닫기 계약', () => {
    test.use({ viewport: { width: 420, height: 800 } });

    test('첫 Escape는 도움말만 닫고 두 번째 Escape는 실제 modal dialog를 닫는다', async ({ page }) => {
        await openScenario(page, { modelCount: 7, externalCount: 4, openDetails: true });
        const dialog = page.locator('#cmr_manager_dialog');
        const trigger = page.locator('#cmr_provider_help_trigger');
        const popover = page.locator('#cmr_provider_help');
        await expect(dialog).toBeVisible();

        await trigger.click();
        await expect(popover).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(popover).toBeHidden();
        await expect(trigger).toBeFocused();
        await expect(dialog).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });
});
