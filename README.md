# Custom Model Router

SillyTavern 코어 파일을 수정하지 않고 기존 Chat Completion 연결에 사용자 모델 ID를 등록하는 UI 확장입니다. 관리 팝업의 기본 목록은 등록한 모든 모델을 제공업체별로 보여주며, 실제 모델은 SillyTavern의 기존 모델 선택기 또는 입력란에서 선택합니다. 범용 외부 확장 브리지는 안전하게 감지한 모델 컨트롤에 native option과 중복되지 않는 등록 모델을 target별 최대 512개까지 제공업체별로 자동 추가합니다. 공개 provider hook에 명시적으로 opt-in한 외부 확장은 선택된 SillyTavern Connection Manager 프로필을 CMR 요청 handler로 상속할 수 있고, hook이 없어도 이미 존재하는 명확한 Custom/OpenAI-compatible 또는 SillyTavern 현재 연결 provider option에는 그 option 의미에 맞는 Registry 모델만 투영합니다. 실제 handler 사용 여부는 별도로 확인해야 합니다.

현재 버전은 **v0.6.16**이며, SillyTavern 1.18.0의 등록 가능한 Chat Completion 연결 24개, 공개 Registry API, Provider Integration API, 개발자 opt-in Routing API, 범용 DOM 모델 브리지, 호환성 진단과 비밀정보를 제외한 CMR 설정 백업·복구를 제공합니다. v0.6.16은 SillyTavern 공식 Popup 닫기 컨트롤 하나를 유지하면서 CMR 관리 팝업 안쪽 우측 상단에 배치해 앱 툴바와 좁은 화면 경계에 걸리지 않도록 수정합니다. v0.6.15의 hookless native 재사용은 그대로 유지되어, 정확한 Custom/OpenAI-compatible 선택에는 `custom` Registry 모델만, 정확한 SillyTavern 현재 연결 후보에는 현재 활성 SillyTavern provider의 Registry 모델만 표시합니다. provider option·값, endpoint·API 키, 전역 `fetch`, 메인 Chat Completion 설정은 바꾸지 않으며 실제 handler와 요청 반영은 사용자가 직접 확인해야 합니다. 공개 hook 기반 v0.6.14 연동도 이 경로와 별도로 유지됩니다.

v0.5.0까지의 공개 API와 용도별 라우팅은 다른 확장이 스스로 연동해야 사용할 수 있었으며, 이미 설치된 다른 확장의 모델 선택기에 CMR 모델을 자동 표시하지는 않았습니다. v0.6.0은 이 누락을 보완해 표준 `select`, 텍스트 `input`, `datalist` 기반 Chat Completion 모델 컨트롤을 탐지했습니다. v0.6.6부터 대상별 모드 선택 없이, 감지된 안전한 Chat Completion 모델 컨트롤에 native 중복을 제외한 Registry 모델을 target별 512개 한도 내에서 제공업체별로 표시합니다.

## 현재 진행 상태

| 항목 | 상태 |
|---|---|
| 현재 릴리스 | `v0.6.16` |
| v0.3 공개 Registry API | ✅ API `1.2.0` 구현·자동 검사 완료 |
| v0.4 용도별 라우팅 | ✅ 구현·자동 검사 완료 |
| v0.5 진단·복구·안정성 계측 | ✅ 구현·자동 검사 완료 |
| v0.6 범용 DOM 모델 브리지 | ✅ 구현·자동 검사 완료 |
| v0.6.14 공용 provider 연동 | ✅ Integration API `1.0.0`, handler→모델 게시 2단계 준비 계약 구현 |
| v0.6.15 hookless native 재사용 | ✅ 기존 provider option을 보존한 Custom·현재 연결 모델 projection 구현 |
| v0.6.16 Popup 닫기 배치 | ✅ SillyTavern 공식 닫기 하나를 CMR 팝업 안쪽 우측 상단에 배치 |
| DOM·공개 API 샌드박스 | ✅ 기본 24개와 외부 select/input/datalist, provider/source 선택기 보존·재렌더·정리 수명주기 통과 |
| Chromium UI 회귀 검사 | ✅ 실제 `settings.html`, SillyTavern 1.18.0 CSS와 native 재사용·공용 provider hook fixture 검사 15개 통과 |
| 실제 제공업체 계정 검증 | 🧪 사용자 환경별 확인 대기 |
| 사용자가 할 일 | [통합 사용자 체크리스트](./USER_CHECKLIST.md)를 한 번 순서대로 확인 |

진행 위치와 완료 근거는 [개발 로드맵](./ROADMAP.md)에서 계속 갱신합니다.

## 주요 기능

