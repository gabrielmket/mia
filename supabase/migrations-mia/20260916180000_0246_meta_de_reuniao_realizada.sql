-- 0246 — marcar não é comparecer: a métrica de reunião REALIZADA
--
-- A 0243 deu ao SDR a meta de `reunioes`, que conta o que ele MARCOU. É a
-- medida certa da atividade dele — marcar é o que ele controla. Só que ela
-- sozinha esconde os dois comportamentos opostos que importam:
--
--   • o SDR que marca bem e leva faltas do cliente (fora do controle dele);
--   • o SDR que marca com qualquer um para bater número, e a agenda do closer
--     vira sala vazia.
--
-- Com as duas métricas lado a lado, os dois aparecem. Sem a segunda, nenhum.
--
-- ⚠️ A falta NÃO é descontada de `reunioes`, e isso é decisão, não esquecimento:
-- descontar puniria o SDR pelo cliente que não apareceu. `reunioes` continua
-- sendo "quantas ficaram de pé"; `reunioes_realizadas` é "quantas aconteceram".
--
-- O dado já existia inteiro (`calendar_appointments.status` tem `completed` e
-- `no_show` desde sempre, com tela e ferramenta de agente para registrar). O que
-- faltava era alguém poder pôr um ALVO em cima dele.

do $$
begin
  -- `if not exists` nas duas pontas: a migration roda de novo em toda
  -- reimplantação (o bootstrap reaplica o baseline em modo update).
  if exists (select 1 from pg_constraint where conname = 'sales_targets_metrica_enum') then
    alter table public.sales_targets drop constraint sales_targets_metrica_enum;
  end if;

  alter table public.sales_targets
    add constraint sales_targets_metrica_enum check (metrica in (
      'reunioes',             -- atividade: reuniões que ficaram de pé no mês
      'reunioes_realizadas',  -- comparecimento: as que de fato aconteceram
      'receita_total',        -- tudo que foi ganho
      'receita_recorrente',   -- só mensalidade
      'receita_avulsa',       -- só projeto/setup
      'receita_originada'     -- a participação de quem ORIGINOU (a meta do SDR)
    ));
end $$;

-- A coerência do alvo acompanha: reunião realizada também se conta em unidades,
-- não em centavos. Sem isto, uma meta de comparecimento exigiria valor em
-- dinheiro e o CHECK recusaria uma linha perfeitamente válida.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'sales_targets_alvo_coerente') then
    alter table public.sales_targets drop constraint sales_targets_alvo_coerente;
  end if;

  alter table public.sales_targets
    add constraint sales_targets_alvo_coerente check (
      (metrica in ('reunioes', 'reunioes_realizadas')
        and alvo_quantidade is not null and alvo_cents is null)
      or (metrica not in ('reunioes', 'reunioes_realizadas')
        and alvo_cents is not null and alvo_quantidade is null)
    );
end $$;
