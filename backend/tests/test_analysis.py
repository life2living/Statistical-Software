import pytest

from app.analysis import control_chart_attribute, control_chart_imr, control_chart_xbar_r, correlation, describe, distribution, fit_standard_least_squares, fit_y_by_x, gauge_rr_crossed, linear_regression, multivariate, oneway_anova, optimize_profiler_values, pareto_summary, process_capability, spc_control_limits, tabulate_summary, variability_chart


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


def test_control_chart_xbar_r_returns_subgroup_limits() -> None:
    rows = [
        {"batch": "A", "x": 10.0},
        {"batch": "A", "x": 12.0},
        {"batch": "B", "x": 11.0},
        {"batch": "B", "x": 13.0},
        {"batch": "C", "x": 9.0},
        {"batch": "C", "x": 11.0},
    ]
    result = control_chart_xbar_r(rows, "x", "batch")

    assert result["chart_type"] == "xbar_r"
    assert result["subgroup_count"] == 3.0
    assert round(result["xbar"]["center"], 6) == 11.0
    assert round(result["range"]["center"], 6) == 2.0
    assert len(result["xbar"]["points"]) == 3


def test_control_chart_phase_limits_recompute_independently() -> None:
    rows = [
        {"lot": 1, "phase": "Before", "x": 10.0},
        {"lot": 2, "phase": "Before", "x": 12.0},
        {"lot": 3, "phase": "After", "x": 30.0},
        {"lot": 4, "phase": "After", "x": 32.0},
    ]
    result = control_chart_imr(rows, "x", x_column="lot", phase_column="phase")

    first_point = result["individuals"]["points"][0]
    third_point = result["individuals"]["points"][2]
    assert first_point["center"] == 11.0
    assert third_point["center"] == 31.0
    assert len(result["phase_limits"]) == 2


def test_control_chart_extended_rules_detect_run_above_center() -> None:
    rows = [{"lot": index, "x": 10.0} for index in range(2)]
    rows.extend({"lot": index + 2, "x": 11.0 + index * 0.01} for index in range(9))
    result = control_chart_imr(rows, "x", x_column="lot")

    assert any("nine points on one side" in violation["rule"] for violation in result["violations"])


def test_control_chart_attribute_p_and_u_limits() -> None:
    rows = [
        {"lot": "A", "defective": 2.0, "sample": 100.0, "defects": 5.0},
        {"lot": "B", "defective": 4.0, "sample": 100.0, "defects": 6.0},
        {"lot": "C", "defective": 3.0, "sample": 100.0, "defects": 4.0},
    ]
    p_chart = control_chart_attribute(rows, "defective", "p", x_column="lot", sample_size_column="sample")
    u_chart = control_chart_attribute(rows, "defects", "u", x_column="lot", sample_size_column="sample")

    assert p_chart["chart_type"] == "p"
    assert round(p_chart["attribute"]["center"], 6) == 0.03
    assert p_chart["attribute"]["points"][0]["ucl"] <= 1.0
    assert u_chart["chart_type"] == "u"
    assert round(u_chart["attribute"]["center"], 6) == 0.05


def test_control_chart_attribute_c_chart() -> None:
    rows = [{"unit": "A", "defects": 2.0}, {"unit": "B", "defects": 5.0}, {"unit": "C", "defects": 3.0}]
    result = control_chart_attribute(rows, "defects", "c", x_column="unit")

    assert result["chart_type"] == "c"
    assert round(result["attribute"]["center"], 6) == 3.333333
    assert len(result["attribute"]["points"]) == 3


def test_pareto_summary_orders_counts_and_cumulative_percent() -> None:
    rows = [
        {"defect": "Scratch"},
        {"defect": "Scratch"},
        {"defect": "Dent"},
        {"defect": "Color"},
    ]
    result = pareto_summary(rows, "defect")

    items = result["groups"][0]["items"]
    assert [item["category"] for item in items] == ["Scratch", "Color", "Dent"]
    assert items[0]["count"] == 2.0
    assert round(items[-1]["cumulative_percent"], 6) == 100.0


def test_pareto_summary_supports_count_and_by_roles() -> None:
    rows = [
        {"line": "A", "defect": "Scratch", "count": 3.0},
        {"line": "A", "defect": "Dent", "count": 1.0},
        {"line": "B", "defect": "Dent", "count": 2.0},
    ]
    result = pareto_summary(rows, "defect", count_column="count", by_column="line")

    assert len(result["groups"]) == 2
    assert result["groups"][0]["total"] == 4.0
    assert result["groups"][0]["items"][0]["category"] == "Scratch"


