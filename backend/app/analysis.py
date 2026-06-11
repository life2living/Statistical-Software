from __future__ import annotations

from math import sqrt
from statistics import mean, median, stdev
from typing import Any

from scipy import stats


def is_numeric(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def numeric_values(rows: list[dict[str, Any]], column: str) -> list[float]:
    values: list[float] = []
    for row in rows:
        value = row.get(column)
        if is_numeric(value):
            values.append(float(value))
    return values


def describe(rows: list[dict[str, Any]], columns: list[str]) -> dict[str, dict[str, float]]:
    output: dict[str, dict[str, float]] = {}
    for column in columns:
        values = numeric_values(rows, column)
        if not values:
            continue
        sigma = stdev(values) if len(values) > 1 else 0.0
        output[column] = {
            "count": float(len(values)),
            "mean": mean(values),
            "median": median(values),
            "std": sigma,
            "min": min(values),
            "max": max(values),
            "missing": float(len(rows) - len(values)),
        }
    return output


def correlation(rows: list[dict[str, Any]], x_column: str, y_column: str) -> dict[str, float]:
    pairs = [
        (float(row[x_column]), float(row[y_column]))
        for row in rows
        if isinstance(row.get(x_column), int | float) and isinstance(row.get(y_column), int | float)
    ]
    if len(pairs) < 2:
        return {"r": 0.0, "n": float(len(pairs))}

    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    x_mean = mean(xs)
    y_mean = mean(ys)
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in pairs)
    x_denominator = sqrt(sum((x - x_mean) ** 2 for x in xs))
    y_denominator = sqrt(sum((y - y_mean) ** 2 for y in ys))
    if x_denominator == 0 or y_denominator == 0:
        r = 0.0
    else:
        r = numerator / (x_denominator * y_denominator)
    return {"r": r, "n": float(len(pairs))}


def spc_control_limits(rows: list[dict[str, Any]], column: str) -> dict[str, Any]:
    values = numeric_values(rows, column)
    if not values:
        return {"center": 0.0, "ucl": 0.0, "lcl": 0.0, "violations": []}

    center = mean(values)
    sigma = stdev(values) if len(values) > 1 else 0.0
    ucl = center + 3 * sigma
    lcl = center - 3 * sigma
    violations = [
        {"index": index, "value": value}
        for index, value in enumerate(values)
        if value > ucl or value < lcl
    ]
    return {"center": center, "ucl": ucl, "lcl": lcl, "violations": violations}


def control_chart_imr(
    rows: list[dict[str, Any]],
    y_column: str,
    x_column: str | None = None,
    phase_column: str | None = None,
) -> dict[str, Any]:
    observations: list[dict[str, Any]] = []
    missing = 0
    for row_index, row in enumerate(rows):
        value = row.get(y_column)
        if not is_numeric(value):
            missing += 1
            continue
        observations.append(
            {
                "rowIndex": row_index,
                "label": str(row.get(x_column) if x_column else len(observations) + 1),
                "phase": str(row.get(phase_column) if phase_column and row.get(phase_column) is not None else "All"),
                "value": float(value),
            }
        )

    if not observations:
        raise ValueError("Control Chart Builder requires at least one numeric Y value.")

    values = [item["value"] for item in observations]
    moving_ranges = [abs(values[index] - values[index - 1]) for index in range(1, len(values))]
    center = mean(values)
    mr_bar = mean(moving_ranges) if moving_ranges else 0.0
    # I-MR limits use the public NIST moving-range estimator with d2=1.128 for ranges of 2.
    sigma = mr_bar / 1.128 if mr_bar > 0 else 0.0
    i_ucl = center + 3 * sigma
    i_lcl = center - 3 * sigma
    mr_ucl = 3.267 * mr_bar
    mr_lcl = 0.0

    points = [
        {**item, "beyondLimits": item["value"] > i_ucl or item["value"] < i_lcl}
        for item in observations
    ]
    mr_points = [
        {
            "rowIndex": observations[index]["rowIndex"],
            "label": observations[index]["label"],
            "phase": observations[index]["phase"],
            "value": moving_ranges[index - 1],
            "beyondLimits": moving_ranges[index - 1] > mr_ucl,
        }
        for index in range(1, len(observations))
    ]
    violations = [
        {"chart": "I", "rule": "Beyond 3-sigma limits", "rowIndex": point["rowIndex"], "label": point["label"], "value": point["value"]}
        for point in points
        if point["beyondLimits"]
    ] + [
        {"chart": "MR", "rule": "Moving range above UCL", "rowIndex": point["rowIndex"], "label": point["label"], "value": point["value"]}
        for point in mr_points
        if point["beyondLimits"]
    ]

    return {
        "chart_type": "imr",
        "y": y_column,
        "x": x_column,
        "phase": phase_column,
        "n": float(len(points)),
        "missing": float(missing),
        "individuals": {"center": center, "ucl": i_ucl, "lcl": i_lcl, "points": points},
        "moving_range": {"center": mr_bar, "ucl": mr_ucl, "lcl": mr_lcl, "points": mr_points},
        "violations": violations,
    }


