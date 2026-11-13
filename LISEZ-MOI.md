# ZiGate Wi‑Fi v1.3 pour Zigbee2MQTT

Version d’essai 1.0.0 pour la ZiGate équipée du module Zigbee Meshreen **MS5168‑M05 (NXP JN5168)** et du module Wi‑Fi **ESP8266 / ESP‑12F**. Les deux binaires ont été compilés pour ces cibles. Le flash et l’appairage restent à vérifier sur la carte physique.

| Fichier | Carte à programmer | Base |
| --- | --- | --- |
| `firmwares/ZiGate-WiFi-v1.3-Z2M-ESP8266-1.0.0.bin` | Carte Wi‑Fi portant le module `ESP8266MOD` | Schéma et fonctionnement du firmware Wi‑Fi ZiGate v1.3 |
| `firmwares/ZiGate-Radio-JN5168-v3.23-OPDM-Z2M.bin` | Carte radio portant l’étiquette `MS5168-M05` | Firmware radio ZiGate v3.23 OPDM |

Le firmware Wi‑Fi transmet les trames ZiGate sur TCP `9999` et utilise l’UART à `115200` bauds sur GPIO15 TX / GPIO13 RX. Il retente le Wi‑Fi en arrière-plan, limite le pont à un client et conserve les octets en cas d’écriture partielle. Le firmware radio rejette les trames tronquées, accepte l’encodage de `0x10` employé par le pilote Zigbee2MQTT et reconnaît son format de configuration de la clé réseau lors de la formation d’un réseau neuf.

## 1. Programmer le module Wi‑Fi

