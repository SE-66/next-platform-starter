import * as XLSX from "xlsx";

export class UnsupportedFormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormulaError";
  }
}

type Primitive = number | string | boolean | null;

interface RangeValue {
  kind: "range";
  values: Primitive[][];
}

type EvalValue = Primitive | RangeValue;

interface EvalContext {
  overrides: Map<string, Primitive>;
  cache: Map<string, EvalValue>;
  stack: Set<string>;
}

type TokenType =
  | "number"
  | "string"
  | "ref"
  | "identifier"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma"
  | "colon"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
}

function isRange(value: EvalValue): value is RangeValue {
  return typeof value === "object" && value !== null && "kind" in value;
}

function flatten(value: EvalValue): Primitive[] {
  if (!isRange(value)) return [value];
  return value.values.flat();
}

function numericValues(values: EvalValue[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    for (const item of flatten(value)) {
      if (typeof item === "number" && Number.isFinite(item)) result.push(item);
    }
  }
  return result;
}

function toNumber(value: EvalValue): number {
  if (isRange(value)) {
    if (value.values.length === 1 && value.values[0]?.length === 1) {
      return toNumber(value.values[0][0]);
    }
    throw new UnsupportedFormulaError("A multi-cell range was used where a scalar was required.");
  }

  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;

  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;

  throw new UnsupportedFormulaError('Cannot convert "' + String(value) + '" to a number.');
}

function toBoolean(value: EvalValue): boolean {
  if (isRange(value)) return toBoolean(value.values[0]?.[0] ?? null);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value === null) return false;
  return value.length > 0;
}

function compare(a: EvalValue, b: EvalValue): number {
  if (!isRange(a) && !isRange(b) && typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }

  const left = String(isRange(a) ? flatten(a)[0] ?? "" : a ?? "").toLowerCase();
  const right = String(isRange(b) ? flatten(b)[0] ?? "" : b ?? "").toLowerCase();
  return left === right ? 0 : left < right ? -1 : 1;
}

