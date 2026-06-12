# Model Validation And Comparison

## Objective

Add a first StatFlow modeling workflow for comparing linear model runs with deterministic validation holdouts.

## Behavior

- `POST /models/run` accepts `parameters.validation_fraction`.
- The first slice uses row-order holdout: the model trains on the leading rows and validates on the trailing rows after missing numeric values are removed.
- The linear model response includes training and validation metrics:
  - `train_r2`, `train_rmse`, `train_n`
  - `validation_r2`, `validation_rmse`, `validation_n`
  - `validation_fraction`
- Predictions carry a `split` label of `train` or `validation`.
- `GET /models/runs` accepts `model_type=linear_regression` so the frontend can list comparable runs without mixing Fit Model runs into the table.
- The Graph Builder Model Output panel shows recent linear model runs with training and validation metrics, highlighting the active run.

## Algorithm Source

Simple least-squares fitting uses the public ordinary least-squares formulas documented by NIST and SciPy-style linear regression references. Holdout validation is deterministic and does not depend on proprietary JMP implementation details.
