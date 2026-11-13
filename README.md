<p align="center">
  <img src="docs/assets/zigate-logo.svg" alt="ZiGate Wi-Fi v1.3 · Zigbee2MQTT · Home Assistant" width="560">
</p>

<p align="center">
  <strong>Réutilise ta ZiGate Wi-Fi v1.3 dans Home Assistant.</strong>
  <br>
  Deux firmwares, une page de flash USB et un guide Zigbee2MQTT.
</p>

<p align="center">
  <a href="https://drslid.github.io/zigate-zigbee2mqtt-home-assistant/"><img src="https://img.shields.io/badge/GitHub%20Pages-Outil%20de%20flash-176e67?logo=github" alt="Ouvrir l’outil de flash"></a>
  <img src="https://img.shields.io/badge/Statut-Version%20d%E2%80%99essai-f0b666" alt="Version d’essai">
  <img src="https://img.shields.io/badge/Zigbee2MQTT-2.x-239b55?logo=zigbee" alt="Zigbee2MQTT 2.x">
  <img src="https://img.shields.io/badge/Home%20Assistant-MQTT-18a9d6?logo=homeassistant&logoColor=white" alt="Home Assistant via MQTT">
</p>

> [!IMPORTANT]
> Les firmwares et les échanges série ont été vérifiés en logiciel. Le flash et l’appairage sur une ZiGate physique restent à valider.

## Installation rapide

Tu as besoin d’une **ZiGate Wi-Fi v1.3**, de son adaptateur **USB‑TTL** et d’un ordinateur avec **Chrome ou Edge**.

