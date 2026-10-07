export type Severity = "error" | "warning" | "suggestion";

export interface Diagnostic {
  severity: Severity;
  message: string;
  line: number;
  column: number;
}
