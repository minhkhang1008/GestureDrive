# GestureDrive Protocol v2

## Laptop tới ESP1

Mỗi command là một dòng ASCII:

```text
GD2,sequence,type,channelA,channelB,speedLimit,flags,crc\n
```

Ví dụ:

```text
GD2,42,1,750,-125,600,1,4428
```

CRC là CRC-16/CCITT-FALSE, polynomial `0x1021`, initial `0xFFFF`, không reflect,
không final XOR. CRC được tính trên toàn bộ phần trước dấu phẩy cuối, không gồm
dấu phẩy, CRC hay newline. Trường CRC là bốn hex digit viết hoa.

| Trường | Miền | Ý nghĩa |
| --- | ---: | --- |
| sequence | 0..65535 | Sequence host, wrap 16 bit |
| type | 0..2 | STOP, DRIVE, DIRECT_PWM |
| channelA | -1000..1000 | throttle hoặc left command |
| channelB | -1000..1000 | steering hoặc right command |
| speedLimit | 0..1000 | ceiling/scale an toàn |
| flags | 0..255 | bit field bên dưới |

ESP1 giới hạn line ở 95 byte data + null terminator. Prefix, field count, numeric
range, CRC, shape và sequence đều phải hợp lệ. Dòng lỗi không thay command đang
được phát.

## ESP1 tới ESP2

Packet nhị phân little-endian cố định 16 byte:

```cpp
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
```

| Offset | Size | Field | Giá trị |
| ---: | ---: | --- | --- |
| 0 | 2 | magic | `0x4744` |
| 2 | 1 | version | `2` |
| 3 | 1 | type | `0..2` |
| 4 | 2 | sequence | radio sequence |
| 6 | 2 | channelA | signed normalized command |
| 8 | 2 | channelB | signed normalized command |
| 10 | 2 | speedLimit | `0..1000` |
| 12 | 1 | flags | bit field |
| 13 | 1 | reserved | phải bằng 0 |
| 14 | 2 | crc16 | CRC của byte 0..13 |

`static_assert(sizeof(DrivePacket) == 16)` được compile ở cả ESP1 và ESP2. LoRa
PHY CRC vẫn bật, độc lập application CRC.

## Command types

| Type | Value | Channel A | Channel B |
| --- | ---: | --- | --- |
| STOP | 0 | 0 | 0 |
| DRIVE | 1 | throttle | steering |
| DIRECT_PWM | 2 | left command | right command |

STOP bắt buộc channel và speedLimit đều 0, không có ENABLE. DRIVE và DIRECT_PWM
bắt buộc có ENABLE.

Với DRIVE, throttle dương là tiến và âm là lùi. Steering dương tạo yaw trái theo
công thức mixer đã chỉ định; steering âm tạo yaw phải.

## Flags

| Bit | Hex | Tên | Ý nghĩa |
| ---: | ---: | --- | --- |
| 0 | `0x01` | ENABLE | cho phép command chuyển động |
| 1 | `0x02` | ESTOP | latch E-stop tại ESP2 |
| 2 | `0x04` | SPEED_LOCKED | metadata của speed gesture |
| 3 | `0x08` | RESET_ESTOP | yêu cầu clear latch sau chuỗi STOP |

ESTOP và RESET_ESTOP chỉ hợp lệ trên STOP và không được đặt cùng nhau.

## Sequence

Sequence `candidate` mới hơn `previous` khi:

```text
diff = uint16(candidate - previous)
diff != 0 && diff < 0x8000
```

Quy tắc này xử lý wrap `65535 -> 0`. ESP2 không refresh watchdog với packet trùng
hoặc cũ. E-stop đúng CRC/shape vẫn được ưu tiên để dừng ngay, nhưng packet trùng
không trở thành heartbeat.

## E-stop reset

1. ESP2 nhận STOP + ESTOP và latch, PWM 0, driver disable.
2. Mọi movement command bị bỏ qua khi latch.
3. ESP2 phải nhận ít nhất ba STOP disarmed có sequence mới.
4. Sau đó ESP2 nhận STOP + RESET_ESTOP có sequence mới.
5. Latch được clear nhưng output vẫn 0; không command cũ nào chạy lại.

## ESP1 status lines

```text
LINK:LORA
LINK:NONE
HOST_TIMEOUT:0
HOST_TIMEOUT:1
RADIO_TX:<sequence>
RADIO_ERROR:<code>
HOST_ERROR:<reason>
```

Frontend cũng hiểu telemetry P1:

```text
TELEMETRY:sequence,rssi,snr,packetLoss,failsafe,batteryMv,left,right,estop
```

Firmware P0 chưa phát telemetry và không ACK từng control packet.
