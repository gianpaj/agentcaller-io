-- Commit this enum addition before the following migration uses its value.
alter type payment_state add value if not exists 'not_required';
