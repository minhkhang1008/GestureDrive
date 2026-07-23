#pragma once

#include <stdint.h>

namespace gesturedrive {
namespace radio_config {

constexpr float FREQUENCY_MHZ = 920.5F;
constexpr float BANDWIDTH_KHZ = 250.0F;
constexpr uint8_t SPREADING_FACTOR = 7;
constexpr uint8_t CODING_RATE_DENOMINATOR = 5;
constexpr uint8_t SYNC_WORD = 0x12;  // Private raw LoRa P2P sync word.
constexpr int8_t TX_POWER_DBM = 5;   // Low bench-test power, not module maximum.
constexpr uint16_t PREAMBLE_SYMBOLS = 8;
constexpr float TCXO_VOLTAGE = 1.6F;  // Set to 0.0F for an XTAL-based module.
constexpr bool USE_REGULATOR_LDO = false;
constexpr bool PHY_CRC_ENABLED = true;

}  // namespace radio_config
}  // namespace gesturedrive
