// Wi-Fi bridge for the ZiGate v1.3 board. The UART wiring, baud rate and TCP
// port follow the original WZiGatev1.3 firmware by the ZiGate project.

#include <Arduino.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <LittleFS.h>

#include "BridgePipe.h"

namespace {

constexpr uint32_t kBaud = 115200;
constexpr uint16_t kBridgePort = 9999;
constexpr uint32_t kReconnectMs = 20000;
constexpr uint32_t kSetupAfterMs = 45000;
constexpr uint32_t kSetupNoticeMs = 5000;
constexpr uint32_t kListenRetryMs = 1000;
constexpr uint32_t kRestartDelayMs = 1500;
constexpr uint32_t kUsbSetupWindowMs = 8000;
constexpr uint32_t kUsbWifiConnectMs = 30000;
constexpr size_t kUartBuffer = 2048;
constexpr uint8_t kUsbTxPin = 1;
constexpr uint8_t kUsbRxPin = 3;
constexpr uint8_t kRadioTxPin = 15;
constexpr uint8_t kRadioRxPin = 13;
constexpr char kConfigPath[] = "/zigate-wifi-v1.cfg";
constexpr char kTempConfigPath[] = "/zigate-wifi.tmp";
const IPAddress kSetupAddress(192, 168, 4, 1);
const IPAddress kSetupMask(255, 255, 255, 0);

const char kSetupPage[] PROGMEM = R"html(<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configuration Wi-Fi ZiGate</title><style>
body{font:1rem system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:30rem}
label{display:block;margin:1rem 0}input,button{font:inherit;padding:.45rem}input{display:block;width:95%;max-width:25rem}
fieldset{margin:1.5rem 0;border:1px solid #777}button{padding:.5rem 1rem}</style></head>
<body><h1>Wi-Fi ZiGate</h1><form method="post" action="/save">
<label>Nom du réseau 2,4 GHz <input name="ssid" maxlength="32" required></label>
<label>Mot de passe <input name="password" type="password" maxlength="64"></label>
<fieldset><legend>Adresse IP fixe</legend><p>Laisse ces trois champs vides pour utiliser le DHCP.</p>
<label>Adresse IP <input name="ip" maxlength="15" placeholder="192.168.1.50"></label>
<label>Masque <input name="mask" maxlength="15" placeholder="255.255.255.0"></label>
<label>Passerelle <input name="gateway" maxlength="15" placeholder="192.168.1.1"></label>
</fieldset><button>Enregistrer et redémarrer</button></form></body></html>)html";

struct WifiConfig {
    char ssid[33]{};
    char password[65]{};
    char ip[16]{};
    char mask[16]{};
    char gateway[16]{};
};

WifiConfig wifiConfig;
WiFiServer bridgeServer(kBridgePort);
ESP8266WebServer setupServer(kSetupAddress, 80);
WiFiClient zigbeeClient;
BridgePipe<2048> toRadio;
BridgePipe<2048> toTcp;
char setupName[20];
char setupPassword[17];
bool storageReady = false;
bool configured = false;
bool setupActive = false;
bool bridgeOnline = false;
bool radioUartActive = false;
bool radioFault = false;
bool restartPending = false;
bool usbSetupActive = false;
IPAddress bridgeAddress;
uint32_t offlineSince = 0;
uint32_t lastReconnectAttempt = 0;
uint32_t lastSetupAttempt = 0;
uint32_t lastSetupNotice = 0;
uint32_t lastListenAttempt = 0;
uint32_t savedAt = 0;
uint32_t usbSetupSince = 0;

template <size_t Size>
bool readField(const char* field, char (&out)[Size]) {
    const String value = setupServer.arg(field);
    if (value.length() >= Size || strlen(value.c_str()) != value.length()) {
        return false;
    }
    memcpy(out, value.c_str(), value.length() + 1);
    return true;
}

bool parseAddresses(const WifiConfig& config, IPAddress& ip, IPAddress& mask, IPAddress& gateway) {
    if (config.ip[0] == '\0' && config.mask[0] == '\0' && config.gateway[0] == '\0') {
        return true;
    }
    if (!ip.fromString(config.ip) || !ip.isV4() || !ip.isSet() ||
        !mask.fromString(config.mask) || !mask.isV4() || !mask.isSet() ||
        !gateway.fromString(config.gateway) || !gateway.isV4() || !gateway.isSet()) {
        return false;
    }
    const uint32_t hostMask = ~ntohl(mask.v4());
    return (hostMask & (hostMask + 1)) == 0 && (ip.v4() & mask.v4()) == (gateway.v4() & mask.v4());
}

bool validConfig(const WifiConfig& config) {
    if (!memchr(config.ssid, '\0', sizeof(config.ssid)) || config.ssid[0] == '\0' ||
        !memchr(config.password, '\0', sizeof(config.password)) ||
        !memchr(config.ip, '\0', sizeof(config.ip)) ||
        !memchr(config.mask, '\0', sizeof(config.mask)) ||
        !memchr(config.gateway, '\0', sizeof(config.gateway))) {
        return false;
    }

    const size_t length = strlen(config.password);
    if (length != 0 && length < 8) {
        return false;
    }
    for (const char* c = config.password; *c; ++c) {
        if (*c < ' ' || *c > '~' ||
            (length == 64 && !isxdigit(static_cast<unsigned char>(*c)))) {
            return false;
        }
    }

    IPAddress ip, mask, gateway;
    return parseAddresses(config, ip, mask, gateway);
}

bool loadConfig() {
    File file = LittleFS.open(kConfigPath, "r");
    return file && file.size() == sizeof(wifiConfig) &&
           file.read(reinterpret_cast<uint8_t*>(&wifiConfig), sizeof(wifiConfig)) == sizeof(wifiConfig) &&
           validConfig(wifiConfig);
}

bool saveConfig(const WifiConfig& config) {
    if (!storageReady) {
        return false;
    }
    File file = LittleFS.open(kTempConfigPath, "w");
    if (!file) {
        return false;
    }
    const bool complete = file.write(reinterpret_cast<const uint8_t*>(&config), sizeof(config)) == sizeof(config);
    file.close();

    WifiConfig written;
    File check = LittleFS.open(kTempConfigPath, "r");
    const bool verified = complete && check && check.size() == sizeof(written) &&
                          check.read(reinterpret_cast<uint8_t*>(&written), sizeof(written)) == sizeof(written) &&
                          memcmp(&config, &written, sizeof(config)) == 0;
    check.close();
    if (verified && LittleFS.rename(kTempConfigPath, kConfigPath)) {
        return true;
    }
    LittleFS.remove(kTempConfigPath);
    return false;
}

void handleSaveConfig() {
    if (restartPending) {
        setupServer.send(409, "text/plain; charset=utf-8", "Redémarrage en cours.");
        return;
    }

    WifiConfig next;
    if (!readField("ssid", next.ssid) || !readField("password", next.password) ||
        !readField("ip", next.ip) || !readField("mask", next.mask) ||
        !readField("gateway", next.gateway) || !validConfig(next)) {
        setupServer.send(400, "text/plain; charset=utf-8", "Vérifie le nom du réseau, le mot de passe et les trois champs IP.");
        return;
    }
    if (!saveConfig(next)) {
        setupServer.send(500, "text/plain; charset=utf-8", "La configuration n’a pas pu être enregistrée.");
        return;
    }
    setupServer.sendHeader("Connection", "close");
    setupServer.send(200, "text/plain; charset=utf-8", "Configuration enregistrée. La ZiGate redémarre.");
    savedAt = millis();
    restartPending = true;
}

void printSetupAddress() {
    Serial.printf("Configuration Wi-Fi : %s | cle WPA2 : %s | http://192.168.4.1/\r\n", setupName, setupPassword);
    lastSetupNotice = millis();
}

void setupWifiAP() {
    lastSetupAttempt = millis();
    if (setupPassword[0] == '\0') {
        const uint32_t first = ESP.random();
        const uint32_t second = ESP.random();
        snprintf(setupPassword, sizeof(setupPassword), "%08lx%08lx",
                 static_cast<unsigned long>(first), static_cast<unsigned long>(second));
    }
    if (!WiFi.mode(configured && !radioFault ? WIFI_AP_STA : WIFI_AP) ||
        !WiFi.softAPConfig(kSetupAddress, kSetupAddress, kSetupMask) ||
        !WiFi.softAP(setupName, setupPassword, 1, false, 2)) {
        WiFi.mode(configured && !radioFault ? WIFI_STA : WIFI_OFF);
        Serial.println(F("Impossible de démarrer le point d’accès Wi-Fi."));
        return;
    }
    setupServer.begin();
    setupActive = true;
    printSetupAddress();
}

void setupSTAWifi(const WifiConfig& config) {
    if (!WiFi.enableSTA(true)) {
        return;
    }
    WiFi.setAutoReconnect(true);
    WiFi.hostname(setupName);
    IPAddress ip, mask, gateway;
    if (config.ip[0] == '\0') {
        WiFi.config(IPAddress(0U), IPAddress(0U), IPAddress(0U));
    } else if (!parseAddresses(config, ip, mask, gateway) || !WiFi.config(ip, gateway, mask)) {
        Serial.println(F("Adresse fixe refusée. Utilisation du DHCP."));
        WiFi.config(IPAddress(0U), IPAddress(0U), IPAddress(0U));
    }
    WiFi.begin(config.ssid, config.password);
}

void discardSerialInput() {
    uint8_t discard[128];
    size_t remaining = kUartBuffer + sizeof(discard);
    while (remaining > 0 && Serial.available() > 0) {
        const size_t count = std::min({remaining, sizeof(discard), static_cast<size_t>(Serial.available())});
        const int read = Serial.read(discard, count);
        if (read <= 0) break;
        remaining -= static_cast<size_t>(read);
    }
    Serial.hasOverrun();
    Serial.hasRxError();
}

bool selectRadioUart(bool enable) {
    if (enable == radioUartActive) return true;
    Serial.flush();
    if (!Serial.pins(enable ? kRadioTxPin : kUsbTxPin, enable ? kRadioRxPin : kUsbRxPin)) {
        radioFault = true;
        if (!radioUartActive) Serial.println(F("Impossible d’activer l’UART du module radio."));
        return false;
    }
    radioUartActive = enable;
    // Hold the idle TX line high while UART0 is serving the other connector.
    const uint8_t idleTx = enable ? kUsbTxPin : kRadioTxPin;
    digitalWrite(idleTx, HIGH);
    pinMode(idleTx, OUTPUT);
    discardSerialInput();
    return true;
}

void closeClient() {
    zigbeeClient = WiFiClient();
    toRadio.clear();
    toTcp.clear();
    selectRadioUart(false);
}

void stopWifiAP() {
    if (setupActive) {
        setupServer.client().stop(1);
        setupServer.stop();
        WiFi.enableAP(false);
        setupActive = false;
    }
}

void startBridge(const IPAddress& address) {
    lastListenAttempt = millis();
    stopWifiAP();
    bridgeServer.setNoDelay(true);
    bridgeServer.begin(kBridgePort, 2);
    if (bridgeServer.status() != LISTEN) {
        Serial.println(F("Port TCP 9999 indisponible."));
        return;
    }
    bridgeAddress = address;
    bridgeOnline = true;
    Serial.print(F("ZiGate Wi-Fi Z2M 1.1.1 | IP : "));
    Serial.println(address);
}

void stopBridge() {
    closeClient();
    bridgeServer.stop();
    while (bridgeServer.hasClient()) {
        bridgeServer.accept();
    }
    bridgeOnline = false;
}

void openUsbSetup() {
    if (bridgeOnline) {
        stopBridge();
    }
    usbSetupActive = true;
    usbSetupSince = millis();
}

int hexDigit(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    return -1;
}

template <size_t Size>
bool readHex(const char* text, size_t length, char (&out)[Size]) {
    if (length % 2 != 0 || length / 2 >= Size) return false;
    for (size_t i = 0; i < length; i += 2) {
        const int high = hexDigit(text[i]);
        const int low = hexDigit(text[i + 1]);
        if (high < 0 || low < 0 || (high == 0 && low == 0)) return false;
        out[i / 2] = static_cast<char>(high * 16 + low);
    }
    out[length / 2] = '\0';
    return true;
}

void restoreWifi() {
    WiFi.disconnect(true);
    if (configured) {
        setupSTAWifi(wifiConfig);
    } else {
        setupWifiAP();
    }
    offlineSince = lastReconnectAttempt = millis();
    usbSetupSince = offlineSince;
}

void saveUsbWifi(const WifiConfig& next) {
    if (!storageReady) {
        Serial.println(F("ZIGATE-WIFI/1 ERROR STORAGE"));
        return;
    }

    stopWifiAP();
    WiFi.disconnect(true);
    IPAddress address;
    {
        const auto gotIp = WiFi.onStationModeGotIP([&address](const WiFiEventStationModeGotIP& event) {
            address = event.ip;
        });
        setupSTAWifi(next);
        const uint32_t startedAt = millis();
        while (millis() - startedAt < kUsbWifiConnectMs &&
               (!address.isSet() || WiFi.status() != WL_CONNECTED || WiFi.localIP() != address)) {
            delay(25);
        }
    }

    if (!address.isSet() || WiFi.status() != WL_CONNECTED || WiFi.localIP() != address) {
        restoreWifi();
        Serial.println(F("ZIGATE-WIFI/1 ERROR CONNECT"));
        return;
    }
    if (!saveConfig(next)) {
        restoreWifi();
        Serial.println(F("ZIGATE-WIFI/1 ERROR STORAGE"));
        return;
    }

    wifiConfig = next;
    configured = true;
    Serial.print(F("ZIGATE-WIFI/1 OK "));
    Serial.println(address);
    Serial.flush();
    usbSetupActive = false;
}

void handleUsbLine(const char* line) {
    constexpr char setPrefix[] = "ZIGATE-WIFI/1 SET ";
    if (strcmp(line, "ZIGATE-WIFI/1 HELLO") == 0) {
        openUsbSetup();
        Serial.println(F("ZIGATE-WIFI/1 READY"));
    } else if (usbSetupActive && strncmp(line, setPrefix, sizeof(setPrefix) - 1) == 0) {
        const char* ssid = line + sizeof(setPrefix) - 1;
        const char* separator = strchr(ssid, ' ');
        WifiConfig next;
        if (!separator || !readHex(ssid, separator - ssid, next.ssid) ||
            !readHex(separator + 1, strlen(separator + 1), next.password) || !validConfig(next)) {
            Serial.println(F("ZIGATE-WIFI/1 ERROR INVALID"));
            return;
        }
        saveUsbWifi(next);
    }
}

void serviceUsbSerial() {
    static char line[224];
    static size_t length = 0;
    static bool overflow = false;
    for (size_t read = 0; read < sizeof(line) && Serial.available(); ++read) {
        const int byte = Serial.read();
        if (byte < 0) break;
        if (byte == '\n' || byte == '\r') {
            if (!overflow && length > 0) {
                line[length] = '\0';
                handleUsbLine(line);
            }
            memset(line, 0, length);
            overflow = false;
            length = 0;
        } else if (!overflow) {
            if (byte < ' ' || byte > '~' || length == sizeof(line) - 1) {
                overflow = true;
            } else {
                line[length++] = static_cast<char>(byte);
            }
        }
    }
}

void serviceWifi() {
    const uint32_t now = millis();
    const IPAddress address = WiFi.localIP();
    if (configured && !radioFault && WiFi.status() == WL_CONNECTED && address.isSet()) {
        if (bridgeOnline && address != bridgeAddress) {
            stopBridge();
        }
        if (!bridgeOnline && !usbSetupActive && now - lastListenAttempt >= kListenRetryMs) {
            startBridge(address);
        }
        return;
    }

    if (bridgeOnline) {
        stopBridge();
        Serial.println(F("Wi-Fi déconnecté. Reconnexion en cours."));
        offlineSince = now;
        lastReconnectAttempt = now;
    }
    if (configured && !radioFault && now - lastReconnectAttempt >= kReconnectMs) {
        setupSTAWifi(wifiConfig);
        lastReconnectAttempt = now;
    }
    const bool needSetup = !configured || radioFault || now - offlineSince >= kSetupAfterMs;
    if (needSetup && !setupActive && now - lastSetupAttempt >= kSetupNoticeMs) {
        setupWifiAP();
    }
}

void serviceBridge() {
    // After a hardware overrun, reconnect to give Zigbee2MQTT a clean byte stream.
    if (radioUartActive && (!zigbeeClient.connected() || Serial.hasOverrun() || Serial.hasRxError())) {
        closeClient();
    }

    if (bridgeServer.hasClient()) {
        WiFiClient incoming = bridgeServer.accept();
        if (incoming.connected() && !radioUartActive && !radioFault && selectRadioUart(true)) {
            zigbeeClient = incoming;
            zigbeeClient.keepAlive(15, 5, 3);
            zigbeeClient.setTimeout(10);
        }
    }

    if (zigbeeClient.connected()) {
        toRadio.pump(zigbeeClient, Serial);
        toTcp.pump(Serial, zigbeeClient);
    }
}

}  // namespace

