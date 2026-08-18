// 보조 요청을 보내려는 다른 SillyTavern 확장의 opt-in 예제입니다.
const router = globalThis.CustomModelRouter?.routing;

if (!router?.isCompatible('1.0.0')) {
    throw new Error('Custom Model Router Routing API 1.0.0 이상이 필요합니다.');
}

export async function translateWithRegisteredRoute(text, signal) {
    const result = await router.execute('translation', {
        prompt: `Translate into Korean:\n\n${text}`,
        maxTokens: 512,
    }, { signal });
    return result.content;
}
