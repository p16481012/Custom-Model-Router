# Custom Model Router

SillyTavern 코어 파일을 수정하지 않고 Google Vertex AI에 사용자 지정 Gemini 모델 ID를 추가하는 UI 확장입니다.

현재 버전은 **v0.1.0**이며, 이전 설계의 **v0.1 Proof of Concept** 범위를 구현합니다.

## v0.1에서 할 수 있는 일

- Vertex Gemini 모델 ID를 직접 등록하고 삭제할 수 있습니다.
- 등록 모델을 SillyTavern의 기본 Google Vertex AI 모델 선택기에 표시합니다.
- 모델을 선택하면 SillyTavern의 기본 `vertexai_model` 설정과 `change` 흐름을 그대로 사용합니다.
- 새로고침, 설정 갱신, Connection Profile 전환 뒤에도 사용자 옵션과 선택 상태를 복원합니다.
- SillyTavern 기본 목록에 같은 모델이 추가되면 중복 옵션을 만들지 않습니다.
- API 키, Service Account JSON, 프로젝트 ID, 리전, 프록시 설정을 읽거나 별도로 저장하지 않습니다.

동작 경로는 다음과 같습니다.

```text
사용자 모델 등록
    ↓
Vertex AI 기본 모델 선택기에 옵션 추가
    ↓
SillyTavern의 vertexai_model 변경
    ↓
기존 인증 · 프로젝트 · 리전 설정 유지
    ↓
사용자 모델 ID로 Vertex Gemini 요청
```

## 지원 범위

- SillyTavern `1.18.0` 이상
- Google Vertex AI Express Mode
- Google Vertex AI Full Mode(Service Account)
- 현재 SillyTavern의 Gemini `generateContent` 요청·응답 규격과 호환되는 모델
- 일반 및 스트리밍 텍스트 생성 경로

v0.1은 모델 ID를 기존 Vertex Gemini 경로로 전달하는 버전입니다. 새 모델이 별도의 요청 필드, 응답 처리, thinking 규칙, 이미지 생성 규칙 또는 assistant prefill 제한을 요구한다면 모델 ID 추가만으로 정상 동작하지 않을 수 있습니다. 이 경우 SillyTavern 코어 업데이트나 이후 버전의 호환 어댑터가 필요합니다.

다음 항목은 아직 지원하지 않습니다.

- Google AI Studio와 다른 API 제공업체
- Vertex의 Claude, Llama 등 Partner Model
- 다른 확장이 자체적으로 보관하는 모델 목록 자동 변경
- MAIN, AUX 같은 모델 별칭과 용도별 라우팅
- 모델 자동 검색
- 모델별 capability metadata

## 설치

1. SillyTavern에서 **Extensions** 패널을 엽니다.
2. **Install Extension**을 선택합니다.
3. 다음 Git 저장소 URL을 입력합니다.

```text
https://github.com/p16481012/Custom-Model-Router
```

4. 설치가 끝나면 SillyTavern 페이지를 새로고침합니다.

## 사용 방법

1. SillyTavern의 **API Connections**에서 `Google Vertex AI` 연결을 먼저 설정합니다.
2. 인증 방식, 프로젝트 ID, 리전 등 기존 Vertex 설정을 완료합니다.
3. **Extensions** 설정에서 `Custom Model Router`를 엽니다.
4. Google이 공개한 정확한 모델 ID를 입력하고 **추가**를 누릅니다.
5. 등록 목록에서 **선택**을 누르거나 API Connections의 Vertex 모델 선택기에서 `사용자 지정 모델 · Custom Model Router` 그룹을 선택합니다.
6. 테스트 메시지를 보내 모델과 리전의 실제 사용 가능 여부를 확인합니다.

모델 ID 예시는 형식을 설명하기 위한 것이며 실제 제공 여부를 보장하지 않습니다.

```text
gemini-x.y-pro-preview
```

## 입력 검증

v0.1은 Vertex 요청 URL의 모델 경로를 안전하게 유지하기 위해 모델 ID를 엄격하게 검사합니다.

- `gemini-`로 시작해야 합니다.
- 영문 소문자, 숫자, 마침표(`.`), 밑줄(`_`), 하이픈(`-`)만 허용합니다.
- 최대 128자입니다.
- `/`, `\`, `:`, `?`, `#`, `%`, 공백과 HTML은 허용하지 않습니다.
- 중복 등록은 허용하지 않습니다.

## 문제 해결

### Vertex 모델 선택기를 찾지 못했다는 메시지가 표시됨

SillyTavern 버전을 확인하고 페이지를 새로고침해 주세요. 이 버전은 SillyTavern 1.18.0의 `#model_vertexai_select` 구조를 기준으로 검증합니다.

### 400 또는 404 오류가 발생함

다음을 확인해 주세요.

- 모델 ID 오타
- 해당 프로젝트에서 모델을 사용할 권한이 있는지
- 선택한 리전에서 해당 모델이 제공되는지
- Express Mode 또는 Full Mode 인증이 정상인지
- 모델이 현재 SillyTavern의 Gemini 요청 규격과 호환되는지

확장은 존재하지 않는 모델을 다른 모델로 자동 대체하지 않습니다.

### 등록 모델을 삭제할 수 없음

현재 선택 중인 사용자 모델은 실수로 설정을 잃지 않도록 삭제를 막습니다. API Connections에서 다른 Vertex 모델을 먼저 선택한 뒤 삭제해 주세요.

## 업데이트와 문의

SillyTavern 확장 관리자의 업데이트 기능은 이 저장소의 `main` 브랜치를 기준으로 새 커밋을 가져옵니다. 업데이트 전에 중요한 설정을 백업하고, 문제가 있으면 [GitHub Issues](https://github.com/p16481012/Custom-Model-Router/issues)에 SillyTavern 버전과 오류 메시지를 함께 남겨 주세요.

확장을 제거해도 SillyTavern 설정에 저장된 `customModelRouter` 데이터는 자동으로 삭제되지 않을 수 있습니다. 다시 설치할 계획이 없다면 제거 전에 등록 모델을 모두 삭제하는 것을 권장합니다.

## 개발 및 검사

런타임 의존성이나 빌드 과정은 없습니다. Node.js 20 이상에서 다음 검사를 실행할 수 있습니다.

```bash
npm test
npm run check
```

테스트는 모델 ID 검증, 저장 설정 복구, 중복 처리, 선택 상태 관리, Vertex 옵션의 멱등 주입과 기본 옵션 보존을 확인합니다.

## 버전 정책

- 최초 v0.1 범위: `v0.1.0`
- v0.1의 버그 수정과 세부 호환성 개선: `v0.1.1`, `v0.1.2`, ...
- 여러 제공업체 지원처럼 범위가 확장되는 다음 단계: `v0.2.0`

작은 수정 때문에 바로 다음 기능 버전으로 올리지 않습니다. 버전을 변경할 때는 `manifest.json`, `package.json`, `settings.html`의 버전 배지, README의 현재 버전, `index.js`의 초기화 로그를 함께 갱신합니다.

## 예정 로드맵

- `v0.2.0`: OpenAI, Anthropic, Google AI Studio, Vertex Gemini, xAI 지원
- `v0.3.0`: MAIN, AUX, FAST 등 모델 별칭
- `v0.4.0`: 다른 확장이 사용할 수 있는 공개 Registry API
- `v0.5.0`: 주요 확장별 어댑터와 용도별 모델 라우팅
- `v0.6.0`: 재렌더링, 프로필 전환, 오류 처리 안정화
