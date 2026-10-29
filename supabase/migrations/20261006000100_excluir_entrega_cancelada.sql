-- ============================================================================
-- Pedido com entrega cancelada sai de toda leitura
-- ============================================================================
-- Regra do negócio, vinda do Power BI (06/10/2026): "SITUACAOENTREGA não é
-- Cancelado". O Portal não aplicava.
--
-- ⚠️ A GRAFIA IMPORTA. Medido em erp.concrem_pedidos_venda nesta data, os
-- valores existentes sao:
--
--     NULL ................................. 17.162
--     Totalmente Entregue .................. 15.473
--     Pendente .............................  1.718
--     Parcialmente Entregue ................    203
--     Parcialmente Entregue e Cancelado ....      1
--
-- NAO existe o valor 'Cancelado' puro. Um filtro
-- `situacao_entrega <> 'Cancelado'` nao removeria NADA -- passaria batido, sem
-- erro, e todo mundo acharia que a regra estava valendo. Por isso o casamento
-- e por conteudo (`ilike '%cancelado%'`), que pega o unico registro cancelado
-- existente.
--
-- IMPACTO REAL: 1 linha. A regra entra pela correcao, nao pelo numero.
--
-- NULL PERMANECE. `is null or not ilike` trata nulo como "nao cancelado": 17.162
-- pedidos nao tem situacao preenchida, e descarta-los apagaria metade da base.
--
-- ONDE: na VIEW, nao nas consultas. Sao 13 pontos no frontend lendo esta view;
-- filtrar aqui e um lugar so, e nenhuma tela nova pode esquecer. A RPC
-- app_dashboard_serie_diaria le a foreign table direto, entao ela e ajustada
-- em separado -- ver 20261006000200.
--
-- A unica mudanca em relacao a 20260706000100 e a linha `and ...cancelado...`.
-- Colunas, perfis e ordem das clausulas de escopo seguem identicos.
--
-- `with (security_barrier = true)` esta repetido aqui porque `create or
-- replace view` NAO preserva essa opcao -- precisa ser reafirmada toda vez
-- que a view e recriada. E o mesmo achado A10 (docs/PLANO-SANEAMENTO.md) que
-- fez 20260706000100 perder a opcao antes.
-- ============================================================================

begin;

create or replace view public.concrem_pedidos_venda with (security_barrier = true) as
  select id, numero_pedido, id_nota_conf, ped_compra_cliente, data_emissao,
    data_validade, previsao_embarque, cliente_codigo, cliente_nome, cliente_cnpj,
    cliente_fantasia, cliente_cidade, cliente_uf, cliente_cep, cliente_endereco,
    cliente_bairro, cliente_telefone, cliente_email, cliente_inscest, cliente_estab,
    representante, dados_tabela, frete, desconto, total_qtd, total_qtd_m3,
    total_produtos, total_pedido_venda, created_at, updated_at, peso_liquido_item,
    grupo_cliente, situacao_entrega
  from erp.concrem_pedidos_venda v
  where (v.situacao_entrega is null or v.situacao_entrega not ilike '%cancelado%')
    and ( app_is_admin()
       or app_perfil() = 'diretor_geral'
       or (app_perfil() = 'diretor' and app_diretor_ve_grupo(grupo_cliente))
       or (representante in ( select app_my_rep_codes() )) );

commit;

-- Verificacao (rodar separado, como postgres):
--   select count(*) from erp.concrem_pedidos_venda
--    where situacao_entrega ilike '%cancelado%';     -- esperado: 1
