import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(TEST_DIR, '..', '..');
const REQUIRED_ST_VERSION = '1.18.0';

const MIME_TYPES = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
});

async function findSillyTavernRoot() {
    const candidates = [
        process.env.SILLYTAVERN_ROOT,
        process.env.SILLYTAVERN_DIR,
        resolve(REPOSITORY_ROOT, '..', 'sillytavern-1.18.0-review'),
        resolve(REPOSITORY_ROOT, '..', 'SillyTavern'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        const root = resolve(candidate);
        try {
            const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
            await Promise.all([
                readFile(resolve(root, 'public', 'style.css')),
                readFile(resolve(root, 'public', 'css', 'popup.css')),
            ]);
            if (packageJson.version === REQUIRED_ST_VERSION) {
                return root;
            }
        } catch {
            // 다음 후보를 확인한다.
        }
    }

    throw new Error(
        'SillyTavern 1.18.0 소스를 찾지 못했습니다. '
        + 'SILLYTAVERN_ROOT에 해당 저장소 경로를 지정해 주세요.',
    );
}

function fixtureScript() {
    return String.raw`
        (() => {
            'use strict';

            const providers = [
                { id: 'vertexai', label: 'Google Vertex AI' },
                { id: 'openrouter', label: 'OpenRouter' },
                { id: 'zai', label: 'Z.AI (GLM)' },
            ];
            const MODEL_SCROLL_THRESHOLD = 6;
            const MODEL_SEARCH_THRESHOLD = 12;
            const EXTERNAL_OPTION_PER_TARGET_LIMIT = 512;
            const EXTERNAL_OPTION_WARNING_THRESHOLD = 2048;

            const providerSelect = document.getElementById('cmr_provider');
            for (const provider of providers) {
                const option = document.createElement('option');
                option.value = provider.id;
                option.textContent = provider.label;
                providerSelect.append(option);
            }
            providerSelect.value = providers[0].id;

            let registeredModels = [];
            let modelSearchQuery = '';
            let pendingDeletion = null;

            function modelId(index) {
                if (index === 0) {
                    return 'gemini-' + 'very-long-model-identifier-'.repeat(12) + 'preview';
                }
                const prefixes = ['gemini-future', 'router/future-model', 'glm-future'];
                return prefixes[index % prefixes.length] + '-' + String(index + 1).padStart(3, '0');
            }

            function configureModels(total) {
                registeredModels = [];
                for (let index = 0; index < Math.max(0, Number(total) || 0); index += 1) {
                    registeredModels.push({
                        provider: providers[index % providers.length].id,
                        id: modelId(index),
                    });
                }
                pendingDeletion = null;
                modelSearchQuery = '';
                document.getElementById('cmr_model_search').value = '';
                renderModels();
                renderUndo();
            }

            function renderModels() {
                const list = document.getElementById('cmr_model_list');
                const count = document.getElementById('cmr_model_count');
                const searchRegion = document.getElementById('cmr_model_search_region');
                const searchStatus = document.getElementById('cmr_model_search_status');
                const searchVisible = registeredModels.length > MODEL_SEARCH_THRESHOLD;
                searchRegion.hidden = !searchVisible;
                if (!searchVisible) {
                    modelSearchQuery = '';
                    document.getElementById('cmr_model_search').value = '';
                }
                const normalizedQuery = modelSearchQuery.trim().toLocaleLowerCase('ko');
                const visibleModels = registeredModels.filter(model => {
                    const provider = providers.find(item => item.id === model.provider);
                    return !normalizedQuery
                        || (provider?.label + ' ' + model.provider + ' ' + model.id)
                            .toLocaleLowerCase('ko')
                            .includes(normalizedQuery);
                });
                const groups = providers.map(provider => ({
                    provider,
                    models: visibleModels.filter(model => model.provider === provider.id),
                }));
                const populated = new Set(registeredModels.map(model => model.provider)).size;
                count.textContent = normalizedQuery
                    ? '검색 ' + visibleModels.length + '/' + registeredModels.length + '개'
                    : '제공업체 ' + populated + '곳 · 모델 ' + registeredModels.length + '개';
                searchStatus.textContent = normalizedQuery
                    ? '등록 모델 ' + registeredModels.length + '개 중 ' + visibleModels.length + '개를 표시합니다.'
                    : '';
                list.dataset.scrollable = String(visibleModels.length > MODEL_SCROLL_THRESHOLD);
                if (visibleModels.length > MODEL_SCROLL_THRESHOLD) {
                    list.tabIndex = 0;
                    list.setAttribute('aria-label', '표시 중인 등록 모델 ' + visibleModels.length + '개. 스크롤하여 모두 확인할 수 있습니다.');
                } else {
                    list.removeAttribute('tabindex');
                    list.removeAttribute('aria-label');
                }
                list.replaceChildren();

                if (registeredModels.length === 0) {
                    const empty = document.createElement('li');
                    empty.className = 'cmr-empty';
                    empty.textContent = '등록한 모델이 없습니다.';
                    list.append(empty);
                    return;
                }
                if (visibleModels.length === 0) {
                    const empty = document.createElement('li');
                    empty.className = 'cmr-empty';
                    empty.textContent = '검색 조건과 일치하는 등록 모델이 없습니다.';
                    list.append(empty);
                    return;
                }

                for (const groupData of groups) {
                    if (!groupData.models.length) continue;
                    const group = document.createElement('li');
                    group.className = 'cmr-provider-group';
                    group.dataset.provider = groupData.provider.id;

                    const header = document.createElement('div');
                    header.className = 'cmr-provider-group-header';
                    const label = document.createElement('span');
                    label.className = 'cmr-provider-group-label';
                    label.textContent = groupData.provider.label;
                    const groupCount = document.createElement('span');
                    groupCount.className = 'cmr-provider-group-count';
                    groupCount.textContent = groupData.models.length + '개';
                    header.append(label, groupCount);

                    const providerList = document.createElement('ul');
                    providerList.className = 'cmr-provider-model-list';
                    providerList.setAttribute('aria-label', groupData.provider.label + ' 등록 모델');
                    for (const model of groupData.models) {
                        const id = model.id;
                        const row = document.createElement('li');
                        row.className = 'cmr-model-row';
                        row.dataset.provider = groupData.provider.id;

                        const summary = document.createElement('div');
                        summary.className = 'cmr-model-summary';
                        const code = document.createElement('code');
                        code.className = 'cmr-model-id';
                        code.dir = 'ltr';
                        code.title = id;
                        code.textContent = id;
                        summary.append(code);

                        const actions = document.createElement('div');
                        actions.className = 'cmr-model-actions';
                        const remove = document.createElement('button');
                        remove.type = 'button';
                        remove.className = 'menu_button cmr-icon-button cmr-delete-button';
                        remove.dataset.cmrAction = 'delete';
                        remove.dataset.provider = groupData.provider.id;
                        remove.dataset.modelId = id;
                        remove.title = '등록 삭제';
                        remove.setAttribute('aria-label', groupData.provider.label + ' ' + id + ' 모델 등록 삭제');
                        const icon = document.createElement('i');
                        icon.className = 'fa-solid fa-trash-can';
                        icon.setAttribute('aria-hidden', 'true');
                        remove.append(icon);
                        actions.append(remove);
                        row.append(summary, actions);
                        providerList.append(row);
                    }
                    group.append(header, providerList);
                    list.append(group);
                }
            }

            function renderUndo() {
                const button = document.getElementById('cmr_undo_delete');
                button.hidden = !pendingDeletion;
                if (pendingDeletion) {
                    button.setAttribute('aria-label', pendingDeletion.id + ' 모델 삭제 실행 취소');
                }
            }

            document.getElementById('cmr_model_search').addEventListener('input', event => {
                modelSearchQuery = event.currentTarget.value;
                renderModels();
            });

            document.getElementById('cmr_model_list').addEventListener('click', event => {
                const button = event.target.closest('[data-cmr-action="delete"]');
                if (!button) return;
                const index = registeredModels.findIndex(model => (
                    model.provider === button.dataset.provider && model.id === button.dataset.modelId
                ));
                if (index < 0) return;
                pendingDeletion = { ...registeredModels[index], index };
                registeredModels.splice(index, 1);
                document.getElementById('cmr_feedback').textContent = pendingDeletion.id + ' 모델 등록을 삭제했습니다.';
                renderModels();
                renderUndo();
                document.getElementById('cmr_undo_delete').focus();
            });

            document.getElementById('cmr_undo_delete').addEventListener('click', () => {
                if (!pendingDeletion) return;
                const restored = pendingDeletion;
                registeredModels.splice(Math.min(restored.index, registeredModels.length), 0, {
                    provider: restored.provider,
                    id: restored.id,
                });
                pendingDeletion = null;
                document.getElementById('cmr_feedback').textContent = restored.id + ' 모델 등록을 복구했습니다.';
                renderModels();
                renderUndo();
            });

            document.getElementById('cmr_add_form').addEventListener('submit', event => {
                event.preventDefault();
                const textarea = document.getElementById('cmr_model_id');
                const provider = providerSelect.value;
                const existing = new Set(registeredModels.map(model => model.provider + '\u0000' + model.id));
                const additions = [];
                let duplicateCount = 0;
                for (const rawLine of textarea.value.split(/\r?\n/)) {
                    const id = rawLine.trim();
                    const key = provider + '\u0000' + id;
                    if (!id) continue;
                    if (existing.has(key)) {
                        duplicateCount += 1;
                        continue;
                    }
                    existing.add(key);
                    additions.push({ provider, id });
                }
                registeredModels.push(...additions);
                pendingDeletion = null;
                textarea.value = '';
                const providerLabel = providers.find(item => item.id === provider)?.label ?? provider;
                const duplicateSuffix = duplicateCount
                    ? ' 중복 ' + duplicateCount + '개는 건너뛰었습니다.'
                    : '';
                document.getElementById('cmr_feedback').textContent = providerLabel
                    + '에 모델 ' + additions.length + '개를 등록했습니다.' + duplicateSuffix;
                renderModels();
                renderUndo();
                textarea.focus();
            });

            let externalScenario = {
                targets: [],
                failureProneTargets: new Set(),
                runtimeProblem: false,
                capacityLimitedTargetCount: 0,
                expectedManagedOptionCount: 0,
                actualManagedOptionCount: 0,
            };

            function configureExternal({
                total = 0,
                excludedTotal = 0,
                problemTotal = 0,
                riskBlockedTotal = 0,
                runtimeProblem = false,
                capacityLimitedTargetCount = 0,
                expectedManagedOptionCount = 0,
                actualManagedOptionCount = 0,
            } = {}) {
                const safeTotal = Math.max(0, Number(total) || 0);
                const safeRiskBlocked = Math.min(safeTotal, Math.max(0, Number(riskBlockedTotal) || 0));
                const safeProblems = Math.min(
                    safeTotal - safeRiskBlocked,
                    Math.max(0, Number(problemTotal) || 0),
                );
                const safeExcluded = Math.min(
                    safeTotal - safeRiskBlocked - safeProblems,
                    Math.max(0, Number(excludedTotal) || 0),
                );
                const connectedTotal = safeTotal - safeExcluded - safeProblems - safeRiskBlocked;
                const targets = [];
                for (let index = 0; index < safeTotal; index += 1) {
                    const isExcluded = index >= connectedTotal && index < connectedTotal + safeExcluded;
                    const isFailed = index >= connectedTotal + safeExcluded
                        && index < connectedTotal + safeExcluded + safeProblems;
                    const isRiskBlocked = index >= safeTotal - safeRiskBlocked;
                    targets.push({
                        targetId: 'fixture-target-' + index,
                        label: isRiskBlocked ? '안전상 제외 ' + (index + 1) : '외부 확장 ' + (index + 1),
                        controlLabel: 'Chat Completion 모델 칸 ' + (index + 1),
                        source: isRiskBlocked ? 'risk-blocked' : (isExcluded ? 'user-excluded' : 'direct'),
                        bridgeStatus: isFailed ? 'failed' : 'connected',
                    });
                }
                externalScenario = {
                    targets,
                    failureProneTargets: new Set(targets
                        .filter(target => target.bridgeStatus === 'failed')
                        .map(target => target.targetId)),
                    runtimeProblem: Boolean(runtimeProblem),
                    capacityLimitedTargetCount: Math.max(0, Number(capacityLimitedTargetCount) || 0),
                    expectedManagedOptionCount: Math.max(0, Number(expectedManagedOptionCount) || 0),
                    actualManagedOptionCount: Math.max(0, Number(actualManagedOptionCount) || 0),
                };
                renderExternal();
            }

            function createExternalRow(target) {
                const row = document.createElement('li');
                row.className = 'cmr-model-row cmr-external-row';
                row.dataset.targetId = target.targetId;
                const summary = document.createElement('div');
                summary.className = 'cmr-model-summary';
                const heading = document.createElement('span');
                heading.className = 'cmr-external-heading';
                const name = document.createElement('strong');
                name.className = 'cmr-external-name';
                name.textContent = target.targetId === 'fixture-target-0'
                    ? '공백없이아주긴외부확장모델선택기이름'.repeat(8)
                    : target.label;
                const control = document.createElement('small');
                control.className = 'cmr-external-control';
                control.textContent = target.controlLabel;
                const meta = document.createElement('span');
                meta.className = 'cmr-external-meta';
                const state = document.createElement('span');
                state.className = 'cmr-external-state';
                const verification = document.createElement('span');
                verification.className = 'cmr-external-verification';
                if (target.source === 'user-excluded') {
                    state.dataset.state = 'excluded';
                    state.textContent = '사용자 제외';
                    verification.textContent = 'CMR 선택지를 표시하지 않음';
                } else if (target.bridgeStatus === 'failed') {
                    state.dataset.state = 'failed';
                    state.textContent = '선택지 연결 실패';
                    verification.textContent = '이 대상 제외 가능';
                } else {
                    state.dataset.state = 'connected';
                    state.textContent = '선택지 연결됨';
                    verification.textContent = '실제 요청 확인 필요';
                }
                meta.append(state, verification);
                heading.append(name, control, meta);
                summary.append(heading);

                const actions = document.createElement('div');
                actions.className = 'cmr-external-actions';
                const action = document.createElement('button');
                const shouldRestore = target.source === 'user-excluded';
                action.type = 'button';
                action.className = 'menu_button cmr-icon-button';
                action.dataset.cmrExternalAction = shouldRestore ? 'restore' : 'exclude';
                action.dataset.targetId = target.targetId;
                action.title = shouldRestore ? '다시 연결' : '이 대상 연결 제외';
                action.setAttribute(
                    'aria-label',
                    target.label + ' · ' + target.controlLabel
                        + (shouldRestore ? ' 다시 연결' : ' 연결에서 제외'),
                );
                const icon = document.createElement('i');
                icon.className = shouldRestore ? 'fa-solid fa-rotate-left' : 'fa-solid fa-eye-slash';
                icon.setAttribute('aria-hidden', 'true');
                action.append(icon);
                actions.append(action);
                row.append(summary, actions);
                return row;
            }

            function appendExternalRows(list, targets, emptyMessage) {
                list.replaceChildren();
                for (const target of targets) list.append(createExternalRow(target));
                if (!targets.length) {
                    const empty = document.createElement('li');
                    empty.className = 'cmr-empty';
                    empty.textContent = emptyMessage;
                    list.append(empty);
                }
            }

            function renderExternal() {
                const list = document.getElementById('cmr_external_list');
                const pickerList = document.getElementById('cmr_external_picker_list');
                const count = document.getElementById('cmr_external_count');
                const status = document.getElementById('cmr_external_status');
                const warning = document.getElementById('cmr_external_warning');
                const warningText = document.getElementById('cmr_external_warning_text');
                const failedTargets = externalScenario.targets.filter(target => (
                    target.source === 'direct' && target.bridgeStatus === 'failed'
                ));
                const excludedTargets = externalScenario.targets.filter(target => target.source === 'user-excluded');
                const selectableTargets = externalScenario.targets.filter(target => (
                    target.source === 'direct' && target.bridgeStatus !== 'failed'
                ));
                const optionCapacityLimited = externalScenario.capacityLimitedTargetCount > 0;
                const managedOptionCount = Math.max(
                    externalScenario.expectedManagedOptionCount,
                    externalScenario.actualManagedOptionCount,
                );
                const optionBudgetExceeded = managedOptionCount > EXTERNAL_OPTION_WARNING_THRESHOLD;
                const hasProblem = failedTargets.length > 0 || externalScenario.runtimeProblem
                    || optionCapacityLimited || optionBudgetExceeded;

                count.textContent = failedTargets.length || excludedTargets.length
                    ? '문제 ' + failedTargets.length + '개 · 사용자 제외 ' + excludedTargets.length + '개'
                    : (optionCapacityLimited || optionBudgetExceeded ? '성능 주의' : '설정 없음');
                status.dataset.state = failedTargets.length || externalScenario.runtimeProblem
                    ? 'error'
                    : (optionCapacityLimited || optionBudgetExceeded ? 'warning' : 'ok');
                status.textContent = failedTargets.length
                    ? failedTargets.length + '개 대상의 선택지 연결을 확인해야 합니다.'
                    : externalScenario.runtimeProblem
                        ? '외부 연결 감시 자원을 확인해야 합니다.'
                        : optionCapacityLimited
                            ? '외부 모델 칸 ' + externalScenario.capacityLimitedTargetCount
                                + '곳은 표시 가능한 CMR 선택지가 ' + EXTERNAL_OPTION_PER_TARGET_LIMIT
                                + '개를 넘어 일부만 표시합니다.'
                            : optionBudgetExceeded
                                ? '외부 모델 선택지 ' + managedOptionCount
                                    + '개가 권장 한도 2048개를 초과했습니다.'
                                : excludedTargets.length
                                    ? excludedTargets.length + '개 대상을 사용자가 연결에서 제외했습니다.'
                                    : '현재 조치가 필요한 외부 연결 문제가 없습니다.';

                const warningMessages = [];
                if (failedTargets.length) {
                    warningMessages.push(failedTargets.length + '개 모델 칸에 선택지를 표시하지 못했습니다.');
                } else if (externalScenario.runtimeProblem) {
                    warningMessages.push('외부 연결 감시 자원 상태가 예상과 다릅니다.');
                }
                if (!failedTargets.length && !externalScenario.runtimeProblem && optionCapacityLimited) {
                    warningMessages.push('외부 모델 칸 ' + externalScenario.capacityLimitedTargetCount
                        + '곳은 표시 가능한 CMR 선택지가 ' + EXTERNAL_OPTION_PER_TARGET_LIMIT
                        + '개를 넘어 일부만 표시합니다.');
                } else if (!failedTargets.length && !externalScenario.runtimeProblem && optionBudgetExceeded) {
                    warningMessages.push('외부 모델 선택지 ' + managedOptionCount
                        + '개가 권장 한도 2048개를 초과했습니다.');
                }
                warning.hidden = !hasProblem;
                warningText.textContent = warningMessages.join('\n');
                appendExternalRows(
                    list,
                    [...failedTargets, ...excludedTargets],
                    '연결 실패나 사용자 제외 대상이 없습니다.',
                );
                appendExternalRows(
                    pickerList,
                    selectableTargets,
                    '현재 화면에서 직접 제외할 수 있는 외부 모델 칸이 없습니다.',
                );
            }

            document.getElementById('cmr_external_advanced').addEventListener('click', event => {
                const action = event.target.closest('[data-cmr-external-action]');
                if (!action) return;
                const target = externalScenario.targets.find(item => item.targetId === action.dataset.targetId);
                if (!target) return;
                if (action.dataset.cmrExternalAction === 'exclude') {
                    target.source = 'user-excluded';
                    target.bridgeStatus = 'connected';
                } else {
                    target.source = 'direct';
                    target.bridgeStatus = externalScenario.failureProneTargets.has(target.targetId)
                        ? 'failed'
                        : 'connected';
                }
                renderExternal();
                [...document.querySelectorAll('[data-cmr-external-action]')]
                    .find(candidate => candidate.dataset.targetId === target.targetId)
                    ?.focus();
            });

            function renderDiagnostics(total, optionWarning = false) {
                const list = document.getElementById('cmr_diagnostic_list');
                const summary = document.getElementById('cmr_diagnostic_summary');
                summary.dataset.state = optionWarning ? 'warning' : 'ok';
                summary.textContent = optionWarning
                    ? '호환성 검사에서 외부 모델 선택지 성능 주의를 찾았습니다.'
                    : (total
                        ? '호환성 진단 예시 결과입니다.'
                        : '진단을 실행하면 버전·이벤트·모델 컨트롤·중복 자원을 확인합니다.');
                list.replaceChildren();
                for (let index = 0; index < total; index += 1) {
                    const item = document.createElement('li');
                    item.dataset.status = index === total - 1 ? 'warning' : 'passed';
                    item.textContent = (index === total - 1 ? '주의' : '통과')
                        + ' · 실제 Chromium 배치 검사용 진단 항목 ' + (index + 1) + '입니다.';
                    list.append(item);
                }
                if (optionWarning) {
                    const item = document.createElement('li');
                    item.dataset.status = 'warning';
                    item.textContent = '외부 모델 선택지 DOM 옵션이 권장 한도를 초과했습니다.';
                    list.append(item);
                }
            }

            function renderImportPreview(visible, itemCount = 3) {
                const preview = document.getElementById('cmr_import_preview');
                const summary = document.getElementById('cmr_import_preview_summary');
                const list = document.getElementById('cmr_import_preview_list');
                preview.hidden = !visible;
                list.replaceChildren();
                if (!visible) {
                    summary.textContent = '';
                    return;
                }
                summary.dataset.state = 'warning';
                summary.textContent = '추가 2건 · 변경 충돌 1건 · 삭제 1건';
                const changes = ['addition', 'conflict', 'deletion'];
                for (let index = 0; index < itemCount; index += 1) {
                    const item = document.createElement('li');
                    item.dataset.change = changes[index % changes.length];
                    item.textContent = (index % 3 === 0
                        ? '모델 추가 · Google Vertex AI · gemini-import-preview-'
                        : index % 3 === 1
                            ? '모델 선택 변경 · OpenRouter · '
                            : '기능 경로 삭제 · translation · ') + (index + 1);
                    list.append(item);
                }
            }

            document.getElementById('cmr_import_preview_cancel').addEventListener('click', () => {
                renderImportPreview(false);
                document.getElementById('cmr_feedback').textContent = '백업 가져오기를 취소했습니다.';
            });
            document.getElementById('cmr_import_preview_apply').addEventListener('click', () => {
                renderImportPreview(false);
                document.getElementById('cmr_feedback').textContent = '미리보기에서 확인한 변경을 적용했습니다.';
            });

            globalThis.setUiRegressionState = ({
                modelCount = 0,
                externalCount = 0,
                externalExcludedCount = 0,
                externalProblemCount = 0,
                externalRiskBlockedCount = 0,
                externalRuntimeProblem = false,
                externalCapacityLimitedTargetCount = 0,
                externalExpectedManagedOptionCount = 0,
                externalActualManagedOptionCount = 0,
                diagnosticCount = 0,
                diagnosticOptionWarning = false,
                showImportPreview = false,
                importPreviewItemCount = 3,
                openDetails = false,
                openAdvanced = openDetails,
                openPicker = false,
            } = {}) => {
                configureModels(modelCount);
                configureExternal({
                    total: externalCount,
                    excludedTotal: externalExcludedCount,
                    problemTotal: externalProblemCount,
                    riskBlockedTotal: externalRiskBlockedCount,
                    runtimeProblem: externalRuntimeProblem,
                    capacityLimitedTargetCount: externalCapacityLimitedTargetCount,
                    expectedManagedOptionCount: externalExpectedManagedOptionCount,
                    actualManagedOptionCount: externalActualManagedOptionCount,
                });
                renderDiagnostics(diagnosticCount, diagnosticOptionWarning);
                renderImportPreview(showImportPreview, importPreviewItemCount);
                for (const details of document.querySelectorAll('#cmr_settings details')) {
                    details.open = openDetails;
                }
                document.getElementById('cmr_external_advanced').open = openAdvanced;
                document.getElementById('cmr_external_picker').open = openPicker;
            };

            document.getElementById('cmr_external_warning_open').addEventListener('click', () => {
                const operations = document.getElementById('cmr_operations_section');
                const advanced = document.getElementById('cmr_external_advanced');
                operations.open = true;
                advanced.open = true;
                const failedAction = advanced.querySelector('#cmr_external_list [data-cmr-external-action="exclude"]');
                (failedAction ?? document.getElementById('cmr_external_status') ?? advanced.querySelector('summary')).focus();
            });

            const dialog = document.getElementById('cmr_manager_dialog');
            const close = dialog.querySelector('.popup-button-close');
            function closeDialog() {
                if (dialog.open) dialog.close();
                dialog.remove();
            }
            close.addEventListener('click', closeDialog);
            close.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    closeDialog();
                }
            });
            dialog.addEventListener('cancel', event => {
                event.preventDefault();
                closeDialog();
            });
            globalThis.setUiRegressionState();
            dialog.showModal();
        })();
    `;
}

function buildFixture(settingsHtml) {
    return `<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Custom Model Router 실제 UI 회귀 검사</title>
    <link rel="stylesheet" href="/st/webfonts/NotoSans/stylesheet.css">
    <link rel="stylesheet" href="/st/webfonts/NotoSansMono/stylesheet.css">
    <link rel="stylesheet" href="/st/css/fontawesome.min.css">
    <link rel="stylesheet" href="/st/css/solid.min.css">
    <link data-st-core-css rel="stylesheet" href="/st/style.css">
    <link data-st-popup-css rel="stylesheet" href="/st/css/popup.css">
    <link data-cmr-css rel="stylesheet" href="/cmr/style.css">
</head>
<body>
    <dialog
        id="cmr_manager_dialog"
        class="popup wider_dialogue_popup vertical_scrolling_dialogue_popup left_aligned_dialogue_popup popup--animation-none cmr-manager-dialog"
        aria-labelledby="cmr_panel_title"
    >
        <div class="popup-body">
            <div class="popup-content" data-settings-source="settings.html">
                ${settingsHtml}
            </div>
        </div>
        <div
            class="popup-button-close right_menu_button fa-solid fa-circle-xmark"
            role="button"
            tabindex="0"
            title="닫기"
            aria-label="모델 관리 닫기"
        ></div>
    </dialog>
    <script>${fixtureScript()}</script>
</body>
</html>`;
}

function safePublicPath(publicRoot, pathname) {
    const decoded = decodeURIComponent(pathname).replace(/^\/+/, '');
    const candidate = resolve(publicRoot, decoded);
    if (candidate !== publicRoot && !candidate.startsWith(publicRoot + sep)) {
        return null;
    }
    return candidate;
}

async function sendFile(response, path) {
    try {
        const body = await readFile(path);
        response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        });
        response.end(body);
    } catch {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
    }
}

