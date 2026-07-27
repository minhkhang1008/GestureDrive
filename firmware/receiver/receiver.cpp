#include <Arduino.h>
#include <RadioLib.h>
#include <SPI.h>

#include <esp_attr.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

#include <string.h>

#include "BoardPins.h"
#include "MotorController.h"
#include "../common/ConfigDefaults.h"
#include "../common/DriveProtocol.h"
#include "../common/RadioConfig.h"
#include "../common/TelemetryProtocol.h"

using namespace gesturedrive;

namespace {

// Telemetry airtime is ~20.6 ms at SF7/BW250/CR4:5; 60 ms is a generous bound
// covering IRQ latency, so a lost TX-done can never deafen the receiver.
constexpr uint32_t TELEMETRY_TX_TIMEOUT_MS = 60;
constexpr uint32_t RADIO_INIT_RETRY_MS = 2000;
constexpr uint32_t RADIO_REINIT_INTERVAL_MS = 1000;
constexpr uint32_t RECEIVE_RETRY_BACKOFF_MS = 20;
constexpr uint8_t RECEIVE_FAILURES_BEFORE_REINIT = 5;
// Task watchdog: a hung loop would otherwise leave LEDC driving the last PWM
// forever. The WDT reboot lands in MotorDriver::begin() (outputs low, STANDBY
// low), which is the safe state.
constexpr uint32_t TASK_WDT_TIMEOUT_S = 2;
constexpr uint32_t ESTOP_LATCH_MAGIC = 0x45535450UL;  // "ESTP"

// RadioLib's DIO1 line is shared by TX-done and RX-done. A single latched flag
// is interpreted in loop() according to this explicit state.
enum class RadioState : uint8_t {
  IDLE,            // nothing armed (startReceive failed; recovery pending)
  RX_ARMED,        // listening for control packets
  TX_IN_PROGRESS,  // telemetry transmit running
};

SX1262 radio = new Module(receiver_pins::LORA_NSS,
                          receiver_pins::LORA_DIO1,
                          receiver_pins::LORA_RESET,
                          receiver_pins::LORA_BUSY);
MotorController motorController;

// DIO1 is edge-triggered and shared by TX-done and RX-done. A plain bool flag
// loses an event whenever the ISR fires between the loop's test and its clear,
// which would stall the radio until the operation timeout. A monotonic counter
// written only by the ISR and compared in the loop cannot lose an edge.
volatile uint32_t dio1Events = 0;
uint32_t dio1Handled = 0;
RadioState radioState = RadioState::IDLE;
bool radioReady = false;
bool hasSequence = false;
uint16_t lastSequence = 0;
uint32_t lastValidPacketMs = 0;
bool radioFailsafe = true;
bool estopLatched = false;
uint8_t disarmedStopCount = 0;

// Battery protection state. Inactive while BATTERY_ADC_PIN is unset.
bool batteryValid = false;
uint16_t batteryMilliVolts = 0;
bool batteryLow = false;
bool batteryCritical = false;
uint8_t batteryCriticalSamples = 0;
uint32_t nextBatterySampleMs = 0;

uint8_t consecutiveReceiveFailures = 0;
uint32_t nextReceiveRetryMs = 0;
uint32_t nextRadioInitRetryMs = 0;
uint32_t nextRadioReinitMs = 0;

// Link quality of the last accepted control packet, for telemetry.
int8_t lastRssiDbm = -127;
int8_t lastSnrDbX4 = 0;

// Loss accounting between telemetry packets: on each accepted newer control
// packet expected grows by the uint16 sequence delta, received by one.
uint32_t lossExpected = 0;
uint32_t lossReceived = 0;

uint8_t telemetrySequence = 0;
uint32_t lastTelemetryMs = 0;
uint32_t telemetryTxStartedMs = 0;
uint32_t nextStatusReportMs = 0;

// E-stop latch survives brownout / soft reset (panic, WDT): RTC noinit RAM is
// preserved through every reset except a true power-on.
RTC_NOINIT_ATTR uint32_t estopLatchBootMagic;

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

void reportRadioError(int16_t code) {
  Serial.print(F("RADIO_ERROR:"));
  Serial.println(code);
}

void setEstopLatched(bool latched) {
  estopLatched = latched;
  estopLatchBootMagic = latched ? ESTOP_LATCH_MAGIC : 0U;
}

// Arms a receive window. On failure the state falls back to IDLE and the
// recovery service retries with a small backoff (never a permanent deafness).
bool armReceive() {
  discardDio1Events();  // drop any stale edge before a new operation
  const int16_t state = radio.startReceive();
  if (state == RADIOLIB_ERR_NONE) {
    radioState = RadioState::RX_ARMED;
    consecutiveReceiveFailures = 0;
    return true;
  }
  reportRadioError(state);
  radioState = RadioState::IDLE;
  if (consecutiveReceiveFailures < 255U) ++consecutiveReceiveFailures;
  nextReceiveRetryMs = millis() + RECEIVE_RETRY_BACKOFF_MS;
  return false;
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

  // Many SX1262 modules switch the antenna via DIO2 (no discrete RXEN/TXEN);
  // only boards with discrete switch lines set HAS_RF_SWITCH in BoardPins.h.
  if (receiver_pins::HAS_RF_SWITCH) {
    radio.setRfSwitchPins(receiver_pins::LORA_RXEN, receiver_pins::LORA_TXEN);
  }

  const int16_t crcState = radio.setCRC(radio_config::PHY_CRC_ENABLED);
  if (crcState != RADIOLIB_ERR_NONE) {
    reportRadioError(crcState);
    return false;
  }
  radio.setDio1Action(onDio1);
  // A failed first startReceive is not fatal: the recovery service retries.
  armReceive();
  return true;
}

// begin()/startReceive() failures must not be permanent: retry startReceive
// with a small backoff, escalate to a full re-init after repeated failures,
// and retry a failed begin() every 2 s.
void serviceRadioRecovery(uint32_t now) {
  if (!radioReady) {
    if (static_cast<int32_t>(now - nextRadioInitRetryMs) < 0) return;
    nextRadioInitRetryMs = now + RADIO_INIT_RETRY_MS;
    radioReady = initializeRadio();
    return;
  }
  if (radioState != RadioState::IDLE) return;

  if (consecutiveReceiveFailures >= RECEIVE_FAILURES_BEFORE_REINIT) {
    if (static_cast<int32_t>(now - nextRadioReinitMs) < 0) return;
    nextRadioReinitMs = now + RADIO_REINIT_INTERVAL_MS;
    radioReady = initializeRadio();
    if (radioReady) {
      consecutiveReceiveFailures = 0;
    } else {
      nextRadioInitRetryMs = now + RADIO_INIT_RETRY_MS;
    }
    return;
  }

  if (static_cast<int32_t>(now - nextReceiveRetryMs) < 0) return;
  armReceive();
}

void markPacketAccepted(const DrivePacket& packet, uint32_t now) {
  if (hasSequence) {
    lossExpected += static_cast<uint16_t>(packet.sequence - lastSequence);
  } else {
    lossExpected += 1U;
  }
  lossReceived += 1U;
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
    setEstopLatched(true);
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
        setEstopLatched(false);
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
  if (batteryCritical) {
    // Under-voltage lockout: accept and acknowledge the packet, drive nothing.
    motorController.disable();
    return;
  }
  motorController.applyCommand(packet);
}

uint8_t computeLossPercent() {
  if (lossExpected == 0U || lossReceived >= lossExpected) return 0U;
  uint32_t loss = (100U * (lossExpected - lossReceived)) / lossExpected;
  if (loss > 100U) loss = 100U;
  return static_cast<uint8_t>(loss);
}

int8_t clampToOutputPermilleDiv10(int16_t permille) {
  int16_t scaled = static_cast<int16_t>(permille / 10);
  if (scaled > 100) scaled = 100;
  if (scaled < -100) scaled = -100;
  return static_cast<int8_t>(scaled);
}

/** Pack voltage through the divider. False when battery sensing is not wired. */
bool readBatteryMilliVolts(uint16_t& value) {
  if (receiver_pins::BATTERY_ADC_PIN < 0) return false;
  const float milliVolts =
      static_cast<float>(analogReadMilliVolts(receiver_pins::BATTERY_ADC_PIN)) *
      receiver_pins::BATTERY_DIVIDER_RATIO;
  long rounded = lroundf(milliVolts);
  if (rounded < 0) rounded = 0;
  if (rounded > 65535) rounded = 65535;
  value = static_cast<uint16_t>(rounded);
  return true;
}

/**
 * Under-voltage protection. The critical stop is latched for the rest of the
 * power cycle on purpose: a pack that recovers once the motors stop is still
 * an empty pack, and resuming would only drive the cells further down.
 */
void serviceBattery(uint32_t now) {
  if (static_cast<int32_t>(now - nextBatterySampleMs) < 0) return;
  nextBatterySampleMs = now + config::BATTERY_SAMPLE_INTERVAL_MS;

  uint16_t milliVolts = 0;
  if (!readBatteryMilliVolts(milliVolts)) {
    batteryValid = false;
    return;
  }
  batteryValid = true;
  batteryMilliVolts = milliVolts;
  batteryLow = milliVolts < config::BATTERY_WARN_MV;

  if (milliVolts < config::BATTERY_CRITICAL_MV) {
    if (batteryCriticalSamples < 255U) ++batteryCriticalSamples;
  } else {
    // Several consecutive samples are required, so a stall-current sag cannot
    // latch the stop on its own.
    batteryCriticalSamples = 0;
  }

  if (!batteryCritical &&
      batteryCriticalSamples >= config::BATTERY_CRITICAL_SAMPLES) {
    batteryCritical = true;
    motorController.setStop();
    motorController.disable();
    Serial.println(F("BATTERY_CRITICAL:1"));
  }
}

// Starts the telemetry reply inside ESP1's idle gap. Returns true when the TX
// was started (RX is re-armed by the TX-done branch in loop()).
bool startTelemetryTransmit(uint32_t now) {
  TelemetryPacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = TELEMETRY_MAGIC;

  uint8_t flags = 0;
  if (radioFailsafe) flags |= TELEMETRY_FLAG_FAILSAFE;
  if (estopLatched) flags |= TELEMETRY_FLAG_ESTOP_LATCHED;
  if (!motorController.isDriverEnabled()) flags |= TELEMETRY_FLAG_MOTORS_DISABLED;

  if (batteryValid) {
    flags |= TELEMETRY_FLAG_BATTERY_VALID;
    long units = lroundf(static_cast<float>(batteryMilliVolts) / 50.0F);
    if (units < 0) units = 0;
    if (units > 255) units = 255;
    packet.battery50mV = static_cast<uint8_t>(units);
    if (batteryLow) flags |= TELEMETRY_FLAG_BATTERY_LOW;
    if (batteryCritical) flags |= TELEMETRY_FLAG_BATTERY_CRITICAL;
  }

  packet.versionAndFlags = makeTelemetryVersionAndFlags(flags);
  packet.sequence = telemetrySequence++;
  packet.rssiDbm = lastRssiDbm;
  packet.snrDbX4 = lastSnrDbX4;
  packet.lossPercent = computeLossPercent();
  lossExpected = 0;
  lossReceived = 0;
  packet.leftPermilleDiv10 =
      clampToOutputPermilleDiv10(motorController.leftOutput());
  packet.rightPermilleDiv10 =
      clampToOutputPermilleDiv10(motorController.rightOutput());
  finalizeTelemetryPacket(packet);

  radio.standby();
  discardDio1Events();  // drop any stale edge before a new operation
  const int16_t state = radio.startTransmit(
      reinterpret_cast<const uint8_t*>(&packet), sizeof(packet));
  if (state != RADIOLIB_ERR_NONE) {
    reportRadioError(state);
    return false;
  }
  radioState = RadioState::TX_IN_PROGRESS;
  telemetryTxStartedMs = now;
  lastTelemetryMs = now;
  return true;
}

void captureLinkQuality() {
  const float rssi = radio.getRSSI();
  long rssiRounded = lroundf(rssi);
  if (rssiRounded < -127) rssiRounded = -127;
  if (rssiRounded > 0) rssiRounded = 0;
  lastRssiDbm = static_cast<int8_t>(rssiRounded);

  long snrX4 = lroundf(radio.getSNR() * 4.0F);
  if (snrX4 < -128) snrX4 = -128;
  if (snrX4 > 127) snrX4 = 127;
  lastSnrDbX4 = static_cast<int8_t>(snrX4);
}

void processRadioPacket(uint32_t now) {
  const size_t packetLength = radio.getPacketLength();
  uint8_t buffer[255];
  const size_t readLength = packetLength > sizeof(buffer) ? sizeof(buffer)
                                                          : packetLength;
  const int16_t state = radio.readData(buffer, readLength);
  bool controlAccepted = false;
  if (state == RADIOLIB_ERR_NONE && packetLength == sizeof(DrivePacket)) {
    DrivePacket packet;
    memcpy(&packet, buffer, sizeof(packet));
    if (isPacketShapeValid(packet) && hasValidPacketCrc(packet)) {
      captureLinkQuality();
      handleAcceptedPacket(packet, now);
      controlAccepted = true;
    }
  } else if (state != RADIOLIB_ERR_NONE &&
             state != RADIOLIB_ERR_CRC_MISMATCH) {
    reportRadioError(state);
  }

  // The moment a valid control packet is accepted marks the start of ESP1's
  // ~24 ms idle gap: the telemetry reply is sent right now, at most once per
  // TELEMETRY_INTERVAL_MS.
  if (controlAccepted &&
      now - lastTelemetryMs >= config::TELEMETRY_INTERVAL_MS) {
    if (startTelemetryTransmit(now)) return;  // RX re-armed after TX-done
  }
  armReceive();
}

void finishTelemetryTransmit() {
  const int16_t state = radio.finishTransmit();
  if (state != RADIOLIB_ERR_NONE) reportRadioError(state);
  armReceive();
}

void serviceRadio(uint32_t now) {
  if (!radioReady) return;

  if (radioState == RadioState::TX_IN_PROGRESS) {
    if (consumeDio1Event()) {
      finishTelemetryTransmit();
    } else if (now - telemetryTxStartedMs > TELEMETRY_TX_TIMEOUT_MS) {
      discardDio1Events();  // a late edge must not leak into the next operation
      radio.finishTransmit();
      reportRadioError(-1000);
      armReceive();
    }
    return;
  }

  if (radioState == RadioState::RX_ARMED && consumeDio1Event()) {
    processRadioPacket(now);
  }
}

void serviceFailsafe(uint32_t now) {
  const uint32_t silenceMs = now - lastValidPacketMs;
  if (silenceMs > config::RADIO_TIMEOUT_MS && !radioFailsafe) {
    radioFailsafe = true;
    // An ESP1 reboot restarts its radio sequence near zero; dropping the
    // sequence lock here lets the link recover after one watchdog window
    // instead of staying deaf until the 16-bit counter wraps (~27 min).
    hasSequence = false;
    motorController.setStop();
    Serial.println(F("FAILSAFE:1"));
  }
  if (silenceMs > config::MOTOR_DISABLE_TIMEOUT_MS) {
    motorController.disable();
  }
}

// Bench debugging over the receiver's own USB serial, matching ESP1's
// serviceStatusReport cadence.
void serviceStatusReport(uint32_t now) {
  if (static_cast<int32_t>(now - nextStatusReportMs) < 0) return;
  nextStatusReportMs = now + 1000;
  Serial.println(radioFailsafe ? F("FAILSAFE:1") : F("FAILSAFE:0"));
  Serial.println(estopLatched ? F("ESTOP_LATCHED:1")
                              : F("ESTOP_LATCHED:0"));
  if (batteryValid) {
    Serial.print(F("BATTERY_MV:"));
    Serial.println(batteryMilliVolts);
  }
  if (batteryCritical) Serial.println(F("BATTERY_CRITICAL:1"));
}

}  // namespace

void setup() {
  // Motor outputs and STANDBY are made safe before radio initialization.
  motorController.begin();
  Serial.begin(115200);

  // Restore the E-stop latch across brownout / soft reset. Only a true
  // power-on clears it (RTC noinit RAM is undefined on power-on anyway).
  if (esp_reset_reason() != ESP_RST_POWERON &&
      estopLatchBootMagic == ESTOP_LATCH_MAGIC) {
    estopLatched = true;
    Serial.println(F("ESTOP_LATCHED:1"));
  } else {
    estopLatchBootMagic = 0U;
  }

  // IDF 4.4 task watchdog API: reboot on a hung loop instead of driving the
  // last PWM value forever.
  esp_task_wdt_init(TASK_WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

  lastValidPacketMs = millis();
  Serial.println(F("FAILSAFE:1"));
  radioReady = initializeRadio();
  nextRadioInitRetryMs = millis() + RADIO_INIT_RETRY_MS;
}

void loop() {
  esp_task_wdt_reset();
  const uint32_t now = millis();
  serviceRadioRecovery(now);
  serviceRadio(now);
  serviceFailsafe(now);
  serviceBattery(now);
  serviceStatusReport(now);
  motorController.update();
}
