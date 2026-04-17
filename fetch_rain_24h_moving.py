import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

BASE_URL = "https://qpeplus.cwa.gov.tw/pub/?tab=monitor"
API_URL = "https://qpeplus.cwa.gov.tw/pub/rainmonitor/get_tag_sectiondisplay_by_tag/"
DEFAULT_COUNTY = "桃園市"

RAIN_KEY_TAG15_1H = "1小時"

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
    tag_id: str,
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


def parse_rainfall_tag15_1h(row: Optional[Dict[str, Any]]) -> Optional[float]:
    if not row:
        return None
    return _parse_float(row.get(RAIN_KEY_TAG15_1H))


def build_moving_records_from_tag15_hourly(
    snapshot_maps: Dict[datetime, Dict[str, Dict[str, Any]]],
    target_time: datetime,
    county: Optional[str],
) -> Dict[str, Dict[str, Any]]:
    target_map = snapshot_maps[target_time]
    records: Dict[str, Dict[str, Any]] = {}

    for station_id, target_row in target_map.items():
        if county and target_row.get("縣市") != county:
            continue

        hourly_rain: Dict[int, Optional[float]] = {}
        for hour_back in range(1, 25):
            snapshot_time = target_time - timedelta(hours=hour_back - 1)
            hourly_rain[hour_back] = parse_rainfall_tag15_1h(snapshot_maps.get(snapshot_time, {}).get(station_id))

        moving: Dict[str, Optional[float]] = {}
        for hours in range(24, 0, -1):
            recent_hourly = [hourly_rain[h] for h in range(1, hours + 1)]
            if any(value is None for value in recent_hourly):
                moving[f"{hours}hAC"] = None
            else:
                moving[f"{hours}hAC"] = round(sum(value for value in recent_hourly if value is not None), 1)

        records[station_id] = {
            "station_id": station_id,
            "station_name": target_row.get("站名"),
            "county": target_row.get("縣市"),
            "district": target_row.get("鄉鎮"),
            "moving_accumulation_mm": moving,
            "source": "tag15_1h",
        }

    return records


def fetch_24h_moving_by_time(target_time: datetime, county: Optional[str], output_path: Path) -> None:
    session = build_session()

    snapshot_times: List[datetime] = [target_time - timedelta(hours=offset) for offset in range(24)]
    sorted_snapshot_times = sorted(snapshot_times)

    print(f"目標時間：{target_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"需下載 tag15 快照數：{len(sorted_snapshot_times)}")

    tag15_snapshots: Dict[datetime, List[Dict[str, Any]]] = {}
    for snapshot_time in sorted_snapshot_times:
        print(f"[tag15] 下載快照：{snapshot_time.strftime('%Y-%m-%d %H:%M:%S')}")
        tag15_snapshots[snapshot_time] = fetch_snapshot(session, snapshot_time, tag_id=SOURCE_TAG15)

    snapshot_maps = {snapshot_time: to_station_map(rows) for snapshot_time, rows in tag15_snapshots.items()}
    records = build_moving_records_from_tag15_hourly(snapshot_maps, target_time, county)

    sorted_records = sorted(
        records.values(),
        key=lambda item: (item.get("county") or "", item.get("district") or "", item.get("station_id") or ""),
    )

    output = {
        "requested_time": target_time.strftime("%Y-%m-%d %H:%M:%S"),
        "window_end": target_time.strftime("%Y-%m-%d %H:%M:%S"),
        "county_filter": county,
        "station_count": len(sorted_records),
        "snapshot_count": len(sorted_snapshot_times),
        "hourly_source": "tag15_1h",
        "data": sorted_records,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as output_file:
        json.dump(output, output_file, ensure_ascii=False, indent=2)

    print(f"完成，合計 {len(sorted_records)} 站，已輸出：{output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="下載指定時間各測站過去 1~24 小時逐時累積降雨")
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
        help="輸出檔案路徑（預設：rainfall_24H_moving_YYYYmmdd_HHMM.json）",
    )

    args = parser.parse_args()

    target_time = parse_time(args.time)
    county = None if args.all_stations else args.county

    default_output_name = f"rainfall_24H_moving_{target_time.strftime('%Y%m%d_%H%M')}.json"
    output_path = Path(args.output) if args.output else Path(default_output_name)

    fetch_24h_moving_by_time(target_time, county, output_path)


if __name__ == "__main__":
    main()
