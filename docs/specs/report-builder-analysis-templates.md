# Report Builder And Analysis Templates

## JMP Observation

Observed in JMP Pro 17 with `data.xlsx`:

- Excel import creates a persistent data table first. Graph Builder and analysis platforms then bind to the active table rather than embedding a data source inside each graph.
- Platform launch dialogs use a left column list and right role boxes with required and optional roles. Some dialogs include a Recall action, which implies saved role/parameter state.
- The start page treats data tables, scripts, journals/reports, and projects as peer work artifacts.
- Graph Builder exposes actions such as show data table, local data filter, and column switcher from the platform toolbar, while the active data table remains a separate object.

## Clean-Room Product Shape

StatFlow should model saved analytical work as workspace/project artifacts:

- **Analysis template:** reusable launch-dialog state: method, column roles, optional parameters, source dataset, and description.
- **Report:** ordered blocks that reference saved analysis runs, model runs, charts, or markdown narrative.
- **HTML export:** a portable static report generated from stored open-source-calculated outputs.

No proprietary JMP scripts, icons, text bodies, or binaries are copied. Menu names follow StatFlow product language except where a generic statistical platform label is necessary.

## Backend API

- `GET /analysis/templates?project_id=...`
- `POST /analysis/templates`
- `POST /analysis/templates/{template_id}/run`
- `GET /reports?project_id=...`
- `POST /reports`
- `POST /reports/{report_id}/blocks`
- `GET /reports/{report_id}/export/html`

All endpoints remain tenant-scoped through the existing workspace/project/dataset checks.

## Frontend Components

- Add a Project workspace view reachable from the top menu.
- Show saved templates with a Run action.
- Provide Save Template actions for the active launch dialog state.
- Show reports and allow adding the most recent analysis/model result as a report block.
- Open HTML export in a new browser tab.

## Definition Of Done For This Slice

- Templates and reports persist through the existing store.
- Template rerun executes the same backend statistical engine as the original platform run.
- Report export is deterministic HTML and includes method, inputs, interpretations, and compact JSON output.
- Unit tests cover tenant isolation, template rerun, report block insertion, and HTML export.
