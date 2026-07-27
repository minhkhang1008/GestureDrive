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
dấu phẩy, CRC hay newline. App serialize CRC thành đúng bốn hex digit viết hoa;
ESP1 parse không phân biệt hoa/thường (`strtoul` base 16) nhưng vẫn bắt buộc
đúng bốn hex digit.

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

### Host sequence resync

Host timeout định nghĩa một browser session mới: sau `HOST_TIMEOUT:1`, ESP1 cho
phép sequence bắt đầu lại (kể cả từ 0). Nếu một browser session mới bắt đầu mà
không có host timeout xen giữa (reload tab nhanh), các dòng của nó sẽ bị loại
với `HOST_ERROR:SEQUENCE`; sau **3 lần loại liên tiếp**, ESP1 bỏ sequence lock,
báo `HOST_ERROR:SEQUENCE_RESYNC` và chấp nhận dòng hợp lệ kế tiếp. Ngoài ra,
mất radio 225 ms cũng khiến ESP2 bỏ sequence lock của chính nó, để một ESP1 vừa
reboot (radio sequence gần 0) khôi phục link sau một cửa sổ watchdog thay vì
chờ bộ đếm 16 bit wrap.

## E-stop reset

1. ESP2 nhận STOP + ESTOP và latch, PWM 0, driver disable.
2. Mọi movement command bị bỏ qua khi latch.
3. ESP2 phải nhận ít nhất ba STOP disarmed có sequence mới.
4. Sau đó ESP2 nhận STOP + RESET_ESTOP có sequence mới.
5. Latch được clear nhưng output vẫn 0; không command cũ nào chạy lại.
6. Phía web: khi telemetry còn tươi (≤ 2.5 s), app chỉ coi reset thành công sau
   khi thấy telemetry báo `estop = 0`; telemetry vẫn báo latch thì reset bị hủy.
   Latch trên ESP2 còn được giữ qua brownout/soft reset bằng RTC noinit RAM —
   chỉ power-on thật mới xóa.

## Telemetry ESP2 tới ESP1

Packet nhị phân little-endian cố định 12 byte, định nghĩa tại
`firmware/common/TelemetryProtocol.h`:

| Offset | Size | Field | Giá trị |
| ---: | ---: | --- | --- |
| 0 | 2 | magic | `0x4754` ("GT") |
| 2 | 1 | versionAndFlags | 2 bit cao: version = 2; 6 bit thấp: flags |
| 3 | 1 | sequence | bộ đếm telemetry riêng, độc lập control sequence |
| 4 | 1 | rssiDbm | `int8`, dBm của control packet cuối, clamp [-127, 0] |
| 5 | 1 | snrDbX4 | `int8`, SNR nhân 4 (0.25 dB/đơn vị) |
| 6 | 1 | lossPercent | control packet loss 0..100 kể từ telemetry trước |
| 7 | 1 | battery50mV | điện áp pin theo đơn vị 50 mV; 0 khi không đo |
| 8 | 1 | leftPermilleDiv10 | output motor trái chia 10, -100..100 |
| 9 | 1 | rightPermilleDiv10 | output motor phải chia 10, -100..100 |
| 10 | 2 | crc16 | CRC-16/CCITT của byte 0..9 |

Flags ở 6 bit thấp của `versionAndFlags`:

| Bit | Tên | Ý nghĩa |
| ---: | --- | --- |
| 0 | FAILSAFE | ESP2 đang trong radio failsafe |
| 1 | ESTOP_LATCHED | E-stop đang latch trên xe |
| 2 | MOTORS_DISABLED | driver đã bị disable (STANDBY hạ) |
| 3 | BATTERY_VALID | `battery50mV` là số đo thật |
| 4 | BATTERY_LOW | pin dưới `BATTERY_WARN_MV`; xe vẫn chạy, chỉ cảnh báo |
| 5 | BATTERY_CRITICAL | pin dưới `BATTERY_CRITICAL_MV` đủ lâu; ESP2 đã khóa motor |

