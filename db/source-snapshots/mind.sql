CREATE SCHEMA IF NOT EXISTS nh_private;
REVOKE ALL ON SCHEMA nh_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION nh_private.portfolio_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $snapshot$
select jsonb_build_object(
 'observedAt',now(),
 'users',(select count(*) from public.profiles),
 'posts',(select count(*) from public.posts),
 'diamondGrants',(select count(*) from public.diamond_grants),
 'monthly',coalesce((select jsonb_agg(x order by x.month) from (
   select to_char(created_at at time zone 'Asia/Seoul','YYYY-MM') as month,count(*) as signups
   from public.profiles group by 1
 ) x),'[]'::jsonb)
) as data
$snapshot$;
REVOKE ALL ON FUNCTION nh_private.portfolio_snapshot() FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA nh_private TO nh_portfolio;
GRANT EXECUTE ON FUNCTION nh_private.portfolio_snapshot() TO nh_portfolio;
