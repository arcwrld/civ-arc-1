# Hewn

Hewn is a data profiler: you give it a CSV, TSV, JSONL or JSON file and it tells you the ways the data is lying to whoever trusts it. The problems it looks for are the ones a spreadsheet hides from you — a column that holds both numbers and text, "NA" and "-" standing in for missing values, two different date layouts in one column, casing drift in what should be one category, a thousands separator that reads as a decimal point. To see it working, open `hewn.html` in any browser and drop a file on it; to run it, use `node tools/hewn/hewn.js <file>`. It is finished and tested — thirteen rules, one engine, a page and a command line tool that share that engine exactly, and `node kit/kit-check.js` passes for it. I wrote it in arc 1 of the Kit, and the name comes from the tool an adze uses to hew a log flat. It never changes your data; it shows you a suggested fix and you decide.

## How it works

One engine, `hewn.js`, does all of the thinking. It reads the file, sniffs the format and the delimiter, parses it into a table of rows and columns, and then walks the table once per rule. Each rule is a named, numbered check — HEWN001 through HEWN013 — and each one looks at one specific way data can mislead. A rule that fires produces a finding with a severity, the column it is about, a sentence explaining what is wrong, and the actual values as evidence, so you can see the defect rather than take the tool's word for it. The page and the command line call the same functions, so they cannot disagree about what is wrong with your data; a test in the suite fails if the copy of the engine inside `hewn.html` ever drifts from the one in `hewn.js`. Some findings come with a safe fix — trimming a stray space, normalising a category's spelling, blanking a placeholder, rewriting a European decimal as a plain number — and those fixes are never applied unless you ask for them. Nothing in Hewn writes to your file.

## Running it

Open `hewn.html` in a browser. It works from the file on your disk: no server, no install, no network call anywhere in it. Drop a file on the page or paste the data in, and it profiles it. There is a button that loads a small example of deliberately broken data, so you can see what it finds before you have any data of your own.

From a terminal:

    node tools/hewn/hewn.js data.csv
    node tools/hewn/hewn.js data.csv --markdown report.md
    node tools/hewn/hewn.js data.csv --json
    node tools/hewn/hewn.js data.csv --fix > fixed.csv
    node tools/hewn/hewn.js --help
    node tools/hewn/hewn.js --version

The exit code is 0 when nothing of error severity was found, 1 when it was, and 2 when the file could not be read or parsed — so it can sit in a check script. `--fix` prints the repaired data to standard output and leaves your file alone.

## The rules

| Rule | Severity | What it catches |
| --- | --- | --- |
| HEWN001 | error | a column holding both numbers and text |
| HEWN002 | warn | "NA", "-", "9999" and friends standing in for missing values |
| HEWN003 | warn | one date column with several date layouts, or day-first mixed with month-first |
| HEWN004 | warn | one category spelled several ways, so a group-by makes extra groups |
| HEWN005 | warn | values with leading or trailing spaces |
| HEWN006 | warn | a column where every row says the same thing |
| HEWN007 | error | two columns sharing a name |
| HEWN008 | error | a row with the wrong number of fields |
| HEWN009 | error | two decimal conventions in one column |
| HEWN010 | warn | a column with no values at all |
| HEWN011 | warn | identical rows repeated |
| HEWN012 | info | zeros dominating a numeric column |
| HEWN013 | error | a thousands separator that reads as a decimal point |

Every rule has a fixture file next to the test suite, one per rule, each broken in exactly that way, and the test suite asserts that every rule fires on its own fixture. A rule that never fires is a rule that lies, and the suite fails if one stops working.

## Limits

Hewn reads the shape of your data; it does not know what your data means. It cannot tell whether a date of 2024-03-01 is right, only that it is written in a different style from the date beside it, so it will not tell you which convention is correct — only that the two are mixed. It reports sentinels from a deliberately short list, and a short list means false negatives: a placeholder it has never heard of will pass through unnoticed, and `0` and `none` are treated as real values because they usually are. It parses delimited text, JSONL and a JSON array of objects; it does not read Excel files, SQL dumps, fixed-width files, or spreadsheets with more than one sheet, and it does not try to repair a broken file — it reports the file as unparseable and stops. On a very large file it will be slow and will use a lot of memory, because it keeps the whole table in memory to work out the column statistics; a million rows is already more than it enjoys. It does not check the data against a schema, a data dictionary, or a set of business rules, and it does not validate values against any range. The fixes it offers are conservative on purpose — it will not guess a date convention or choose a decimal standard for you. And it is a profiler, not an editor: the fixed output is a new file you take or leave.

## An example you can reproduce

Save this as `messy.csv`:

    name,amount,joined,status
    Alice,1.234,2024-01-05,OK
    Bob,2.345,05/02/2024,ok
    Carl,NA,2024-03-01,Ok
    Dee,5678,2024-04-01,OK

Then run:

    node tools/hewn/hewn.js messy.csv

Hewn will report four findings against four rows: `1.234` and `2.345` read as decimals when they are thousands separators (HEWN013, error — they are a thousand times too small if you take them at face value), `NA` is a placeholder rather than a value (HEWN002), the `joined` column mixes two date layouts (HEWN003), and `status` spells one category three ways, so a group-by would give you three groups where there is one (HEWN004).

If you want the repaired data on standard output without touching your file:

    node tools/hewn/hewn.js messy.csv --fix > fixed.csv

## The engine and the page

The engine lives in `hewn.js`, between the two marker comments `hewn-engine:begin` and `hewn-engine:end`. `hewn.html` carries a byte-identical copy of that block, so the page and the command line are provably the same rules. If you change the engine, re-sync the page with:

    node tools/hewn/hewn.js --sync-html

The test suite fails if you forget, and tells you the same command.

## Provenance

Hewn does not modify files and does not write sidecars. It reads what you give it and hands it back, and it never touches the network — there is no upload, no telemetry, and no external resource of any kind in either file.
