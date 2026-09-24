alter table client_profiles add column is_operator boolean not null default false;
alter table calls add column funding_source text not null default 'x402';
alter table calls add column operator_authorized_by uuid references client_profiles(id);
alter table calls add constraint calls_funding_source_check check (funding_source in ('x402','operator'));
alter table calls add constraint calls_operator_authorization_check check (
  (funding_source = 'operator' and operator_authorized_by = client_id
   and operator_authorized_by is not null and payment_state = 'not_required'
   and coalesce(task->>'type', '') = 'connect_me')
  or (funding_source = 'x402' and operator_authorized_by is null and payment_state <> 'not_required')
);