function excelRound(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function rootSolve(fn: (rate: number) => number, guess = 0.1): number {
  let low = -0.999999;
  let high = 1;
  let fLow = fn(low);
  let fHigh = fn(high);

  for (let i = 0; i < 12 && Math.sign(fLow) === Math.sign(fHigh); i++) {
    high *= 2;
    fHigh = fn(high);
  }

  if (Number.isFinite(fLow) && Number.isFinite(fHigh) && Math.sign(fLow) !== Math.sign(fHigh)) {
    for (let i = 0; i < 120; i++) {
      const mid = (low + high) / 2;
      const fMid = fn(mid);
      if (!Number.isFinite(fMid)) break;
      if (Math.abs(fMid) < 1e-10) return mid;

      if (Math.sign(fMid) === Math.sign(fLow)) {
        low = mid;
        fLow = fMid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  }

  let x = guess;
  for (let i = 0; i < 50; i++) {
    const y = fn(x);
    if (!Number.isFinite(y)) break;
    if (Math.abs(y) < 1e-9) return x;

    const h = Math.max(1e-7, Math.abs(x) * 1e-6);
    const derivative = (fn(x + h) - fn(x - h)) / (2 * h);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;

    const next = x - y / derivative;
    if (next <= -0.999999 || !Number.isFinite(next)) break;
    x = next;
  }

  throw new UnsupportedFormulaError("Unable to converge on a financial rate.");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
}

function criterionMatches(value: Primitive, criterion: Primitive): boolean {
  if (typeof criterion !== "string") return compare(value, criterion) === 0;

  const match = criterion.match(/^(<=|>=|<>|=|<|>)(.*)$/);
  if (!match) {
    if (criterion.includes("*") || criterion.includes("?")) {
      const escaped = escapeRegex(criterion)
        .replace(/\\\*/g, ".*")
        .replace(/\\\?/g, ".");
      return new RegExp("^" + escaped + "$", "i").test(String(value ?? ""));
    }
    return compare(value, criterion) === 0;
  }

  const op = match[1];
  const raw = match[2];
  const numeric = Number(raw);
  const rhs: Primitive = Number.isFinite(numeric) && raw.trim() !== "" ? numeric : raw;
  const cmp = compare(value, rhs);

  if (op === "=") return cmp === 0;
  if (op === "<>") return cmp !== 0;
  if (op === ">") return cmp > 0;
  if (op === ">=") return cmp >= 0;
  if (op === "<") return cmp < 0;
  return cmp <= 0;
}

function requireRange(value: EvalValue, name: string): RangeValue {
  if (!isRange(value)) {
    throw new UnsupportedFormulaError(name + " requires a cell range.");
  }
  return value;
}

function functionValue(name: string, args: EvalValue[]): EvalValue {
  const fn = name.toUpperCase();

  if (fn === "SUM") return numericValues(args).reduce((a, b) => a + b, 0);

  if (fn === "AVERAGE") {
    const values = numericValues(args);
    if (!values.length) throw new UnsupportedFormulaError("AVERAGE has no numeric values.");
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  if (fn === "MIN" || fn === "MAX") {
    const values = numericValues(args);
    if (!values.length) return 0;
    return fn === "MIN" ? Math.min(...values) : Math.max(...values);
  }

  if (fn === "ABS") return Math.abs(toNumber(args[0] ?? 0));
  if (fn === "SQRT") return Math.sqrt(toNumber(args[0] ?? 0));
  if (fn === "POWER") return toNumber(args[0] ?? 0) ** toNumber(args[1] ?? 0);
  if (fn === "MOD") return toNumber(args[0] ?? 0) % toNumber(args[1] ?? 1);
  if (fn === "SIGN") return Math.sign(toNumber(args[0] ?? 0));

  if (fn === "ROUND") {
    return excelRound(toNumber(args[0] ?? 0), Math.trunc(toNumber(args[1] ?? 0)));
  }

  if (fn === "ROUNDUP" || fn === "ROUNDDOWN") {
    const value = toNumber(args[0] ?? 0);
    const digits = Math.trunc(toNumber(args[1] ?? 0));
    const factor = 10 ** digits;
    const scaled = value * factor;
    const rounded =
      fn === "ROUNDUP"
        ? (scaled >= 0 ? Math.ceil(scaled) : Math.floor(scaled))
        : (scaled >= 0 ? Math.floor(scaled) : Math.ceil(scaled));
    return rounded / factor;
  }

  if (fn === "IF") return toBoolean(args[0] ?? false) ? (args[1] ?? false) : (args[2] ?? false);
  if (fn === "AND") return args.every(toBoolean);
  if (fn === "OR") return args.some(toBoolean);
  if (fn === "NOT") return !toBoolean(args[0] ?? false);

  if (fn === "SUMPRODUCT") {
    const vectors = args.map(arg =>
      flatten(arg).map(item => typeof item === "number" ? item : 0)
    );
    const length = Math.max(0, ...vectors.map(vector => vector.length));
    if (vectors.some(vector => vector.length !== length)) {
      throw new UnsupportedFormulaError("SUMPRODUCT ranges have different sizes.");
    }

    let total = 0;
    for (let i = 0; i < length; i++) {
      total += vectors.reduce((product, vector) => product * vector[i], 1);
    }
    return total;
  }

  if (fn === "NPV") {
    const rate = toNumber(args[0] ?? 0);
    const values = numericValues(args.slice(1));
    return values.reduce(
      (sum, value, index) => sum + value / (1 + rate) ** (index + 1),
      0
    );
  }

  if (fn === "IRR") {
    const values = numericValues(args);
    if (values.length < 2) {
      throw new UnsupportedFormulaError("IRR requires at least two cash flows.");
    }
    return rootSolve(
      rate => values.reduce(
        (sum, value, index) => sum + value / (1 + rate) ** index,
        0
      ),
      0.1
    );
  }

  if (fn === "XNPV" || fn === "XIRR") {
    const offset = fn === "XNPV" ? 1 : 0;
    const rate = fn === "XNPV" ? toNumber(args[0] ?? 0) : undefined;
    const valuesRange = requireRange(args[offset] ?? null, fn);
    const datesRange = requireRange(args[offset + 1] ?? null, fn);
    const values = flatten(valuesRange).map(value => toNumber(value));
    const dates = flatten(datesRange).map(value => toNumber(value));

    if (values.length !== dates.length || values.length < 2) {
      throw new UnsupportedFormulaError(fn + " value and date ranges must have equal length.");
    }

    const firstDate = dates[0];
    const xnpv = (r: number) =>
      values.reduce(
        (sum, value, index) =>
          sum + value / (1 + r) ** ((dates[index] - firstDate) / 365),
        0
      );

    if (fn === "XNPV") return xnpv(rate as number);

    const guess = args[2] === undefined ? 0.1 : toNumber(args[2]);
    return rootSolve(xnpv, guess);
  }

  if (fn === "INDEX") {
    const range = requireRange(args[0] ?? null, "INDEX");
    const row = Math.trunc(toNumber(args[1] ?? 1));
    const col = Math.trunc(toNumber(args[2] ?? 1));
    return range.values[row - 1]?.[col - 1] ?? null;
  }

  if (fn === "MATCH") {
    const lookup = args[0] ?? null;
    const range = requireRange(args[1] ?? null, "MATCH");
    const matchType = args[2] === undefined ? 1 : Math.trunc(toNumber(args[2]));
    const values = flatten(range);

    if (matchType === 0) {
      const index = values.findIndex(value => compare(value, lookup) === 0);
      if (index < 0) {
        throw new UnsupportedFormulaError("MATCH could not find an exact value.");
      }
      return index + 1;
    }

    let selected = -1;
    for (let i = 0; i < values.length; i++) {
      const cmp = compare(values[i], lookup);
      if ((matchType > 0 && cmp <= 0) || (matchType < 0 && cmp >= 0)) selected = i;
    }

    if (selected < 0) {
      throw new UnsupportedFormulaError("MATCH could not find an approximate value.");
    }
    return selected + 1;
  }

  if (fn === "XLOOKUP") {
    const lookup = args[0] ?? null;
    const lookupRange = requireRange(args[1] ?? null, "XLOOKUP");
    const returnRange = requireRange(args[2] ?? null, "XLOOKUP");
    const lookups = flatten(lookupRange);
    const returns = flatten(returnRange);
    const index = lookups.findIndex(value => compare(value, lookup) === 0);
    if (index < 0) return args[3] ?? null;
    return returns[index] ?? null;
  }

  if (fn === "VLOOKUP") {
    const lookup = args[0] ?? null;
    const table = requireRange(args[1] ?? null, "VLOOKUP");
    const column = Math.trunc(toNumber(args[2] ?? 1));
    const approximate = args[3] === undefined ? true : toBoolean(args[3]);

    if (column < 1) {
      throw new UnsupportedFormulaError("VLOOKUP column index is invalid.");
    }

    let selected: Primitive[] | undefined;
    for (const row of table.values) {
      const cmp = compare(row[0] ?? null, lookup);
      if (cmp === 0) {
        selected = row;
        break;
      }
      if (approximate && cmp <= 0) selected = row;
    }

    if (!selected) {
      throw new UnsupportedFormulaError("VLOOKUP did not find a matching row.");
    }
    return selected[column - 1] ?? null;
  }

  if (fn === "CHOOSE") {
    const index = Math.trunc(toNumber(args[0] ?? 1));
    return args[index] ?? null;
  }

  if (fn === "SUMIF" || fn === "AVERAGEIF" || fn === "COUNTIF") {
    const criteriaRange = requireRange(args[0] ?? null, fn);
    const criterionArg = args[1] ?? null;
    const criterion: Primitive = isRange(criterionArg)
      ? flatten(criterionArg)[0] ?? null
      : criterionArg;

    const criteriaValues = flatten(criteriaRange);
    const valueRange =
      fn === "COUNTIF"
        ? criteriaRange
        : args[2] === undefined
          ? criteriaRange
          : requireRange(args[2], fn);
    const values = flatten(valueRange);

    const matched: number[] = [];
    let count = 0;

    for (let i = 0; i < criteriaValues.length; i++) {
      if (!criterionMatches(criteriaValues[i], criterion)) continue;
      count++;
      const value = values[i];
      if (typeof value === "number") matched.push(value);
    }

    if (fn === "COUNTIF") return count;
    if (fn === "SUMIF") return matched.reduce((sum, value) => sum + value, 0);

    if (!matched.length) {
      throw new UnsupportedFormulaError("AVERAGEIF matched no numeric values.");
    }
    return matched.reduce((sum, value) => sum + value, 0) / matched.length;
  }

  if (fn === "SUMIFS" || fn === "COUNTIFS" || fn === "AVERAGEIFS") {
    const isCount = fn === "COUNTIFS";
    const valueRange = isCount ? null : requireRange(args[0] ?? null, fn);
    const start = isCount ? 0 : 1;

    const criteriaPairs: Array<{ range: RangeValue; criterion: Primitive }> = [];
    for (let i = start; i < args.length; i += 2) {
      const range = requireRange(args[i] ?? null, fn);
      const criterionArg = args[i + 1] ?? null;
      const criterion: Primitive = isRange(criterionArg)
        ? flatten(criterionArg)[0] ?? null
        : criterionArg;
      criteriaPairs.push({ range, criterion });
    }

    if (!criteriaPairs.length) {
      throw new UnsupportedFormulaError(fn + " requires criteria ranges.");
    }

    const length = flatten(criteriaPairs[0].range).length;
    let count = 0;
    let sum = 0;

    for (let index = 0; index < length; index++) {
      const matches = criteriaPairs.every(pair =>
        criterionMatches(flatten(pair.range)[index] ?? null, pair.criterion)
      );
      if (!matches) continue;

      count++;
      if (valueRange) {
        const value = flatten(valueRange)[index];
        if (typeof value === "number") sum += value;
      }
    }

    if (fn === "COUNTIFS") return count;
    if (fn === "SUMIFS") return sum;
    if (!count) throw new UnsupportedFormulaError("AVERAGEIFS matched no values.");
    return sum / count;
  }

  throw new UnsupportedFormulaError("Unsupported Excel function: " + name);
}

class Tokenizer {
  private index = 0;

  constructor(private readonly source: string) {}

  next(): Token {
    while (/\s/.test(this.source[this.index] || "")) this.index++;

    if (this.index >= this.source.length) return { type: "eof", value: "" };

    const rest = this.source.slice(this.index);

    const stringMatch = rest.match(/^"((?:[^"]|"")*)"/);
    if (stringMatch) {
      this.index += stringMatch[0].length;
      return { type: "string", value: stringMatch[1].replace(/""/g, '"') };
    }

    const quotedRef = rest.match(/^'(?:[^']|'')+'!\$?[A-Z]{1,3}\$?\d+/i);
    if (quotedRef) {
      this.index += quotedRef[0].length;
      return { type: "ref", value: quotedRef[0] };
    }

    const sheetRef = rest.match(/^[A-Za-z0-9_. -]+!\$?[A-Z]{1,3}\$?\d+/i);
    if (sheetRef) {
      this.index += sheetRef[0].length;
      return { type: "ref", value: sheetRef[0] };
    }

    const ref = rest.match(/^\$?[A-Z]{1,3}\$?\d+/i);
    if (ref) {
      this.index += ref[0].length;
      return { type: "ref", value: ref[0] };
    }

    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/);
    if (number) {
      this.index += number[0].length;
      return { type: "number", value: number[0] };
    }

    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (identifier) {
      this.index += identifier[0].length;
      return { type: "identifier", value: identifier[0] };
    }

    for (const op of [">=", "<=", "<>"]) {
      if (rest.startsWith(op)) {
        this.index += op.length;
        return { type: "operator", value: op };
      }
    }

    const char = rest[0];
    this.index++;

    if ("+-*/^%=><&".includes(char)) return { type: "operator", value: char };
    if (char === "(") return { type: "lparen", value: char };
    if (char === ")") return { type: "rparen", value: char };
    if (char === ",") return { type: "comma", value: char };
    if (char === ":") return { type: "colon", value: char };

    throw new UnsupportedFormulaError(
      "Unsupported formula token near: " + rest.slice(0, 18)
    );
  }
}

