import {openSerial} from "./serial.js";

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

export async function readWifiSetup(port) {
    const serial = await openSerial(port, 115200);
    try {
        const deadline = Date.now() + 18000;
        let line = "";
        while (Date.now() < deadline) {
            const [byte] = await serial.readExact(1, Math.max(1, deadline - Date.now()));
            if (byte === 10 || byte === 13) {
                const result = parseWifiLine(line);
                if (result) return result;
                line = "";
            } else if (byte >= 32 && byte <= 126) {
                line = (line + String.fromCharCode(byte)).slice(-200);
            }
        }
    } catch (error) {
        if (error.name !== "TimeoutError") throw error;
    } finally {
        await serial.close().catch(() => {});
    }
    throw new Error("Aucun message Wi-Fi reçu. Rebranche l’ESP8266 sans maintenir son bouton. S’il est déjà connecté, retrouve son adresse dans ton routeur.");
}
