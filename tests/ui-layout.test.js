import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT_URL = new URL('../', import.meta.url);

async function readText(path) {
    return readFile(new URL(path, ROOT_URL), 'utf8');
}

test('관리 패널은 모델 등록과 추가 기능을 카드 계층으로 구분하고 일반 사용자용 설명을 제공한다', async () => {
    const html = await readText('settings.html');

    assert.match(html, /cmr-primary-section/);
    assert.match(html, /제공업체에 모델 추가/);
    assert.match(html, /다른 확장에서도 모델 사용/);
    assert.match(html, /기능별 모델 지정/);
    assert.match(html, /문제 확인 및 설정 백업/);
    for (const state of ['자동으로 연결됨', '직접 지정', '설정 필요', '연결 안 함']) {
        assert.match(html, new RegExp(state));
    }
    assert.match(html, /채팅 모델이 아닌 임베딩·음성·이미지 생성용 입력란은 변경하지 않습니다/);
    assert.match(html, /<button id="cmr_import_backup_button"[^>]*>백업 불러오기<\/button>/);
    assert.match(html, /<input id="cmr_import_backup"[^>]*type="file"[^>]*hidden[^>]*tabindex="-1"/);
    assert.match(html, /기존 번역·요약 확장에 자동 적용되지는 않으며/);
    assert.match(html, /다른 확장 연결 설정만 저장하며/);
    assert.match(html, /문제 해결용 정보|연결 상태 설명 보기/);
    assert.doesNotMatch(html, />자동<\/button>|>제외<\/button>|>진단 실행<\/button>/);
});

test('액션 버튼은 SillyTavern의 min-content 너비를 덮고 좁은 화면에서도 가로 정렬을 유지한다', async () => {
    const css = await readText('style.css');

    assert.match(css, /\.cmr-action-grid\s*>\s*\.menu_button[\s\S]*?inline-size:\s*100%;/);
    assert.match(css, /\.cmr-action-grid\s*>\s*\.menu_button[\s\S]*?min-width:\s*0;/);
    assert.match(css, /\.cmr-action-grid\s*>\s*\.menu_button[\s\S]*?white-space:\s*nowrap;/);
    assert.match(css, /\.cmr-route-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(css, /\.cmr-operation-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.doesNotMatch(css, /\.cmr-external-actions[\s\S]{0,500}flex:\s*1\s+1\s+100%/);
    assert.match(css, /\.cmr-primary-section\s*\{[\s\S]*?padding:\s*0\.9rem;/);
    assert.match(css, /\.cmr-tool-body\s*\{[\s\S]*?gap:\s*0\.8rem;[\s\S]*?padding:\s*0\.85rem;/);
    assert.match(css, /@container\s*\(max-width:\s*300px\)[\s\S]*?\.cmr-route-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(css, /@container\s*\(max-width:\s*300px\)[\s\S]*?\.cmr-route-actions\s+\.menu_button:last-child\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
    assert.match(css, /\.cmr-model-badges\s+\.cmr-badge:not\(\[data-kind="selected"\]\)/);
    assert.doesNotMatch(css, /\.cmr-tool-section\s*\{\s*overflow:\s*clip;/);
});

test('외부 확장 연결은 여러 개의 모호한 버튼 대신 한 개의 연결 방식 선택 메뉴를 사용한다', async () => {
    const source = await readText('index.js');

    assert.match(source, /dataset\.cmrExternalMode\s*=\s*'true'/);
    assert.match(source, /자동으로 찾기 \(권장\)/);
    assert.match(source, /제공업체 직접 지정/);
    assert.match(source, /이 입력란에서는 연결 안 함/);
    assert.match(source, /function onExternalModeChange/);
    assert.doesNotMatch(source, /data-cmr-external-action|cmrExternalAction|function onExternalListClick/);
});