- 한 관리 팝업에서 24개 제공업체의 사용자 모델을 등록·삭제하고, 기본 목록에는 모든 등록 모델을 제공업체별로 표시합니다. 모델 등록은 접근 가능한 `+` 아이콘 버튼으로 실행합니다.
- Connection Profile 도구행에는 숫자 배지 없이 관리 아이콘 하나만 표시합니다. 스크린 리더용 이름에는 등록 모델 수와 지원 모델 컨트롤 감지 오류를 계속 제공합니다.
- 기본 화면에는 핵심 한 줄 안내만 두고, 제공업체·모델 ID·등록 목록·진단 및 백업·외부 연결의 세부 설명은 키보드와 터치로 열 수 있는 native popover 정보 아이콘 다섯 곳에서 확인합니다.
- 등록 모델이 12개를 넘을 때만 제공업체 이름·ID·모델 ID 검색을 표시합니다. 하나의 모델 ID 입력란에 한 줄만 쓰거나, 모델 ID를 한 줄에 하나씩 최대 200개까지 입력할 수 있습니다. 한 줄이라도 형식이 잘못되면 전체 묶음을 적용하지 않습니다.
- 모델을 삭제하면 즉시 **실행 취소**가 나타나 방금 삭제한 레코드를 복원할 수 있습니다.
- 제공업체 선택은 등록 폼에만 적용되며 아래의 전체 등록 목록을 필터링하지 않습니다.
- 등록 모델을 SillyTavern 기본 모델 선택기의 `사용자 모델` 그룹에 표시합니다.
- 실제 모델 선택은 SillyTavern의 기존 모델 선택기 또는 입력란에서 수행합니다.
- 정상적인 외부 모델 연결 목록은 숨기고, 선택지 주입 실패, observer·binding 런타임 불일치 또는 외부 CMR option 용량·성능 주의가 있을 때만 관리 팝업에 경고 카드를 표시합니다.
- 다른 확장의 표준 Chat Completion 모델 컨트롤을 자동 탐지해 native 중복을 제외한 Registry 모델을 target별 최대 512개까지 제공업체별 그룹으로 추가합니다.
- 외부 provider/source 선택기는 이름에 `model`이 포함되어도 모델 target으로 세지 않고 CMR option을 넣지 않습니다. native provider option과 현재 값은 보존하며 실제 모델 control의 metadata·변경 감시에만 사용합니다.
- hook 없는 외부 확장의 기존 provider 선택이 정확한 Custom/OpenAI-compatible이면 `custom` 모델만, 정확한 SillyTavern 현재 연결 후보이면 현재 활성 SillyTavern provider 모델만 실제 model control에 투영합니다. `main`, `current`, `inherit`, `openai`, `st` 같은 단독·모호한 표식은 이 특화 경로로 분류하지 않습니다.
- 진단은 native Custom·현재 연결 대상, 실제 projection과 현재 연결 확인 불가 개수를 별도 집계하되 provider option 원문·endpoint·API 키는 복제하지 않습니다.
- 같은 외부 확장 영역에서 provider 후보가 여러 개면 첫 후보를 임의로 모델 control에 연결하지 않습니다.
- 진단 섹션의 **고급: 외부 연결 관리**는 연결 실패와 사용자 제외만 기본 목록에 표시합니다. 정상 연결은 **문제가 생긴 모델 칸 제외**를 명시적으로 펼쳤을 때만 고를 수 있고, 비채팅 위험 대상은 진단 개수에만 포함됩니다.
- 같은 확장 영역에 이름·라벨이 같은 모델 컨트롤이 여러 개 있어도 live DOM 객체와 안정된 구조 표식을 이용해 고유 target으로 구분하고 선택을 독립적으로 보존합니다.
- 대상별 자동·직접·연결 안 함 선택과 수동 새로고침 버튼은 제공하지 않습니다. 외부 화면 변경은 MutationObserver로 자동 반영합니다.
- Vectors·embedding·TTS·이미지 생성처럼 채팅 모델이 아니거나 호환되지 않는 대상과 민감 설정 입력란은 자동 주입 후보에서 제외합니다.
- 외부 확장이 선택기를 다시 렌더링하면 CMR 옵션을 다시 추가하고, 동일 target의 새 컨트롤 값이 비어 있을 때만 마지막 CMR 선택을 provider 식별자와 함께 복원합니다. 외부 확장이 둔 유효한 현재값은 덮어쓰지 않습니다.
- 원격 모델 목록 재생성, source 변경, 새로고침과 Connection Profile 전환 뒤 옵션과 선택을 복원합니다.
- v0.1의 Vertex 설정을 제공업체별 schema v2로 자동 이관합니다.
- `globalThis.CustomModelRouter`로 다른 확장에 읽기 전용 Registry 스냅샷, mutation, 이벤트와 용도별 라우팅 API를 제공합니다.
- `CustomModelRouter.integrations`에 opt-in한 외부 확장에는 선택된 Connection Manager 프로필 기반의 provider 요청 handler와 해당 provider의 활성 Registry 모델만 제공합니다.
- 공용 provider 연동은 handler 설치 확인 뒤 모델 게시를 요청하고, 두 영수증이 모두 유효할 때만 준비 상태가 됩니다. 실패·취소·비활성화 시 확보한 handler와 모델 게시 자원을 정리하며 다른 provider나 메인 모델로 자동 대체하지 않습니다.
- 공개 API도 SillyTavern `select`에서 현재 사용 중인 custom-only 모델은 `model_in_use`로 등록 해제를 거부하고, native 모델로 전환한 뒤에만 삭제합니다.
- 개발자 opt-in Routing API는 Registry의 `(provider, model ID)`와 같은 제공업체의 Connection Profile을 직접 연결합니다. 일반 사용자용 라우팅 설정 UI는 제공하지 않습니다.
- 보조 요청은 메인 채팅 source·모델을 바꾸지 않고 Connection Profile의 인증과 endpoint를 재사용합니다.
- SillyTavern 버전, 공개 context, 제공업체 컨트롤과 런타임 자원 누적을 구조화된 진단으로 확인합니다.
- Registry, 개발자용 용도별 경로, 외부 컨트롤의 마지막 CMR 선택·provider 식별자와 schema v2 사용자 제외를 portable schema v2 JSON으로 내보냅니다. 가져오기는 형식·스키마·허용 필드를 검사한 뒤 추가·충돌·삭제 내역을 미리 보여주며, 사용자가 **변경 적용**을 눌러야 설정을 바꿉니다.
- 설정 복구와 진단은 제거·병합·정규화한 항목의 사유 코드, 범주와 개수를 표시합니다.
- 삭제된 모델·프로필, 제공업체 불일치와 미등록 어댑터는 다른 모델로 대체하지 않고 명시적으로 중단합니다.

## 지원 연결 24개

| 구분 | 연결 |
|---|---|
| 모델 개발사 API 14개 | OpenAI, Anthropic, AI21, Cohere, DeepSeek, Google AI Studio, Google Vertex AI, Groq, Mistral AI, MiniMax, Moonshot AI (Kimi), Perplexity, xAI, Z.AI (GLM) |
| 라우터·호스팅 9개 | AI/ML API, Chutes, Cloudflare Workers AI, ElectronHub, Fireworks AI, NanoGPT, OpenRouter, Pollinations, SiliconFlow |
| 사용자 지정 연결 1개 | Custom OpenAI-compatible |

GLM은 `Z.AI (GLM)`, Kimi는 `Moonshot AI (Kimi)` 연결에서 등록합니다. 별도 업체·지역 API 또는 사용자가 운영하는 OpenAI 호환 서버는 SillyTavern의 `Custom` 연결을 먼저 구성한 뒤 `Custom OpenAI-compatible`에서 모델 ID를 등록합니다.

다음 두 source는 구조상 등록 대상에서 제외합니다.

- **Azure OpenAI**: 실제 요청 대상은 모델 값이 아니라 deployment name으로 결정됩니다.
- **CometAPI**: SillyTavern 1.18.0 코어에서 해당 provider 요청이 비활성화되어 있습니다.

## 설치

1. SillyTavern에서 **Extensions → Install Extension**을 엽니다.
2. **Install Extension**에 다음 Git 저장소 URL을 입력합니다.

