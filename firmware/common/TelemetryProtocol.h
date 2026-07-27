#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "Crc16.h"

namespace gesturedrive {

// Telemetry backchannel ESP2 -> ESP1, sent on the same raw LoRa channel.
//
// Timing rationale: a 12-byte payload at SF7 / BW250 / CR4:5 (preamble 8,
// explicit header, PHY CRC on) is ~20.6 ms of airtime. ESP1 transmits a
// 16-byte control packet (~25.7 ms) every 50 ms, leaving a ~24 ms idle gap
// between transmissions. ESP2 replies immediately after accepting a control
// packet (that moment marks the start of ESP1's idle window), so the
// telemetry reply fits inside the gap and never collides with control TX.
constexpr uint16_t TELEMETRY_MAGIC = 0x4754;  // "GT"
// v2 moved the version into the top two bits so the flag field could grow from
// four to six bits without lengthening the packet. Keeping the packet at 12
// bytes matters: at SF7/BW250/CR4:5 it is ~20.6 ms of airtime and has to fit
// inside the ~24 ms gap between ESP1's control transmissions.
constexpr uint8_t TELEMETRY_VERSION = 2;
constexpr size_t TELEMETRY_PACKET_SIZE = 12;
constexpr uint8_t TELEMETRY_VERSION_SHIFT = 6;
constexpr uint8_t TELEMETRY_FLAG_MASK = 0x3FU;

// Lower six bits of versionAndFlags.
enum TelemetryFlag : uint8_t {
  TELEMETRY_FLAG_FAILSAFE = 1U << 0,
  TELEMETRY_FLAG_ESTOP_LATCHED = 1U << 1,
  TELEMETRY_FLAG_MOTORS_DISABLED = 1U << 2,
  TELEMETRY_FLAG_BATTERY_VALID = 1U << 3,
  // Pack below the warning threshold: advisory only, the vehicle keeps driving.
  TELEMETRY_FLAG_BATTERY_LOW = 1U << 4,
  // Pack below the critical threshold for long enough that the receiver has
  // latched a stop to protect the cells.
  TELEMETRY_FLAG_BATTERY_CRITICAL = 1U << 5,
};

#pragma pack(push, 1)
struct TelemetryPacket {
  uint16_t magic;            // TELEMETRY_MAGIC
  uint8_t versionAndFlags;   // top 2 bits: version; low 6 bits: flags
  uint8_t sequence;          // rolling telemetry counter (independent of control)
  int8_t rssiDbm;            // last accepted control packet, clamped [-127, 0]
  int8_t snrDbX4;            // SNR * 4, clamped to int8 range
  uint8_t lossPercent;       // control packet loss 0..100 since last telemetry
  uint8_t battery50mV;       // battery voltage in 50 mV units, 0 when invalid
  int8_t leftPermilleDiv10;  // motor output / 10 -> -100..100
  int8_t rightPermilleDiv10; // motor output / 10 -> -100..100
  uint16_t crc16;            // crc16Ccitt over all preceding bytes
};
#pragma pack(pop)

static_assert(sizeof(TelemetryPacket) == TELEMETRY_PACKET_SIZE,
              "TelemetryPacket must remain exactly 12 bytes");

inline uint8_t makeTelemetryVersionAndFlags(uint8_t flags) {
  return static_cast<uint8_t>((TELEMETRY_VERSION << TELEMETRY_VERSION_SHIFT) |
                              (flags & TELEMETRY_FLAG_MASK));
}

inline uint8_t telemetryVersion(const TelemetryPacket& packet) {
  return static_cast<uint8_t>(packet.versionAndFlags >> TELEMETRY_VERSION_SHIFT);
}

inline uint8_t telemetryFlags(const TelemetryPacket& packet) {
  return static_cast<uint8_t>(packet.versionAndFlags & TELEMETRY_FLAG_MASK);
}

inline void finalizeTelemetryPacket(TelemetryPacket& packet) {
  packet.crc16 = crc16Ccitt(reinterpret_cast<const uint8_t*>(&packet),
                            offsetof(TelemetryPacket, crc16));
}

inline bool hasValidTelemetryCrc(const TelemetryPacket& packet) {
  return packet.crc16 ==
         crc16Ccitt(reinterpret_cast<const uint8_t*>(&packet),
                    offsetof(TelemetryPacket, crc16));
}

inline bool isTelemetryShapeValid(const TelemetryPacket& packet) {
  return packet.magic == TELEMETRY_MAGIC &&
         telemetryVersion(packet) == TELEMETRY_VERSION &&
         packet.lossPercent <= 100U;
}

}  // namespace gesturedrive
