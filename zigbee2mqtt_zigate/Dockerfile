ARG BUILD_ARCH=amd64
FROM ghcr.io/zigbee2mqtt/zigbee2mqtt-${BUILD_ARCH}:2.14.3-1

COPY run.sh /zigate-run.sh
COPY ingress.cfg /etc/zigate-ingress.cfg

RUN chmod 0755 /zigate-run.sh && apk add --no-cache haproxy

ENTRYPOINT ["/sbin/tini", "--", "/zigate-run.sh"]
