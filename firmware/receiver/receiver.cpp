#include <Arduino.h>
#include <RadioLib.h>
#include <SPI.h>

#include <string.h>

#include "BoardPins.h"
#include "MotorController.h"
#include "../common/ConfigDefaults.h"
#include "../common/DriveProtocol.h"
#include "../common/RadioConfig.h"

using namespace gesturedrive;

namespace {

SX1262 radio = new Module(receiver_pins::LORA_NSS,
                          receiver_pins::LORA_DIO1,
                          receiver_pins::LORA_RESET,
                          receiver_pins::LORA_BUSY);
MotorController motorController;

volatile bool radioPacketReady = false;
bool radioReady = false;
bool hasSequence = false;
uint16_t lastSequence = 0;
uint32_t lastValidPacketMs = 0;
bool radioFailsafe = true;
bool estopLatched = false;
uint8_t disarmedStopCount = 0;

#if defined(ESP32)
IRAM_ATTR
#endif
void onRadioPacketReceived() {
  radioPacketReady = true;
}

void reportRadioError(int16_t code) {
  Serial.print(F("RADIO_ERROR:"));
  Serial.println(code);
}

bool initializeRadio() {
  SPI.begin(receiver_pins::LORA_SCK, receiver_pins::LORA_MISO,
            receiver_pins::LORA_MOSI, receiver_pins::LORA_NSS);
  const int16_t state = radio.begin(
      radio_config::FREQUENCY_MHZ, radio_config::BANDWIDTH_KHZ,
      radio_config::SPREADING_FACTOR, radio_config::CODING_RATE_DENOMINATOR,
      radio_config::SYNC_WORD, radio_config::TX_POWER_DBM,
      radio_config::PREAMBLE_SYMBOLS, radio_config::TCXO_VOLTAGE,
      radio_config::USE_REGULATOR_LDO);
  if (state != RADIOLIB_ERR_NONE) {
    reportRadioError(state);
    return false;
  }

  const int16_t crcState = radio.setCRC(radio_config::PHY_CRC_ENABLED);
  if (crcState != RADIOLIB_ERR_NONE) {
    reportRadioError(crcState);
    return false;
  }
  radio.setPacketReceivedAction(onRadioPacketReceived);
  const int16_t receiveState = radio.startReceive();
  if (receiveState != RADIOLIB_ERR_NONE) {
    reportRadioError(receiveState);
    return false;
  }
  return true;
}

void markPacketAccepted(const DrivePacket& packet, uint32_t now) {
  lastSequence = packet.sequence;
  hasSequence = true;
  lastValidPacketMs = now;
  if (radioFailsafe) {
    radioFailsafe = false;
    Serial.println(F("FAILSAFE:0"));
  }
}

void handleAcceptedPacket(const DrivePacket& packet, uint32_t now) {
  const bool newer = !hasSequence || isSequenceNewer(packet.sequence, lastSequence);

  // Any well-formed E-stop packet wins immediately, even if its sequence is a
  // duplicate. Duplicate packets still do not refresh the radio watchdog.
  if ((packet.flags & FLAG_ESTOP) != 0U) {
    const bool newlyLatched = !estopLatched;
    estopLatched = true;
    disarmedStopCount = 0;
    motorController.emergencyStop();
    if (newer) markPacketAccepted(packet, now);
    if (newlyLatched) Serial.println(F("ESTOP_LATCHED:1"));
    return;
  }

  if (!newer) return;
  markPacketAccepted(packet, now);

  if (packet.type == COMMAND_STOP) {
    motorController.setStop();
    if ((packet.flags & FLAG_RESET_ESTOP) != 0U) {
      if (estopLatched &&
          disarmedStopCount >= config::ESTOP_DISARMED_PACKETS_REQUIRED) {
        estopLatched = false;
        Serial.println(F("ESTOP_LATCHED:0"));
      }
      disarmedStopCount = 0;
      return;
    }

    if (disarmedStopCount < 255U) ++disarmedStopCount;
    return;
  }

  disarmedStopCount = 0;
  if (estopLatched) {
    motorController.emergencyStop();
    return;
  }
  motorController.applyCommand(packet);
}

void processRadioPacket(uint32_t now) {
  radioPacketReady = false;
  const size_t packetLength = radio.getPacketLength();
  uint8_t buffer[255];
  const size_t readLength = packetLength > sizeof(buffer) ? sizeof(buffer)
                                                          : packetLength;
  const int16_t state = radio.readData(buffer, readLength);
  if (state == RADIOLIB_ERR_NONE && packetLength == sizeof(DrivePacket)) {
    DrivePacket packet;
    memcpy(&packet, buffer, sizeof(packet));
    if (isPacketShapeValid(packet) && hasValidPacketCrc(packet)) {
      handleAcceptedPacket(packet, now);
    }
  } else if (state != RADIOLIB_ERR_CRC_MISMATCH) {
    reportRadioError(state);
  }

  const int16_t receiveState = radio.startReceive();
  if (receiveState != RADIOLIB_ERR_NONE) {
    reportRadioError(receiveState);
    radioReady = false;
  }
}

void serviceFailsafe(uint32_t now) {
  const uint32_t silenceMs = now - lastValidPacketMs;
  if (silenceMs > config::RADIO_TIMEOUT_MS && !radioFailsafe) {
    radioFailsafe = true;
    motorController.setStop();
    Serial.println(F("FAILSAFE:1"));
  }
  if (silenceMs > config::MOTOR_DISABLE_TIMEOUT_MS) {
    motorController.disable();
  }
}

}  // namespace

void setup() {
  // Motor outputs and STANDBY are made safe before radio initialization.
  motorController.begin();
  Serial.begin(115200);
  lastValidPacketMs = millis();
  Serial.println(F("FAILSAFE:1"));
  radioReady = initializeRadio();
}

void loop() {
  const uint32_t now = millis();
  if (radioReady && radioPacketReady) processRadioPacket(now);
  serviceFailsafe(now);
  motorController.update();
}