class FormulaParser {
  private readonly tokenizer: Tokenizer;
  private current: Token;

  constructor(
    formula: string,
    private readonly currentSheet: string,
    private readonly resolveCell: (ref: string, currentSheet: string) => EvalValue,
    private readonly resolveRange: (
      start: string,
      end: string,
      currentSheet: string
    ) => RangeValue
  ) {
    this.tokenizer = new Tokenizer(formula.replace(/^=/, ""));
    this.current = this.tokenizer.next();
  }

  parse(): EvalValue {
    const value = this.parseComparison();
    if (this.current.type !== "eof") {
      throw new UnsupportedFormulaError("Unexpected token: " + this.current.value);
    }
    return value;
  }

  private advance(): Token {
    const previous = this.current;
    this.current = this.tokenizer.next();
    return previous;
  }

  private expect(type: TokenType, value?: string): Token {
    if (
      this.current.type !== type ||
      (value !== undefined && this.current.value !== value)
    ) {
      throw new UnsupportedFormulaError(
        "Expected " +
          (value ?? type) +
          ", found " +
          (this.current.value || this.current.type) +
          "."
      );
    }
    return this.advance();
  }

  private parseComparison(): EvalValue {
    let left = this.parseAdditive();

    while (
      this.current.type === "operator" &&
      ["=", "<>", ">", ">=", "<", "<="].includes(this.current.value)
    ) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      const cmp = compare(left, right);

      left =
        op === "=" ? cmp === 0 :
        op === "<>" ? cmp !== 0 :
        op === ">" ? cmp > 0 :
        op === ">=" ? cmp >= 0 :
        op === "<" ? cmp < 0 :
        cmp <= 0;
    }

