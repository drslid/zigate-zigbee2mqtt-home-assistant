import {openSerial} from "./serial.js";

const chipId = 0x10408686;
const flashBytes = 256 * 1024;
const blockSize = 128;
const imageHeader = Uint8Array.of(0x07, 0x03, 0x00, 0x08);
const xor = (bytes) => bytes.reduce((sum, byte) => sum ^ byte, 0);
const equal = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// JN-AN-1003 defines a length byte, message type, payload and XOR checksum.
export function bootFrame(type, payload = new Uint8Array(0)) {
    if (payload.length > 253) throw new Error("Trame du chargeur JN5168 trop longue.");
    const frame = new Uint8Array(payload.length + 3);
    frame[0] = payload.length + 2;
    frame[1] = type;
    frame.set(payload, 2);
    frame[frame.length - 1] = xor(frame);
    return frame;
}

async function request(serial, command, payload, timeout = 2500) {
    await serial.write(bootFrame(command, payload));
    const [length] = await serial.readExact(1, timeout);
    if (length < 3) throw new Error("Réponse série invalide. Vérifie le mode flash du module radio.");
    const answer = await serial.readExact(length, timeout);
    if (xor(answer) !== length || answer[0] !== command + 1) {
        throw new Error("Réponse inattendue du chargeur JN5168. Rebranche le module en mode flash.");
    }
    if (answer[1] !== 0) {
        throw new Error(`Le chargeur JN5168 a refusé une commande (code 0x${answer[1].toString(16).padStart(2, "0")}).`);
    }
    return answer.subarray(2, -1);
}

function addressPayload(address, tail) {
    const result = new Uint8Array(4 + tail.length);
    view(result).setUint32(0, address, true);
    result.set(tail, 4);
    return result;
}

async function readFlash(serial, address, count) {
    const result = await request(serial, 0x0b, addressPayload(address, [count, 0]));
    if (result.length !== count) throw new Error("La lecture de la mémoire radio est incomplète.");
    return result;
}

export function validateRadioImage(image) {
    if (image.length < blockSize + 4 || !equal(image.subarray(0, 4), imageHeader) ||
        image.length - 4 > flashBytes || view(image).getUint32(0x24) !== image.length - 4) {
        throw new Error("L’image du firmware JN5168 est invalide.");
    }
}

export async function connectRadio(port) {
    const serial = await openSerial(port, 38400);
    try {
        const id = await request(serial, 0x32);
        if (id.length !== 4 || view(id).getUint32(0) !== chipId) {
            throw new Error("La puce détectée ne correspond pas au JN5168 de cette ZiGate.");
        }
        const flashId = await request(serial, 0x25);
        if (!equal(flashId, [0xcc, 0xee])) throw new Error("La mémoire interne JN5168 attendue est introuvable.");
        await request(serial, 0x2c, [8, 0, 0, 0, 0]);
        await readFlash(serial, 0, 4);
    } catch (error) {
        await serial.close().catch(() => {});
        throw error;
    }

    return {
        description: "JN5168 détecté · flash interne",
        close: serial.close,
        async backup(progress) {
            const first = await readFlash(serial, 0, blockSize);
            const length = view(first).getUint32(0x20);
            if (length < blockSize || length > flashBytes) throw new Error("L’ancien firmware radio n’a pas de longueur exploitable.");
            const image = new Uint8Array(4 + length);
            image.set(imageHeader);
            image.set(first, 4);
            for (let offset = blockSize; offset < length; offset += blockSize) {
                const block = await readFlash(serial, offset, Math.min(blockSize, length - offset));
                image.set(block, 4 + offset);
                progress(offset + block.length, length);
            }
            validateRadioImage(image);
            return image;
        },
        async flash(image, progress) {
            validateRadioImage(image);
            const data = image.subarray(4);
            progress("Effacement de la mémoire radio", 0, data.length);
            await request(serial, 0x07, undefined, 12000);
            const blank = await readFlash(serial, 0, 64);
            if (blank.some((byte) => byte !== 0xff)) throw new Error("La mémoire radio n’est pas vide après l’effacement.");

            for (let offset = 0; offset < data.length; offset += blockSize) {
                const block = data.subarray(offset, offset + blockSize);
                await request(serial, 0x09, addressPayload(offset, block));
                progress("Écriture du firmware radio", offset + block.length, data.length);
            }
            for (let offset = 0; offset < data.length; offset += blockSize) {
                const block = data.subarray(offset, offset + blockSize);
                const actual = await readFlash(serial, offset, block.length);
                if (!equal(actual, block)) throw new Error(`Vérification radio échouée à l’adresse 0x${offset.toString(16)}.`);
                progress("Vérification de la mémoire radio", offset + block.length, data.length);
            }
        },
    };
}

export function appFrame(command) {
    const raw = Uint8Array.of(command >> 8, command & 255, 0, 0, 0);
    raw[4] = xor(raw);
    const escaped = [1];
    for (const byte of raw) {
        if (byte < 0x10) escaped.push(2, byte ^ 0x10);
        else escaped.push(byte);
    }
    return Uint8Array.from([...escaped, 3]);
}

async function waitForAppFrame(serial, code, duration) {
    const deadline = Date.now() + duration;
    let frame;
    let escaped = false;
    while (Date.now() < deadline) {
        const [byte] = await serial.readExact(1, Math.max(1, deadline - Date.now()));
        if (byte === 1) {
            frame = [];
            escaped = false;
        } else if (frame && byte === 3) {
            if (!escaped && frame.length >= 6 && frame.length === 5 + ((frame[2] << 8) | frame[3]) &&
                xor(frame) === 0 && ((frame[0] << 8) | frame[1]) === code) {
                return Uint8Array.from(frame.slice(5, -1));
            }
            frame = undefined;
        } else if (frame && frame.length < 1024) {
            if (escaped) {
                frame.push(byte ^ 0x10);
                escaped = false;
            } else if (byte === 2) {
                escaped = true;
            } else {
                frame.push(byte);
            }
        } else {
            frame = undefined;
        }
    }
    throw new DOMException("Le firmware radio n’a pas répondu.", "TimeoutError");
}

export async function resetRadioNetwork(port, onErase) {
    const serial = await openSerial(port, 115200);
    try {
        await serial.write(appFrame(0x0010));
        const version = await waitForAppFrame(serial, 0x8010, 4000);
        if (!equal(version, [0, 4, 3, 0x23])) {
            throw new Error("La version radio attendue (3.23 OPDM) n’a pas été détectée.");
        }
        onErase();
        await serial.write(appFrame(0x0012));
        await waitForAppFrame(serial, 0x8007, 8500);
    } catch (error) {
        if (error.name === "TimeoutError") {
            throw new Error("La radio n’a pas confirmé le redémarrage. Vérifie qu’elle est branchée sur son USB-TTL en mode normal, puis réessaie.");
        }
        throw error;
    } finally {
        await serial.close().catch(() => {});
    }
}
