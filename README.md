# Custom Model Router

SillyTavern 코어 파일을 수정하지 않고 Google Vertex AI에 사용자 지정 Gemini 모델 ID를 추가하는 UI 확장입니다.

현재 버전은 **v0.1.2**이며, 이전 설계의 **v0.1 Proof of Concept** 범위에 API Connections 중심의 모델 관리 UI를 적용합니다.

## 현재 진행 상태

| 항목 | 상태 |
|---|---|
| 현재 릴리스 | `v0.1.2` |
| 핵심 구현과 자동 검사 | ✅ 완료 · 20개 검사 통과 |
| 사용자 확인 | ✅ 기본 동작 정상 확인 · 인증 방식/스트리밍/Profile별 세부 결과는 미확인 |
| 현재 단계 | 🧪 v0.1.2 UI/UX와 실제 환경 세부 재검증 |
| 사용자가 할 일 | [사용자 검증 체크리스트](./USER_CHECKLIST.md)의 UI/UX 및 실제 요청 항목 재검증 |
| 다음 단계 | v0.1.x 실제 환경 안정화 후 `v0.2.0` 설계 |

전체 진행 위치와 마일스톤 완료 조건은 [개발 로드맵](./ROADMAP.md)에서 계속 갱신합니다.

## v0.1에서 할 수 있는 일

- Vertex Gemini 모델 ID를 직접 등록하고 삭제할 수 있습니다.
- API Connections의 Connection Profile 도구행에서 모델 관리 아이콘을 눌러 공식 SillyTavern 팝업으로 관리할 수 있습니다.
- 등록 모델은 높이가 제한된 압축 목록에 표시되어 모델이 늘어나도 API Connections 화면을 길게 밀어내지 않습니다.
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
3. API Connections 상단의 **Connection Profile 도구행**에서 `사용자 모델 관리` 아이콘을 누릅니다.
4. 열린 SillyTavern 공식 팝업에 Google이 공개한 정확한 모델 ID를 입력하고 **추가**를 누릅니다.
5. 팝업의 압축 목록에서 선택 아이콘을 누르거나 API Connections의 Vertex 모델 선택기에서 `사용자 지정 모델 · Custom Model Router` 그룹을 선택합니다.
6. 팝업은 닫기 버튼이나 `Escape` 키로 닫을 수 있습니다. 닫은 뒤 초점은 모델 관리 아이콘으로 돌아갑니다.
7. 테스트 메시지를 보내 모델과 리전의 실제 사용 가능 여부를 확인합니다.

확장은 Extensions 설정에 긴 설정 블록을 추가하지 않습니다. 모델 관리 아이콘은 API Connections의 Connection Profile 도구행에 표시되며, 해당 도구가 비활성화된 환경에서는 API 제목 옆에 표시됩니다.

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

SillyTavern 버전을 확인하고 Google Vertex AI 연결 화면을 연 뒤 페이지를 새로고침해 주세요. 이 버전은 SillyTavern 1.18.0의 `#model_vertexai_select`와 Connection Profile 도구행 구조를 기준으로 검증합니다.

### 모델 관리 아이콘이 보이지 않음

아이콘은 Extensions 설정이 아니라 API Connections의 Connection Profile 도구행에 표시됩니다. Connection Profile 도구가 비활성화된 환경에서는 API 제목 옆을 확인해 주세요. 계속 보이지 않으면 확장이 활성화되어 있는지 확인하고 페이지를 새로고침해 주세요.

### API 요청 오류가 발생함

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

현재 자동 검사 20개는 모델 ID 검증, 저장 설정 복구, 중복 처리, 선택 상태 관리, Vertex 옵션의 멱등 주입, 모델 관리 아이콘과 팝업 수명주기·실패 복구, Connection Profile 지연 삽입, MutationObserver 자기 반복 방지, 100개 모델 압축 목록, 지연 UI 로딩과 버전 표기 일치를 확인합니다. 실제 계정과 화면 조작이 필요한 항목은 [사용자 검증 체크리스트](./USER_CHECKLIST.md)에서 별도로 확인합니다.

## 버전 정책

- 최초 v0.1 범위: `v0.1.0`
- v0.1 사용자 검증 문서화: `v0.1.1`
- API Connections 모델 관리 패널과 압축 목록: `v0.1.2`
- v0.1의 버그 수정과 세부 호환성 개선: `v0.1.3`, `v0.1.4`, ...
- 여러 제공업체 지원처럼 범위가 확장되는 다음 단계: `v0.2.0`

작은 수정 때문에 바로 다음 기능 버전으로 올리지 않습니다. 버전을 변경할 때는 `manifest.json`, `package.json`, `settings.html`의 버전 배지, README의 현재 버전, `index.js`의 초기화 로그, 체크리스트와 로드맵의 대상 버전을 함께 갱신합니다.

## 로드맵 요약

| 버전 | 목표 | 상태 |
|---|---|---|
| `v0.1.x` | Vertex Gemini 실제 환경 검증과 안정화 | 🧪 v0.1.2 재검증 중 |
| `v0.2.0` | OpenAI, Anthropic, Google AI Studio, Vertex Gemini, xAI 지원 | 📝 예정 |
| `v0.3.0` | MAIN, AUX, FAST 등 모델 별칭 | 📝 예정 |
| `v0.4.0` | 다른 확장이 사용할 수 있는 공개 Registry API | 📝 예정 |
| `v0.5.0` | 주요 확장별 어댑터와 용도별 모델 라우팅 | 📝 예정 |
| `v0.6.0` | 호환성과 운영 안정화 | 📝 예정 |

세부 범위, 완료 조건, 현재 게이트와 진행 기록은 [ROADMAP.md](./ROADMAP.md)를 기준으로 관리합니다.