void setup() {
    Serial.setRxBufferSize(kUartBuffer);
    Serial.begin(kBaud, SERIAL_8N1);
    if (!Serial || Serial.getRxBufferSize() < kUartBuffer) {
        radioFault = true;
    }
    digitalWrite(kRadioTxPin, HIGH);
    pinMode(kRadioTxPin, OUTPUT);
    Serial.setDebugOutput(false);
    WiFi.persistent(false);
    WiFi.mode(WIFI_OFF);

    snprintf(setupName, sizeof(setupName), "ZIGATE-%06lX", static_cast<unsigned long>(ESP.getChipId()));
    storageReady = LittleFS.begin();
    configured = storageReady && loadConfig();
    if (!storageReady) {
        Serial.println(F("Stockage Wi-Fi indisponible."));
    }

    setupServer.on("/", HTTP_GET, []() {
        setupServer.sendHeader("Cache-Control", "no-store");
        setupServer.send_P(200, PSTR("text/html; charset=utf-8"), kSetupPage);
    });
    setupServer.on("/save", HTTP_POST, []() {
        const String& host = setupServer.hostHeader();
        if (host != "192.168.4.1" && host != "192.168.4.1:80") {
            setupServer.send(403, "text/plain; charset=utf-8", "Ouvre http://192.168.4.1/ pour configurer la ZiGate.");
            return;
        }
        handleSaveConfig();
    });

    offlineSince = millis();
    lastReconnectAttempt = offlineSince;
    if (configured && !radioFault) {
        setupSTAWifi(wifiConfig);
    } else {
        setupWifiAP();
    }
}

void loop() {
    if (restartPending) {
        if (millis() - savedAt >= kRestartDelayMs) {
            ESP.restart();
        }
    } else {
        if (usbSetupActive && millis() - usbSetupSince >= kUsbSetupWindowMs) {
            usbSetupActive = false;
        }
        // The ESP8266 UART is connected to USB until a TCP client takes the radio.
        if (!radioUartActive) {
            serviceUsbSerial();
        }
        serviceWifi();
        if (bridgeOnline) {
            serviceBridge();
        } else if (setupActive) {
            setupServer.handleClient();
            if (millis() - lastSetupNotice >= kSetupNoticeMs) {
                printSetupAddress();
            }
        }
    }
    yield();
}