```text
https://github.com/p16481012/Custom-Model-Router
```

3. 설치가 끝나면 SillyTavern 페이지를 새로고침합니다.

`manifest.json`의 최소 버전은 SillyTavern `1.18.0`입니다. 이 버전은 자동 계약 검사 기준이며, 더 새로운 버전은 진단 결과를 확인한 뒤 사용해야 합니다.

## 모델 등록과 선택

1. **API Connections**에서 사용할 Chat Completion 제공업체의 인증·endpoint·리전을 먼저 설정합니다.
2. Connection Profile 도구행에서 숫자 배지 없이 표시되는 `사용자 모델 관리` 아이콘을 누릅니다.
3. 제공업체를 선택하고 모델 ID 입력란에 업체가 공개한 정확한 ID를 입력합니다. 하나만 입력해도 되고, 여러 ID라면 한 줄에 하나씩 최대 200개를 같은 입력란에 넣은 뒤 `+` 아이콘을 누릅니다. 각 정보 아이콘을 누르거나 키보드로 열면 화면을 채우지 않는 세부 도움말을 확인할 수 있습니다.
4. 전체 등록 모델 목록에서 제공업체별 등록 결과를 확인합니다. 등록 폼의 제공업체를 바꿔도 이 목록은 전체 상태를 유지합니다.
5. 모델이 12개를 넘으면 검색창에서 제공업체 이름·ID 또는 모델 ID로 목록을 좁힐 수 있습니다.
6. 관리 팝업을 닫고 SillyTavern의 기존 모델 선택기 또는 입력란에서 등록 모델을 선택합니다.
7. 일반 요청과 스트리밍 요청을 각각 확인합니다.

등록은 해당 source가 비활성 상태여도 가능합니다. 공용 입력란은 단일·여러 줄 입력에 같은 검증을 적용합니다. 빈 줄과 이미 등록된 중복은 건너뛰지만 유효하지 않은 줄이 하나라도 있으면 새 모델을 하나도 저장하지 않는 원자적 동작입니다. 관리 팝업의 등록 목록에는 제공업체 이름, 모델 ID와 작은 삭제 버튼이 있으며, 현재 사용 모델 상태는 표시하지 않습니다. 다만 백업에 포함된 `enabled:false` 레코드는 관리 불능 상태로 숨기지 않고 **비활성** 배지와 함께 표시해 검색·삭제할 수 있습니다. 모델이 6개를 넘으면 목록 영역만 스크롤되고 스크롤바는 보이지 않지만 휠·터치·키보드 스크롤은 그대로 동작합니다. 삭제 직후에는 실행 취소로 방금 지운 레코드를 복원할 수 있습니다. 실제 선택 상태는 SillyTavern의 기존 컨트롤을 기준으로 합니다.

### Z.AI GLM 예

1. API Connections에서 `Z.AI`를 선택합니다.
2. 기존 UI에서 Common 또는 Coding endpoint와 API 키를 설정합니다.
3. 관리 팝업의 `Z.AI (GLM)`에서 정확한 `glm-...` ID를 등록합니다.
4. SillyTavern의 Z.AI 모델 선택기에서 등록한 ID를 선택합니다.
5. 일반·스트리밍 요청과 새로고침 뒤 복원을 확인합니다.

확장은 endpoint 종류와 API 키를 바꾸지 않습니다.

## 모델 ID 규칙

- Google AI Studio와 Vertex AI: 영문자·숫자로 시작하고 `.`, `_`, `-`를 허용하며 최대 128자입니다.
- 단일 ID형 연결: 영문자·숫자로 시작하고 `.`, `_`, `:`, `+`, `-`를 허용하며 최대 128자입니다.
- 계층형 카탈로그와 Custom: `/`, `:`, `+`, `@`를 포함할 수 있으며 최대 256자입니다.
- 모든 연결에서 URL, 공백, 제어문자, `?`, `#`, `%`, 역슬래시와 HTML 구분자는 거부합니다.

형식 검사는 모델의 존재, 계정 권한 또는 현재 요청 규격과의 호환을 보증하지 않습니다.

## 공개 API

Registry API 계약은 `1.2.0`, Provider Integration API 계약은 `1.0.0`, Routing API 계약은 `1.0.0`입니다. Registry `1.2.0`은 `integrations`를 추가한 하위 호환 minor 갱신이며 기존 Routing API의 호출 계약은 바뀌지 않았습니다. 내부 `src` 파일을 직접 import하지 말고 확장 초기화 뒤 전역 객체를 사용합니다.

```js
const registry = globalThis.CustomModelRouter;

if (!registry?.isCompatible('1.2.0')) {
    throw new Error('Custom Model Router Registry API 1.2.0이 필요합니다.');
}

const glmModels = registry.listModels('zai');
const unsubscribe = registry.subscribe('registry:changed', event => {
    console.log(event.revision, event.snapshot.models);
});
```

`selectModel()`은 Registry 선택 상태만 변경하며 SillyTavern의 현재 source나 메인 모델을 전환하지 않습니다. `unregisterModel()`은 SillyTavern `select`형 연결에서 현재 값인 custom-only 모델을 지우려 하면 `model_in_use`를 내며, 기존 native 모델로 전환한 뒤에는 정상적으로 등록 해제합니다. 전체 계약은 [공개 API 문서](./API.md), 예제는 [Registry 연동](./examples/registry-integration.js)과 [라우팅 연동](./examples/routing-integration.js)을 참고하세요.

### 공용 provider 연동

`CustomModelRouter.integrations`는 외부 확장이 자신의 공개 provider registry 또는 hook을 CMR에 명시적으로 등록할 때만 동작합니다. 지원 경계는 다음 세 가지입니다.

1. **SillyTavern 연결 상속**: 현재 선택된 Connection Manager 프로필이 Chat Completion 프로필이고 그 source가 CMR Registry provider와 일치할 때, 해당 프로필의 인증·endpoint를 그대로 사용하는 `sillytavern-inherited` handler를 준비합니다. `Custom` source는 이 경로에서 제외합니다.
2. **OpenAI-compatible 특화**: 현재 선택된 프로필이 SillyTavern `Custom` source일 때만 `openai-compatible` handler와 `custom` Registry 모델을 준비합니다.
3. **공개 provider registry/hook**: 외부 확장이 Integration API `1.0.0`의 capability와 slot을 선언하고 `installHandler`·`publishModels` hook을 제공하면 CMR이 위 공용 handler와 모델을 그 확장에 전달합니다.

