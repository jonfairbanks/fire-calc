const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];

assert.ok(script, "expected an inline calculator script in index.html");

function element() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    value: "",
    checked: false,
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.({ currentTarget: this, ...event });
    },
    focus() {},
    blur() {}
  };
}

function makeSessionStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    valueFor(key) {
      return values.get(key) ?? null;
    }
  };
}

function makeCalculator(hash = "", sessionStorage = makeSessionStorage()) {
  const elements = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    }
  };
  const window = {
    location: { hash },
    sessionStorage,
    addEventListener() {}
  };
  const context = vm.createContext({
    document,
    window,
    atob: (value) => Buffer.from(value, "base64").toString("utf8"),
    console
  });
  const startupMarker = "    Object.keys(DEFAULT_INPUTS)\n      .filter";
  const startupIndex = script.indexOf(startupMarker);
  assert.notEqual(startupIndex, -1, "calculator startup marker moved; update the test harness");
  vm.runInContext(script.slice(0, startupIndex), context, { filename: "index.html" });

  return {
    context,
    document,
    sessionStorage,
    run: (expression) => vm.runInContext(expression, context)
  };
}

function encodedHash(value) {
  return `#inputs=${encodeURIComponent(Buffer.from(JSON.stringify(value)).toString("base64"))}`;
}

function milestone(calculator, type, input = "DEFAULT_INPUTS") {
  calculator.run(`result = calculate(${input})`);
  return calculator.run(`result.milestones.find((item) => item.type === ${JSON.stringify(type)})`);
}

function approximately(actual, expected, tolerance = 1) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function referencePortfolio(input, year) {
  let portfolio = input.currentInvestments;
  for (let elapsed = 0; elapsed < year * 12; elapsed += 1) {
    portfolio = portfolio * Math.pow(1 + input.portfolioGrowthRate, 1 / 12) + input.monthlyInvesting;
  }
  return portfolio;
}

function referenceNetSpending(input, year) {
  const spendingGrowth = (1 + input.inflationRate) * (1 + input.spendingGrowthRate);
  const spending = input.annualSpending * Math.pow(spendingGrowth, year);
  const socialSecurity = input.socialSecurityEnabled && input.currentAge + year >= input.socialSecurityAge
    ? input.socialSecurityIncome * Math.pow(1 + input.inflationRate, year)
    : 0;
  return Math.max(0, spending - socialSecurity);
}

function referenceCrossoverYear(input, multiplier) {
  for (let year = 0; year <= 60; year += 1) {
    if (referencePortfolio(input, year) >= referenceNetSpending(input, year) * multiplier) return year;
  }
  return null;
}

function referenceBaristaYear(input) {
  for (let year = 0; year <= 60; year += 1) {
    const income = input.baristaIncome * Math.pow(1 + input.inflationRate, year);
    const gap = Math.max(0, referenceNetSpending(input, year) - income);
    if (referencePortfolio(input, year) >= gap * 25) return year;
  }
  return null;
}

function referenceCoastYear(input, targetAge) {
  if (input.currentAge > targetAge) return null;
  for (let year = 0; year <= 60; year += 1) {
    const age = input.currentAge + year;
    if (age >= targetAge) {
      return referencePortfolio(input, year) >= referenceNetSpending(input, year) * 25 ? year : null;
    }
    const yearsToTarget = targetAge - age;
    const portfolioAtTarget = referencePortfolio(input, year) * Math.pow(1 + input.portfolioGrowthRate, yearsToTarget);
    const target = referenceNetSpending(input, year + yearsToTarget) * 25;
    if (portfolioAtTarget >= target) return year;
  }
  return null;
}

test("portfolio accumulation follows independent month-end deposits", () => {
  const calculator = makeCalculator();
  const scenarios = [
    { portfolioGrowthRate: -0.1, monthlyInvesting: 0 },
    { portfolioGrowthRate: 0, monthlyInvesting: 1_000 },
    { portfolioGrowthRate: 0.07, monthlyInvesting: 3_500 }
  ];

  for (const scenario of scenarios) {
    const input = calculator.run(`({ ...DEFAULT_INPUTS, ${Object.entries(scenario)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")} })`);
    for (let year = 0; year <= 60; year += 1) {
      calculator.context.input = input;
      const expected = referencePortfolio(input, year);
      approximately(calculator.run(`portfolioAtYear(input, ${year})`), expected, Math.max(1e-6, expected * 1e-12));
    }
  }
});

