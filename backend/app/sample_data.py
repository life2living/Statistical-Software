from __future__ import annotations

from datetime import datetime, timedelta
from math import sin


def build_sample_rows() -> list[dict[str, object]]:
    start = datetime(2026, 1, 1, 8, 0, 0)
    rows: list[dict[str, object]] = []

    for index in range(240):
        equipment_shift = 0.9 if index >= 150 else 0.0
        pressure = 4.8 + sin(index / 11) * 0.35 + equipment_shift
        temperature = 72 + sin(index / 17) * 3.1 + index * 0.012
        vibration = 0.42 + sin(index / 7) * 0.08 + (0.16 if 180 <= index <= 190 else 0)
        throughput = 118 + sin(index / 13) * 8 - max(0, temperature - 74) * 1.8
        quality_score = 98.5 - abs(pressure - 5.0) * 2.6 - vibration * 2.2

        rows.append(
            {
                "timestamp": (start + timedelta(minutes=5 * index)).isoformat(),
                "equipment_id": "Mixer-A" if index < 120 else "Mixer-B",
                "batch_id": f"B-{1000 + index // 12}",
                "pressure_bar": round(pressure, 3),
                "temperature_c": round(temperature, 3),
                "vibration_g": round(vibration, 4),
                "throughput_kg_h": round(throughput, 3),
                "quality_score": round(quality_score, 3),
            }
        )

    return rows