CMR은 `installHandler`가 유효한 handler 영수증을 반환한 뒤에만 `publishModels`를 호출합니다. 모델 게시 영수증까지 유효해야 binding이 `ready`가 되며, 그 전에는 전달된 `execute`도 요청을 받지 않습니다. 외부 확장은 CMR이 소유하는 provider UI 루트에 API가 알려 준 `data-cmr-provider-hook-owned` 표식을 적용해 기존 DOM 모델 브리지의 중복 주입을 피해야 합니다.

이 계약은 임의의 외부 확장 내부 배열이나 비공개 handler를 추측해 수정하지 않습니다. 공개 hook이 없거나 계약·capability가 맞지 않는 확장의 provider UI는 그대로 두며 새 provider를 강제로 추가하지 않습니다. 다만 기존 v0.6 DOM 모델 브리지는 독립적으로 계속 동작하므로 안전하게 감지한 표준 모델 `select`/`input`/`datalist`에는 기존과 같이 CMR 모델 선택지를 표시할 수 있습니다. API 키와 endpoint는 CMR 설정·이벤트·진단으로 복제하지 않고 선택된 Connection Manager 프로필이 계속 소유합니다.

### Hook 없는 native provider option 재사용

v0.6.15의 native 재사용은 Provider Integration API의 요청 handler 연동이 아니라 기존 DOM 모델 브리지의 보수적인 **모델 projection**입니다. 외부 확장이 이미 가진 provider option을 선택한 상태에서만 실제 model control의 CMR 후보를 다음과 같이 제한합니다.

- 정확한 Custom/OpenAI-compatible 선택: `custom` Registry 모델만 투영
- 정확한 SillyTavern/current-connection 선택: 현재 활성 SillyTavern provider의 Registry 모델만 투영

이 과정은 provider option을 만들거나 지우지 않고 선택된 option과 provider control 값을 그대로 둡니다. endpoint·API 키를 읽거나 복제하지 않고, 전역 `fetch`·`XMLHttpRequest`, 외부 확장의 요청 함수와 SillyTavern 메인 source·모델을 patch하거나 전환하지 않습니다. `main`, `current`, `inherit`, `openai`, `st` 같은 단독 토큰과 서로 충돌하는 표식은 의미를 추측하지 않으며, 일반 DOM 브리지의 안전 판정이 별도로 성립할 때만 기존 best-effort 선택지 주입을 유지합니다. 정확한 SillyTavern 현재 연결 option이지만 활성 ST provider가 없거나 지원 provider로 확정되지 않으면 현재 연결 후보라는 분류는 유지하되 `current-connection-unavailable`로 실패하고 모델을 하나도 넣지 않습니다. 이때 전체 provider나 Custom 모델로 fallback하지 않으므로 현재 ST 연결을 확인해야 합니다. 외부 확장이 그 native option을 실제 요청 handler와 어떻게 연결했는지는 DOM만으로 검증할 수 없으므로, 모델을 선택한 뒤 해당 기능을 실행하고 Network payload 또는 확장의 공개 결과에서 정확한 `model`을 직접 확인해야 합니다.

## 다른 확장 모델 연결

범용 브리지는 페이지에 나타난 표준 Chat Completion 모델 `select`, 텍스트 `input`, `datalist`를 자동 탐지합니다. 감지된 안전한 대상에는 별도 설정 없이 native option과 중복되지 않는 Registry 모델을 target별 최대 512개까지 제공업체별 `사용자 모델` 그룹으로 추가하고, 외부 화면 변경도 자동 감지합니다. 정상 상태에서는 관리 팝업에 외부 대상 목록이나 연결 설정을 표시하지 않습니다.

외부 확장이 provider와 model control을 분리하고 기존 provider option이 명확한 native 재사용 계약에 해당하면 전체 provider 목록을 무조건 넣지 않습니다. Custom/OpenAI-compatible 선택은 Custom Registry 모델로, SillyTavern 현재 연결 선택은 현재 활성 ST provider 모델로 후보를 제한합니다. exact 현재 연결인데 활성 ST provider를 확정할 수 없으면 확인 필요 실패로 남기고 다른 provider 모델을 넣지 않습니다. 이는 외부 확장의 기존 handler를 재사용할 가능성이 있는 모델 선택지만 보여 주는 동작이며, 새 provider·handler·endpoint·credential 지원을 추가하거나 요청 성공을 인증하는 기능이 아닙니다.

선택지 주입 실패, observer·binding 런타임 불일치 또는 외부 선택지 과다 상태가 감지될 때만 **외부 모델 연결을 확인해 주세요** 경고 카드가 나타납니다. 경고 카드의 설정 아이콘을 누르면 **호환성 진단 및 CMR 설정 백업 → 고급: 외부 연결 관리**가 열립니다. 고급 메뉴의 기본 목록은 실패 대상과 사용자가 제외한 대상만 표시합니다. 정상 연결은 문제 target을 제외하려고 **문제가 생긴 모델 칸 제외**를 직접 펼쳤을 때만 선택기에 나타납니다.

- **선택지 연결됨**: 명시적으로 펼친 제외 대상 선택기에서 CMR 모델 선택지를 주입한 정상 대상을 뜻합니다.
- **실제 요청 확인 필요**: 선택지가 보인다는 뜻일 뿐, 외부 확장의 요청 본문에 그 모델이 사용되었다는 검증은 아닙니다.
- **연결 제외**: 사용자가 해당 target을 CMR 주입 대상에서 제외했습니다. 다시 연결 아이콘으로 복구할 수 있습니다.
- **안전상 제외**: 비채팅·비호환 또는 민감 설정으로 판별되어 브리지가 변경하지 않은 대상입니다. 기본 목록과 제외 대상 선택기에 행을 만들지 않고 진단에서 사유별 개수만 집계하며 강제로 연결하지 않습니다.

사용자 제외는 정상 대상의 기본 동작이 아니라 문제 target을 위한 고급 예외 설정입니다. 제외하거나 복구해도 외부 확장의 native option·현재 입력값·API 설정은 삭제하지 않습니다. 새로고침 버튼이나 자동·직접·연결 안 함 모드 선택기는 제공하지 않습니다. Vectors의 여러 벡터화 모델 칸처럼 안전상 제외된 대상은 관리 UI를 채우지 않으므로, 제외 개수와 사유는 진단 복사 JSON에서 확인합니다.

