-- Commit enum additions before a later migration uses them in constraints.
ALTER TYPE payment_state ADD VALUE IF NOT EXISTS 'accruing';
ALTER TYPE payment_state ADD VALUE IF NOT EXISTS 'accrued';
