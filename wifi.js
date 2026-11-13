import {ESPLoader, Transport, md5Hex} from "./assets/esp-tools.js";

const flashBytes = 4 * 1024 * 1024;

export async function connectWifi(port) {
    const transport = new Transport(port);
    const loader = new ESPLoader({
        transport,
        baudrate: 115200,
        romBaudrate: 115200,
        terminal: {clean() {}, write() {}, writeLine() {}},
    });
    const close = async () => {
        if (port.readable || port.writable) await transport.disconnect();
    };

    try {
        await loader.detectChip("no_reset");
        if (loader.chip?.CHIP_NAME !== "ESP8266") throw new Error("La puce détectée n’est pas un ESP8266.");
        await loader.runStub();
        if (!loader.IS_STUB) throw new Error("Le chargeur de flash ESP8266 n’a pas démarré.");
        const size = await loader.detectFlashSize();
        if (size !== "4MB") {
            throw new Error(size ? `Flash détectée : ${size}. Cette image Wi-Fi exige 4 Mo.` : "La taille de la mémoire Wi-Fi n’a pas pu être détectée.");
        }
    } catch (error) {
        await close().catch(() => {});
        throw error;
    }

    return {
        description: "ESP8266 détecté · flash de 4 Mo",
        close,
        async backup(progress) {
            loader.FLASH_READ_TIMEOUT = 12000;
            const image = await loader.readFlash(0, flashBytes, (_packet, received, total) => progress(received, total));
            const checksum = await transport.read(12000);
            if (image.length !== flashBytes || checksum.length !== 16 || loader.toHex(checksum) !== md5Hex(image)) {
                throw new Error("La sauvegarde Wi-Fi ne correspond pas à la mémoire lue.");
            }
            return image;
        },
        async flash(image, progress) {
            if (image.length < 0x1004 || image.length > flashBytes ||
                image[0] !== 0xe9 || image[0x1000] !== 0xe9 || image[2] !== 2 || image[3] !== 0x40) {
                throw new Error("L’image Wi-Fi ESP8266 4 Mo est invalide.");
            }
            await loader.writeFlash({
                fileArray: [{data: image, address: 0}],
                flashMode: "keep",
                flashFreq: "keep",
                flashSize: "4MB",
                eraseAll: false,
                compress: true,
                calculateMD5Hash: md5Hex,
                reportProgress(_file, written, total) {
                    progress(written === total ? "Vérification de la mémoire Wi-Fi" : "Écriture du firmware Wi-Fi", written, total);
                },
            });
        },
    };
}
