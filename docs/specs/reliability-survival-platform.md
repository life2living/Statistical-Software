# Reliability And Survival Platform

## Objective

Add a first Reliability / Survival workflow for time-to-event data using clean-room Kaplan-Meier survival estimation.

## Behavior

- Users open Analyze > Reliability / Survival.
- The launch panel exposes Time, Event, and optional By roles.
- Time must be a nonnegative numeric column.
- Event accepts numeric nonzero values, booleans, or common event/failure strings as observed events; zero/false/other values are treated as censored.
- The backend returns one Kaplan-Meier curve per By group, or one `All` group when By is omitted.
- Each curve starts at survival 1.0 and includes time, survival, at-risk count, event count, and censored count.
- The report renders survival step curves and a red-triangle option to show or hide the risk table.

## Algorithm Source

The survival estimate uses the public Kaplan-Meier product-limit estimator:

`S(t) = product(1 - d_i / n_i)`

where `d_i` is the number of events at time `i` and `n_i` is the number at risk immediately before that time.
