from __future__ import annotations

from math import sqrt
from statistics import mean, median, stdev
from typing import Any


def numeric_values(rows: list[dict[str, Any]], column: str) -> list[float]:
    values: list[float] = []
    for row in rows:
        value = row.get(column)
        if isinstance(value, bool):
            continue
        if isinstance(value, int | float):
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


def process_capability(rows: list[dict[str, Any]], column: str, lsl: float, usl: float) -> dict[str, float]:
    values = numeric_values(rows, column)
    if len(values) < 2:
        return {"cp": 0.0, "cpk": 0.0, "mean": 0.0, "std": 0.0}

    center = mean(values)
    sigma = stdev(values)
    if sigma == 0:
        return {"cp": 0.0, "cpk": 0.0, "mean": center, "std": sigma}

    cp = (usl - lsl) / (6 * sigma)
    cpk = min((usl - center) / (3 * sigma), (center - lsl) / (3 * sigma))
    return {"cp": cp, "cpk": cpk, "mean": center, "std": sigma}


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
