from __future__ import annotations

from math import sqrt
from statistics import mean, median, stdev
from typing import Any


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
    profiler: dict[str, dict[str, list[dict[str, float]]]] = {}

    for response in responses:
        y = [float(row[response]) for row in model_rows]
        beta = solve_least_squares(design, y)
        predicted = [dot(beta, vector) for vector in design]
        y_mean = mean(y)
        sse = sum((actual - estimate) ** 2 for actual, estimate in zip(y, predicted))
        sst = sum((actual - y_mean) ** 2 for actual in y)
        p = len(beta)
        n = len(y)
        r2 = 0.0 if sst == 0 else 1 - sse / sst
        adj_r2 = 1 - (1 - r2) * (n - 1) / max(1, n - p)
        rmse = (sse / max(1, n - p)) ** 0.5

        coefficients[response] = {term: beta[index] for index, term in enumerate(terms)}
        metrics[response] = {"r2": r2, "adj_r2": adj_r2, "rmse": rmse, "n": float(n), "terms": float(p)}
        profiler[response] = build_profiler_curves(beta, effects, include_quadratic, profiler_effects, baseline)

    return {
        "terms": terms,
        "metrics": metrics,
        "coefficients": coefficients,
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
    column_count = len(design[0])
    xtx = [[0.0 for _ in range(column_count)] for _ in range(column_count)]
    xty = [0.0 for _ in range(column_count)]
    for row, target in zip(design, y):
        for i in range(column_count):
            xty[i] += row[i] * target
            for j in range(column_count):
                xtx[i][j] += row[i] * row[j]
    for i in range(column_count):
        xtx[i][i] += 1e-9
    return gaussian_solve(xtx, xty)


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
