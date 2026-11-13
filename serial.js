export async function openSerial(port, baudRate) {
    try {
        await port.open({baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none", bufferSize: 4096});
    } catch (error) {
        if (error.name === "InvalidStateError") {
            throw new Error("Le port série est déjà ouvert dans cet onglet. Recharge la page, puis reconnecte le module.", {cause: error});
        }
        if (error.name !== "NetworkError") throw error;

        const {usbVendorId, usbProductId} = port.getInfo();
        const hex = (value) => value.toString(16).toUpperCase().padStart(4, "0");
        const usbId = usbVendorId !== undefined && usbProductId !== undefined
            ? ` (USB ${hex(usbVendorId)}:${hex(usbProductId)})`
            : "";
        const hint = port.connected === false
            ? "L’adaptateur a été déconnecté. Rebranche-le, puis sélectionne de nouveau son port."
            : "Ferme les autres outils série. Sous Windows, vérifie l’état de l’adaptateur dans le Gestionnaire de périphériques.";
        throw new Error(`Impossible d’ouvrir le port série à ${baudRate} bauds${usbId}. ${hint}`, {cause: error});
    }
    const {readable, writable} = port;
    if (!readable || !writable) {
        await port.close().catch(() => {});
        throw new Error("La connexion USB a été interrompue à l’ouverture du port série. Rebranche l’adaptateur.");
    }
    const reader = readable.getReader();
    const writer = writable.getWriter();
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
