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

function makeCalculator(hash = "") {
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
