import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

BASE_URL = "https://qpeplus.cwa.gov.tw/pub/?tab=monitor"
API_URL = "https://qpeplus.cwa.gov.tw/pub/rainmonitor/get_tag_sectiondisplay_by_tag/"
DEFAULT_COUNTY = "桃園市"

# tag_id=14 地面氣象觀測站的雨量欄位（當日累積，需 3 快照計算跨日 24h）
RAIN_KEYS_TAG14 = [
    "當日累積雨量(mm)",
    "當日 累積雨量(mm)",
]

# tag_id=15 雨量站的直接 24 小時欄位
RAIN_KEY_TAG15 = "24小時"

SOURCE_TAG14 = "14"
SOURCE_TAG15 = "15"


def align_to_10_minutes(input_time: datetime) -> datetime:
    aligned_minute = (input_time.minute // 10) * 10
    return input_time.replace(minute=aligned_minute, second=0, microsecond=0)


def parse_time(time_str: Optional[str]) -> datetime:
    if not time_str:
        return align_to_10_minutes(datetime.now() - timedelta(minutes=10))

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return align_to_10_minutes(datetime.strptime(time_str, fmt))
        except ValueError:
            continue

    raise ValueError("時間格式錯誤，請使用 YYYY-MM-DD HH:MM 或 YYYY-MM-DD HH:MM:SS")


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
    )

    session.get(BASE_URL, timeout=30)
    return session


def fetch_snapshot(
    session: requests.Session,
    snapshot_time: datetime,
    tag_id: str = SOURCE_TAG14,
) -> List[Dict[str, Any]]:
    csrftoken = session.cookies.get("csrftoken")
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": BASE_URL,
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://qpeplus.cwa.gov.tw",
    }

    if csrftoken:
        headers["X-CSRFToken"] = csrftoken

    payload_data = {
        "tag_id": tag_id,
        "data_time": snapshot_time.strftime("%Y-%m-%d %H:%M:%S"),
        "group": "Guest",
        "lang": "tw",
    }

    response = session.post(API_URL, headers=headers, data=payload_data, timeout=60)
    response.raise_for_status()
    result = response.json()

    if result.get("status") != "success":
        raise RuntimeError(f"API 回傳失敗 (tag_id={tag_id})：{result.get('failed_code')}")

    return result.get("data", [])