**Version 2** dời version lên 2 bit cao để mở rộng flags từ 4 lên 6 bit mà
không làm packet dài thêm. Giữ nguyên 12 byte là bắt buộc: airtime 20.6 ms của
nó phải nằm gọn trong khe idle ~24 ms giữa hai lần phát control của ESP1.
Firmware ESP1 và ESP2 phải được nạp cùng version — ESP1 loại bỏ mọi telemetry
có version khác, vì bố cục flags đã thay đổi.

### Khe thời gian TDMA

Ở SF7/BW250/CR4:5, preamble 8 symbol, explicit header và PHY CRC bật:

- Control packet 16 byte: airtime ≈ 25.7 ms, phát mỗi 50 ms, để lại khe idle
  ≈ 24.3 ms giữa hai lần phát của ESP1.
- Telemetry packet 12 byte: airtime ≈ 20.6 ms.

ESP2 phát telemetry **ngay khi chấp nhận một control packet hợp lệ** — thời
điểm đó đánh dấu đầu khe idle của ESP1 — nên 20.6 ms airtime nằm gọn trong khe
~24 ms với vài ms dư cho độ trễ IRQ và xử lý. ESP1 mở cửa sổ receive ngay sau
khi transmit control xong, vì vậy reply không bao giờ đụng control TX. ESP2
giới hạn tối đa một telemetry mỗi `TELEMETRY_INTERVAL_MS` (500 ms), tức ~2 Hz.
Đây không phải ACK từng control packet; packet loss được ESP2 tự cộng dồn giữa
hai lần telemetry và báo bằng `lossPercent`.

## ESP1 status lines

```text
LINK:LORA
LINK:NONE
HOST_TIMEOUT:0
HOST_TIMEOUT:1
RADIO_TX:<sequence>
RADIO_ERROR:<code>
HOST_ERROR:<reason>
TELEMETRY:<...>
```

Khi nhận telemetry hợp lệ (đúng magic/version/CRC), ESP1 in một dòng:

```text
TELEMETRY:sequence,rssiDbm,snrDb,lossPercent,failsafe,batteryMv,left,right,estop,uplinkRssi,uplinkSnr,batteryLow,batteryCritical
```

Thứ tự và đơn vị các trường:

| Trường | Đơn vị | Ghi chú |
| --- | --- | --- |
| sequence | - | bộ đếm telemetry 8 bit |
| rssiDbm | dBm | số nguyên âm, ví dụ `-62` |
| snrDb | dB | số thực hai chữ số lẻ (`snrDbX4 / 4`) |
| lossPercent | % | 0..100 |
| failsafe | 0/1 | flag FAILSAFE |
| batteryMv | mV | `battery50mV * 50`; **0 nghĩa là không đo được** (frontend hiển thị null) |
| left | permille | `leftPermilleDiv10 * 10`, -1000..1000 |
| right | permille | `rightPermilleDiv10 * 10`, -1000..1000 |
| estop | 0/1 | flag ESTOP_LATCHED |
| uplinkRssi | dBm | ESP1 tự đo trên chính gói telemetry (chiều xe → trạm) |
| uplinkSnr | dB | ESP1 tự đo trên chính gói telemetry |
| batteryLow | 0/1 | flag BATTERY_LOW |
| batteryCritical | 0/1 | flag BATTERY_CRITICAL |

`rssiDbm`/`snrDb` là chiều **trạm → xe** do ESP2 đo trên control packet;
`uplinkRssi`/`uplinkSnr` là chiều **xe → trạm** do ESP1 đo trên gói telemetry.
Có cả hai chiều thì một liên kết lệch (một đầu điếc, một anten lệch tần) hiện
ra rõ thay vì phải đoán. Frontend lấy chiều yếu hơn để tính biên dự trữ.

Parser ở `src/lib/serialProtocol.ts` chỉ bắt buộc 6 trường đầu; dòng ngắn hơn
từ firmware ESP1 cũ vẫn parse được, các trường thiếu trả về `null`.
