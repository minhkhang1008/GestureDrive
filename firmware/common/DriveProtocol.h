#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "Crc16.h"

namespace gesturedrive {

constexpr uint16_t DRIVE_MAGIC = 0x4744;
constexpr uint8_t DRIVE_VERSION = 2;
constexpr size_t DRIVE_PACKET_SIZE = 16;
constexpr int16_t CONTROL_MIN = -1000;
constexpr int16_t CONTROL_MAX = 1000;

enum CommandType : uint8_t {
  COMMAND_STOP = 0,
  COMMAND_DRIVE = 1,
  COMMAND_DIRECT_PWM = 2,
};

enum CommandFlag : uint8_t {
  FLAG_ENABLE = 1U << 0,
  FLAG_ESTOP = 1U << 1,
  FLAG_SPEED_LOCKED = 1U << 2,
  FLAG_RESET_ESTOP = 1U << 3,
};

constexpr uint8_t KNOWN_FLAGS =
    FLAG_ENABLE | FLAG_ESTOP | FLAG_SPEED_LOCKED | FLAG_RESET_ESTOP;

#pragma pack(push, 1)
struct DrivePacket {
  uint16_t magic;
  uint8_t version;
  uint8_t type;
  uint16_t sequence;
  int16_t channelA;
  int16_t channelB;
  uint16_t speedLimit;
  uint8_t flags;
  uint8_t reserved;
  uint16_t crc16;
};
#pragma pack(pop)

static_assert(sizeof(DrivePacket) == DRIVE_PACKET_SIZE,
              "DrivePacket must remain exactly 16 bytes");

inline void finalizePacket(DrivePacket& packet) {
  packet.crc16 = crc16Ccitt(reinterpret_cast<const uint8_t*>(&packet),
                           offsetof(DrivePacket, crc16));
}

inline bool hasValidPacketCrc(const DrivePacket& packet) {
  return packet.crc16 ==
         crc16Ccitt(reinterpret_cast<const uint8_t*>(&packet),
                    offsetof(DrivePacket, crc16));
}

inline DrivePacket makeStopPacket(uint16_t sequence, uint8_t flags = 0) {
  DrivePacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = DRIVE_MAGIC;
  packet.version = DRIVE_VERSION;
  packet.type = COMMAND_STOP;
  packet.sequence = sequence;
  packet.flags = flags;
  finalizePacket(packet);
  return packet;
}

inline bool isSequenceNewer(uint16_t candidate, uint16_t previous) {
  const uint16_t difference = static_cast<uint16_t>(candidate - previous);
  return difference != 0U && difference < 0x8000U;
}

inline bool isPacketShapeValid(const DrivePacket& packet) {
  if (packet.magic != DRIVE_MAGIC || packet.version != DRIVE_VERSION ||
      packet.reserved != 0U || (packet.flags & ~KNOWN_FLAGS) != 0U ||
      packet.type > COMMAND_DIRECT_PWM || packet.speedLimit > CONTROL_MAX ||
      packet.channelA < CONTROL_MIN || packet.channelA > CONTROL_MAX ||
      packet.channelB < CONTROL_MIN || packet.channelB > CONTROL_MAX) {
    return false;
  }
  if (packet.type == COMMAND_STOP) {
    if (packet.channelA != 0 || packet.channelB != 0 ||
        packet.speedLimit != 0 || (packet.flags & FLAG_ENABLE) != 0U) {
      return false;
    }
    if ((packet.flags & FLAG_ESTOP) != 0U) {
      return (packet.flags & FLAG_RESET_ESTOP) == 0U;
    }
    return true;
  }
  return (packet.flags & FLAG_ENABLE) != 0U &&
         (packet.flags & (FLAG_ESTOP | FLAG_RESET_ESTOP)) == 0U;
}

}  // namespace gesturedrive
