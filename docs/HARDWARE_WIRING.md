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
| GND | GND | mass chung |
| VCC | theo carrier | thường 3.3 V, phải xác nhận |

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

## Nguồn

```text
Battery motor + ---- motor driver VM
Battery motor - ---- motor driver GND ---- ESP2 GND ---- SX1262 GND
ESP2 regulated rail ---------------------- ESP2 + SX1262 logic supply
```

Thêm tụ bulk gần driver theo datasheet và tụ decoupling gần radio. Dòng khởi động
motor không được làm sụt nguồn ESP2/SX1262. Kiểm tra polarity trước khi cắm USB.

## RF switch và oscillator

Config hiện giả định carrier SX1262 tự dùng DIO2 cho RF switch theo RadioLib và
TCXO 1.6 V trên DIO3. Carrier có RXEN/TXEN rời cần thêm pin và gọi
`setRfSwitchPins()` theo schematic. Không đoán hai thông số này từ ảnh module.

## Battery telemetry

ADC battery chưa được cấu hình trong P0. Không nối battery trực tiếp vào ADC.
Cần cầu chia áp, bảo vệ và hệ số hiệu chuẩn trước khi bật `batteryMv` telemetry.
