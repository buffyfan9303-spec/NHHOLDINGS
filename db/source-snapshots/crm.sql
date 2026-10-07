CREATE SCHEMA IF NOT EXISTS nh_private;
REVOKE ALL ON SCHEMA nh_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION nh_private.portfolio_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $snapshot$
-- Tenant operations are separate from NURI revenue. Known demo business IDs
-- come from the CRM seed/handoff, never a blanket assumption about names.
with businesses as (
 select id,name,industry,active,
  id in ('68dfe12a-6e47-47dd-a830-3ccce507e4ac','2f96b056-54e1-4ab0-a2e5-d90b4badf60c',
  'b78820ad-98f5-476f-9686-39a2d9bf1460','a60ac76d-9468-465c-9d06-96702f5903c6',
  'd26e357e-94ea-486d-89ce-232db1f43f90','f382c01a-c0d1-419c-9c61-b4b6fb412f7d') as excluded
 from crm.businesses
), movements as (
 select to_char(e.occurred_at at time zone 'Asia/Seoul','YYYY-MM') as month,e.business_id,
 'rental_charge' as metric,case when e.direction='in' then e.amount else -e.amount end as amount
 from crm.ledger_entries e where e.entry_type='rental_revenue'
 union all
 select to_char(e.occurred_at at time zone 'Asia/Seoul','YYYY-MM'),e.business_id,
 'rental_discount',case when e.direction='out' then e.amount else -e.amount end
 from crm.ledger_entries e where e.entry_type='discount'
 union all
 select to_char(e.occurred_at at time zone 'Asia/Seoul','YYYY-MM'),e.business_id,
 'rental_cash',case when e.direction='in' then e.amount else -e.amount end
 from crm.ledger_entries e where e.entry_type in ('payment_in','refund')
 union all
 select bill.period,bill.business_id,'building_charge',bill.supply+bill.exempt
 from crm.bld_bills bill join crm.bld_billing_runs run on run.id=bill.run_id where run.status='approved'
 union all
 select to_char(paid_at at time zone 'Asia/Seoul','YYYY-MM'),business_id,'building_cash',amount from crm.bld_payments
 union all
 select period,business_id,'building_expense',supply from crm.bld_expenses
 union all
 select to_char(delivered_date,'YYYY-MM'),business_id,'factory_delivered',supply from crm.factory_orders where status='완료' and delivered_date is not null
 union all
 select to_char(paid_at at time zone 'Asia/Seoul','YYYY-MM'),business_id,'salon_cash',amount from crm.salon_payments
 union all
 select to_char(paid_at at time zone 'Asia/Seoul','YYYY-MM'),business_id,'academy_cash',amount from crm.acad_payments
 union all
 select to_char(sold_at,'YYYY-MM'),business_id,'unmanned_reconciled',amount from crm.us_sales_records where reconciled
), monthly as (
 select m.month,m.business_id as "businessId",m.metric,count(*) as records,sum(m.amount) as amount from movements m
 join businesses b on b.id=m.business_id where not b.excluded and m.month is not null group by m.month,m.business_id,m.metric
)
select jsonb_build_object(
 'observedAt',now(),'sourceBusinesses',(select count(*) from businesses),
 'excludedBusinesses',(select count(*) from businesses where excluded),
 'customers',(select count(*) from crm.customers),'ledgerRecords',(select count(*) from crm.ledger_entries),
 'partners',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'industry',industry,'active',active,'excluded',excluded)) from businesses),'[]'::jsonb),
 'corporatePartners',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'businessId',p.business_id,'active',p.active)) from crm.bld_parties p join businesses b on b.id=p.business_id where p.kind='corp' and not b.excluded),'[]'::jsonb),
 'monthly',coalesce((select jsonb_agg(x order by x.month,x.metric) from monthly x),'[]'::jsonb),
 'operations',coalesce((select jsonb_agg(jsonb_build_object(
 'businessId',b.id,
 'customers',(select count(*) from crm.customers c where c.business_id=b.id),
 'buildings',(select count(*) from crm.bld_buildings x where x.business_id=b.id and x.active),
 'units',(select count(*) from crm.bld_units x where x.business_id=b.id and x.active),
 'activeContracts',(select count(*) from crm.bld_contracts x where x.business_id=b.id and x.status='active' and x.period @> (now() at time zone 'Asia/Seoul')::date),
 'openWorkOrders',(select count(*) from crm.bld_work_orders x where x.business_id=b.id and x.status in ('open','in_progress')),
 'pendingFactoryOrders',(select count(*) from crm.factory_orders x where x.business_id=b.id and x.status in ('접수','진행중')),
 'outstanding',(select coalesce(sum(x.amount-x.paid-x.credit_applied),0) from crm.bld_receivables x where x.business_id=b.id and x.status='open' and x.amount-x.paid-x.credit_applied>0)
 )) from businesses b where not b.excluded),'[]'::jsonb),
 'expenseDetails',coalesce((select jsonb_agg(x order by x.month,x.id) from (
 select e.id,e.business_id as "businessId",e.period as month,e.supply,e.vat,t.name as category,e.vendor
 from crm.bld_expenses e join businesses b on b.id=e.business_id join crm.bld_charge_types t on t.id=e.charge_type_id where not b.excluded
 ) x),'[]'::jsonb)
) as data
$snapshot$;
REVOKE ALL ON FUNCTION nh_private.portfolio_snapshot() FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA nh_private TO nh_portfolio;
GRANT EXECUTE ON FUNCTION nh_private.portfolio_snapshot() TO nh_portfolio;
