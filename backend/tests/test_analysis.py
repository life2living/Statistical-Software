import pytest

from app.analysis import correlation, describe, distribution, fit_standard_least_squares, fit_y_by_x, linear_regression, process_capability, spc_control_limits


ROWS = [
    {"x": 1.0, "y": 2.0},
    {"x": 2.0, "y": 4.0},
    {"x": 3.0, "y": 6.0},
    {"x": 4.0, "y": 8.0},
]


def test_describe_numeric_column() -> None:
    result = describe(ROWS, ["x"])
    assert result["x"]["count"] == 4
    assert result["x"]["mean"] == 2.5


def test_correlation_perfect_positive() -> None:
    result = correlation(ROWS, "x", "y")
    assert round(result["r"], 6) == 1.0
    assert result["n"] == 4


def test_spc_returns_limits() -> None:
    result = spc_control_limits(ROWS, "x")
    assert result["ucl"] > result["center"]
    assert result["lcl"] < result["center"]


def test_process_capability() -> None:
    result = process_capability(ROWS, "x", 0.0, 6.0, target=3.0)
    assert result["cp"] > 0
    assert result["cpk"] == min(result["cpl"], result["cpu"])
    assert result["observed"]["total_out"] == 0.0
    assert result["spec_distance"]["mean_to_target"] == -0.5


def test_process_capability_skips_missing_values() -> None:
    result = process_capability([{"x": 1.0}, {"x": None}, {"x": 5.0}], "x", 2.0, 4.0)
    assert result["n"] == 2.0
    assert result["missing"] == 1.0
    assert result["observed"]["below_lsl"] == 1.0
    assert result["observed"]["above_usl"] == 1.0


def test_process_capability_one_sided_limit() -> None:
    result = process_capability(ROWS, "x", 0.0, None)
    assert result["cp"] == 0.0
    assert result["cpu"] == 0.0
    assert result["cpk"] == result["cpl"]


def test_process_capability_zero_variance() -> None:
    result = process_capability([{"x": 2.0}, {"x": 2.0}], "x", 1.0, 3.0)
    assert result["std"] == 0.0
    assert result["cp"] == 0.0
    assert result["cpk"] == 0.0


def test_linear_regression_one_feature() -> None:
    result = linear_regression(ROWS, "y", ["x"])
    assert round(result["coefficients"]["x"], 6) == 2.0
    assert round(result["metrics"]["r2"], 6) == 1.0


def test_fit_standard_least_squares_profiler() -> None:
    result = fit_standard_least_squares(ROWS, responses=["y"], effects=["x"])
    assert round(result["coefficients"]["y"]["x"], 6) == 2.0
    assert round(result["metrics"]["y"]["r2"], 6) == 1.0
    assert len(result["profiler"]["y"]["x"]) == 25


def test_distribution_skips_missing_values() -> None:
    rows = [{"x": 1.0}, {"x": None}, {"x": 3.0}, {"x": True}]
    result = distribution(rows, ["x"])
    group = result["columns"][0]["groups"][0]

    assert group["n"] == 2.0
    assert group["missing"] == 2.0
    assert group["mean"] == 2.0
    assert round(group["std"], 6) == 1.414214
    assert group["quantiles"]["p50"] == 2.0


def test_distribution_groups_by_column() -> None:
    rows = [
        {"line": "A", "x": 1.0},
        {"line": "A", "x": 3.0},
        {"line": "B", "x": 10.0},
    ]
    result = distribution(rows, ["x"], by="line")
    groups = {group["group"]: group for group in result["columns"][0]["groups"]}

    assert groups["A"]["mean"] == 2.0
    assert groups["B"]["mean"] == 10.0


def test_distribution_uses_frequency_and_weight() -> None:
    rows = [
        {"x": 10.0, "freq": 2.0, "weight": 1.0},
        {"x": 20.0, "freq": 1.0, "weight": 2.0},
        {"x": 100.0, "freq": -1.0, "weight": 1.0},
    ]
    result = distribution(rows, ["x"], freq="freq", weight="weight")
    group = result["columns"][0]["groups"][0]

    assert group["n"] == 4.0
    assert group["missing"] == 1.0
    assert group["mean"] == 15.0
    assert group["quantiles"]["p50"] == 15.0


def test_fit_y_by_x_perfect_linear_fit() -> None:
    result = fit_y_by_x(ROWS, y_column="y", x_column="x")

    assert result["n"] == 4.0
    assert round(result["correlation"]["r"], 6) == 1.0
    assert round(result["coefficients"]["slope"], 6) == 2.0
    assert round(result["metrics"]["r2"], 6) == 1.0
    assert len(result["fit_line"]) == 25


def test_fit_y_by_x_skips_missing_pairs() -> None:
    rows = [{"x": 1.0, "y": 2.0}, {"x": None, "y": 3.0}, {"x": 2.0, "y": 4.0}]
    result = fit_y_by_x(rows, y_column="y", x_column="x")

    assert result["n"] == 2.0
    assert result["missing"] == 1.0
    assert round(result["coefficients"]["slope"], 6) == 2.0


def test_fit_y_by_x_rejects_insufficient_rows() -> None:
    with pytest.raises(ValueError):
        fit_y_by_x([{"x": 1.0, "y": None}], y_column="y", x_column="x")