def process_capability(rows: list[dict[str, Any]], column: str, lsl: float | None, usl: float | None, target: float | None = None) -> dict[str, Any]:
    values = numeric_values(rows, column)
    if len(values) < 2:
        return empty_capability(column, lsl, usl, target, len(rows))

    center = mean(values)
    sigma = stdev(values)
    missing = len(rows) - len(values)
    if sigma == 0:
        cp = cpk = cpl = cpu = 0.0
    else:
        # Standard capability indices per public NIST process capability formulas.
        cp = (usl - lsl) / (6 * sigma) if lsl is not None and usl is not None else 0.0
        cpl = (center - lsl) / (3 * sigma) if lsl is not None else 0.0
        cpu = (usl - center) / (3 * sigma) if usl is not None else 0.0
        if lsl is not None and usl is not None:
            cpk = min(cpl, cpu)
        else:
            cpk = cpl if lsl is not None else cpu

    below = sum(1 for value in values if lsl is not None and value < lsl)
    above = sum(1 for value in values if usl is not None and value > usl)
    total_out = below + above
    out_percent = 100 * total_out / len(values)

    return {
        "column": column,
        "lsl": lsl,
        "target": target,
        "usl": usl,
        "n": float(len(values)),
        "missing": float(missing),
        "mean": center,
        "std": sigma,
        "overall_std": sigma,
        "cp": cp,
        "cpk": cpk,
        "cpl": cpl,
        "cpu": cpu,
        "pp": cp,
        "ppk": cpk,
        "ppl": cpl,
        "ppu": cpu,
        "observed": {
            "below_lsl": float(below),
            "above_usl": float(above),
            "total_out": float(total_out),
            "out_percent": out_percent,
        },
        "spec_distance": {
            "mean_to_lsl": center - lsl if lsl is not None else None,
            "usl_to_mean": usl - center if usl is not None else None,
            "mean_to_target": center - target if target is not None else None,
        },
    }


def empty_capability(column: str, lsl: float | None, usl: float | None, target: float | None, row_count: int) -> dict[str, Any]:
    return {
        "column": column,
        "lsl": lsl,
        "target": target,
        "usl": usl,
        "n": 0.0,
        "missing": float(row_count),
        "mean": 0.0,
        "std": 0.0,
        "overall_std": 0.0,
        "cp": 0.0,
        "cpk": 0.0,
        "cpl": 0.0,
        "cpu": 0.0,
        "pp": 0.0,
        "ppk": 0.0,
        "ppl": 0.0,
        "ppu": 0.0,
        "observed": {"below_lsl": 0.0, "above_usl": 0.0, "total_out": 0.0, "out_percent": 0.0},
        "spec_distance": {"mean_to_lsl": None, "usl_to_mean": None, "mean_to_target": None},
    }


