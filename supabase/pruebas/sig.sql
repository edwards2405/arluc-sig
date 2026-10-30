-- Pruebas del Sistema de Información Gerencial (solo lectura).
--   docker cp supabase/pruebas/sig.sql supabase_db_ARLOC:/tmp/sig.sql
--   docker exec supabase_db_ARLOC psql -U postgres -f /tmp/sig.sql
\set ON_ERROR_ROLLBACK on
\pset footer off
begin;
\echo '=== 0. Un vendedor no puede consultar indicadores (debe fallar)'
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true) is not null as sesion_vendedor;
set local role authenticated;
select sig_resumen(current_date - 6, current_date);
reset role;
\echo '=== 1..8. Indicadores como gerente'
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true) is not null as sesion_gerente;
set local role authenticated;
select jsonb_pretty(sig_resumen(date_trunc('month', current_date)::date, current_date));
select * from sig_metas(extract(year from current_date)::int, extract(month from current_date)::int);
select * from sig_proyeccion(8, 4);
select clase, count(*), round(sum(margen),2) margen from sig_analisis_abc(current_date - 89, current_date) group by 1 order by 1;
select sku, margen, participacion_pct, acumulado_pct, clase, dias_cobertura from sig_analisis_abc(current_date - 89, current_date) limit 5;
select nombre, recencia_dias, frecuencia, monto, r, f, m, segmento from sig_clientes_rfm();
select dia_semana, sum(facturas) from sig_mapa_ventas(current_date - 89, current_date) group by 1 order by 1;
select nivel, categoria, mensaje from sig_alertas();
select to_char(date_trunc('month', dia), 'YYYY-MM') mes, sum(ventas) from sig_ventas_diarias(current_date - 89, current_date) group by 1 order by 1;
rollback;
