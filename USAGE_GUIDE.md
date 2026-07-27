# Hướng dẫn sử dụng GestureDrive

## 1. Chuẩn bị an toàn

- Laptop có Chrome hoặc Edge desktop và Node.js 20+.
- Hai ESP32-S3, hai SX1262 và antenna đúng dải tần.
- Driver hai motor loại hai direction + một PWM mỗi motor, ví dụ TB6612FNG hoặc
  L298N được đấu theo bảng trong `docs/HARDWARE_WIRING.md`.
- Nguồn motor riêng đúng điện áp, mass nguồn motor và ESP2 nối chung.
- Một công tắc ngắt nguồn motor vật lý trong tầm tay.

Không phát radio khi chưa gắn antenna. Không đặt xe xuống sàn trong lần test đầu.
Pin trong source là ví dụ và phải được xác nhận theo board thật.

## 2. Xác nhận config

Kiểm tra trước khi compile:

- ESP1: `firmware/transmitter/BoardPins.h`.
- ESP2: `firmware/receiver/BoardPins.h`.
- Radio: `firmware/common/RadioConfig.h`.
- Motor, mixer, ramp và timeout: `firmware/common/ConfigDefaults.h`.

Hai radio phải có cùng frequency, bandwidth, SF, coding rate, sync word và
preamble. `TCXO_VOLTAGE` phải đúng loại module.

## 3. Tìm cổng serial

- macOS: `ls /dev/cu.*`
- Linux: `ls /dev/ttyUSB* /dev/ttyACM*`
- Windows: mở Device Manager, mục Ports (COM & LPT).

Rút rồi cắm lại board để xác định cổng vừa xuất hiện. Dùng cáp USB có dữ liệu,
không dùng cáp chỉ sạc.

### Cài RadioLib

`pio run` sẽ tự tải đúng RadioLib 7.7.1 từ `platformio.ini`. Với Arduino IDE 2,
mở Library Manager, tìm **RadioLib by Jan Gromes** và cài 7.7.1; trong Boards
Manager cài **esp32 by Espressif Systems** 2.0.17. Firmware trong repo được
compile xác nhận bằng PlatformIO, vì vậy đây là workflow khuyến nghị.

## 4. Compile và nạp ESP2 trước

Để nguồn motor đang tắt và bánh được kê khỏi mặt bàn:

```bash
pio run -e esp2_receiver
pio run -e esp2_receiver -t upload --upload-port <ESP2_PORT>
pio device monitor --port <ESP2_PORT> --baud 115200
```

Sau boot phải thấy `FAILSAFE:1`. Motor phải không quay và STANDBY phải ở mức
disable. Nếu radio không khởi tạo, monitor báo `RADIO_ERROR:<code>`; không tiếp
tục thử motor cho đến khi sửa wiring/config.

## 5. Compile và nạp ESP1

Gắn antenna cho cả hai radio:

```bash
pio run -e esp1_transmitter
pio run -e esp1_transmitter -t upload --upload-port <ESP1_PORT>
pio device monitor --port <ESP1_PORT> --baud 115200
```

ESP1 boot ở `HOST_TIMEOUT:1` và `LINK:NONE`. Khi nhận GD2 hợp lệ từ app, host
timeout về 0. Sau khi SX1262 hoàn tất transmit, trạng thái chuyển `LINK:LORA`.

## 6. Chạy frontend

```bash
npm install
npm run dev
```

`npm run dev` tự chạy `npm run vendor:mediapipe` để copy WASM và tải model AI
vào `public/mediapipe/`, giúp AUTO chạy offline. Script bỏ qua êm khi không có
mạng; khi đó worker dùng CDN.