def distribution(
    rows: list[dict[str, Any]],
    columns: list[str],
    by: str | None = None,
    freq: str | None = None,
    weight: str | None = None,
) -> dict[str, Any]:
    output_columns: list[dict[str, Any]] = []
    for column in columns:
        groups: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            group = str(row.get(by) if by else "All")
            groups.setdefault(group, []).append(row)

        output_columns.append(
            {
                "name": column,
                "by": by,
                "freq": freq,
                "weight": weight,
                "groups": [
                    distribution_group_summary(group_name, group_rows, column, freq, weight)
                    for group_name, group_rows in groups.items()
                ],
            }
        )
    return {"columns": output_columns}


def distribution_group_summary(
    group_name: str,
    rows: list[dict[str, Any]],
    column: str,
    freq: str | None,
    weight: str | None,
) -> dict[str, Any]:
    observations: list[tuple[float, float]] = []
    missing = 0

    for row in rows:
        value = row.get(column)
        row_weight = valid_row_weight(row, freq, weight)
        if not is_numeric(value) or row_weight <= 0:
            missing += 1
            continue
        observations.append((float(value), row_weight))

    if not observations:
        return {
            "group": group_name,
            "n": 0.0,
            "missing": float(missing),
            "mean": 0.0,
            "std": 0.0,
            "stderr": 0.0,
            "min": 0.0,
            "max": 0.0,
            "quantiles": {"p0": 0.0, "p25": 0.0, "p50": 0.0, "p75": 0.0, "p100": 0.0},
        }

    values = [value for value, _ in observations]
    weights = [item_weight for _, item_weight in observations]
    total_weight = sum(weights)
    center = weighted_mean(values, weights)
    sigma = weighted_sample_std(values, weights, center)
    return {
        "group": group_name,
        "n": total_weight,
        "missing": float(missing),
        "mean": center,
        "std": sigma,
        "stderr": sigma / sqrt(total_weight) if total_weight > 0 else 0.0,
        "min": min(values),
        "max": max(values),
        "quantiles": {
            "p0": weighted_quantile(observations, 0.0),
            "p25": weighted_quantile(observations, 0.25),
            "p50": weighted_quantile(observations, 0.5),
            "p75": weighted_quantile(observations, 0.75),
            "p100": weighted_quantile(observations, 1.0),
        },
    }


def valid_row_weight(row: dict[str, Any], freq: str | None, weight: str | None) -> float:
    combined = 1.0
    for role_column in [freq, weight]:
        if not role_column:
            continue
        value = row.get(role_column)
        if not is_numeric(value) or float(value) < 0:
            return 0.0
        combined *= float(value)
    return combined


def weighted_mean(values: list[float], weights: list[float]) -> float:
    total_weight = sum(weights)
    return sum(value * item_weight for value, item_weight in zip(values, weights)) / total_weight


def weighted_sample_std(values: list[float], weights: list[float], center: float) -> float:
    total_weight = sum(weights)
    if len(values) < 2 or total_weight <= 0:
        return 0.0

    # NIST describes sample variance as corrected sum of squares over degrees of freedom.
    # For reliability weights, the unbiased denominator is sum(w) - sum(w^2) / sum(w).
    denominator = total_weight - sum(item_weight * item_weight for item_weight in weights) / total_weight
    if denominator <= 0:
        return 0.0
    corrected_sum = sum(item_weight * (value - center) ** 2 for value, item_weight in zip(values, weights))
    return sqrt(corrected_sum / denominator)


def weighted_quantile(observations: list[tuple[float, float]], probability: float) -> float:
    if not observations:
        return 0.0
    if all(item_weight == observations[0][1] for _, item_weight in observations):
        return linear_quantile(sorted(value for value, _ in observations), probability)
    if probability <= 0:
        return min(value for value, _ in observations)
    if probability >= 1:
        return max(value for value, _ in observations)

    ordered = sorted(observations, key=lambda item: item[0])
    total_weight = sum(item_weight for _, item_weight in ordered)
    target = probability * total_weight
    cumulative = 0.0
    for value, item_weight in ordered:
        cumulative += item_weight
        if cumulative >= target:
            return value
    return ordered[-1][0]


