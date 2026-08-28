from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import traffic_query


class RateLimitDelayTests(unittest.TestCase):
    def test_uses_numeric_retry_after_header(self) -> None:
        self.assertEqual(traffic_query.rate_limit_delay_seconds(3, "42"), 42)

    def test_minimum_request_interval_is_five_to_seven_seconds(self) -> None:
        self.assertEqual(traffic_query.MIN_REQUEST_INTERVAL_MS, 5_000)
        self.assertEqual(traffic_query.MIN_REQUEST_INTERVAL_JITTER_MS, 2_000)

    def test_uses_exponential_delay_without_retry_after_header(self) -> None:
        with patch("traffic_query.random.uniform", return_value=0):
            self.assertEqual(traffic_query.rate_limit_delay_seconds(1), 30)
            self.assertEqual(traffic_query.rate_limit_delay_seconds(3), 120)

    def test_diagnostic_payload_is_small_and_excludes_unrelated_fields(self) -> None:
        payload = {
            "success": False,
            "errorCode": 429001,
            "errorMsg": "请求过于频繁",
            "token": "must-not-be-stored",
            "nested": {"data": "must-not-be-stored"},
        }
        self.assertEqual(
            traffic_query._diagnostic_payload(payload),
            {
                "success": False,
                "errorCode": 429001,
                "errorMsg": "请求过于频繁",
            },
        )


if __name__ == "__main__":
    unittest.main()
