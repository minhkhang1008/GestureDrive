# GestureDrive

App desktop điều khiển micromouse ESP32 bằng cử chỉ tay. Camera và nhận diện tay
chạy ngay trong trình duyệt (MediaPipe Hand Landmarker), lệnh gửi tới ESP32 qua
Web Serial.

## Chạy thử

```bash
npm install
npm run dev
```

Mở `http://localhost:5173` bằng **Google Chrome hoặc Microsoft Edge** trên máy
tính (Web Serial chưa hỗ trợ Firefox/Safari). Nếu chưa có phần cứng, bấm
"Chạy thử ở chế độ giả lập" để xem toàn bộ giao diện hoạt động.

## Kết nối ESP32

Firmware ESP32 dùng `BluetoothSerial` (Bluetooth Classic - SPP). Có 2 cách nối:

1. **Bluetooth:** Ghép đôi (pair) ESP32 với máy tính trong phần cài đặt Bluetooth
   của hệ điều hành. Sau khi ghép, board hiện ra như một cổng Serial.
2. **Cáp USB:** Cắm ESP32 qua USB, board hiện ra như một cổng Serial luôn.

Sau đó bấm **Kết nối ESP32** trên app và chọn cổng tương ứng. Baud rate mặc định
là 115200.

> Trên macOS, nếu cổng Bluetooth SPP không hiện trong hộp thoại Web Serial, hãy
> dùng cáp USB, hoặc dựng một cầu nối WebSocket nhỏ. Lớp truyền trong
> `src/hooks/useSerialConnection.ts` được tách riêng để dễ thay.

## Giao thức lệnh (thống nhất với nhóm AI và nhóm phần cứng)

| Ký tự | Lệnh    | Cử chỉ mặc định            | ESP32 làm gì                     |
| ----- | ------- | ------------------------- | -------------------------------- |
| `F`   | Tiến    | Bàn tay xòe (5 ngón)      | Hai động cơ quay tiến            |
| `B`   | Lùi     | Bốn ngón (không ngón cái) | Hai động cơ quay lùi             |
| `L`   | Rẽ trái | Ngón trỏ chỉ sang trái    | Bánh phải tiến, bánh trái lùi    |
| `R`   | Rẽ phải | Ngón trỏ chỉ sang phải    | Bánh trái tiến, bánh phải lùi    |
| `S`   | Dừng    | Nắm tay                   | Dừng cả hai động cơ              |

- Chế độ **AUTO:** chỉ gửi khi lệnh khác lệnh trước đó (chống nhiễu). Nếu mất dấu
  bàn tay quá 1 giây, app tự gửi `S` để dừng xe cho an toàn.
- Chế độ **MANUAL:** bấm nút trên màn hình hoặc phím `W A S D`, `Space` để dừng.

Muốn đổi cách ánh xạ cử chỉ, chỉ sửa hàm `recognizeGesture` trong
`src/lib/gestureRecognition.ts`. Muốn đổi ký tự lệnh, sửa `src/lib/commands.ts`.

## Sketch ESP32 tham khảo

```cpp
#include "BluetoothSerial.h"

BluetoothSerial SerialBT;

// Chân điều khiển 2 động cơ qua driver (ví dụ L298N)
const int L_IN1 = 26, L_IN2 = 27;  // bánh trái
const int R_IN1 = 32, R_IN2 = 33;  // bánh phải

void leftMotor(int dir)  { digitalWrite(L_IN1, dir > 0); digitalWrite(L_IN2, dir < 0); }
void rightMotor(int dir) { digitalWrite(R_IN1, dir > 0); digitalWrite(R_IN2, dir < 0); }

void setup() {
  pinMode(L_IN1, OUTPUT); pinMode(L_IN2, OUTPUT);
  pinMode(R_IN1, OUTPUT); pinMode(R_IN2, OUTPUT);
  SerialBT.begin("ESP32-Micromouse");   // tên hiện khi ghép đôi
}

void loop() {
  if (SerialBT.available()) {
    char c = SerialBT.read();
    switch (c) {
      case 'F': leftMotor(1);  rightMotor(1);  break;  // tiến
      case 'B': leftMotor(-1); rightMotor(-1); break;  // lùi
      case 'L': leftMotor(-1); rightMotor(1);  break;  // rẽ trái
      case 'R': leftMotor(1);  rightMotor(-1); break;  // rẽ phải
      case 'S': leftMotor(0);  rightMotor(0);  break;  // dừng
    }
  }
}
```

## Cấu trúc

- `src/lib/` - định nghĩa lệnh và bộ nhận diện cử chỉ từ landmark bàn tay.
- `src/hooks/useHandTracking.ts` - camera + MediaPipe + vòng lặp nhận diện + vẽ overlay.
- `src/hooks/useSerialConnection.ts` - lớp truyền Web Serial tới ESP32.
- `src/components/` - giao diện (thanh trên, khung camera, thẻ lệnh, D-pad, nhật ký).

## Công nghệ

React + Vite + TypeScript, Tailwind CSS v4, Motion, MediaPipe Tasks Vision,
Phosphor Icons, font Geist.
