#pragma once

// EXAMPLE ONLY for a generic ESP32-S3 DevKitC-1. Confirm all pins against the
// exact board, SX1262 carrier and motor driver before applying motor power.
namespace gesturedrive {
namespace receiver_pins {

constexpr int LORA_SCK = 12;
constexpr int LORA_MISO = 13;
constexpr int LORA_MOSI = 11;
constexpr int LORA_NSS = 10;
constexpr int LORA_DIO1 = 8;
constexpr int LORA_RESET = 9;
constexpr int LORA_BUSY = 14;

// Discrete RF-switch control lines (RXEN/TXEN), mirroring the transmitter
// header. Many SX1262 modules manage the antenna switch from DIO2 instead and
// have no discrete RXEN/TXEN pins — the user must confirm their module. (The
// transmitter currently assumes discrete RXEN/TXEN on pins 6/7.) Set
// HAS_RF_SWITCH = true and fill in the pins only for modules with discrete
// switch lines.
constexpr bool HAS_RF_SWITCH = false;
constexpr int LORA_RXEN = -1;  // TODO: set when HAS_RF_SWITCH = true.
constexpr int LORA_TXEN = -1;  // TODO: set when HAS_RF_SWITCH = true.

// Battery voltage sense for telemetry. Disabled by default (-1). To enable:
// wire the pack through a resistor divider to an ADC1-capable pin (GPIO1..10
// on ESP32-S3), set the pin number here and set BATTERY_DIVIDER_RATIO =
// (R_top + R_bottom) / R_bottom. The firmware uses analogReadMilliVolts(),
// so no manual attenuation calibration is needed.
constexpr int BATTERY_ADC_PIN = -1;
constexpr float BATTERY_DIVIDER_RATIO = 2.0F;

// Two direction inputs plus one PWM input per motor. This works with TB6612FNG
// and L298N-style drivers. STANDBY is used by TB6612FNG; set HAS_STANDBY false
// for drivers without it and wire their enable pins as required.
constexpr int LEFT_IN1 = 4;
constexpr int LEFT_IN2 = 5;
constexpr int LEFT_PWM = 6;
constexpr int RIGHT_IN1 = 15;
constexpr int RIGHT_IN2 = 16;
constexpr int RIGHT_PWM = 17;
constexpr int STANDBY = 18;
constexpr bool HAS_STANDBY = true;

constexpr bool LEFT_INVERTED = false;
constexpr bool RIGHT_INVERTED = false;

constexpr uint8_t LEFT_PWM_CHANNEL = 0;
constexpr uint8_t RIGHT_PWM_CHANNEL = 1;
constexpr uint32_t PWM_FREQUENCY_HZ = 20000;
constexpr uint8_t PWM_RESOLUTION_BITS = 10;

}  // namespace receiver_pins
}  // namespace gesturedrive
