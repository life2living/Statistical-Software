# Graph Builder Data Context

## Objective

Align Graph Builder with the JMP-style workflow where data is opened through File/Open and then remains available as the active table context. Graph Builder should focus on columns, role targets, plots, and analysis output rather than embedding a data-source picker or data table below the graph.

## Behavior

- File > Open and the File menu recent list are the entry points for loading or switching datasets.
- The active dataset name appears in the workspace title strip as context.
- Graph Builder does not render a dataset picker inside the graph workspace.
- Graph Builder does not render the data table below the plot.
- The column list remains available for drag-and-drop roles because it represents the active table's columns, not a separate data-source browser.
- Platform dialogs such as DOE may still show previews when the platform itself creates a new table.
