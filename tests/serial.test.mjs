import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {ESPLoader, Transport} from "../assets/esp-tools.js";
import {connectRadio, resetRadioNetwork} from "../radio.js";
import {configureWifi, parseWifiLine, readWifiSetup, validIpv4, wifiInputErrors} from "../wifi-setup.js";
import {connectWifi} from "../wifi.js";

const radioImage = new Uint8Array(await readFile(new URL("../firmwares/ZiGate-Radio-JN5168-v3.23-OPDM-Z2M.bin", import.meta.url)));
const wifiImage = new Uint8Array(await readFile(new URL("../firmwares/ZiGate-WiFi-v1.3-Z2M-ESP8266-1.1.0.bin", import.meta.url)));
const noop = () => {};

function serialPort(onWrite, onOpen = noop) {
    let input;
    let readable;
    let writable;
    return {
        get readable() { return readable; },
        get writable() { return writable; },
        async open({baudRate}) {
            assert.equal(readable, undefined);
            readable = new ReadableStream({start(controller) { input = controller; }});
            const send = (bytes) => {
                input.enqueue(bytes.slice(0, 1));
                input.enqueue(bytes.slice(1, 4));
                input.enqueue(bytes.slice(4));
            };
            writable = new WritableStream({write(bytes) { onWrite(bytes, send); }});
            onOpen(baudRate, send);
        },
        async close() {
            assert.equal(readable.locked, false);
            assert.equal(writable.locked, false);
            readable = undefined;
            writable = undefined;
        },
    };
}

function radioPort({chip = [0x10, 0x40, 0x86, 0x86], flashId = [0xcc, 0xee], damageChecksum, refuseErase, damageReadback} = {}) {
    const flash = new Uint8Array(256 * 1024).fill(0xff);
    flash.set(radioImage.subarray(4));
    let wrote = false;
    const commands = [];
    const port = serialPort((frame, send) => {
        assert.equal(frame[0], frame.length - 1);
        assert.equal(frame.reduce((sum, byte) => sum ^ byte, 0), 0);
        const command = frame[1];
        const payload = frame.subarray(2, -1);
        const address = payload.length >= 4 ? new DataView(payload.buffer, payload.byteOffset).getUint32(0, true) : 0;
        commands.push(command);
        let result = [];
        let status = 0;
        switch (command) {
        case 0x32: result = chip; break;
        case 0x25: result = flashId; break;
        case 0x2c: assert.deepEqual([...payload], [8, 0, 0, 0, 0]); break;
        case 0x07:
            if (refuseErase) status = 0xfe;
            else flash.fill(0xff);
            break;
        case 0x09: flash.set(payload.subarray(4), address); wrote = true; break;
        case 0x0b:
            assert.equal(payload[5], 0);
            result = flash.slice(address, address + payload[4]);
            if (wrote && damageReadback) result[0] ^= 1;
            break;
        default: assert.fail(`Unexpected command ${command}`);
        }
        const reply = [3 + result.length, command + 1, status, ...result];
        send(Uint8Array.from([...reply, reply.reduce((sum, byte) => sum ^ byte, Number(Boolean(damageChecksum)))]));
    }, (baudRate) => assert.equal(baudRate, 38400));
    return {port, flash, commands};
}

test("JN5168 reports a port-open failure with USB IDs before using the serial streams", async () => {
    const failure = new DOMException("Failed to open serial port.", "NetworkError");
    const port = {
        connected: true,
        getInfo: () => ({usbVendorId: 0x067b, usbProductId: 0x2303}),
        async open({baudRate}) {
            assert.equal(baudRate, 38400);
            throw failure;
        },
        get readable() { assert.fail("The failed port has no readable stream"); },
    };
    await assert.rejects(connectRadio(port), {message: /38400 bauds.*USB 067B:2303.*Gestionnaire de périphériques/, cause: failure});
    port.connected = false;
    await assert.rejects(connectRadio(port), /adaptateur a été déconnecté/);
    port.open = async () => { throw new DOMException("The port is already open.", "InvalidStateError"); };
    await assert.rejects(connectRadio(port), /déjà ouvert dans cet onglet/);
});

test("JN5168 distinguishes a lost USB connection from a bootloader that gives no reply", async () => {
    const lost = serialPort(() => { throw new DOMException("The device has been lost.", "NetworkError"); });
    await assert.rejects(connectRadio(lost), /après l’ouverture du port série/);
    assert.equal(lost.readable, undefined);

    const silent = serialPort(noop);
    await assert.rejects(connectRadio(silent), /port série est ouvert, mais le JN5168 ne répond pas/);
    assert.equal(silent.readable, undefined);
});

