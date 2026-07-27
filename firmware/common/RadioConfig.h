#pragma once

#include <stdint.h>

namespace gesturedrive {
namespace radio_config {

constexpr float FREQUENCY_MHZ = 920.5F;
constexpr float BANDWIDTH_KHZ = 250.0F;
constexpr uint8_t SPREADING_FACTOR = 7;
constexpr uint8_t CODING_RATE_DENOMINATOR = 5;
constexpr uint8_t SYNC_WORD = 0x12;  // Private raw LoRa P2P sync word.
// 14 dBm (25 mW). Chosen for the demo: enough for a schoolyard at SF7/BW250
// while staying inside the power level commonly permitted in the shared
// 920-925 MHz band. Confirm against local regulations before raising it, and
// never transmit without an antenna fitted. See MASTERFILE.md section 3.1.
constexpr int8_t TX_POWER_DBM = 14;
constexpr uint16_t PREAMBLE_SYMBOLS = 8;
constexpr float TCXO_VOLTAGE = 1.6F;  // Set to 0.0F for an XTAL-based module.
constexpr bool USE_REGULATOR_LDO = false;
constexpr bool PHY_CRC_ENABLED = true;

}  // namespace radio_config
}  // namespace gesturedrive