1. Mở URL Vite bằng Chrome hoặc Edge.
2. Bấm **Kết nối ESP1** và chọn đúng cổng.
3. Kiểm tra `Serial = CONNECTED`, `LoRa = LORA`, `Host timeout = CLEAR`.
4. Khi ESP2 có nguồn, panel telemetry bắt đầu cập nhật ~2 Hz với các trường:
   sequence, RSSI (dBm), SNR (dB), packet loss (%), failsafe, battery (mV,
   trống khi chưa cấu hình ADC), output hai motor và trạng thái E-stop trên
   xe. Telemetry ngừng tới sẽ bị đánh dấu **cũ** thay vì hiển thị như còn sống.
5. Chuyển sang `CAL` cho buổi hiệu chỉnh đầu tiên.

Khi serial đang kết nối, app giữ **wake lock** để màn hình không tự tắt giữa
buổi chạy (và tự xin lại khi tab hiện trở lại). Nếu trình duyệt từ chối wake
lock, các watchdog vẫn bảo vệ như thường.

## 7. CALIBRATION

- Safety limit mặc định 60%, tương ứng packet tối đa `600`.
- Hai slider đặt giá trị yêu cầu từ -100% đến +100%; giá trị packet bị giới hạn
  theo safety limit.
- Slider không tự chạy motor. Giữ **Giữ để áp dụng hai slider** mới gửi
  `DIRECT_PWM`; thả, pointer cancel hoặc rời nút sẽ STOP.
- Tám nút thử nhanh cũng chỉ chạy khi giữ.
- Timed pulse chạy hai giá trị slider trong 250, 500, 1000 hoặc 2000 ms rồi
  tự STOP.
- W/S chạy hai bánh tiến/lùi; A/D pivot trái/phải.

Space luôn STOP. Escape luôn gửi E-stop, bất kể mode.

## 8. MANUAL

MANUAL gửi `DRIVE`, vì vậy ESP2 thực hiện mixer:

```text
leftRaw  = throttle - K_TURN * steering
rightRaw = throttle + K_TURN * steering
```

Nút hướng và W/A/S/D là dead-man. Nhấn giữ mới chạy. Khi giữ nhiều phím cùng
lúc (cả MANUAL lẫn CALIBRATION), **phím nhấn gần nhất thắng**; nhả phím đang
chạy thì phím gần nhất còn giữ tiếp quản, nhả hết mọi phím mới STOP. Phím kèm
Ctrl/Cmd/Alt bị bỏ qua để shortcut trình duyệt không khởi động xe. Slider chung
chỉ thay `speedLimit`.

## 9. AUTO

### Xác nhận role

1. Bật camera.
2. Đặt mỗi tay một bên khung hình: **xòe** tay điều hướng, **nắm** tay tốc độ
   (ngón cái không tính; bốn ngón dài quyết định xòe/nắm).
3. Giữ ổn định **sáu frame** để xác nhận role. Vị trí lòng bàn tay lúc xác
   nhận trở thành tâm joystick (anchor).
4. Rút cả hai tay khỏi khung hình 0.8 giây sẽ xóa role để gán lại.

Sau khi xác nhận, **vai trò bám theo đúng bàn tay chứ không theo nửa màn
hình**: hai tay có thể đổi bên mà điều hướng/tốc độ không đảo. Nếu một tay ra
khỏi khung, xe dừng và vai trò được giữ thêm 0.8 giây — đưa tay đó trở lại
đúng bên là chạy tiếp, không phải làm lại xòe/nắm.

### Tay điều hướng: joystick analog

Điều khiển là **analog liên tục**, không còn tám nấc:

- Overlay vẽ hai vòng quanh anchor: vòng trong (nét đứt đậm) là **dead zone**
  — trong vòng này xe dừng; vòng ngoài mờ là mức **full deflection**.
- Đưa lòng bàn tay ra khỏi vòng trong để chạy; lệch càng xa, throttle/steering
  càng lớn, đạt tối đa ở vòng ngoài. Gần tâm có expo để tinh chỉnh dễ hơn.
- Màn hình lên = tiến, xuống = lùi, trái/phải = rẽ; có thể kết hợp chéo tự do.
- **Tiến** yêu cầu lòng bàn tay hướng camera; **lùi** yêu cầu mu bàn tay. Vi
  phạm sẽ STOP ngay kèm gợi ý trên màn hình.
