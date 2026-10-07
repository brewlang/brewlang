export type TokenKind =
  | "BREWER"
  | "NUMBER"
  | "UNIT"
  | "EOF"
  | "WORD"
  | "NEWLINE"
  | "PLUS"
  | "TILDE"
  | "ACTION"
  | "DASH"
  | "COMMENT"
  | "TIME"
  | "FRONTMATTER"
  | "ERROR";

export interface Token {
  kind: TokenKind;
  text: string;
  line: number;
  column: number;
}
