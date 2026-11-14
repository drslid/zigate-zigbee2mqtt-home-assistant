import {openSerial} from "./serial.js";

const baudRate = 115200;
const usbTimeout = 35000;
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
    throw new DOMException("Le module ne répond pas sur le port série.", "TimeoutError");
}

export async function readWifiSetup(port) {
    const serial = await openSerial(port, baudRate);
    try {
        return await readWifiResult(serial, 18000, parseWifiLine);
    } catch (error) {
        if (error.name !== "TimeoutError") throw error;
        throw new Error("Aucun message Wi-Fi reçu. Rebranche l’ESP8266 sans maintenir son bouton. S’il est déjà connecté, retrouve son adresse dans ton routeur.");
    } finally {
        await serial.close().catch(() => {});
    }
}

export function wifiInputErrors(ssid, password) {
    const ssidBytes = encoder.encode(ssid).length;
    const invalidSsid = ssidBytes === 0 || ssidBytes > 32 || /[\u0000-\u001f\u007f]/.test(ssid);
    const validPassword = password === "" || /^[ -~]{8,63}$/.test(password) || /^[0-9a-f]{64}$/i.test(password);
    return {
        ssid: invalidSsid ? "Saisis un nom de réseau de 1 à 32 octets." : "",
        password: validPassword ? "" : "Saisis un mot de passe de 8 à 63 caractères ASCII ou une clé hexadécimale de 64 caractères.",
    };
}

function hexWifiField(value) {
    return Array.from(encoder.encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function configureWifi(port, ssid, password, onConnect) {
    const errors = wifiInputErrors(ssid, password);
    if (errors.ssid || errors.password) throw new Error(errors.ssid || errors.password);
    const serial = await openSerial(port, baudRate);
    try {
        // Identify the ZiGate firmware before sending any credentials to the selected port.
        await serial.write(encoder.encode(`\n${setupSignature} HELLO\n`));
        await readWifiResult(serial, 3500, (line) => line === `${setupSignature} READY`).catch((error) => {
            if (error.name !== "TimeoutError") throw error;
            throw new Error("Le module ne répond pas. Vérifie le port USB et le firmware Wi-Fi 1.1.0. S’il est déjà connecté au Wi-Fi, maintiens son bouton 2 secondes pendant qu’il est branché, puis réessaie.");
        });

        onConnect();
        await serial.write(encoder.encode(`${setupSignature} SET ${hexWifiField(ssid)} ${hexWifiField(password)}\n`));
        const response = await readWifiResult(serial, usbTimeout, (line) => line.startsWith(`${setupSignature} `) && line.slice(setupSignature.length + 1));
        if (response.startsWith("OK ") && validIpv4(response.slice(3))) return response.slice(3);
        const messages = {
            "ERROR CONNECT": "Connexion Wi-Fi impossible. Vérifie le nom et le mot de passe du réseau 2,4 GHz, puis réessaie. Les réglages précédents sont conservés.",
            "ERROR INVALID": "Le module a refusé les identifiants Wi-Fi. Vérifie les champs et réessaie.",
            "ERROR STORAGE": "La carte n’a pas pu enregistrer les réglages Wi-Fi. Réessaie avec le module rebranché.",
        };
        throw new Error(messages[response] ?? "Réponse Wi-Fi inattendue. Vérifie l’adresse de la ZiGate dans ta box avant de réessayer.");
    } catch (error) {
        if (error.name !== "TimeoutError") throw error;
        throw new Error("Le module n’a pas confirmé l’enregistrement. Vérifie s’il apparaît dans ta box, puis réessaie si besoin.");
    } finally {
        await serial.close().catch(() => {});
    }
}
