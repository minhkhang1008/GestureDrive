#include <Arduino.h>
#include <RadioLib.h>
#include <SPI.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>

#include "BoardPins.h"
#include "../common/ConfigDefaults.h"
#include "../common/DriveProtocol.h"
#include "../common/RadioConfig.h"
#include "../common/TelemetryProtocol.h"

using namespace gesturedrive;

namespace {

constexpr size_t HOST_LINE_CAPACITY = 96;
constexpr size_t HOST_BYTES_PER_LOOP = 64;
constexpr uint8_t RADIO_FAILURES_BEFORE_LINK_DOWN = 3;
// Control airtime at SF7/BW250/CR4:5 with a 16-byte payload is ~25.7 ms;
// 60 ms is a generous 2x margin including IRQ latency, and still shorter than
// the 50 ms slot plus one interval, so a lost TX-done cannot stall the 20 Hz
// schedule for long.
constexpr uint32_t RADIO_OPERATION_TIMEOUT_MS = 60;
constexpr uint32_t RADIO_INIT_RETRY_MS = 2000;
constexpr uint8_t SEQUENCE_REJECTS_BEFORE_RESYNC = 3;
uint32_t nextStatusReportMs = 0;

// RadioLib's DIO1 line is shared by TX-done and RX-done. A single latched flag
// is interpreted in loop() according to this explicit state.
enum class RadioState : uint8_t {
  IDLE,            // nothing armed
  TX_IN_PROGRESS,  // control transmit running
  RX_ARMED,        // listening for the telemetry reply in the idle gap
};

SX1262 radio = new Module(transmitter_pins::LORA_NSS,
                          transmitter_pins::LORA_DIO1,
                          transmitter_pins::LORA_RESET,
                          transmitter_pins::LORA_BUSY);

char hostLine[HOST_LINE_CAPACITY];
size_t hostLineLength = 0;
bool hostLineOverflow = false;

DrivePacket latestCommand = makeStopPacket(0);
DrivePacket inFlightPacket = makeStopPacket(0);
uint16_t latestHostSequence = 0;
uint16_t radioSequence = 0;
bool hasHostSequence = false;
bool hostTimedOut = true;
uint32_t lastValidHostMs = 0;
uint8_t consecutiveSequenceRejects = 0;

bool radioReady = false;
bool linkReportedUp = false;
uint8_t consecutiveRadioFailures = 0;
uint8_t radioTxReportDivider = 0;
uint32_t radioTxStartedMs = 0;
uint32_t nextRadioTxMs = 0;
uint32_t nextRadioInitRetryMs = 0;
int16_t radioStartState = RADIOLIB_ERR_NONE;
int16_t lastRadioErrorCode = RADIOLIB_ERR_NONE;
RadioState radioState = RadioState::IDLE;
// DIO1 is edge-triggered and shared by TX-done and RX-done. A plain bool flag
// loses an event whenever the ISR fires between the loop's test and its clear,
// which would stall the 20 Hz schedule until the operation timeout. A
// monotonic counter written only by the ISR cannot lose an edge.
volatile uint32_t dio1Events = 0;
uint32_t dio1Handled = 0;

#if defined(ESP32)
IRAM_ATTR
#endif
void onDio1() {
  ++dio1Events;
}

/** True once per DIO1 edge; never loses an edge to a test/clear race. */
bool consumeDio1Event() {
  const uint32_t observed = dio1Events;
  if (observed == dio1Handled) return false;
  dio1Handled = observed;
  return true;
}

/** Drops any pending edge before starting a new radio operation. */
void discardDio1Events() { dio1Handled = dio1Events; }

bool parseLongStrict(const char* text, long minimum, long maximum, long& value) {
  if (text == nullptr || *text == '\0') return false;
  // strtol accepts leading whitespace and '+'; the wire format does not. The
  // first character must be a digit, or '-' followed by a digit.
  const char* digits = (*text == '-') ? text + 1 : text;
  if (*digits < '0' || *digits > '9') return false;
  errno = 0;
  char* end = nullptr;
  const long parsed = strtol(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || parsed < minimum ||
      parsed > maximum) {
    return false;
  }
  value = parsed;
  return true;
}

bool parseHexCrcStrict(const char* text, uint16_t& value) {
  if (text == nullptr || strlen(text) != 4U) return false;
  errno = 0;
  char* end = nullptr;
  const unsigned long parsed = strtoul(text, &end, 16);
  if (errno != 0 || end == text || *end != '\0' || parsed > 0xFFFFUL) {
    return false;
  }
  value = static_cast<uint16_t>(parsed);
  return true;
}

void reportHostError(const __FlashStringHelper* code) {
  Serial.print(F("HOST_ERROR:"));
  Serial.println(code);
}

bool parseHostCommand(char* line, DrivePacket& parsedPacket,
                      uint16_t& hostSequence) {
  char* crcSeparator = strrchr(line, ',');
  if (crcSeparator == nullptr) {
    reportHostError(F("FIELD_COUNT"));
    return false;
  }

  uint16_t receivedCrc = 0;
  if (!parseHexCrcStrict(crcSeparator + 1, receivedCrc)) {
    reportHostError(F("CRC_FORMAT"));
    return false;
  }
  *crcSeparator = '\0';
  const uint16_t expectedCrc = crc16Ccitt(
      reinterpret_cast<const uint8_t*>(line), strlen(line));
  if (receivedCrc != expectedCrc) {
    reportHostError(F("CRC"));
    return false;
  }

  char* fields[7] = {nullptr};
  size_t fieldCount = 0;
  char* save = nullptr;
  for (char* token = strtok_r(line, ",", &save); token != nullptr;
       token = strtok_r(nullptr, ",", &save)) {
    if (fieldCount >= 7U) {
      reportHostError(F("FIELD_COUNT"));
      return false;
    }
    fields[fieldCount++] = token;
  }
  if (fieldCount != 7U || strcmp(fields[0], "GD2") != 0) {
    reportHostError(fieldCount == 7U ? F("PREFIX") : F("FIELD_COUNT"));
    return false;
  }

  long sequence = 0;
  long type = 0;
  long channelA = 0;
  long channelB = 0;
  long speedLimit = 0;
  long flags = 0;
  if (!parseLongStrict(fields[1], 0, 65535, sequence) ||
      !parseLongStrict(fields[2], COMMAND_STOP, COMMAND_DIRECT_PWM, type) ||
      !parseLongStrict(fields[3], CONTROL_MIN, CONTROL_MAX, channelA) ||
      !parseLongStrict(fields[4], CONTROL_MIN, CONTROL_MAX, channelB) ||
      !parseLongStrict(fields[5], 0, CONTROL_MAX, speedLimit) ||
      !parseLongStrict(fields[6], 0, 255, flags)) {
    reportHostError(F("RANGE"));
    return false;
  }

  DrivePacket candidate;
  memset(&candidate, 0, sizeof(candidate));
  candidate.magic = DRIVE_MAGIC;
  candidate.version = DRIVE_VERSION;
  candidate.type = static_cast<uint8_t>(type);
  candidate.sequence = static_cast<uint16_t>(sequence);
  candidate.channelA = static_cast<int16_t>(channelA);
  candidate.channelB = static_cast<int16_t>(channelB);
  candidate.speedLimit = static_cast<uint16_t>(speedLimit);
  candidate.flags = static_cast<uint8_t>(flags);

  if (!isPacketShapeValid(candidate)) {
    reportHostError(F("SHAPE"));
    return false;
  }

  hostSequence = candidate.sequence;
  parsedPacket = candidate;
  return true;
}

void acceptHostLine(char* line) {
  DrivePacket parsed;
  uint16_t sequence = 0;
  if (!parseHostCommand(line, parsed, sequence)) return;

  // A host timeout defines a new browser session, so a sequence restarted at
  // zero can recover without waiting for the previous 16-bit value to wrap.
  if (hasHostSequence && !hostTimedOut &&
      !isSequenceNewer(sequence, latestHostSequence)) {
    // Repeated rejections mean a new browser session started without a host
    // timeout in between; drop the sequence lock instead of stalling.
    if (consecutiveSequenceRejects < 255U) ++consecutiveSequenceRejects;
    if (consecutiveSequenceRejects >= SEQUENCE_REJECTS_BEFORE_RESYNC) {
      hasHostSequence = false;
      consecutiveSequenceRejects = 0;
      reportHostError(F("SEQUENCE_RESYNC"));
    } else {
      reportHostError(F("SEQUENCE"));
    }
    return;
  }

  consecutiveSequenceRejects = 0;
  latestHostSequence = sequence;
  hasHostSequence = true;
  latestCommand = parsed;
  lastValidHostMs = millis();
  if (hostTimedOut) {
    hostTimedOut = false;
    Serial.println(F("HOST_TIMEOUT:0"));
  }
}

void readHostSerial() {
  size_t processed = 0;
  while (Serial.available() > 0 && processed < HOST_BYTES_PER_LOOP) {
    ++processed;
    const int raw = Serial.read();
    if (raw < 0) return;
    const char character = static_cast<char>(raw);

    if (character == '\n') {
      if (hostLineOverflow) {
        reportHostError(F("LINE_TOO_LONG"));
      } else if (hostLineLength > 0U) {
        hostLine[hostLineLength] = '\0';
        acceptHostLine(hostLine);
      }
      hostLineLength = 0;
      hostLineOverflow = false;
      continue;
    }
    if (character == '\r') continue;
    if (hostLineOverflow) continue;
    if (hostLineLength + 1U >= HOST_LINE_CAPACITY) {
      hostLineOverflow = true;
      continue;
    }
    hostLine[hostLineLength++] = character;
  }
}

void setLinkReported(bool up) {
  if (up == linkReportedUp) return;
  linkReportedUp = up;
  Serial.println(up ? F("LINK:LORA") : F("LINK:NONE"));
}

void printRadioError(int16_t code) {
  lastRadioErrorCode = code;
  Serial.print(F("RADIO_ERROR:"));
  Serial.println(code);
}

void reportRadioFailure(int16_t code) {
  if (consecutiveRadioFailures < 255U) ++consecutiveRadioFailures;
  printRadioError(code);
  if (consecutiveRadioFailures >= RADIO_FAILURES_BEFORE_LINK_DOWN) {
    setLinkReported(false);
  }
}

bool initializeRadio() {
  SPI.begin(transmitter_pins::LORA_SCK, transmitter_pins::LORA_MISO,
            transmitter_pins::LORA_MOSI, transmitter_pins::LORA_NSS);

  const int16_t state = radio.begin(
      radio_config::FREQUENCY_MHZ, radio_config::BANDWIDTH_KHZ,
      radio_config::SPREADING_FACTOR, radio_config::CODING_RATE_DENOMINATOR,
      radio_config::SYNC_WORD, radio_config::TX_POWER_DBM,
      radio_config::PREAMBLE_SYMBOLS, radio_config::TCXO_VOLTAGE,
      radio_config::USE_REGULATOR_LDO);
  if (state != RADIOLIB_ERR_NONE) {
    reportRadioFailure(state);
    return false;
  }
  // Many SX1262 modules switch the antenna via DIO2 (no discrete RXEN/TXEN);
  // only boards with discrete switch lines set HAS_RF_SWITCH in BoardPins.h.
  if (transmitter_pins::HAS_RF_SWITCH) {
    radio.setRfSwitchPins(transmitter_pins::LORA_RXEN,
                          transmitter_pins::LORA_TXEN);
  }

  const int16_t crcState = radio.setCRC(radio_config::PHY_CRC_ENABLED);
  if (crcState != RADIOLIB_ERR_NONE) {
    reportRadioFailure(crcState);
    return false;
  }
  radio.setDio1Action(onDio1);
  radioState = RadioState::IDLE;
  return true;
}

// Exact format consumed by parseBridgeLine in src/lib/serialProtocol.ts.
//
// The packet carries the vehicle's view of the downlink (station -> vehicle);
// uplinkRssi/uplinkSnr are ESP1's own measurement of the telemetry reply, i.e.
// the vehicle -> station direction. Reporting both makes an asymmetric link
// (a deaf receiver, a detuned antenna on one end) visible instead of guessed.
void printTelemetryLine(const TelemetryPacket& packet, float uplinkRssi,
                        float uplinkSnr) {
  const uint8_t flags = telemetryFlags(packet);
  Serial.print(F("TELEMETRY:"));
  Serial.print(packet.sequence);
  Serial.print(',');
  Serial.print(static_cast<int>(packet.rssiDbm));
  Serial.print(',');
  Serial.print(static_cast<float>(packet.snrDbX4) / 4.0F, 2);
  Serial.print(',');
  Serial.print(packet.lossPercent);
  Serial.print(',');
  Serial.print((flags & TELEMETRY_FLAG_FAILSAFE) != 0U ? 1 : 0);
  Serial.print(',');
  const uint32_t batteryMv =
      (flags & TELEMETRY_FLAG_BATTERY_VALID) != 0U
          ? static_cast<uint32_t>(packet.battery50mV) * 50U
          : 0U;  // 0 means unknown on the web side
  Serial.print(batteryMv);
  Serial.print(',');
  Serial.print(static_cast<int>(packet.leftPermilleDiv10) * 10);
  Serial.print(',');
  Serial.print(static_cast<int>(packet.rightPermilleDiv10) * 10);
  Serial.print(',');
  Serial.print((flags & TELEMETRY_FLAG_ESTOP_LATCHED) != 0U ? 1 : 0);
  Serial.print(',');
  Serial.print(uplinkRssi, 1);
  Serial.print(',');
  Serial.print(uplinkSnr, 2);
  Serial.print(',');
  Serial.print((flags & TELEMETRY_FLAG_BATTERY_LOW) != 0U ? 1 : 0);
  Serial.print(',');
  Serial.println((flags & TELEMETRY_FLAG_BATTERY_CRITICAL) != 0U ? 1 : 0);
}

// Opens the receive window for the ESP2 telemetry reply during the ~24 ms
// idle gap between control transmissions.
void armTelemetryReceive() {
  discardDio1Events();  // drop any stale edge before a new operation
  const int16_t state = radio.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    // Stay IDLE; the next control TX slot recovers the radio state.
    reportRadioFailure(state);
    return;
  }
  radioState = RadioState::RX_ARMED;
}