test("zero, -100%, and tiny positive returns stay mathematically stable", () => {
  const calculator = makeCalculator();

  calculator.context.input = {
    currentInvestments: 225_000,
    monthlyInvesting: 3_500,
    portfolioGrowthRate: 0,
    annualSpending: 70_000,
    spendingGrowthRate: 0,
    inflationRate: 0,
    baristaIncome: 35_000,
    socialSecurityEnabled: false,
    socialSecurityAge: 67,
    socialSecurityIncome: 20_000
  };
  assert.equal(calculator.run("portfolioAtYear(input, 12)"), 729_000);

  calculator.context.input = { ...calculator.context.input, currentInvestments: 100, portfolioGrowthRate: -1 };
  assert.equal(calculator.run("portfolioAtYear(input, 0)"), 100);
  assert.equal(calculator.run("portfolioAtYear(input, 1)"), 3_500);
  assert.equal(calculator.run("portfolioAtYear(input, 12)"), 3_500);
  assert.equal(calculator.run("findCrossoverYear(input, 25)"), null);
  assert.equal(calculator.run("findCoastFireYear(input, 55)"), null);

  calculator.context.input = {
    ...calculator.context.input,
    currentInvestments: 225_000,
    portfolioGrowthRate: 1e-12
  };
  approximately(
    calculator.run("portfolioAtYear(input, 60)"),
    referencePortfolio(calculator.context.input, 60),
    1e-3
  );
});

test("Coast FIRE at 55 with 7% returns reports the stopping threshold and retirement target", () => {
  const calculator = makeCalculator();
  const scenario = "({ ...DEFAULT_INPUTS, portfolioGrowthRate: 0.07 })";
  const coast55 = milestone(calculator, "coast55", scenario);

  const input = calculator.run(scenario);
  const expectedYear = referenceCoastYear(input, 55);
  assert.equal(coast55.age, input.currentAge + expectedYear);
  assert.equal(coast55.yearsAway, expectedYear);
  assert.equal(coast55.retirementAge, 55);
  assert.equal(coast55.targetNumber, coast55.coastTargetNumber);
  approximately(coast55.coastTargetNumber, referenceNetSpending(input, 25) * 25 / Math.pow(1.07, 25 - expectedYear));
  approximately(coast55.retirementTargetNumber, 3_664_111);
  approximately(coast55.projectedPortfolio, referencePortfolio(input, expectedYear));
  assert.ok(coast55.projectedPortfolio >= coast55.coastTargetNumber);
});

test("Coast FIRE is not applicable once its retirement age has passed", () => {
  const calculator = makeCalculator();
  calculator.run("result = calculate({ ...DEFAULT_INPUTS, currentAge: 70 })");

  for (const type of ["coast55", "coast65"]) {
    const coast = calculator.run(`result.milestones.find((item) => item.type === ${JSON.stringify(type)})`);
    assert.equal(coast.status, "notApplicable");
  }
});

test("percentage formatting preserves fractional values and focus keeps the stored rate", () => {
  const calculator = makeCalculator();

  calculator.run("setInputText('inflationRate', 0.025)");
  calculator.run("setInputText('spendingGrowthRate', 0.004)");
  assert.equal(calculator.document.getElementById("inflationRate").value, "2.5");
  assert.equal(calculator.document.getElementById("spendingGrowthRate").value, "0.4");

  calculator.run("inputs.inflationRate = 0.025; bindTextField('inflationRate')");
  calculator.document.getElementById("inflationRate").dispatch("focus");
  assert.equal(calculator.document.getElementById("inflationRate").value, "2.5");
  assert.equal(calculator.run("inputs.inflationRate"), 0.025);

  calculator.run("render = () => renderInputErrors()");
  calculator.document.getElementById("inflationRate").dispatch("blur");
  assert.equal(calculator.run("inputs.inflationRate"), 0.025);
  assert.equal(calculator.run("inputErrors.inflationRate"), undefined);
});

