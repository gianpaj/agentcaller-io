-- Human-approved introduction data and immutable Checkout return origin.
alter table billing_accounts add column contact_name text;
alter table billing_accounts add constraint billing_accounts_contact_name_length
  check (contact_name is null or char_length(contact_name) between 1 and 80);
alter table billing_setup_requests add column checkout_origin text;
