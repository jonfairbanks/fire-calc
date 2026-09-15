# FIRE Calculator

A simple, standalone calculator for exploring when you might be able to reach different FIRE milestones.

By default, all data stays local and does not leave your browser.

![FIRE Calculator dashboard](dashboard.png)

## What It Shows

- When your investments may reach Barista, Full, Chubby, and Fat FIRE.
- When you may be able to Coast FIRE.
- How inflation, annual contributions, and portfolio growth affect the timeline.
- A portfolio projection chart with key milestone markers.

<ins>The numbers are estimates, not financial advice.</ins> Small changes to return, inflation, spending, or contributions can move the results by years.

## Main Assumptions

- Portfolio growth is a constant nominal annual return. Market volatility is not modeled.
- Contributions are fixed nominal amounts added at each year end, and continue throughout the chart. Each milestone assumes contributions continue until its own date; later milestones do not describe what happens after choosing an earlier retirement date.
- Spending grows by `(1 + inflation) * (1 + real spending growth)` each year.
- Part-time income and Social Security benefits are entered in today's dollars and grow with inflation. Social Security reduces the spending target starting at the selected claiming age; enter a benefit estimate appropriate to that age and your expected work history.
- FIRE targets are based on spending multiples:
  - Full FIRE: `25x` annual spending
  - Chubby FIRE: `33x` annual spending
  - Fat FIRE: `50x` annual spending
  - Barista FIRE: `25x` the gap after part-time income
- Coast FIRE compares the portfolio at the contribution stop date with the amount needed to grow to the retirement-age target without further contributions or withdrawals. The details show both balances separately. Past retirement ages are marked **Not Applicable**.
- Milestones are checked at annual intervals for up to 60 years, with Coast FIRE limited to its target age. **Not Reached** means no crossover was found within that window.

## What the Calculator Does Not Test

The chart projects accumulation and makes no retirement withdrawals. Reaching a spending multiple does not establish whether your money will last through retirement. There is no depletion date or probability of success, and the model does not simulate changing market returns, spending growth after retirement, or a retirement spending bridge before Social Security begins.

Part-time income has no modeled end date. Chubby and Fat FIRE use the same spending plan with higher multiples; they do not assume a different lifestyle budget. Taxes, investment fees, healthcare changes, and account-access rules are not separately modeled. Account for relevant costs in spending and returns.

## Input Validation

Invalid entries show an error and leave results based on the last valid value. Fractional percentages remain visible when editing and after leaving a field. Shared input links accept only known fields with valid types and ranges; invalid shared values fall back to defaults with a notice.

- Current age: whole years from 0 to 120.
- Social Security claiming age: whole years from 62 to 70.
- Money: $0 to $1 trillion.
- Portfolio return: -100% to 100%; inflation and real spending growth: above -100% through 100%.

These are supported input bounds, not recommended assumptions.

## Tests

Run the dependency-free numerical and input regression tests with Node.js:

```sh
node --test tests/calculator.test.cjs
```

## Google Analytics

Google Analytics is configured through the GA4 measurement ID in `index.html`:

```html
<meta name="google-analytics-id" content="G-XXXXXXXXXX">
```

The integration avoids sending calculator values or shareable hash input data. It only sends a sanitized page view plus interaction events for updated field names and selected milestone types.

## Contributors

- `vwmj` - original inspiration

---

Google Analytics may be used to understand aggregate usage patterns. User-provided calculator data is not shared and does not leave the tool.