def test_gauge_rr_crossed_returns_variance_components() -> None:
    rows = []
    part_offsets = {"P1": 0.0, "P2": 8.0, "P3": 16.0}
    operator_offsets = {"A": 0.0, "B": 1.0}
    repeat_offsets = [-0.2, 0.2]
    for part, part_offset in part_offsets.items():
        for operator, operator_offset in operator_offsets.items():
            for repeat_offset in repeat_offsets:
                rows.append({"part": part, "operator": operator, "measurement": 100 + part_offset + operator_offset + repeat_offset})

    result = gauge_rr_crossed(rows, "measurement", "part", "operator")

    assert result["part_count"] == 3.0
    assert result["operator_count"] == 2.0
    assert result["replicates"] == 2.0
    assert result["metrics"]["gauge_rr_percent_study_variation"] < 30.0
    assert result["metrics"]["ndc"] > 5.0


def test_gauge_rr_unbalanced_data_returns_range_fallback() -> None:
    rows = [
        {"part": "P1", "operator": "A", "measurement": 10.0},
        {"part": "P1", "operator": "A", "measurement": 10.2},
        {"part": "P2", "operator": "A", "measurement": 13.0},
        {"part": "P2", "operator": "B", "measurement": 13.4},
        {"part": "P2", "operator": "B", "measurement": 13.5},
    ]
    result = gauge_rr_crossed(rows, "measurement", "part", "operator")

    assert result["design"]["method"] == "range_fallback"
    assert result["design"]["balanced"] is False
    assert result["cell_summaries"]
    assert result["components"][0]["source"] == "Total Gauge R&R"


def test_variability_chart_returns_group_summaries() -> None:
    rows = [
        {"batch": "A", "line": "L1", "y": 10.0},
        {"batch": "A", "line": "L1", "y": 12.0},
        {"batch": "B", "line": "L1", "y": 20.0},
        {"batch": "B", "line": "L1", "y": 24.0},
    ]
    result = variability_chart(rows, "y", "batch", by_column="line")

    assert result["n"] == 4.0
    assert len(result["groups"]) == 2
    assert result["groups"][0]["mean"] == 11.0
    assert round(result["groups"][1]["std"], 6) == 2.828427


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


def test_linear_regression_validation_split_reports_holdout_metrics() -> None:
    rows = [{"x": float(index), "y": float(index * 2 + (10 if index >= 5 else 0))} for index in range(1, 7)]
    result = linear_regression(rows, "y", ["x"], validation_fraction=0.33)

    assert result["metrics"]["train_n"] == 4.0
    assert result["metrics"]["validation_n"] == 2.0
    assert result["metrics"]["validation_rmse"] > 0
    assert {prediction["split"] for prediction in result["predictions"]} == {"train", "validation"}


def test_fit_standard_least_squares_profiler() -> None:
    result = fit_standard_least_squares(ROWS, responses=["y"], effects=["x"])
    assert round(result["coefficients"]["y"]["x"], 6) == 2.0
    assert round(result["metrics"]["y"]["r2"], 6) == 1.0
    assert len(result["profiler"]["y"]["x"]) == 25
    assert result["profiler"]["y"]["x"][0]["lower95"] <= result["profiler"]["y"]["x"][0]["y"]
    assert result["profiler"]["y"]["x"][0]["upper95"] >= result["profiler"]["y"]["x"][0]["y"]
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


def test_optimize_profiler_values_respects_locks() -> None:
    result = optimize_profiler_values(
        coefficients={"Intercept": 0.0, "x": 2.0, "z": -1.0},
        effects=["x", "z"],
        effect_ranges=[
            {"name": "x", "min": 0.0, "max": 10.0, "mean": 5.0},
            {"name": "z", "min": 0.0, "max": 10.0, "mean": 5.0},
        ],
        include_quadratic=False,
        goal="maximize",
        target=None,
        current_values={"x": 2.0, "z": 7.0},
        locks={"z": True},
    )

    assert result["values"]["x"] == 10.0
    assert result["values"]["z"] == 7.0
    assert result["prediction"] == 13.0
    assert result["desirability"] >= 0.9


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


def test_tabulate_summary_groups_numeric_columns() -> None:
    rows = [
        {"line": "A", "yield": 8.0, "defects": 1.0},
        {"line": "A", "yield": 10.0, "defects": None},
        {"line": "B", "yield": 4.0, "defects": 3.0},
    ]
    result = tabulate_summary(rows, ["yield", "defects"], ["line"])
    grouped = {row["line"]: row for row in result["rows"]}

    assert grouped["A"]["N Rows"] == 2.0
    assert grouped["A"]["yield Mean"] == 9.0
    assert grouped["A"]["defects Missing"] == 1.0
    assert grouped["B"]["yield Min"] == 4.0


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