test("JN5168 detects, backs up and writes the complete release with exact readback", async () => {
    const {port, flash, commands} = radioPort();
    const device = await connectRadio(port);
    assert.deepEqual(commands, [0x32, 0x25, 0x2c, 0x0b]);
    assert.deepEqual(await device.backup(noop), radioImage);
    await device.flash(radioImage, noop);
    assert.deepEqual(flash.subarray(0, radioImage.length - 4), radioImage.subarray(4));
    assert.equal(flash[radioImage.length - 4], 0xff);
    await device.close();
});

test("JN5168 refuses other hardware and invalid bootloader checksums", async () => {
    for (const [options, message] of [
        [{chip: [0x10, 0x40, 0x87, 0x87]}, /puce détectée/],
        [{flashId: [0, 0]}, /mémoire interne/],
        [{damageChecksum: true}, /réponse inattendue/i],
    ]) {
        const {port, commands} = radioPort(options);
        await assert.rejects(connectRadio(port), message);
        assert.equal(commands.some((command) => command === 0x07 || command === 0x09), false);
        assert.equal(port.readable, undefined);
    }
});

test("JN5168 identifies supported chip revisions with extended bootloader replies", async () => {
    const {port} = radioPort({chip: [0x10, 0, 0x86, 0x86, 0, 0, 0], flashId: [0xcc, 0xee, 0]});
    const device = await connectRadio(port);
    await device.close();
});

test("JN5168 stops on a bad image, refused erase or readback mismatch", async () => {
    const refused = radioPort({refuseErase: true});
    const device = await connectRadio(refused.port);
    await assert.rejects(device.flash(radioImage.slice(0, -1), noop), /image du firmware/i);
    const wrongHeader = radioImage.slice();
    wrongHeader[4] ^= 1;
    await assert.rejects(device.flash(wrongHeader, noop), /image du firmware/i);
    assert.equal(refused.commands.includes(0x07), false);
    await assert.rejects(device.flash(radioImage, noop), /0xfe/);
    assert.equal(refused.commands.includes(0x09), false);
    await device.close();

    const damaged = await connectRadio(radioPort({damageReadback: true}).port);
    await assert.rejects(damaged.flash(radioImage, noop), /vérification radio échouée/i);
    await damaged.close();
});

test("the radio network reset sends erase only after identifying 3.23 OPDM", async () => {
    const versionQuery = [1, 2, 16, 16, 2, 16, 2, 16, 16, 3];
    const eraseCommand = [1, 2, 16, 18, 2, 16, 2, 16, 18, 3];
    const factoryNew = Uint8Array.of(1, 0x80, 2, 0x17, 2, 0x10, 2, 0x12, 0x85, 2, 0x10, 2, 0x10, 3);
    for (const version of [0x23, 0x22]) {
        let requestedErase = false;
        const versionFrame = Uint8Array.of(1, 0x80, 0x10, 2, 0x10, 2, 0x15,
            0x80 ^ 0x10 ^ 5 ^ 4 ^ 3 ^ version, 2, 0x10, 2, 0x14, 2, 0x13, version, 2, 0x10, 3);
        const port = serialPort((bytes, send) => {
            if (!requestedErase) {
                assert.deepEqual([...bytes], versionQuery);
                send(versionFrame);
            } else {
                assert.deepEqual([...bytes], eraseCommand);
                send(factoryNew);
            }
        }, (baudRate) => assert.equal(baudRate, 115200));
        const reset = resetRadioNetwork(port, () => { requestedErase = true; });
        if (version === 0x23) await reset;
        else await assert.rejects(reset, /version radio attendue/i);
        assert.equal(requestedErase, version === 0x23);
        assert.equal(port.readable, undefined);
    }
});

