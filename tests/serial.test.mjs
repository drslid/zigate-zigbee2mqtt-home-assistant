import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {ESPLoader, Transport} from "../assets/esp-tools.js";
import {connectRadio, resetRadioNetwork} from "../radio.js";
import {parseWifiLine, readWifiSetup, validIpv4} from "../wifi-setup.js";
import {connectWifi} from "../wifi.js";

const radioImage = new Uint8Array(await readFile(new URL("../firmwares/ZiGate-Radio-JN5168-v3.23-OPDM-Z2M.bin", import.meta.url)));
const wifiImage = new Uint8Array(await readFile(new URL("../firmwares/ZiGate-WiFi-v1.3-Z2M-ESP8266-1.0.0.bin", import.meta.url)));
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

test("JN5168 stops on a bad image, refused erase or readback mismatch", async () => {
    const refused = radioPort({refuseErase: true});
    const device = await connectRadio(refused.port);
    await assert.rejects(device.flash(radioImage.slice(0, -1), noop), /image du firmware/i);
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
    let size = "2MB";
    let flashCalls = 0;
    t.mock.method(ESPLoader.prototype, "detectChip", async function (mode) {
        assert.equal(mode, "no_reset");
        this.chip = {CHIP_NAME: chip};
    });
    t.mock.method(ESPLoader.prototype, "runStub", async function () { this.IS_STUB = true; });
    t.mock.method(ESPLoader.prototype, "detectFlashSize", async () => size);
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
    await assert.rejects(connectWifi(port), /exige 4 Mo/);
    size = "4MB";
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