- Nghỉ tay trong dead zone thì anchor tự re-center chậm theo tay, nên tư thế
  trôi từ từ không tạo lệnh ma.
- Gate lòng/mu bàn tay dùng **pháp tuyến lòng bàn tay**, nên vẫn đúng khi bạn
  xoay cổ tay (ngón chỉ ngang hoặc chúc xuống).
- Nhãn tám hướng (`F`, `FL`, ...) vẫn hiển thị trên UI nhưng chỉ để đọc;
  lệnh gửi đi là kênh analog.

### Tay tốc độ: kéo-thả tương đối

- Chụm ngón cái + ngón trỏ để **nắm** thanh tốc độ (ít nhất hai trong ba ngón
  giữa/áp út/út phải mở để pose hợp lệ).
- Kéo dọc để chỉnh: giá trị thay đổi **tương đối so với điểm nắm** (một
  hand-span dọc = 500 đơn vị), không nhảy theo độ cao tuyệt đối của tay.
- Thả chụm để khóa giá trị.
- **Đặt xong thì có thể hạ tay tốc độ xuống.** Mức LIMIT đã chọn được giữ
  nguyên và xe tiếp tục chạy bằng **một tay điều hướng**. Pose sai cũng chỉ
  giữ mức, không dừng xe.
- Đưa tay tốc độ trở lại là chỉnh tiếp được ngay; lần chụm mới luôn tính từ vị
  trí tay lúc đó, không nhảy theo điểm chụm cũ.
- Chip LIMIT hiển thị "Giữ mức (không thấy tay)" khi tay tốc độ ra khỏi khung.

> **Lưu ý an toàn:** từ bản này, **tay điều hướng là dead-man duy nhất**. Mất
> tay điều hướng (hoặc `bám tay` tụt dưới 50%) mới là điều kiện dừng xe; không
> còn bắt buộc luôn thấy đủ hai tay. Sau mỗi lần xác nhận role, LIMIT khởi tạo
> về 0 nên xe không thể chạy trước khi bạn chủ động kéo tốc độ.

### Chất lượng bám tay

Chip cử chỉ ở góc dưới khung hình hiển thị `bám tay NN%` — độ tin cậy của bàn
tay **kém hơn** trong hai tay. Bộ khung xương trên overlay cũng đổi màu theo:
xanh (tốt), vàng (đang yếu dần), đỏ (xe đang bị dừng vì lý do bám tay).

Chỉ số này tụt khi tay ra rìa khung hình, bị che một phần, quá xa camera, hoặc
khi model không phân biệt được tay trái/phải. Dưới 50% là xe dừng. Nếu hệ thống
phát hiện landmark "nhảy" bất thường (thường do một bàn tay khác hoặc khuôn mặt
lọt vào khung), nó từ chối đi theo và hiện banner "Đang bắt lại bàn tay" cho
tới khi xác định lại được vị trí thật.

Khắc phục: đưa tay vào giữa khung hình, tăng ánh sáng, tránh nền có tay/mặt
người khác, và giữ khoảng cách camera sao cho bàn tay chiếm đủ lớn trong hình.

### Tự dừng trong AUTO

- Thiếu **tay điều hướng** sẽ STOP (thiếu tay tốc độ thì không).
- Chỉ số `bám tay` của tay điều hướng dưới 50%: STOP (vai trò vẫn giữ).
- Đang bắt lại tay điều hướng sau một cú nhảy landmark: STOP kèm banner.
- AI worker im lặng quá 350 ms: banner "AI không phản hồi" và STOP.
- Camera ngừng cấp frame quá 250 ms: STOP và yêu cầu setup lại role.

## 10. E-stop và reset

E-stop được latch ở browser và ESP2. Không đổi mode hoặc khôi phục serial nào tự
clear được nó.