Caption처럼 provider 선택기와 model 선택기, option의 `data-type`을 사용하는 확장은 provider/source 선택기를 모델 target이 아닌 metadata·변경 감시 control로만 사용합니다. provider 선택기의 이름에 `model`이 포함되어도 CMR option을 넣지 않으며 기존 native option과 현재 값을 보존합니다. 연결 가능한 provider 후보가 같은 영역에 여러 개면 첫 후보를 임의로 고르지 않습니다. 실제 model control에 추가하는 CMR option에는 확인된 외부 provider 값을 보존하므로 외부 확장의 자체 제공업체 필터가 동작할 수 있습니다.

v0.6.9에서 도입한 외부 연결 저장 schema v2는 target별 마지막 provider 모델 선택과 사용자가 명시한 `excludedTargets`만 보존합니다. schema v1과 v0.6.0~v0.6.5의 provider 고정·`manual`·`disabled` mapping은 읽은 뒤 폐기하며, 과거 `disabled`를 새 사용자 제외로 되살리지 않습니다. 정상 `selectedModels`는 보존되어 동일 target 재렌더 복구에 사용됩니다.

외부 확장이 모델 컨트롤을 다시 만들면 CMR 옵션을 다시 추가합니다. 저장된 마지막 CMR 선택은 동일 target으로 다시 감지된 새 컨트롤의 값이 비어 있을 때만 provider 식별자와 함께 복원하고, 외부 확장이 이미 설정한 유효한 현재값은 덮어쓰지 않습니다. 외부 확장 업데이트로 control의 ID·name·label 또는 상위 확장 구조가 바뀌면 새 target으로 인식될 수 있습니다. 동일한 ID·name·label·구조를 가진 여러 live 컨트롤은 같은 DOM 객체가 재정렬되어도 구분하지만, 외부 확장이 모두 새 객체로 만들면서 순서까지 뒤집으면 이전 target과 새 컨트롤을 대응할 안정 표식이 없어 선택 복원을 보장할 수 없습니다.

이 브리지는 외부 확장의 기존 선택 이벤트와 저장 경로를 사용하는 best-effort **UI 선택지 주입** 기능입니다. 전역 `fetch`나 `XMLHttpRequest`를 교체하지 않고, API 키·endpoint 또는 외부 확장의 요청 본문을 직접 읽거나 덮어쓰지 않습니다. 따라서 **선택지 연결됨**은 실제 요청 호환성 판정이 아닙니다. 실제 반영 여부는 해당 확장이 표준 컨트롤의 `input` 또는 `change` 이벤트로 모델을 저장하는지에 달려 있으며, 기능을 한 번 실행한 뒤 Network 요청의 `model` 값으로 최종 확인해야 합니다.

다음은 자동 주입 대상에서 제외합니다.

- 외부 확장의 provider/source 선택기. 모델 target과 진단 `targetCount`에 포함하지 않고 metadata·변경 감시에만 사용합니다.
- Vectors·embedding·rerank 모델
- TTS·음성 합성 모델
- Stable Diffusion·이미지 생성 모델
- endpoint·URL·API 키·deployment·account·project·region 같은 민감 설정 입력란
- React 등에서 표준 컨트롤을 노출하지 않는 사용자 위젯, iframe 내부, 닫힌 Shadow DOM

표준 모델 컨트롤이 없거나 자체 위젯만 사용하는 확장은 CMR의 Registry, Provider Integration 또는 Routing API를 사용하는 opt-in 연동이 필요합니다. 공개 provider hook이 없는 확장에는 CMR이 provider handler나 provider UI를 강제로 삽입하지 않습니다. 탐지와 비대상 판별은 DOM의 이름·레이블·속성·상위 확장 표식을 사용하는 best-effort 호환 기능이며 모든 외부 확장의 요청 규격을 보증하지 않습니다.

외부 모델 칸 하나에 주입하는 CMR 선택지는 최대 512개입니다. 각 target에서 native option과 중복되는 항목을 제외한 뒤 표시 가능한 CMR 후보가 512개를 넘으면 그 target에는 일부만 표시된다는 용량 경고를 냅니다. 모든 직접 연결 target의 예상 CMR option 합계 또는 실제 CMR option 합계가 2,048개를 넘으면 브라우저 성능 저하 가능성을 별도 경고합니다. 위험 분류로 제외한 Vectors·Stable Diffusion 등의 컨트롤은 이 option 계산에 포함하지 않습니다.

### 검증 상태별 외부 확장 목록

아래 표의 자동 검증은 DOM 선택지 주입 계약 또는 안전 제외 규칙만 뜻합니다. 실제 외부 확장의 API 호환 인증 목록이 아닙니다.

| 외부 확장·기능 | 저장소에서 자동 검증한 범위 | 실제 요청 상태 |
|---|---|---|
| Caption | 실제 1.18.0 `.caption_settings` 경계와 `caption_multimodal_api`/`caption_multimodal_model`, native option·값 보존, Custom exact projection, option `data-type` metadata, 선택 이벤트와 재렌더 복원 | `/caption-image` handler가 Custom 모델을 실제 사용하는지, payload의 `model` 및 계정·모델 멀티모달 호환은 사용자 확인 대기 |
| Vectors | embedding·벡터화 모델 컨트롤을 비채팅 위험 대상으로 분류하고 CMR option을 주입하지 않으며 진단 개수에만 포함 | 안전 제외 검증만 완료; Chat Completion API 호환 대상으로 인증하지 않음 |
| Stable Diffusion | 이미지 생성 모델 컨트롤을 위험 대상으로 분류하고 CMR option을 주입하지 않으며 진단 개수에만 포함 | 안전 제외 검증만 완료; 이미지 생성 API 호환 대상으로 인증하지 않음 |

## 용도별 보조 요청 라우팅

용도별 라우팅은 다른 확장 또는 개발자가 명시적으로 사용하는 opt-in API입니다. v0.6.3부터 일반 관리 팝업에는 라우팅 설정·해제·시험 UI가 없지만, 기존 route 저장값, Routing API, Connection Profile 어댑터와 portable backup 계약은 유지합니다. 저장 경로에는 provider·model ID·adapter ID·profile ID만 들어가며 프로필 본문이나 인증정보는 복제하지 않습니다.

```js
const result = await CustomModelRouter.routing.execute('translation', {
    prompt: 'Translate this sentence into Korean.',
    maxTokens: 256,
});

console.log(result.content);
```

