import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List

import requests


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("github-weather-sync")

BASE_URL = os.getenv("GDASH_SYNC_BASE_URL", "https://api-gdash.comercias.com.br").rstrip("/")
SYNC_SECRET = os.getenv("WEATHER_SYNC_SECRET", "").strip()
BOOTSTRAP_DAYS = max(1, int(os.getenv("WEATHER_BOOTSTRAP_DAYS", "30")))
REQUEST_TIMEOUT = int(os.getenv("WEATHER_SYNC_TIMEOUT", "30"))
HOURLY_FIELDS = "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,is_day"
CURRENT_FIELDS = "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,is_day"
CHUNK_SIZE = 500


def main() -> None:
    if not SYNC_SECRET:
      raise RuntimeError("WEATHER_SYNC_SECRET is required.")

    locations = fetch_sync_locations()
    if not locations:
        logger.info("No tracked locations returned by backend. Nothing to sync.")
        return

    total_records = 0

    for location in locations:
        records = build_records_for_location(location)
        if not records:
            logger.warning("No weather records produced for %s", location["displayName"])
            continue

        imported = import_records(records)
        total_records += imported
        logger.info(
            "Synced %s records for %s",
            imported,
            location["displayName"],
        )

    logger.info("Weather sync finished. Imported %s records in total.", total_records)


def fetch_sync_locations() -> List[Dict[str, Any]]:
    url = f"{BASE_URL}/weather/sync/locations"
    return request_json("GET", url)


def build_records_for_location(location: Dict[str, Any]) -> List[Dict[str, Any]]:
    start_date = resolve_start_date(location.get("latestCollectedAt"))
    end_date = datetime.utcnow().date().isoformat()

    archive_records = fetch_archive_records(location, start_date, end_date)
    current_record = fetch_current_record(location)

    deduped: Dict[str, Dict[str, Any]] = {
        record["collected_at"]: record
        for record in archive_records
    }

    if current_record:
        deduped[current_record["collected_at"]] = current_record

    return list(sorted(deduped.values(), key=lambda record: record["collected_at"]))


def resolve_start_date(latest_collected_at: Any) -> str:
    today = datetime.utcnow().date()
    if latest_collected_at:
        latest = datetime.fromisoformat(str(latest_collected_at))
        return (latest.date() - timedelta(days=1)).isoformat()

    return (today - timedelta(days=BOOTSTRAP_DAYS - 1)).isoformat()


def fetch_archive_records(location: Dict[str, Any], start_date: str, end_date: str) -> List[Dict[str, Any]]:
    response = request_json(
        "GET",
        "https://archive-api.open-meteo.com/v1/archive",
        params={
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "start_date": start_date,
            "end_date": end_date,
            "hourly": HOURLY_FIELDS,
            "timezone": location["timezone"],
        },
    )

    hourly = response.get("hourly", {})
    times = hourly.get("time") or []
    records = []

    for index, collected_at in enumerate(times):
        records.append(
            build_payload_record(
                location,
                collected_at,
                hourly.get("temperature_2m", [None])[index],
                hourly.get("relative_humidity_2m", [None])[index],
                hourly.get("wind_speed_10m", [None])[index],
                hourly.get("precipitation", [None])[index],
                hourly.get("is_day", [None])[index],
                "archive",
            )
        )

    return [record for record in records if record["temp"] is not None]


def fetch_current_record(location: Dict[str, Any]) -> Dict[str, Any] | None:
    response = request_json(
        "GET",
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "current": CURRENT_FIELDS,
            "timezone": location["timezone"],
        },
    )

    current = response.get("current") or {}
    collected_at = current.get("time")
    if not collected_at:
        return None

    return build_payload_record(
        location,
        collected_at,
        current.get("temperature_2m"),
        current.get("relative_humidity_2m"),
        current.get("wind_speed_10m"),
        current.get("precipitation"),
        current.get("is_day"),
        "sync",
    )


def build_payload_record(
    location: Dict[str, Any],
    collected_at: str,
    temp: Any,
    humidity: Any,
    wind_speed: Any,
    precipitation: Any,
    is_day: Any,
    source: str,
) -> Dict[str, Any]:
    return {
        "cityName": location["cityName"],
        "stateName": location.get("stateName"),
        "stateCode": location.get("stateCode"),
        "timezone": location["timezone"],
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "temp": to_number(temp),
        "humidity": to_number(humidity),
        "wind_speed": to_number(wind_speed),
        "precipitation": to_number(precipitation),
        "is_day": int(to_number(is_day)),
        "collected_at": collected_at,
        "source": source,
    }


def import_records(records: List[Dict[str, Any]]) -> int:
    total = 0
    for index in range(0, len(records), CHUNK_SIZE):
        chunk = records[index : index + CHUNK_SIZE]
        response = request_json(
            "POST",
            f"{BASE_URL}/weather/import",
            body={"records": chunk},
        )
        total += int(response.get("imported", 0))

    return total


def request_json(
    method: str,
    url: str,
    params: Dict[str, Any] | None = None,
    body: Dict[str, Any] | None = None,
    retries: int = 3,
) -> Dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "gdash-weather-sync/1.0",
    }

    if url.startswith(BASE_URL):
        headers["x-weather-sync-secret"] = SYNC_SECRET

    for attempt in range(1, retries + 1):
        response = requests.request(
            method,
            url,
            params=params,
            json=body,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )

        if response.status_code not in {429, 500, 502, 503, 504}:
            response.raise_for_status()
            return response.json()

        wait_seconds = min(30, 2 ** attempt)
        logger.warning(
            "%s %s returned %s. Retrying in %ss.",
            method,
            url,
            response.status_code,
            wait_seconds,
        )
        time.sleep(wait_seconds)

    response.raise_for_status()
    return json.loads(response.text)


def to_number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


if __name__ == "__main__":
    main()
