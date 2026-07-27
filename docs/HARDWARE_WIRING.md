# Đấu nối phần cứng

## Cảnh báo

- Các pin bên dưới chỉ là ví dụ cho ESP32-S3 DevKitC-1 generic.
- Xác nhận schematic/pinout của board và carrier SX1262 thực tế trước khi cấp
  nguồn. Một số board dùng GPIO cho flash, PSRAM, USB hoặc LED tích hợp.
- SX1262 cần antenna đúng dải tần. Không transmit khi chưa có antenna.
- Xác nhận carrier dùng 3.3 V trực tiếp hay có regulator. Không cấp 5 V vào chân
  logic SX1262 nếu carrier không cho phép.
- Nguồn motor không lấy từ chân 3.3 V/5 V của ESP32. Nối mass chung.
- Tần số 920.5 MHz và công suất 5 dBm vẫn phải phù hợp quy định địa phương.

## ESP1 tới SX1262

Source: `firmware/transmitter/BoardPins.h`.

| SX1262 | ESP1 GPIO ví dụ | Ghi chú |
| --- | ---: | --- |
| SCK | 12 | SPI clock |
| MISO | 13 | SPI radio -> ESP |
| MOSI | 11 | SPI ESP -> radio |
| NSS/CS | 10 | chip select |
| DIO1 | 8 | packet-done interrupt |
| RESET | 9 | active-low reset |
| BUSY | 14 | bắt buộc với SX1262/RadioLib |
| RXEN | 6 | chỉ khi module có RF switch rời (`HAS_RF_SWITCH = true`) |
| TXEN | 7 | chỉ khi module có RF switch rời (`HAS_RF_SWITCH = true`) |
| GND | GND | mass chung |
| VCC | theo carrier | thường 3.3 V, phải xác nhận |

`firmware/transmitter/BoardPins.h` mặc định `HAS_RF_SWITCH = true` với RXEN/TXEN
trên GPIO 6/7 — xác nhận với module thật; nhiều module SX1262 tự điều khiển
antenna switch bằng DIO2 và không có chân RXEN/TXEN rời, khi đó đặt
`HAS_RF_SWITCH = false` và bỏ hai dây này.

ESP1 nối laptop bằng USB data. Không có dây motor trên ESP1.

## ESP2 tới SX1262

Source: `firmware/receiver/BoardPins.h`.

| SX1262 | ESP2 GPIO ví dụ |
| --- | ---: |
| SCK | 12 |
| MISO | 13 |
| MOSI | 11 |
| NSS/CS | 10 |
| DIO1 | 8 |
| RESET | 9 |
| BUSY | 14 |

`firmware/receiver/BoardPins.h` mặc định `HAS_RF_SWITCH = false` (module quản
lý antenna switch bằng DIO2). Nếu module ESP2 có RXEN/TXEN rời, đặt
`HAS_RF_SWITCH = true` và điền hai chân `LORA_RXEN`/`LORA_TXEN` tương tự ESP1.

Hai phía phải dùng cùng config radio. Nếu carrier dùng XTAL thay vì TCXO, đổi
`TCXO_VOLTAGE` từ 1.6 V thành 0.0 V ở config chung.

## ESP2 tới motor driver

| Chức năng | GPIO ví dụ | TB6612FNG | L298N |
| --- | ---: | --- | --- |
| Left IN1 | 4 | AIN1 | IN1 |
| Left IN2 | 5 | AIN2 | IN2 |
| Left PWM | 6 | PWMA | ENA, tháo jumper enable |
| Right IN1 | 15 | BIN1 | IN3 |
| Right IN2 | 16 | BIN2 | IN4 |
| Right PWM | 17 | PWMB | ENB, tháo jumper enable |
| STANDBY | 18 | STBY | không có |

Với L298N, đặt `HAS_STANDBY = false`. Không nối GPIO 18 vào phần công suất không
xác định. Với driver khác, nó phải tương đương hai direction + một PWM mỗi motor
hoặc cần một adapter module mới trong `MotorDriver.h`.

