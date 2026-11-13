# Recompiler les deux firmwares

Les chemins des exemples partent du dossier extrait. Lance les blocs depuis un terminal où `arduino-cli`, `git`, `make` et Python sont installés. La construction radio a été vérifiée sous Linux x86‑64.

## Pont Wi‑Fi ESP8266

Le câblage et le port TCP reprennent le [sketch ZiGate Wi‑Fi v1.3](https://github.com/fairecasoimeme/ZiGate/blob/26b1bd466b639b7986392d3c1551f2b0627a6cb5/ModuleWiFi/Firmware/v1.3/source/WZiGatev1.3.ino). Les sources du cœur Arduino ESP8266 et des bibliothèques utilisées sont disponibles dans la [version 3.1.2](https://github.com/esp8266/Arduino/tree/3.1.2).

```sh
arduino-cli core update-index --additional-urls https://arduino.esp8266.com/stable/package_esp8266com_index.json
arduino-cli core install esp8266:esp8266@3.1.2 --additional-urls https://arduino.esp8266.com/stable/package_esp8266com_index.json
arduino-cli compile --fqbn esp8266:esp8266:generic:eesz=4M1M,FlashMode=dio,FlashFreq=40 \
  --output-dir build-wifi sources/WZiGateZ2M
```

L’image compilée est `build-wifi/WZiGateZ2M.ino.bin`.

## Coordinateur JN5168

Télécharge puis extrais `ba-toolchain-20201219.tar.bz2` dans un dossier `outils`. Le compilateur doit se trouver dans `outils/ba-toolchain/bin/ba-elf-gcc`. [Chaîne BA2](https://github.com/openlumi/BA2-toolchain/releases/tag/20201219)

```sh
git clone --branch v3.23-opdm https://github.com/fairecasoimeme/ZiGate.git zigate-radio
git -C zigate-radio checkout --detach 78ab96631b85c1d8896198d21f51ff517700771a
git -C zigate-radio apply ../sources/radio/zigate-v3.23-z2m.patch
python3 -m pip install xmltodict==0.14.2
make -C zigate-radio/ModuleRadio/Firmware/src/ZiGate/Build/ZigbeeNodeControlBridge -j4 \
  JENNIC_CHIP=JN5168 JENNIC_CHIP_FAMILY=JN516x BAUD=115200 \
  TOOLCHAIN_PATH=ba-toolchain TOOL_COMMON_BASE_DIR="$PWD/outils" PYTHON="$(command -v python3)"
```

Le résultat est `ZigbeeNodeControlBridge_JN5168_COORDINATOR_115200.bin` dans le dossier de compilation. Le correctif inclut les ajustements Linux issus de la [révision 26b1bd4 de ZiGate](https://github.com/fairecasoimeme/ZiGate/tree/26b1bd466b639b7986392d3c1551f2b0627a6cb5/ModuleRadio/Firmware/src). Le numéro radio affiché reste `0323`, conformément à la base v3.23 OPDM.
