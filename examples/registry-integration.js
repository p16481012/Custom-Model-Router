// 다른 SillyTavern 확장의 초기화 함수 안에서 실행하는 예제입니다.
const registry = globalThis.CustomModelRouter;

if (!registry?.isCompatible('1.0.0')) {
    throw new Error('Custom Model Router Registry API 1.0.0 이상이 필요합니다.');
}

const vertexModels = registry.listModels('vertexai');
console.info('등록된 Vertex 모델', vertexModels.map(model => model.id));

const unsubscribe = registry.subscribe('registry:changed', event => {
    console.info('Registry revision', event.revision);
});

// 확장이 비활성화될 때 호출하세요.
export function destroyExampleIntegration() {
    unsubscribe();
}
