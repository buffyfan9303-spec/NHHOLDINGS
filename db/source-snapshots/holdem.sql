CREATE SCHEMA IF NOT EXISTS nh_private;
REVOKE ALL ON SCHEMA nh_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION nh_private.portfolio_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $snapshot$
-- These are venue records and stored receipts, never NURI platform revenue.
-- Exclusions are known test/seed venue IDs, not inference from names.
with venues as (
 select id,name,approved,status,created_at,
  id in ('615376fa-ffc4-420b-85a0-b9847520c12f','dddd0000-0000-4000-8000-000000000001',
  'd0e20929-5eed-4000-8000-00000000a001','d0e20929-5eed-4000-8000-00000000a002','d0e20929-5eed-4000-8000-00000000a003') as excluded
 from public.venues
), receipts as (
 select b.venue_id,to_char(b.session_date,'YYYY-MM') as month,
  case when not coalesce(b.is_split,false) and coalesce(b.is_unpaid,false) then 0
   else coalesce(b.cash_amount,0)+coalesce(b.card_amount,0)+coalesce(b.transfer_amount,0) end as stored_receipts,
  case when b.is_split then coalesce(b.unpaid_amount,0) when b.is_unpaid then
   coalesce(b.cash_amount,0)+coalesce(b.card_amount,0)+coalesce(b.transfer_amount,0) else 0 end as stored_unpaid,
  case when not coalesce(b.addon_unpaid,false) and b.addon_method in ('cash','card','transfer') then coalesce(b.addon_amount,0) else 0 end as stored_addon,
  (coalesce(b.cash_amount,0)+coalesce(b.card_amount,0)+coalesce(b.transfer_amount,0)=0 and b.buyin_at < timestamptz '2026-08-18 00:00:00+09') as legacy
 from public.ledger_buyins b join venues v on v.id=b.venue_id
 where not v.excluded
), monthly as (
 select month,venue_id as "businessId",count(*) as records,sum(stored_receipts) as "storedReceipts",
 sum(stored_addon) as "storedAddonReceipts",sum(stored_unpaid) as "storedUnpaid",
 count(*) filter(where legacy) as "legacyRecords" from receipts group by month,venue_id
)
select jsonb_build_object(
 'observedAt',now(),'users',(select count(*) from public.profiles),
 'sourceBusinesses',(select count(*) from venues),
 'excludedBusinesses',(select count(*) from venues where excluded),
 'buyins',(select count(*) from public.ledger_buyins),
 'sessions',(select count(*) from public.ledger_sessions),
 'partners',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'excluded',excluded,'active',approved and status='active')) from venues),'[]'::jsonb),
 'monthly',coalesce((select jsonb_agg(x order by x.month) from monthly x),'[]'::jsonb)
) as data
$snapshot$;
REVOKE ALL ON FUNCTION nh_private.portfolio_snapshot() FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA nh_private TO nh_portfolio;
GRANT EXECUTE ON FUNCTION nh_private.portfolio_snapshot() TO nh_portfolio;