def linear_quantile(sorted_values: list[float], probability: float) -> float:
    if not sorted_values:
        return 0.0
    if probability <= 0:
        return sorted_values[0]
    if probability >= 1:
        return sorted_values[-1]
    position = (len(sorted_values) - 1) * probability
    lower = int(position)
    fraction = position - lower
    if lower + 1 >= len(sorted_values):
        return sorted_values[lower]
    return sorted_values[lower] + fraction * (sorted_values[lower + 1] - sorted_values[lower])


def fit_y_by_x(rows: list[dict[str, Any]], y_column: str, x_column: str) -> dict[str, Any]:
    pairs = [
        (float(row[x_column]), float(row[y_column]))
        for row in rows
        if is_numeric(row.get(x_column)) and is_numeric(row.get(y_column))
    ]
    if len(pairs) < 2:
        raise ValueError("Fit Y by X requires at least two complete numeric rows.")

    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    x_mean = mean(xs)
    y_mean = mean(ys)
    sxx = sum((x - x_mean) ** 2 for x in xs)
    syy = sum((y - y_mean) ** 2 for y in ys)
    sxy = sum((x - x_mean) * (y - y_mean) for x, y in pairs)

    slope = 0.0 if sxx == 0 else sxy / sxx
    intercept = y_mean - slope * x_mean
    fitted = [(x, y, intercept + slope * x) for x, y in pairs]
    residuals = [{"x": x, "actual": y, "predicted": yhat, "residual": y - yhat} for x, y, yhat in fitted]
    sse = sum(item["residual"] ** 2 for item in residuals)
    df_error = max(0, len(pairs) - 2)
    mse = sse / df_error if df_error > 0 else 0.0
    rmse = sqrt(mse) if mse > 0 else 0.0
    r = 0.0 if sxx == 0 or syy == 0 else sxy / sqrt(sxx * syy)
    r2 = 0.0 if syy == 0 else 1 - sse / syy

    fit_line = build_fit_line(xs, intercept, slope, x_mean, sxx, rmse, len(pairs))
    return {
        "y": y_column,
        "x": x_column,
        "n": float(len(pairs)),
        "missing": float(len(rows) - len(pairs)),
        "correlation": {"r": r, "r2": r * r},
        "coefficients": {"intercept": intercept, "slope": slope},
        "metrics": {"r2": r2, "rmse": rmse, "sse": sse, "df_error": float(df_error), "mse": mse},
        "points": [{"x": x, "y": y, "rowIndex": index} for index, (x, y) in enumerate(pairs)],
        "fit_line": fit_line,
        "residuals": residuals[:80],
    }


def build_fit_line(xs: list[float], intercept: float, slope: float, x_mean: float, sxx: float, rmse: float, n: int) -> list[dict[str, float]]:
    low = min(xs)
    high = max(xs)
    point_count = 25
    points: list[dict[str, float]] = []
    # Public simple-regression confidence band formula for the fitted mean response.
    # 1.96 is the normal approximation used for this MVP's 95% display band.
    for index in range(point_count):
        x_value = low if high == low else low + (high - low) * index / (point_count - 1)
        yhat = intercept + slope * x_value
        leverage = (1 / n) + (((x_value - x_mean) ** 2) / sxx if sxx > 0 else 0.0)
        standard_error = rmse * sqrt(leverage)
        points.append({"x": x_value, "y": yhat, "lower": yhat - 1.96 * standard_error, "upper": yhat + 1.96 * standard_error})
    return points