void processTelemetryReception() {
  const size_t packetLength = radio.getPacketLength();
  uint8_t buffer[64];
  const size_t readLength = packetLength > sizeof(buffer) ? sizeof(buffer)
                                                          : packetLength;
  const int16_t state = radio.readData(buffer, readLength);
  if (state == RADIOLIB_ERR_NONE && packetLength == sizeof(TelemetryPacket)) {
    TelemetryPacket packet;
    memcpy(&packet, buffer, sizeof(packet));
    if (isTelemetryShapeValid(packet) && hasValidTelemetryCrc(packet)) {
      // Measured before re-arming the receiver: these registers describe the
      // packet that was just read out.
      printTelemetryLine(packet, radio.getRSSI(), radio.getSNR());
    }
  } else if (state != RADIOLIB_ERR_NONE &&
             state != RADIOLIB_ERR_CRC_MISMATCH) {
    // A corrupted reception must not tear the control link status down, so
    // this bypasses the consecutive-failure counter.
    printRadioError(state);
  }
  armTelemetryReceive();
}

void finishRadioTransmit() {
  const int16_t finishState = radio.finishTransmit();
  radioState = RadioState::IDLE;
  if (radioStartState != RADIOLIB_ERR_NONE || finishState != RADIOLIB_ERR_NONE) {
    reportRadioFailure(radioStartState != RADIOLIB_ERR_NONE ? radioStartState
                                                            : finishState);
    return;
  }

  consecutiveRadioFailures = 0;
  setLinkReported(true);
  // Radio vẫn phát ở 20 Hz, nhưng chỉ gửi log trạng thái về frontend ở 2 Hz.
  radioTxReportDivider++;

  if (radioTxReportDivider >= 10U) {
    radioTxReportDivider = 0;

    Serial.print(F("RADIO_TX:"));
    Serial.println(inFlightPacket.sequence);
  }

  // The control TX completed, so ESP2 replies now: listen for telemetry until
  // the next control slot.
  armTelemetryReceive();
}

