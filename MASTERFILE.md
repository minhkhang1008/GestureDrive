# GESTUREDRIVE - MASTERFILE

Tài liệu chốt duy nhất cho dự án. Mọi thông số trong đây **đã được quyết sẵn**:
làm đúng theo thứ tự, không cần tự tính lại. Nếu tài liệu khác trong repo mâu
thuẫn với file này, lấy file này làm chuẩn.

Thời gian cần: khoảng **4 giờ** nếu phần cứng đã có (2 giờ lắp + nạp, 1 giờ hiệu
chỉnh, 1 giờ chạy thử).

---

## MỤC LỤC

1. [Hệ thống làm gì](#1-hệ-thống-làm-gì)
2. [Danh sách linh kiện](#2-danh-sách-linh-kiện)
3. [Bảng cấu hình đã chốt](#3-bảng-cấu-hình-đã-chốt)
4. [Đấu dây](#4-đấu-dây)
5. [Nạp firmware](#5-nạp-firmware)
6. [Chạy app trên laptop](#6-chạy-app-trên-laptop)
7. [Hiệu chỉnh motor (bắt buộc)](#7-hiệu-chỉnh-motor-bắt-buộc)
8. [Cách điều khiển bằng tay](#8-cách-điều-khiển-bằng-tay)
9. [Quy trình ngày báo cáo](#9-quy-trình-ngày-báo-cáo)
10. [Xử lý sự cố](#10-xử-lý-sự-cố)
11. [Nội dung thuyết trình](#11-nội-dung-thuyết-trình)

---

## 1. HỆ THỐNG LÀM GÌ

Camera laptop đọc cử chỉ bàn tay bằng AI, biến vị trí bàn tay thành lệnh lái
analog, gửi xuống micromouse qua sóng LoRa.

```
[Bàn tay]
    |
    v
[Camera laptop] -> [MediaPipe Hand Landmarker chạy trong Web Worker]
    |                    (21 điểm mốc bàn tay, ~30 FPS)
    v
[App web: bàn tay -> joystick ảo -> throttle + steering]
    |
    | USB Serial 115200, dòng ASCII "GD2,...", CRC-16
    v
[ESP1 "bộ phát" cắm laptop] -- LoRa SX1262 920.5 MHz --> [ESP2 trên xe]
                                  (2 chiều: có telemetry về)      |
                                                                  v
                                                        [Driver + 2 motor]
```

**Điểm quan trọng:** LoRa là sóng giữa hai module SX1262 với nhau, laptop không
tự phát được. Nên **bắt buộc có 2 con ESP32**: một con cắm laptop làm bộ phát,
một con nằm trên xe.

**Bốn lớp an toàn** (nói ra khi báo cáo, đây là điểm cộng):

| Lớp | Cơ chế | Thời gian |
| --- | --- | ---: |
| 1 | Hạ tay khỏi khung hình -> app gửi STOP | ~180 ms |
| 2 | App treo/mất camera -> watchdog gửi STOP | 350 ms |
| 3 | ESP1 mất lệnh từ laptop -> ngừng phát | 225 ms |
| 4 | ESP2 mất sóng LoRa -> tự khóa motor | 225 ms |

Cộng thêm: nút E-STOP (phím `Esc`), phím `Space` dừng ngay, và latch E-stop giữ
qua cả reset mềm của ESP2.

---

## 2. DANH SÁCH LINH KIỆN

| # | Món | Số lượng | Ghi chú |
| --- | --- | ---: | --- |
| 1 | ESP32-S3 DevKitC-1 | 2 | một cho bộ phát, một cho xe |
| 2 | Module LoRa SX1262 | 2 | phải là SX1262, không phải SX1276 |
| 3 | Anten 915/920 MHz | 2 | **bắt buộc cắm trước khi cấp nguồn** |
| 4 | Driver motor TB6612FNG | 1 | xem cảnh báo L298N bên dưới |
| 5 | Motor DC + bánh (khung micromouse) | 1 bộ | đã có sẵn |
| 6 | Pin 2S li-ion (7.4 V) + hộp | 1 | cho motor |
| 7 | Công tắc cắt nguồn motor | 1 | **bắt buộc**, để trong tầm tay khi test |
| 8 | Cáp USB-C data | 1 | loại có dây dữ liệu, không phải cáp chỉ sạc |
| 9 | Dây jumper cái-cái | ~20 | |
| 10 | Tụ 470 µF/16 V | 1 | gắn sát chân nguồn driver |

**Về driver:** dùng **TB6612FNG**. L298N không được khuyến nghị: nó là BJT
darlington, không theo kịp PWM 20 kHz, sụt áp ~2 V và ngưỡng logic ~2.3 V nằm ở
biên với GPIO 3.3 V của ESP32-S3. Nếu buộc phải dùng L298N, xem mục 3.4.

---

## 3. BẢNG CẤU HÌNH ĐÃ CHỐT

Đây là các giá trị **tôi đã quyết**. Mở đúng file, sửa đúng dòng, không cần cân
nhắc thêm.

### 3.1. Sóng LoRa - `firmware/common/RadioConfig.h`

| Hằng số | Giá trị chốt | Lý do |
| --- | ---: | --- |
| `FREQUENCY_MHZ` | `920.5F` | nằm trong băng 920-925 MHz dùng chung ở VN |
| `BANDWIDTH_KHZ` | `250.0F` | băng rộng -> airtime ngắn -> độ trễ thấp |
| `SPREADING_FACTOR` | `7` | SF thấp nhất, airtime 25.7 ms, vừa chu kỳ 50 ms |
| `CODING_RATE_DENOMINATOR` | `5` | 4/5, ít dư thừa nhất |
| `SYNC_WORD` | `0x12` | mạng riêng, không đụng LoRaWAN |
| `TX_POWER_DBM` | **`14`** | đổi từ 5 lên 14 (25 mW). Xem ghi chú bên dưới |
| `PREAMBLE_SYMBOLS` | `8` | |
| `TCXO_VOLTAGE` | `1.6F` | **nếu module dùng XTAL thì đổi thành `0.0F`** |

**Chỉ cần sửa 1 dòng:**

```cpp
constexpr int8_t TX_POWER_DBM = 14;   // 25 mW, đủ cho sân trường
```

> **Nói thật về tầm xa.** Cấu hình SF7/BW250 này ưu tiên **độ trễ thấp** (25.7 ms
> airtime, lệnh mượt như tay cầm RC). Với 14 dBm và anten que thường, tầm thực tế
> **khoảng 150-400 m khi thoáng tầm nhìn** - thừa sức cho sân trường và phòng
> demo. Con số "1 km" của LoRa chỉ đạt được khi dùng SF cao (SF9-SF12), mà SF9
> đã đẩy airtime lên ~165 ms, tức không thể giữ chu kỳ lệnh 50 ms nữa và xe sẽ
> điều khiển giật. **Với dự án điều khiển thời gian thực, chọn độ trễ thấp là
> đúng.** Khi báo cáo cứ nói thẳng đánh đổi này, giám khảo sẽ đánh giá cao hơn là
> hô "1 km".

### 3.2. An toàn và động học - `firmware/common/ConfigDefaults.h`

| Hằng số | Giá trị chốt | Ý nghĩa |
| --- | ---: | --- |
| `K_TURN` | `0.70F` | độ gắt khi bẻ lái |
| `LEFT_GAIN` / `RIGHT_GAIN` | `1.00F` | chỉnh sau khi đo ở mục 7.3 |
| `PWM_MIN_*` (4 giá trị) | **đo ở mục 7.2** | ngưỡng motor bắt đầu quay |
| `MAX_PWM` | `600` | trần 60%, **giữ nguyên cho tới sau buổi báo cáo** |
| `RAMP_UP_PER_SECOND` | `800.0F` | tăng tốc mượt, không giật bánh |
| `RAMP_DOWN_PER_SECOND` | `3000.0F` | giảm tốc nhanh gần 4 lần tăng tốc |
| `BRAKE_ON_STOP` | `true` | phanh chủ động thay vì thả trôi |
| `HOST_TIMEOUT_MS` | `225` | giữ nguyên |
| `RADIO_TIMEOUT_MS` | `225` | giữ nguyên |
| `CONTROL_INTERVAL_MS` | `50` | 20 Hz, giữ nguyên |

**Chốt:** giữ nguyên toàn bộ file này, chỉ điền 4 giá trị `PWM_MIN_*` sau khi đo.

### 3.3. Pin - để tắt

`BATTERY_ADC_PIN = -1` (mặc định). **Không bật** cho buổi báo cáo: cần cầu chia
áp và hiệu chỉnh ngưỡng, rủi ro cao hơn lợi ích. Telemetry sẽ báo "không đo",
đúng như thiết kế. Thay vào đó dùng pin sạc đầy và mang pin dự phòng.

### 3.4. Nếu buộc phải dùng L298N

Sửa `firmware/receiver/BoardPins.h`:

```cpp
constexpr uint32_t PWM_FREQUENCY_HZ = 2000;   // 20000 -> 2000
constexpr bool HAS_STANDBY = false;           // L298N không có chân STBY
```

Và tháo 2 jumper `ENA`/`ENB` trên board L298N. Chấp nhận tiếng rít PWM.

### 3.5. App

| Thiết lập | Giá trị chốt | Ở đâu |
| --- | ---: | --- |
| Chế độ | `AUTO` | nút trên thanh trên |
| LIMIT (AUTO) | `600` | thanh trượt dưới khung camera |
| LIMIT khi demo gần người xem | `350` | hạ xuống trước khi có khán giả đứng gần |
| Trình duyệt | Chrome hoặc Edge | Web Serial không chạy trên Firefox/Safari |

---

## 4. ĐẤU DÂY

> **Ba quy tắc không được phá:**
> 1. **Cắm anten vào SX1262 trước khi cấp nguồn.** Phát không anten sẽ hỏng chip.
> 2. **Không lấy nguồn motor từ chân 3.3 V/5 V của ESP32.** Pin motor đi thẳng
>    vào driver.
> 3. **Nối chung mass** giữa pin motor, driver, ESP2 và SX1262. Thiếu mass chung
>    là nguyên nhân số một của lỗi "chạy được 5 giây rồi treo".

### 4.1. ESP1 (bộ phát, cắm laptop) tới SX1262

| SX1262 | ESP1 GPIO | |
| --- | ---: | --- |
| SCK | 12 | SPI clock |
| MISO | 13 | |
| MOSI | 11 | |
| NSS / CS | 10 | |
| DIO1 | 8 | ngắt báo phát/nhận xong |
| RESET | 9 | |
| BUSY | 14 | bắt buộc với SX1262 |
| RXEN | 6 | chỉ khi module có chân RF switch rời |
| TXEN | 7 | chỉ khi module có chân RF switch rời |
| GND | GND | |
| VCC | 3.3 V | theo carrier của module |

**Module của bạn có chân RXEN/TXEN không?**

- **Có** (nhìn thấy 2 chân ghi RXEN/TXEN): giữ nguyên
  `firmware/transmitter/BoardPins.h` (`HAS_RF_SWITCH = true`).
- **Không có** (đa số module tự chuyển anten bằng DIO2): sửa thành

  ```cpp
  constexpr bool HAS_RF_SWITCH = false;
  ```

  và bỏ 2 dây GPIO 6, 7.

ESP1 **không có dây motor nào**. Chỉ LoRa + cáp USB về laptop.

### 4.2. ESP2 (trên xe) tới SX1262

Y hệt bảng trên, **trừ RXEN/TXEN**: `firmware/receiver/BoardPins.h` mặc định
`HAS_RF_SWITCH = false`. Nếu module ESP2 có chân rời thì đặt `true` và điền chân
giống ESP1.

Hai đầu **phải cùng cấu hình sóng**, nếu không sẽ không thấy nhau.

### 4.3. ESP2 tới driver motor

| Chức năng | ESP2 GPIO | TB6612FNG | L298N |
| --- | ---: | --- | --- |
| Left IN1 | 4 | AIN1 | IN1 |
| Left IN2 | 5 | AIN2 | IN2 |
| Left PWM | 6 | PWMA | ENA (tháo jumper) |
| Right IN1 | 15 | BIN1 | IN3 |
| Right IN2 | 16 | BIN2 | IN4 |
| Right PWM | 17 | PWMB | ENB (tháo jumper) |
| STANDBY | 18 | STBY | không có |

### 4.4. Nguồn

```
Pin 2S (+) ---[CÔNG TẮC CẮT]--- Driver VM (nguồn motor)
Pin 2S (-) --------------------- Driver GND ---+
                                               |
                                    ESP2 GND ---+--- SX1262 GND   (mass chung)

ESP2 3.3V --------------------- SX1262 VCC
Driver VCC/logic -------------- ESP2 3.3V hoặc 5V (theo datasheet driver)
```

Gắn tụ 470 µF sát chân VM/GND của driver. Kiểm tra chiều cực **trước** khi cắm
USB.

### 4.5. Kiểm tra trước khi cấp nguồn lần đầu

- [ ] Anten đã cắm vào cả 2 module SX1262
- [ ] Đo thông mạch: không chập VCC-GND ở cả 2 board
- [ ] Mass chung đã nối (pin, driver, ESP2, SX1262)
- [ ] Công tắc cắt nguồn motor đang ở vị trí TẮT
- [ ] Bánh xe **kê lên cao, không chạm mặt bàn**

---

## 5. NẠP FIRMWARE

Cần PlatformIO (cài extension "PlatformIO IDE" trong VS Code, hoặc
`pip install platformio`).

### 5.1. Chạy test trên máy trước (30 giây, nên làm)

```bash
pio test -e native
```

Test này kiểm tra phần toán lái và đóng gói packet ngay trên laptop, không cần
phần cứng. Xanh hết mới nạp.

### 5.2. Nạp ESP2 (con trên xe) TRƯỚC

Cắm **một mình ESP2** vào laptop:

```bash
pio run -e esp2_receiver -t upload
```

Mở serial monitor để xem nó khởi động sạch:

```bash
pio device monitor -e esp2_receiver
```

### 5.3. Nạp ESP1 (bộ phát)

Rút ESP2, cắm **một mình ESP1**:

```bash
pio run -e esp1_transmitter -t upload
```

> **Vì sao cắm từng con một:** cắm cả hai cùng lúc, PlatformIO sẽ chọn nhầm cổng
> và bạn nạp firmware thu vào con phát. Nếu buộc phải cắm cả hai, thêm
> `--upload-port /dev/tty.usbmodemXXXX` (macOS) hoặc `--upload-port COM5`
> (Windows). Xem danh sách cổng bằng `pio device list`.

### 5.4. Xác nhận sóng đã thông

Cắm cả 2 con, mở 2 cửa sổ monitor. Trên ESP1 phải thấy dòng:

```
LINK:LORA
```

Nếu thấy `LINK:NONE` thì sóng chưa thông, nhảy xuống mục 10.

**Không cần khai báo địa chỉ MAC.** Hệ này dùng LoRa P2P với sync word riêng,
hai con tự thấy nhau nếu cùng tần số và cùng cấu hình.

---

## 6. CHẠY APP TRÊN LAPTOP

```bash
npm install
npm run dev
```

Mở `http://localhost:5173` bằng **Chrome hoặc Edge**.

Thứ tự thao tác:

1. Cắm **ESP1** vào laptop bằng cáp USB data.
2. Bấm **Kết nối ESP1** ở góc trên phải, chọn cổng (tên chứa `usbmodem`,
   `CP210x` hoặc `CH340`).
3. Dải trạng thái dưới thanh trên chuyển `Serial: CONNECTED`, `LoRa: LORA`.
4. Bấm **Bật camera**, cho phép quyền camera.
5. Giơ **một bàn tay** vào khung hình.

Bản build cho ngày báo cáo (chạy nhanh hơn, không cần terminal dev):

```bash
npm run build
npm run preview
```

---

## 7. HIỆU CHỈNH MOTOR (BẮT BUỘC)

**Không bỏ qua mục này.** Bốn giá trị `PWM_MIN_*` đang bằng 0, nghĩa là firmware
chưa biết motor của bạn cần bao nhiêu điện mới quay. Chưa đo thì xe sẽ ì ở lệnh
nhỏ rồi giật mạnh ở lệnh lớn.

**Điều kiện:** bánh kê lên cao không chạm bàn, tay đặt trên công tắc cắt nguồn.

Chuyển app sang chế độ **CAL** (nút trên thanh trên).

### 7.1. Xác nhận chiều quay (10 phút)

1. Đặt "Giới hạn an toàn" = **15%**.
2. Bấm giữ **Chỉ motor trái tiến**. Bánh trái phải quay **theo chiều xe tiến**.
3. Làm tiếp với: trái lùi, phải tiến, phải lùi.
4. Bánh nào quay ngược quy ước, sửa trong `firmware/receiver/BoardPins.h`:

   ```cpp
   constexpr bool LEFT_INVERTED  = true;   // nếu bánh trái ngược
   constexpr bool RIGHT_INVERTED = true;   // nếu bánh phải ngược
   ```

5. Nạp lại ESP2, thử lại cho tới khi cả 4 chiều đúng.

**Tuyệt đối không đảo dây motor khi driver còn nguồn.**

### 7.2. Đo ngưỡng khởi động PWM (20 phút, quan trọng nhất)

Với **từng motor** và **từng chiều** (4 lần đo):

1. Đặt slider motor còn lại = 0.
2. Dùng **timed pulse 250 ms**, bắt đầu ở 10%.
3. Tăng dần **từng 2%**, mỗi mức bấm pulse 3 lần.
4. Ghi lại mức đầu tiên mà motor **quay đều cả 3 lần** (rung nhẹ không tính).
5. Cộng thêm **2%** làm biên an toàn, rồi nhân 10 để ra giá trị normalized.

Ví dụ: motor trái tiến quay ổn định từ 26% -> lấy 28% -> nhập `280`.

Điền vào `firmware/common/ConfigDefaults.h`:

```cpp
constexpr int16_t PWM_MIN_LEFT_FWD  = ___;   // đo được ___%
constexpr int16_t PWM_MIN_RIGHT_FWD = ___;   // đo được ___%
constexpr int16_t PWM_MIN_LEFT_REV  = ___;   // đo được ___%
constexpr int16_t PWM_MIN_RIGHT_REV = ___;   // đo được ___%
```

Với motor TT vàng phổ thông chạy pin 2S, kết quả thường rơi vào **200-350**. Nếu
bạn đo ra dưới 100 hoặc trên 500 thì nhiều khả năng đo sai, đo lại.

Nạp lại ESP2 sau khi điền.

### 7.3. Cân bằng hai bánh (10 phút)

1. Bấm giữ **Hai motor tiến** ở 30%.
2. Nhìn hai bánh: bánh nào quay chậm hơn rõ rệt?
3. Tăng gain của bánh chậm, **bước 0.05 mỗi lần**:

   ```cpp
   constexpr float LEFT_GAIN  = 1.00F;
   constexpr float RIGHT_GAIN = 1.05F;   // ví dụ: bánh phải chậm hơn
   ```

4. Lặp tới khi hai bánh nhìn bằng nhau. **Không vượt quá 1.20** - lệch hơn thế
   là vấn đề cơ khí (bánh kẹt, hộp số khô), phải sửa cơ khí chứ không bù bằng
   phần mềm.

### 7.4. Thử trên mặt đất và đo quãng đường dừng (15 phút)

1. Hạ xe xuống sàn, khu vực trống ít nhất 3 x 3 m.
2. Một bạn cầm công tắc cắt nguồn, đứng cạnh xe.
3. Chuyển app sang **MANUAL**, LIMIT = **300**.
4. Bấm giữ tiến khoảng 1 giây rồi thả. Đo quãng đường từ lúc thả tới lúc xe đứng
   yên.
5. Lặp với LIMIT = 600.
6. **Ghi lại số này** - đây là con số bạn phải nói được khi giám khảo hỏi
   "xe dừng trong bao lâu".

Bảng điền:

| LIMIT | Quãng đường dừng | Thời gian |
| ---: | --- | --- |
| 300 | ____ cm | ____ s |
| 600 | ____ cm | ____ s |

Nếu ở LIMIT 600 xe trôi quá 50 cm, hạ `MAX_PWM` xuống `500` và đo lại.

---

## 8. CÁCH ĐIỀU KHIỂN BẰNG TAY

Chế độ **AUTO**. Hệ chỉ dùng **một bàn tay** (bản cập nhật mới nhất đã bỏ tay
tốc độ để mô hình AI chạy nhanh gấp đôi).

### Nguyên lý: bàn tay là cần joystick

1. **Xác nhận tâm.** Giơ một bàn tay vào **giữa khung hình** rồi **giữ yên
   khoảng 0,6 giây**. Một vòng tròn vẽ quanh bàn tay sẽ chạy dần; chạy đủ một
   vòng là tâm joystick được chốt đúng tại điểm đó.

   - Nếu tay ở quá sát rìa khung hình, app **không cho chốt** và báo "Đưa tay
     vào giữa khung hình để đặt tâm". Lý do: tâm dính rìa thì không còn đường
     kéo về phía đó, xe sẽ không đi được hướng ấy.
   - Nếu tay quá gần camera, app báo "Lùi ra xa camera một chút". Ngồi cách
     camera 50-80 cm là vừa.
   - Vòng tròn chạy lại từ đầu nếu tay xê dịch nhiều trong lúc giữ. Cứ giữ yên
     thêm một nhịp là xong.

2. **Kéo để chạy.** Di chuyển bàn tay ra khỏi vòng nhỏ:

   | Kéo tay về hướng | Xe làm gì |
   | --- | --- |
   | Lên | Tiến |
   | Xuống | Lùi |
   | Trái | Rẽ trái |
   | Phải | Rẽ phải |
   | Chéo (vd. lên + phải) | Vừa tiến vừa bẻ phải |

3. **Càng xa tâm càng nhanh.** Chạm vòng ngoài là tối đa. Đây là điều khiển
   analog tỉ lệ, không phải 5 nút bấm.
4. **Về giữa là dừng.** Đưa tay về vòng nhỏ, xe dừng.
5. **Hạ tay xuống là dừng khẩn.** Mất bàn tay khỏi khung hình, xe dừng trong
   ~180 ms. Nếu tay vắng quá 0,8 giây, tâm bị huỷ và phải giữ yên xác nhận lại
   từ đầu (đây là chủ ý: tay quay lại ở chỗ khác thì tâm cũ không còn đúng nữa).

### Bảng LIMIT

Thanh trượt dưới khung camera chặn trần công suất:

| Tình huống | LIMIT |
| --- | ---: |
| Tập chạy, sân rộng | 600 |
| Demo có khán giả đứng gần | 350 |
| Thử lần đầu sau khi sửa code | 200 |

### Phím tắt luôn có tác dụng

| Phím | Tác dụng |
| --- | --- |
| `Space` | Dừng ngay |
| `Esc` | E-STOP, khóa cứng, phải bấm Arm/Reset mới chạy lại |

### Mẹo để nhận diện mượt

- Ngồi cách camera **50-80 cm**, bàn tay trong khung hình rõ nét.
- **Ánh sáng chiếu vào mặt bàn tay**, không ngồi ngược sáng cửa sổ.
- Nền phía sau càng đơn giản càng tốt.
- Chỉ giơ **một tay**. Tay còn lại để xuống dưới khung hình.
- Chỉ số `bám tay` ở góc dưới nên **trên 75%**. Thấp hơn là AI đang chật vật,
  chỉnh lại ánh sáng.

---

## 9. QUY TRÌNH NGÀY BÁO CÁO

### Tối hôm trước

- [ ] Sạc đầy pin motor + mang pin dự phòng
- [ ] `npm run build` chạy sạch, không lỗi
- [ ] `pio test -e native` xanh hết
- [ ] Đã nạp firmware mới nhất cho **cả hai** ESP32
- [ ] Chạy thử trọn vẹn một lần ở nhà: kết nối -> camera -> lái -> dừng
- [ ] Chuẩn bị: laptop đã sạc, cáp USB data, công tắc cắt nguồn, tua vít nhỏ,
      dây jumper dự phòng
- [ ] Đã ghi lại số đo quãng đường dừng ở mục 7.4

### Trước khi lên trình bày 15 phút

- [ ] Cắm anten vào cả 2 module (kiểm tra lại bằng mắt)
- [ ] Cắm ESP1 vào laptop, bấm **Kết nối ESP1**, thấy `Serial: CONNECTED`
- [ ] Bật nguồn xe, thấy `LoRa: LORA` và có telemetry (RSSI hiện số)
- [ ] Bật camera, giơ tay, thấy khung xương bàn tay màu xanh
- [ ] **Kê bánh lên, thử tiến/lùi/trái/phải một lượt**
- [ ] Hạ LIMIT xuống **350**
- [ ] Tắt thông báo hệ thống, tắt chế độ ngủ màn hình

### Thứ tự demo (5 phút)

1. **Mở đầu (30 giây):** giơ tay trước camera, chỉ vào khung xương 21 điểm mốc
   AI vẽ ra. "Đây là mô hình AI đang đọc bàn tay ở 30 khung hình mỗi giây."
2. **Xác nhận tâm (20 giây):** giữ yên tay, chỉ vào vòng tròn đang chạy. "Em
   phải giữ yên để chốt tâm joystick, hệ thống không tự đặt tâm bừa. Nếu tay sát
   rìa khung hình nó sẽ từ chối, vì khi đó không còn đường kéo về phía đó."
3. **Giải thích joystick (30 giây):** chỉ vào vòng tròn nét đứt. "Kéo càng xa
   tâm, xe chạy càng nhanh - đây là điều khiển tỉ lệ chứ không phải nút bấm."
4. **Lái thật (2 phút):** tiến, lùi, rẽ trái, rẽ phải, đi một vòng.
5. **Demo an toàn (1 phút):** đang chạy thì **hạ tay xuống** - xe dừng ngay.
   Nói: "mất bàn tay là mất tín hiệu, xe dừng trong 0.18 giây. Đây là cơ chế
   dead-man."
6. **Demo E-STOP (30 giây):** bấm `Esc`, chỉ vào dải đỏ trên màn hình.
7. **Chỉ vào telemetry (30 giây):** RSSI, SNR, tỉ lệ mất gói. "Xe báo ngược về
   trạm chất lượng sóng theo thời gian thực."

### Nếu có sự cố giữa chừng

Đừng sửa code trước mặt giám khảo. Nói: "em chuyển sang chế độ MANUAL để tiếp
tục" rồi bấm nút MANUAL, lái bằng phím W/A/S/D. Chế độ này không cần camera và
không cần AI.

---

## 10. XỬ LÝ SỰ CỐ

| Hiện tượng | Nguyên nhân thường gặp | Cách sửa |
| --- | --- | --- |
| Nút "Kết nối ESP1" không hiện cổng nào | Cáp chỉ sạc, hoặc thiếu driver USB | Đổi cáp có dây dữ liệu; cài driver CP210x/CH340 |
| Trình duyệt báo không hỗ trợ | Đang dùng Firefox/Safari | Chuyển sang Chrome hoặc Edge |
| `LINK:NONE`, không có telemetry | Hai con khác cấu hình sóng, hoặc sai TCXO | Kiểm tra cả hai đã nạp cùng `RadioConfig.h`; nếu module dùng XTAL thì đặt `TCXO_VOLTAGE = 0.0F` |
| Sóng chập chờn, RSSI dưới -110 | Anten chưa cắm chặt, hoặc bị thân người che | Cắm lại anten, giơ bộ phát cao hơn, rút ngắn khoảng cách |
| Xe không chạy dù app báo đã gửi lệnh | E-stop đang khóa, hoặc chưa đo `PWM_MIN_*` | Bấm Arm/Reset; kiểm tra mục 7.2 |
| Xe chạy giật cục | Chưa hiệu chỉnh `PWM_MIN_*` | Làm mục 7.2 |
| Xe đi lệch dù lệnh đi thẳng | Hai bánh chưa cân | Làm mục 7.3 |
| Camera không bật | Đã lỡ bấm "Chặn" quyền camera | Bấm biểu tượng ổ khóa cạnh thanh địa chỉ, cấp lại quyền, tải lại trang |
| AI nhận diện chập chờn, `bám tay` thấp | Ngược sáng, tay quá xa, hoặc giơ 2 tay | Chỉnh ánh sáng, ngồi gần lại 50-80 cm, chỉ giơ 1 tay |
| Xe tự dừng liên tục khi đang lái | Mất sóng hoặc mất khung hình | Xem dải trạng thái: `Failsafe xe` sáng = lỗi sóng; `Host WD` sáng = laptop treo |
| ESP2 khởi động lại khi motor chạy | Sụt áp do thiếu tụ hoặc thiếu mass chung | Gắn tụ 470 µF sát driver, kiểm tra lại mass chung |

### Nút reset E-stop không ăn

Đúng theo thiết kế: ESP2 bắt buộc nhận **3 gói STOP sạch** rồi mới chấp nhận
lệnh reset, và nó chờ telemetry xác nhận. Giữ tay ra khỏi khung hình, bấm
**Arm/Reset**, đợi 2 giây. Nếu vẫn khóa thì sóng đang đứt, xử lý sóng trước.

---

## 11. NỘI DUNG THUYẾT TRÌNH

### Ba điểm mạnh nên nhấn

1. **Điều khiển analog, không phải nút bấm.** Đa số dự án cùng chủ đề nhận diện
   5 cử chỉ rời rạc rồi map ra 5 lệnh. Hệ này biến bàn tay thành **joystick tỉ
   lệ**: hướng kéo quyết định hướng đi, khoảng cách kéo quyết định tốc độ, cho ra
   vô số mức lệnh trung gian.

2. **An toàn nhiều lớp, có số đo.** Bốn watchdog độc lập ở bốn tầng (bảng ở mục
   1). Nói kèm con số: "mất bàn tay, xe dừng trong 180 ms; mất sóng, xe tự khóa
   sau 225 ms; quãng đường dừng đo được là ___ cm ở LIMIT 600."

3. **Liên kết hai chiều.** Xe không chỉ nhận lệnh mà còn báo ngược cường độ sóng,
   tỉ lệ mất gói và trạng thái motor về trạm ở 2 Hz, hiển thị trực tiếp trên app.

### Câu hỏi giám khảo hay hỏi

**"Sao không dùng Bluetooth cho đơn giản?"**
> Bluetooth Classic chỉ khoảng 10 m và phải ghép đôi. LoRa cho tầm vài trăm mét
> ở cấu hình tụi em chọn, không cần ghép đôi, và có sẵn cơ chế báo cường độ sóng
> để giám sát chất lượng liên kết.

**"Vì sao không đạt 1 km như quảng cáo LoRa?"**
> Vì tụi em chọn đánh đổi ngược lại. Cấu hình SF7 băng thông 250 kHz cho thời
> gian truyền một gói chỉ 25.7 ms, đủ để gửi lệnh 20 lần mỗi giây. Muốn 1 km
> phải dùng SF cao, thời gian truyền lên hơn 165 ms, tức chỉ còn khoảng 6 lệnh
> mỗi giây - xe sẽ điều khiển giật và nguy hiểm. Với bài toán điều khiển thời
> gian thực, độ trễ quan trọng hơn tầm xa.

**"AI chạy ở đâu, có cần internet không?"**
> Chạy hoàn toàn trên máy, trong một Web Worker riêng để không làm đứng giao
> diện. Mô hình MediaPipe Hand Landmarker đã được tải sẵn về máy nên không cần
> internet lúc demo.

**"Nếu mất kết nối giữa chừng thì sao?"**
> Cho em demo luôn ạ. (Rút cáp USB của bộ phát) Xe tự khóa motor sau 225 ms vì
> không còn nhận được gói lệnh nào.

**"Độ trễ tổng cộng là bao nhiêu?"**
> Khoảng 30 ms cho AI xử lý một khung hình, cộng 25.7 ms truyền sóng, cộng chu
> kỳ gửi lệnh 50 ms. Tổng từ lúc tay di chuyển tới lúc bánh xe phản ứng khoảng
> 80-110 ms. Con số AI hiện ngay trên góc phải khung camera.

### Từ khóa kỹ thuật nên dùng

Hand landmark detection, điều khiển tỉ lệ (proportional control), vùng chết
(dead zone), bộ lọc One-Euro, dự đoán bù trễ, differential drive mixing, watchdog
nhiều tầng, cơ chế dead-man, CRC-16 kiểm tra toàn vẹn gói, telemetry hai chiều.

---

## PHỤ LỤC: LỆNH HAY DÙNG

```bash
# Test phần toán trên máy, không cần phần cứng
pio test -e native

# Nạp firmware (cắm từng con một)
pio run -e esp2_receiver -t upload      # con trên xe
pio run -e esp1_transmitter -t upload   # con cắm laptop

# Xem log firmware
pio device list
pio device monitor -e esp1_transmitter

# Chạy app
npm install
npm run dev        # lúc phát triển
npm run build && npm run preview   # lúc báo cáo

# Test phần app
npx vitest run
```

## PHỤ LỤC: BẢNG SỐ LIỆU CẦN ĐIỀN

In trang này ra, điền tay trong lúc hiệu chỉnh, mang theo khi báo cáo.

| Thông số | Giá trị đo được |
| --- | --- |
| `PWM_MIN_LEFT_FWD` | |
| `PWM_MIN_RIGHT_FWD` | |
| `PWM_MIN_LEFT_REV` | |
| `PWM_MIN_RIGHT_REV` | |
| `LEFT_GAIN` | |
| `RIGHT_GAIN` | |
| Quãng đường dừng @ LIMIT 300 | |
| Quãng đường dừng @ LIMIT 600 | |
| RSSI ở khoảng cách demo | |
| Tỉ lệ mất gói ở khoảng cách demo | |
| Độ trễ AI hiển thị trên app | |
