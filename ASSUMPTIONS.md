# Assumptions

- `UNASSIGNED` is an additional trip status because the requested seed explicitly includes an unassigned trip, while the initial status list does not.
- Seeded login hashes are populated only when the corresponding demo credential environment variables are set; otherwise the hash fields remain null until credentials are configured.
- Seed delivery, verification, and invoice timestamps are synthetic fixed demo data, spread across all three branches to make dashboard averages meaningful and repeatable.
- The export batches are fixture records only; no invoices or real Tally exports are created.
- All seeded people, phone numbers (`90000 000xx`), consignee data, and the `.test` email address are fictional.
- Auth sessions use an eight-hour JWT lifetime. Set `SESSION_SECRET` to a random value of at least 32 characters.
- Login is limited in memory to five attempts per 15-minute window per IP and login identity; limits are per application instance and reset on restart.
- `OTP_DEMO_CODE` is an optional four-digit shared demo PIN for seeded drivers. It is not SMS delivery or a production OTP flow. `BILLING_DEMO_PASSWORD` optionally sets the seeded billing executive's password; neither credential is committed.