    return left;
  }

  private parseAdditive(): EvalValue {
    let left = this.parseMultiplicative();

    while (
      this.current.type === "operator" &&
      ["+", "-", "&"].includes(this.current.value)
    ) {
      const op = this.advance().value;
      const right = this.parseMultiplicative();

      if (op === "&") {
        const leftText = isRange(left) ? flatten(left)[0] ?? "" : left ?? "";
        const rightText = isRange(right) ? flatten(right)[0] ?? "" : right ?? "";
        left = String(leftText) + String(rightText);
      } else {
        left =
          op === "+"
            ? toNumber(left) + toNumber(right)
            : toNumber(left) - toNumber(right);
      }
    }

    return left;
  }

  private parseMultiplicative(): EvalValue {
    let left = this.parsePower();

    while (
      this.current.type === "operator" &&
      ["*", "/"].includes(this.current.value)
    ) {
      const op = this.advance().value;
      const right = this.parsePower();
      left =
        op === "*"
          ? toNumber(left) * toNumber(right)
          : toNumber(left) / toNumber(right);
    }

    return left;
  }

  private parsePower(): EvalValue {
    let left = this.parseUnary();

    if (this.current.type === "operator" && this.current.value === "^") {
      this.advance();
      const right = this.parsePower();
      left = toNumber(left) ** toNumber(right);
    }

    while (this.current.type === "operator" && this.current.value === "%") {
      this.advance();
      left = toNumber(left) / 100;
    }

    return left;
  }

  private parseUnary(): EvalValue {
    if (
      this.current.type === "operator" &&
      ["+", "-"].includes(this.current.value)
    ) {
      const op = this.advance().value;
      const value = this.parseUnary();
      return op === "-" ? -toNumber(value) : toNumber(value);
    }

    return this.parsePrimary();
  }

  private parsePrimary(): EvalValue {
    if (this.current.type === "number") {
      return Number(this.advance().value);
    }

    if (this.current.type === "string") {
      return this.advance().value;
    }

    if (this.current.type === "ref") {
      const start = this.advance().value;
      if ((this.current as Token).type === "colon") {
        this.advance();
        const end = this.expect("ref").value;
        return this.resolveRange(start, end, this.currentSheet);
      }
      return this.resolveCell(start, this.currentSheet);
    }

    if (this.current.type === "identifier") {
      const name = this.advance().value;

      if (name.toUpperCase() === "TRUE") return true;
      if (name.toUpperCase() === "FALSE") return false;

      if ((this.current as Token).type !== "lparen") {
        throw new UnsupportedFormulaError("Unsupported named value: " + name);
      }

      this.advance();
      const args: EvalValue[] = [];

      if (this.current.type !== "rparen") {
        while (true) {
          args.push(this.parseComparison());
          if (this.current.type !== "comma") break;
          this.advance();
        }
      }

      this.expect("rparen");
      return functionValue(name, args);
    }

    if (this.current.type === "lparen") {
      this.advance();
      const value = this.parseComparison();
      this.expect("rparen");
      return value;
    }

    throw new UnsupportedFormulaError(
      "Unexpected token: " + (this.current.value || this.current.type)
    );
  }
}

