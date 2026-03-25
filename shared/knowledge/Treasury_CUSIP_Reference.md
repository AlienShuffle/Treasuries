---
title: Treasury CUSIP Root Reference
description: 6-character CUSIP prefix map for U.S. Treasury instrument types, including STRIPS identification
---

# Treasury CUSIP Root Reference

The first 6 characters of a U.S. Treasury CUSIP identify the instrument type. This is used to classify and filter securities programmatically (e.g., to exclude STRIPS from yield curve displays).

## CUSIP Prefix Map

| Prefix | Instrument Type |
|--------|----------------|
| 912797 | Treasury Bill |
| 912803 | STRIPS — Bond principal |
| 912810 | Treasury Bond |
| 912820 | STRIPS — Note principal |
| 912821 | STRIPS — Note principal |
| 912828 | Treasury Note |
| 91282C | Treasury Note |
| 912833 | STRIPS — Interest (coupon) |
| 912834 | STRIPS — Interest (coupon) |

## STRIPS

STRIPS (Separate Trading of Registered Interest and Principal of Securities) are zero-coupon instruments created by stripping the coupon payments and principal from a nominal Treasury. They trade separately but are derived from, and backed by, the underlying Treasury security.

STRIPS are excluded from yield curve analysis by default because:
- They are zero-coupon instruments; their yields are not comparable to coupon bond yields on the same curve
- They are more thinly traded and serve a different purpose (duration-matching, pension liability hedging)
- Their prices embed a liquidity discount relative to the underlying coupon bonds

STRIPS are identified in code via the `isStrip(cusip)` helper using the prefixes above (912803, 912820, 912821, 912833, 912834).