test("ESP8266 checks the chip, memory size and MD5 before confirming flash", async (t) => {
    let chip = "ESP32";
    let jedecId = 0x1540ef;
    let flashCalls = 0;
    const spi = {
        command: 0x60000200,
        user: 0x6000021c,
        user1: 0x60000220,
        user2: 0x60000224,
        data: 0x60000240,
    };
    const registers = new Map();
    t.mock.method(ESPLoader.prototype, "detectChip", async function (mode) {
        assert.equal(mode, "no_reset");
        registers.clear();
        this.chip = chip === "ESP8266" ? await this.chipFromMagicValue() : {CHIP_NAME: chip};
    });
    t.mock.method(ESPLoader.prototype, "runStub", async function () { this.IS_STUB = true; });
    t.mock.method(ESPLoader.prototype, "readReg", async (address) => {
        if (address === 0x40001000) return 0xfff0c101;
        return registers.get(address) ?? 0;
    });
    t.mock.method(ESPLoader.prototype, "writeReg", async (address, value) => {
        if (address === spi.command) {
            assert.equal(value, 1 << 18, "Only SPI_USR may be written to the command register");
            assert.equal(registers.get(spi.user) >>> 0, 0x90000000);
            assert.equal(registers.get(spi.user1), 23 << 8);
            assert.equal(registers.get(spi.user2), 0x7000009f);
            assert.equal(registers.get(spi.data), 0);
            registers.set(spi.data, jedecId);
            return;
        }
        registers.set(address, value);
    });
    t.mock.method(ESPLoader.prototype, "writeFlash", async function (options) {
        flashCalls++;
        assert.deepEqual(options.fileArray, [{data: wifiImage, address: 0}]);
        assert.equal(options.eraseAll, false);
        assert.equal(options.flashSize, "4MB");
        assert.equal(options.calculateMD5Hash(wifiImage), createHash("md5").update(wifiImage).digest("hex"));
    });
    const port = {getInfo: () => ({})};
    await assert.rejects(connectWifi(port), /puce détectée/);
    chip = "ESP8266";
    await assert.rejects(connectWifi(port), /2 Mo.*exige 4 Mo.*EF4015/);
    jedecId = 0;
    await assert.rejects(connectWifi(port), /ne répond pas.*000000/);
    jedecId = 0xffffff;
    await assert.rejects(connectWifi(port), /ne répond pas.*FFFFFF/);
    jedecId = 0x5540ef;
    await assert.rejects(connectWifi(port), /capacité inconnue.*EF4055/);
    jedecId = 0x1640ef;
    const device = await connectWifi(port);
    await assert.rejects(device.flash(radioImage, noop), /image Wi-Fi/);
    assert.equal(flashCalls, 0);
    await device.flash(wifiImage, noop);
    assert.equal(flashCalls, 1);

    const backup = new Uint8Array(4 * 1024 * 1024);
    t.mock.method(ESPLoader.prototype, "readFlash", async () => backup);
    t.mock.method(Transport.prototype, "read", async () => new Uint8Array(16));
    await assert.rejects(device.backup(noop), /ne correspond pas/);
    Transport.prototype.read.mock.mockImplementation(async () => createHash("md5").update(backup).digest());
    assert.equal(await device.backup(noop), backup);
});

test("Wi-Fi setup reads the actual firmware log format across USB packets", async () => {
    const line = "Configuration Wi-Fi : ZIGATE-ABCDEF | cle WPA2 : 1234567890abcdef | http://192.168.4.1/";
    const port = serialPort(noop, (baudRate, send) => {
        assert.equal(baudRate, 115200);
        send(new TextEncoder().encode(`\r\n${line}\r\n`));
    });
    assert.deepEqual(await readWifiSetup(port), {ssid: "ZIGATE-ABCDEF", password: "1234567890abcdef"});
    assert.deepEqual(parseWifiLine("ZiGate Wi-Fi Z2M 1.0.0 | IP : 192.168.1.77"), {ip: "192.168.1.77"});
    for (const value of ["0.0.0.0", "192.168.01.2", "192.168.0.256", "192.168.1.4:9999"]) assert.equal(validIpv4(value), false);
    assert.equal(port.readable, undefined);
});

test("USB Wi-Fi setup waits for the firmware and returns the confirmed IP", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const commands = [];
    const port = serialPort((bytes, send) => {
        commands.push(decoder.decode(bytes));
        if (commands.length === 1) {
            send(encoder.encode("\r\nZIGATE-WIFI/1 READY\r\n"));
        } else {
            send(encoder.encode("ZIGATE-WIFI/1 OK 192.168.1.77\r\n"));
        }
    }, (baudRate) => assert.equal(baudRate, 115200));
    assert.equal(await configureWifi(port, "Réseau été", " abc:def ", () => assert.equal(commands.length, 1)), "192.168.1.77");
    assert.deepEqual(commands, ["\nZIGATE-WIFI/1 HELLO\n", "ZIGATE-WIFI/1 SET 52c3a97365617520c3a974c3a9 206162633a64656620\n"]);
    assert.equal(port.readable, undefined);
});

test("USB Wi-Fi setup reports a rejected connection and releases the port", async () => {
    const encoder = new TextEncoder();
    const port = serialPort((bytes, send) => {
        const command = new TextDecoder().decode(bytes);
        const reply = command.includes("HELLO") ? "READY" : "ERROR CONNECT";
        send(encoder.encode(`ZIGATE-WIFI/1 ${reply}\r\n`));
    });
    await assert.rejects(configureWifi(port, "Réseau", "motdepasse", noop), /réglages précédents sont conservés/);
    assert.equal(port.readable, undefined);
    assert.equal(wifiInputErrors("é".repeat(16), "").ssid, "");
    assert.notEqual(wifiInputErrors("é".repeat(17), "").ssid, "");
    assert.notEqual(wifiInputErrors("Réseau", "invalid").password, "");
    assert.equal(wifiInputErrors("Réseau", "f".repeat(64)).password, "");
    assert.notEqual(wifiInputErrors("Réseau", "g".repeat(64)).password, "");
});