test("Social Security starts at the selected age and only affects enabled scenarios", () => {
  const calculator = makeCalculator();
  const input = {
    currentAge: 66,
    currentInvestments: 225_000,
    annualSpending: 70_000,
    spendingGrowthRate: 0,
    monthlyInvesting: 3_500,
    portfolioGrowthRate: 0.07,
    inflationRate: 0.03,
    baristaIncome: 35_000,
    socialSecurityEnabled: true,
    socialSecurityAge: 67,
    socialSecurityIncome: 20_000
  };
  calculator.context.input = input;

  assert.equal(calculator.run("netSpendingAtYear(input, 0)"), 70_000);
  assert.equal(calculator.run("netSpendingAtYear(input, 1)"), 51_500);
  calculator.context.withoutSocialSecurity = { ...input, socialSecurityEnabled: false };
  assert.equal(calculator.run("netSpendingAtYear(withoutSocialSecurity, 1)"), 72_100);
  assert.ok(
    calculator.run("findCrossoverYear(input, 25)")
      <= calculator.run("findCrossoverYear(withoutSocialSecurity, 25)")
  );
});

test("Full, Barista, and Coast milestone searches agree with independent yearly calculations", () => {
  const calculator = makeCalculator();
  const inputs = [
    calculator.run("({ ...DEFAULT_INPUTS })"),
    calculator.run("({ ...DEFAULT_INPUTS, portfolioGrowthRate: 0, inflationRate: 0, spendingGrowthRate: 0 })"),
    calculator.run("({ ...DEFAULT_INPUTS, socialSecurityEnabled: true, currentAge: 64, socialSecurityAge: 67, inflationRate: 0.03 })")
  ];

  for (const input of inputs) {
    calculator.context.input = input;
    assert.equal(calculator.run("findCrossoverYear(input, 25)"), referenceCrossoverYear(input, 25));
    assert.equal(calculator.run("findBaristaFireYear(input)"), referenceBaristaYear(input));
    assert.equal(calculator.run("findCoastFireYear(input, 55)"), referenceCoastYear(input, 55));
    assert.equal(calculator.run("findCoastFireYear(input, 65)"), referenceCoastYear(input, 65));
  }
});

test("parsing and validation reject malformed values while accepting the supported ranges", () => {
  const calculator = makeCalculator();
  const parse = (id, raw) => calculator.run(`parseInputValue(${JSON.stringify(id)}, ${JSON.stringify(raw)})`);
  const validate = (id, value) => calculator.run(`validateInputValue(${JSON.stringify(id)}, ${JSON.stringify(value)})`);

  assert.equal(parse("annualSpending", "1,234,567.89"), 1_234_567.89);
  assert.equal(parse("annualSpending", "1e3"), 1_000);
  assert.equal(parse("portfolioGrowthRate", "2.5e0"), 0.025);
  assert.ok(Number.isNaN(parse("annualSpending", "12,34")));
  assert.ok(Number.isNaN(parse("annualSpending", "70000dollars")));
  assert.ok(Number.isNaN(parse("inflationRate", "2,5")));

  for (const [id, value] of [
    ["currentAge", 0],
    ["currentAge", 120],
    ["socialSecurityAge", 62],
    ["socialSecurityAge", 70],
    ["annualSpending", 0],
    ["annualSpending", 1e12],
    ["portfolioGrowthRate", -1],
    ["portfolioGrowthRate", 1],
    ["inflationRate", -0.999999],
    ["inflationRate", 1],
    ["spendingGrowthRate", -0.999999],
    ["spendingGrowthRate", 1]
  ]) {
    assert.equal(validate(id, value), null, `${id} should accept ${value}`);
  }

  for (const [id, value] of [
    ["currentAge", -1],
    ["currentAge", 30.5],
    ["currentAge", 121],
    ["socialSecurityAge", 61],
    ["socialSecurityAge", 70.1],
    ["annualSpending", -1],
    ["annualSpending", 1e12 + 1],
    ["portfolioGrowthRate", -1.000001],
    ["portfolioGrowthRate", 1.000001],
    ["inflationRate", -1],
    ["inflationRate", 1.000001],
    ["spendingGrowthRate", -1],
    ["spendingGrowthRate", 1.000001]
  ]) {
    const message = validate(id, value);
    assert.equal(typeof message, "string", `${id} should reject ${value}`);
    assert.notEqual(message, "");
  }
});