**Tần số PWM:** `PWM_FREQUENCY_HZ` mặc định 20 kHz (trên ngưỡng nghe được),
phù hợp TB6612FNG (switching tối đa 100 kHz). **L298N không theo kịp 20 kHz**:
BJT darlington của nó cần PWM khoảng 1-4 kHz, và ngưỡng logic ~2.3 V của nó ở
mức biên với GPIO 3.3 V — L298N không được khuyến nghị cho hệ này. Nếu vẫn phải
dùng, giảm `PWM_FREQUENCY_HZ` xuống 1-4 kHz và chấp nhận tiếng rít PWM.

## Nguồn

```text
Battery motor + ---- motor driver VM
Battery motor - ---- motor driver GND ---- ESP2 GND ---- SX1262 GND
ESP2 regulated rail ---------------------- ESP2 + SX1262 logic supply
```

Thêm tụ bulk gần driver theo datasheet và tụ decoupling gần radio. Dòng khởi động
motor không được làm sụt nguồn ESP2/SX1262. Kiểm tra polarity trước khi cắm USB.

## RF switch và oscillator

`HAS_RF_SWITCH` trong `BoardPins.h` của từng board quyết định firmware có gọi
`setRfSwitchPins(RXEN, TXEN)` hay không:

- `HAS_RF_SWITCH = false`: module tự quản lý antenna switch bằng DIO2 theo
  RadioLib, không cần dây thêm (mặc định của ESP2).
- `HAS_RF_SWITCH = true`: module có RXEN/TXEN rời, firmware điều khiển hai chân
  đã khai báo (mặc định của ESP1: GPIO 6/7).

TCXO 1.6 V trên DIO3 là giả định mặc định; module XTAL đặt
`TCXO_VOLTAGE = 0.0F`. Không đoán hai thông số này từ ảnh module — phải theo
schematic thật.

## Battery telemetry và bảo vệ pin

Battery sense cho telemetry tắt mặc định (`BATTERY_ADC_PIN = -1` trong
`firmware/receiver/BoardPins.h`; dòng `TELEMETRY:` báo `batteryMv = 0`, UI hiển
thị "không đo"). Để bật:

1. Không nối battery trực tiếp vào ADC. Đi qua cầu chia áp xuống dưới 3.3 V
   (kèm bảo vệ) vào một chân ADC1 của ESP32-S3 (GPIO 1..10).
2. Đặt `BATTERY_ADC_PIN` bằng chân đó.
3. Đặt `BATTERY_DIVIDER_RATIO = (R_tren + R_duoi) / R_duoi` (mặc định 2.0 cho
   cầu chia 1:1).

Firmware dùng `analogReadMilliVolts()` nên không cần hiệu chuẩn attenuation thủ
công; giá trị gửi đi theo đơn vị 50 mV (0..12.75 V, giá trị cao hơn bị clamp —
đủ cho pack 2S/3S).

Bật battery sense cũng bật luôn lớp bảo vệ dưới áp trong
`firmware/common/ConfigDefaults.h`:

| Hằng số | Mặc định | Ý nghĩa |
| --- | ---: | --- |
| `BATTERY_WARN_MV` | 6800 | dưới mức này: flag `BATTERY_LOW`, UI cảnh báo vàng, xe **vẫn chạy** |
| `BATTERY_CRITICAL_MV` | 6200 | dưới mức này đủ lâu: ESP2 khóa motor, flag `BATTERY_CRITICAL` |
| `BATTERY_SAMPLE_INTERVAL_MS` | 250 | chu kỳ đọc ADC |
| `BATTERY_CRITICAL_SAMPLES` | 8 | số mẫu liên tiếp dưới ngưỡng critical (= 2 giây) |

Mặc định hợp với pack 2S li-ion (8.4 V đầy, 6.0 V cạn). **Phải đổi hai ngưỡng
trước khi bật divider nếu dùng số cell hoặc hóa học khác.**

Hai điểm quan trọng khi chọn ngưỡng:

- Điện áp pack **sụt dưới tải motor**. Cả hai ngưỡng phải nằm dưới điện áp có
  tải của một pack còn khỏe, không phải điện áp hở tải. Yêu cầu 8 mẫu liên tiếp
  (2 giây) là để một cú sụt do dòng stall không tự khóa xe.
- Khóa critical **giữ tới khi tắt nguồn**: một pack hồi điện áp sau khi motor
  dừng vẫn là pack cạn, cho chạy tiếp chỉ làm cell tụt sâu hơn. Sạc lại và
  power-cycle ESP2 để gỡ.
