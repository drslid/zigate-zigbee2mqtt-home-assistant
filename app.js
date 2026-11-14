import {connectRadio, resetRadioNetwork} from "./radio.js?v=3";
import {configureWifi, readWifiSetup, validIpv4, wifiInputErrors} from "./wifi-setup.js?v=3";

const releases = {
    wifi: {
        title: "Branche le module Wi-Fi seul",
        instructions: [
            "Débranche la ZiGate et sépare la carte Wi-Fi de la radio.",
            "Pour flasher, maintiens le bouton près des broches en branchant l’USB, puis relâche-le.",
        ],
        version: "Wi-Fi 1.1.1",
        file: "ZiGate-WiFi-v1.3-Z2M-ESP8266-1.1.1.bin",
        sha256: "59d2c4a152af4257041bd724959994563e6a401ea095a31434891d0b11034409",
        backup: "sauvegarde-ZiGate-ESP8266.bin",
        installText: "Le firmware Wi-Fi va être remplacé. Garde le module branché jusqu’à la fin de la vérification.",
        next: "Firmware Wi-Fi installé. Rebranche le module bouton relâché, puis configure le Wi-Fi.",
    },
    radio: {
        title: "Branche le JN5168 sur son adaptateur USB-TTL",
        instructions: [
            "Débranche la ZiGate, sépare les cartes et monte la radio sur l’adaptateur USB-TTL du kit.",
            "Maintiens le bouton de la carte radio en branchant l’adaptateur, puis relâche-le.",
        ],
        version: "Radio 3.23 OPDM",
        file: "ZiGate-Radio-JN5168-v3.23-OPDM-Z2M.bin",
        sha256: "c6dce9820c03cb2f60ef22f147d4de86bf4525cf1139a5f80fed5ea62414a06a",
        backup: "sauvegarde-ZiGate-JN5168.bin",
        installText: "Le programme du JN5168 va être effacé puis réécrit. Garde le module branché jusqu’à la fin de la vérification.",
        next: "La radio est prête. Pour repartir de zéro, efface l’ancien réseau avant de remonter la ZiGate.",
    },
};

const byId = (id) => document.getElementById(id);
const targets = byId("targets");
const connect = byId("connect");
const backup = byId("backup");
const install = byId("install");
const disconnect = byId("disconnect");
const reset = byId("reset");
const wifiSetup = byId("wifi-setup");
const wifiForm = byId("wifi-form");
const wifiSsid = byId("wifi-ssid");
const wifiPassword = byId("wifi-password");
const wifiSave = byId("wifi-save");
const nextRadio = byId("next-radio");
const post = byId("post-install");
const dialog = byId("confirm-dialog");
const available = window.isSecureContext && "serial" in navigator;
let target = targets.querySelector('input[name="target"]:checked').value;
let connection;
let busy = false;
const installed = new Set();

function status(element, message, kind = "") {
    element.textContent = message;
    element.hidden = !message;
    element.dataset.kind = kind;
}

function updateControls() {
    targets.disabled = busy || Boolean(connection);
    connect.hidden = Boolean(connection);
    connect.disabled = busy || !available;
    for (const button of [backup, install, disconnect]) {
        button.hidden = !connection;
        button.disabled = busy;
    }
    reset.disabled = busy || !available || Boolean(connection);
    wifiSetup.disabled = busy || !available || Boolean(connection);
    for (const field of [wifiSsid, wifiPassword, wifiSave, nextRadio]) {
        field.disabled = busy || !available || Boolean(connection);
    }
}

function showNextStep() {
    const done = installed.has(target);
    post.textContent = releases[target].next;
    post.hidden = !done;
    byId("next-controls").hidden = !done;
    byId("next-wifi").hidden = target !== "wifi";
    byId("next-montage").hidden = target !== "radio";
    byId("reset-section").hidden = target !== "radio";
}

function showTarget() {
    const release = releases[target];
    byId("preparation-title").textContent = release.title;
    byId("preparation-steps").replaceChildren(...release.instructions.map((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
    }));
    byId("firmware-version").textContent = release.version;
    byId("firmware-download").href = `./firmwares/${release.file}`;
    byId("radio-port-help").hidden = target !== "radio";
    byId("wifi").hidden = target !== "wifi";
    showNextStep();
    status(byId("status"), "");
}

function showProgress(label, done, total) {
    const meter = byId("progress");
    byId("progress-area").hidden = false;
    if (byId("progress-caption").textContent !== label) byId("progress-caption").textContent = label;
    if (total > 0) {
        const percent = Math.min(100, Math.floor(100 * done / total));
        meter.value = percent;
        const number = `${percent} %`;
        if (byId("progress-number").textContent !== number) byId("progress-number").textContent = number;
    } else {
        meter.removeAttribute("value");
        byId("progress-number").textContent = "";
    }
}