test("invalid text retains the last valid input and displays an error", () => {
  const calculator = makeCalculator();
  const spending = calculator.document.getElementById("annualSpending");
  spending.value = "not a number";
  calculator.run("render = () => renderInputErrors()");
  calculator.run("commitTextField('annualSpending')");

  assert.equal(calculator.run("inputs.annualSpending"), 70_000);
  assert.equal(spending.getAttribute("aria-invalid"), "true");
  assert.match(calculator.document.getElementById("annualSpendingError").textContent, /.+/);
  assert.match(calculator.document.getElementById("inputNotice").textContent, /.+/);
  assert.equal(calculator.run("typeof inputErrors.annualSpending"), "string");
});

test("hash input uses the same validation and ignores unknown fields", () => {
  const calculator = makeCalculator(encodedHash({
    currentAge: 44,
    portfolioGrowthRate: 0.06,
    annualSpending: -1,
    unknownFutureField: 123
  }));

  assert.equal(calculator.run("inputs.currentAge"), 44);
  assert.equal(calculator.run("inputs.portfolioGrowthRate"), 0.06);
  assert.equal(calculator.run("inputs.annualSpending"), 70_000);
  assert.equal(calculator.run("Object.hasOwn(inputs, 'unknownFutureField')"), false);
  assert.equal(calculator.run("Object.keys(inputErrors).length"), 0);
  assert.match(calculator.run("inputLoadWarning"), /default values/i);
});

test("malformed and wrongly typed shared inputs keep defaults and show a warning", () => {
  const malformed = makeCalculator("#inputs=this-is-not-base64");
  assert.equal(malformed.run("inputs.currentAge"), 30);
  assert.match(malformed.run("inputLoadWarning"), /could not be read/i);

  const invalidTypes = makeCalculator(encodedHash({
    currentAge: null,
    monthlyInvesting: "3500",
    socialSecurityEnabled: "true",
    socialSecurityAge: 61,
    portfolioGrowthRate: "0.06"
  }));
  assert.equal(invalidTypes.run("inputs.currentAge"), 30);
  assert.equal(invalidTypes.run("inputs.monthlyInvesting"), 3_500);
  assert.equal(invalidTypes.run("inputs.socialSecurityEnabled"), false);
  assert.equal(invalidTypes.run("inputs.socialSecurityAge"), 67);
  assert.equal(invalidTypes.run("inputs.portfolioGrowthRate"), 0.06);
  assert.equal(invalidTypes.run("Object.keys(inputErrors).length"), 0);
  assert.match(invalidTypes.run("inputLoadWarning"), /default values/i);
});

test("tab drafts restore valid input changes while a new shared link takes precedence", () => {
  const storage = makeSessionStorage();
  const firstVisit = makeCalculator("", storage);
  firstVisit.run("inputs.currentAge = 42; inputs.monthlyInvesting = 4800; savePlanDraft()");

  const refreshed = makeCalculator("", storage);
  assert.equal(refreshed.run("inputs.currentAge"), 42);
  assert.equal(refreshed.run("inputs.monthlyInvesting"), 4_800);

  const shared = makeCalculator(encodedHash({ currentAge: 51, monthlyInvesting: 1200 }), storage);
  assert.equal(shared.run("inputs.currentAge"), 51);
  assert.equal(shared.run("inputs.monthlyInvesting"), 1_200);
});

