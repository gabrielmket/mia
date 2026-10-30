-- manifest: A ÁREA DE COBRANÇA (.96, segunda frente; protótipo "Pagamento no início" aprovado em 27/10/2026, tela 3 e decisões 9 a 11): `mia_cartao_das_mensalidades` guarda, por empresa, o cartão que o administrador pôs para as PRÓXIMAS mensalidades em Configurações › Plano e cobrança ("Trocar o cartão", pelo checkout transparente do Asaas, sem cobrar nada na hora): só os 4 últimos números e a bandeira, a assinatura do Asaas em que ele foi gravado, quando e por quem. O número inteiro e o código de segurança NUNCA são gravados (CHECK de 4 dígitos e de bandeira em maiúsculas). É o que a tela mostra como "Cartão de crédito terminado em ..." até uma mensalidade paga no cartão trazer a informação do próprio Asaas. Só o servidor lê e escreve (a tela lê pelo servidor, depois de conferir que quem abre administra a empresa). LGPD: cascata com a empresa, e a empresa redigida perde a linha pelo gatilho `trg_mia_cartao_das_mensalidades_sai_com_a_empresa_redigida`. Só objetos nossos.
--
-- 9125 · o cartão das mensalidades
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: aplicar duas vezes dá zero erro.

create table if not exists public.mia_cartao_das_mensalidades (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Do cartão, só os 4 últimos números e a bandeira. O número inteiro e o código de segurança nunca.
  cartao_final text not null,
  cartao_bandeira text,
  -- A assinatura do Asaas (`sub_...`) que recebeu o cartão. Assinatura nova (troca
  -- de plano, cobrança refeita) não herda a linha: a tela só a mostra para a atual.
  assinatura_ref text not null,
  trocado_em timestamptz not null default now(),
  trocado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint mia_cartao_das_mensalidades_final check (cartao_final ~ '^[0-9]{4}$'),
  constraint mia_cartao_das_mensalidades_bandeira check (cartao_bandeira is null or cartao_bandeira ~ '^[A-Z_]{2,30}$'),
  constraint mia_cartao_das_mensalidades_assinatura check (char_length(assinatura_ref) between 3 and 80)
);

comment on table public.mia_cartao_das_mensalidades is
  'MIA (9125): o cartao que o administrador pos para as proximas mensalidades em Plano e cobranca (Trocar o cartao, checkout transparente do Asaas, sem cobrar na hora). So os 4 ultimos numeros e a bandeira, a assinatura do Asaas, quando e por quem. O numero e o codigo de seguranca nunca sao gravados. So o servidor.';

alter table public.mia_cartao_das_mensalidades enable row level security;
revoke all on public.mia_cartao_das_mensalidades from anon, authenticated;
grant select, insert, update, delete on public.mia_cartao_das_mensalidades to service_role;

drop trigger if exists trg_mia_cartao_das_mensalidades_touch on public.mia_cartao_das_mensalidades;
create trigger trg_mia_cartao_das_mensalidades_touch
  before update on public.mia_cartao_das_mensalidades
  for each row execute function public.fn_touch_updated_at();

-- LGPD: a empresa redigida perde o cartão das mensalidades.
create or replace function public.fn_mia_cartao_das_mensalidades_sai_com_a_empresa_redigida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'redacted' and old.status is distinct from 'redacted' then
    delete from public.mia_cartao_das_mensalidades where organization_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_mia_cartao_das_mensalidades_sai_com_a_empresa_redigida() from public, anon, authenticated;

drop trigger if exists trg_mia_cartao_das_mensalidades_sai_com_a_empresa_redigida on public.organizations;
create trigger trg_mia_cartao_das_mensalidades_sai_com_a_empresa_redigida
  after update of status on public.organizations
  for each row execute function public.fn_mia_cartao_das_mensalidades_sai_com_a_empresa_redigida();

notify pgrst, 'reload schema';