export async function startUiRegressionServer() {
    const sillyTavernRoot = await findSillyTavernRoot();
    const sillyTavernPublic = resolve(sillyTavernRoot, 'public');
    const settingsHtml = await readFile(resolve(REPOSITORY_ROOT, 'settings.html'), 'utf8');
    const fixtureHtml = buildFixture(settingsHtml);

    const server = createServer(async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/ui-regression') {
            response.writeHead(200, {
                'cache-control': 'no-store',
                'content-type': 'text/html; charset=utf-8',
            });
            response.end(fixtureHtml);
            return;
        }
        if (url.pathname === '/cmr/style.css') {
            await sendFile(response, resolve(REPOSITORY_ROOT, 'style.css'));
            return;
        }

        const stPath = url.pathname.startsWith('/st/')
            ? url.pathname.slice('/st/'.length)
            : url.pathname;
        const publicPath = safePublicPath(sillyTavernPublic, stPath);
        if (!publicPath) {
            response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Forbidden');
            return;
        }
        await sendFile(response, publicPath);
    });

    await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('UI 회귀 검사 서버 주소를 확인하지 못했습니다.');
    }

    return Object.freeze({
        url: `http://127.0.0.1:${address.port}/ui-regression`,
        sillyTavernRoot,
        close: () => new Promise((resolveClose, reject) => {
            server.close(error => error ? reject(error) : resolveClose());
        }),
    });
}
