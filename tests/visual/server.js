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

            const providerSelect = document.getElementById('cmr_provider');
            for (const provider of providers) {
                const option = document.createElement('option');
                option.value = provider.id;
                option.textContent = provider.label;
                providerSelect.append(option);
            }

            function modelId(index) {
                if (index === 0) {
                    return 'gemini-' + 'very-long-model-identifier-'.repeat(12) + 'preview';
                }
                const prefixes = ['gemini-future', 'router/future-model', 'glm-future'];
                return prefixes[index % prefixes.length] + '-' + String(index + 1).padStart(3, '0');
            }

            function renderModels(total) {
                const list = document.getElementById('cmr_model_list');
                const count = document.getElementById('cmr_model_count');
                const groups = providers.map(provider => ({ provider, models: [] }));
                for (let index = 0; index < total; index += 1) {
                    groups[index % groups.length].models.push(modelId(index));
                }

                const populated = groups.filter(group => group.models.length).length;
                count.textContent = '제공업체 ' + populated + '곳 · 모델 ' + total + '개';
                list.dataset.scrollable = String(total > 6);
                if (total > 6) {
                    list.tabIndex = 0;
                    list.setAttribute('aria-label', '등록 모델 ' + total + '개. 스크롤하여 모두 확인할 수 있습니다.');
                } else {
                    list.removeAttribute('tabindex');
                    list.removeAttribute('aria-label');
                }
                list.replaceChildren();

                if (total === 0) {
                    const empty = document.createElement('li');
                    empty.className = 'cmr-empty';
                    empty.textContent = '등록한 모델이 없습니다.';
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
                    for (const id of groupData.models) {
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

            function renderExternal(total) {
                const list = document.getElementById('cmr_external_list');
                const count = document.getElementById('cmr_external_count');
                const status = document.getElementById('cmr_external_status');
                count.textContent = '연결 대상 ' + total + '개 · 연결 ' + total + '개';
                status.dataset.state = 'ok';
                status.textContent = total + '개 모델 칸에 등록 모델을 직접 연결했습니다.';
                list.replaceChildren();

                if (total === 0) {
                    const empty = document.createElement('li');
                    empty.className = 'cmr-empty';
                    empty.textContent = '연결할 수 있는 다른 확장의 Chat Completion 모델 칸을 찾지 못했습니다.';
                    list.append(empty);
                    return;
                }

                for (let index = 0; index < total; index += 1) {
                    const row = document.createElement('li');
                    row.className = 'cmr-model-row cmr-external-row';
                    row.dataset.targetId = 'fixture-target-' + index;
                    const summary = document.createElement('div');
                    summary.className = 'cmr-model-summary';
                    const heading = document.createElement('span');
                    heading.className = 'cmr-external-heading';
                    const name = document.createElement('strong');
                    name.className = 'cmr-external-name';
                    name.textContent = index === 0
                        ? '공백없이아주긴외부확장모델선택기이름'.repeat(8)
                        : '외부 확장 Chat Completion 모델 ' + (index + 1);
                    const description = document.createElement('small');
                    description.className = 'cmr-sentence-text';
                    description.textContent = '등록된 모든 제공업체 모델을 직접 표시합니다.';
                    heading.append(name, document.createElement('br'), description);
                    summary.append(heading);
                    row.append(summary);
                    list.append(row);
                }
            }

            function renderDiagnostics(total) {
                const list = document.getElementById('cmr_diagnostic_list');
                const summary = document.getElementById('cmr_diagnostic_summary');
                summary.dataset.state = 'ok';
                summary.textContent = total
                    ? '호환성 진단 예시 결과입니다.'
                    : '진단을 실행하면 버전·이벤트·모델 컨트롤·중복 자원을 확인합니다.';
                list.replaceChildren();
                for (let index = 0; index < total; index += 1) {
                    const item = document.createElement('li');
                    item.dataset.status = index === total - 1 ? 'warning' : 'passed';
                    item.textContent = (index === total - 1 ? '주의' : '통과')
                        + ' · 실제 Chromium 배치 검사용 진단 항목 ' + (index + 1) + '입니다.';
                    list.append(item);
                }
            }

            globalThis.setUiRegressionState = ({
                modelCount = 0,
                externalCount = 0,
                diagnosticCount = 0,
                openDetails = false,
            } = {}) => {
                renderModels(modelCount);
                renderExternal(externalCount);
                renderDiagnostics(diagnosticCount);
                for (const details of document.querySelectorAll('#cmr_settings details')) {
                    details.open = openDetails;
                }
            };

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
