// Keep a routing execution alive until its stream finishes, is closed, or is
// cancelled. No background reads: the caller still owns stream consumption.
export function retainRoutingStream(result, controller, cleanup) {
    const factory = typeof result === 'function' ? result
        : typeof result?.[Symbol.asyncIterator] === 'function' ? () => result[Symbol.asyncIterator]()
            : null;
    if (!factory) return null;
    let iterator;
    let started = false;
    let finished = false;
    let closed = false;
    const signal = controller.signal;
    const abortError = () => {
        const error = new Error('요청이 취소되었습니다.');
        error.name = 'AbortError';
        return error;
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        cleanup();
    };
    const close = () => {
        if (closed || !iterator) return;
        closed = true;
        try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* best effort */ }
    };
    const onAbort = () => { close(); finish(); };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    const waitStep = operation => new Promise((resolve, reject) => {
        let settled = false;
        const finishStep = (error, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(value);
        };
        const abort = () => finishStep(abortError());
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        Promise.resolve().then(() => {
            if (signal.aborted) throw abortError();
            return operation();
        }).then(value => finishStep(null, value), error => finishStep(error));
    });
    const open = () => {
        if (signal.aborted) throw abortError();
        if (started) throw new Error('스트림은 한 번만 사용할 수 있습니다.');
        started = true;
        try {
            iterator = factory();
            if (!iterator || typeof iterator.next !== 'function') throw new Error('잘못된 스트림입니다.');
        } catch (error) {
            controller.abort();
            finish();
            throw error;
        }
        return {
            async next(value) {
                if (signal.aborted) throw abortError();
                if (finished) return { done: true, value: undefined };
                try {
                    const step = await waitStep(() => iterator.next(value));
                    if (signal.aborted) throw abortError();
                    if (!step || typeof step !== 'object') throw new Error('잘못된 스트림 응답입니다.');
                    if (step.done) finish();
                    return step;
                } catch (error) {
                    controller.abort();
                    finish();
                    throw error;
                }
            },
            async return(value) {
                close();
                if (!finished) controller.abort();
                finish();
                return { done: true, value };
            },
            async throw(error) {
                close();
                controller.abort();
                finish();
                throw error;
            },
            [Symbol.asyncIterator]() { return this; },
        };
    };
    return typeof result === 'function' ? open : { [Symbol.asyncIterator]: open };
}
