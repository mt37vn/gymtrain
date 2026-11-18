# Gym Training Analyzer

Ứng dụng phân tích luyện tập gym: nhập lịch sử tập từ CSV, tính tải luyện tập (TSS), fitness/fatigue/TSB, dự đoán 1RM, gợi ý mức tạ và mô phỏng chương trình tập.

## Tính năng

- Import lịch sử tập từ file CSV (yêu cầu các cột `start`, `exercise`, `reps`; hỗ trợ thêm cân nặng, RIR, bodyweight, thời gian nghỉ...). Bỏ qua bài cardio như Running, Rowing, Cycling, Swimming, SkiErg.
- Phân tích theo mô hình TSS: fitness (42 ngày), fatigue (7 ngày), TSB và trạng thái luyện tập.
- Dự đoán 1RM (Epley) và gợi ý mức tạ theo RIR.
- Tính đĩa tạ khả dụng: thanh đòn 20 kg, đĩa theo lbs (2.5/5/10/25/35/45 lb), chọn tổ hợp ít đĩa nhất trong sai số ±0.5 kg.
- Mô phỏng chương trình tập: mức tạ khởi điểm, tăng tiến theo `min_increment` hoặc theo đĩa lb, ngưỡng lặp tối đa, dự đoán PR.
- Quản lý chương trình nhiều ngày, nhiều bài tập; gợi ý mức tạ, biểu đồ 1RM theo bài.
- Xuất lịch tập iCal và đồng bộ Google Calendar.
- Tham số huấn luyện tùy chỉnh (cửa sổ fitness/fatigue, ngưỡng RIR, tốc độ tăng/giảm, cân nặng cơ thể...).

## Công nghệ

Node.js · Express 5 · better-sqlite3 · Google APIs · HTML/CSS/JavaScript thuần (Chart.js ở frontend)

## Cài đặt

```bash
npm install
```

Đặt biến môi trường `CSV_PATH` trỏ tới file CSV cần import (mặc định trỏ tới `C:\Users\pc\Downloads\...csv`), sau đó:

```bash
CSV_PATH=/duong/dan/export.csv npm start
```

Mở <http://localhost:3000>. Lần chạy đầu tiên, ứng dụng tạo database SQLite `data/gym.db` và import dữ liệu CSV nếu database đang trống.

Có thể import thêm CSV qua giao diện hoặc `POST /api/import-csv`.

## Cấu hình

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `PORT` | `3000` | Cổng HTTP |
| `CSV_PATH` | đường dẫn Windows | File CSV import lần đầu |

Tham số huấn luyện nằm trong `params.json` (khởi tạo từ `params-default.json`):

| Tham số | Ý nghĩa |
| --- | --- |
| `fitness_window_days` | Cửa sổ suy giảm fitness (mặc định 42) |
| `fatigue_window_days` | Cửa sổ suy giảm fatigue (mặc định 7) |
| `rir_threshold` | Ngưỡng RIR tính là gần thất bại |
| `effective_window_days` | Số ngày gần nhất dùng để đánh giá hiệu quả |
| `growth_per_set`, `max_growth_per_day`, `decay_per_day` | Tốc độ tăng/giảm tải |
| `peak_floor_ratio`, `decay_protection_days`, `detrain_threshold`, `overtrain_threshold` | Ngưỡng cảnh báo tập luyện |
| `bodyweight` | Cân nặng cơ thể (kg) |

## Đồng bộ Google Calendar (tùy chọn)

Thêm `google_client_id`, `google_client_secret` vào `params.json`, sau đó gọi `GET /api/google/auth-url` để lấy URL cấp quyền. Callback mặc định: `http://localhost:3000/api/google/callback`. Nếu chỉ cần đọc lịch, có thể dùng `google_api_key`.

Ngoài ra có thể xuất iCal bằng `GET /api/programs/:id/ical`.

## API chính

- `GET /api/summary`, `GET /api/timeline`, `GET /api/exercises`, `GET /api/stats`
- `GET /api/plateaus`, `GET /api/plate-calc`, `GET /api/tss-breakdown`
- `GET /api/sets`, `PUT /api/sets/:id`, `DELETE /api/sets/:id`
- `POST /api/import-csv`, `GET /api/anomalies`
- `GET/POST /api/programs`, `GET/PUT/DELETE /api/programs/:id`
- `GET /api/programs/suggest-weight`, `GET /api/programs/:id/simulate`
- `GET /api/programs/:id/ical`, `POST /api/programs/:id/sync-google`
- `GET/PUT /api/params`, `POST /api/params/reset`

## Cấu trúc

```
src/index.js               # Khởi tạo DB, import CSV, chạy server
src/database.js            # Lớp truy cập SQLite
src/csv-parser.js          # Parser CSV lịch sử tập
src/routes/api.js          # Toàn bộ REST API
src/engine/analyzer.js     # Phân tích TSS/fitness/fatigue
src/engine/exercise-analyzer.js
src/engine/muscle-dynamics.js
src/engine/neural-fatigue.js
src/engine/plate-calc.js   # Tính tổ hợp đĩa tạ
src/engine/program-simulator.js
src/google-calendar.js
public/                    # Giao diện web
data/gym.db                # Database SQLite
params-default.json        # Tham số mặc định
```

> `params.json` và thư mục `data/` chứa cấu hình và dữ liệu tập cá nhân, đã được thêm vào `.gitignore` và không nên commit lên repository công khai.