def oneway_anova(rows: list[dict[str, Any]], y_column: str, x_column: str) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, float]]] = {}
    missing = 0
    for row_index, row in enumerate(rows):
        y_value = row.get(y_column)
        x_value = row.get(x_column)
        if not is_numeric(y_value) or x_value in {None, ""}:
            missing += 1
            continue
        group_name = str(x_value)
        grouped.setdefault(group_name, []).append({"value": float(y_value), "rowIndex": float(row_index)})

    groups = [
        oneway_group_summary(name, observations)
        for name, observations in grouped.items()
        if observations
    ]
    complete_n = sum(group["n"] for group in groups)
    if complete_n == 0:
        raise ValueError("Oneway analysis requires at least one complete Y/X row.")

    overall_mean = sum(group["mean"] * group["n"] for group in groups) / complete_n
    ss_between = sum(group["n"] * (group["mean"] - overall_mean) ** 2 for group in groups)
    ss_within = sum(
        sum((observation["value"] - group["mean"]) ** 2 for observation in grouped[group["level"]])
        for group in groups
    )
    ss_total = ss_between + ss_within
    df_between = max(0, len(groups) - 1)
    df_within = max(0, int(complete_n) - len(groups))
    ms_between = ss_between / df_between if df_between > 0 else None
    ms_within = ss_within / df_within if df_within > 0 else None
    f_ratio = (ms_between / ms_within) if ms_between is not None and ms_within not in {None, 0.0} else None
    # One-way ANOVA follows the public NIST fixed-effects decomposition; SciPy supplies the F survival function.
    p_value = float(stats.f.sf(f_ratio, df_between, df_within)) if f_ratio is not None and df_between > 0 and df_within > 0 else None

    return {
        "platform": "oneway",
        "y": y_column,
        "x": x_column,
        "n": float(complete_n),
        "missing": float(missing),
        "levels": float(len(groups)),
        "overall_mean": overall_mean,
        "groups": groups,
        "anova": {
            "source": [
                {"term": x_column, "df": float(df_between), "sum_squares": ss_between, "mean_square": ms_between, "f_ratio": f_ratio, "p_value": p_value},
                {"term": "Error", "df": float(df_within), "sum_squares": ss_within, "mean_square": ms_within, "f_ratio": None, "p_value": None},
                {"term": "Total", "df": float(max(0, int(complete_n) - 1)), "sum_squares": ss_total, "mean_square": None, "f_ratio": None, "p_value": None},
            ],
            "status": "ok" if df_between > 0 and df_within > 0 else "insufficient_levels",
        },
        "comparisons": tukey_hsd(groups, ms_within, df_within),
        "points": [
            {"x": group_name, "y": observation["value"], "rowIndex": int(observation["rowIndex"])}
            for group_name, observations in grouped.items()
            for observation in observations
        ],
    }


def oneway_group_summary(level: str, observations: list[dict[str, float]]) -> dict[str, Any]:
    values = [observation["value"] for observation in observations]
    n = len(values)
    center = mean(values)
    sigma = stdev(values) if n > 1 else 0.0
    stderr = sigma / sqrt(n) if n > 0 else 0.0
    margin = float(stats.t.ppf(0.975, n - 1)) * stderr if n > 1 else 0.0
    return {
        "level": level,
        "n": float(n),
        "mean": center,
        "std": sigma,
        "stderr": stderr,
        "lower95": center - margin,
        "upper95": center + margin,
        "min": min(values),
        "max": max(values),
    }


def tukey_hsd(groups: list[dict[str, Any]], mse: float | None, df_error: int) -> list[dict[str, Any]]:
    if mse is None or mse <= 0 or df_error <= 0 or len(groups) < 2:
        return []

    comparisons: list[dict[str, Any]] = []
    for left_index, left in enumerate(groups):
        for right in groups[left_index + 1:]:
            diff = left["mean"] - right["mean"]
            se = sqrt((mse / 2) * ((1 / left["n"]) + (1 / right["n"])))
            q_stat = abs(diff) / se if se > 0 else 0.0
            # Tukey-Kramer pairwise p-values use SciPy's studentized range survival function.
            p_value = float(stats.studentized_range.sf(q_stat, len(groups), df_error)) if se > 0 else None
            comparisons.append(
                {
                    "left": left["level"],
                    "right": right["level"],
                    "difference": diff,
                    "stderr": se,
                    "q": q_stat,
                    "p_value": p_value,
                }
            )
    return comparisons