function parseRef(
  raw: string,
  currentSheet: string
): { sheet: string; address: string } {
  const bang = raw.lastIndexOf("!");
  let sheet = currentSheet;
  let address = raw;

  if (bang >= 0) {
    sheet = raw.slice(0, bang);
    address = raw.slice(bang + 1);
  }

  if (sheet.startsWith("'") && sheet.endsWith("'")) {
    sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }

  return {
    sheet,
    address: address.replace(/\$/g, "").toUpperCase()
  };
}

export class WorkbookEvaluator {
  constructor(private readonly workbook: XLSX.WorkBook) {}

  evaluateNumber(
    cellKey: string,
    overrides: Map<string, Primitive> = new Map()
  ): number {
    const context: EvalContext = {
      overrides,
      cache: new Map(),
      stack: new Set()
    };

    return toNumber(this.evaluateCell(cellKey, context));
  }

  private evaluateCell(cellKey: string, context: EvalContext): EvalValue {
    if (context.overrides.has(cellKey)) {
      return context.overrides.get(cellKey) ?? null;
    }

    if (context.cache.has(cellKey)) return context.cache.get(cellKey)!;

    if (context.stack.has(cellKey)) {
      throw new UnsupportedFormulaError(
        "Circular calculation encountered at " + cellKey + "."
      );
    }

    const bang = cellKey.lastIndexOf("!");
    if (bang < 0) {
      throw new UnsupportedFormulaError("Invalid cell key: " + cellKey);
    }

    const sheetName = cellKey.slice(0, bang);
    const address = cellKey.slice(bang + 1);
    const sheet = this.workbook.Sheets[sheetName];

    if (!sheet) {
      throw new UnsupportedFormulaError("Missing sheet: " + sheetName);
    }

    const cell = sheet[address] as XLSX.CellObject | undefined;
    if (!cell) return 0;

    if (cell.t === "e") {
      throw new UnsupportedFormulaError(
        "Excel error cell encountered at " + cellKey + "."
      );
    }

    if (!cell.f) {
      const value =
        typeof cell.v === "number" ||
        typeof cell.v === "string" ||
        typeof cell.v === "boolean"
          ? cell.v
          : null;
      context.cache.set(cellKey, value);
      return value;
    }

    context.stack.add(cellKey);

    try {
      const parser = new FormulaParser(
        cell.f,
        sheetName,
        (ref, currentSheet) => {
          const parsed = parseRef(ref, currentSheet);
          return this.evaluateCell(
            parsed.sheet + "!" + parsed.address,
            context
          );
        },
        (start, end, currentSheet) =>
          this.evaluateRange(start, end, currentSheet, context)
      );

      const value = parser.parse();
      context.cache.set(cellKey, value);
      return value;
    } finally {
      context.stack.delete(cellKey);
    }
  }

