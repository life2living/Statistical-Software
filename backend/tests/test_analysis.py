import pytest

from app.analysis import control_chart_imr, correlation, describe, distribution, fit_standard_least_squares, fit_y_by_x, linear_regression, multivariate, oneway_anova, process_capability, spc_control_limits


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


def test_control_chart_imr_returns_individual_and_moving_range_limits() -> None:
    rows = [{"time": "t1", "x": 10.0}, {"time": "t2", "x": 11.0}, {"time": "t3", "x": 9.0}, {"time": "t4", "x": 10.0}]
    result = control_chart_imr(rows, "x", x_column="time")

    assert result["n"] == 4.0
    assert result["missing"] == 0.0
    assert round(result["individuals"]["center"], 6) == 10.0
    assert round(result["moving_range"]["center"], 6) == 1.333333
    assert len(result["moving_range"]["points"]) == 3


def test_control_chart_imr_flags_beyond_limits() -> None:
    rows = [{"x": value} for value in [10.0, 10.1, 9.9, 10.0, 25.0]]
    result = control_chart_imr(rows, "x")

    assert any(violation["chart"] == "MR" for violation in result["violations"])


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
    assert result["anova"]["y"][0]["source"] == "Model"
    assert round(result["anova"]["y"][0]["sum_squares"], 6) == 20.0
    assert result["parameter_estimates"]["y"][1]["term"] == "x"
    assert round(result["parameter_estimates"]["y"][1]["estimate"], 6) == 2.0
    assert result["prediction_formulas"]["y"].startswith("y Predicted =")
    assert result["effect_leverage"]["y"][0]["effect"] == "x"
    assert result["lack_of_fit"]["y"]["status"] == "not_estimable"
    assert result["information_criteria"]["y"]["aicc"] <= result["information_criteria"]["y"]["aic"] + 100
    assert len(result["residuals"]["y"]) == 4
    assert result["residuals"]["y"][0]["cook"] >= 0


def test_fit_standard_least_squares_keeps_source_row_index_with_missing_values() -> None:
    rows = [{"x": 1.0, "y": 2.0}, {"x": None, "y": 3.0}, {"x": 2.0, "y": 4.0}, {"x": 3.0, "y": 6.0}]
    result = fit_standard_least_squares(rows, responses=["y"], effects=["x"])

    assert [row["sourceRowIndex"] for row in result["residuals"]["y"]] == [0.0, 2.0, 3.0]
    assert result["metrics"]["y"]["n"] == 3.0


def test_fit_standard_least_squares_reports_nonperfect_model_diagnostics() -> None:
    rows = [{"x": 1.0, "y": 1.0}, {"x": 2.0, "y": 2.5}, {"x": 3.0, "y": 2.7}, {"x": 4.0, "y": 4.8}]
    result = fit_standard_least_squares(rows, responses=["y"], effects=["x"])

    assert 0 < result["metrics"]["y"]["r2"] < 1
    assert result["anova"]["y"][0]["f_ratio"] is not None
    assert result["parameter_estimates"]["y"][1]["stderr"] > 0
    assert result["effect_tests"]["y"][0]["effect"] == "x"
    assert any(abs(row["residual"]) > 0 for row in result["residuals"]["y"])


def test_fit_standard_least_squares_lack_of_fit_with_replicates() -> None:
    rows = [
        {"x": 1.0, "y": 1.0},
        {"x": 1.0, "y": 2.0},
        {"x": 2.0, "y": 2.0},
        {"x": 2.0, "y": 3.0},
        {"x": 3.0, "y": 10.0},
        {"x": 3.0, "y": 11.0},
    ]
    result = fit_standard_least_squares(rows, responses=["y"], effects=["x"])
    lack = result["lack_of_fit"]["y"]

    assert lack["status"] == "ok"
    assert lack["replicated_points"] == 3.0
    assert lack["rows"][0]["source"] == "Lack of Fit"
    assert lack["rows"][0]["df"] == 1.0
    assert lack["rows"][1]["source"] == "Pure Error"
    assert lack["rows"][1]["df"] == 3.0


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


def test_oneway_anova_matches_balanced_public_example() -> None:
    rows = [
        {"line": "A", "yield": 8.0},
        {"line": "A", "yield": 9.0},
        {"line": "A", "yield": 6.0},
        {"line": "B", "yield": 5.0},
        {"line": "B", "yield": 4.0},
        {"line": "B", "yield": 7.0},
        {"line": "C", "yield": 4.0},
        {"line": "C", "yield": 3.0},
        {"line": "C", "yield": 5.0},
    ]

    result = oneway_anova(rows, "yield", "line")
    source = result["anova"]["source"]

    assert result["n"] == 9.0
    assert result["levels"] == 3.0
    assert round(source[0]["sum_squares"], 6) == 20.666667
    assert round(source[1]["sum_squares"], 6) == 11.333333
    assert round(source[0]["f_ratio"], 6) == 5.470588
    assert len(result["comparisons"]) == 3


def test_oneway_anova_skips_missing_and_reports_insufficient_levels() -> None:
    rows = [{"line": "A", "yield": 1.0}, {"line": None, "yield": 2.0}, {"line": "A", "yield": None}]
    result = oneway_anova(rows, "yield", "line")

    assert result["n"] == 1.0
    assert result["missing"] == 2.0
    assert result["anova"]["status"] == "insufficient_levels"
    assert result["comparisons"] == []


def test_multivariate_returns_pairwise_correlation_matrix() -> None:
    rows = [
        {"a": 1.0, "b": 2.0, "c": 6.0},
        {"a": 2.0, "b": 4.0, "c": 5.0},
        {"a": 3.0, "b": 6.0, "c": 4.0},
        {"a": 4.0, "b": 8.0, "c": None},
    ]
    result = multivariate(rows, ["a", "b", "c"])
    matrix = result["matrix"]

    assert round(matrix[0][1]["r"], 6) == 1.0
    assert round(matrix[0][2]["r"], 6) == -1.0
    assert matrix[0][2]["n"] == 3.0
    assert result["summaries"][2]["missing"] == 1.0


def test_multivariate_zero_variance_returns_null_correlation() -> None:
    result = multivariate([{"a": 1.0, "b": 2.0}, {"a": 1.0, "b": 3.0}], ["a", "b"])

    assert result["matrix"][0][1]["r"] is None
    assert result["matrix"][0][1]["p_value"] is None
