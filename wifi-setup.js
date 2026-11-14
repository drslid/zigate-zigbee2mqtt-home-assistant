import {LocalizedError, t} from "./languages.js?v=2";
import {openSerial} from "./serial.js";

const baudRate = 115200;
const usbTimeout = 42000;
const setupSignature = "ZIGATE-WIFI/1";
const encoder = new TextEncoder();

export function parseWifiLine(line) {
    const setup = line.match(/Configuration Wi-Fi\s*:\s*(ZIGATE-[0-9a-f]{6})\s*\|\s*cle WPA2\s*:\s*([0-9a-f]{16})\s*\|/i);
    if (setup) return {ssid: setup[1], password: setup[2]};
    const ready = line.match(/ZiGate Wi-Fi Z2M .*?\|\s*IP\s*:\s*((?:\d{1,3}\.){3}\d{1,3})/i);
    if (ready && validIpv4(ready[1])) return {ip: ready[1]};
    return undefined;
}

export function validIpv4(value) {
    const parts = value.split(".");
    return parts.length === 4 && parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255) && value !== "0.0.0.0";
}

async function readWifiResult(serial, timeout, parseLine) {
    const deadline = Date.now() + timeout;
    let line = "";
    while (Date.now() < deadline) {
        const [byte] = await serial.readExact(1, Math.max(1, deadline - Date.now()));
        if (byte === 10 || byte === 13) {
            const result = parseLine(line);
            if (result) return result;
            line = "";
        } else if (byte >= 32 && byte <= 126) {
            line = (line + String.fromCharCode(byte)).slice(-224);
        }
    }
    throw new DOMException(t("serialTimeout"), "TimeoutError");
}

export async function readWifiSetup(port) {
    const serial = await openSerial(port, baudRate);
    try {
        return await readWifiResult(serial, 18000, parseWifiLine);
    } catch (error) {
        if (error.name !== "TimeoutError") throw error;
        throw new LocalizedError("wifiSetupNoMessage");
    } finally {
        await serial.close().catch(() => {});
    }
}

function wifiInputErrorKeys(ssid, password) {
    const ssidBytes = encoder.encode(ssid).length;
    const invalidSsid = ssidBytes === 0 || ssidBytes > 32 || /[\u0000-\u001f\u007f]/.test(ssid);
    const validPassword = password === "" || /^[ -~]{8,63}$/.test(password) || /^[0-9a-f]{64}$/i.test(password);
    return {
        ssid: invalidSsid ? "invalidSsid" : "",
        password: validPassword ? "" : "invalidPassword",
    };
}

export function wifiInputErrors(ssid, password) {
    const errors = wifiInputErrorKeys(ssid, password);
    return {ssid: errors.ssid ? t(errors.ssid) : "", password: errors.password ? t(errors.password) : ""};
}

function hexWifiField(value) {
    return Array.from(encoder.encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function waitForWifiModule(serial) {
    const hello = encoder.encode(`\n${setupSignature} HELLO\n`);
    for (let attempt = 0; attempt < 3; attempt++) {
        await serial.write(hello);
        try {
            await readWifiResult(serial, 1200, (line) => line === `${setupSignature} READY`);
            return;
        } catch (error) {
            if (error.name !== "TimeoutError") throw error;
        }
    }
    throw new LocalizedError("wifiHelloFailed");
}

export async function configureWifi(port, ssid, password, onConnect) {
    const errors = wifiInputErrorKeys(ssid, password);
    if (errors.ssid || errors.password) throw new LocalizedError(errors.ssid || errors.password);
    const serial = await openSerial(port, baudRate);
    try {
        // Identify the ZiGate firmware before sending any credentials to the selected port.
        await waitForWifiModule(serial);

        onConnect();
        await serial.write(encoder.encode(`${setupSignature} SET ${hexWifiField(ssid)} ${hexWifiField(password)}\n`));
        const response = await readWifiResult(serial, usbTimeout, (line) => {
            if (line.startsWith(`${setupSignature} OK `) || line.startsWith(`${setupSignature} ERROR `)) {
                return line.slice(setupSignature.length + 1);
            }
        });
        if (response.startsWith("OK ") && validIpv4(response.slice(3))) return response.slice(3);
        const messages = {
            "ERROR CONNECT": "wifiConnectFailed",
            "ERROR INVALID": "wifiCredentialsRejected",
            "ERROR STORAGE": "wifiStorageFailed",
        };
        throw new LocalizedError(messages[response] ?? "wifiUnexpectedReply");
    } catch (error) {
        if (error.name !== "TimeoutError") throw error;
        throw new LocalizedError("wifiSaveTimeout");
    } finally {
        await serial.close().catch(() => {});
    }
}
