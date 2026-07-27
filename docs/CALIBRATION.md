# Hiệu chỉnh motor

Mọi phép đo đầu tiên thực hiện khi bánh rời mặt đất, TX power thấp và safety limit
không quá 60%. Chuẩn bị công tắc cắt nguồn motor vật lý.

## 1. Xác nhận chiều

1. Đặt safety limit 10-20%.
2. Giữ **Chỉ motor trái tiến**, rồi thả.
3. Thử trái lùi, phải tiến và phải lùi.
4. Nếu một motor ngược quy ước, sửa `LEFT_INVERTED` hoặc `RIGHT_INVERTED` trong
   `firmware/receiver/BoardPins.h`.
5. Không đổi dây khi driver còn nguồn.

## 2. Đo PWM minimum

Đặt slider motor còn lại bằng 0. Với từng motor và từng chiều:

1. Bắt đầu ở 0%.
2. Dùng timed pulse 250 ms và tăng từng bước nhỏ.
3. Ghi mức đầu tiên motor khởi động lặp lại ổn định, không chỉ rung.
4. Lặp ít nhất năm lần khi pin ở mức điện áp sử dụng bình thường.
5. Chọn threshold thận trọng rồi nhập normalized value `percent * 10`.

Các constant cần cập nhật trong `firmware/common/ConfigDefaults.h`:

```text
PWM_MIN_LEFT_FWD
PWM_MIN_RIGHT_FWD
PWM_MIN_LEFT_REV
PWM_MIN_RIGHT_REV
```

Giá trị mặc định bằng 0 vì chưa có số đo thật, không phải vì motor quay được ở
0%.

Cách firmware áp dụng các giá trị này (`MotorController.h`):

- **Ramp-then-calibrate**: ramp chạy trong miền command thuần (-1000..1000 đã
  mix và scale theo speedLimit). Invert, gain, clamp `MAX_PWM` và breakaway
  floor được áp **tại thời điểm ghi PWM**, sau ramp, để hiệu chỉnh từng bánh
  không làm méo đường ramp chuyển động.
- **Engage deadband**: |command| < 20 sau ramp bị đưa về 0, để nhiễu quanh 0
  không nhảy qua lại ngang breakaway floor.
- **Breakaway remap**: trên deadband, magnitude được remap tuyến tính từ
  `[floor .. MAX_PWM]`, tức mọi command khác 0 đều bắt đầu từ mức motor thực
  sự quay được.

## 3. Cân gain

1. Kê bánh, gửi cùng command cho hai motor.
2. Đo RPM nếu có tachometer hoặc đánh dấu bánh và quay video slow motion.
3. Chọn một phía làm reference 1.00.
4. Điều chỉnh `LEFT_GAIN` hoặc `RIGHT_GAIN` với bước nhỏ.
5. Không dùng gain để bù cơ khí bị kẹt, pin yếu hoặc driver quá nóng.

Chưa có encoder nên gain chỉ là open-loop calibration và sẽ thay đổi theo tải,
pin và mặt sàn.

## 4. K_TURN

Sau khi hai motor cân tương đối:

1. Bắt đầu `K_TURN = 0.70`.
2. Dùng MANUAL ở limit thấp.
3. Đo bán kính vòng và độ ổn định pivot.
4. Tăng nếu steering quá yếu, giảm nếu steering quá gắt.
5. Kiểm tra cả tiến và lùi.

## 5. MAX_PWM và ramp

`MAX_PWM` mặc định 600, tức ceiling 60% duty normalized. Chỉ tăng sau khi xác
nhận dòng motor, nhiệt driver, độ ổn định nguồn và quãng đường dừng.

- `RAMP_UP_PER_SECOND`: nhỏ hơn cho tăng tốc êm hơn.
- `RAMP_DOWN_PER_SECOND`: dùng khi giảm target hoặc đảo chiều.
- STOP, E-stop và watchdog luôn bỏ qua ramp để PWM về 0 ngay.
- Đảo chiều command trực tiếp vẫn ramp về 0 trước khi đổi direction.

Ghi cả ramp rate và thời gian đo từ 0 đến target; không chỉ ghi cảm giác.

## 6. Đo quãng đường dừng

Sau khi các bài test kê bánh đều đạt:

1. Chọn khu vực trống, limit thấp và có người giữ cut-off.
2. Đánh dấu vị trí gửi STOP.
3. Đo khoảng cách tới khi xe đứng yên.
4. Lặp cho Space, pointer release, host timeout và radio timeout.
5. Ghi worst case theo speedLimit và điện áp pin.

Thông số cần chốt sau buổi thực nghiệm:

- Bốn PWM minimum.
- LEFT_GAIN và RIGHT_GAIN.
- K_TURN.
- MAX_PWM.
- RAMP_UP_PER_SECOND và RAMP_DOWN_PER_SECOND.
- Thời gian và khoảng cách dừng worst case.