  private evaluateRange(
    startRaw: string,
    endRaw: string,
    currentSheet: string,
    context: EvalContext
  ): RangeValue {
    const start = parseRef(startRaw, currentSheet);
    const end = parseRef(endRaw, start.sheet);

    if (start.sheet !== end.sheet) {
      throw new UnsupportedFormulaError(
        "3D or cross-sheet ranges are not supported."
      );
    }

    const a = XLSX.utils.decode_cell(start.address);
    const b = XLSX.utils.decode_cell(end.address);
    const r0 = Math.min(a.r, b.r);
    const r1 = Math.max(a.r, b.r);
    const c0 = Math.min(a.c, b.c);
    const c1 = Math.max(a.c, b.c);

    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 5000) {
      throw new UnsupportedFormulaError(
        "Range is too large for ERXL's in-worker evaluator."
      );
    }

    const values: Primitive[][] = [];

    for (let r = r0; r <= r1; r++) {
      const row: Primitive[] = [];

      for (let c = c0; c <= c1; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const value = this.evaluateCell(
          start.sheet + "!" + address,
          context
        );

        if (isRange(value)) {
          throw new UnsupportedFormulaError(
            "Nested range values are not supported."
          );
        }

        row.push(value);
      }

      values.push(row);
    }

    return { kind: "range", values };
  }
}