def multivariate(rows: list[dict[str, Any]], columns: list[str]) -> dict[str, Any]:
    if len(columns) < 2:
        raise ValueError("Multivariate analysis requires at least two columns.")

    matrix: list[list[dict[str, Any]]] = []
    covariance: list[list[float | None]] = []
    for row_name in columns:
        matrix_row: list[dict[str, Any]] = []
        covariance_row: list[float | None] = []
        for column_name in columns:
            pairs = numeric_pairs(rows, row_name, column_name)
            if len(pairs) < 2:
                matrix_row.append({"x": column_name, "y": row_name, "r": None, "p_value": None, "n": float(len(pairs))})
                covariance_row.append(None)
                continue
            xs = [pair[0] for pair in pairs]
            ys = [pair[1] for pair in pairs]
            x_mean = mean(xs)
            y_mean = mean(ys)
            sxx = sum((x - x_mean) ** 2 for x in xs)
            syy = sum((y - y_mean) ** 2 for y in ys)
            sxy = sum((x - x_mean) * (y - y_mean) for x, y in pairs)
            covariance_value = sxy / (len(pairs) - 1)
            if sxx == 0 or syy == 0:
                r = None
                p_value = None
            else:
                # Pearson correlation and t-test use public formulas from NIST/SciPy documentation.
                r = sxy / sqrt(sxx * syy)
                df = len(pairs) - 2
                if df > 0 and abs(r) < 1:
                    t_stat = abs(r) * sqrt(df / (1 - r * r))
                    p_value = float(2 * stats.t.sf(t_stat, df))
                else:
                    p_value = 0.0 if df > 0 else None
            matrix_row.append({"x": column_name, "y": row_name, "r": r, "p_value": p_value, "n": float(len(pairs))})
            covariance_row.append(covariance_value)
        matrix.append(matrix_row)
        covariance.append(covariance_row)

    summaries = [
        {
            "column": column,
            "n": float(len(values)),
            "mean": mean(values) if values else None,
            "std": stdev(values) if len(values) > 1 else 0.0,
            "missing": float(len(rows) - len(values)),
        }
        for column in columns
        for values in [numeric_values(rows, column)]
    ]
    return {"columns": columns, "matrix": matrix, "covariance": covariance, "summaries": summaries}


def numeric_pairs(rows: list[dict[str, Any]], left_column: str, right_column: str) -> list[tuple[float, float]]:
    return [
        (float(row[left_column]), float(row[right_column]))
        for row in rows
        if is_numeric(row.get(left_column)) and is_numeric(row.get(right_column))
    ]


