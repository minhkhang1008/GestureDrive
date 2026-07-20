# Hướng dẫn sử dụng GestureDrive

Tài liệu này dành cho cả 3 nhóm: nhóm app (bạn), nhóm AI nhận diện cử chỉ, và
nhóm phần cứng ESP32. Đọc phần tương ứng với việc bạn đang làm.

## Mục lục

1. [Cài đặt và chạy app](#1-cài-đặt-và-chạy-app)
2. [Dùng app không cần phần cứng (chế độ giả lập)](#2-dùng-app-không-cần-phần-cứng-chế-độ-giả-lập)
3. [Kết nối với ESP32](#3-kết-nối-với-esp32)
4. [Nạp firmware mẫu cho ESP32](#4-nạp-firmware-mẫu-cho-esp32)
5. [Dùng app với camera thật](#5-dùng-app-với-camera-thật)
6. [Chế độ AUTO và MANUAL](#6-chế-độ-auto-và-manual)
7. [Liên kết với nhóm AI nhận diện cử chỉ](#7-liên-kết-với-nhóm-ai-nhận-diện-cử-chỉ)
8. [Xử lý sự cố thường gặp](#8-xử-lý-sự-cố-thường-gặp)
9. [Các file cần biết khi chỉnh sửa](#9-các-file-cần-biết-khi-chỉnh-sửa)
10. [Checklist trước khi demo](#10-checklist-trước-khi-demo)

---

## 1. Cài đặt và chạy app

Yêu cầu: Node.js đã cài sẵn (khuyến nghị bản 20 trở lên), trình duyệt
**Google Chrome hoặc Microsoft Edge** trên máy tính (Windows/macOS/Linux đều
được, miễn là bản desktop, không dùng trên điện thoại).

```bash
cd gesturedrive-app
npm install
npm run dev
```

Terminal sẽ in ra một địa chỉ dạng `http://localhost:5173`. Mở địa chỉ đó bằng
Chrome hoặc Edge.

> Tại sao phải là Chrome/Edge? App dùng **Web Serial API** để nói chuyện với
> ESP32 qua cổng serial. Firefox và Safari chưa hỗ trợ API này.

Để đóng gói bản chạy thật (không cần server dev) khi thuyết trình:

```bash
npm run build
npm run preview
```

Lệnh `build` sẽ báo lỗi kiểu (TypeScript) nếu có, nên chạy thử trước ngày báo
cáo để chắc chắn không có lỗi ẩn.

---

## 2. Dùng app không cần phần cứng (chế độ giả lập)

Khi mở app lần đầu, dưới thanh trên cùng có dòng **"Chưa có ESP32? Chạy thử ở
chế độ giả lập"**. Bấm vào đó.

Ở chế độ này:

- App hoạt động y hệt bình thường (camera, nhận diện, đổi chế độ AUTO/MANUAL,
  nhật ký lệnh).
- Lệnh vẫn được "gửi" trên giao diện (thẻ Lệnh hiện tại báo Đã gửi qua
  Bluetooth) nhưng thực ra không có gì được truyền ra ngoài qua dây.
- Dùng chế độ này để tập dượt bài thuyết trình, quay demo, hoặc để nhóm AI
  kiểm tra giao diện mà không cần chờ xe lắp xong.

Muốn ngắt chế độ giả lập và chuyển sang kết nối thật: bấm **Ngắt** ở góc trên
bên phải, rồi làm theo mục 3.

---

## 3. Kết nối với ESP32

ESP32 dùng thư viện `BluetoothSerial` (Bluetooth Classic, giao thức SPP -
Serial Port Profile). Với giao thức này, sau khi ghép đôi (pair), máy tính sẽ
thấy ESP32 như một **cổng Serial ảo**, giống hệt như cắm dây USB. App tận dụng
đúng điều này qua Web Serial API, không cần thư viện Bluetooth phức tạp.

### Cách A: Qua Bluetooth (không dây, dùng khi demo)

1. Bật ESP32, đảm bảo firmware đã chạy `SerialBT.begin("ESP32-Micromouse")`
   (xem mục 4).
2. Trên máy tính, mở phần cài đặt Bluetooth của hệ điều hành (không phải
   trong app):
   - **Windows:** Settings → Bluetooth & devices → Add device.
   - **macOS:** System Settings → Bluetooth.
3. Tìm thiết bị tên `ESP32-Micromouse` (hoặc tên bạn đặt trong firmware) và
   ghép đôi. Không cần mã PIN, hoặc dùng `1234`/`0000` nếu được hỏi.
4. Sau khi ghép đôi thành công, quay lại app, bấm **Kết nối ESP32** ở thanh
   trên. Trình duyệt sẽ hiện hộp thoại chọn cổng, chọn cổng có tên chứa
   `ESP32-Micromouse` hoặc dạng `/dev/tty.*` (macOS) / `COM*` (Windows).
5. Thẻ trạng thái ở góc trên chuyển sang chấm xanh + tên cổng nghĩa là đã kết
   nối xong.

### Cách B: Qua cáp USB (ổn định hơn, dùng khi kiểm thử)

1. Cắm ESP32 vào máy tính bằng cáp USB (loại có dây dữ liệu, không phải cáp
   chỉ sạc).
2. Bấm **Kết nối ESP32** trên app, chọn cổng USB tương ứng (thường có tên
   như `Silicon Labs CP210x` hoặc `CH340`).
3. Lưu ý: khi cắm USB, ESP32 nhận lệnh qua `Serial` (USB) chứ không phải
   `SerialBT`. Nếu firmware chỉ lắng nghe `SerialBT`, bạn cần thêm nhánh đọc
   từ `Serial` khi test qua USB (xem chú thích trong mục 4).

### Nếu macOS không hiện cổng Bluetooth SPP

Một số phiên bản macOS không cho phép trình duyệt liệt kê cổng serial ảo tạo
ra từ Bluetooth Classic. Nếu gặp trường hợp này:

- Ưu tiên dùng **Cách B (USB)** khi demo tại chỗ, ổn định và không phụ thuộc
  hệ điều hành.
- Nếu bắt buộc phải không dây và USB không khả thi, cần dựng một cầu nối nhỏ
  (ví dụ script Python đọc cổng Bluetooth rồi mở một WebSocket) và thay lớp
  truyền trong `src/hooks/useSerialConnection.ts`. Đây là việc kỹ thuật thêm,
  không bắt buộc nếu USB đã đủ dùng cho buổi báo cáo.

---

## 4. Nạp firmware mẫu cho ESP32

File `README.md` trong thư mục này có sẵn một sketch Arduino mẫu, đầy đủ để
chạy thử ngay. Sao chép đoạn đó vào Arduino IDE, sửa lại số chân GPIO theo
mạch driver động cơ của bạn (ví dụ L298N, TB6612), rồi nạp vào ESP32.

Các điểm quan trọng nhóm phần cứng cần nhớ:

- `SerialBT.begin("ESP32-Micromouse")`: tên này sẽ hiện ra khi ghép đôi
  Bluetooth. Đặt tên dễ nhận diện, tránh trùng với ESP32 khác trong phòng thi.
- App gửi **đúng 1 ký tự ASCII** mỗi lần có lệnh mới: `F`, `B`, `L`, `R`, hoặc
  `S`. Không có ký tự xuống dòng hay khoảng trắng đi kèm.
- App **không gửi lệnh lặp lại liên tục**. Ở chế độ AUTO, chỉ gửi khi lệnh
  thay đổi. Vì vậy firmware nên **giữ nguyên trạng thái động cơ cho đến khi
  nhận ký tự mới**, không dùng kiểu "phải nhận liên tục mới chạy".
- Nếu bạn muốn test bằng USB thay vì Bluetooth trong lúc lắp ráp, dùng khối
  sau song song với `SerialBT`:

  ```cpp
  void loop() {
    char c = 0;
    if (SerialBT.available()) c = SerialBT.read();
    else if (Serial.available()) c = Serial.read();  // để test qua cáp USB

    switch (c) {
      case 'F': leftMotor(1);  rightMotor(1);  break;
      case 'B': leftMotor(-1); rightMotor(-1); break;
      case 'L': leftMotor(-1); rightMotor(1);  break;
      case 'R': leftMotor(1);  rightMotor(-1); break;
      case 'S': leftMotor(0);  rightMotor(0);  break;
    }
  }
  ```

- **Khuyến nghị an toàn:** thêm timeout phần cứng. Nếu ESP32 không nhận được
  ký tự nào trong khoảng 2-3 giây, tự động dừng động cơ (`leftMotor(0);
  rightMotor(0);`). App đã có cơ chế tự gửi `S` khi mất dấu bàn tay quá 1
  giây, nhưng nếu mất kết nối Bluetooth hoàn toàn thì ESP32 sẽ không nhận
  được gì cả, nên có một lớp an toàn ở firmware là tốt nhất.

---

## 5. Dùng app với camera thật

1. Đảm bảo đã kết nối ESP32 (mục 3) hoặc đang ở chế độ giả lập (mục 2).
2. Ở khung "Camera trực tiếp", bấm **Bật camera**.
3. Trình duyệt sẽ hỏi quyền truy cập camera, bấm **Cho phép/Allow**.
4. Lần đầu tiên, app cần vài giây để tải mô hình AI nhận diện bàn tay
   (khoảng 5-10 MB, đã ưu tiên chỉ tải khi bật camera để trang mở nhanh).
5. Đưa một bàn tay vào khung hình. Bộ khung xương của bàn tay sẽ hiện lên
   (các chấm và đường màu xanh), kèm khung dò tìm nét đứt.
6. Nếu đang ở chế độ AUTO, lệnh sẽ tự động cập nhật theo cử chỉ (xem bảng cử
   chỉ ở mục 6). Nếu đang ở MANUAL, khung camera vẫn hiển thị nhưng ghi chú
   "AI tạm dừng", vì lệnh lúc này đến từ bàn phím/nút bấm.

Mẹo khi demo: đặt camera ngang tầm ngực, ánh sáng đủ sáng và đều, tránh ngược
sáng (đứng quay lưng ra cửa sổ), giữ nền phía sau không quá lộn xộn để mô hình
dễ khoanh vùng bàn tay.

---

## 6. Chế độ AUTO và MANUAL

Chuyển đổi bằng công tắc **AUTO / MANUAL** ở góc trên bên phải.

### AUTO (điều khiển bằng cử chỉ)

| Ký tự | Lệnh    | Cử chỉ mặc định            |
| ----- | ------- | -------------------------- |
| `F`   | Tiến    | Xòe cả bàn tay (5 ngón)     |
| `B`   | Lùi     | Xòe 4 ngón, gập ngón cái    |
| `L`   | Rẽ trái | Chỉ ngón trỏ sang trái      |
| `R`   | Rẽ phải | Chỉ ngón trỏ sang phải      |
| `S`   | Dừng    | Nắm chặt bàn tay            |

Quy tắc chống nhiễu: app chỉ gửi lệnh mới khi cử chỉ đó **giữ ổn định trong
vài khung hình liên tiếp** và **khác với lệnh đang chạy**. Nếu bạn giữ nguyên
một cử chỉ, app sẽ không gửi lại lệnh đó liên tục, tránh làm nghẽn kết nối
Bluetooth.

Quy tắc an toàn: nếu AI không thấy bàn tay nào trong khung hình liên tục hơn
1 giây, app tự động gửi lệnh `S` (Dừng), phòng trường hợp bạn bước ra khỏi
khung hình mà quên dừng xe.

### MANUAL (điều khiển bằng tay)

Dùng khi cần điều khiển chính xác, ví dụ để căn chỉnh vị trí xe trước khi bắt
đầu phần demo AUTO. Có 2 cách gửi lệnh:

- Bấm trực tiếp vào các nút mũi tên/nút Dừng trên giao diện (bàn phím ảo).
- Dùng phím trên bàn phím thật: `W` (tiến), `S` (lùi), `A` (rẽ trái), `D`
  (rẽ phải), `Space` (dừng).

Ở chế độ này, camera vẫn bật (nếu bạn muốn) nhưng AI không gửi lệnh, để tránh
xung đột giữa cử chỉ vô tình và lệnh bạn đang bấm tay.

---

## 7. Liên kết với nhóm AI nhận diện cử chỉ

Đây là phần quan trọng nhất để 2 nhóm làm việc song song mà không giẫm chân
nhau. Chốt "hợp đồng" sau càng sớm càng tốt.

### Hợp đồng dữ liệu

Bộ nhận diện cử chỉ (dù do nhóm AI viết riêng hay dùng lại phần trong app
này) chỉ cần trả về **đúng 1 trong 6 giá trị** mỗi khung hình:

```
"F" | "B" | "L" | "R" | "S" | null
```

`null` nghĩa là không nhận diện được cử chỉ nào rõ ràng (ví dụ tay đang
chuyển động giữa 2 tư thế). App tự lo phần "giữ ổn định qua vài khung hình
rồi mới gửi", nhóm AI không cần tự làm việc chống nhiễu ở phía họ.

### Nếu nhóm AI dùng chung code MediaPipe của app này

Toàn bộ logic đọc landmark bàn tay và suy ra lệnh nằm gọn trong 1 file:

```
src/lib/gestureRecognition.ts
```

Hàm `recognizeGesture(landmarks, handedness)` nhận vào 21 điểm mốc bàn tay
theo chuẩn MediaPipe Hands và trả về `{ code, name, fingers }`. Nhóm AI có
thể:

- Sửa trực tiếp hàm này nếu muốn đổi cách nhận diện (ví dụ dùng góc ngón tay
  thay vì so sánh tọa độ y).
- Hoặc thay hẳn bằng mô hình riêng của họ, miễn là hàm cuối cùng trả về đúng
  1 trong 5 ký tự lệnh hoặc `null`.

File `src/hooks/useHandTracking.ts` là nơi gọi camera, chạy mô hình MediaPipe
theo từng khung hình, và gọi `recognizeGesture`. Đây là nơi cắm mô hình AI
khác vào nếu nhóm AI muốn dùng một pipeline hoàn toàn riêng (ví dụ chạy một
mô hình Python qua WebSocket thay vì chạy MediaPipe ngay trong trình duyệt).

### Nếu nhóm AI chạy mô hình riêng ở Python (không dùng trình duyệt)

Nếu mô hình AI của nhóm bạn không chạy được trong trình duyệt (ví dụ dùng
PyTorch, OpenCV riêng), cách đơn giản nhất là:

1. Nhóm AI viết một script Python đọc camera, chạy mô hình, và khi có lệnh
   mới thì gửi 1 ký tự (`F`/`B`/`L`/`R`/`S`) qua **WebSocket** tới app.
2. Nhóm app thêm một client WebSocket nhỏ trong app, nhận ký tự đó và gọi
   thẳng hàm gửi lệnh hiện có (giống hệt cách `useHandTracking` đang gọi
   `onStableCommand` trong `src/App.tsx`).
3. Lúc này khung "Camera trực tiếp" trên giao diện có thể hiển thị hình ảnh
   test riêng hoặc ẩn đi, không bắt buộc phải trùng với camera app đang chạy.

Cách này tách biệt hoàn toàn 2 nhóm: nhóm AI không cần biết gì về React/Web
Serial, nhóm app không cần biết gì về mô hình nhận diện, chỉ cần thống nhất
đúng 5 ký tự lệnh ở trên.

### Việc cần thống nhất trước khi mỗi nhóm code

- 5 ký tự lệnh và ý nghĩa (bảng ở mục 6) - đã cố định trong `commands.ts`, đổi
  gì cũng nên thông báo cho nhóm kia.
- Tốc độ khung hình mong đợi (app hiện chạy quanh 20-30 FPS tùy máy).
- Ai chịu trách nhiệm phần chống nhiễu (khuyến nghị: giữ ở app như hiện tại,
  để nhóm AI chỉ cần trả kết quả thô mỗi khung hình).

---

## 8. Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân khả dĩ | Cách xử lý |
| --- | --- | --- |
| Nút "Kết nối ESP32" không làm gì, hoặc báo lỗi trình duyệt không hỗ trợ | Đang dùng Firefox/Safari | Chuyển sang Chrome hoặc Edge |
| Không thấy cổng ESP32 trong hộp thoại chọn cổng | Chưa ghép đôi Bluetooth, hoặc cáp USB chỉ có dây sạc | Ghép đôi lại trong Settings hệ điều hành, hoặc đổi cáp USB có dây dữ liệu |
| Kết nối được nhưng xe không chạy | Firmware chưa đọc đúng cổng (`SerialBT` và `Serial` không phải cùng luồng dữ liệu) | Kiểm tra mục 4, chắc chắn firmware đọc đúng nguồn đang dùng |
| Camera không bật, trình duyệt báo bị từ chối quyền | Người dùng đã bấm Từ chối trước đó | Vào cài đặt trang web của trình duyệt (biểu tượng ổ khóa cạnh địa chỉ), cấp lại quyền Camera, tải lại trang |
| Camera bật nhưng không thấy khung xương bàn tay | Ánh sáng yếu, tay ở rìa khung hình, hoặc mô hình chưa tải xong | Đợi vài giây, đưa tay vào giữa khung, tăng ánh sáng |
| Lệnh gửi liên tục dù không đổi cử chỉ | Đang ở MANUAL và giữ phím, hoặc cử chỉ thật sự đang đổi qua lại | Đây là hành vi đúng ở MANUAL (mỗi lần bấm là 1 lệnh); ở AUTO hãy giữ tay ổn định hơn |
| Xe không tự dừng khi thu tay lại | Firmware chưa xử lý ký tự `S`, hoặc mất kết nối Bluetooth hoàn toàn | Kiểm tra `case 'S'` trong firmware; thêm timeout an toàn như gợi ý ở mục 4 |

---

## 9. Các file cần biết khi chỉnh sửa

| Muốn đổi gì | Sửa ở đâu |
| --- | --- |
| Ký tự lệnh, tên tiếng Việt, mô tả động cơ | `src/lib/commands.ts` |
| Cách nhận diện cử chỉ (ánh xạ tư thế tay sang lệnh) | `src/lib/gestureRecognition.ts` |
| Số khung hình cần ổn định trước khi gửi lệnh (chống nhiễu) | `stableFrames` trong `src/hooks/useHandTracking.ts`, gọi từ `src/App.tsx` |
| Thời gian chờ trước khi tự dừng khi mất dấu tay | Số `1000` (mili-giây) trong `src/App.tsx` |
| Phím tắt ở chế độ MANUAL | `KEY_MAP` trong `src/App.tsx` |
| Cách kết nối ESP32 (Web Serial, baud rate) | `src/hooks/useSerialConnection.ts` |
| Giao diện, màu sắc, bố cục | các file trong `src/components/`, token màu ở `src/index.css` |

---

## 10. Checklist trước khi demo

- [ ] Đã sạc đầy pin ESP32 và pin/nguồn động cơ.
- [ ] Đã ghép đôi Bluetooth giữa máy tính dùng để demo và ESP32 (ghép trước,
      không ghép ngay tại chỗ để tránh mất thời gian).
- [ ] Đã chạy thử `npm run build && npm run preview` ít nhất 1 lần để chắc
      chắn không có lỗi biên dịch.
- [ ] Đã test cả 2 chế độ AUTO và MANUAL với xe thật, không chỉ ở chế độ giả
      lập.
- [ ] Đã test lệnh Dừng (nắm tay / phím Space) hoạt động ngay lập tức.
- [ ] Đã chuẩn bị phương án dự phòng: nếu Bluetooth lỗi tại chỗ, chuyển ngay
      sang cáp USB (mục 3, Cách B).
- [ ] Đã kiểm tra ánh sáng tại địa điểm demo thật (không chỉ trong phòng làm
      việc quen thuộc).