def to_station_map(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    station_map: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        station_id = row.get("站號")
        if station_id:
            station_map[station_id] = row
    return station_map


def _parse_float(raw: Any) -> Optional[float]:
    if raw in (None, "", "--", "X"):
        return None
    try:
        return float(str(raw).strip())
    except ValueError:
        return None


def parse_rainfall_tag14(row: Optional[Dict[str, Any]]) -> Optional[float]:
    """從 tag_id=14 快照中讀取當日累積雨量。"""
    if not row:
        return None
    for key in RAIN_KEYS_TAG14:
        if key in row:
            return _parse_float(row[key])
    return None


def parse_rainfall_tag15(row: Optional[Dict[str, Any]]) -> Optional[float]:
    """從 tag_id=15 快照中直接讀取 24 小時雨量。"""
    if not row:
        return None
    return _parse_float(row.get(RAIN_KEY_TAG15))


def calculate_past_24h_rainfall_tag14(
    start_row: Optional[Dict[str, Any]],
    end_row: Optional[Dict[str, Any]],
    prev_day_last_row: Optional[Dict[str, Any]],
) -> Optional[float]:
    """用三快照推算跨日 24 小時累積雨量（僅適用 tag_id=14 當日累積欄位）。"""
    start_rain = parse_rainfall_tag14(start_row)
    end_rain = parse_rainfall_tag14(end_row)

    if end_rain is None:
        return None

    if start_rain is None:
        return round(max(0.0, end_rain), 1)

    prev_day_last_rain = parse_rainfall_tag14(prev_day_last_row)

    if prev_day_last_rain is None:
        if end_rain >= start_rain:
            return round(end_rain - start_rain, 1)
        return round(max(0.0, end_rain), 1)

    yday_segment = max(0.0, prev_day_last_rain - start_rain)
    today_segment = max(0.0, end_rain)
    return round(yday_segment + today_segment, 1)


def build_records_from_tag15(
    tag15_rows: List[Dict[str, Any]],
    county: Optional[str],
) -> Dict[str, Dict[str, Any]]:
    """從 tag_id=15 建立 {station_id: record} 字典，直接使用 24小時欄位。"""
    result: Dict[str, Dict[str, Any]] = {}
    for row in tag15_rows:
        if county and row.get("縣市") != county:
            continue
        station_id = row.get("站號")
        if not station_id:
            continue
        result[station_id] = {
            "station_id": station_id,
            "station_name": row.get("站名"),
            "county": row.get("縣市"),
            "district": row.get("鄉鎮"),
            "rainfall_24h_mm": parse_rainfall_tag15(row),
            "source": "tag15",
        }
    return result


def build_records_from_tag14(
    start_rows: List[Dict[str, Any]],
    end_rows: List[Dict[str, Any]],
    prev_day_last_rows: List[Dict[str, Any]],
    county: Optional[str],
    exclude_station_ids: set,
) -> Dict[str, Dict[str, Any]]:
    """從 tag_id=14 補入 tag_id=15 未涵蓋的測站，以三快照推算 24h 雨量。"""
    start_map = to_station_map(start_rows)
    end_map = to_station_map(end_rows)
    prev_day_last_map = to_station_map(prev_day_last_rows)

    result: Dict[str, Dict[str, Any]] = {}
    for station_id, end_row in end_map.items():
        if station_id in exclude_station_ids:
            continue
        if county and end_row.get("縣市") != county:
            continue

        rainfall_24h = calculate_past_24h_rainfall_tag14(
            start_map.get(station_id),
            end_row,
            prev_day_last_map.get(station_id),
        )
        result[station_id] = {
            "station_id": station_id,
            "station_name": end_row.get("站名"),
            "county": end_row.get("縣市"),
            "district": end_row.get("鄉鎮"),
            "rainfall_24h_mm": rainfall_24h,
            "source": "tag14",
        }
    return result


def fetch_past_24h_by_time(target_time: datetime, county: Optional[str], output_path: Path) -> None:
    start_time = target_time - timedelta(hours=24)
    prev_day_last_time = datetime.combine(start_time.date(), datetime.min.time()).replace(hour=23, minute=50)

    print(f"目標時間：{target_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"24 小時起算：{start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"前一日最後快照：{prev_day_last_time.strftime('%Y-%m-%d %H:%M:%S')}")

    session = build_session()

    # --- tag_id=15：直接帶有 24小時 欄位，為主要來源 ---
    print("[tag15] 下載目標時間快照...")
    tag15_rows = fetch_snapshot(session, target_time, tag_id=SOURCE_TAG15)
    tag15_records = build_records_from_tag15(tag15_rows, county)
    print(f"[tag15] 取得 {len(tag15_rows)} 站，過濾後 {len(tag15_records)} 站")

    # --- tag_id=14：補入 tag15 未涵蓋的測站，需三快照推算 ---
    print("[tag14] 下載 24 小時前快照...")
    tag14_start_rows = fetch_snapshot(session, start_time, tag_id=SOURCE_TAG14)
    print("[tag14] 下載目標時間快照...")
    tag14_end_rows = fetch_snapshot(session, target_time, tag_id=SOURCE_TAG14)
    print("[tag14] 下載前一日 23:50 快照...")
    tag14_prev_rows = fetch_snapshot(session, prev_day_last_time, tag_id=SOURCE_TAG14)

    tag14_records = build_records_from_tag14(
        tag14_start_rows, tag14_end_rows, tag14_prev_rows,
        county, exclude_station_ids=set(tag15_records.keys()),
    )
    print(f"[tag14] 補入 {len(tag14_records)} 個 tag15 未涵蓋站")

    # --- 合併：tag15 優先，tag14 補充 ---
    merged: Dict[str, Any] = {**tag15_records, **tag14_records}
    records = sorted(
        merged.values(),
        key=lambda item: (item.get("county") or "", item.get("district") or "", item.get("station_id") or ""),
    )

    output = {
        "requested_time": target_time.strftime("%Y-%m-%d %H:%M:%S"),
        "window_start": start_time.strftime("%Y-%m-%d %H:%M:%S"),
        "window_end": target_time.strftime("%Y-%m-%d %H:%M:%S"),
        "county_filter": county,
        "station_count": len(records),
        "tag15_stations": len(tag15_records),
        "tag14_supplement_stations": len(tag14_records),
        "data": records,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as output_file:
        json.dump(output, output_file, ensure_ascii=False, indent=2)

    print(f"完成，合計 {len(records)} 站，已輸出：{output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="下載指定時間之過去 24 小時各測站雨量資料")
    parser.add_argument(
        "--time",
        type=str,
        default=None,
        help="指定時間（格式：YYYY-MM-DD HH:MM 或 YYYY-MM-DD HH:MM:SS），未提供則使用現在往前 10 分鐘",
    )
    parser.add_argument(
        "--county",
        type=str,
        default=DEFAULT_COUNTY,
        help=f"縣市過濾（預設：{DEFAULT_COUNTY}）。若要全部測站可搭配 --all-stations",
    )
    parser.add_argument(
        "--all-stations",
        action="store_true",
        help="不套用縣市過濾，輸出全部測站",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="輸出檔案路徑（預設：rainfall_24h_YYYYmmdd_HHMM.json）",
    )

    args = parser.parse_args()

    target_time = parse_time(args.time)
    county = None if args.all_stations else args.county

    default_output_name = f"rainfall_24h_{target_time.strftime('%Y%m%d_%H%M')}.json"
    output_path = Path(args.output) if args.output else Path(default_output_name)

    fetch_past_24h_by_time(target_time, county, output_path)


if __name__ == "__main__":
    main()