def linear_regression(rows: list[dict[str, Any]], target: str, features: list[str]) -> dict[str, Any]:
    if len(features) != 1:
        raise ValueError("MVP linear regression supports exactly one feature.")

    feature = features[0]
    pairs = [
        (float(row[feature]), float(row[target]))
        for row in rows
        if isinstance(row.get(feature), int | float) and isinstance(row.get(target), int | float)
    ]
    if len(pairs) < 2:
        raise ValueError("At least two numeric rows are required.")

    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    x_mean = mean(xs)
    y_mean = mean(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    slope = 0.0 if denominator == 0 else sum((x - x_mean) * (y - y_mean) for x, y in pairs) / denominator
    intercept = y_mean - slope * x_mean
    predictions = [{"actual": y, "predicted": intercept + slope * x} for x, y in pairs]
    sse = sum((row["actual"] - row["predicted"]) ** 2 for row in predictions)
    sst = sum((y - y_mean) ** 2 for y in ys)
    r2 = 0.0 if sst == 0 else 1 - sse / sst
    rmse = sqrt(sse / len(predictions))
    return {
        "coefficients": {"intercept": intercept, feature: slope},
        "metrics": {"r2": r2, "rmse": rmse, "n": float(len(predictions))},
        "predictions": predictions[:50],
    }


def fit_standard_least_squares(
    rows: list[dict[str, Any]],
    responses: list[str],
    effects: list[str],
    include_quadratic: bool = False,
) -> dict[str, Any]:
    if not responses:
        raise ValueError("At least one response is required.")
    if not effects:
        raise ValueError("At least one effect is required.")

    model_rows = [
        row
        for row in rows
        if all(isinstance(row.get(column), int | float) and not isinstance(row.get(column), bool) for column in [*responses, *effects])
    ]
    if len(model_rows) < max(3, len(effects) + 2):
        raise ValueError("Not enough complete numeric rows for the requested model.")

    terms = ["Intercept", *effects]
    if include_quadratic:
        terms.extend(f"{effect}^2" for effect in effects)

    design = [model_vector(row, effects, include_quadratic) for row in model_rows]
    profiler_effects = [
        {
            "name": effect,
            "min": min(float(row[effect]) for row in model_rows),
            "max": max(float(row[effect]) for row in model_rows),
            "mean": mean(float(row[effect]) for row in model_rows),
        }
        for effect in effects
    ]
    baseline = {effect["name"]: effect["mean"] for effect in profiler_effects}

    metrics: dict[str, dict[str, float]] = {}
    coefficients: dict[str, dict[str, float]] = {}
    anova: dict[str, list[dict[str, Any]]] = {}
    parameter_estimates: dict[str, list[dict[str, Any]]] = {}
    effect_tests: dict[str, list[dict[str, Any]]] = {}
    residual_diagnostics: dict[str, list[dict[str, float]]] = {}
    profiler: dict[str, dict[str, list[dict[str, float]]]] = {}
    xtx = cross_product(design)
    inverse_xtx = invert_matrix([[value + (1e-9 if row == column else 0.0) for column, value in enumerate(values)] for row, values in enumerate(xtx)])

    for response in responses:
        y = [float(row[response]) for row in model_rows]
        beta = solve_least_squares(design, y)
        predicted = [dot(beta, vector) for vector in design]
        y_mean = mean(y)
        sse = sum((actual - estimate) ** 2 for actual, estimate in zip(y, predicted))
        sst = sum((actual - y_mean) ** 2 for actual in y)
        p = len(beta)
        n = len(y)
        df_model = max(0, p - 1)
        df_error = max(0, n - p)
        df_total = max(0, n - 1)
        ss_model = max(0.0, sst - sse)
        ms_model = ss_model / df_model if df_model > 0 else 0.0
        mse = sse / df_error if df_error > 0 else 0.0
        f_ratio = ms_model / mse if mse > 0 and df_model > 0 else None
        # Standard least-squares ANOVA and coefficient tests use public OLS t/F distributions.
        f_p_value = float(stats.f.sf(f_ratio, df_model, df_error)) if f_ratio is not None and df_error > 0 else None
        r2 = 0.0 if sst == 0 else 1 - sse / sst
        adj_r2 = 1 - (1 - r2) * (n - 1) / max(1, df_error)
        rmse = sqrt(mse) if mse > 0 else 0.0

        coefficients[response] = {term: beta[index] for index, term in enumerate(terms)}
        metrics[response] = {"r2": r2, "adj_r2": adj_r2, "rmse": rmse, "n": float(n), "terms": float(p), "sse": sse, "sst": sst, "mse": mse}
        anova[response] = [
            {"source": "Model", "df": float(df_model), "sum_squares": ss_model, "mean_square": ms_model, "f_ratio": f_ratio, "p_value": f_p_value},
            {"source": "Error", "df": float(df_error), "sum_squares": sse, "mean_square": mse, "f_ratio": None, "p_value": None},
            {"source": "Total", "df": float(df_total), "sum_squares": sst, "mean_square": None, "f_ratio": None, "p_value": None},
        ]
        parameter_estimates[response] = []
        effect_tests[response] = []
        for index, term in enumerate(terms):
            estimate = beta[index]
            stderr = sqrt(max(0.0, mse * inverse_xtx[index][index])) if inverse_xtx else 0.0
            t_ratio = estimate / stderr if stderr > 0 else None
            p_value = float(2 * stats.t.sf(abs(t_ratio), df_error)) if t_ratio is not None and df_error > 0 else None
            parameter_estimates[response].append({"term": term, "estimate": estimate, "stderr": stderr, "t_ratio": t_ratio, "p_value": p_value})
            if term != "Intercept":
                f_value = t_ratio * t_ratio if t_ratio is not None else None
                effect_tests[response].append({"effect": term, "df": 1.0, "sum_squares": (f_value or 0.0) * mse, "f_ratio": f_value, "p_value": p_value})
        residual_diagnostics[response] = []
        for index, (actual, estimate, vector) in enumerate(zip(y, predicted, design)):
            residual = actual - estimate
            leverage = dot(vector, matrix_vector_product(inverse_xtx, vector)) if inverse_xtx else 0.0
            leverage = min(max(leverage, 0.0), 0.999999)
            studentized = residual / (rmse * sqrt(max(1e-12, 1 - leverage))) if rmse > 0 else 0.0
            cook = ((residual * residual) / max(1e-12, p * mse)) * (leverage / max(1e-12, (1 - leverage) ** 2)) if mse > 0 else 0.0
            residual_diagnostics[response].append(
                {
                    "rowIndex": float(index),
                    "actual": actual,
                    "predicted": estimate,
                    "residual": residual,
                    "studentized": studentized,
                    "leverage": leverage,
                    "cook": cook,
                }
            )
        profiler[response] = build_profiler_curves(beta, effects, include_quadratic, profiler_effects, baseline)

    return {
        "terms": terms,
        "metrics": metrics,
        "coefficients": coefficients,
        "anova": anova,
        "parameter_estimates": parameter_estimates,
        "effect_tests": effect_tests,
        "residuals": residual_diagnostics,
        "profiler_effects": profiler_effects,
        "profiler": profiler,
    }


def model_vector(row_or_values: dict[str, Any], effects: list[str], include_quadratic: bool) -> list[float]:
    values = [1.0]
    for effect in effects:
        values.append(float(row_or_values[effect]))
    if include_quadratic:
        for effect in effects:
            value = float(row_or_values[effect])
            values.append(value * value)
    return values


def build_profiler_curves(
    beta: list[float],
    effects: list[str],
    include_quadratic: bool,
    profiler_effects: list[dict[str, float | str]],
    baseline: dict[str, float],
) -> dict[str, list[dict[str, float]]]:
    curves: dict[str, list[dict[str, float]]] = {}
    for effect_info in profiler_effects:
        effect = str(effect_info["name"])
        low = float(effect_info["min"])
        high = float(effect_info["max"])
        step_count = 24
        points: list[dict[str, float]] = []
        for index in range(step_count + 1):
            x_value = low if high == low else low + (high - low) * index / step_count
            values = dict(baseline)
            values[effect] = x_value
            points.append({"x": x_value, "y": dot(beta, model_vector(values, effects, include_quadratic))})
        curves[effect] = points
    return curves


def solve_least_squares(design: list[list[float]], y: list[float]) -> list[float]:
    xtx = cross_product(design)
    column_count = len(xtx)
    xty = [0.0 for _ in range(column_count)]
    for row, target in zip(design, y):
        for i in range(column_count):
            xty[i] += row[i] * target
    for i in range(column_count):
        xtx[i][i] += 1e-9
    return gaussian_solve(xtx, xty)


def cross_product(design: list[list[float]]) -> list[list[float]]:
    column_count = len(design[0])
    xtx = [[0.0 for _ in range(column_count)] for _ in range(column_count)]
    for row in design:
        for i in range(column_count):
            for j in range(column_count):
                xtx[i][j] += row[i] * row[j]
    return xtx


def invert_matrix(matrix: list[list[float]]) -> list[list[float]]:
    size = len(matrix)
    return [gaussian_solve([row[:] for row in matrix], [1.0 if index == column else 0.0 for index in range(size)]) for column in range(size)]


def matrix_vector_product(matrix: list[list[float]], vector: list[float]) -> list[float]:
    return [dot(row, vector) for row in matrix]


def gaussian_solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    n = len(vector)
    augmented = [matrix[i][:] + [vector[i]] for i in range(n)]
    for column in range(n):
        pivot = max(range(column, n), key=lambda row: abs(augmented[row][column]))
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        pivot_value = augmented[column][column]
        if abs(pivot_value) < 1e-12:
            continue
        for item in range(column, n + 1):
            augmented[column][item] /= pivot_value
        for row in range(n):
            if row == column:
                continue
            factor = augmented[row][column]
            for item in range(column, n + 1):
                augmented[row][item] -= factor * augmented[column][item]
    return [augmented[row][n] for row in range(n)]


def dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))