1. Nhấn Escape hoặc nút đỏ E-STOP.
2. Xử lý nguyên nhân, kê bánh và bảo đảm khu vực an toàn.
3. Kết nối lại ESP1 nếu cần.
4. Bấm **Arm / Reset**.
5. App gửi ít nhất ba STOP disarmed, sau đó giữ packet reset nhiều chu kỳ radio.
6. ESP2 chỉ clear latch khi đã thấy đúng trình tự; output vẫn bằng 0 sau reset.
7. Khi telemetry còn tươi, app chờ xe xác nhận `estop = 0` qua telemetry mới
   coi reset thành công; xe vẫn báo latch thì reset bị hủy kèm cảnh báo. Không
   có telemetry, app reset phía trạm và ghi chú "chưa có xác nhận từ xe".
8. Phải thực hiện một dead-man action mới để xe chạy lại.

Latch trên ESP2 sống qua brownout/soft reset (RTC RAM); chỉ tắt nguồn hẳn rồi
bật lại (power-on thật) mới xóa mà không cần chuỗi reset. Ngược lại, nếu
telemetry báo xe đang latch trong khi UI tưởng đã clear, app tự re-latch.

## 11. Tự dừng theo lifecycle

App cố gửi STOP khi window blur, tab ẩn, pagehide, đổi mode hoặc mất serial.
Heartbeat 20 Hz chạy bằng timer trong dedicated worker nên tab ẩn không làm
browser throttle nhịp gửi; watchdog AI-result 350 ms dừng xe khi worker AI im
lặng. ESP1 tự chuyển latest command thành STOP nếu không có dòng host hợp lệ
trong 225 ms. ESP2 đưa PWM về 0 (short-brake) nếu không có packet radio mới hợp
lệ trong 225 ms và hạ STANDBY (coast) sau 1000 ms.

Xem bài test bắt buộc tại `docs/SAFETY_TESTS.md` trước khi đặt bánh xuống sàn.

## 12. Xử lý sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Không có Web Serial | Dùng Chrome/Edge desktop và HTTPS hoặc localhost |
| Không thấy ESP1 | Cáp dữ liệu, driver USB, đúng cổng, đóng Serial Monitor |
| `HOST_ERROR:CRC` | App và ESP1 không cùng protocol GD2 hoặc line bị hỏng |
| `HOST_ERROR:SEQUENCE` | Dòng cũ/trùng; sau 3 lần liên tiếp ESP1 tự bỏ khóa (`SEQUENCE_RESYNC`), không cần reset |
| Không có telemetry | ESP2 chưa có nguồn, radio một chiều hỏng, hoặc antenna; kiểm tra `RADIO_ERROR` hai phía |
| `RADIO_ERROR` khi begin | NSS/DIO1/RESET/BUSY/SPI, TCXO và nguồn 3.3 V |
| ESP1 `LINK:LORA`, xe không chạy | ESP2, config radio hai phía, antenna và wiring motor |
| Xe chạy ngược | Sửa `LEFT_INVERTED`/`RIGHT_INVERTED`, không đổi dây khi có nguồn |
| Driver không thức | Kiểm tra STANDBY hoặc đặt `HAS_STANDBY=false` nếu không có pin này |
| Motor rung nhưng không quay | Đo PWM minimum theo `docs/CALIBRATION.md` |
| `bám tay` luôn thấp | Ánh sáng, tay quá xa/ra rìa khung, hoặc có tay/mặt người khác trong nền |
| Banner "Đang bắt lại bàn tay" lặp lại | Có vật thể giống bàn tay trong nền; đổi góc camera hoặc phông nền |
| Delegate tự chuyển sang CPU | GPU của máy chạy MediaPipe chậm bất thường; đây là fallback có chủ đích, FPS sẽ thấp hơn |
| Banner "PIN CẠN" | Pack dưới ngưỡng critical; sạc lại và power-cycle ESP2 (khóa không tự gỡ) |
| `RSSI xe` và `RSSI trạm` lệch nhiều | Liên kết bất đối xứng: kiểm tra antenna/TX power của đầu yếu hơn |