void serviceRadio(uint32_t now) {
  if (!radioReady) {
    // A radio init failure must not be permanent (loose SPI wiring fixed in
    // the field, brownout during boot, ...): keep retrying every 2 s.
    if (static_cast<int32_t>(now - nextRadioInitRetryMs) < 0) return;
    nextRadioInitRetryMs = now + RADIO_INIT_RETRY_MS;
    radioReady = initializeRadio();
    if (!radioReady) return;
    nextRadioTxMs = now;  // realign the 20 Hz schedule after recovery
  }

  if (radioState == RadioState::TX_IN_PROGRESS) {
    if (consumeDio1Event()) {
      finishRadioTransmit();
    } else if (now - radioTxStartedMs > RADIO_OPERATION_TIMEOUT_MS) {
      discardDio1Events();  // a late edge must not leak into the next operation
      radio.finishTransmit();
      radioState = RadioState::IDLE;
      reportRadioFailure(-1000);
    }
    return;
  }

  if (radioState == RadioState::RX_ARMED && consumeDio1Event()) {
    processTelemetryReception();
  }

  if (static_cast<int32_t>(now - nextRadioTxMs) < 0) return;
  // Drift-free 20 Hz schedule: advance by the interval, not from "now".
  nextRadioTxMs += config::CONTROL_INTERVAL_MS;
  // Catch-up clamp: when more than one interval behind (blocked loop, radio
  // recovery), realign instead of bursting transmissions to chase the old
  // schedule.
  if (static_cast<int32_t>(now - nextRadioTxMs) >= 0) {
    nextRadioTxMs = now + config::CONTROL_INTERVAL_MS;
  }

  inFlightPacket = latestCommand;
  inFlightPacket.sequence = static_cast<uint16_t>(radioSequence + 1U);
  radioSequence = inFlightPacket.sequence;
  finalizePacket(inFlightPacket);

  // Leave the telemetry listen window (or any stale state) before TX.
  radio.standby();
  discardDio1Events();  // drop any stale edge before a new operation
  radioStartState = radio.startTransmit(
      reinterpret_cast<const uint8_t*>(&inFlightPacket), sizeof(inFlightPacket));
  if (radioStartState != RADIOLIB_ERR_NONE) {
    radioState = RadioState::IDLE;
    reportRadioFailure(radioStartState);
    return;
  }
  radioState = RadioState::TX_IN_PROGRESS;
  radioTxStartedMs = now;
}

