export async function openSerial(port, baudRate) {
    await port.open({baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none", bufferSize: 4096});
    const reader = port.readable.getReader();
    const writer = port.writable.getWriter();
    let buffer = new Uint8Array(0);
    let pending;
    let failure;
    let closing;

    function take(count) {
        const bytes = buffer.slice(0, count);
        buffer = buffer.slice(count);
        return bytes;
    }

    function settleRead(error) {
        if (!pending || (!error && buffer.length < pending.count)) return;
        const {count, resolve, reject, timer} = pending;
        pending = undefined;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(take(count));
    }

    const reading = (async () => {
        try {
            while (true) {
                const {value, done} = await reader.read();
                if (done) break;
                if (buffer.length + value.length > 16384) throw new Error("Le port série envoie trop de données.");
                const joined = new Uint8Array(buffer.length + value.length);
                joined.set(buffer);
                joined.set(value, buffer.length);
                buffer = joined;
                settleRead();
            }
        } catch (error) {
            failure = error;
        } finally {
            failure ??= new Error("Le port série a été déconnecté.");
            settleRead(failure);
            reader.releaseLock();
        }
    })();

    return {
        write: (bytes) => writer.write(bytes),
        readExact(count, timeout = 2000) {
            if (pending) throw new Error("Une lecture du port série est déjà en cours.");
            if (buffer.length >= count) return Promise.resolve(take(count));
            if (failure) return Promise.reject(failure);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    settleRead(new DOMException("Le module ne répond pas sur le port série.", "TimeoutError"));
                }, timeout);
                pending = {count, resolve, reject, timer};
            });
        },
        close() {
            closing ??= (async () => {
                await reader.cancel().catch(() => {});
                await reading;
                writer.releaseLock();
                await port.close();
            })();
            return closing;
        },
    };
}