async function run(output, operation, onError = () => {}, eraseMayHaveStarted = () => false) {
    if (busy) return;
    busy = true;
    updateControls();
    try {
        await operation();
    } catch (error) {
        const messages = {
            NotFoundError: "Aucun port série sélectionné.",
            SecurityError: "Le navigateur a bloqué l’accès USB. Ouvre la page GitHub Pages dans son propre onglet Chrome ou Edge.",
            NetworkError: "Le navigateur n’a pas pu accéder au port série. Ferme les autres outils série et vérifie le branchement USB.",
        };
        const recovery = eraseMayHaveStarted() ? " Si l’écriture a commencé, remets le module en mode flash et relance l’installation." : "";
        status(output, (messages[error.name] ?? error.message) + recovery, error.name === "NotFoundError" ? "" : "error");
        await onError();
    } finally {
        byId("progress-area").hidden = true;
        busy = false;
        updateControls();
    }
}

async function closeConnection() {
    const current = connection;
    connection = undefined;
    if (current) await current.device.close();
}

function confirmAction(title, description, action) {
    byId("confirm-title").textContent = title;
    byId("confirm-description").textContent = description;
    byId("confirm-action").textContent = action;
    dialog.returnValue = "";
    const confirmed = new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {once: true});
    });
    dialog.showModal();
    return confirmed;
}

async function readFirmware(release) {
    const response = await fetch(new URL(`./firmwares/${release.file}`, import.meta.url));
    if (!response.ok) throw new Error("Le firmware est indisponible. Réessaie ou télécharge le pack complet.");
    const image = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", image));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== release.sha256) throw new Error("Le fichier reçu ne correspond pas au firmware attendu.");
    return image;
}

function saveBackup(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], {type: "application/octet-stream"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

targets.addEventListener("change", (event) => {
    if (event.target.name !== "target") return;
    target = event.target.value;
    showTarget();
});

nextRadio.addEventListener("click", () => {
    const radio = targets.querySelector('input[value="radio"]');
    radio.checked = true;
    target = "radio";
    showTarget();
    radio.focus({preventScroll: true});
    byId("flash").scrollIntoView();
});

connect.addEventListener("click", () => run(byId("status"), async () => {
    const output = byId("status");
    post.hidden = true;
    status(output, "Sélectionne le port de la ZiGate.");
    const port = await navigator.serial.requestPort();
    status(output, target === "radio" ? "Ouverture du port série et identification du JN5168…" : "Identification du module…");
    const device = target === "wifi"
        ? await (await import("./wifi.js?v=2")).connectWifi(port)
        : await connectRadio(port);
    connection = {device, port};
    status(output, device.description, "ok");
}));

backup.addEventListener("click", () => run(byId("status"), async () => {
    status(byId("status"), target === "wifi" ? "Lecture des 4 Mo. Cette opération peut prendre plusieurs minutes." : "Lecture du firmware radio…");
    const data = await connection.device.backup((done, total) => showProgress("Sauvegarde du firmware", done, total));
    saveBackup(data, releases[target].backup);
    status(byId("status"), target === "wifi"
        ? "Sauvegarde Wi-Fi créée. Garde-la en local, elle peut contenir ta configuration Wi-Fi."
        : "Sauvegarde du programme radio créée. L’EEPROM des appairages est indépendante.", "ok");
}, () => closeConnection().catch(() => {})));

install.addEventListener("click", () => {
    let flashing = false;
    void run(byId("status"), async () => {
        const output = byId("status");
        const release = releases[target];
        if (!await confirmAction("Installer le firmware ?", release.installText, "Installer")) return;
        status(output, "Vérification du fichier téléchargé…");
        const data = await readFirmware(release);
        status(output, "Garde le module branché pendant l’installation.");
        flashing = true;
        await connection.device.flash(data, showProgress);
        await closeConnection().catch(() => {});
        installed.add(target);
        if (target === "radio") byId("reset-section").open = true;
        status(output, "Firmware installé et vérifié.", "ok");
        showNextStep();
    }, () => closeConnection().catch(() => {}), () => flashing);
});

disconnect.addEventListener("click", () => run(byId("status"), async () => {
    await closeConnection();
    status(byId("status"), "Port série libéré.");
}));

reset.addEventListener("click", () => run(byId("reset-status"), async () => {
    const output = byId("reset-status");
    if (!await confirmAction("Effacer le réseau Zigbee ?", "Les appairages et paramètres de l’ancien réseau seront effacés de la radio.", "Effacer le réseau")) return;
    status(output, "Sélectionne le port de la radio en mode normal.");
    const port = await navigator.serial.requestPort();
    status(output, "Vérification du firmware radio…");
    await resetRadioNetwork(port, () => status(output, "Effacement du réseau et redémarrage de la radio…"));
    status(output, "La radio a redémarré avec un réseau vierge. Tu peux remonter la ZiGate.", "ok");
}));

const ipInput = byId("zigate-ip");
const ipFeedback = byId("ip-feedback");
const ipValue = byId("zigate-ip-value");
const copyIp = byId("copy-ip");
const exampleIp = "192.168.1.50";
const ipHint = ipFeedback.textContent;

function updateAddress() {
    const value = ipInput.value.trim();
    const valid = validIpv4(value);
    const invalid = Boolean(value) && !valid;
    const port = `tcp://${valid ? value : exampleIp}:9999`;
    ipInput.setAttribute("aria-invalid", String(invalid));
    ipFeedback.textContent = invalid
        ? "Entre une adresse IPv4, par exemple 192.168.1.50."
        : ipHint;
    ipValue.textContent = valid ? value : "À renseigner";
    copyIp.disabled = !valid;
    byId("copy").disabled = invalid;
    byId("config-code").firstElementChild.textContent = `homeassistant:
  enabled: true
mqtt:
  base_topic: zigbee2mqtt_zigate
serial:
  adapter: zigate
  port: ${port}`;
}

function showZigateAddress(ip) {
    ipInput.value = ip;
    updateAddress();
}

ipInput.addEventListener("input", updateAddress);
for (const field of [wifiSsid, wifiPassword]) {
    field.addEventListener("input", () => field.setCustomValidity(""));
}

function showLinkedWifi() {
    if (window.location.hash === "#wifi-ap") byId("wifi-ap").open = true;
    if (window.location.hash === "#wifi" && target !== "wifi" && !busy && !connection) {
        targets.querySelector('input[value="wifi"]').checked = true;
        target = "wifi";
        showTarget();
        byId("wifi").scrollIntoView();
    }
}
window.addEventListener("hashchange", showLinkedWifi);
showLinkedWifi();

wifiForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const ssid = wifiSsid.value;
    const password = wifiPassword.value;
    const errors = wifiInputErrors(ssid, password);
    wifiSsid.setCustomValidity(errors.ssid);
    wifiPassword.setCustomValidity(errors.password);
    if (!wifiForm.reportValidity()) return;

    void run(byId("wifi-usb-status"), async () => {
        const output = byId("wifi-usb-status");
        status(output, "Sélectionne le port USB du module Wi-Fi.");
        const port = await navigator.serial.requestPort();
        status(output, "Vérification du firmware Wi-Fi…");
        const ip = await configureWifi(port, ssid, password, () => {
            status(output, "Connexion au Wi-Fi… Attends jusqu’à 30 secondes.");
        });
        wifiPassword.value = "";
        showZigateAddress(ip);
        nextRadio.hidden = !installed.has("wifi") || installed.has("radio");
        byId("wifi-next-ha").hidden = false;
        status(output, `Wi-Fi enregistré. La ZiGate est connectée à l’adresse ${ip}.`, "ok");
    });
});