test("shared-input warnings remain visible after a same-link refresh", () => {
  const storage = makeSessionStorage();
  const hash = encodedHash({ currentAge: 44, annualSpending: -1 });
  const firstVisit = makeCalculator(hash, storage);
  const warning = firstVisit.run("inputLoadWarning");
  assert.match(warning, /default values/i);
  firstVisit.run("savePlanDraft()");

  const refreshed = makeCalculator(hash, storage);
  assert.equal(refreshed.run("inputs.currentAge"), 44);
  assert.equal(refreshed.run("inputs.annualSpending"), 70_000);
  assert.equal(refreshed.run("inputLoadWarning"), warning);
});

test("corrupt or denied tab storage leaves the calculator usable", () => {
  const corruptStorage = makeSessionStorage({ "fire-calc-tab-plan-v1": "{not json" });
  const corrupt = makeCalculator("", corruptStorage);
  assert.equal(corrupt.run("inputs.currentAge"), 30);
  assert.equal(corrupt.run("draftStorageAvailable"), false);
  corrupt.run("savePlanDraft()");
  assert.equal(corrupt.run("draftStorageAvailable"), true);

  const deniedStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }
  };
  const denied = makeCalculator("", deniedStorage);
  assert.equal(denied.run("inputs.currentAge"), 30);
  assert.doesNotThrow(() => denied.run("savePlanDraft()"));
  assert.equal(denied.run("draftStorageAvailable"), false);
  assert.match(denied.document.getElementById("planStatus").textContent, /unavailable/i);
});

test("currency and axis labels stay compact and readable at large values", () => {
  const calculator = makeCalculator();
  assert.equal(calculator.run("fmt(1250000)"), "$1.25M");
  assert.equal(calculator.run("fmt(12500000000)"), "$12.50B");
  assert.equal(calculator.run("formatAxisValue(250000)"), "$250k");
  assert.equal(calculator.run("formatAxisValue(2500000)"), "$2.5M");
  assert.equal(calculator.run("formatAxisValue(12500000000)"), "$12.5B");
  assert.equal(calculator.run("fmt(1000000000000)"), "$1.00T");
  assert.equal(calculator.run("formatAxisValue(5000000000000)"), "$5T");
  assert.equal(calculator.run("formatAxisValue(2.5e30)"), "$2.5e+30");
});

test("loading shared values refreshes a focused field without stale displayed values", () => {
  const calculator = makeCalculator();
  const field = calculator.document.getElementById("spendingGrowthRate");
  calculator.document.activeElement = field;
  field.value = "0";
  calculator.run("inputs.spendingGrowthRate = 0.004; syncControls(true)");
  assert.equal(field.value, "0.4");
});

test("monthly deposits earn returns before the year ends without changing the annual return", () => {
  const calculator = makeCalculator();
  calculator.context.annualReturn = Math.pow(1.01, 12) - 1;
  approximately(calculator.run("portfolioAtYear({ ...DEFAULT_INPUTS, currentInvestments: 0, monthlyInvesting: 1000, portfolioGrowthRate: annualReturn }, 1)"), 12_682.503013197, 1e-6);
  approximately(calculator.run("portfolioAtYear({ ...DEFAULT_INPUTS, currentInvestments: 1000, monthlyInvesting: 0, portfolioGrowthRate: annualReturn }, 1)"), 1_126.825030132, 1e-6);
});

test("legacy annual contribution links convert safely and explicit monthly values take precedence", () => {
  const legacy = makeCalculator(encodedHash({ annualInvesting: 24_000 }));
  assert.equal(legacy.run("inputs.monthlyInvesting"), 2_000);
  assert.equal(legacy.run("Object.hasOwn(inputs, 'annualInvesting')"), false);
  assert.equal(legacy.run("inputLoadWarning"), "");

  for (const invalid of [-1, "24000", null, 1e13]) {
    const calculator = makeCalculator(encodedHash({ annualInvesting: invalid }));
    assert.equal(calculator.run("inputs.monthlyInvesting"), 3_500);
    assert.match(calculator.run("inputLoadWarning"), /default values/i);
  }
  const both = makeCalculator(encodedHash({ monthlyInvesting: 0, annualInvesting: 24_000 }));
  assert.equal(both.run("inputs.monthlyInvesting"), 0);
  const invalidMonthly = makeCalculator(encodedHash({ monthlyInvesting: -1, annualInvesting: 24_000 }));
  assert.equal(invalidMonthly.run("inputs.monthlyInvesting"), 3_500);
  assert.match(invalidMonthly.run("inputLoadWarning"), /default values/i);
});

