import type { ReactNode } from "react";

/**
 * A real <table>. Column headers are <th scope="col">, the caption is a real
 * <caption>, and an empty run says so in a row rather than disappearing.
 */

export interface Column<Row> {
  readonly key: string;
  readonly header: string;
  /** A percentage or a ch measure - never a px literal. */
  readonly width?: string;
  readonly align?: "start" | "end";
  /** Marks the column that identifies the row: rendered as <th scope="row">. */
  readonly rowHeader?: boolean;
  readonly cell: (row: Row) => ReactNode;
}

export interface TableProps<Row> {
  /** Always present. Hidden visually only when a heading already says it. */
  readonly caption: string;
  readonly captionVisible?: boolean;
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Shown instead of rows when there are none. */
  readonly empty?: ReactNode;
}

export function Table<Row>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  empty = "No rows.",
}: TableProps<Row>) {
  return (
    <table className="qed-table">
      <caption className={captionVisible ? "qed-table-caption" : "qed-visually-hidden"}>
        {caption}
      </caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className="t-label"
              data-align={column.align ?? "start"}
              {...(column.width ? { style: { width: column.width } } : {})}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="qed-table-empty" colSpan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) =>
                column.rowHeader === true ? (
                  <th
                    key={column.key}
                    scope="row"
                    data-align={column.align ?? "start"}
                  >
                    {column.cell(row)}
                  </th>
                ) : (
                  <td key={column.key} data-align={column.align ?? "start"}>
                    {column.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