wifiSetup.addEventListener("click", () => run(byId("wifi-status"), async () => {
    const output = byId("wifi-status");
    byId("wifi-credentials").hidden = true;
    byId("setup-ssid").textContent = "";
    byId("setup-password").textContent = "";
    status(output, "Sélectionne le port USB du module Wi-Fi en mode normal.");
    const port = await navigator.serial.requestPort();
    status(output, "Lecture du module Wi-Fi…");
    const result = await readWifiSetup(port);
    if (result.ip) {
        showZigateAddress(result.ip);
        status(output, `ZiGate connectée à l’adresse ${result.ip}. Tu peux copier cette adresse à l’étape 4.`, "ok");
    } else {
        byId("setup-ssid").textContent = result.ssid;
        byId("setup-password").textContent = result.password;
        byId("wifi-credentials").hidden = false;
        status(output, "Point d’accès trouvé. Connecte ton ordinateur à ce réseau.", "ok");
    }
}));

if (available) {
    navigator.serial.addEventListener("disconnect", (event) => {
        if (!busy && event.target === connection?.port) {
            void run(byId("status"), async () => {
                await closeConnection().catch(() => {});
                status(byId("status"), "Module déconnecté.");
            });
        }
    });
} else {
    const notice = byId("browser-notice");
    notice.textContent = "Le flash et la configuration USB demandent Chrome ou Edge sur ordinateur et une page ouverte en HTTPS ou sur localhost. Les fichiers .bin restent téléchargeables.";
    notice.hidden = false;
    byId("wifi-form-note").textContent = "Ouvre cette page dans Chrome ou Edge sur ordinateur pour utiliser l’USB.";
}

function bindCopy(button, source) {
    const label = button.textContent;
    let timer;
    button.addEventListener("click", async () => {
        clearTimeout(timer);
        try {
            await navigator.clipboard.writeText(source.textContent);
            button.textContent = "Copié";
        } catch {
            const range = document.createRange();
            range.selectNodeContents(source);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            button.textContent = "Sélectionné";
        }
        timer = setTimeout(() => { button.textContent = label; }, 1800);
    });
}

bindCopy(byId("copy"), byId("config-code"));
bindCopy(copyIp, ipValue);
bindCopy(byId("copy-password"), byId("setup-password"));
showTarget();
updateAddress();
updateControls();
