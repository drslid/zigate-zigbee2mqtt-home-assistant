#!/usr/bin/env bashio
set -eo pipefail
umask 077

zigate_ip=$(bashio::config 'zigate_ip')
if ! node -e 'const ip = process.argv[1]; process.exitCode = require("node:net").isIPv4(ip) && ip !== "0.0.0.0" ? 0 : 1' -- "$zigate_ip"; then
    bashio::exit.nok "Renseigne l’adresse IPv4 de la ZiGate sur ton réseau dans Configuration → Adresse IP de la ZiGate."
fi

export ZIGBEE2MQTT_DATA=/data/zigbee2mqtt
export ZIGBEE2MQTT_CONFIG_SERIAL_ADAPTER=zigate
export ZIGBEE2MQTT_CONFIG_SERIAL_PORT="tcp://${zigate_ip}:9999"
export ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC=zigbee2mqtt_zigate
export ZIGBEE2MQTT_CONFIG_ADVANCED_CHANNEL="$(bashio::config 'zigbee_channel')"
export ZIGBEE2MQTT_CONFIG_HOMEASSISTANT_ENABLED=true
export ZIGBEE2MQTT_CONFIG_FRONTEND_ENABLED=true
export ZIGBEE2MQTT_CONFIG_FRONTEND_HOST=127.0.0.1
export ZIGBEE2MQTT_CONFIG_FRONTEND_PORT=8100
export Z2M_ONBOARD_NO_SERVER=1

if bashio::config.has_value 'mqtt.server'; then
    mqtt_server=$(bashio::config 'mqtt.server')
    mqtt_user=""
    mqtt_password=""
    if bashio::config.has_value 'mqtt.user'; then
        mqtt_user=$(bashio::config 'mqtt.user')
    fi
    if bashio::config.has_value 'mqtt.password'; then
        mqtt_password=$(bashio::config 'mqtt.password')
    fi
elif mqtt_service=$(bashio::services 'mqtt') && bashio::var.has_value "$mqtt_service"; then
    mqtt_scheme=mqtt
    if bashio::var.true "$(bashio::services 'mqtt' 'ssl')"; then
        mqtt_scheme=mqtts
    fi
    mqtt_server="${mqtt_scheme}://$(bashio::services 'mqtt' 'host'):$(bashio::services 'mqtt' 'port')"
    mqtt_user=$(bashio::services 'mqtt' 'username')
    mqtt_password=$(bashio::services 'mqtt' 'password')
else
    bashio::exit.nok "Démarre Mosquitto broker ou renseigne un broker MQTT dans la configuration de l’application."
fi

mkdir -p "$ZIGBEE2MQTT_DATA"
printf '%s\0%s\0%s\0' "$mqtt_server" "$mqtt_user" "$mqtt_password" \
    | jq -Rs 'split("\u0000") | {server: .[0], user: .[1], password: .[2]}' > "$ZIGBEE2MQTT_DATA/ha-mqtt.yaml.tmp"
mv "$ZIGBEE2MQTT_DATA/ha-mqtt.yaml.tmp" "$ZIGBEE2MQTT_DATA/ha-mqtt.yaml"
unset mqtt_user mqtt_password
# Keep credentials outside the main Zigbee2MQTT settings and refresh them on each start.
export ZIGBEE2MQTT_CONFIG_MQTT_SERVER='!ha-mqtt.yaml server'
export ZIGBEE2MQTT_CONFIG_MQTT_USER='!ha-mqtt.yaml user'
export ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD='!ha-mqtt.yaml password'

haproxy -D -f /etc/zigate-ingress.cfg

bashio::log.info "Démarrage de Zigbee2MQTT ZiGate sur ${ZIGBEE2MQTT_CONFIG_SERIAL_PORT}"
cd /app
exec node index.js