void serviceStatusReport(uint32_t now) {
  if (static_cast<int32_t>(now - nextStatusReportMs) < 0) {
    return;
  }

  nextStatusReportMs = now + 1000;

  Serial.println(linkReportedUp ? F("LINK:LORA") : F("LINK:NONE"));
  Serial.println(hostTimedOut ? F("HOST_TIMEOUT:1")
                              : F("HOST_TIMEOUT:0"));
  // While the radio never initialized, re-emit the last error code once per
  // second so a web client that opens the port later still sees the fault.
  if (!radioReady && lastRadioErrorCode != RADIOLIB_ERR_NONE) {
    Serial.print(F("RADIO_ERROR:"));
    Serial.println(lastRadioErrorCode);
  }
}

void serviceHostTimeout(uint32_t now) {
  if (hostTimedOut || now - lastValidHostMs <= config::HOST_TIMEOUT_MS) return;
  hostTimedOut = true;
  latestCommand = makeStopPacket(0);
  Serial.println(F("HOST_TIMEOUT:1"));
}

}  // namespace

void setup() {
  Serial.begin(115200);
  lastValidHostMs = millis();
  Serial.println(F("HOST_TIMEOUT:1"));
  Serial.println(F("LINK:NONE"));
  radioReady = initializeRadio();
  nextRadioInitRetryMs = millis() + RADIO_INIT_RETRY_MS;
  nextRadioTxMs = millis();
}

void loop() {
  const uint32_t now = millis();
  readHostSerial();
  serviceHostTimeout(now);
  serviceRadio(now);
  serviceStatusReport(now);
}
