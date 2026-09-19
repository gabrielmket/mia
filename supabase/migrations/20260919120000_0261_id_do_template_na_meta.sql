-- 0261 — o id do template NA META, para poder editá-lo daqui
--
-- A tela cria e sincroniza template; editar e excluir só pelo painel da Meta.
-- E quem tem o painel da Meta aberto do lado "só ajeita por lá" — aí o nosso
-- banco e a Meta divergem, e o disparo falha com um erro que não menciona
-- nenhuma das duas edições.
--
-- Editar é `POST /{template-id}`, e o id nunca foi guardado: a sincronização
-- pedia `name,language,status,category,…` e o `id` ficou de fora. Sem ele,
-- editar exigiria uma busca a mais na Meta a cada clique, só para descobrir o
-- que ela já tinha dito quando sincronizamos.
--
-- ⚠️ NULO em toda linha existente, e é esperado: as que já estão no banco só
-- ganham o id na próxima sincronização. Por isso quem for editar precisa tratar
-- ausência como "sincronize primeiro" — e não como erro do sistema, que
-- mandaria o operador procurar defeito onde não há.

alter table public.meta_templates
  add column if not exists meta_template_id text;

comment on column public.meta_templates.meta_template_id is
  'O id do template do lado da META. Necessario para editar (POST /{template-id}). Nulo nas linhas anteriores a esta migration — elas o ganham na proxima sincronizacao.';

-- Buscar por ele não é o caminho comum (o comum é por nome+idioma), mas a
-- edição chega com o id na mão e o índice evita varrer a tabela do tenant.
create index if not exists idx_meta_templates_meta_id
  on public.meta_templates (organization_id, meta_template_id)
  where meta_template_id is not null;

notify pgrst, 'reload schema';
