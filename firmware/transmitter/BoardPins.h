#pragma once

// EXAMPLE ONLY for a generic ESP32-S3 DevKitC-1 plus a separate SX1262 module.
// Confirm every pin against the exact ESP32-S3 board and SX1262 carrier before
// powering the radio. Never transmit without an antenna attached.
namespace gesturedrive {
namespace transmitter_pins {

constexpr int LORA_SCK = 12;
constexpr int LORA_MISO = 13;
constexpr int LORA_MOSI = 11;
constexpr int LORA_NSS = 10;
constexpr int LORA_DIO1 = 8;
constexpr int LORA_RESET = 9;
constexpr int LORA_BUSY = 14;

}  // namespace transmitter_pins
}  // namespace gesturedrive
