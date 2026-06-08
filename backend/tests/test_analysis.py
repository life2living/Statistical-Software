from app.analysis import correlation, describe, fit_standard_least_squares, linear_regression, process_capability, spc_control_limits


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
    result = process_capability(ROWS, "x", 0.0, 6.0)
    assert result["cp"] > 0


def test_linear_regression_one_feature() -> None:
    result = linear_regression(ROWS, "y", ["x"])
    assert round(result["coefficients"]["x"], 6) == 2.0
    assert round(result["metrics"]["r2"], 6) == 1.0


def test_fit_standard_least_squares_profiler() -> None:
    result = fit_standard_least_squares(ROWS, responses=["y"], effects=["x"])
    assert round(result["coefficients"]["y"]["x"], 6) == 2.0
    assert round(result["metrics"]["y"]["r2"], 6) == 1.0
    assert len(result["profiler"]["y"]["x"]) == 25