test("missed Coast FIRE shows the retirement-age shortfall with continued contributions", () => {
  const calculator = makeCalculator();
  const input = "({ ...DEFAULT_INPUTS, currentAge: 37, currentInvestments: 555000 })";
  const coast55 = milestone(calculator, "coast55", input);
  assert.equal(coast55.status, "unreachable");
  assert.equal(coast55.shortfall.age, 55);
  assert.equal(coast55.shortfall.yearsAway, 18);
  approximately(coast55.shortfall.projectedPortfolio, 2_917_516.1371074775, 1e-6);
  approximately(coast55.shortfall.targetNumber, 2_979_257.857169833, 1e-6);
  approximately(coast55.shortfall.difference, -61_741.72006235551, 1e-6);
  calculator.context.sample = coast55;
  assert.equal(calculator.run("formatShortfall(sample.shortfall.difference)"), "−$61,742");
  assert.match(calculator.run("milestoneMarkup(sample)"), /−\$61,742/);
  calculator.run("renderDetail(sample)");
  const detail = calculator.document.getElementById("detail").innerHTML;
  assert.match(detail, /\$2,979,258/);
  assert.match(detail, /\$2,917,516/);
  assert.match(detail, /−\$61,742/);
  assert.match(detail, /keep contributing \$3,500\/month/);
  assert.match(detail, /All amounts are in future dollars/);
});

test("other missed targets compare against the end of the 60-year search", () => {
  const calculator = makeCalculator();
  const scenario = "({ ...DEFAULT_INPUTS, currentAge: 37, currentInvestments: 100, monthlyInvesting: 0, annualSpending: 100, baristaIncome: 40, inflationRate: 0, portfolioGrowthRate: 0 })";
  for (const [type, expectedTarget] of [["barista", 1500], ["full", 2500], ["chubby", 3300], ["fat", 5000]]) {
    const target = milestone(calculator, type, scenario);
    assert.equal(target.shortfall.age, 97);
    assert.equal(target.shortfall.yearsAway, 60);
    assert.equal(target.shortfall.targetNumber, expectedTarget);
    assert.equal(target.shortfall.projectedPortfolio, 100);
    assert.equal(target.shortfall.difference, 100 - expectedTarget);
    calculator.context.sample = target;
    assert.match(calculator.run("milestoneMarkup(sample)"), /Shortfall After 60 Years/);
    calculator.run("renderDetail(sample)");
    assert.match(calculator.document.getElementById("detail").innerHTML, /end of the 60-year search/);
  }
});

test("reached and inapplicable targets never show shortfalls", () => {
  const calculator = makeCalculator();
  const reached = milestone(calculator, "coast55", "({ ...DEFAULT_INPUTS, currentAge: 37, currentInvestments: 555000, portfolioGrowthRate: 0.07 })");
  assert.equal(reached.status, "reached");
  assert.equal(reached.shortfall, null);
  const past = milestone(calculator, "coast55", "({ ...DEFAULT_INPUTS, currentAge: 70 })");
  assert.equal(past.status, "notApplicable");
  assert.equal(past.shortfall, null);
  calculator.context.sample = past;
  assert.doesNotMatch(calculator.run("milestoneMarkup(sample)"), /Shortfall/);
  assert.equal(calculator.run("buildShortfall({ ...DEFAULT_INPUTS, currentInvestments: 100 }, 0, 100)"), null);
  assert.equal(calculator.run("formatShortfall(-0.2)"), "Less than $1");
});