기본 어댑터는 SillyTavern `ConnectionManagerRequestService`를 사용하고 요청의 `model`만 등록 ID로 지정합니다. route provider와 profile source가 정확히 일치해야 하며, 현재 연결이나 메인 모델로 무음 대체하지 않습니다.

## 호환성 진단

관리 팝업에서 **호환성 진단 및 CMR 설정 백업 → 진단 실행**을 누르면 다음을 확인합니다.

- SillyTavern 최소·검증 기준 버전
- 공개 context와 이벤트 계약
- 24개 provider 컨트롤과 런타임 바인딩 상태
- 외부 모델 컨트롤의 연결 정책·사용자 제외·비채팅·비호환 제외 개수와 bridge 상태. metadata 감시용 provider/source 선택기는 `targetCount`에서 제외합니다.
- 런처, MutationObserver, 이벤트 구독과 사용자 모델 그룹 중복
- source·profile 전환 표본에서 자원이 증가하는지 여부

안정성 전환 표본이 2개보다 적으면 오류나 주의가 아니라 **계측 대기**로 표시합니다. source 또는 Connection Profile을 전환해 표본이 2개 이상 모인 뒤부터 자원 증가 여부를 판정합니다. 외부 모델 칸 진단은 provider/source 선택기를 후보에서 제외한 뒤 `후보 = 연결 정책 + 사용자 제외 + 비채팅·비호환 제외`와 `연결 정책 = 연결됨 + 등록 모델 없음 + 연결 실패` 관계 및 observer·listener·binding 상태를 함께 확인합니다.

**진단 복사**는 누를 때마다 현재 상태를 다시 검사한 뒤 진단 JSON schema v2의 코드·상태·개수를 복사합니다. API 키, endpoint URL, project ID, Service Account와 Connection Profile 본문은 포함하지 않습니다. 오류를 보고할 때도 복사한 내용을 검토한 뒤 민감정보가 없는지 한 번 더 확인하세요.

복사 JSON의 `repair`와 `settings-repair` check는 마지막으로 의미 있었던 CMR 저장값 검사 결과를 비식별 코드와 개수로 보존합니다. v0.6.10부터 `details.items`에 모델·선택·route별 제거·병합·정규화·스키마 거부 사유 코드, `action`, 안전한 경로 범주와 개수를 함께 기록합니다. 손실 없는 `settings_migrated` 이관은 `notices`의 통과 정보, `invalid_records_removed`는 `warnings`의 주의, 미래 스키마 거부는 `errors`의 오류로 분리되며 전체 `status`·`summary`·`counts`에도 같은 의미로 반영됩니다. `invalid_records_removed`가 있으면 `beforeCounts`, `afterCounts`와 `details`를 비교하고, 예상한 항목이 빠졌다면 기존 백업을 보존한 채 문제를 보고하세요. 이후 복구할 것이 없는 설정 이벤트가 와도 이 마지막 안내·경고·오류 기록은 사라지지 않습니다.

## 설정 백업과 복구

**백업 내보내기**는 다음 세 항목만 portable schema v2 JSON으로 저장합니다.

- Registry의 제공업체·모델 ID·선택 상태
- 용도별 route의 provider·model ID·adapter ID·Connection Profile ID
- 외부 모델 컨트롤의 DOM 표식 기반 target ID, 마지막 CMR 모델·provider 식별자와 schema v2의 명시적 사용자 제외

API 키, endpoint, 리전, project/account ID, Service Account, 프로필 본문과 생성 설정은 저장하지 않습니다.

portable JSON은 UTF-8 기준 최대 8,000,000바이트, 모델 5,000개, route 256개로 제한합니다. 내보내기도 같은 상한을 검사하므로 정상적으로 저장한 백업은 다시 가져올 수 있습니다.

**백업 가져오기**는 적용 전에 JSON 형식, 최대 크기, 알려진 필드, provider·모델 ID, route와 schema 버전을 검사하고 추가·충돌·삭제 내역을 미리 보여줍니다. 미리보기의 **취소**는 현재 설정을 바꾸지 않으며, 미리보기를 연 뒤 현재 설정이 달라지면 오래된 결과를 적용하지 않고 다시 확인하도록 중단합니다. 현재 SillyTavern에서 사용 중인 custom-only 모델을 삭제하게 되는 백업은 적용할 수 없습니다. v0.5의 portable schema v1 백업은 외부 연결이 비어 있는 schema v2로 이관합니다. 외부 연결 schema v1과 v0.6.0~v0.6.5 백업의 legacy mapping·`disabled`는 읽은 뒤 제거하고 정상 형식의 `selectedModels`만 보존합니다. 과거 비활성 상태를 v2 `excludedTargets`로 변환하지 않습니다. v2 백업의 명시적 사용자 제외는 `selectedModels`와 함께 round trip 됩니다. 선택·제외 target의 합집합이 schema 한도 512개를 넘으면 일부 기록을 조용히 버리지 않고 가져오기를 거부합니다. 알 수 없는 필드나 미래 schema가 있으면 기존 설정을 바꾸지 않고 거부합니다. 가져온 profile ID가 현재 존재하지 않으면 route는 보존되지만 실행 시 명시 오류가 발생합니다.

## 호환성 제한

이 확장은 **모델 ID만 기존 SillyTavern 요청 경로에 전달**합니다.

- 새 endpoint, 인증 방식, API 버전 또는 deployment name이 필요한 모델은 ID 등록만으로 지원되지 않습니다.
- 새 thinking·tool·image·prefill·응답 변환 계약은 SillyTavern 코어나 별도 어댑터 지원이 필요할 수 있습니다.
- 원격 카탈로그에 없는 모델은 context·가격·멀티모달 metadata 자동 판단이 제한될 수 있습니다.
- 실제 제공업체 계정, 권한, 지역별 제공 여부는 자동 검사할 수 없습니다.
- 범용 브리지는 표준 DOM Chat Completion 컨트롤에만 선택지를 추가합니다. 자체 위젯·iframe·닫힌 Shadow DOM이나 컨트롤 없는 요청에는 선택지를 주입할 수 없으며 전용 연동이 필요합니다.
- hookless native 재사용은 외부 확장의 기존 provider option과 handler를 바꾸지 않는 모델 projection입니다. 명확한 Custom/OpenAI-compatible 또는 SillyTavern 현재 연결 선택이 없으면 특화하지 않으며, 표시된 모델을 외부 handler가 실제 지원하는지는 요청으로 확인해야 합니다.
- 같은 표식의 외부 모델 컨트롤이 여러 개라면 안정된 ID·name·label 또는 상위 구조가 필요합니다. 외부 확장이 모든 컨트롤을 새 객체로 교체하면서 순서까지 바꾸면 이전 선택과의 대응을 보장할 수 없습니다.
- 외부 확장의 provider alias, `data-type`과 선택 이벤트는 보존하지만 그 확장의 실제 request body 생성 로직까지 통제하지 않습니다.
- Vectors·embedding·TTS·Stable Diffusion·이미지 생성 모델은 Chat Completion Registry와 모델 종류가 달라 의도적으로 제외합니다.

