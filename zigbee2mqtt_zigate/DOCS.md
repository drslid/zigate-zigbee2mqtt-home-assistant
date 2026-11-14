# Zigbee2MQTT ZiGate

Cette application lance une instance Zigbee2MQTT 2.14.3 pour la ZiGate Wi‑Fi v1.3. Elle utilise son propre stockage et le préfixe MQTT `zigbee2mqtt_zigate`.

1. Dans **Configuration**, saisis l’**adresse IP locale de la ZiGate**. Le port TCP `9999` et le pilote `zigate` sont configurés par l’application.
2. Choisis un canal Zigbee différent de celui de ta première instance, puis clique sur **Enregistrer**.
3. Dans **Informations**, clique sur **Démarrer**, puis sur **Ouvrir l’interface Web**. Active **Afficher dans la barre latérale** pour garder l’accès à la page **Zigbee2MQTT ZiGate**.

L’application récupère le broker Mosquitto déclaré dans Home Assistant. Si ta première instance utilise un broker externe, renseigne le même broker et ses identifiants dans **Configuration → Broker MQTT externe**. Les appareils appairés remontent dans Home Assistant via l’intégration MQTT.

Lors de l’installation, Home Assistant assemble l’image de cette application à partir de l’image officielle Zigbee2MQTT. L’application est disponible sur les architectures 64 bits `amd64` et `aarch64`.

[Flasher et connecter la ZiGate](https://drslid.github.io/zigate-zigbee2mqtt-home-assistant/)