test("Coast and retirement in the same year are labeled without a separate coast period", () => {
  const calculator = makeCalculator();
  const coast = milestone(calculator, "coast55", "({ ...DEFAULT_INPUTS, currentAge: 37, currentInvestments: 585000 })");
  const full = milestone(calculator, "full", "({ ...DEFAULT_INPUTS, currentAge: 37, currentInvestments: 585000 })");
  assert.equal(coast.age, 55);
  assert.equal(coast.year, full.year);
  assert.equal(coast.coastingYears, 0);
  assert.equal(coast.targetNumber, coast.retirementTargetNumber);
  assert.match(coast.description, /Retirement target reached at 55/);
  assert.match(coast.formula, /Continue contributing \$3,500\/month through age 55/);
  assert.match(coast.formula, /Milestones are checked yearly/);
  calculator.context.sample = coast;
  const card = calculator.run("milestoneMarkup(sample)");
  assert.match(card, /No separate coasting period projected/);
  assert.doesNotMatch(card, /can coast/);
  calculator.run("renderDetail(sample)");
  const detail = calculator.document.getElementById("detail").innerHTML;
  assert.match(detail, /Retirement Target Year/);
  assert.doesNotMatch(detail, /can coast|Contribution Stop Year|Cover living costs/);
  assert.equal((detail.match(/Retirement Target at Age 55/g) || []).length, 1);
});

test("retirement-age current balances and actual coast periods remain distinct", () => {
  const calculator = makeCalculator();
  for (const age of [55, 65]) {
    const now = milestone(calculator, `coast${age}`, `({ ...DEFAULT_INPUTS, currentAge: ${age}, currentInvestments: 2000000 })`);
    assert.equal(now.yearsAway, 0);
    assert.equal(now.coastingYears, 0);
    assert.match(now.formula, /Your current portfolio/);
    calculator.context.sample = now;
    assert.match(calculator.run("milestoneMarkup(sample)"), />Now</);
    assert.doesNotMatch(calculator.run("milestoneMarkup(sample)"), /can coast now/);
  }
  const future = milestone(calculator, "coast55", "({ ...DEFAULT_INPUTS, currentAge: 37, currentInvestments: 555000, portfolioGrowthRate: 0.07 })");
  assert.equal(future.age, 49);
  assert.equal(future.coastingYears, 6);
  calculator.context.sample = future;
  assert.match(calculator.run("milestoneMarkup(sample)"), /can coast in 12 years/);
  calculator.run("renderDetail(sample)");
  assert.match(calculator.document.getElementById("detail").innerHTML, /Contribution Stop Year/);
});

test("one-year milestones use singular copy in cards and details", () => {
  const calculator = makeCalculator();
  const full = milestone(calculator, "full", "({ ...DEFAULT_INPUTS, currentInvestments: 1700000 })");
  assert.equal(full.yearsAway, 1);
  calculator.context.sample = full;
  assert.match(calculator.run("formatYears(sample.yearsAway)"), /^1 year$/);
  assert.match(calculator.run("milestoneMarkup(sample)"), /Age 31 · 1 year away/);
  assert.doesNotMatch(calculator.run("milestoneMarkup(sample)"), /1 years/);
  calculator.run("renderDetail(sample)");
  assert.match(calculator.document.getElementById("detail").innerHTML, /Age 31 · 1 year away/);
});


test("chart markers group coincident milestones and remain in chronological order", () => {
  const calculator = makeCalculator();
  const groups = calculator.run("chartMilestoneGroups(calculate({ ...DEFAULT_INPUTS, currentAge: 37, currentInvestments: 555000, socialSecurityEnabled: true }).projection)");
  assert.deepEqual(Array.from(groups, (group) => group.index), [6, 19, 26, 30]);
  assert.deepEqual(Array.from(groups[0].labels), ["First $1M", "Barista FIRE"]);
  assert.equal(groups.reduce((count, group) => count + group.labels.length, 0), 5);
  assert.equal(calculator.run("chartMilestoneGroups(calculate({ ...DEFAULT_INPUTS, currentInvestments: 0, monthlyInvesting: 0 }).projection).length"), 0);
  assert.equal(calculator.run("chartMilestoneGroups(calculate({ ...DEFAULT_INPUTS, currentInvestments: 10000000 }).projection).length"), 1);
});