## 문제 해결

### 모델 컨트롤을 찾지 못함

정상적으로 찾은 모델 컨트롤은 관리 팝업에 별도 상태로 표시하지 않습니다. 오류가 표시되면 API Connections에서 해당 Chat Completion source를 열고 연결 상태를 확인한 뒤 팝업을 다시 여세요. 모델 ID 등록은 가능하지만 SillyTavern 컨트롤을 찾지 못하면 등록 모델이 기존 모델 목록에 나타나지 않습니다.

### 원격 모델 목록 갱신 뒤 사용자 모델이 사라짐

일부 제공업체는 연결할 때 선택기를 다시 만듭니다. 확장은 변경을 감지해 사용자 옵션을 다시 추가하고, 동일 target의 새 컨트롤이 빈 값일 때 저장 선택을 복원합니다. 외부 확장이 설정한 유효한 현재값은 그대로 둡니다. 연결 완료 뒤에도 옵션이 복원되지 않으면 새로고침하고 체크리스트의 환경 정보와 함께 보고하세요.

### 다른 확장에서 모델이 보이지 않음

관리 팝업의 **호환성 진단 및 CMR 설정 백업 → 고급: 외부 연결 관리**에서 실패·사용자 제외 행을 확인합니다. 정상 대상은 **문제가 생긴 모델 칸 제외**를 펼쳐 찾습니다. 위험 대상으로 자동 판별된 컨트롤은 관리 행에 나타나지 않으므로 진단 복사 JSON의 제외 사유 집계를 확인하세요. 대상 자체가 감지되지 않으면 그 확장이 자체 위젯, iframe, 닫힌 Shadow DOM 또는 모델 컨트롤 없는 요청 방식을 쓰는지 확인하세요. `선택지 연결됨`인데 실제 기능이 다른 모델을 쓰면 CMR이 요청을 검증한 상태가 아니므로 외부 확장의 저장 동작과 Network payload를 확인해야 합니다.

### 등록 모델 삭제가 거부됨

select형 연결에서 현재 사용 중인 custom-only 모델은 관리 UI와 공개 `unregisterModel()` API 모두 등록 해제를 거부합니다. SillyTavern의 기존 모델 선택기에서 native 모델로 먼저 전환한 뒤 삭제하세요. 공개 API 오류 코드는 `model_in_use`입니다. 자유 입력형 `Custom`은 Registry에서 삭제해도 SillyTavern의 현재 `custom_model` 입력값을 지우지 않습니다.

### 라우팅 시험이 실패함

일반 관리 팝업에는 라우팅 시험 UI가 없습니다. Routing API를 사용하는 확장 또는 개발자는 모델이 Registry에 남아 있는지, Connection Profile이 존재하는지, profile source와 route provider가 같은지 확인하세요. 실패 시 다른 모델이나 메인 연결로 자동 대체하지 않습니다.

### 백업 가져오기가 거부됨

파일을 직접 편집했다면 알 수 없는 필드, 잘못된 model ID, 중복 모델, 미래 schema 또는 크기 제한 오류를 확인하세요. 거부 시 현재 설정은 유지됩니다.

## 개발 및 검사

확장 런타임 의존성과 빌드 과정은 없습니다. 개발 검사는 Node.js 24 이상에서 실행하며, UI 회귀 검사에만 개발 의존성인 Playwright와 Chromium을 사용합니다.

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

로컬 UI 검사는 SillyTavern 1.18.0 소스가 필요합니다. `SILLYTAVERN_ROOT`에 해당 저장소 경로를 지정하거나 CMR 저장소와 나란히 `sillytavern-1.18.0-review`를 두세요. 버전이 다르거나 필요한 CSS가 없으면 검사를 시작하지 않고 명시적으로 중단합니다. GitHub Actions는 검증한 SillyTavern 1.18.0 commit을 별도로 체크아웃합니다.

현재 자동 검사 240개는 24개 provider 회계, 숫자 배지 없는 단일 런처와 스크린 리더용 등록 개수, 전체 등록 모델 UI와 SillyTavern native 선택 경계, 12개 초과 조건부 검색, 공용 textarea의 단일·최대 200줄 원자 등록, 삭제 실행 취소, 공개 API의 `model_in_use` 보호, schema 이관, 동적 옵션 복원, 팝업 수명주기, 개발자용 라우팅 격리, 외부 select/input/datalist 선택지 주입과 provider/source 선택기 비대상 판별을 검증합니다. v0.6.15 검사는 Integration API capability 협상과 별도로, hookless native Custom·현재 연결 exact 분류, provider별 모델 projection, 모호·충돌 표식 미분류, provider option·값·endpoint·key·전역 요청·메인 설정 불변도 포함합니다. 실제 handler와 계정 요청 확인은 [통합 사용자 체크리스트](./USER_CHECKLIST.md)에서 별도로 수행합니다.

추가로 브라우저 DOM 샌드박스에서 24개 컨트롤 감지, GLM 등록과 SillyTavern native 선택, 개발자 API 라우팅, 외부 모델 컨트롤 연결, provider/source 선택기의 native 상태 보존, source/profile 이벤트 반복, 비활성화·재활성화와 정리 수명주기를 확인합니다.

