import {ESPLoader, Transport, md5Hex} from "./assets/esp-tools.js";

const flashBytes = 4 * 1024 * 1024;

async function verifyFlashSize(loader) {
    // esptool-js 0.7.1 uses zero offsets for the ESP8266's absent length registers.
    // Its SPI command routine expects null to select the length fields in SPI_USR1.
    loader.chip.SPI_MOSI_DLEN_OFFS = null;
    loader.chip.SPI_MISO_DLEN_OFFS = null;
    const id = (await loader.readFlashId()) & 0xffffff;
    const jedec = loader.toHex(Uint8Array.of(id, id >>> 8, id >>> 16)).toUpperCase();
    if (id === 0 || id === 0xffffff) {
        throw new Error(`La mémoire Wi-Fi ne répond pas (JEDEC ${jedec}). Rebranche le module Wi-Fi seul en maintenant son bouton, puis réessaie.`);
    }
    const size = loader.DETECTED_FLASH_SIZES[id >>> 16];
    if (!size) throw new Error(`Mémoire Wi-Fi de capacité inconnue (JEDEC ${jedec}).`);
    if (size !== "4MB") {
        const capacity = size.replace("MB", " Mo").replace("KB", " Ko");
        throw new Error(`Mémoire Wi-Fi détectée à ${capacity}. Ce firmware exige 4 Mo (JEDEC ${jedec}).`);
    }
}

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
        await verifyFlashSize(loader);
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