1. Débranche la ZiGate et sépare les deux cartes. Sur la **carte ESP8266 seule**, maintiens le bouton près des broches pendant le branchement USB, puis relâche-le. [Procédure ZiGate](https://zigate.fr/documentation/mise-a-jour-module-wifi/)
2. Dans le dossier extrait, installe `esptool` et interroge la mémoire. Remplace `PORT_WIFI` par le port affiché par ton ordinateur, par exemple `COM5` sous Windows ou `/dev/ttyUSB0` sous Linux. Sous Windows, `py` peut remplacer `python`.

   ```sh
   python -m pip install esptool==4.9.0
   python -m esptool --chip esp8266 --port PORT_WIFI --baud 115200 flash_id
   ```

3. L’identification doit afficher **ESP8266** et **4 MB**. Si la taille diffère, relève-la pour faire ajuster la compilation. Garde une copie locale de l’ancien firmware et de sa configuration pour revenir en arrière, puis écris le nouveau binaire à `0x0`. Si une commande redémarre la carte, remets-la en mode flash avec le bouton avant la suivante. [Paramètres de flash ESP8266](https://docs.espressif.com/projects/esptool/en/latest/esp8266/esptool/flash-modes.html)

   ```sh
   python -m esptool --chip esp8266 --port PORT_WIFI --baud 115200 read_flash 0x0 0x400000 sauvegarde-esp8266.bin
   python -m esptool --chip esp8266 --port PORT_WIFI --baud 115200 write_flash --flash_mode dio --flash_freq 40m --flash_size 4MB 0x0 firmwares/ZiGate-WiFi-v1.3-Z2M-ESP8266-1.0.0.bin
   ```

4. Débranche et rebranche la carte Wi‑Fi en mode normal. Ouvre son port USB dans un terminal série à **115200, 8N1, sans contrôle de flux**. La carte affiche le SSID `ZIGATE-…` et une clé WPA2 aléatoire toutes les cinq secondes tant que le mode de configuration est actif. Connecte-toi à ce Wi‑Fi et ouvre `http://192.168.4.1/`. Saisis ton réseau **2,4 GHz** et son mot de passe. Laisse les champs d’adresse vides pour le DHCP. Le pont devient disponible à l’adresse attribuée par ton routeur.

Après une coupure Wi‑Fi prolongée, le point d’accès de configuration revient. L’interface sert à configurer le Wi‑Fi. Les mises à jour de cette version se font via USB.

## 2. Programmer le module radio

1. Débranche les cartes. Monte le **JN5168** sur l’**adaptateur USB‑TTL ZiGate** du kit. Maintiens le bouton du module radio pendant le branchement, puis relâche-le. La prise USB du module ESP8266 sert à programmer le Wi‑Fi. [Procédure officielle pour la radio ZiGate v1](https://zigate.fr/documentation/mise-a-jour-de-la-zigate/)
2. Programme `firmwares/ZiGate-Radio-JN5168-v3.23-OPDM-Z2M.bin` avec l’outil adapté à ton ordinateur.

   - **Windows**. Ouvre `FlashGui.exe` dans **NXP JN51xx Flash Programmer**, sélectionne le fichier et le port COM puis lance `Program`. Pour repartir de zéro, la documentation ZiGate indique `Erase EEPROM` puis `Complete EEPROM` après la programmation.
   - **Linux ou macOS**. Utilise `JennicModuleProgrammer` compilé depuis les sources ZiGate. L’option `-e` remet l’EEPROM radio à zéro. Exécute la commande ci-dessous depuis le dossier extrait, en adaptant le chemin du programme et le port.

     ```sh
     /chemin/vers/JennicModuleProgrammer -V 6 -e -P 115200 \
       -f firmwares/ZiGate-Radio-JN5168-v3.23-OPDM-Z2M.bin -s /dev/ttyUSB0
     ```

3. Débranche l’USB‑TTL, puis remonte la carte radio et la carte Wi‑Fi. Rebranche l’ensemble en mode normal.

### Port COM de la radio sous Windows

1. Ferme les autres onglets du flasheur et les logiciels qui peuvent utiliser le port, comme PuTTY ou FlashGUI.
2. Ouvre le **Gestionnaire de périphériques → Ports (COM et LPT)**. Débranche puis rebranche l’adaptateur de la radio. Repère le port qui disparaît puis revient. Si son numéro change, sélectionne le nouveau port dans le flasheur.
3. Ouvre **Propriétés → Général** pour lire le nom et l’état du périphérique.

Si Windows affiche **« PL2303HXA PHASED OUT SINCE 2012 »**, le pilote Prolific refuse d’ouvrir le port. Tu peux connaître ta version de Windows avec **Win + R**, puis `winver`.

- **Windows 10 et adaptateur Prolific bleu**. Suis la [procédure ZiGate](https://zigate.fr/documentation/installation-des-pilotes-windows-10/) et redémarre le PC.
- **Windows 11 et adaptateur PL2303HXA**. Utilise l’adaptateur sur un PC Linux, ou monte la radio sur le [module USB‑TTL CP2102 de ZiGate](https://zigate.fr/produit/module-usb-ttl-cp2102/) pour continuer sous Windows. [Pilote Silicon Labs CP210x](https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=downloads)

Dès que le port est accessible, reprends à **2. Flashe la radio**. Sélectionne le port attribué à l’adaptateur après l’avoir rebranché en maintenant le bouton de la radio.

Si le port s’affiche sans erreur, ferme le flasheur et teste son ouverture dans **Windows PowerShell**. Remplace `COM9` par le port de l’adaptateur. Ce test ouvre et referme le port sans envoyer de commande à la radio.

```powershell
$zigatePort = [System.IO.Ports.SerialPort]::new('COM9', 38400, 'None', 8, 'One')
try { $zigatePort.Open(); 'Port ouvert' }
catch { $_.Exception.GetBaseException().Message }
finally { $zigatePort.Dispose() }
```

Si PowerShell ouvre le port et que Chrome ou Edge échoue encore, tu peux utiliser **FlashGUI** et le binaire JN5168 du projet. [Procédure Windows de ZiGate v1](https://zigate.fr/documentation/mise-a-jour-de-la-zigate/)

## 3. Lancer Zigbee2MQTT

Utilise le bloc `serial` de [l’exemple de configuration](home-assistant/zigbee2mqtt.example.yaml) dans la configuration d’une instance Zigbee2MQTT 2.x avec un broker MQTT configuré. Remplace `192.168.1.50` par l’adresse de la ZiGate. Arrête toute autre intégration qui utilise cette passerelle avant le démarrage.

Dans les logs, vérifie la connexion au coordinateur et la version radio `0323`. Appaire ensuite un appareil et teste une commande, puis vérifie le retour de la connexion après une coupure Wi‑Fi. Si le démarrage échoue, relève les lignes depuis `Starting zigbee-herdsman` jusqu’à la première erreur. Le pilote ZiGate de Zigbee2MQTT ne bénéficie plus de maintenance et la sauvegarde native du coordinateur reste indisponible. [Documentation Zigbee2MQTT pour ZiGate](https://www.zigbee2mqtt.io/guide/adapters/zigate.html)

## Vérifications réalisées

- Compilation du pont pour ESP8266 4 Mo, DIO à 40 MHz. Vérification de l’image avec `esptool`.
- Compilation de la radio en mode coordinateur JN5168, à 115200 bauds. Vérification du format de l’image JN5168 et de sa taille.
- Test du tampon TCP/UART sur 32 Kio avec lectures et écritures partielles, saturation et fermeture de session.
- Lecture de onze trames produites par `zigbee-herdsman` 11.2.0, la version utilisée par Zigbee2MQTT 2.14.3. Le pilote a décodé en retour la réponse de version radio produite par le code C.

`SHA256SUMS` contient les empreintes des fichiers `.bin`. Le dossier `sources` contient le code du pont, le correctif radio et les commandes de compilation. Les notices des composants d’origine sont dans `licences`.
