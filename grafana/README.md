

Link to published Google Sheet:

https://docs.google.com/spreadsheets/d/e/2PACX-1vScZYHeWCrTqEvRE-x7Wkq2GvtzqYte7xM14M9yPipOeLzpX80kgGE0sqZlkzPEogQvZHjEKZccad7u/pub?gid=224048145&single=true&output=csv

## Sheets:

### sensors:
sensors
https://docs.google.com/spreadsheets/d/e/2PACX-1vScZYHeWCrTqEvRE-x7Wkq2GvtzqYte7xM14M9yPipOeLzpX80kgGE0sqZlkzPEogQvZHjEKZccad7u/pub?gid=1709736396&single=true&output=csv

### sound_schedule:
sound_schedule
https://docs.google.com/spreadsheets/d/e/2PACX-1vScZYHeWCrTqEvRE-x7Wkq2GvtzqYte7xM14M9yPipOeLzpX80kgGE0sqZlkzPEogQvZHjEKZccad7u/pub?gid=224048145&single=true&output=csv

## Current dashboards

| File | What it is |
|---|---|
| `overview_panel_v7.json` | Overview table panel — paste into the S.O.U.N.D Overview dashboard |
| `campview_v3.json` | Per-camp dashboard (uid `61092161-7b32-4823-8a59-94391fc46517`) |

Everything else in this folder is an earlier version kept for history.

## Columns the dashboards read from the `sensors` sheet

| Column | Used for |
|---|---|
| `device_id` | Join key against the `device_id` label in VictoriaMetrics |
| `Campname` | Display name + the camp picker in the camp view |
| `zone`, `tier` | Display only |
| `max_dbc_now` | Currently-active limit (sheet helper column, computed with `NOW()`) |
| `global_calibration_offset_dbc` | **Permanent calibration of the sensor hardware**, in dB. Not location dependent. Added straight to every dB value. |
| `dbc_reference`, `dbc_sensor` | Sound-check calibration pair (dB meter vs sensor) |
| `dbc_diff_abs` | Location offset, `dbc_reference - dbc_sensor`. Added to every dB value. |

## dB calculation

```
displayed dB = sensor_sound_LCImax
             + global_calibration_offset_dbc     (0 unless valid)
             + dbc_diff_abs                      (0 unless valid)
```

There is no longer a generic `correction_factor` (the old ×1.05) — sensors are calibrated
individually via `global_calibration_offset_dbc` instead.

### Offsets are validated in the dashboard, not trusted

An offset is used **only** when it is a number within ±30 dB, and `dbc_diff_abs` additionally
requires `dbc_sensor` to be numeric. Anything else — blank cell, text, `#DIV/0!`, an absurd
value — contributes **0**. The two conditions between them cover every half-filled row:

| `dbc_reference` | `dbc_sensor` | sheet's `dbc_diff_abs` | offset used |
|---|---|---|---|
| 96 | 83.7 | 12.3 | 12.3 |
| 95 | *(blank)* | 95 | **0** — blank sensor |
| *(blank)* | 93 | -93 | **0** — outside ±30 |
| *(blank)* | *(blank)* | 0 | **0** |

The guard deliberately keys on `dbc_sensor` rather than the reference column, because the latter
is named `dbc_reference (6m with dbmeter)` in the sheet — a header carrying an editable comment.
Depending on it would silently zero every legitimate offset the day someone reworded it.

This exists because the sheet computes `dbc_diff_abs = dbc_reference - dbc_sensor` without
guarding for a blank operand. During a sound check the reference dB is typically typed in before
the sensor reading exists, and for that window the column equals the full reference value (~95 dB).
That once put `sound_23` (Grateful grogg) on the overview at **160 dB** while its actual level was
~65 dB. `dbc_diff_fraction = 1.0000` is the tell-tale sign of the same condition.

The guard is a safety net, not a substitute for a correct sheet — fixing the sheet formula
(`=IF(OR(ref="",sensor=""), 0, ref-sensor)`) is still worthwhile.

### Known limitation

The `LCmax trend` sparkline in the overview table is **not** offset. Grafana transformations
cannot add a per-device constant to the per-device trend frames, and the offsets live in the
sheet rather than in VictoriaMetrics. It is autoscaled and has no axis, so a constant shift would
be invisible anyway. If this ever needs to be exact, publish the offsets as a metric
(`sensor_calibration_offset_dbc`) and join in PromQL:
`sensor_sound_LCImax + on(device_id) sensor_calibration_offset_dbc`.