숫자 배지 없는 런처와 스크린 리더용 등록 개수는 Node 통합 검사에서 확인합니다. Playwright Chromium UI 회귀 검사 15개는 제품 `settings.html`을 SillyTavern 1.18.0 고정 commit의 `style.css`·`popup.css`와 함께 렌더링하며, 브라우저 브리지 회귀에서는 provider/source 선택기에 CMR option이 들어가지 않고 native option·값이 유지되는지 확인합니다. native 재사용 fixture는 정확한 Custom/OpenAI-compatible와 SillyTavern 현재 연결 선택에서 해당 provider 모델만 투영되고 모호한 단독 토큰은 특화되지 않는지 확인합니다. 공용 provider hook fixture는 별도로 실제 제품 `src/provider-integrations.js`와 공개 API wiring을 사용하되 가짜 Connection Manager 서비스와 로컬 echo 요청으로 handler 설치→모델 게시→요청→정리 경계를 검증합니다. 실제 SillyTavern 전체 JavaScript 런타임, 실제 외부 확장 코드, 원격 제공업체 네트워크나 자격 증명을 검증하는 환경은 아닙니다. 320×568, 360×640, 420×800, 720×900에서 가로 넘침, 버튼 정렬, 공백 단위 줄바꿈, 단일 공식 닫기의 팝업 내부 우측 상단 배치·접근 가능한 이름·최소 24px 조작 영역, 단일·여러 줄 공용 textarea와 아이콘 전용 등록 버튼, 예외 중심 고급 외부 연결 관리 UI를 검사합니다. native popover 정보 아이콘 다섯 곳의 접근 가능한 이름·키보드 열기·Escape 닫기·좁은 화면 배치, 핵심 힌트와 경고의 상시 노출도 확인합니다. 모델 목록 경계, 12개 초과 검색, 여러 줄 원자 등록·삭제 실행 취소, 백업 미리보기, 조건부 문제 카드에서 고급 관리로 이동하는 흐름과 문제 대상 제외·복구 뒤 포커스 유지도 검증합니다. 모델·외부 대상·진단 목록은 마우스 휠과 키보드로, Popup 본문은 마우스 휠로 실제 스크롤합니다. GitHub Actions는 성공과 실패 모두 PNG와 HTML report를 `ui-regression-evidence-*` artifact로 14일 보관합니다.

이 검사는 실제 설정 마크업과 SillyTavern CSS의 배치·상호작용을 확인하지만 전체 SillyTavern 런타임을 기동하지는 않습니다. 실제 외부 확장의 저장 로직, 제공업체 자격 증명과 API 요청 성공은 [통합 사용자 체크리스트](./USER_CHECKLIST.md)에서 별도로 확인해야 합니다.

## 버전 정책

- 새 기능 범위는 `v0.n.0`으로 올립니다.
- 같은 기능 범위의 버그 수정과 세부 문서 변경은 `v0.n.n`으로 올립니다.
- 작은 수정 때문에 다음 기능 버전으로 건너뛰지 않습니다.
- 버전 변경 시 manifest, package, 초기화 로그, README, API 문서, 체크리스트와 로드맵을 함께 맞춥니다. 관리 팝업에는 버전 배지를 표시하지 않습니다.

## 로드맵 요약

| 버전 | 목표 | 상태 |
|---|---|---|
| `v0.1.x` | Vertex 기반 Registry와 관리 UI | ✅ 완료 |
| `v0.2.x` | 24개 Chat Completion 연결 | ✅ 구현·자동 검사 완료 |
| `v0.3.0` | 공개 Registry API | ✅ 완료 |
| `v0.4.0` | Connection Profile 어댑터와 용도별 직접 라우팅 | ✅ 완료 |
| `v0.5.0` | 호환성 진단·비밀정보 제외 백업·운영 안정성 계측 | ✅ 완료; 기존 외부 확장 자동 표시는 미구현이었음 |
| `v0.6.0` | 범용 DOM 모델 브리지와 외부 연결 portable backup | ✅ 구현·자동 검사 완료, 사용자 검증 대기 |
| `v0.6.1` | 관리 팝업 UI·UX 재구성 | ↩️ 사용자 피드백에 따라 롤백 |
| `v0.6.2` | v0.6.1 UI 변경 롤백·제품 방향 재논의 | ✅ 롤백 릴리스 |
| `v0.6.3` | 등록·삭제 전용 UI, native 선택, 외부 자동 추론, 개발자용 라우팅 API로 역할 단순화 | ✅ 완료 |
| `v0.6.4` | 공개 API 삭제 안전성, 512개 legacy mapping 선택 우선 이관, stale 외부 선택 저장 회복 | ✅ 완료 |
| `v0.6.5` | 전체 등록 목록·UI 정리, 외부 직접 연결과 연결 안 함 회귀 복구 | ✅ 완료 |
| `v0.6.6` | 외부 연결 단일화, 중복 자원 진단 오탐·닫기 버튼·추가 버튼 수정 | ✅ 완료 |
| `v0.6.7` | SillyTavern 1.18.0 CSS 기반 Chromium UI 회귀 검사와 CI 증거 보관 | ✅ 완료 |
| `v0.6.8` | 외부 target 식별 안정화, 진단 정합성, Popup 실패 정리와 CI Action 갱신 | ✅ 완료 |
| `v0.6.9` | 정상 외부 목록 숨김, 조건부 문제 카드, 고급 제외·복구와 외부 설정 schema v2 | ✅ 완료·🧪 사용자 검증 대기 |
| `v0.6.10` | 대량 모델 관리, 삭제 실행 취소, 백업 미리보기·복구 상세, 예외 중심 외부 관리와 DOM option 경고 | ✅ 완료·🧪 사용자 검증 대기 |
| `v0.6.11` | 단일·여러 줄 모델 등록을 공용 textarea와 아이콘 버튼 하나로 통합 | ✅ 완료·🧪 사용자 검증 대기 |
| `v0.6.12` | 런처 숫자 배지 제거와 핵심 안내·정보 popover 중심의 UI 문구 정리 | ✅ 완료·🧪 사용자 검증 대기 |
| `v0.6.13` | 외부 provider/source 선택기 오탐 차단과 native 상태 보존 | ✅ 완료·🧪 사용자 검증 대기 |
| `v0.6.14` | 선택된 Connection Manager 프로필 기반 일반·Custom 공용 provider handler와 공개 hook 계약 | ✅ 완료·🧪 사용자 검증 대기 |
| `v0.6.15` | hookless 기존 Custom·SillyTavern 현재 연결 provider option의 보수적인 모델 projection | ✅ 완료·🧪 실제 handler 검증 대기 |
| `v0.6.16` | SillyTavern 공식 Popup 닫기의 CMR 패널 내부 배치와 좁은 화면 회귀 방지 | ✅ 현재 릴리스·🧪 실제 설치 화면 검증 대기 |

문제가 있으면 [GitHub Issues](https://github.com/p16481012/Custom-Model-Router/issues)에 SillyTavern 버전, 제공업체, 체크리스트 항목 ID와 민감정보를 제거한 오류를 남겨 주세요.