1. Ouvre [la page de flash](https://drslid.github.io/zigate-zigbee2mqtt-home-assistant/) et programme le module **Wi-Fi**.
2. Programme la **radio Zigbee** avec l’adaptateur USB‑TTL.
3. Remonte la ZiGate et connecte-la à ton **Wi-Fi 2,4 GHz**.
4. Dans Home Assistant, installe **Mosquitto** et **Zigbee2MQTT**, puis renseigne l’adresse de la ZiGate.
5. Appaire un appareil dans Zigbee2MQTT et retrouve-le sous **MQTT** dans Home Assistant.

**Guides** · [Flash depuis le navigateur](https://drslid.github.io/zigate-zigbee2mqtt-home-assistant/) · [Home Assistant](#installation-dans-home-assistant) · [Flash manuel](LISEZ-MOI.md)

## Mettre à jour la ZiGate

| Module | Matériel | Connexion | Firmware |
| --- | --- | --- | --- |
| Wi‑Fi | ESP8266 avec 4 Mo de flash | Prise USB de la carte Wi‑Fi | [Wi‑Fi 1.0.0](firmwares/ZiGate-WiFi-v1.3-Z2M-ESP8266-1.0.0.bin) |
| Radio Zigbee | MS5168‑M05 avec JN5168 | Adaptateur USB‑TTL ZiGate du kit | [Radio 3.23 OPDM](firmwares/ZiGate-Radio-JN5168-v3.23-OPDM-Z2M.bin) |

1. Ouvre la page en HTTPS. Débranche la ZiGate, sépare les cartes et choisis le module à programmer.
2. Suis les instructions de mise en mode flash sur la page, puis sélectionne le port USB. La page contrôle la puce avant l’écriture et vérifie la mémoire après l’installation. Tu peux aussi sauvegarder le programme précédent depuis la page.
3. Pour partir d’un réseau Zigbee neuf, garde la carte radio sur l’USB‑TTL après le flash. Rebranche-la sans maintenir son bouton, puis utilise **Effacer l’ancien réseau Zigbee** sur la page. Cela efface les anciens appairages.
4. Remonte la ZiGate. Clique sur **Lire la clé Wi-Fi en USB** pour afficher le nom du point d’accès et sa clé. Connecte-toi à ce réseau et ouvre `http://192.168.4.1/`. Renseigne ton Wi‑Fi 2,4 GHz, puis relève l’IP attribuée par le routeur.

Le [guide complet](LISEZ-MOI.md) décrit aussi le flash avec les outils en ligne de commande. Le [pack ZIP](ZiGate-v1.3-Zigbee2MQTT-1.0.0.zip) contient les binaires, les sources et leurs empreintes. Les sauvegardes réalisées depuis la page restent sur l’ordinateur.

## Installation dans Home Assistant

### Home Assistant OS

1. Dans **Paramètres → Applications → Boutique**, installe et démarre [Mosquitto broker](https://my.home-assistant.io/redirect/supervisor_addon/?addon=core_mosquitto) si tu n’as pas déjà de broker. Crée un utilisateur local dédié au MQTT dans Home Assistant, par exemple `zigbee2mqtt`, avec son propre mot de passe.
2. Ajoute le [dépôt officiel de l’application Zigbee2MQTT](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fzigbee2mqtt%2Fhassio-zigbee2mqtt) dans la boutique et installe la version stable. Les intitulés peuvent apparaître comme **Modules complémentaires** dans des versions plus anciennes de Home Assistant.
3. Au premier lancement de Zigbee2MQTT, renseigne `mqtt://core-mosquitto:1883`, ton utilisateur MQTT, le pilote `zigate` et le port `tcp://IP_DE_LA_ZIGATE:9999`. Active **Home Assistant discovery**. Si tu configures Zigbee2MQTT par fichier, utilise [cet exemple YAML](home-assistant/zigbee2mqtt.example.yaml). Ajoute ces réglages à la configuration de **Zigbee2MQTT** et remplace l’adresse, l’utilisateur et le mot de passe par les tiens.
4. Dans **Paramètres → Appareils et services**, ouvre ou ajoute l’[intégration MQTT](https://www.home-assistant.io/integrations/mqtt/). Elle doit utiliser le même broker que Zigbee2MQTT.
5. Dans Zigbee2MQTT, ouvre temporairement l’appairage et ajoute un appareil. Il doit apparaître sous **MQTT** dans Home Assistant. Vérifie une commande ou un changement d’état, puis ferme l’appairage.

### Home Assistant Container

Lance [Zigbee2MQTT en conteneur](https://www.zigbee2mqtt.io/guide/installation/02_docker.html) avec son dossier de données persistant et un broker MQTT accessible. Réutilise le [fichier d’exemple](home-assistant/zigbee2mqtt.example.yaml) en remplaçant `core-mosquitto` par l’adresse ou le nom DNS du broker. Configure l’intégration MQTT de Home Assistant avec ce même broker. La ZiGate communique avec Zigbee2MQTT en TCP, donc le conteneur doit pouvoir joindre son IP sur le port 9999.

### Dépannage

- Si le flasheur bloque à l’identification de la mémoire Wi-Fi, recharge la page et réessaie avec le module Wi-Fi seul. Relève le code JEDEC affiché si l’erreur persiste.
- Si Zigbee2MQTT échoue au démarrage, vérifie l’adresse de la ZiGate, le port `9999` et le journal à partir de `Starting zigbee-herdsman`. Un seul programme doit se connecter à la ZiGate à la fois. Déconnecte une éventuelle intégration ZHA utilisant cette passerelle.
- Si l’appareil apparaît dans Zigbee2MQTT mais pas dans Home Assistant, vérifie `homeassistant.enabled: true`, les identifiants MQTT et le broker utilisé des deux côtés.
- Le [pilote ZiGate de Zigbee2MQTT](https://www.zigbee2mqtt.io/guide/adapters/zigate.html) n’est plus maintenu. La sauvegarde native du réseau via Zigbee2MQTT n’est pas disponible pour ce modèle.

## Sources et développement

- [Sources et compilation des firmwares](sources/COMPILATION.md)
- [Notices et licences des composants](licences/)
- [Protocole de programmation JN51xx](https://www.nxp.com/docs/en/application-note/JN-AN-1003.pdf) et [esptool-js](https://github.com/espressif/esptool-js)

Le site est statique. GitHub Pages le sert depuis la racine de la branche `main`. Pour l’essayer sur ton ordinateur, lance `python3 -m http.server 8000` à la racine du dépôt et ouvre [localhost:8000](http://localhost:8000/).

Avec Node.js 22 ou plus récent, lance `node --test tests/serial.test.mjs` pour vérifier les échanges série simulés, les sauvegardes et les contrôles avant et après écriture.

## Architecture

```mermaid
flowchart TD
  Radio["Appareils Zigbee"] --> ZiGate["ZiGate JN5168 + ESP8266"]
  Browser["Chrome ou Edge"] -->|Flash USB| ZiGate
  ZiGate -->|TCP 9999| Z2M["Zigbee2MQTT"]
  Z2M --> Broker["Broker MQTT"]
  Broker --> HA["Home Assistant"]
```

## Licences

Les notices de la radio, du cœur ESP8266 et des bibliothèques du site sont disponibles dans [licences/](licences/).
