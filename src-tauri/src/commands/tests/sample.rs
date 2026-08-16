//! A synthetic vitest run, used by the tests in place of a captured file.
//!
//! It reproduces what the runner really writes - the `verbose` reporter's
//! coloured lines, then the JSON report on one line - because that combination
//! is what the parsers have to survive. It is written by hand rather than
//! captured so no absolute path from a developer's machine ends up in the
//! repository.
#![cfg(test)]

/// Colour codes exactly as vitest emits them around a mark.
const G: &str = "\u{1b}[32m";
const R: &str = "\u{1b}[31m";
const D: &str = "\u{1b}[2m";
const O: &str = "\u{1b}[39m";
const C: &str = "\u{1b}[22m";

/// The run this sample stands for: 2 files, 7 tests, plus one file that fails
/// to load. One test is slow, which is what makes streaming worth having.
pub const TOTAL_CASES: usize = 7;
pub const FAILING_CASES: usize = 2;
pub const TODO_CASES: usize = 1;

/// The worktree the run happened in, as the JSON report would spell it.
pub const ROOT: &str = "/w";

/// The streamed part, coloured, one line per finished test.
pub fn stream() -> String {
    [
        " \u{1b}[36mRUN\u{1b}[39m  v4.1.10 /w".to_string(),
        String::new(),
        format!("{G}\u{2713}{O} src/cart.test.js > subtotal > sums the lines {D}1ms{C}"),
        format!("{R}\u{00D7}{O} src/cart.test.js > subtotal > returns a breakdown {D}3ms{C}"),
        format!("{G}\u{2713}{O} src/cart.test.js > roundMoney > keeps two decimals {D}0ms{C}"),
        format!("{G}\u{2713}{O} src/cart.test.js > applyDiscount > takes a moment {D}20001ms{C}"),
        format!("\u{25A1} src/cart.test.js > roundMoney > handles negatives"),
        format!("{G}\u{2713}{O} src/totp.test.js > verifyToken > accepts a token {D}1ms{C}"),
        format!("{R}\u{00D7}{O} src/totp.test.js > verifyToken > rejects an old token {D}2ms{C}"),
        String::new(),
        "\u{23AF}\u{23AF} Failed Tests 2 \u{23AF}\u{23AF}".to_string(),
        " FAIL  src/cart.test.js > subtotal > returns a breakdown".to_string(),
        "AssertionError: expected 'EUR' to deeply equal 'USD'".to_string(),
    ]
    .join("\n")
}

/// The JSON report, as the run prints it at the very end, on a single line.
/// Its paths are absolute, which is exactly what the id normalisation has to
/// reconcile with the relative ones above.
pub fn report() -> String {
    let cart_cases = r#"[
        {"title":"sums the lines","ancestorTitles":["subtotal"],"status":"passed","duration":0.6259,"location":{"line":11,"column":2},"failureMessages":[]},
        {"title":"returns a breakdown","ancestorTitles":["subtotal"],"status":"failed","duration":3.148,"location":{"line":20,"column":3},"failureMessages":["AssertionError: expected 'EUR' to deeply equal 'USD'\n\nExpected: \"USD\"\nReceived: \"EUR\"\n    at /w/node_modules/@vitest/runner/dist/chunk.js:302:11\n    at /w/src/cart.test.js:20:55"]},
        {"title":"keeps two decimals","ancestorTitles":["roundMoney"],"status":"passed","duration":0.09,"failureMessages":[]},
        {"title":"takes a moment","ancestorTitles":["applyDiscount"],"status":"passed","duration":20001.72,"failureMessages":[]},
        {"title":"handles negatives","ancestorTitles":["roundMoney"],"status":"todo","failureMessages":[]}
    ]"#;
    let totp_cases = r#"[
        {"title":"accepts a token","ancestorTitles":["verifyToken"],"status":"passed","duration":1.1,"failureMessages":[]},
        {"title":"rejects an old token","ancestorTitles":["verifyToken"],"status":"failed","duration":2.3,"location":{"line":39,"column":4},"failureMessages":["AssertionError: expected true to be false\n\nExpected: false\nReceived: true\n    at /w/src/totp.test.js:39:46"]}
    ]"#;

    format!(
        r#"{{"numTotalTests":7,"testResults":[
        {{"name":"/w/src/broken.test.js","assertionResults":[],"status":"failed","message":"Cannot find module './missing.js' imported from /w/src/broken.test.js"}},
        {{"name":"/w/src/cart.test.js","assertionResults":{cart_cases},"status":"failed","message":""}},
        {{"name":"/w/src/totp.test.js","assertionResults":{totp_cases},"status":"failed","message":""}}
        ]}}"#
    )
    .replace('\n', "")
}

/// Stream and report together, as a whole run reaches the parser.
pub fn whole_run() -> String {
    format!("{}\n{}", stream(), report())
}
