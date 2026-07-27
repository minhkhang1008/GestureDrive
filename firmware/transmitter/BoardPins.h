#pragma once

// EXAMPLE ONLY for a generic ESP32-S3 DevKitC-1. Confirm all pins against the
// exact board and SX1262 carrier before powering the radio.
namespace gesturedrive {
namespace transmitter_pins {

constexpr int LORA_SCK = 12;
constexpr int LORA_MISO = 13;
constexpr int LORA_MOSI = 11;
constexpr int LORA_NSS = 10;
constexpr int LORA_DIO1 = 8;
constexpr int LORA_RESET = 9;
constexpr int LORA_BUSY = 14;

// Discrete RF-switch control lines (RXEN/TXEN). Default true because this
// board already declares them on pins 6/7 — confirm against the real module.
// Many SX1262 modules manage the antenna switch from DIO2 instead and have no
// discrete RXEN/TXEN pins; set HAS_RF_SWITCH = false for those.
constexpr bool HAS_RF_SWITCH = true;
constexpr int LORA_RXEN = 6;
constexpr int LORA_TXEN = 7;

}  // namespace transmitter_pins
}  // namespace gesturedrive
