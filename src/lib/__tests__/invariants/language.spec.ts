import { describe, expect, it } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { walkAll, read } from "./helpers";

describe("the menu editor's failures are said in the owner's language", () => {
  it("names every failed write by a message that exists in Spanish and English", () => {
    // Reordering extras passed "reorder extras" where every other write passes
    // a key, so a failed reorder toasted that raw English phrase to a Spanish
    // owner. Every key a write in the editor reports must be a real one.
    const src = ["useMenuEditor.ts", "menu-editor/menus.ts", "menu-editor/products.ts", "menu-editor/addons.ts"]
      .map(f => read(`src/hooks/${f}`))
      .join("\n");
    const keys = [...src.matchAll(/\b(?:run|move|insertReturningId|reportError)\(\s*"([^"]+)"/g)].map(m => m[1]);
    expect(keys.length, "found no reported write in the editor — has it moved?").toBeGreaterThan(15);
    const missing = keys.filter(k => {
      const [group, name] = k.split(".");
      if (group !== "write" || !name) return true;
      return [en, es].some(m => typeof (m as unknown as Record<string, Record<string, unknown>>).write?.[name] !== "string");
    });
    expect(missing, "a write reports a message that is not in both languages").toEqual([]);
  });
});

describe("what a person is told goes through the dictionaries", () => {
  /** Every .ts/.tsx under src that ships to a browser. */
  const clientFiles = (): string[] =>
    walkAll("src").filter(
      f => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("/i18n/"),
    );

  const parse = (file: string) =>
    ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

  it("shows no toast written in one fixed language", () => {
    // Two of these sat in the staff screens: an owner reading the dashboard in
    // Spanish changed somebody's role and was told "Role updated". The API
    // errors were fixed the same week and these were missed, because nothing
    // looked anywhere but the routes.
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      const sf = parse(file);
      const visit = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          ["toast", "alert"].includes(n.expression.text) &&
          n.arguments.length > 0
        ) {
          const arg = n.arguments[0];
          const written =
            ts.isStringLiteral(arg) ||
            (ts.isTemplateExpression(arg) && !arg.getText().includes("t("));
          if (written && /[A-Za-z]{3}/.test(arg.getText())) {
            const line = sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
            offenders.push(`${file}:${line}  ${arg.getText().slice(0, 50)}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(
      offenders,
      `a toast in one fixed language — hand it a key instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("lets no browser request fail in silence", () => {
    // A fetch with nothing catching it does nothing at all when the connection
    // is gone. That is how a status change was thrown away, how signing up
    // spun for ever on a dead network, and how a diner could tap "pay my
    // share" and watch nothing happen — twice, opening two Stripe sessions.
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("fetch(")) continue;
      // A server component's failure is a 500, which is loud already.
      if (!text.startsWith('"use client"') && !file.includes("/hooks/")) continue;

      const sf = parse(file);
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && n.expression.getText() === "fetch") {
          let p: ts.Node | undefined = n.parent;
          let guarded = false;
          while (p) {
            if (ts.isTryStatement(p)) {
              guarded = true;
              break;
            }
            // Or a .catch() chained onto the promise this fetch starts.
            if (ts.isExpressionStatement(p) && /\.catch\s*\(/.test(p.getText())) {
              guarded = true;
              break;
            }
            p = p.parent;
          }
          if (!guarded) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            offenders.push(`${file}:${line}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(
      offenders,
      `a browser request with nothing catching it — wrap it, or chain a .catch():\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("an API error reaches the person in their own language", () => {
  /**
   * `apiError` looks the sentence up in the caller's locale; a sentence written
   * straight into the response does not. 237 errors went through it and 7 did
   * not, so a Spanish owner who typed a coupon code twice was told "That code
   * already exists." and a diner under the card minimum got English mid-payment
   * — and one invite failure answered every English speaker in Spanish.
   */
  /**
   * The same rule, for the errors that are not written as sentences.
   *
   * The check below reads string literals, so six routes handed the client a
   * raw `error.message` from Postgres and it saw nothing: not a literal, so not
   * a sentence. What actually reached the person was a database's own words —
   * the column, the constraint, sometimes the value that broke it — always in
   * English, and describing the schema to whoever asked.
   */
  it("hands nobody a database's own error text", () => {
    const offenders: string[] = [];
    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      read(file).split("\n").forEach((line, i) => {
        if (/NextResponse\.json\(\s*\{[^}]*\b(error|message)\s*:[^}]*\.message\b/.test(line)) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      `these return a raw database message — log it and answer with an apiError key:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("has no route answering with a sentence of its own", () => {
    // Stripe reads the webhook's errors, not a person, so it keeps English.
    // Cron also answers a machine and logs job names, never customer copy.
    const forMachines = ["src/app/api/webhooks/", "src/app/api/cron/"];
    const offenders: string[] = [];

    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      if (forMachines.some(m => file.startsWith(m))) continue;
      const code = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
        .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_m, before: string) => before);

      code.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/"([^"]{15,})"/g)) {
          // A sentence starts with a capital and has a space in it; a key, a
          // header name and a column name have neither.
          if (!/^[A-ZÁÉÍÓÚÑ¿].*\s/.test(m[1])) continue;
          offenders.push(`${file}:${i + 1}  ${m[1].slice(0, 60)}`);
        }
      });
    }

    expect(
      offenders,
      `these answer in one fixed language — hand the key to apiError() instead and\nadd the sentence to both i18n/es.ts and i18n/en.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("every key a person is shown has words behind it", () => {
  it("resolves every i18n key written as a literal", () => {
    // `translate` takes `key: string`, so TypeScript never sees these. A miss
    // returns the key itself — deliberately, so a gap shows rather than
    // crashing — which means a typo reaches a customer as the text
    // "apiErr.tooManyLines" and nothing in the build says a word.
    //
    // The nested SHAPE of the two dictionaries is type-checked (es.ts is typed
    // as Messages, so a missing or extra key is a compile error). What is not
    // checked is whether the string somebody passes matches any of it.
    const resolve = (key: string): unknown =>
      key.split(".").reduce<unknown>(
        (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
        en as unknown,
      );

    const missing: string[] = [];
    const files = walkAll("src").filter(
      f => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("/i18n/"),
    );
    for (const file of files) {
      const src = read(file);
      const patterns = [
        /\bt\(\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
        /translate\(\s*\w+\s*,\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
        /apiError\(\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
        // Keys that travel as data rather than as an argument — the timezone
        // list hands one to the settings dropdown for every zone it offers.
        /labelKey:\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
      ];
      for (const pattern of patterns) {
        for (const m of src.matchAll(pattern)) {
          if (typeof resolve(m[1]) !== "string") missing.push(`${file}: ${m[1]}`);
        }
      }
    }
    expect(
      missing,
      `These keys have no words behind them, so a person reads the key:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a date reads in the reader's language, not the machine's", () => {
  it("never formats a date with the server's default locale", () => {
    // `new Intl.DateTimeFormat([])` and a bare `toLocaleDateString()` answer in
    // whatever language the machine was set to — English on the host — so a
    // Spanish owner's analytics said "25 Tue". Prices were fixed the same way.
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))) {
      const src = read(file);
      if (/Intl\.DateTimeFormat\(\s*\[\s*\]/.test(src) || /toLocale(Date)?String\(\s*\)/.test(src)) offenders.push(file);
    }
    expect(offenders, `dates in the machine's language:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a date on screen is in the app's language", () => {
  it("never formats a date or a time in the browser's own language", () => {
    // `toLocaleString([])` answers in whatever language the browser is set to,
    // so a Spanish owner on an English phone read "Sep 23" beside Spanish
    // words — and the server, rendering the same component, could write it in
    // a third. `dateLocale(locale)` is the app's language, which both read.
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))) {
      // Code only: the comment that explains the rule quotes what it forbids.
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/toLocale(Time|Date)?String\(\s*(\[\]|undefined)/.test(code)) offenders.push(file);
    }
    expect(offenders, `dates in the browser's language:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("never names a day or a month in a language picked in the code", () => {
    // `DateTimeFormat("es-MX", { weekday, month })` wrote the corte's day in
    // Spanish above an English page. A format with words takes the app's
    // language; a hard-coded one is only for figures (the kitchen ticket's
    // time) or for taking a date apart (`en-US`/`en-CA` in day-window).
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const m of code.matchAll(/DateTimeFormat\(\s*["'][a-z]{2}(?:-[A-Z]{2})?["']\s*,\s*\{([^}]*)\}/g)) {
        // `formatToParts` takes the date apart to compute with it; nothing it
        // produces is shown, so its language is the code's to choose.
        const after = code.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24);
        if (/^\s*\)\s*\.formatToParts\(/.test(after)) continue;
        if (/\b(weekday|month|era|dayPeriod)\s*:\s*["'](long|short|narrow)["']/.test(m[1])) offenders.push(file);
      }
    }
    expect(offenders, `a day or month in a fixed language:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a message on screen is in the reader's language", () => {
  it("never builds a notice, toast or error out of literal words", () => {
    // When an extra sold out at checkout the diner was told, in English on a
    // Spanish menu, "Guacamole is no longer available, so we removed it from
    // your order" — a template literal passed straight to setNotice. The key
    // check only proves keys resolve, and the English-code check only looks
    // for Spanish in code; English words on screen passed both. Every message
    // goes through t() now; the only words allowed outside it are none.
    const SETTERS = /\b(setNotice|toast|setError|setProblem|setMessage)\(/g;
    const WORDS = /[A-Za-zÁÉÍÓÚáéíóúñÑ]{3,}\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/;
    const offenders: string[] = [];
    const files = walkAll("src").filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("/i18n/"));
    for (const file of files) {
      const src = read(file);
      for (const m of src.matchAll(SETTERS)) {
        let i = (m.index ?? 0) + m[0].length;
        let depth = 1;
        const start = i;
        while (i < src.length && depth) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") depth--;
          i++;
        }
        const arg = src.slice(start, i - 1).replace(/\bt\((?:[^()]|\([^()]*\))*\)/g, "T");
        for (const lit of arg.matchAll(/"([^"\n]*)"|`([^`]*)`|'([^'\n]*)'/g)) {
          const text = (lit[1] ?? lit[2] ?? lit[3] ?? "").replace(/\$\{[^}]*\}/g, "");
          if (WORDS.test(text)) offenders.push(`${file}: ${m[1]}(… "${text.slice(0, 50)}" …)`);
        }
      }
    }
    expect(files.length, "no source found — the scan broke").toBeGreaterThan(50);
    expect(offenders, `words on screen that no translation reaches:\n${offenders.join("\n")}`).toEqual([]);
  });
});
